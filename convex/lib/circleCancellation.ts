import { keccak256, toHex } from "viem";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requireOrgAccess } from "./rbac";
import { ORG_READER_ROLES, PAYMENT_OPERATOR_ROLES } from "../../shared/roles";
import { decodeCircleRequest } from "../../shared/circleRequest";
import type { CircleSource } from "./circleSource";
import { appendAudit } from "../audit";
import { readTreasuryCancellation, settleTreasuryCancellation } from "./treasuryTransfer";

export async function readCircleCancellation(
  ctx: QueryCtx,
  cancelExecutionId: Id<"circleExecutions">,
  sessionToken: string,
  write = false,
) {
  const original = await ctx.db.get(cancelExecutionId);
  if (original?.treasuryTransferId || original?.treasuryServiceId) return readTreasuryCancellation(ctx, original, sessionToken, write);
  if (!original?.delegatedDisbursementId)
    throw new Error("The original delegated execution was not found.");
  const { user } = await requireOrgAccess(
    ctx,
    original.orgId,
    sessionToken,
    write ? PAYMENT_OPERATOR_ROLES : ORG_READER_ROLES,
  );
  const payment = await ctx.db.get(original.delegatedDisbursementId),
    safe = await ctx.db.get(original.safeId);
  if (
    !payment ||
    payment.orgId !== original.orgId ||
    payment.allowanceCircleExecutionId !== original._id ||
    payment.allowanceFeeSafeId !== original.safeId ||
    payment.allowanceExecution?.signature !== "0x" ||
    !safe ||
    safe.orgId !== original.orgId
  )
    throw new Error("The original delegated account instruction changed.");
  if (
    write &&
    (!original.open ||
      original.stage === "submitting" ||
      payment.txHash ||
      payment.status !== "relaying" ||
      !payment.allowanceCancellationRequestedAt)
  )
    throw new Error(
      "Check the original payment settlement before cancelling its authorization.",
    );
  const request = decodeCircleRequest(original.record);
  if (
    !request.directCall ||
    request.safe.toLowerCase() !== safe.safeAddress.toLowerCase()
  )
    throw new Error(
      "Only the original account authorization can be cancelled here.",
    );
  const call = { to: request.safe, data: "0x" as const, operation: 0 as const };
  const snapshot = JSON.stringify({
    cancelExecutionId,
    payment: payment._id,
    accountKey: original.accountKey,
    originalHash: request.originalHash,
    nonce: String(request.operation.nonce),
    feeLimit: request.permit.amount,
  });
  const identity: CircleSource = { cancelExecutionId };
  return {
    identity,
    target: {
      _id: original._id,
      orgId: original.orgId,
      safeId: safe._id,
      chainId: safe.chainId,
      status: original.stage,
      safeTxHash: keccak256(toHex(snapshot)),
      executionFee: undefined,
    },
    safe,
    user,
    call,
    snapshot,
    sourceId: payment._id,
    kind: "delegated_cancellation",
    directCall: true as const,
    principalUSDC: "0",
    originalRecord: original.record,
    originalExecutionId: original._id,
  };
}

export async function releaseContractReservations(
  ctx: MutationCtx,
  payment: Doc<"disbursements">,
) {
  const intent = payment.allowanceExecution;
  if (
    !intent ||
    intent.signature !== "0x" ||
    intent.feeAuthorization ||
    intent.additionalTransfers?.some((t) => t.signature !== "0x")
  )
    throw new Error(
      "A reusable wallet authorization cannot be released without verified contract invalidation.",
    );
  await ctx.db.patch(payment._id, { delegationKey: undefined });
  const prefix = `${intent.chainId}:${intent.module.toLowerCase()}:${intent.safeAddress.toLowerCase()}:${intent.delegate.toLowerCase()}:${intent.tokenAddress.toLowerCase()}:`;
  for (const transfer of [intent, ...(intent.additionalTransfers ?? [])]) {
    const row = await ctx.db
      .query("delegationReservations")
      .withIndex("by_key", (q) => q.eq("key", `${prefix}${transfer.nonce}`))
      .unique();
    if (row?.disbursementId === payment._id) await ctx.db.delete(row._id);
  }
}

export async function settleCircleCancellation(
  ctx: MutationCtx,
  execution: Doc<"circleExecutions">,
) {
  if (
    !execution.cancelExecutionId ||
    !["confirmed", "failed"].includes(execution.stage)
  )
    return;
  // EntryPoint consumes the sequence even when the no-op's execution fails.
  // Actual gas charged is still recorded on the cancellation's own fee row.
  const original = await ctx.db.get(execution.cancelExecutionId);
  if (original?.treasuryTransferId || original?.treasuryServiceId) return settleTreasuryCancellation(ctx, original, execution);
  const payment = original?.delegatedDisbursementId
    ? await ctx.db.get(original.delegatedDisbursementId)
    : null;
  if (
    !original ||
    !payment ||
    payment.allowanceCircleExecutionId !== original._id ||
    payment.txHash ||
    original.stage === "confirmed" ||
    !execution.settlement ||
    !execution.txHash ||
    decodeCircleRequest(original.record).operation.nonce !==
      decodeCircleRequest(execution.record).operation.nonce
  )
    throw new Error(
      "The cancellation does not match the original unpaid authorization.",
    );
  if (payment.status === "cancelled" && original.stage === "cancelled") return;
  await ctx.db.patch(original._id, {
    open: false,
    stage: "cancelled",
    recoveryAt: undefined,
    updatedAt: Date.now(),
  });
  await ctx.db.patch(payment._id, {
    status: "cancelled",
    cancellationConfirmedAt: execution.settlement.timestamp,
    relayStatus: "Cancelled",
    relayError: undefined,
    updatedAt: Date.now(),
  });
  await releaseContractReservations(ctx, payment);
  await appendAudit(ctx, {
    orgId: payment.orgId,
    actorUserId: execution.createdBy,
    action: "disbursement.allowance_cancelled",
    objectType: "disbursement",
    objectId: payment._id,
    metadata: {
      executionId: original._id,
      cancellationExecutionId: execution._id,
      txHash: execution.txHash,
    },
  });
}
