"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { managedRelay } from "./lib/managedRelay";

export const process = internalAction({
  args: { policyChangeId: v.id("spendingPolicyChanges") },
  handler: async (ctx, args): Promise<void> => {
    const { policy: p } = await ctx.runQuery(
      internal.spendingPolicyData.context,
      args,
    );
    if (p.status !== "processing" || !p.executionFee || !p.execution) return;
    const e = p.execution,
      identity = { ...args, attemptId: e.attemptId };
    if (e.phase === "prepared") {
      let claimed = false;
      try {
        // Recheck authority, membership, billing and exact intent immediately
        // before the one permitted provider submission.
        const verified = await ctx.runAction(
          internal.spendingPolicies.verifyExecution,
          args,
        );
        if (verified.data.toLowerCase() !== e.data.toLowerCase())
          throw new Error("Policy execution changed");
        const relayer = managedRelay(p.chainId);
        if (
          !(await ctx.runMutation(
            internal.spendingPolicyData.beginRelay,
            identity,
          ))
        )
          return;
        claimed = true;
        const providerId = await relayer.sendTransaction(
          {
            chainId: p.chainId,
            to: e.to as `0x${string}`,
            data: e.data as `0x${string}`,
          },
          { retries: { max: 0 } },
        );
        await ctx.runMutation(internal.spendingPolicyData.checkpoint, {
          ...identity,
          providerId,
        });
      } catch {
        await ctx.runMutation(internal.spendingPolicyData.checkpoint, {
          ...identity,
          error: claimed
            ? "The submission response was interrupted. We are checking the original policy and will not submit it again."
            : "This policy needs review before submission. Its approval, account state or managed fee service is not ready.",
        });
      }
      return;
    }
    if (e.providerId && !e.txHash) {
      try {
        const status = await managedRelay(p.chainId).getStatus({
          id: e.providerId,
        });
        if (status.chainId !== p.chainId)
          throw new Error("Provider returned another network");
        const txHash =
          "receipt" in status
            ? "transactionHash" in status.receipt
              ? status.receipt.transactionHash
              : status.receipt.receipt.transactionHash
            : "hash" in status
              ? status.hash
              : undefined;
        if (txHash)
          await ctx.runMutation(internal.spendingPolicyData.checkpoint, {
            ...identity,
            txHash,
          });
      } catch {
        /* The chain remains the settlement source during provider outages. */
      }
    }
    await ctx.runAction(internal.spendingPolicyRecovery.reconcile, args);
  },
});
