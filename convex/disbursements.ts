import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { internal } from "./_generated/api";

// List disbursements for an org with filtering, searching, sorting, and pagination
export const list = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    // Filtering
    status: v.optional(v.array(v.string())),
    token: v.optional(v.string()),
    chainId: v.optional(v.number()),
    // Date range
    dateFrom: v.optional(v.number()), // timestamp
    dateTo: v.optional(v.number()), // timestamp
    // Search
    search: v.optional(v.string()),
    // Sorting
    sortBy: v.optional(v.union(
      v.literal("createdAt"),
      v.literal("amount"),
      v.literal("status"),
      v.literal("scheduledAt")
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
        // For batch disbursements, get first beneficiary name and count
        if (d.type === "batch") {
          const recipients = await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) => q.eq("disbursementId", d._id))
            .collect();
          
          // Get all beneficiary names and objects for search
          const recipientNames: string[] = [];
          const recipientBeneficiaries: Array<{ recipient: typeof recipients[0]; beneficiary: NonNullable<Awaited<ReturnType<typeof ctx.db.get<"beneficiaries">>>> }> = [];
          
          for (const recipient of recipients) {
            const beneficiary = await ctx.db.get(recipient.beneficiaryId);
            if (beneficiary) {
              recipientNames.push(beneficiary.name);
              recipientBeneficiaries.push({ recipient, beneficiary });
            }
          }
          
          let batchDisplayName = "Batch";
          if (recipients.length > 0) {
            // Check if there's a search term and find matching recipient
            const searchLower = args.search?.toLowerCase().trim();
            let displayBeneficiary = recipientBeneficiaries[0]?.beneficiary;
            let otherCount = recipients.length - 1;
            
            if (searchLower) {
              // Find first recipient whose name matches the search
              const matchingIndex = recipientBeneficiaries.findIndex((rb) =>
                rb.beneficiary.name.toLowerCase().includes(searchLower)
              );
              
              if (matchingIndex !== -1) {
                // Use the matching recipient for display
                displayBeneficiary = recipientBeneficiaries[matchingIndex].beneficiary;
                otherCount = recipients.length - 1; // Count of others (excluding the matched one)
              }
            }
            
            if (displayBeneficiary) {
              if (otherCount > 0) {
                batchDisplayName = `${displayBeneficiary.name} +${otherCount}`;
              } else {
                batchDisplayName = displayBeneficiary.name;
              }
            }
          }
          
          return {
            ...d,
            beneficiary: { name: batchDisplayName, walletAddress: "" },
            // Store all recipient names for search
            recipientNames,
            // Use totalAmount for batch, amount for single
            displayAmount: d.totalAmount || d.amount || "0",
          };
        }

        // For single disbursements, get beneficiary
        const beneficiary = d.beneficiaryId ? await ctx.db.get(d.beneficiaryId) : null;
        return {
          ...d,
          beneficiary: beneficiary
            ? { name: beneficiary.name, walletAddress: beneficiary.walletAddress }
            : null,
          recipientNames: [],
          displayAmount: d.amount || "0",
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

    // Chain filter
    if (args.chainId !== undefined) {
      filtered = filtered.filter((d) => d.chainId === args.chainId);
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
        // For batch disbursements, also search through all recipient names
        const recipientMatch = (d as { recipientNames?: string[] }).recipientNames?.some((name: string) => 
          name.toLowerCase().includes(searchLower)
        );
        const memoMatch = d.memo?.toLowerCase().includes(searchLower);
        const amountMatch = (d.displayAmount || d.amount || "").includes(searchLower);
        return beneficiaryMatch || recipientMatch || memoMatch || amountMatch;
      });
    }

    // Sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "createdAt":
          comparison = a.createdAt - b.createdAt;
          break;
        case "amount": {
          const aAmount = parseFloat(a.displayAmount || a.amount || "0");
          const bAmount = parseFloat(b.displayAmount || b.amount || "0");
          comparison = aAmount - bAmount;
          break;
        }
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
        case "scheduledAt": {
          const aScheduled = a.scheduledAt;
          const bScheduled = b.scheduledAt;
          const aNull = aScheduled == null;
          const bNull = bScheduled == null;
          if (aNull && bNull) return 0;
          if (aNull) return 1;
          if (bNull) return -1;
          comparison = aScheduled - bScheduled;
          break;
        }
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
    chainId: v.number(),
    beneficiaryId: v.id("beneficiaries"),
    token: v.string(),
    amount: v.string(),
    memo: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    const { user } = await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator"]);

    // Get safe for org on this chain
    const safe = await ctx.db
      .query("safes")
      .withIndex("by_org_chain", (q) =>
        q.eq("orgId", args.orgId).eq("chainId", args.chainId)
      )
      .first();

    if (!safe) {
      throw new Error("No Safe linked for this chain");
    }

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
      chainId: args.chainId,
      beneficiaryId: args.beneficiaryId,
      token: args.token,
      amount: args.amount,
      memo: args.memo,
      scheduledAt: args.scheduledAt,
      type: "single",
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
      v.literal("scheduled"),
      v.literal("relaying"),
      v.literal("executed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    safeTxHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
    relayTaskId: v.optional(v.string()),
    relayStatus: v.optional(v.string()),
    relayFeeToken: v.optional(v.string()),
    relayFeeTokenSymbol: v.optional(v.string()),
    relayFeeMode: v.optional(v.union(
      v.literal("stablecoin_preferred"),
      v.literal("stablecoin_only")
    )),
    relayError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) {
      throw new Error("Disbursement not found");
    }

    // Admin or initiator can update status
    const { user } = await requireOrgAccess(ctx, disbursement.orgId, walletAddress, ["admin","approver", "initiator"]);

    // SDN screening check when moving to pending/proposed
    if (args.status === "pending" || args.status === "proposed") {
      const org = await ctx.db.get(disbursement.orgId);
      const enforcement = org?.screeningEnforcement ?? "off";

      if (enforcement === "block") {
        // Collect beneficiary IDs
        const beneficiaryIds: string[] = [];
        if (disbursement.type === "batch") {
          const recipients = await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) => q.eq("disbursementId", args.disbursementId))
            .collect();
          for (const r of recipients) {
            beneficiaryIds.push(r.beneficiaryId);
          }
        } else if (disbursement.beneficiaryId) {
          beneficiaryIds.push(disbursement.beneficiaryId);
        }

        // Check screening results
        for (const beneficiaryId of beneficiaryIds) {
          const result = await ctx.db
            .query("screeningResults")
            .filter((q) => q.eq(q.field("beneficiaryId"), beneficiaryId))
            .first();

          if (result && (result.status === "potential_match" || result.status === "confirmed_match")) {
            const flaggedBeneficiary = await ctx.db.get(result.beneficiaryId);
            throw new Error(
              `Disbursement blocked: beneficiary "${flaggedBeneficiary?.name ?? "Unknown"}" has an unresolved SDN screening match. An admin must review the screening result before proceeding.`
            );
          }
        }
      }
    }

    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: now,
    };

    if (args.safeTxHash) updates.safeTxHash = args.safeTxHash;
    if (args.txHash) updates.txHash = args.txHash;
    if (args.relayTaskId) updates.relayTaskId = args.relayTaskId;
    if (args.relayStatus) updates.relayStatus = args.relayStatus;
    if (args.relayFeeToken) updates.relayFeeToken = args.relayFeeToken;
    if (args.relayFeeTokenSymbol) updates.relayFeeTokenSymbol = args.relayFeeTokenSymbol;
    if (args.relayFeeMode) updates.relayFeeMode = args.relayFeeMode;
    if (args.relayError) updates.relayError = args.relayError;
    if (args.status === "cancelled") {
      updates.scheduledVersion = (disbursement.scheduledVersion ?? 0) + 1;
    }

    if (args.relayTaskId || args.relayStatus || args.relayError) {
      console.info("[Relay] Disbursement status update", {
        disbursementId: args.disbursementId,
        status: args.status,
        relayTaskId: args.relayTaskId,
        relayStatus: args.relayStatus,
        relayError: args.relayError,
      });
    }

    await ctx.db.patch(args.disbursementId, updates);

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: disbursement.orgId,
      actorUserId: user._id,
      action: `disbursement.${args.status}`,
      objectType: "disbursement",
      objectId: args.disbursementId,
      metadata: {
        status: args.status,
        safeTxHash: args.safeTxHash,
        txHash: args.txHash,
        relayTaskId: args.relayTaskId,
        relayStatus: args.relayStatus,
        relayFeeToken: args.relayFeeToken,
        relayFeeTokenSymbol: args.relayFeeTokenSymbol,
        relayFeeMode: args.relayFeeMode,
        relayError: args.relayError,
      },
      timestamp: now,
    });

    return { success: true };
  },
});

// Internal query for scheduled relay jobs
export const getInternal = internalQuery({
  args: { disbursementId: v.id("disbursements") },
  handler: async (ctx, args) => {
    const d = await ctx.db.get(args.disbursementId);
    if (!d) return null;
    const safe = await ctx.db.get(d.safeId);
    return { ...d, safeAddress: safe?.safeAddress ?? null };
  },
});

// Internal status update without RBAC (used by scheduled relay)
export const updateStatusInternal = internalMutation({
  args: {
    disbursementId: v.id("disbursements"),
    status: v.union(v.literal("relaying"), v.literal("failed"), v.literal("cancelled")),
    relayTaskId: v.optional(v.string()),
    relayStatus: v.optional(v.string()),
    relayError: v.optional(v.string()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const updates: Record<string, unknown> = { status: args.status, updatedAt: now };
    if (args.relayTaskId) updates.relayTaskId = args.relayTaskId;
    if (args.relayStatus) updates.relayStatus = args.relayStatus;
    if (args.relayError) updates.relayError = args.relayError;
    if (args.txHash) updates.txHash = args.txHash;

    const disbursement = await ctx.db.get(args.disbursementId);
    if (args.status === "cancelled") {
      updates.scheduledVersion = (disbursement?.scheduledVersion ?? 0) + 1;
    }

    await ctx.db.patch(args.disbursementId, updates);

    if (disbursement) {
      await ctx.db.insert("auditLog", {
        orgId: disbursement.orgId,
        actorUserId: disbursement.createdBy,
        action: `disbursement.${args.status}`,
        objectType: "disbursement",
        objectId: args.disbursementId,
        metadata: {
          status: args.status,
          source: "scheduled_relay",
          relayTaskId: args.relayTaskId,
          relayError: args.relayError,
        },
        timestamp: now,
      });
    }
    return { success: true };
  },
});

// Schedule a disbursement to relay at a future time
export const schedule = mutation({
  args: {
    disbursementId: v.id("disbursements"),
    walletAddress: v.string(),
    scheduledAt: v.number(),
    safeTxHash: v.string(),
    relayFeeToken: v.optional(v.string()),
    relayFeeTokenSymbol: v.optional(v.string()),
    relayFeeMode: v.optional(v.union(v.literal("stablecoin_preferred"), v.literal("stablecoin_only"))),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();
    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) throw new Error("Disbursement not found");

    const { user } = await requireOrgAccess(ctx, disbursement.orgId, walletAddress, ["admin", "approver", "initiator"]);

    const scheduledVersion = (disbursement.scheduledVersion ?? 0) + 1;

    await ctx.db.patch(args.disbursementId, {
      status: "scheduled",
      scheduledAt: args.scheduledAt,
      scheduledJobId: `sched_${args.disbursementId}_${scheduledVersion}`,
      scheduledVersion,
      safeTxHash: args.safeTxHash,
      relayFeeToken: args.relayFeeToken,
      relayFeeTokenSymbol: args.relayFeeTokenSymbol,
      relayFeeMode: args.relayFeeMode,
      updatedAt: now,
    });

    await ctx.scheduler.runAt(args.scheduledAt, internal.relay.fireScheduledRelay, {
      disbursementId: args.disbursementId,
      scheduledVersion,
    });

    await ctx.db.insert("auditLog", {
      orgId: disbursement.orgId,
      actorUserId: user._id,
      action: "disbursement.scheduled",
      objectType: "disbursement",
      objectId: args.disbursementId,
      metadata: { scheduledAt: args.scheduledAt, scheduledVersion },
      timestamp: now,
    });

    return { success: true };
  },
});

// Reschedule an existing scheduled disbursement
export const reschedule = mutation({
  args: {
    disbursementId: v.id("disbursements"),
    walletAddress: v.string(),
    newScheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();
    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) throw new Error("Disbursement not found");
    if (disbursement.status !== "scheduled") {
      throw new Error("Only scheduled disbursements can be rescheduled");
    }

    const { user } = await requireOrgAccess(ctx, disbursement.orgId, walletAddress, ["admin", "approver", "initiator"]);

    const scheduledVersion = (disbursement.scheduledVersion ?? 0) + 1;

    await ctx.db.patch(args.disbursementId, {
      scheduledAt: args.newScheduledAt,
      scheduledJobId: `sched_${args.disbursementId}_${scheduledVersion}`,
      scheduledVersion,
      updatedAt: now,
    });

    await ctx.scheduler.runAt(args.newScheduledAt, internal.relay.fireScheduledRelay, {
      disbursementId: args.disbursementId,
      scheduledVersion,
    });

    await ctx.db.insert("auditLog", {
      orgId: disbursement.orgId,
      actorUserId: user._id,
      action: "disbursement.rescheduled",
      objectType: "disbursement",
      objectId: args.disbursementId,
      metadata: {
        previousScheduledAt: disbursement.scheduledAt,
        newScheduledAt: args.newScheduledAt,
        scheduledVersion,
      },
      timestamp: now,
    });

    return { success: true };
  },
});

// Create a batch disbursement draft
export const createBatch = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    chainId: v.number(),
    token: v.string(),
    recipients: v.array(
      v.object({
        beneficiaryId: v.id("beneficiaries"),
        amount: v.string(),
      })
    ),
    memo: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    const { user } = await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator"]);

    // Validate at least 1 recipient
    if (args.recipients.length === 0) {
      throw new Error("At least one recipient is required");
    }

    // Validate unique beneficiaries
    const beneficiaryIds = args.recipients.map((r) => r.beneficiaryId);
    const uniqueIds = new Set(beneficiaryIds);
    if (uniqueIds.size !== beneficiaryIds.length) {
      throw new Error("Duplicate beneficiaries are not allowed");
    }

    // Get safe for org on this chain
    const safe = await ctx.db
      .query("safes")
      .withIndex("by_org_chain", (q) =>
        q.eq("orgId", args.orgId).eq("chainId", args.chainId)
      )
      .first();

    if (!safe) {
      throw new Error("No Safe linked for this chain");
    }

    // Validate all beneficiaries and calculate total
    let totalAmount = 0;
    const recipientData: Array<{
      beneficiaryId: Id<"beneficiaries">;
      recipientAddress: string;
      amount: string;
    }> = [];

    for (const recipient of args.recipients) {
      // Verify beneficiary exists and belongs to org
      const beneficiary = await ctx.db.get(recipient.beneficiaryId);
      if (!beneficiary || beneficiary.orgId !== args.orgId) {
        throw new Error(`Invalid beneficiary: ${recipient.beneficiaryId}`);
      }

      if (!beneficiary.isActive) {
        throw new Error(`Beneficiary is not active: ${beneficiary.name}`);
      }

      // Validate amount is positive
      const amountNum = parseFloat(recipient.amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error(`Invalid amount for beneficiary: ${beneficiary.name}`);
      }

      totalAmount += amountNum;
      recipientData.push({
        beneficiaryId: recipient.beneficiaryId,
        recipientAddress: beneficiary.walletAddress,
        amount: recipient.amount,
      });
    }

    // Create disbursement record
    const disbursementId = await ctx.db.insert("disbursements", {
      orgId: args.orgId,
      safeId: safe._id,
      chainId: args.chainId,
      type: "batch",
      token: args.token,
      totalAmount: totalAmount.toString(),
      memo: args.memo,
      scheduledAt: args.scheduledAt,
      status: "draft",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    // Create recipient records
    for (const recipient of recipientData) {
      await ctx.db.insert("disbursementRecipients", {
        disbursementId,
        beneficiaryId: recipient.beneficiaryId,
        recipientAddress: recipient.recipientAddress,
        amount: recipient.amount,
        createdAt: now,
      });
    }

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "disbursement.created",
      objectType: "disbursement",
      objectId: disbursementId,
      metadata: {
        type: "batch",
        token: args.token,
        totalAmount: totalAmount.toString(),
        recipientCount: args.recipients.length,
      },
      timestamp: now,
    });

    return { disbursementId };
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

    const beneficiary = disbursement.beneficiaryId
      ? await ctx.db.get(disbursement.beneficiaryId)
      : null;

    return {
      ...disbursement,
      beneficiary: beneficiary
        ? { name: beneficiary.name, walletAddress: beneficiary.walletAddress }
        : null,
    };
  },
});

// Get disbursement with recipients (for batch disbursements)
export const getWithRecipients = query({
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

    // Get single beneficiary if it's a single disbursement
    const beneficiary = disbursement.beneficiaryId
      ? await ctx.db.get(disbursement.beneficiaryId)
      : null;

    // Get recipients if it's a batch disbursement
    const recipients =
      disbursement.type === "batch"
        ? await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) => q.eq("disbursementId", args.disbursementId))
            .collect()
        : [];

    // Enrich recipients with beneficiary data
    const enrichedRecipients = await Promise.all(
      recipients.map(async (r) => {
        const beneficiary = await ctx.db.get(r.beneficiaryId);
        return {
          ...r,
          beneficiary: beneficiary
            ? { name: beneficiary.name, walletAddress: beneficiary.walletAddress }
            : null,
        };
      })
    );

    return {
      ...disbursement,
      beneficiary: beneficiary
        ? { name: beneficiary.name, walletAddress: beneficiary.walletAddress }
        : null,
      recipients: enrichedRecipients,
    };
  },
});
