import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import { appendAudit } from "./audit";
import { requestPayoutReview, payoutDetails } from "./lib/recipientReview";
import { verificationMethodValidator } from "./lib/recipientValidators";
import { assertValidAddress } from "./lib/validation";
import {
  payoutDetailsEqual,
  lookalikeAddress,
} from "../shared/recipientAssurance";
import { validateSavedPayoutInstructions } from "../shared/payoutInstructions";
import { assertPaymentMayProceed } from "./lib/disbursementPolicy";

const readers = ["admin", "approver", "initiator", "clerk", "viewer"] as const;

export const assertPayable = query({
  args: { disbursementId: v.id("disbursements"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found");
    await requireOrgAccess(ctx, payment.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
    ]);
    await assertPaymentMayProceed(ctx, payment);
    return true;
  },
});

export const get = query({
  args: { beneficiaryId: v.id("beneficiaries"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const recipient = await ctx.db.get(args.beneficiaryId);
    if (!recipient) throw new Error("Recipient not found");
    const { user, membership } = await requireOrgAccess(
      ctx,
      recipient.orgId,
      args.sessionToken,
      [...readers],
    );
    const changes = await ctx.db
      .query("recipientChanges")
      .withIndex("by_recipient", (q) => q.eq("beneficiaryId", recipient._id))
      .order("desc")
      .take(25);
    const pending =
      changes.find(
        (c) =>
          c._id === recipient.pendingPayoutChangeId && c.status === "pending",
      ) ?? null;
    const members = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q) => q.eq("orgId", recipient.orgId))
      .collect();
    const reviewers = members.filter(
      (m) => m.status === "active" && ["admin", "approver"].includes(m.role),
    );
    const canReview = ["admin", "approver"].includes(membership.role);
    const independentRequired =
      !!pending && reviewers.some((m) => m.userId !== pending.requestedBy);
    const directory = pending
      ? await ctx.db
          .query("beneficiaries")
          .withIndex("by_org_active", (q) =>
            q.eq("orgId", recipient.orgId).eq("isActive", true),
          )
          .collect()
      : [];
    const lookalikes = pending
      ? directory
          .filter((b) =>
            lookalikeAddress(b.walletAddress, pending.proposed.walletAddress),
          )
          .map((b) => b.name)
      : [];
    return {
      pending,
      changes,
      recipient,
      lookalikes,
      canReview,
      canRequest: membership.role !== "viewer",
      canWithdraw:
        !!pending &&
        (pending.requestedBy === user._id || membership.role === "admin"),
      independentRequired,
      isRequester: pending?.requestedBy === user._id,
      canDecide:
        canReview &&
        (!independentRequired || pending?.requestedBy !== user._id),
      reviewerCount: reviewers.length,
    };
  },
});

export const request = mutation({
  args: { beneficiaryId: v.id("beneficiaries"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const recipient = await ctx.db.get(args.beneficiaryId);
    if (!recipient?.isActive) throw new Error("Use an active recipient");
    const { user } = await requireOrgAccess(
      ctx,
      recipient.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator", "clerk"],
    );
    assertValidAddress(recipient.walletAddress);
    if (
      recipient.payoutReviewStatus === "approved" &&
      !recipient.pendingPayoutChangeId
    )
      throw new Error("These payout details are already reviewed");
    return requestPayoutReview(
      ctx,
      recipient,
      payoutDetails(recipient),
      user._id,
    );
  },
});

export const decide = mutation({
  args: {
    changeId: v.id("recipientChanges"),
    sessionToken: v.string(),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.string(),
    verificationMethod: v.optional(verificationMethodValidator),
    confirmedIndependently: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const change = await ctx.db.get(args.changeId);
    if (!change) throw new Error("Payout review not found");
    const { user } = await requireOrgAccess(
      ctx,
      change.orgId,
      args.sessionToken,
      ["admin", "approver"],
    );
    const recipient = await ctx.db.get(change.beneficiaryId);
    if (
      !recipient?.isActive ||
      recipient.orgId !== change.orgId ||
      recipient.pendingPayoutChangeId !== change._id ||
      change.status !== "pending" ||
      (recipient.payoutVersion ?? 0) !== change.baseVersion ||
      !payoutDetailsEqual(recipient, change.before)
    )
      throw new Error(
        "This review is no longer current. Reload the recipient.",
      );
    const reason = args.reason.trim();
    if (reason.length < 10 || reason.length > 1000)
      throw new Error("Record a review reason of 10 to 1,000 characters");
    const members = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q) => q.eq("orgId", change.orgId))
      .collect();
    if (
      user._id === change.requestedBy &&
      members.some(
        (m) =>
          m.status === "active" &&
          ["admin", "approver"].includes(m.role) &&
          m.userId !== change.requestedBy,
      )
    )
      throw new Error("Another approver must review details you submitted");
    if (args.decision === "approved") {
      if (!args.confirmedIndependently || !args.verificationMethod)
        throw new Error(
          "Verify the full payout instructions with an independent trusted contact or portal before approving",
        );
      assertValidAddress(change.proposed.walletAddress);
      validateSavedPayoutInstructions(change.proposed);
      const others = await ctx.db
        .query("beneficiaries")
        .withIndex("by_org", (q) => q.eq("orgId", change.orgId))
        .collect();
      if (
        others.some(
          (b) =>
            b._id !== recipient._id &&
            b.walletAddress.toLowerCase() ===
              change.proposed.walletAddress.toLowerCase(),
        )
      )
        throw new Error("Another recipient already uses this address");
      await ctx.db.patch(recipient._id, {
        ...change.proposed,
        preferredToken: change.proposed.preferredToken,
        preferredChainId: change.proposed.preferredChainId,
        payoutVersion: change.baseVersion + 1,
        payoutReviewStatus: "approved",
        payoutReviewedAt: Date.now(),
        payoutReviewedBy: user._id,
        pendingPayoutChangeId: undefined,
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.screening.screenBeneficiary, {
        beneficiaryId: recipient._id,
        orgId: change.orgId,
        sessionToken: args.sessionToken,
      });
    } else {
      await ctx.db.patch(recipient._id, {
        pendingPayoutChangeId: undefined,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(change._id, {
      status: args.decision,
      reviewedBy: user._id,
      reviewedAt: Date.now(),
      reason,
      verificationMethod:
        args.decision === "approved" ? args.verificationMethod : undefined,
    });
    await appendAudit(ctx, {
      orgId: change.orgId,
      actorUserId: user._id,
      action: `beneficiary.payout_${args.decision}`,
      objectType: "beneficiary",
      objectId: recipient._id,
      metadata: {
        changeId: change._id,
        reason,
        method: args.verificationMethod,
        payoutVersion:
          args.decision === "approved"
            ? change.baseVersion + 1
            : change.baseVersion,
        independentReviewer: user._id !== change.requestedBy,
      },
    });
    return { success: true };
  },
});

export const withdraw = mutation({
  args: {
    changeId: v.id("recipientChanges"),
    sessionToken: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const change = await ctx.db.get(args.changeId);
    if (!change) throw new Error("Payout review not found");
    const { user, membership } = await requireOrgAccess(
      ctx,
      change.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator", "clerk"],
    );
    if (change.requestedBy !== user._id && membership.role !== "admin")
      throw new Error(
        "Only the requester or an admin can withdraw this review",
      );
    const recipient = await ctx.db.get(change.beneficiaryId);
    if (
      !recipient ||
      recipient.pendingPayoutChangeId !== change._id ||
      change.status !== "pending"
    )
      throw new Error("This review is no longer current");
    const reason = args.reason.trim();
    if (reason.length < 10 || reason.length > 1000)
      throw new Error(
        "Record why this request is being withdrawn (10 to 1,000 characters)",
      );
    await ctx.db.patch(change._id, {
      status: "withdrawn",
      reviewedBy: user._id,
      reviewedAt: Date.now(),
      reason,
    });
    await ctx.db.patch(recipient._id, {
      pendingPayoutChangeId: undefined,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: change.orgId,
      actorUserId: user._id,
      action: "beneficiary.payout_review_withdrawn",
      objectType: "beneficiary",
      objectId: recipient._id,
      metadata: { changeId: change._id, reason },
    });
  },
});
