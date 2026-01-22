import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import { Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";

// Plan types
export type PlanType = "trial" | "starter" | "team" | "pro";

// Tier limits configuration
export const PLAN_LIMITS = {
  trial: {
    maxUsers: 5, // Same as Team tier during trial
    maxBeneficiaries: 100,
    price: 0,
  },
  starter: {
    maxUsers: 1,
    maxBeneficiaries: 25,
    price: 25,
  },
  team: {
    maxUsers: 5,
    maxBeneficiaries: 100,
    price: 50,
  },
  pro: {
    maxUsers: Infinity,
    maxBeneficiaries: Infinity,
    price: 99,
  },
} as const;

// Helper to get tier limits for an org
export async function getOrgLimits(ctx: QueryCtx, orgId: Id<"orgs">) {
  const billing = await ctx.db
    .query("billing")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();

  if (!billing) {
    return PLAN_LIMITS.trial;
  }

  // Check if trial/subscription is still active
  const now = Date.now();
  if (billing.status === "trial" && billing.trialEndsAt && now > billing.trialEndsAt) {
    // Trial expired - return most restrictive limits
    return { maxUsers: 0, maxBeneficiaries: 0, price: 0 };
  }
  if (billing.status === "active" && billing.paidThroughAt && now > billing.paidThroughAt) {
    // Subscription expired - return most restrictive limits
    return { maxUsers: 0, maxBeneficiaries: 0, price: 0 };
  }

  return PLAN_LIMITS[billing.plan] || PLAN_LIMITS.trial;
}

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

    // Get limits for current plan
    const limits = PLAN_LIMITS[billing.plan] || PLAN_LIMITS.trial;

    return {
      ...billing,
      daysRemaining,
      isActive,
      limits,
    };
  },
});

// Subscribe to a plan (generic mutation for all plans)
export const subscribe = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    plan: v.union(
      v.literal("starter"),
      v.literal("team"),
      v.literal("pro")
    ),
    txHash: v.string(),
    paidThroughAt: v.number(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Only admin can change subscription
    const { user } = await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin"]);

    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (!billing) {
      throw new Error("Billing record not found");
    }

    const previousPlan = billing.plan;

    await ctx.db.patch(billing._id, {
      plan: args.plan,
      status: "active",
      paidThroughAt: args.paidThroughAt,
      updatedAt: now,
    });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "billing.subscribed",
      objectType: "billing",
      objectId: billing._id,
      metadata: { 
        previousPlan,
        newPlan: args.plan, 
        txHash: args.txHash, 
        paidThroughAt: args.paidThroughAt,
        price: PLAN_LIMITS[args.plan].price,
      },
      timestamp: now,
    });

    return { success: true };
  },
});

// Legacy: Upgrade to pro (kept for backward compatibility)
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

// Get plan limits (for frontend display)
export const getPlanLimits = query({
  args: {},
  handler: async () => {
    return PLAN_LIMITS;
  },
});
