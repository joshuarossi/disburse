import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";

// Link a Safe to an org (one row per chain; same safeAddress required across chains for one org)
export const link = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    safeAddress: v.string(),
    chainId: v.number(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const safeAddressLower = args.safeAddress.toLowerCase();
    const now = Date.now();

    // Only admin can link safes
    const { user } = await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin"]);

    // Check if this chain is already linked for this org
    const existingForChain = await ctx.db
      .query("safes")
      .withIndex("by_org_chain", (q) =>
        q.eq("orgId", args.orgId).eq("chainId", args.chainId)
      )
      .first();

    if (existingForChain) {
      throw new Error("Safe already linked for this chain");
    }

    // If org has any other safe rows, require the same address (one Safe address per org)
    const existingAny = await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (existingAny && existingAny.safeAddress !== safeAddressLower) {
      throw new Error(
        `Your Safe address must be the same across all chains. You already have ${existingAny.safeAddress} linked.`
      );
    }

    const safeId = await ctx.db.insert("safes", {
      orgId: args.orgId,
      chainId: args.chainId,
      safeAddress: safeAddressLower,
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

// Get all Safe rows for an org (one per linked chain; same address across rows)
export const getForOrg = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    return await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

// Get Safe for an org on a specific chain
export const getForOrgAndChain = query({
  args: {
    orgId: v.id("orgs"),
    chainId: v.number(),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    return await ctx.db
      .query("safes")
      .withIndex("by_org_chain", (q) =>
        q.eq("orgId", args.orgId).eq("chainId", args.chainId)
      )
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
