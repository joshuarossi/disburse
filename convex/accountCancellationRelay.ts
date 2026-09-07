"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { managedRelay } from "./lib/managedRelay";

export const process = internalAction({
  args: { cancellationId: v.id("accountCancellations") },
  handler: async (ctx, args): Promise<void> => {
    const { cancellation: p } = await ctx.runQuery(
      internal.accountCancellationData.context,
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
          internal.accountCancellations.verifyExecution,
          args,
        );
        if (verified.data.toLowerCase() !== e.data.toLowerCase())
          throw new Error("Cancellation execution changed");
        const relayer = managedRelay(p.chainId);
        if (
          !(await ctx.runMutation(
            internal.accountCancellationData.begin,
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
        await ctx.runMutation(internal.accountCancellationData.checkpoint, {
          ...identity,
          providerId,
        });
      } catch {
        await ctx.runMutation(internal.accountCancellationData.checkpoint, {
          ...identity,
          error: claimed
            ? "The submission response was interrupted. We are checking the original cancellation and will not submit it again."
            : "This cancellation needs review before submission. Its approval, account state or managed fee service is not ready.",
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
          await ctx.runMutation(internal.accountCancellationData.checkpoint, {
            ...identity,
            txHash,
          });
      } catch {
        /* The chain remains the settlement source during provider outages. */
      }
    }
    await ctx.runAction(internal.accountCancellationRecovery.reconcile, args);
  },
});
