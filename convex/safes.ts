import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";

// Link a Safe to an org
export const link = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    safeAddress: v.string(),
    chainId: v.number(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Only admin can link safes
    const { user } = await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin"]);

    // Check if safe already linked to this org
    const existing = await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (existing) {
      throw new Error("This organization already has a linked Safe");
    }

    const safeId = await ctx.db.insert("safes", {
      orgId: args.orgId,
      chainId: args.chainId,
      safeAddress: args.safeAddress.toLowerCase(),
      createdAt: now,
    });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "safe.linked",
      objectType: "safe",
      objectId: safeId,
      metadata: { safeAddress: args.safeAddress, chainId: args.chainId },
      timestamp: now,
    });

    return { safeId };
  },
});

// Get Safe for an org
export const getForOrg = query({
  args: { 
    orgId: v.id("orgs"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Any member can view the safe
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    return await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
  },
});

// Unlink a Safe from an org
export const unlink = mutation({
  args: {
    safeId: v.id("safes"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    const safe = await ctx.db.get(args.safeId);
    if (!safe) {
      throw new Error("Safe not found");
    }

    // Only admin can unlink safes
    const { user } = await requireOrgAccess(ctx, safe.orgId, walletAddress, ["admin"]);

    await ctx.db.delete(args.safeId);

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: safe.orgId,
      actorUserId: user._id,
      action: "safe.unlinked",
      objectType: "safe",
      objectId: args.safeId,
      metadata: { safeAddress: safe.safeAddress },
      timestamp: now,
    });

    return { success: true };
  },
});
