import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import { Id } from "./_generated/dataModel";

export const getLatestForSafe = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    safeId: v.id("safes"),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    const safe = await ctx.db.get(args.safeId);
    if (!safe || safe.orgId !== args.orgId) {
      throw new Error("Safe not found");
    }

    const latest = await ctx.db
      .query("deposits")
      .withIndex("by_safe_time", (q) => q.eq("safeId", args.safeId))
      .order("desc")
      .first();

    return latest?.timestamp ?? null;
  },
});

export const getSyncForSafe = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    safeId: v.id("safes"),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    const safe = await ctx.db.get(args.safeId);
    if (!safe || safe.orgId !== args.orgId) {
      throw new Error("Safe not found");
    }

    const sync = await ctx.db
      .query("depositSyncs")
      .withIndex("by_safe", (q) => q.eq("safeId", args.safeId))
      .first();

    return sync?.lastSyncedAt ?? null;
  },
});

export const upsertSyncForSafe = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    safeId: v.id("safes"),
    chainId: v.number(),
    lastSyncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    const existing = await ctx.db
      .query("depositSyncs")
      .withIndex("by_safe", (q) => q.eq("safeId", args.safeId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSyncedAt: args.lastSyncedAt,
      });
      return { updated: true };
    }

    await ctx.db.insert("depositSyncs", {
      orgId: args.orgId,
      safeId: args.safeId,
      chainId: args.chainId,
      lastSyncedAt: args.lastSyncedAt,
    });

    return { updated: true };
  },
});

export const upsertDeposit = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    safeId: v.id("safes"),
    chainId: v.number(),
    safeAddress: v.string(),
    tokenAddress: v.string(),
    tokenSymbol: v.string(),
    decimals: v.number(),
    amountRaw: v.string(),
    amount: v.string(),
    txHash: v.string(),
    blockNumber: v.optional(v.number()),
    timestamp: v.number(),
    fromAddress: v.optional(v.string()),
    toAddress: v.string(),
    source: v.literal("safe_tx_service"),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    const existing = await ctx.db
      .query("deposits")
      .withIndex("by_tx", (q) =>
        q
          .eq("chainId", args.chainId)
          .eq("txHash", args.txHash)
          .eq("tokenAddress", args.tokenAddress)
          .eq("toAddress", args.toAddress)
      )
      .first();

    if (existing) {
      return { inserted: false };
    }

    await ctx.db.insert("deposits", {
      orgId: args.orgId,
      safeId: args.safeId,
      chainId: args.chainId,
      safeAddress: args.safeAddress,
      tokenAddress: args.tokenAddress,
      tokenSymbol: args.tokenSymbol,
      decimals: args.decimals,
      amountRaw: args.amountRaw,
      amount: args.amount,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      timestamp: args.timestamp,
      fromAddress: args.fromAddress,
      toAddress: args.toAddress,
      source: args.source,
      createdAt: Date.now(),
    });

    return { inserted: true };
  },
});
