import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { readAccountChangeSettlement } from "./lib/accountChangeSettlement";

export const reconcile = internalAction({
  args: { policyChangeId: v.id("spendingPolicyChanges") },
  handler: async (ctx, args): Promise<void> => {
    const { policy: p } = await ctx.runQuery(
      internal.spendingPolicyData.context,
      args,
    );
    if (p.status !== "processing" || !p.execution) return;
    const identity = { ...args, attemptId: p.execution.attemptId };
    try {
      const result = await readAccountChangeSettlement({
        chainId: p.chainId,
        safeAddress: p.safeAddress,
        safeTxHash: p.safeTxHash,
        executionFee: p.executionFee,
        ...p.execution,
      });
      await ctx.runMutation(internal.spendingPolicyData.checkpoint, {
        ...identity,
        searchFromBlock: result.searchFromBlock,
        txHash: result.txHash,
        outcome: result.outcome
          ? result.outcome === "success"
            ? "applied"
            : "failed"
          : undefined,
        appliedAt: result.settlement?.timestamp,
        error:
          result.outcome === "failure"
            ? "The account transaction failed. This request was not applied. Review its receipt before preparing another change."
            : undefined,
      });
    } catch {
      await ctx.runMutation(internal.spendingPolicyData.checkpoint, {
        ...identity,
        error:
          "A confirmed receipt for the original policy is not available yet. We will keep checking.",
      });
    }
  },
});
