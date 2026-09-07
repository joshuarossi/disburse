import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appendAudit } from "../audit";
import {
  assertApprovedRecipient,
  type PayoutDetails,
} from "../../shared/recipientAssurance";
import { assertPayoutInstructions } from "../../shared/payoutInstructions";

export function payoutDetails(recipient: PayoutDetails): PayoutDetails {
  return {
    walletAddress: recipient.walletAddress.toLowerCase(),
    preferredToken: recipient.preferredToken,
    preferredChainId: recipient.preferredChainId,
  };
}

export async function requestPayoutReview(
  ctx: MutationCtx,
  recipient: Doc<"beneficiaries">,
  proposed: PayoutDetails,
  userId: Id<"users">,
  collectionId?: Id<"recipientCollections">,
) {
  if (recipient.pendingPayoutChangeId)
    throw new Error(
      "This recipient already has payout details awaiting review. Review or withdraw that request first.",
    );
  const now = Date.now();
  const id = await ctx.db.insert("recipientChanges", {
    orgId: recipient.orgId,
    beneficiaryId: recipient._id,
    before: payoutDetails(recipient),
    proposed: payoutDetails(proposed),
    baseVersion: recipient.payoutVersion ?? 0,
    requestedBy: userId,
    collectionId,
    status: "pending",
    requestedAt: now,
  });
  await ctx.db.patch(recipient._id, {
    pendingPayoutChangeId: id,
    updatedAt: now,
  });
  await appendAudit(ctx, {
    orgId: recipient.orgId,
    actorUserId: userId,
    action: "beneficiary.payout_review_requested",
    objectType: "beneficiary",
    objectId: recipient._id,
    metadata: {
      changeId: id,
      before: JSON.stringify(payoutDetails(recipient)),
      proposed: JSON.stringify(payoutDetails(proposed)),
      baseVersion: recipient.payoutVersion ?? 0,
      ...(collectionId ? { collectionId, source: "recipient_link" } : {}),
    },
  });
  return id;
}

// Check again immediately before each app-authorized proposal, signature or
// submission. Settlement reconciliation intentionally does not call this guard.
export async function assertRecipientVersions(
  ctx: Pick<QueryCtx, "db">,
  payment: Doc<"disbursements">,
) {
  const snapshots =
    payment.type === "batch"
      ? await ctx.db
          .query("disbursementRecipients")
          .withIndex("by_disbursement", (q) =>
            q.eq("disbursementId", payment._id),
          )
          .collect()
      : payment.beneficiaryId
        ? [
            {
              beneficiaryId: payment.beneficiaryId,
              recipientAddress: payment.recipientAddress,
              payoutVersion: payment.payoutVersion,
            },
          ]
        : [];
  if (!snapshots.length)
    throw new Error(
      "This payment has no approved recipients. Prepare a new payment from the recipient directory.",
    );
  for (const snapshot of snapshots) {
    const recipient = await ctx.db.get(snapshot.beneficiaryId);
    if (!recipient || recipient.orgId !== payment.orgId)
      throw new Error(
        "The payment recipient is no longer available in this organization.",
      );
    assertApprovedRecipient(recipient);
    if (
      !snapshot.payoutVersion ||
      snapshot.payoutVersion !== recipient.payoutVersion ||
      snapshot.recipientAddress?.toLowerCase() !==
        recipient.walletAddress.toLowerCase()
    ) {
      throw new Error(
        `${recipient.name}: payout details were reviewed or changed after this payment was prepared. Its prior approvals cannot be used in Disburse. Cancel this payment and prepare a new one with the reviewed details.`,
      );
    }
    assertPayoutInstructions(recipient, {
      token: payment.token,
      chainId: payment.chainId ?? 0,
    });
  }
}
