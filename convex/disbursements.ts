import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";

// List disbursements for an org
export const list = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Any member can view
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    let query = ctx.db
      .query("disbursements")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .order("desc");

    const disbursements = await query.collect();

    // Filter by status if provided
    let filtered = disbursements;
    if (args.status) {
      filtered = disbursements.filter((d) => d.status === args.status);
    }

    // Apply limit
    if (args.limit) {
      filtered = filtered.slice(0, args.limit);
    }

    // Enrich with beneficiary data
    const enriched = await Promise.all(
      filtered.map(async (d) => {
        const beneficiary = await ctx.db.get(d.beneficiaryId);
        return {
          ...d,
          beneficiary: beneficiary
            ? { name: beneficiary.name, walletAddress: beneficiary.walletAddress }
            : null,
        };
      })
    );

    return enriched;
  },
});

// Create a disbursement draft
export const create = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    beneficiaryId: v.id("beneficiaries"),
    token: v.string(),
    amount: v.string(),
    memo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Initiator, admin can create
    const { user } = await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "initiator"]);

    // Get safe for org
    const safe = await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (!safe) {
      throw new Error("No Safe linked to this organization");
    }

    // Verify beneficiary exists and belongs to org
    const beneficiary = await ctx.db.get(args.beneficiaryId);
    if (!beneficiary || beneficiary.orgId !== args.orgId) {
      throw new Error("Invalid beneficiary");
    }

    if (!beneficiary.isActive) {
      throw new Error("Beneficiary is not active");
    }

    const disbursementId = await ctx.db.insert("disbursements", {
      orgId: args.orgId,
      safeId: safe._id,
      beneficiaryId: args.beneficiaryId,
      token: args.token,
      amount: args.amount,
      memo: args.memo,
      status: "draft",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "disbursement.created",
      objectType: "disbursement",
      objectId: disbursementId,
      metadata: { beneficiaryId: args.beneficiaryId, token: args.token, amount: args.amount },
      timestamp: now,
    });

    return { disbursementId };
  },
});

// Update disbursement status (after Safe tx proposed/executed)
export const updateStatus = mutation({
  args: {
    disbursementId: v.id("disbursements"),
    walletAddress: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("proposed"),
      v.literal("executed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    safeTxHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) {
      throw new Error("Disbursement not found");
    }

    // Admin or initiator can update status
    const { user } = await requireOrgAccess(ctx, disbursement.orgId, walletAddress, ["admin", "initiator"]);

    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: now,
    };

    if (args.safeTxHash) updates.safeTxHash = args.safeTxHash;
    if (args.txHash) updates.txHash = args.txHash;

    await ctx.db.patch(args.disbursementId, updates);

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: disbursement.orgId,
      actorUserId: user._id,
      action: `disbursement.${args.status}`,
      objectType: "disbursement",
      objectId: args.disbursementId,
      metadata: { status: args.status, safeTxHash: args.safeTxHash, txHash: args.txHash },
      timestamp: now,
    });

    return { success: true };
  },
});

// Get single disbursement
export const get = query({
  args: {
    disbursementId: v.id("disbursements"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) {
      return null;
    }

    // Any member can view
    await requireOrgAccess(ctx, disbursement.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    const beneficiary = await ctx.db.get(disbursement.beneficiaryId);

    return {
      ...disbursement,
      beneficiary: beneficiary
        ? { name: beneficiary.name, walletAddress: beneficiary.walletAddress }
        : null,
    };
  },
});
