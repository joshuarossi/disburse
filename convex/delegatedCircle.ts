import {
  readCircleCancellation,
  releaseContractReservations,
} from "./lib/circleCancellation";
import { appendAudit } from "./audit";
import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
  query,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import { PAYMENT_OPERATOR_ROLES } from "../shared/roles";
import {
  readDelegatedSource,
  verifyDelegatedCall,
} from "./lib/circleDelegation";
import { circleConfiguration } from "../shared/circleExecution";
const identity = {
  disbursementId: v.id("disbursements"),
  sessionToken: v.string(),
};

export const feeAccounts = query({
  args: identity,
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found.");
    const { user } = await requireOrgAccess(
      ctx,
      payment.orgId,
      args.sessionToken,
      PAYMENT_OPERATOR_ROLES,
    );
    const accounts = await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", payment.orgId))
      .take(101);
    if (accounts.length > 100)
      throw new Error("This workspace exceeds the account selection limit.");
    return accounts
      .filter((s) => {
        if (
          s.assignedUserId !== user._id ||
          s.chainId !== payment.chainId ||
          s.isActive === false
        )
          return false;
        try {
          circleConfiguration(s.chainId);
          return true;
        } catch {
          return false;
        }
      })
      .map((s) => ({
        id: s._id,
        name: s.name ?? "Company account",
        address: s.safeAddress,
        likelyOwner: (s.owners ?? []).some(
          (a) => a.toLowerCase() === user.walletAddress.toLowerCase(),
        ),
      }));
  },
});
export const context = internalQuery({
  args: identity,
  handler: (ctx, args) =>
    readDelegatedSource(ctx, args.disbursementId, args.sessionToken, true),
});
export const verify = internalAction({
  args: identity,
  handler: async (
    ctx,
    args,
  ): Promise<{ to: string; data: string; operation: 0 | 1 }> =>
    verifyDelegatedCall(
      await ctx.runQuery(internal.delegatedCircle.context, args),
    ),
});

export const cancellationContext = internalQuery({
  args: {
    cancelExecutionId: v.id("circleExecutions"),
    sessionToken: v.string(),
  },
  handler: (ctx, args) =>
    readCircleCancellation(
      ctx,
      args.cancelExecutionId,
      args.sessionToken,
      true,
    ),
});
export const stop = mutation({
  args: identity,
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (
      !payment?.allowanceFeeSafeId ||
      payment.allowanceExecution?.signature !== "0x" ||
      payment.status !== "relaying" ||
      payment.txHash
    )
      throw new Error(
        "Only the original unpaid account authorization can be cancelled.",
      );
    const { user } = await requireOrgAccess(
      ctx,
      payment.orgId,
      args.sessionToken,
      PAYMENT_OPERATOR_ROLES,
    );
    const execution = payment.allowanceCircleExecutionId
      ? await ctx.db.get(payment.allowanceCircleExecutionId)
      : null;
    const cancellation = execution
      ? await ctx.db
          .query("circleExecutions")
          .withIndex("by_cancel_execution", (q) =>
            q.eq("cancelExecutionId", execution._id),
          )
          .order("desc")
          .first()
      : null;
    if (cancellation?.open || cancellation?.stage === "confirmed")
      return { cancelExecutionId: execution!._id };
    if (execution?.stage === "submitting" || execution?.stage === "confirmed")
      throw new Error(
        "Check the original payment settlement before cancelling it.",
      );
    const signature = execution?.open
      ? await ctx.db
          .query("circleSignatures")
          .withIndex("by_execution_stage", (q) =>
            q.eq("executionId", execution._id).eq("stage", "operation"),
          )
          .first()
      : null;
    if (
      execution?.open &&
      (signature ||
        execution.operationApprovalStartedAt ||
        execution.stage === "ready")
    ) {
      await ctx.db.patch(payment._id, {
        allowanceCancellationRequestedAt:
          payment.allowanceCancellationRequestedAt ?? Date.now(),
        updatedAt: Date.now(),
      });
      return { cancelExecutionId: execution._id };
    }
    if (execution?.open)
      await ctx.db.patch(execution._id, {
        stage: "cancelled",
        open: false,
        recoveryAt: undefined,
        updatedAt: Date.now(),
      });
    await releaseContractReservations(ctx, payment);
    await ctx.db.patch(payment._id, {
      status: "cancelled",
      relayStatus: "Cancelled",
      relayError: undefined,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: payment.orgId,
      actorUserId: user._id,
      action: "disbursement.allowance_unsigned_discarded",
      objectType: "disbursement",
      objectId: payment._id,
    });
    return { cancelExecutionId: null };
  },
});
