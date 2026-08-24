import { appendAudit } from "./audit";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { assertValidAddress, assertValidAmount, assertValidTxHash, amountToBaseUnits, formatBaseUnits } from "./lib/validation";
import { internal } from "./_generated/api";

type DisbursementStatus =
  | "draft"
  | "pending"
  | "proposed"
  | "scheduled"
  | "relaying"
  | "executed"
  | "failed"
  | "cancelled";

// List disbursements for an org with filtering, searching, sorting, and pagination
export const list = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
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
    const limit = args.limit ?? 20;
    const sortBy = args.sortBy ?? "createdAt";
    const sortOrder = args.sortOrder ?? "desc";
    const searchLower = args.search?.toLowerCase().trim() || null;

    // Any member can view
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin", "approver", "initiator", "clerk", "viewer"]);

    // ── Candidate fetch (M-01: index pushdown for single-status filters)
    const statusList = args.status && args.status.length > 0 ? args.status : null;
    let candidates;
    if (statusList && statusList.length === 1) {
      candidates = await ctx.db
        .query("disbursements")
        .withIndex("by_org_status", (q) =>
          q.eq("orgId", args.orgId).eq("status", statusList[0] as DisbursementStatus)
        )
        .collect();
    } else {
      candidates = await ctx.db
        .query("disbursements")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect();
      if (statusList) {
        candidates = candidates.filter((d) => statusList.includes(d.status));
      }
    }

    // ── Cheap row-level filters (no joins required)
    let filtered = candidates;

    if (args.token) {
      filtered = filtered.filter((d) => d.token === args.token);
    }
    if (args.chainId !== undefined) {
      filtered = filtered.filter((d) => d.chainId === args.chainId);
    }
    if (args.dateFrom) {
      filtered = filtered.filter((d) => d.createdAt >= args.dateFrom!);
    }
    if (args.dateTo) {
      // Add one day to include the end date fully
      const endOfDay = args.dateTo + 24 * 60 * 60 * 1000;
      filtered = filtered.filter((d) => d.createdAt <= endOfDay);
    }

    // ── Lazy search: memo/amount match on row fields; name matches resolve
    // beneficiary docs on demand via a per-request cache (each doc read once).
    const beneficiaryCache = new Map<string, Awaited<ReturnType<typeof ctx.db.get<"beneficiaries">>>>();
    const fetchBeneficiary = async (id?: string) => {
      if (!id) return null;
      const cached = beneficiaryCache.get(id);
      if (cached !== undefined) return cached;
      const doc = await ctx.db.get(id as Id<"beneficiaries">);
      beneficiaryCache.set(id, doc);
      return doc;
    };

    const rowDisplayAmount = (d: typeof filtered[0]) => d.totalAmount || d.amount || "";

    if (searchLower) {
      const matched: typeof filtered = [];
      for (const d of filtered) {
        if (d.memo?.toLowerCase().includes(searchLower)) {
          matched.push(d);
          continue;
        }
        if (rowDisplayAmount(d).includes(searchLower)) {
          matched.push(d);
          continue;
        }

        if (d.type === "batch") {
          const recipients = await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) => q.eq("disbursementId", d._id))
            .collect();
          let hit = false;
          for (const r of recipients) {
            const b = await fetchBeneficiary(r.beneficiaryId);
            if (b?.name.toLowerCase().includes(searchLower)) {
              hit = true;
              break;
            }
          }
          if (hit) matched.push(d);
        } else {
          const b = await fetchBeneficiary(d.beneficiaryId ?? undefined);
          if (b?.name.toLowerCase().includes(searchLower)) matched.push(d);
        }
      }
      filtered = matched;
    }

    // ── Sorting on row fields only (displayAmount derives from the row itself)
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "createdAt":
          comparison = a.createdAt - b.createdAt;
          break;
        case "amount": {
          const aAmount = parseFloat(rowDisplayAmount(a) || "0");
          const bAmount = parseFloat(rowDisplayAmount(b) || "0");
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

    const totalCount = filtered.length;

    let startIndex = 0;
    if (args.cursor) {
      const cursorIndex = filtered.findIndex((d) => d._id === args.cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const page = filtered.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < totalCount;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]._id : null;

    // ── Enrich ONLY the returned page (≤ limit beneficiary reads / batch joins)
    const items = await Promise.all(
      page.map(async (d) => {
        if (d.type === "batch") {
          const recipients = await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) => q.eq("disbursementId", d._id))
            .collect();

          const recipientNames: string[] = [];
          const recipientBeneficiaries: Array<{ recipient: typeof recipients[0]; beneficiary: NonNullable<Awaited<ReturnType<typeof ctx.db.get<"beneficiaries">>>> }> = [];

          for (const recipient of recipients) {
            const beneficiary = await fetchBeneficiary(recipient.beneficiaryId);
            if (beneficiary) {
              recipientNames.push(beneficiary.name);
              recipientBeneficiaries.push({ recipient, beneficiary });
            }
          }

          let batchDisplayName = "Batch";
          if (recipients.length > 0) {
            let displayBeneficiary = recipientBeneficiaries[0]?.beneficiary;
            const otherCount = recipients.length - 1;

            if (searchLower) {
              // Promote the first matching recipient to the display position
              const matchingIndex = recipientBeneficiaries.findIndex((rb) =>
                rb.beneficiary.name.toLowerCase().includes(searchLower)
              );
              if (matchingIndex !== -1) {
                displayBeneficiary = recipientBeneficiaries[matchingIndex].beneficiary;
              }
            }

            if (displayBeneficiary) {
              batchDisplayName =
                otherCount > 0
                  ? `${displayBeneficiary.name} +${otherCount}`
                  : displayBeneficiary.name;
            }
          }

          return {
            ...d,
            beneficiary: { name: batchDisplayName, walletAddress: "" },
            recipientNames,
            displayAmount: d.totalAmount || d.amount || "0",
          };
        }

        const beneficiary = await fetchBeneficiary(d.beneficiaryId ?? undefined);
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

    return {
      items,
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
    sessionToken: v.string(),
    chainId: v.number(),
    beneficiaryId: v.id("beneficiaries"),
    token: v.string(),
    amount: v.string(),
    memo: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin", "approver", "initiator"]);

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

    // H-02/H-03: server-side validation of money math and destination address
    assertValidAmount(args.amount, args.token);
    assertValidAddress(beneficiary.walletAddress, "beneficiary wallet address");

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
    await appendAudit(ctx, {
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
//
// C-02 fix: enforce a strict state machine. Terminal states (executed,
// cancelled) accept no further transitions, and hash-bearing states require
// well-formed hashes so the audit trail cannot record fabricated values.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["pending", "proposed", "scheduled", "cancelled"],
  pending: ["proposed", "scheduled", "cancelled"],
  proposed: ["scheduled", "relaying", "executed", "failed", "cancelled"],
  scheduled: ["relaying", "cancelled"],
  relaying: ["executed", "failed"],
  failed: ["proposed", "scheduled", "cancelled"],
  executed: [],
  cancelled: [],
};

export const updateStatus = mutation({
  args: {
    disbursementId: v.id("disbursements"),
    sessionToken: v.string(),
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
    const now = Date.now();

    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) {
      throw new Error("Disbursement not found");
    }

    // Admin or initiator can update status
    const { user } = await requireOrgAccess(ctx, disbursement.orgId, args.sessionToken, ["admin","approver", "initiator"]);

    // C-02: validate the transition against the state machine
    const allowed = ALLOWED_TRANSITIONS[disbursement.status] ?? [];
    if (!allowed.includes(args.status)) {
      throw new Error(
        `Invalid status transition: ${disbursement.status} -> ${args.status}`
      );
    }

    // Hash integrity: proposed/scheduled require a well-formed Safe tx hash;
    // executed requires an on-chain transaction hash.
    if (
      (args.status === "proposed" || args.status === "scheduled") &&
      !disbursement.safeTxHash &&
      !args.safeTxHash
    ) {
      throw new Error(`${args.status} requires a safeTxHash`);
    }
    if (args.safeTxHash) assertValidTxHash(args.safeTxHash, "safeTxHash");
    if (args.txHash) assertValidTxHash(args.txHash, "txHash");
    if (args.status === "executed" && !disbursement.txHash && !args.txHash) {
      throw new Error("Cannot mark executed without a transaction hash");
    }

    // SDN screening check when moving to pending/proposed/scheduled
    if (args.status === "pending" || args.status === "proposed" || args.status === "scheduled") {
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
    if (args.status === "executed" && !disbursement.executedAt) {
      updates.executedAt = now;
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
    await appendAudit(ctx, {
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
      await appendAudit(ctx, {
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
    sessionToken: v.string(),
    scheduledAt: v.number(),
    safeTxHash: v.string(),
    relayFeeToken: v.optional(v.string()),
    relayFeeTokenSymbol: v.optional(v.string()),
    relayFeeMode: v.optional(v.union(v.literal("stablecoin_preferred"), v.literal("stablecoin_only"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) throw new Error("Disbursement not found");

    const { user } = await requireOrgAccess(ctx, disbursement.orgId, args.sessionToken, ["admin", "approver", "initiator"]);

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

    await appendAudit(ctx, {
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
    sessionToken: v.string(),
    newScheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) throw new Error("Disbursement not found");
    if (disbursement.status !== "scheduled") {
      throw new Error("Only scheduled disbursements can be rescheduled");
    }

    const { user } = await requireOrgAccess(ctx, disbursement.orgId, args.sessionToken, ["admin", "approver", "initiator"]);

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

    await appendAudit(ctx, {
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
    sessionToken: v.string(),
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
    const now = Date.now();

    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin", "approver", "initiator"]);

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

    // Validate all beneficiaries and calculate total in integer base units
    let totalBaseUnits = 0n;
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

      // H-02/H-03: strict amount + address validation (no float math)
      assertValidAmount(recipient.amount, args.token);
      assertValidAddress(beneficiary.walletAddress, "beneficiary wallet address");

      totalBaseUnits += amountToBaseUnits(recipient.amount, args.token);
      recipientData.push({
        beneficiaryId: recipient.beneficiaryId,
        recipientAddress: beneficiary.walletAddress,
        amount: recipient.amount,
      });
    }

    const totalAmount = formatBaseUnits(totalBaseUnits, args.token);

    // Create disbursement record
    const disbursementId = await ctx.db.insert("disbursements", {
      orgId: args.orgId,
      safeId: safe._id,
      chainId: args.chainId,
      type: "batch",
      token: args.token,
      totalAmount,
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
    await appendAudit(ctx, {
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
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {

    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) {
      return null;
    }

    // Any member can view
    await requireOrgAccess(ctx, disbursement.orgId, args.sessionToken, ["admin", "approver", "initiator", "clerk", "viewer"]);

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
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {

    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) {
      return null;
    }

    // Any member can view
    await requireOrgAccess(ctx, disbursement.orgId, args.sessionToken, ["admin", "approver", "initiator", "clerk", "viewer"]);

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
