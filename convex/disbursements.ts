import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";

// List disbursements for an org with filtering, searching, sorting, and pagination
export const list = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    // Filtering
    status: v.optional(v.array(v.string())), // Now supports multiple statuses
    token: v.optional(v.string()),
    // Date range
    dateFrom: v.optional(v.number()), // timestamp
    dateTo: v.optional(v.number()), // timestamp
    // Search
    search: v.optional(v.string()),
    // Sorting
    sortBy: v.optional(v.union(
      v.literal("createdAt"),
      v.literal("amount"),
      v.literal("status")
    )),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    // Pagination
    cursor: v.optional(v.string()), // Last item ID from previous page
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const limit = args.limit ?? 20;
    const sortBy = args.sortBy ?? "createdAt";
    const sortOrder = args.sortOrder ?? "desc";

    // Any member can view
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    // Fetch all disbursements for the org (we need to filter in memory for search)
    const allDisbursements = await ctx.db
      .query("disbursements")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    // Enrich with beneficiary data first (needed for search)
    const enriched = await Promise.all(
      allDisbursements.map(async (d) => {
        const beneficiary = await ctx.db.get(d.beneficiaryId);
        return {
          ...d,
          beneficiary: beneficiary
            ? { name: beneficiary.name, walletAddress: beneficiary.walletAddress }
            : null,
        };
      })
    );

    // Apply filters
    let filtered = enriched;

    // Status filter (supports multiple statuses)
    if (args.status && args.status.length > 0) {
      filtered = filtered.filter((d) => args.status!.includes(d.status));
    }

    // Token filter
    if (args.token) {
      filtered = filtered.filter((d) => d.token === args.token);
    }

    // Date range filter
    if (args.dateFrom) {
      filtered = filtered.filter((d) => d.createdAt >= args.dateFrom!);
    }
    if (args.dateTo) {
      // Add one day to include the end date fully
      const endOfDay = args.dateTo + 24 * 60 * 60 * 1000;
      filtered = filtered.filter((d) => d.createdAt <= endOfDay);
    }

    // Search filter (beneficiary name or memo)
    if (args.search && args.search.trim()) {
      const searchLower = args.search.toLowerCase().trim();
      filtered = filtered.filter((d) => {
        const beneficiaryMatch = d.beneficiary?.name?.toLowerCase().includes(searchLower);
        const memoMatch = d.memo?.toLowerCase().includes(searchLower);
        const amountMatch = d.amount.includes(searchLower);
        return beneficiaryMatch || memoMatch || amountMatch;
      });
    }

    // Sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "createdAt":
          comparison = a.createdAt - b.createdAt;
          break;
        case "amount":
          comparison = parseFloat(a.amount) - parseFloat(b.amount);
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
      }
      return sortOrder === "desc" ? -comparison : comparison;
    });

    // Get total count before pagination
    const totalCount = filtered.length;

    // Cursor-based pagination
    let startIndex = 0;
    if (args.cursor) {
      const cursorIndex = filtered.findIndex((d) => d._id === args.cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    // Slice for current page
    const page = filtered.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < totalCount;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]._id : null;

    return {
      items: page,
      totalCount,
      hasMore,
      nextCursor,
    };
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
