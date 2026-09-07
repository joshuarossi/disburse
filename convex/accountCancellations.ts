import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  cancellationIdentity,
  cancellationSourceArgs,
} from "./accountCancellationData";
import { approvalPaths, readAccountAuthority } from "./lib/accountAuthority";
import {
  assembleAccountApprovals,
  prepareAccountCalls,
  verifyAccountSignature,
} from "./lib/accountApproval";
import { assertExactAccountChange } from "./lib/accountChange";
import { readOwnerApprovalStatus } from "./lib/safeProposal";
import { encodeExecTransaction } from "./lib/encodeSafeExecution";
import { assertFundingBalance } from "./lib/fundingBalance";
import { relayConfiguration } from "./lib/relayConfiguration";
import { approvalSigningData } from "../shared/safeSignatures";
import { feeIdentity } from "../shared/executionFee";
import type { AccountApprovalView } from "../shared/accountApprovalView";

export const create = action({
  args: {
    ...cancellationSourceArgs,
    feeToken: v.optional(v.string()),
    reviewedFee: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"accountCancellations">> => {
    const source = await ctx.runQuery(internal.accountCancellationData.source, {
      disbursementId: args.disbursementId,
      policyChangeId: args.policyChangeId,
      sessionToken: args.sessionToken,
    });
    if (!source.canRequest)
      throw new Error(
        "You do not have permission to request this cancellation",
      );
    if (source.existing && source.existing.status !== "failed") {
      const fee = source.existing.executionFee;
      if (
        (fee ? feeIdentity(fee) : undefined) !== args.reviewedFee ||
        fee?.token !== args.feeToken
      )
        throw new Error(
          "Continue the cancellation with its original approved fee",
        );
      return source.existing._id;
    }
    if (!source.original)
      throw new Error(
        "Recover the original signed account proposal before requesting its cancellation",
      );
    if (
      ["relaying", "processing", "executed", "applied"].includes(
        source.target.status,
      )
    )
      throw new Error(
        "Check the original transaction settlement before cancelling it",
      );
    const { safe, original } = source;
    const authority = await readAccountAuthority(
      safe.chainId,
      safe.safeAddress,
    );
    if (authority.nodes[0].nonce > original.nonce)
      throw new Error(
        "The original account transaction number was already used. Check its receipt before requesting a cancellation.",
      );
    const fee = args.feeToken
      ? relayConfiguration(safe.chainId, args.feeToken).fee
      : undefined;
    if ((fee ? feeIdentity(fee) : undefined) !== args.reviewedFee)
      throw new Error("Review the cancellation execution fee");
    if (fee)
      await ctx.runAction(internal.relayExecutor.validateFee, {
        chainId: safe.chainId,
        fee,
      });
    const tx = prepareAccountCalls(
      safe.chainId,
      [{ to: safe.safeAddress, data: "0x" }],
      original.nonce,
      fee,
    );
    const proposal = {
      safeAddress: safe.safeAddress,
      safeTxHash: approvalSigningData(safe.chainId, [authority.root], tx).hash,
      safeTransactionData: tx,
      senderAddress: source.user.walletAddress,
      senderSignature: "0x",
    };
    await assertExactAccountChange(
      safe.chainId,
      safe.safeAddress,
      tx,
      proposal,
      authority,
    );
    const block = BigInt(authority.blockNumber);
    return ctx.runMutation(internal.accountCancellationData.create, {
      disbursementId: args.disbursementId,
      policyChangeId: args.policyChangeId,
      sessionToken: args.sessionToken,
      originalProposalId: original._id,
      proposal,
      executionFee: fee,
      searchFromBlock: String(block > 12n ? block - 12n : 0n),
    });
  },
});
export const approvals = action({
  args: cancellationIdentity,
  handler: async (ctx, args): Promise<AccountApprovalView> => {
    const source = await ctx.runQuery(
      internal.accountCancellationData.context,
      args,
    );
    const { cancellation: c, saved } = source;
    const authority = await readAccountAuthority(c.chainId, c.safeAddress);
    const assembled = await assembleAccountApprovals(
      c.chainId,
      authority,
      saved.proposal,
      source.signatures,
    );
    let blockedReason: string | null = null,
      ready = false;
    try {
      await ctx.runQuery(internal.accountCancellationData.context, {
        ...args,
        write: true,
      });
      const canonical = prepareAccountCalls(
        c.chainId,
        [{ to: c.safeAddress, data: "0x" }],
        c.nonce,
        c.executionFee,
      );
      await assertExactAccountChange(
        c.chainId,
        c.safeAddress,
        canonical,
        saved.proposal,
        authority,
      );
      const status = await readOwnerApprovalStatus(
        {
          ...saved.proposal.safeTransactionData,
          safe: c.safeAddress,
          confirmations: assembled.confirmations,
        },
        c.chainId,
        c.safeAddress,
        c.safeTxHash as `0x${string}`,
        BigInt(authority.blockNumber),
      );
      ready = status.ready;
      if (status.currentNonce > c.nonce)
        blockedReason =
          "The original transaction number has been used. Check cancellation status to reconcile which transaction completed.";
    } catch (error) {
      blockedReason =
        error instanceof Error
          ? error.message
          : "The cancellation could not be verified";
    }
    return {
      proposal: saved.proposal,
      groups: assembled.groups,
      names: source.names,
      ready,
      blockedReason,
      currentNonce: authority.nodes[0].nonce,
      paths: approvalPaths(authority, source.actorWallet!).map((path) => ({
        path,
        labels: path.map(
          (a) =>
            source.names.find((n) => n.address === a)?.name ??
            `${a.slice(0, 8)}…${a.slice(-6)}`,
        ),
        approved: source.signatures.some(
          (s) =>
            s.owner === source.actorWallet!.toLowerCase() &&
            s.pathKey === path.join(":"),
        ),
      })),
    };
  },
});
export const approve = action({
  args: {
    ...cancellationIdentity,
    safeTxHash: v.string(),
    path: v.array(v.string()),
    signature: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const source = await ctx.runQuery(
      internal.accountCancellationData.context,
      {
        cancellationId: args.cancellationId,
        sessionToken: args.sessionToken,
        write: true,
      },
    );
    const { cancellation: c, saved } = source;
    if (c.status !== "pending" || args.safeTxHash !== c.safeTxHash)
      throw new Error("This cancellation no longer accepts approvals");
    const authority = await readAccountAuthority(c.chainId, c.safeAddress);
    if (authority.nodes[0].nonce > c.nonce)
      throw new Error("The original transaction number has already been used");
    await assertExactAccountChange(
      c.chainId,
      c.safeAddress,
      prepareAccountCalls(
        c.chainId,
        [{ to: c.safeAddress, data: "0x" }],
        c.nonce,
        c.executionFee,
      ),
      saved.proposal,
      authority,
    );
    const digest = await verifyAccountSignature(
      c.chainId,
      authority,
      saved.proposal,
      {
        owner: source.actorWallet!,
        path: args.path,
        signature: args.signature,
      },
    );
    await ctx.runMutation(internal.accountCancellationData.sign, {
      ...args,
      digest,
    });
  },
});
export const verifyExecution = internalAction({
  args: {
    cancellationId: v.id("accountCancellations"),
    sessionToken: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    to: string;
    data: string;
    safeTxHash: string;
    managed: boolean;
  }> => {
    const source = await ctx.runQuery(
      internal.accountCancellationData.context,
      { ...args, write: true },
    );
    const { cancellation: c, saved } = source;
    const authority = await readAccountAuthority(c.chainId, c.safeAddress);
    await assertExactAccountChange(
      c.chainId,
      c.safeAddress,
      prepareAccountCalls(
        c.chainId,
        [{ to: c.safeAddress, data: "0x" }],
        c.nonce,
        c.executionFee,
      ),
      saved.proposal,
      authority,
    );
    const assembled = await assembleAccountApprovals(
      c.chainId,
      authority,
      saved.proposal,
      source.signatures,
    );
    const tx = {
      ...saved.proposal.safeTransactionData,
      safe: c.safeAddress,
      confirmations: assembled.confirmations,
    };
    const status = await readOwnerApprovalStatus(
      tx,
      c.chainId,
      c.safeAddress,
      c.safeTxHash as `0x${string}`,
      BigInt(authority.blockNumber),
    );
    if (!status.ready)
      throw new Error(
        "Cancellation needs account approvals or an earlier account transaction must complete",
      );
    if (c.executionFee) {
      await ctx.runAction(internal.relayExecutor.validateFee, {
        chainId: c.chainId,
        fee: c.executionFee,
      });
      await assertFundingBalance(
        c.chainId,
        c.safeAddress,
        c.executionFee.token,
        c.executionFee.amount,
      );
    }
    return {
      to: c.safeAddress,
      data: encodeExecTransaction(tx),
      safeTxHash: c.safeTxHash,
      managed: !!c.executionFee,
    };
  },
});
export const execute = action({
  args: cancellationIdentity,
  handler: async (
    ctx,
    args,
  ): Promise<{
    to: string;
    data: string;
    attemptId: string;
    managed: boolean;
  }> => {
    const verified = await ctx.runAction(
      internal.accountCancellations.verifyExecution,
      args,
    );
    const attemptId = await ctx.runMutation(
      internal.accountCancellationData.reserve,
      {
        ...args,
        safeTxHash: verified.safeTxHash,
        to: verified.to,
        data: verified.data,
        attemptId: crypto.randomUUID(),
      },
    );
    return {
      to: verified.to,
      data: verified.data,
      attemptId,
      managed: verified.managed,
    };
  },
});
