import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { assertRecipientVersions } from "./recipientReview";
import { checkRecipientScreening } from "./screeningPolicy";

type Status = Doc<"disbursements">["status"];

const transitions: Record<Status, readonly Status[]> = {
  draft: ["pending", "proposed", "scheduled", "cancelled"],
  pending: ["pending", "draft", "proposed", "scheduled", "cancelled"],
  proposed: ["scheduled", "relaying", "executed", "failed", "cancelled"],
  scheduled: ["relaying", "cancelled"],
  relaying: ["relaying", "executed", "failed"],
  failed: ["pending", "proposed", "scheduled", "cancelled"],
  executed: [],
  cancelled: [],
};

export function assertStatusTransition(current: Status, next: Status): void {
  if (!transitions[current].includes(next)) {
    throw new Error(`Invalid status transition: ${current} -> ${next}`);
  }
}

export function assertFutureSchedule(timestamp: number, now: number): void {
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp <= now ||
    timestamp > 8640000000000000
  ) {
    throw new Error("Schedule must be a valid date in the future");
  }
}

// Shared by proposal and scheduling paths so scheduling cannot bypass a block.
export async function assertPaymentMayProceed(
  ctx: Pick<QueryCtx, "db">,
  payment: Doc<"disbursements">,
) {
  if (payment.cancellationId)
    throw new Error('A cancellation is pending for this payment. Complete or reconcile it before making another submission.');
  await assertRecipientVersions(ctx, payment);
  const org = await ctx.db.get(payment.orgId);
  if (org?.screeningEnforcement !== "block") return;

  const beneficiaryIds =
    payment.type === "batch"
      ? (
          await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) =>
              q.eq("disbursementId", payment._id),
            )
            .collect()
        ).map((recipient) => recipient.beneficiaryId)
      : payment.beneficiaryId
        ? [payment.beneficiaryId]
        : [];

  const check = await checkRecipientScreening(
    ctx,
    payment.orgId,
    beneficiaryIds,
  );
  if (check.flagged.length)
    throw new Error(
      `Payment blocked by your workspace's screening policy: ${check.flagged[0].beneficiaryName}: ${check.flagged[0].reason}`,
    );
}
