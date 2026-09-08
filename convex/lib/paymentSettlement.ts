import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertSameSettlement, type SettlementBlock } from "./settlementBlock";
import { appendAudit } from "../audit";
import { queueReportSource } from "./reportIndex";

export async function completePayment(
  ctx: MutationCtx,
  payment: Doc<"disbursements">,
  actorUserId: Id<"users">,
  args: {
    txHash: string;
    settlement?: SettlementBlock;
    safeTxHash?: string;
    executionId?: Id<"circleExecutions">;
  },
) {
  if (args.settlement)
    assertSameSettlement(payment.settlement, args.settlement);
  if (payment.status === "executed") {
    if (payment.txHash !== args.txHash)
      throw new Error("Payment already has a different execution receipt");
    if (args.settlement && !payment.settlement) {
      await ctx.db.patch(payment._id, {
        settlement: args.settlement,
        updatedAt: Date.now(),
      });
      await queueReportSource(ctx, payment.orgId, "payment", payment._id);
      await appendAudit(ctx, {
        orgId: payment.orgId,
        actorUserId,
        action: "disbursement.settlement_evidence",
        objectType: "disbursement",
        objectId: payment._id,
        metadata: { ...args.settlement, txHash: args.txHash },
        timestamp: Date.now(),
      });
    }
    return { success: true };
  }
  const now = Date.now();
  await ctx.db.patch(payment._id, {
    status: "executed",
    settlement: args.settlement,
    txHash: args.txHash,
    nativeRecoveryAt: undefined,
    relayError: undefined,
    executedAt: now,
    updatedAt: now,
  });
  await queueReportSource(ctx, payment.orgId, "payment", payment._id);
  await appendAudit(ctx, {
    orgId: payment.orgId,
    actorUserId,
    action: "disbursement.executed",
    objectType: "disbursement",
    objectId: payment._id,
    metadata: {
      txHash: args.txHash,
      ...(args.safeTxHash ? { safeTxHash: args.safeTxHash } : {}),
      ...(args.executionId ? { executionId: args.executionId } : {}),
      source: "verified_receipt",
    },
    timestamp: now,
  });
  return { success: true };
}
