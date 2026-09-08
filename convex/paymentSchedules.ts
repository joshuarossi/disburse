import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import { ORG_READER_ROLES, PAYMENT_OPERATOR_ROLES } from "../shared/roles";
import {
  readScheduledSource,
  scheduledPaymentIntent,
} from "./lib/scheduledPayment";
import { assertPaymentMayProceed } from "./lib/disbursementPolicy";
import { assertMemberPaymentPolicy } from "./lib/paymentLimits";
import {
  supportsCircleFees,
  circleOperationHash,
  CIRCLE_ENTRY_POINT,
} from "../shared/circleExecution";
import {
  circleRootSigningData,
  decodeCircleRequest,
} from "../shared/circleRequest";
import { circleRpc, CircleServiceError } from "../shared/circleTransport";
import { readAccountAuthority } from "./lib/accountAuthority";
import { assembleDataApprovals } from "./lib/accountApproval";
import { verifyCircleSubmission } from "./lib/circleSubmission";
import { assertCircleBatch } from "./lib/circleBatch";
import { assertCircleReservation } from "./lib/circleSource";
import { appendAudit } from "./audit";
import { completePayment } from "./lib/paymentSettlement";

const paymentIdentity = {
  disbursementId: v.id("disbursements"),
  sessionToken: v.string(),
};
const executionIdentity = {
  executionId: v.id("circleExecutions"),
  sessionToken: v.string(),
};
const sourceIdentity = {
  paymentScheduleId: v.optional(v.id("paymentSchedules")),
  scheduleCancellationId: v.optional(v.id("paymentSchedules")),
  sessionToken: v.string(),
};

export const get = query({
  args: paymentIdentity,
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found.");
    await requireOrgAccess(
      ctx,
      payment.orgId,
      args.sessionToken,
      ORG_READER_ROLES,
    );
    return payment.paymentScheduleId
      ? ctx.db.get(payment.paymentScheduleId)
      : null;
  },
});

export const create = mutation({
  args: paymentIdentity,
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found.");
    const { user } = await requireOrgAccess(
      ctx,
      payment.orgId,
      args.sessionToken,
      PAYMENT_OPERATOR_ROLES,
    );
    if (payment.paymentScheduleId) return payment.paymentScheduleId;
    if (
      !["draft", "pending"].includes(payment.status) ||
      payment.safeTxHash ||
      payment.preparedProposalAt ||
      payment.allowanceExecution ||
      payment.nativeExecution ||
      payment.executionFee ||
      payment.cancellationId ||
      payment.txHash
    )
      throw new Error(
        "Only an unsigned payment can receive a new scheduled authorization.",
      );
    if (!supportsCircleFees(payment.chainId))
      throw new Error(
        "Automatic payments with USDC fees are not available on this network.",
      );
    if (
      !payment.scheduledAt ||
      payment.scheduledAt <= Date.now() + 60_000 ||
      payment.scheduledAt > Date.now() + 90 * 86400_000
    )
      throw new Error(
        "Choose a pay date at least one minute ahead and within the next 90 days.",
      );
    await assertPaymentMayProceed(ctx, payment);
    await assertMemberPaymentPolicy(
      ctx,
      payment.orgId,
      payment.createdBy,
      payment.token,
      payment.totalAmount ?? payment.amount ?? "0",
      payment.scheduledAt,
      payment._id,
    );
    const intent = await scheduledPaymentIntent(ctx, payment);
    const id = await ctx.db.insert("paymentSchedules", {
      orgId: payment.orgId,
      safeId: payment.safeId,
      disbursementId: payment._id,
      createdBy: user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "review",
      checks: 0,
      call: intent.call,
      intentHash: intent.intentHash,
      validAfter: intent.validAfter,
      validUntil: intent.validUntil,
    });
    await ctx.db.patch(payment._id, {
      paymentScheduleId: id,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: payment.orgId,
      actorUserId: user._id,
      action: "disbursement.schedule_prepared",
      objectType: "disbursement",
      objectId: payment._id,
      metadata: {
        scheduleId: id,
        validAfter: intent.validAfter,
        validUntil: intent.validUntil,
      },
    });
    return id;
  },
});

export const context = internalQuery({
  args: sourceIdentity,
  handler: (ctx, args) =>
    readScheduledSource(ctx, args, args.sessionToken, true),
});
export const verify = internalAction({
  args: sourceIdentity,
  handler: async (
    ctx,
    args,
  ): Promise<{ to: string; data: string; operation: 0 | 1 }> => {
    const source = await ctx.runQuery(internal.paymentSchedules.context, args);
    await assertCircleBatch(source.safe.chainId, source.call);
    return source.call;
  },
});

export const arm = action({
  args: executionIdentity,
  handler: async (ctx, args): Promise<void> => {
    const { execution, signatures } = await ctx.runQuery(
      internal.circlePayments.context,
      args,
    );
    if (
      !execution.paymentScheduleId ||
      execution.stage !== "ready" ||
      !execution.open
    )
      throw new Error("Finish the scheduled payment approvals first.");
    await ctx.runQuery(internal.paymentSchedules.context, {
      paymentScheduleId: execution.paymentScheduleId,
      sessionToken: args.sessionToken,
    });
    const request = decodeCircleRequest(execution.record),
      authority = await readAccountAuthority(request.chainId, request.safe);
    const approved = await assembleDataApprovals(
      request.chainId,
      authority,
      circleRootSigningData(request, "operation"),
      signatures.filter((s) => s.stage === "operation"),
    );
    if (approved.confirmations.length < authority.nodes[0].threshold)
      throw new Error(
        "The current account owners must approve this scheduled payment.",
      );
    await ctx.runMutation(internal.paymentSchedules.armSaved, {
      ...args,
      revision: execution.revision,
    });
  },
});
export const armSaved = internalMutation({
  args: { ...executionIdentity, revision: v.number() },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (
      !execution?.paymentScheduleId ||
      execution.stage !== "ready" ||
      !execution.open ||
      execution.revision !== args.revision
    )
      throw new Error(
        "The scheduled authorization changed. Review its current status.",
      );
    const source = await readScheduledSource(
      ctx,
      execution,
      args.sessionToken,
      true,
    );
    if (source.schedule.validUntil * 1000 <= Date.now() + 60_000)
      throw new Error(
        "The payment window has ended. Check the original authorization before choosing another date.",
      );
    await ctx.db.patch(source.schedule._id, {
      status: "armed",
      armedBy: source.user._id,
      checks: 0,
      dispatchAt: Math.max(Date.now(), source.schedule.validAfter * 1000),
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(source.payment._id, {
      status: "scheduled",
      followupAt: Date.now(),
      relayError: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAt(
      Math.max(Date.now(), source.schedule.validAfter * 1000),
      internal.paymentSchedules.dispatch,
      { scheduleId: source.schedule._id },
    );
    await appendAudit(ctx, {
      orgId: source.payment.orgId,
      actorUserId: source.user._id,
      action: "disbursement.scheduled",
      objectType: "disbursement",
      objectId: source.payment._id,
      metadata: {
        scheduleId: source.schedule._id,
        executionId: execution._id,
        scheduledAt: source.schedule.validAfter * 1000,
      },
    });
  },
});

export const due = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("paymentSchedules")
      .withIndex("by_dispatch", (q) =>
        q.gt("dispatchAt", 0).lte("dispatchAt", Date.now()),
      )
      .take(20);
    for (const schedule of due) {
      await ctx.db.patch(schedule._id, { dispatchAt: Date.now() + 60_000 });
      await ctx.scheduler.runAfter(0, internal.paymentSchedules.dispatch, {
        scheduleId: schedule._id,
      });
    }
  },
});
export const forDispatch = internalQuery({
  args: { scheduleId: v.id("paymentSchedules") },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (
      !schedule ||
      schedule.status !== "armed" ||
      !schedule.armedBy ||
      schedule.cancellationRequestedAt ||
      !schedule.executionId ||
      schedule.validAfter * 1000 > Date.now()
    )
      return null;
    const source = await readScheduledSource(
      ctx,
      { paymentScheduleId: schedule._id },
      undefined,
      true,
      schedule.armedBy,
    );
    const execution = await ctx.db.get(schedule.executionId);
    if (!execution || !execution.open || execution.stage !== "ready")
      return null;
    const signatures = await ctx.db
      .query("circleSignatures")
      .withIndex("by_execution_stage", (q) =>
        q.eq("executionId", execution._id).eq("stage", "operation"),
      )
      .take(501);
    if (signatures.length > 500)
      throw new Error("This payment has too many approval records.");
    return { execution, signatures, source };
  },
});
export const dispatch = internalAction({
  args: { scheduleId: v.id("paymentSchedules") },
  handler: async (ctx, args): Promise<void> => {
    let claimed = false;
    try {
      const data = await ctx.runQuery(
        internal.paymentSchedules.forDispatch,
        args,
      );
      if (!data) return;
      const request = await verifyCircleSubmission(
        data.execution,
        data.signatures,
        data.source.call,
      );
      const hash = circleOperationHash(request.chainId, request.operation);
      await ctx.runMutation(internal.paymentSchedules.claim, {
        ...args,
        executionId: data.execution._id,
        revision: data.execution.revision,
        userOpHash: hash,
      });
      claimed = true;
      const response = await circleRpc(
        request.chainId,
        "eth_sendUserOperation",
        [request.operation, CIRCLE_ENTRY_POINT],
      );
      if (response !== hash)
        throw new Error("Unrecognized submission response.");
    } catch (e) {
      if (claimed) return; // A missing response is recovered by its original hash. Never POST again.
      await ctx.runMutation(internal.paymentSchedules.problem, {
        ...args,
        retry:
          e instanceof CircleServiceError &&
          (e.code === "unavailable" || e.code === "not_due"),
        error:
          e instanceof CircleServiceError
            ? e.message
            : "This payment needs review. Check its current approvals, recipient details, screening and account balance before resuming.",
      });
    }
  },
});
export const claim = internalMutation({
  args: {
    scheduleId: v.id("paymentSchedules"),
    executionId: v.id("circleExecutions"),
    revision: v.number(),
    userOpHash: v.string(),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId),
      execution = await ctx.db.get(args.executionId);
    if (
      !schedule ||
      schedule.status !== "armed" ||
      !schedule.armedBy ||
      schedule.cancellationRequestedAt ||
      schedule.executionId !== execution?._id ||
      !execution?.open ||
      execution.stage !== "ready" ||
      execution.revision !== args.revision
    )
      throw new Error(
        "This schedule was already submitted, paused or changed.",
      );
    const source = await readScheduledSource(
      ctx,
      { paymentScheduleId: schedule._id },
      undefined,
      true,
      schedule.armedBy,
    );
    const request = decodeCircleRequest(execution.record);
    if (
      Date.now() < request.validAfter * 1000 ||
      Date.now() >= request.validUntil * 1000 ||
      circleOperationHash(request.chainId, request.operation) !==
        args.userOpHash
    )
      throw new Error("The signed payment window or operation changed.");
    await assertCircleReservation(ctx, execution.safeId, execution._id);
    await ctx.db.patch(schedule._id, {
      status: "processing",
      dispatchAt: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(source.payment._id, {
      status: "relaying",
      relayError: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(execution._id, {
      stage: "submitting",
      userOpHash: args.userOpHash,
      recoveryAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(5000, internal.circlePayments.reconcile, {
      executionId: execution._id,
    });
    await appendAudit(ctx, {
      orgId: schedule.orgId,
      actorUserId: schedule.armedBy,
      action: "disbursement.schedule_submitted",
      objectType: "disbursement",
      objectId: schedule.disbursementId,
      metadata: {
        scheduleId: schedule._id,
        executionId: execution._id,
        userOpHash: args.userOpHash,
      },
    });
  },
});
export const problem = internalMutation({
  args: {
    scheduleId: v.id("paymentSchedules"),
    retry: v.boolean(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (
      !schedule ||
      schedule.status !== "armed" ||
      schedule.cancellationRequestedAt
    )
      return;
    const checks = schedule.checks + 1;
    const retryAt =
      Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(checks, 4));
    const retry =
      args.retry && checks < 5 && retryAt < schedule.validUntil * 1000 - 60_000;
    await ctx.db.patch(schedule._id, {
      status: retry ? "armed" : "paused",
      checks,
      dispatchAt: retry ? retryAt : undefined,
      error: args.error.slice(0, 300),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(schedule.disbursementId, {
      relayError: args.error.slice(0, 300),
      followupAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const stop = mutation({
  args: paymentIdentity,
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment?.paymentScheduleId)
      throw new Error("Scheduled payment not found.");
    const { user } = await requireOrgAccess(
      ctx,
      payment.orgId,
      args.sessionToken,
      PAYMENT_OPERATOR_ROLES,
    );
    const schedule = (await ctx.db.get(payment.paymentScheduleId))!;
    const execution = schedule.executionId
      ? await ctx.db.get(schedule.executionId)
      : null;
    if (
      schedule.status === "paid" ||
      execution?.stage === "confirmed" ||
      payment.txHash
    )
      throw new Error("This payment has already been sent.");
    if (execution?.stage === "submitting" || schedule.status === "processing")
      throw new Error(
        "The original payment is being checked. Wait for its receipt before cancelling.",
      );
    if (schedule.cancellationRequestedAt) return schedule._id;
    const approval = execution
      ? await ctx.db
          .query("circleSignatures")
          .withIndex("by_execution_stage", (q) =>
            q.eq("executionId", execution._id).eq("stage", "operation"),
          )
          .first()
      : null;
    if (
      !execution ||
      !execution.open ||
      (!approval && ["fee", "operation"].includes(execution.stage))
    ) {
      if (execution?.open)
        await ctx.db.patch(execution._id, {
          stage: "cancelled",
          open: false,
          recoveryAt: undefined,
          updatedAt: Date.now(),
        });
      await ctx.db.patch(schedule._id, {
        status: "cancelled",
        dispatchAt: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(payment._id, {
        status: "cancelled",
        relayError: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(schedule._id, {
        status: "paused",
        cancellationRequestedAt: Date.now(),
        dispatchAt: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
    }
    await appendAudit(ctx, {
      orgId: payment.orgId,
      actorUserId: user._id,
      action: "disbursement.schedule_stop_requested",
      objectType: "disbursement",
      objectId: payment._id,
      metadata: {
        scheduleId: schedule._id,
        requiresNonceCancellation:
          !!execution?.open && (!!approval || execution.stage === "ready"),
      },
    });
    return schedule._id;
  },
});

export const returnToDraft = mutation({
  args: paymentIdentity,
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment?.paymentScheduleId)
      throw new Error("Scheduled payment not found.");
    const { user } = await requireOrgAccess(
      ctx,
      payment.orgId,
      args.sessionToken,
      PAYMENT_OPERATOR_ROLES,
    );
    const schedule = (await ctx.db.get(payment.paymentScheduleId))!;
    if (
      !["failed", "expired", "cancelled"].includes(schedule.status) ||
      payment.txHash
    )
      throw new Error(
        "Cancel or reconcile the original authorization before editing this payment.",
      );
    const executions = await Promise.all(
      [schedule.executionId, schedule.cancellationExecutionId]
        .filter((id): id is Id<"circleExecutions"> => !!id)
        .map((id) => ctx.db.get(id)),
    );
    if (executions.some((e) => e?.open))
      throw new Error(
        "The original fee request is still open. Check its status first.",
      );
    await ctx.db.patch(payment._id, {
      paymentScheduleId: undefined,
      status: "draft",
      relayError: undefined,
      cancellationConfirmedAt: undefined,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: payment.orgId,
      actorUserId: user._id,
      action: "disbursement.schedule_returned_to_draft",
      objectType: "disbursement",
      objectId: payment._id,
      metadata: { scheduleId: schedule._id },
    });
  },
});

/** Called only after Circle and principal receipt evidence has been checked. */
export async function settleSchedule(
  ctx: MutationCtx,
  execution: Doc<"circleExecutions">,
) {
  const id = execution.paymentScheduleId ?? execution.scheduleCancellationId;
  if (!id) return;
  const schedule = await ctx.db.get(id);
  if (!schedule) throw new Error("Scheduled instruction not found.");
  const payment = await ctx.db.get(schedule.disbursementId);
  if (!payment) throw new Error("Scheduled payment not found.");
  if (execution.scheduleCancellationId) {
    if (
      ["confirmed", "failed"].includes(execution.stage) &&
      execution.settlement &&
      execution.txHash
    ) {
      const original = (await ctx.db.get(schedule.executionId!))!;
      if (original.stage === "confirmed" || payment.status === "executed")
        throw new Error(
          "The payment and cancellation have conflicting receipts.",
        );
      if (
        decodeCircleRequest(original.record).operation.nonce !==
        decodeCircleRequest(execution.record).operation.nonce
      )
        throw new Error(
          "Cancellation did not invalidate the original authorization.",
        );
      await ctx.db.patch(original._id, {
        open: false,
        stage: "cancelled",
        recoveryAt: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(schedule._id, {
        status: "cancelled",
        dispatchAt: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(payment._id, {
        status: "cancelled",
        cancellationConfirmedAt: execution.settlement.timestamp,
        relayError: undefined,
        updatedAt: Date.now(),
      });
      await appendAudit(ctx, {
        orgId: payment.orgId,
        actorUserId: execution.createdBy,
        action: "disbursement.schedule_cancelled",
        objectType: "disbursement",
        objectId: payment._id,
        metadata: {
          scheduleId: schedule._id,
          txHash: execution.txHash,
          executionId: execution._id,
        },
      });
    }
    return;
  }
  if (execution.stage === "confirmed") {
    if (!execution.settlement || !execution.txHash)
      throw new Error("The scheduled payment receipt is incomplete.");
    await completePayment(
      ctx,
      payment,
      schedule.armedBy ?? schedule.createdBy,
      {
        txHash: execution.txHash,
        settlement: execution.settlement,
        executionId: execution._id,
      },
    );
    await ctx.db.patch(schedule._id, {
      status: "paid",
      dispatchAt: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });
  } else if (execution.stage === "failed" || execution.stage === "expired") {
    await ctx.db.patch(schedule._id, {
      status: execution.stage,
      dispatchAt: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(payment._id, {
      status: "failed",
      relayError:
        execution.stage === "expired"
          ? "The payment window ended without a transfer. Return this payment to draft to choose a new date."
          : "The scheduled execution failed. Its fee is recorded; no recipient payment was completed.",
      followupAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}
