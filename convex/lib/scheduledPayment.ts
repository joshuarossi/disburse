import { getAddress, keccak256, stringToHex, type Hex } from "viem";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireOrgAccess } from "./rbac";
import { PAYMENT_OPERATOR_ROLES, ORG_READER_ROLES } from "../../shared/roles";
import { prepareAccountTransaction } from "./accountApproval";
import { assertPaymentMayProceed } from "./disbursementPolicy";
import { assertMemberPaymentPolicy } from "./paymentLimits";
import { configuredTokenAddress } from "../../shared/assets";
import { amountToBaseUnits } from "./validation";
import type { CircleSource } from "./circleSource";

export const SCHEDULE_WINDOW_SECONDS = 86400;
export async function scheduledPaymentIntent(
  ctx: QueryCtx,
  payment: Doc<"disbursements">,
) {
  const safe = await ctx.db.get(payment.safeId);
  if (
    !safe ||
    safe.orgId !== payment.orgId ||
    safe.chainId !== payment.chainId ||
    safe.isActive === false
  )
    throw new Error("The funding account is no longer available.");
  const tokenAddress = configuredTokenAddress(safe.chainId, payment.token);
  if (
    !tokenAddress ||
    payment.tokenAddress?.toLowerCase() !== tokenAddress.toLowerCase()
  )
    throw new Error("Review the saved payment currency before scheduling.");
  const recipients =
    payment.type === "batch"
      ? await ctx.db
          .query("disbursementRecipients")
          .withIndex("by_disbursement", (q) =>
            q.eq("disbursementId", payment._id),
          )
          .take(201)
      : [
          {
            recipientAddress: payment.recipientAddress ?? "",
            amount: payment.amount ?? "0",
          },
        ];
  const tx = prepareAccountTransaction(
    { chainId: safe.chainId, token: payment.token, recipients },
    0,
  );
  const call = { to: tx.to, data: tx.data, operation: tx.operation as 0 | 1 };
  const amount = recipients.reduce(
    (sum, r) => sum + amountToBaseUnits(r.amount, payment.token),
    0n,
  );
  if (
    amount !==
    amountToBaseUnits(
      payment.totalAmount ?? payment.amount ?? "0",
      payment.token,
    )
  )
    throw new Error("The payment total does not match its recipients.");
  const validAfter = Math.ceil((payment.scheduledAt ?? 0) / 1000);
  const validUntil = validAfter + SCHEDULE_WINDOW_SECONDS;
  const intentHash = keccak256(
    stringToHex(
      JSON.stringify({
        payment: payment._id,
        chainId: safe.chainId,
        safe: safe.safeAddress.toLowerCase(),
        tokenAddress: tokenAddress.toLowerCase(),
        call,
        validAfter,
        validUntil,
      }),
    ),
  );
  return {
    safe,
    recipients,
    call,
    validAfter,
    validUntil,
    intentHash,
    principalUSDC: payment.token === "USDC" ? amount : 0n,
  };
}

export async function scheduledActor(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  actor: Id<"users">,
) {
  const user = await ctx.db.get(actor);
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_org_and_user", (q) =>
      q.eq("orgId", orgId).eq("userId", actor),
    )
    .unique();
  if (
    !user ||
    !membership ||
    membership.status !== "active" ||
    !PAYMENT_OPERATOR_ROLES.includes(
      membership.role as (typeof PAYMENT_OPERATOR_ROLES)[number],
    )
  )
    throw new Error(
      "The member who scheduled this payment no longer has payment access.",
    );
  return user;
}

export async function readScheduledSource(
  ctx: QueryCtx,
  source: {
    paymentScheduleId?: Id<"paymentSchedules">;
    scheduleCancellationId?: Id<"paymentSchedules">;
  },
  sessionToken?: string,
  write = false,
  actor?: Id<"users">,
) {
  const cancellation = !!source.scheduleCancellationId;
  const schedule = await ctx.db.get(
    (source.paymentScheduleId ?? source.scheduleCancellationId)!,
  );
  if (!schedule) throw new Error("Scheduled instruction not found.");
  const user = sessionToken
    ? (
        await requireOrgAccess(
          ctx,
          schedule.orgId,
          sessionToken,
          write ? PAYMENT_OPERATOR_ROLES : ORG_READER_ROLES,
        )
      ).user
    : await scheduledActor(ctx, schedule.orgId, actor!);
  const payment = await ctx.db.get(schedule.disbursementId);
  if (
    !payment ||
    payment.orgId !== schedule.orgId ||
    payment.safeId !== schedule.safeId
  )
    throw new Error("The original scheduled payment is unavailable.");
  const safe = await ctx.db.get(schedule.safeId);
  if (
    !safe ||
    safe.orgId !== schedule.orgId ||
    safe.chainId !== payment.chainId
  )
    throw new Error("The original scheduled account changed.");
  if (
    write &&
    (payment.paymentScheduleId !== schedule._id ||
      payment.safeTxHash ||
      payment.allowanceExecution ||
      payment.nativeExecution ||
      payment.executionFee ||
      payment.txHash ||
      ["paid", "cancelled", "failed", "expired"].includes(schedule.status))
  )
    throw new Error(
      "Check the original scheduled instruction before continuing.",
    );
  let call = schedule.call,
    window = {
      validAfter: schedule.validAfter,
      validUntil: schedule.validUntil,
    },
    hash = schedule.intentHash;
  let original: Doc<"circleExecutions"> | null = null;
  let principalUSDC = 0n;
  if (cancellation) {
    original = schedule.executionId
      ? await ctx.db.get(schedule.executionId)
      : null;
    if (
      !original ||
      (write && (!original.open || !schedule.cancellationRequestedAt))
    )
      throw new Error(
        "Check the original payment before cancelling its authorization.",
      );
    call = { to: safe.safeAddress, data: "0x", operation: 0 };
    hash = keccak256(
      stringToHex(`disburse:cancel-schedule:${schedule._id}:${original._id}`),
    );
    window = { validAfter: 0, validUntil: 0 }; // A fresh, short cancellation window is prepared from chain time.
  } else if (write) {
    if (
      schedule.cancellationRequestedAt ||
      !["draft", "pending", "scheduled"].includes(payment.status)
    )
      throw new Error(
        "This schedule is paused for cancellation or has already been submitted.",
      );
    const intent = await scheduledPaymentIntent(ctx, payment);
    if (intent.intentHash !== schedule.intentHash)
      throw new Error(
        "The payment instructions changed after this schedule was prepared. Cancel its authorization before editing.",
      );
    await assertPaymentMayProceed(ctx, payment, schedule._id);
    await assertMemberPaymentPolicy(
      ctx,
      payment.orgId,
      payment.createdBy,
      payment.token,
      payment.totalAmount ?? payment.amount ?? "0",
      payment.scheduledAt!,
      payment._id,
    );
    principalUSDC = intent.principalUSDC;
  }
  const identity: CircleSource = cancellation
    ? { scheduleCancellationId: schedule._id }
    : { paymentScheduleId: schedule._id };
  return {
    identity,
    target: { ...schedule, safeTxHash: hash },
    schedule,
    payment,
    safe,
    user,
    snapshot: JSON.stringify({
      hash,
      call,
      window,
      scheduleId: schedule._id,
      cancellationRequestedAt: schedule.cancellationRequestedAt,
    }),
    kind: cancellation ? "scheduled_cancellation" : "scheduled_payment",
    sourceId: schedule._id,
    directCall: true as const,
    call: { ...call, to: getAddress(call.to), data: call.data as Hex },
    window: cancellation ? undefined : window,
    principalUSDC: String(principalUSDC),
    originalExecutionId: original?._id,
    originalRecord: original?.record,
  };
}
