import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";

// Get billing info for an org
export const get = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Any member can view billing
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (!billing) {
      return null;
    }

    // Calculate days remaining
    const now = Date.now();
    let daysRemaining = 0;
    let isActive = false;

    if (billing.status === "trial" && billing.trialEndsAt) {
      daysRemaining = Math.max(0, Math.ceil((billing.trialEndsAt - now) / (24 * 60 * 60 * 1000)));
      isActive = daysRemaining > 0;
    } else if (billing.status === "active" && billing.paidThroughAt) {
      daysRemaining = Math.max(0, Math.ceil((billing.paidThroughAt - now) / (24 * 60 * 60 * 1000)));
      isActive = daysRemaining > 0;
    }

    return {
      ...billing,
      daysRemaining,
      isActive,
    };
  },
});

// Upgrade to pro (after payment confirmed)
export const upgradeToPro = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    txHash: v.string(),
    paidThroughAt: v.number(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Only admin can upgrade
    const { user } = await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin"]);

    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (!billing) {
      throw new Error("Billing record not found");
    }

    await ctx.db.patch(billing._id, {
      plan: "pro",
      status: "active",
      paidThroughAt: args.paidThroughAt,
      updatedAt: now,
    });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "billing.upgraded",
      objectType: "billing",
      objectId: billing._id,
      metadata: { txHash: args.txHash, paidThroughAt: args.paidThroughAt },
      timestamp: now,
    });

    return { success: true };
  },
});

// Check if org has active subscription
export const isActive = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, args) => {
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (!billing) {
      return false;
    }

    const now = Date.now();

    if (billing.status === "trial" && billing.trialEndsAt) {
      return now < billing.trialEndsAt;
    }

    if (billing.status === "active" && billing.paidThroughAt) {
      return now < billing.paidThroughAt;
    }

    return false;
  },
});
