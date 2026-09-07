import type { AccountApprovalView } from '../shared/accountApprovalView';
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { policyIdentity } from "./spendingPolicyData";
import { approvalPaths, readAccountAuthority } from "./lib/accountAuthority";
import {
  assembleAccountApprovals,
  verifyAccountSignature,
} from "./lib/accountApproval";
import {
  assertPolicyProposal,
  inspectPolicy,
  policyTransaction,
} from "./lib/spendingPolicy";
import { configuredTokenAddress } from "../shared/assets";
import { approvalSigningData } from "../shared/safeSignatures";
import { feeIdentity } from "../shared/executionFee";
import { relayConfiguration } from "./lib/relayConfiguration";
import { readOwnerApprovalStatus } from "./lib/safeProposal";
import { encodeExecTransaction } from "./lib/encodeSafeExecution";
import { assertFundingBalance } from "./lib/fundingBalance";
import type { PreparedOwnerProposal } from "../shared/ownerProposal";

export const create = action({
  args: {
    safeId: v.id("safes"),
    sessionToken: v.string(),
    requestId: v.string(),
    kind: v.union(v.literal("grant"), v.literal("revoke")),
    module: v.string(),
    delegate: v.string(),
    token: v.optional(v.string()),
    tokenAddress: v.optional(v.string()),
    amount: v.optional(v.string()),
    resetMinutes: v.optional(v.number()),
    feeToken: v.optional(v.string()),
    reviewedFee: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"spendingPolicyChanges">> => {
    const source = await ctx.runQuery(
      internal.spendingPolicyData.creationContext,
      {
        safeId: args.safeId,
        sessionToken: args.sessionToken,
        kind: args.kind,
        delegate: args.delegate,
      },
    );
    const { safe } = source;
    const authority = await readAccountAuthority(
      safe.chainId,
      safe.safeAddress,
    );
    const tokenAddress =
      args.kind === "grant"
        ? configuredTokenAddress(safe.chainId, args.token ?? "")
        : args.tokenAddress;
    if (!tokenAddress) throw new Error("Choose the allowance currency");
    const intent = await inspectPolicy(
      safe.chainId,
      safe.safeAddress,
      {
        kind: args.kind,
        module: args.module,
        delegate: args.delegate,
        token: args.token,
        tokenAddress,
        amount: args.amount,
        resetMinutes: args.resetMinutes,
      },
      authority,
    );
    const fee = args.feeToken
      ? relayConfiguration(safe.chainId, args.feeToken).fee
      : undefined;
    if (fee && feeIdentity(fee) !== args.reviewedFee)
      throw new Error(
        "Review the policy execution fee before requesting approval",
      );
    if (!fee && args.reviewedFee)
      throw new Error("The reviewed execution method changed");
    if (fee)
      await ctx.runAction(internal.relayExecutor.validateFee, {
        chainId: safe.chainId,
        fee,
      });
    const tx = policyTransaction(
      safe.chainId,
      safe.safeAddress,
      intent,
      Math.max(authority.nodes[0].nonce, source.latestNonce + 1),
      fee,
    );
    const proposal: PreparedOwnerProposal = {
      safeAddress: safe.safeAddress,
      safeTxHash: approvalSigningData(safe.chainId, [authority.root], tx).hash,
      senderAddress: source.actorWallet,
      senderSignature: "0x",
      safeTransactionData: tx,
    };
    await assertPolicyProposal(
      {
        chainId: safe.chainId,
        safeAddress: safe.safeAddress,
        intent,
        executionFee: fee,
        safeTxHash: proposal.safeTxHash,
      },
      proposal,
      authority,
    );
    return ctx.runMutation(internal.spendingPolicyData.create, {
      safeId: safe._id,
      sessionToken: args.sessionToken,
      requestId: args.requestId,
      intent,
      proposal,
      executionFee: fee,
      latestNonce: source.latestNonce,
    });
  },
});
export const approvals = action({
  args: policyIdentity,
  handler: async (ctx, args): Promise<AccountApprovalView> => {
    const source = await ctx.runQuery(
      internal.spendingPolicyData.context,
      args,
    );
    const { policy: p, saved } = source;
    const authority = await readAccountAuthority(p.chainId, p.safeAddress);
    const assembled = await assembleAccountApprovals(
      p.chainId,
      authority,
      saved.proposal,
      source.signatures,
    );
    let blockedReason: string | null = null;
    let ready = false;
    try {
      if (
        p.status !== "pending" &&
        !(p.status === "processing" && p.execution?.walletRejectedAt)
      )
        throw new Error("This policy has already been submitted");
      await ctx.runQuery(internal.spendingPolicyData.context, {
        ...args,
        write: true,
      });
      await assertPolicyProposal(p, saved.proposal, authority);
      const status = await readOwnerApprovalStatus(
        {
          ...saved.proposal.safeTransactionData,
          safe: p.safeAddress,
          confirmations: assembled.confirmations,
        },
        p.chainId,
        p.safeAddress,
        p.safeTxHash as `0x${string}`,
        BigInt(authority.blockNumber),
      );
      ready = status.ready;
      if (status.currentNonce > status.proposalNonce)
        blockedReason =
          "This account transaction number has already been used. Check the original policy settlement.";
    } catch (e) {
      blockedReason =
        e instanceof Error
          ? e.message
          : "Could not verify the current account policy";
    }
    return {
      proposal: saved.proposal,
      groups: assembled.groups,
      names: source.accountNames,
      paths: approvalPaths(authority, source.actorWallet!).map((path) => ({
        path,
        labels: path.map(
          (a) =>
            source.accountNames.find((n) => n.address === a)?.name ??
            `${a.slice(0, 8)}…${a.slice(-6)}`,
        ),
        approved: source.signatures.some(
          (s) =>
            s.owner === source.actorWallet!.toLowerCase() &&
            s.pathKey === path.join(":"),
        ),
      })),
      ready,
      blockedReason,
      currentNonce: authority.nodes[0].nonce,
    };
  },
});
export const approve = action({
  args: {
    ...policyIdentity,
    safeTxHash: v.string(),
    path: v.array(v.string()),
    signature: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const source = await ctx.runQuery(internal.spendingPolicyData.context, {
      policyChangeId: args.policyChangeId,
      sessionToken: args.sessionToken,
      write: true,
    });
    const { policy: p, saved } = source;
    if (p.status !== "pending" || p.safeTxHash !== args.safeTxHash)
      throw new Error("This policy no longer accepts approvals");
    const authority = await readAccountAuthority(p.chainId, p.safeAddress);
    if (authority.nodes[0].nonce > saved.nonce)
      throw new Error("This account transaction number has already been used");
    await assertPolicyProposal(p, saved.proposal, authority);
    const digest = await verifyAccountSignature(
      p.chainId,
      authority,
      saved.proposal,
      {
        path: args.path,
        owner: source.actorWallet!,
        signature: args.signature,
      },
    );
    await ctx.runMutation(internal.spendingPolicyData.saveSignature, {
      ...args,
      digest,
    });
  },
});
export const verifyExecution = internalAction({
  args: {
    policyChangeId: v.id("spendingPolicyChanges"),
    sessionToken: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    to: string;
    data: string;
    blockNumber: string;
    safeTxHash: string;
    managed: boolean;
  }> => {
    const source = await ctx.runQuery(internal.spendingPolicyData.context, {
      ...args,
      write: true,
    });
    const { policy: p, saved } = source;
    if (!["pending", "processing"].includes(p.status))
      throw new Error("This policy is already complete");
    const authority = await readAccountAuthority(p.chainId, p.safeAddress);
    await assertPolicyProposal(p, saved.proposal, authority);
    const assembled = await assembleAccountApprovals(
      p.chainId,
      authority,
      saved.proposal,
      source.signatures,
    );
    const tx = {
      ...saved.proposal.safeTransactionData,
      safe: p.safeAddress,
      confirmations: assembled.confirmations,
    };
    const status = await readOwnerApprovalStatus(
      tx,
      p.chainId,
      p.safeAddress,
      p.safeTxHash as `0x${string}`,
      BigInt(authority.blockNumber),
    );
    if (!status.ready)
      throw new Error(
        "The policy still needs account approvals or an earlier account transaction must complete",
      );
    if (p.executionFee) {
      await ctx.runAction(internal.relayExecutor.validateFee, {
        chainId: p.chainId,
        fee: p.executionFee,
      });
      await assertFundingBalance(
        p.chainId,
        p.safeAddress,
        p.executionFee.token,
        p.executionFee.amount,
      );
    }
    return {
      to: p.safeAddress,
      data: encodeExecTransaction(tx),
      blockNumber: authority.blockNumber,
      safeTxHash: p.safeTxHash,
      managed: !!p.executionFee,
    };
  },
});
export const execute = action({
  args: policyIdentity,
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
      internal.spendingPolicies.verifyExecution,
      args,
    );
    const block = BigInt(verified.blockNumber);
    const attemptId = await ctx.runMutation(
      internal.spendingPolicyData.reserve,
      {
        ...args,
        safeTxHash: verified.safeTxHash,
        to: verified.to,
        data: verified.data,
        searchFromBlock: String(block > 12n ? block - 12n : 0n),
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
