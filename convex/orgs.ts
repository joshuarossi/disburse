import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Create a new organization
export const create = mutation({
  args: {
    name: v.string(),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Get user
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Create org
    const orgId = await ctx.db.insert("orgs", {
      name: args.name,
      createdBy: user._id,
      createdAt: now,
    });

    // Create membership for creator as admin
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: user._id,
      role: "admin",
      status: "active",
      createdAt: now,
    });

    // Create trial billing record (30 days)
    await ctx.db.insert("billing", {
      orgId,
      plan: "trial",
      trialEndsAt: now + 30 * 24 * 60 * 60 * 1000,
      status: "trial",
      createdAt: now,
      updatedAt: now,
    });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId,
      actorUserId: user._id,
      action: "org.created",
      objectType: "org",
      objectId: orgId,
      timestamp: now,
    });

    return { orgId };
  },
});

// Get orgs for a user
export const listForUser = query({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Get user
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      return [];
    }

    // Get memberships
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    // Get orgs
    const orgs = await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        return org ? { ...org, role: m.role } : null;
      })
    );

    return orgs.filter(Boolean);
  },
});

// Get single org by ID
export const get = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.orgId);
  },
});

// Update org name
export const updateName = mutation({
  args: {
    orgId: v.id("orgs"),
    name: v.string(),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Verify user has admin access
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!membership || membership.role !== "admin") {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.orgId, { name: args.name });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "org.updated",
      objectType: "org",
      objectId: args.orgId,
      metadata: { name: args.name },
      timestamp: Date.now(),
    });

    return { success: true };
  },
});
