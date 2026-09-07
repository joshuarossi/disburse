import { readSettlementBlock } from './lib/settlementBlock';
import {
  assertSafeProposal,
  readOwnerApprovalStatus,
} from "./lib/safeProposal";
import { loadPaymentProposal, type WorkspaceApprovalStatus } from './lib/paymentProposal';
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getChainClient } from "./lib/safeVerification";
import { assertValidTxHash } from "./lib/validation";
import { assertPaymentReceipt } from "./lib/executionReceipt";
import { CHAIN_TOKENS, type SupportedChainId } from "../shared/chains";
import { assertReceiptConfirmations } from "../shared/confirmations";

export const confirm = action({
  args: {
    disbursementId: v.id("disbursements"),
    sessionToken: v.string(),
    txHash: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    assertValidTxHash(args.txHash);
    const expected = await ctx.runQuery(
      internal.disbursements.getForVerification,
      { disbursementId: args.disbursementId, sessionToken: args.sessionToken },
    );
    const tokens = CHAIN_TOKENS[expected.chainId as SupportedChainId];
    const token =
      tokens &&
      Object.entries(tokens).find(
        ([symbol]) => symbol === expected.token.toUpperCase(),
      )?.[1];
    if (!token)
      throw new Error(
        "Cannot verify this payment currency on the selected network",
      );
    const receipt = await getChainClient(
      expected.chainId,
    ).getTransactionReceipt({ hash: args.txHash as `0x${string}` });
    assertPaymentReceipt(receipt, { ...expected, tokenAddress: token.address });
    assertReceiptConfirmations(receipt.blockNumber, await getChainClient(expected.chainId).getBlockNumber());
    return ctx.runMutation(internal.disbursements.confirmExecution, {
      ...args,
      safeTxHash: expected.safeTxHash,
      settlement: await readSettlementBlock(getChainClient(expected.chainId), expected.chainId, receipt),
    });
  },
});

// Bounded receipt reconciliation; never depend on a finance user's open tab.
export const reconcile = internalAction({
  args: { disbursementId: v.id("disbursements"), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const payment = await ctx.runQuery(internal.disbursements.getInternal, {
      disbursementId: args.disbursementId,
    });
    if (payment?.nativeExecution) {
      await ctx.runAction(internal.nativePayments.reconcile, { disbursementId: args.disbursementId });
      return;
    }
    if (
      !payment ||
      payment.status !== "relaying" ||
      (!payment.relayTaskId && !payment.txHash)
    )
      return;
    try {
      const status = payment.txHash
        ? { transactionHash: payment.txHash, taskState: "Submitted" }
        : await ctx.runAction(api.relay.getTaskStatus, {
            taskId: payment.relayTaskId!,
          });
      if (status.transactionHash) {
        const expected = await ctx.runQuery(
          internal.disbursements.getForVerification,
          { disbursementId: args.disbursementId },
        );
        const tokens = CHAIN_TOKENS[expected.chainId as SupportedChainId];
        const token =
          tokens &&
          Object.entries(tokens).find(
            ([symbol]) => symbol === expected.token.toUpperCase(),
          )?.[1];
        if (!token) throw new Error("Unsupported payment currency");
        assertValidTxHash(status.transactionHash);
        const receipt = await getChainClient(
          expected.chainId,
        ).getTransactionReceipt({
          hash: status.transactionHash as `0x${string}`,
        });
        assertPaymentReceipt(receipt, {
          ...expected,
          tokenAddress: token.address,
        });
        assertReceiptConfirmations(receipt.blockNumber, await getChainClient(expected.chainId).getBlockNumber());
        await ctx.runMutation(internal.disbursements.confirmExecution, {
          disbursementId: args.disbursementId,
          txHash: status.transactionHash,
          safeTxHash: expected.safeTxHash,
          settlement: await readSettlementBlock(getChainClient(expected.chainId), expected.chainId, receipt),
        });
        return;
      }
      if (
        ["ExecReverted", "Cancelled", "Blacklisted", "NotFound"].includes(
          status.taskState ?? "",
        )
      ) {
        await ctx.runMutation(internal.disbursements.updateStatusInternal, {
          disbursementId: args.disbursementId,
          status: "failed",
          relayStatus: status.taskState,
          relayError: "The payment service did not complete this payment.",
        });
        return;
      }
    } catch (error) {
      console.warn(
        "Payment receipt verification pending",
        args.disbursementId,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
    if (args.attempt < 119)
      await ctx.scheduler.runAfter(
        30_000,
        internal.paymentExecution.reconcile,
        { ...args, attempt: args.attempt + 1 },
      );
  },
});

// Read-only preflight before a wallet signs or sends an existing proposal.
export const verifyProposal = action({
  args: {
    disbursementId: v.id("disbursements"),
    sessionToken: v.string(),
    requireSignatures: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runQuery(api.recipientReviews.assertPayable, { disbursementId: args.disbursementId, sessionToken: args.sessionToken });
    const expected = await ctx.runQuery(
      internal.disbursements.getForVerification,
      { disbursementId: args.disbursementId, sessionToken: args.sessionToken },
    );
    await assertSafeProposal(
      await loadPaymentProposal(ctx, args.disbursementId, expected),
      expected,
      args.requireSignatures,
    );
  },
});

export const approvalStatus = action({
  args: { disbursementId: v.id("disbursements"), sessionToken: v.string() },
  handler: async (ctx, args): Promise<Awaited<ReturnType<typeof readOwnerApprovalStatus>> & { workspace?: WorkspaceApprovalStatus }> => {
    const expected = await ctx.runQuery(
      internal.disbursements.getForVerification,
      { ...args, readOnly: true },
    );
    const proposal = await loadPaymentProposal(ctx, args.disbursementId, expected, expected.actorWallet);
    await assertSafeProposal(proposal, expected, false);
    const status = await readOwnerApprovalStatus(
      proposal,
      expected.chainId,
      expected.safeAddress,
      expected.safeTxHash as `0x${string}`,
      proposal.atBlock,
    );
    const workspace = proposal.workspace;
    return workspace ? { ...status, workspace } : status;
  },
});
