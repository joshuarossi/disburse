import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { readAccountChangeSettlement } from "./lib/accountChangeSettlement";
import { getChainClient } from "./lib/safeVerification";
import { accountChangeReceiptOutcome } from "./lib/accountChange";
import { assertPaymentReceipt } from "./lib/executionReceipt";
import { assertReceiptConfirmations } from "../shared/confirmations";
import { readSettlementBlock } from "./lib/settlementBlock";
import { configuredTokenAddress } from "../shared/assets";

export const reconcile = internalAction({
  args: { cancellationId: v.id("accountCancellations") },
  handler: async (ctx, args): Promise<void> => {
    const { cancellation: c, originalProposal: original } = await ctx.runQuery(
      internal.accountCancellationData.context,
      args,
    );
    if (!["pending", "processing"].includes(c.status)) return;
    const identity = { ...args, attemptId: c.execution?.attemptId };
    try {
      const result = await readAccountChangeSettlement({
        chainId: c.chainId,
        safeAddress: c.safeAddress,
        safeTxHash: c.safeTxHash,
        originalHash: c.originalHash,
        executionFee: c.executionFee,
        searchFromBlock: c.searchFromBlock,
        txHash: c.execution?.txHash,
        data: c.execution?.data,
      });
      if (result.originalTxHash) {
        const client = getChainClient(c.chainId);
        const receipt = await client.getTransactionReceipt({
          hash: result.originalTxHash,
        });
        assertReceiptConfirmations(
          receipt.blockNumber,
          await client.getBlockNumber(),
        );
        const settlement = await readSettlementBlock(
          client,
          c.chainId,
          receipt,
        );
        const outcome = accountChangeReceiptOutcome(receipt, {
          safeAddress: c.safeAddress,
          safeTxHash: c.originalHash,
        });
        if (original.disbursementId && outcome === "success") {
          const expected = await ctx.runQuery(
            internal.disbursements.getForVerification,
            { disbursementId: original.disbursementId },
          );
          const tokenAddress =
            expected.tokenAddress ??
            configuredTokenAddress(expected.chainId, expected.token);
          if (!tokenAddress)
            throw new Error("The original payment currency is unavailable");
          assertPaymentReceipt(receipt, {
            ...expected,
            tokenAddress,
          });
          await ctx.runMutation(internal.disbursements.confirmExecution, {
            disbursementId: original.disbursementId,
            safeTxHash: c.originalHash,
            txHash: result.originalTxHash,
            settlement,
          });
        } else if (original.policyChangeId && outcome === "success") {
          const { policy } = await ctx.runQuery(
            internal.spendingPolicyData.context,
            { policyChangeId: original.policyChangeId },
          );
          accountChangeReceiptOutcome(receipt, policy);
        }
        // This mutation also handles an ExecutionFailure that consumed the
        // original nonce. No cancellation can subsequently use that nonce.
        await ctx.runMutation(
          internal.accountCancellationData.originalSettled,
          { ...args, txHash: result.originalTxHash, outcome, settlement },
        );
        return;
      }
      await ctx.runMutation(internal.accountCancellationData.checkpoint, {
        ...identity,
        searchFromBlock: result.searchFromBlock,
        txHash: result.txHash,
        outcome: result.outcome
          ? result.outcome === "success"
            ? "applied"
            : "failed"
          : undefined,
        appliedAt: result.settlement?.timestamp,
        settlement: result.settlement,
        error:
          result.outcome === "failure"
            ? "The cancellation failed on chain. Review its receipt before requesting another cancellation."
            : undefined,
      });
    } catch {
      await ctx.runMutation(internal.accountCancellationData.checkpoint, {
        ...identity,
        error:
          "A confirmed receipt is not available yet. We are checking both the cancellation and the original transaction.",
      });
    }
  },
});
