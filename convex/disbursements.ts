import { assertCircleReservation } from './lib/circleSource';
import { submissionNeedsAttention, walletSendDeclined } from '../shared/paymentQueue';
import { resolveFundingAccount } from "./lib/fundingAccount";
import { reportPage } from './lib/reportPagination';
import { queueReportSource } from './lib/reportIndex';
import { settlementBlockValidator, assertSameSettlement } from './lib/settlementBlock';
import { environmentValidator } from "./lib/activityEnvironment";
import { configuredTokenAddress, chainEnvironment } from "../shared/assets";
import { assertApprovedRecipient } from '../shared/recipientAssurance';
import { assertRecipientVersions } from './lib/recipientReview';
import { assertMemberPaymentPolicy } from "./lib/paymentLimits";
import { appendAudit } from "./audit";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import {
  assertValidAddress,
  assertValidAmount,
  assertValidTxHash,
  amountToBaseUnits,
  formatBaseUnits,
} from "./lib/validation";
import {
  assertStatusTransition,
  assertFutureSchedule,
  assertPaymentMayProceed,
} from "./lib/disbursementPolicy";
import { internal } from "./_generated/api";
import { isUpcomingPayment, isOverdueScheduledPayment } from "../shared/paymentQueue";

// List disbursements for an org with filtering, searching, sorting, and pagination
export const list = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    environment: v.optional(environmentValidator),
    // Filtering
    type: v.optional(v.union(v.literal("single"), v.literal("batch"))),
    status: v.optional(v.array(v.string())),
    includeRelayExceptions: v.optional(v.boolean()),
    upcomingOnly: v.optional(v.boolean()),
    includeOverdueScheduled: v.optional(v.boolean()),
    recurringPaymentId: v.optional(v.id('recurringPayments')),
    token: v.optional(v.string()),
    chainId: v.optional(v.number()),
    // Date range
    dateFrom: v.optional(v.number()), // timestamp
    dateTo: v.optional(v.number()), // timestamp
    // Search
    search: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    // Pagination
    cursor: v.optional(v.string()), // Opaque database continuation cursor
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 20)));
    const sortOrder = args.sortOrder ?? "desc";
    const searchLower = args.search?.toLowerCase().trim() || null;

    // Any member can view
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    if (args.recurringPaymentId) {
      const series = await ctx.db.get(args.recurringPaymentId);
      if (!series || series.orgId !== args.orgId) throw new Error('Schedule not found in this workspace');
    }
    const statusList = args.status?.length ? args.status : null;
    // Bound each read even for sparse filters. Continuation cursors retain access
    // to all history without collecting the organization on every page load.
    const candidatePage = await ctx.db.query('disbursements')
      .withIndex('by_org_created', q => q.eq('orgId', args.orgId))
      .filter(q => q.and(
        args.recurringPaymentId ? q.eq(q.field('recurringPaymentId'), args.recurringPaymentId) : true,
        args.token ? q.eq(q.field('token'), args.token.trim().toUpperCase()) : true,
        args.chainId !== undefined ? q.eq(q.field('chainId'), args.chainId) : true,
        args.dateFrom !== undefined ? q.gte(q.field('createdAt'), args.dateFrom) : true,
        args.dateTo !== undefined ? q.lte(q.field('createdAt'), args.dateTo + 86400000) : true,
        statusList ? q.or(...statusList.map(status => q.eq(q.field('status'), status)),
          args.includeRelayExceptions ? q.eq(q.field('status'), 'relaying') : false,
          args.includeOverdueScheduled ? q.neq(q.field('scheduledAt'), undefined) : false) : true,
      ))
      .order(sortOrder)
      .paginate(reportPage(args.cursor, limit));
    const candidates = candidatePage.page.filter(d => !statusList || statusList.includes(d.status) || (args.includeRelayExceptions && submissionNeedsAttention(d)) || (args.includeOverdueScheduled && isOverdueScheduledPayment(d, Date.now())));

    // ── Cheap row-level filters (no joins required)
    let filtered = args.type
      ? candidates.filter((d) => (d.type ?? "single") === args.type)
      : candidates;

    if (args.environment) filtered = filtered.filter(d => chainEnvironment(d.chainId) === args.environment);
    if (args.token) {
      filtered = filtered.filter((d) => d.token === args.token!.trim().toUpperCase());
    }
    if (args.upcomingOnly) {
      const now = Date.now();
      filtered = filtered.filter((d) => isUpcomingPayment(d, now));
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
    const beneficiaryCache = new Map<
      string,
      Awaited<ReturnType<typeof ctx.db.get<"beneficiaries">>>
    >();
    const fetchBeneficiary = async (id?: string) => {
      if (!id) return null;
      const cached = beneficiaryCache.get(id);
      if (cached !== undefined) return cached;
      const doc = await ctx.db.get(id as Id<"beneficiaries">);
      beneficiaryCache.set(id, doc);
      return doc;
    };

    const rowDisplayAmount = (d: (typeof filtered)[0]) =>
      d.totalAmount || d.amount || "";

    if (searchLower) {
      const matched: typeof filtered = [];
      for (const d of filtered) {
        if (
          d.name?.toLowerCase().includes(searchLower) ||
          d.recipientName?.toLowerCase().includes(searchLower) ||
          d.memo?.toLowerCase().includes(searchLower)
        ) {
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

    const page = filtered;
    const hasMore = !candidatePage.isDone;
    const nextCursor = hasMore ? candidatePage.continueCursor : null;
    // A page count is not a workspace total. Only a complete first page knows it.
    const totalCount = !args.cursor && !hasMore ? page.length : null;

    // ── Enrich ONLY the returned page (≤ limit beneficiary reads / batch joins)
    const items = await Promise.all(
      page.map(async (d) => {
        const safe = await ctx.db.get(d.safeId);
        const account = safe?.orgId === args.orgId
          ? { name: safe.name, address: safe.safeAddress, archived: safe.isActive === false }
          : null;
        if (d.type === "batch") {
          const recipients = await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) => q.eq("disbursementId", d._id))
            .collect();

          const recipientNames: string[] = [];
          const recipientBeneficiaries: Array<{
            recipient: (typeof recipients)[0];
            beneficiary: NonNullable<
              Awaited<ReturnType<typeof ctx.db.get<"beneficiaries">>>
            >;
          }> = [];

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
                rb.beneficiary.name.toLowerCase().includes(searchLower),
              );
              if (matchingIndex !== -1) {
                displayBeneficiary =
                  recipientBeneficiaries[matchingIndex].beneficiary;
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
            account,
            beneficiary: { name: batchDisplayName, walletAddress: "" },
            recipientNames,
            displayAmount: d.totalAmount || d.amount || "0",
          };
        }

        const beneficiary = await fetchBeneficiary(
          d.beneficiaryId ?? undefined,
        );
        return {
          ...d,
          account,
          beneficiary: beneficiary
            ? {
                name: d.recipientName ?? beneficiary.name,
                walletAddress: d.recipientAddress ?? beneficiary.walletAddress,
              }
            : null,
          recipientNames: [],
          displayAmount: d.amount || "0",
        };
      }),
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
    safeId: v.optional(v.id("safes")),
    beneficiaryId: v.id("beneficiaries"),
    token: v.string(),
    amount: v.string(),
    memo: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const token = args.token.trim().toUpperCase();
    if (!configuredTokenAddress(args.chainId, token)) throw new Error("Unsupported payment currency for this network");
    const now = Date.now();

    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator"],
    );

    const safe = await resolveFundingAccount(ctx, args);


    const beneficiary = await ctx.db.get(args.beneficiaryId);
    if (!beneficiary || beneficiary.orgId !== args.orgId) {
      throw new Error("Invalid beneficiary");
    }

    if (!beneficiary.isActive) {
      throw new Error("Beneficiary is not active");
    }

    assertPayoutInstructions(beneficiary, { ...args, token });
    assertApprovedRecipient(beneficiary);
    // H-02/H-03: server-side validation of money math and destination address
    assertValidAmount(args.amount, token);
    assertValidAddress(beneficiary.walletAddress, "beneficiary wallet address");

    await assertMemberPaymentPolicy(
      ctx,
      args.orgId,
      user._id,
      token,
      args.amount,
      args.scheduledAt ?? now,
    );
    const disbursementId = await ctx.db.insert("disbursements", {
      orgId: args.orgId,
      safeId: safe._id,
      chainId: args.chainId,
      beneficiaryId: args.beneficiaryId,
      recipientAddress: beneficiary.walletAddress,
      recipientName: beneficiary.name,
      payoutVersion: beneficiary.payoutVersion,
      token: token,
      tokenAddress: configuredTokenAddress(args.chainId, token),
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
      metadata: {
        beneficiaryId: args.beneficiaryId,
        token: token,
        amount: args.amount,
      },
      timestamp: now,
    });

    return { disbursementId };
  },
});

// Update disbursement status (after Safe tx proposed/executed)
//
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
      v.literal("cancelled"),
    ),
    safeTxHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
    relayTaskId: v.optional(v.string()),
    relayStatus: v.optional(v.string()),
    relayFeeToken: v.optional(v.string()),
    relayFeeTokenSymbol: v.optional(v.string()),
    relayFeeMode: v.optional(
      v.union(v.literal("stablecoin_preferred"), v.literal("stablecoin_only")),
    ),
    relayError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) {
      throw new Error("Disbursement not found");
    }

    // Admin or initiator can update status
    const { user } = await requireOrgAccess(
      ctx,
      disbursement.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator"],
    );

    if (disbursement.allowanceExecution)
      throw new Error(
        "This payment has a delegated authorization. Resume or reconcile that authorization instead of creating another submission.",
      );

    if (disbursement.cancellationId)
      throw new Error("Complete or reconcile the pending account cancellation");
    if (args.status === "cancelled" && disbursement.safeTxHash)
      throw new Error("Signed payments require an approved account cancellation");

    if (args.status === "executed")
      throw new Error(
        "Execution must be verified on chain before marking a payment paid",
      );

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
    if (disbursement.safeTxHash && args.safeTxHash && disbursement.safeTxHash.toLowerCase() !== args.safeTxHash.toLowerCase()) throw new Error("Resume the original saved proposal; its transaction identity cannot be replaced.");
    if (args.txHash) assertValidTxHash(args.txHash, "txHash");
    if (disbursement.txHash && args.txHash && disbursement.txHash.toLowerCase() !== args.txHash.toLowerCase()) throw new Error("The original broadcast is already recorded. Verify its settlement before replacing a transaction hash.");

    // The proposal may have been saved even if its response was lost. A retry
    // of that exact status/hash is a read of the existing result, not another
    // authorization or a chance to change submission metadata.
    if (args.status === 'proposed' && disbursement.status === 'proposed' && args.safeTxHash?.toLowerCase() === disbursement.safeTxHash?.toLowerCase()
      && [args.txHash, args.relayTaskId, args.relayStatus, args.relayFeeToken, args.relayFeeTokenSymbol, args.relayFeeMode, args.relayError].every(value => value === undefined)) return { success: true };
    assertStatusTransition(disbursement.status, args.status);

    if (
      ["pending", "proposed", "scheduled"].includes(args.status) ||
      (args.status === "relaying" && disbursement.status !== "relaying")
    ) {
      await assertMemberPaymentPolicy(
        ctx,
        disbursement.orgId,
        disbursement.createdBy,
        disbursement.token,
        disbursement.totalAmount ?? disbursement.amount ?? "0",
        disbursement.scheduledAt ?? disbursement.createdAt,
        disbursement._id,
      );
      await assertPaymentMayProceed(ctx, disbursement);
    }

    const updates: Record<string, unknown> = {
      status: args.status,
      followupAt: now,
      updatedAt: now,
    };

    if (args.safeTxHash) updates.safeTxHash = args.safeTxHash;
    if (args.txHash) updates.txHash = args.txHash;
    if (args.relayTaskId) updates.relayTaskId = args.relayTaskId;
    if (args.relayStatus) updates.relayStatus = args.relayStatus;
    if (args.relayFeeToken) updates.relayFeeToken = args.relayFeeToken;
    if (args.relayFeeTokenSymbol)
      updates.relayFeeTokenSymbol = args.relayFeeTokenSymbol;
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
    if (
      args.status === "relaying" &&
      !disbursement.nativeExecution &&
      ((args.relayTaskId && args.relayTaskId !== disbursement.relayTaskId) ||
        (args.txHash && args.txHash !== disbursement.txHash))
    ) {
      await ctx.scheduler.runAfter(
        30_000,
        internal.paymentExecution.reconcile,
        { disbursementId: args.disbursementId, attempt: 0 },
      );
    }

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
    scheduledVersion: v.optional(v.number()),
    status: v.union(
      v.literal("relaying"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    relayTaskId: v.optional(v.string()),
    relayStatus: v.optional(v.string()),
    relayError: v.optional(v.string()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const disbursement = await ctx.db.get(args.disbursementId);
    // A response from an old job must not overwrite a cancellation, a newer
    // schedule, or a completed payment.
    if (
      !disbursement ||
      ["executed", "cancelled"].includes(disbursement.status) ||
      (args.scheduledVersion !== undefined &&
        args.scheduledVersion !== disbursement.scheduledVersion)
    ) {
      return { success: false, skipped: true };
    }
    if (args.txHash) assertValidTxHash(args.txHash, "txHash");
    const now = Date.now();
    const updates: Record<string, unknown> = {
      status: args.status,
      followupAt: now,
      updatedAt: now,
    };
    if (args.relayTaskId) updates.relayTaskId = args.relayTaskId;
    if (args.relayStatus) updates.relayStatus = args.relayStatus;
    if (args.relayError) updates.relayError = args.relayError;
    if (args.txHash) updates.txHash = args.txHash;

    if (args.status === "cancelled") {
      updates.scheduledVersion = (disbursement?.scheduledVersion ?? 0) + 1;
    }

    await ctx.db.patch(args.disbursementId, updates);
    if (
      args.status === "relaying" &&
      !disbursement.nativeExecution &&
      ((args.relayTaskId && args.relayTaskId !== disbursement.relayTaskId) ||
        (args.txHash && args.txHash !== disbursement.txHash))
    ) {
      await ctx.scheduler.runAfter(
        30_000,
        internal.paymentExecution.reconcile,
        { disbursementId: args.disbursementId, attempt: 0 },
      );
    }

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
    relayFeeMode: v.optional(
      v.union(v.literal("stablecoin_preferred"), v.literal("stablecoin_only")),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) throw new Error("Disbursement not found");

    const { user } = await requireOrgAccess(
      ctx,
      disbursement.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator"],
    );

    assertStatusTransition(disbursement.status, "scheduled");
    assertFutureSchedule(args.scheduledAt, now);
    await assertMemberPaymentPolicy(
      ctx,
      disbursement.orgId,
      disbursement.createdBy,
      disbursement.token,
      disbursement.totalAmount ?? disbursement.amount ?? "0",
      args.scheduledAt,
      disbursement._id,
    );
    assertValidTxHash(args.safeTxHash, "safeTxHash");
    if (disbursement.safeTxHash && disbursement.safeTxHash.toLowerCase() !== args.safeTxHash.toLowerCase()) throw new Error("Resume the original saved proposal; its transaction identity cannot be replaced.");
    await assertPaymentMayProceed(ctx, disbursement);

    const scheduledVersion = (disbursement.scheduledVersion ?? 0) + 1;

    await ctx.db.patch(args.disbursementId, {
      status: "scheduled",
      scheduledAt: args.scheduledAt,
      followupAt: now,
      scheduledJobId: `sched_${args.disbursementId}_${scheduledVersion}`,
      scheduledVersion,
      safeTxHash: args.safeTxHash,
      relayFeeToken: args.relayFeeToken,
      relayFeeTokenSymbol: args.relayFeeTokenSymbol,
      relayFeeMode: args.relayFeeMode,
      updatedAt: now,
    });

    await ctx.scheduler.runAt(
      args.scheduledAt,
      internal.relay.fireScheduledRelay,
      {
        disbursementId: args.disbursementId,
        scheduledVersion,
      },
    );

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

    const { user } = await requireOrgAccess(
      ctx,
      disbursement.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator"],
    );

    assertFutureSchedule(args.newScheduledAt, now);
    await assertMemberPaymentPolicy(
      ctx,
      disbursement.orgId,
      disbursement.createdBy,
      disbursement.token,
      disbursement.totalAmount ?? disbursement.amount ?? "0",
      args.newScheduledAt,
      disbursement._id,
    );
    await assertPaymentMayProceed(ctx, disbursement);

    const scheduledVersion = (disbursement.scheduledVersion ?? 0) + 1;

    await ctx.db.patch(args.disbursementId, {
      scheduledAt: args.newScheduledAt,
      followupAt: now,
      scheduledJobId: `sched_${args.disbursementId}_${scheduledVersion}`,
      scheduledVersion,
      updatedAt: now,
    });

    await ctx.scheduler.runAt(
      args.newScheduledAt,
      internal.relay.fireScheduledRelay,
      {
        disbursementId: args.disbursementId,
        scheduledVersion,
      },
    );

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
    safeId: v.optional(v.id("safes")),
    token: v.string(),
    recipients: v.array(
      v.object({
        beneficiaryId: v.id("beneficiaries"),
        amount: v.string(),
      }),
    ),
    memo: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const token = args.token.trim().toUpperCase();
    if (!configuredTokenAddress(args.chainId, token)) throw new Error("Unsupported payment currency for this network");
    const now = Date.now();

    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator"],
    );

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

    const safe = await resolveFundingAccount(ctx, args);


    // Validate all beneficiaries and calculate total in integer base units
    let totalBaseUnits = 0n;
    const recipientData: Array<{
      beneficiaryId: Id<"beneficiaries">;
      recipientAddress: string;
      recipientName: string;
      payoutVersion?: number;
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

      assertPayoutInstructions(beneficiary, { ...args, token });
      assertApprovedRecipient(beneficiary);
      // H-02/H-03: strict amount + address validation (no float math)
      assertValidAmount(recipient.amount, token);
      assertValidAddress(
        beneficiary.walletAddress,
        "beneficiary wallet address",
      );

      totalBaseUnits += amountToBaseUnits(recipient.amount, token);
      recipientData.push({
        beneficiaryId: recipient.beneficiaryId,
        recipientAddress: beneficiary.walletAddress,
        recipientName: beneficiary.name,
        payoutVersion: beneficiary.payoutVersion,
        amount: recipient.amount,
      });
    }

    const totalAmount = formatBaseUnits(totalBaseUnits, token);

    await assertMemberPaymentPolicy(
      ctx,
      args.orgId,
      user._id,
      token,
      totalAmount,
      args.scheduledAt ?? now,
    );
    // Create disbursement record
    const disbursementId = await ctx.db.insert("disbursements", {
      orgId: args.orgId,
      safeId: safe._id,
      chainId: args.chainId,
      type: "batch",
      token: token,
      tokenAddress: configuredTokenAddress(args.chainId, token),
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
        recipientName: recipient.recipientName,
        payoutVersion: recipient.payoutVersion,
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
        token: token,
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
    await requireOrgAccess(ctx, disbursement.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    const beneficiary = disbursement.beneficiaryId
      ? await ctx.db.get(disbursement.beneficiaryId)
      : null;

    return {
      ...disbursement,
      beneficiary: beneficiary
        ? {
            name: disbursement.recipientName ?? beneficiary.name,
            walletAddress:
              disbursement.recipientAddress ?? beneficiary.walletAddress,
          }
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
    await requireOrgAccess(ctx, disbursement.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    // Get single beneficiary if it's a single disbursement
    const beneficiary = disbursement.beneficiaryId
      ? await ctx.db.get(disbursement.beneficiaryId)
      : null;

    // Get recipients if it's a batch disbursement
    const recipients =
      disbursement.type === "batch"
        ? await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) =>
              q.eq("disbursementId", args.disbursementId),
            )
            .collect()
        : [];

    let payoutReviewError: string | undefined;
    if (!['executed', 'cancelled'].includes(disbursement.status)) {
      try { await assertRecipientVersions(ctx, disbursement); }
      catch (error) { payoutReviewError = error instanceof Error ? error.message : 'Recipient review is required'; }
    }
    // Enrich recipients with beneficiary data
    const enrichedRecipients = await Promise.all(
      recipients.map(async (r) => {
        const beneficiary = await ctx.db.get(r.beneficiaryId);
        return {
          ...r,
          beneficiary: beneficiary
            ? {
                name: r.recipientName ?? beneficiary.name,
                walletAddress: r.recipientAddress,
              }
            : null,
        };
      }),
    );

    return {
      ...disbursement,
      beneficiary: beneficiary
        ? {
            name: disbursement.recipientName ?? beneficiary.name,
            walletAddress:
              disbursement.recipientAddress ?? beneficiary.walletAddress,
          }
        : null,
      recipients: enrichedRecipients,
      payoutReviewError,
    };
  },
});

// Read the immutable payment intent for server-side receipt verification.
const verificationArgs = {
  disbursementId: v.id("disbursements"), sessionToken: v.optional(v.string()), readOnly: v.optional(v.boolean()), candidateHash: v.optional(v.string()),
};
export async function verificationContext(ctx: QueryCtx, args: { disbursementId: Id<'disbursements'>; sessionToken?: string; readOnly?: boolean; candidateHash?: string }) {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found");
    const access = args.sessionToken ? await requireOrgAccess(ctx, payment.orgId, args.sessionToken,
        args.readOnly ? ["admin", "approver", "initiator", "clerk", "viewer"] : ["admin", "approver", "initiator"]) : null;
    const safe = await ctx.db.get(payment.safeId);
    if (args.candidateHash && payment.safeTxHash && args.candidateHash.toLowerCase() !== payment.safeTxHash.toLowerCase()) throw new Error("This payment already has a different saved proposal. Resume the original proposal.");
    const safeTxHash = payment.safeTxHash ?? args.candidateHash;
    if (!safe || safe.orgId !== payment.orgId || safe.chainId !== payment.chainId || !safeTxHash || !payment.chainId)
      throw new Error(
        "Payment is missing its funding account or approved transaction",
      );
    const beneficiary = payment.beneficiaryId
      ? await ctx.db.get(payment.beneficiaryId)
      : null;
    const recipients =
      payment.type === "batch"
        ? await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) =>
              q.eq("disbursementId", payment._id),
            )
            .collect()
        : [
            {
              recipientAddress:
                payment.recipientAddress ?? beneficiary?.walletAddress ?? "",
              amount: payment.amount ?? "0",
            },
          ];
    return {
      chainId: payment.chainId,
      safeAddress: safe.safeAddress,
      safeTxHash,
      tokenAddress: payment.tokenAddress,
      actorWallet: access?.user.walletAddress,
      snapshot: JSON.stringify({ payment, safe, recipients }),
      token: payment.token,
      relayFeeToken: payment.relayFeeToken,
      executionFee: payment.executionFee,
      recipients,
    };
}
export const getForVerification = internalQuery({ args: verificationArgs, handler: verificationContext });

export const confirmExecution = internalMutation({
  args: {
    settlement: v.optional(settlementBlockValidator),
    disbursementId: v.id("disbursements"),
    sessionToken: v.optional(v.string()),
    safeTxHash: v.string(),
    txHash: v.string(),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found");
    const actorUserId = args.sessionToken
      ? (
          await requireOrgAccess(ctx, payment.orgId, args.sessionToken, [
            "admin",
            "approver",
            "initiator",
          ])
        ).user._id
      : payment.createdBy;
    if (payment.safeTxHash !== args.safeTxHash)
      throw new Error(
        "The approved transaction changed while verifying its receipt",
      );
    if (args.settlement) assertSameSettlement(payment.settlement, args.settlement);
    if (payment.status === "executed") {
      if (payment.txHash !== args.txHash)
        throw new Error("Payment already has a different execution receipt");
      if (args.settlement && !payment.settlement) {
        await ctx.db.patch(payment._id, { settlement: args.settlement, updatedAt: Date.now() });
        await queueReportSource(ctx, payment.orgId, 'payment', payment._id);
        await appendAudit(ctx, { orgId: payment.orgId, actorUserId, action: 'disbursement.settlement_evidence', objectType: 'disbursement', objectId: payment._id, metadata: { ...args.settlement, txHash: args.txHash }, timestamp: Date.now() });
      }
      return { success: true };
    }
    const now = Date.now();
    await ctx.db.patch(payment._id, {
      status: "executed",
      settlement: args.settlement,
      txHash: args.txHash,
      nativeRecoveryAt: undefined,
      relayError: undefined,
      executedAt: now,
      updatedAt: now,
    });
    await queueReportSource(ctx, payment.orgId, 'payment', payment._id);
    await appendAudit(ctx, {
      orgId: payment.orgId,
      actorUserId,
      action: "disbursement.executed",
      objectType: "disbursement",
      objectId: payment._id,
      metadata: {
        txHash: args.txHash,
        safeTxHash: args.safeTxHash,
        source: "verified_receipt",
      },
      timestamp: now,
    });
    return { success: true };
  },
});

// Claim immediate execution after signatures are collected, before an external submit.
const nativeClaimArgs = {
    disbursementId: v.id("disbursements"),
    sessionToken: v.string(),
    safeTxHash: v.string(),
};
export async function claimNative(ctx: MutationCtx, args: { disbursementId: Id<'disbursements'>; sessionToken: string; safeTxHash: string; searchFromBlock: string; attemptId: string; circleExecutionId?: Id<'circleExecutions'> }) {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found");
    const { user } = await requireOrgAccess(
      ctx,
      payment.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator"],
    );
    const retryRejected = walletSendDeclined(payment);
    if ((payment.status !== "proposed" && !retryRejected) || payment.safeTxHash !== args.safeTxHash)
      throw new Error(
        "Payment changed or is already being submitted. Refresh before continuing.",
      );
    if (payment.allowanceExecution || payment.executionFee)
      throw new Error("Use the execution method approved for this payment");
    await assertCircleReservation(ctx, payment.safeId, args.circleExecutionId);
    if (!/^\d+$/.test(args.searchFromBlock))
      throw new Error("Invalid network recovery checkpoint");
    await assertPaymentMayProceed(ctx, payment);
    await assertMemberPaymentPolicy(
      ctx,
      payment.orgId,
      payment.createdBy,
      payment.token,
      payment.totalAmount ?? payment.amount ?? "0",
      payment.scheduledAt ?? Date.now(),
      payment._id,
    );
    await ctx.db.patch(payment._id, {
      status: "relaying",
      relayStatus: "preparing",
      nativeExecution: { ...(args.circleExecutionId ? { service: 'circle' as const } : {}), startedAt: Date.now(), searchFromBlock: payment.nativeExecution?.searchFromBlock && BigInt(payment.nativeExecution.searchFromBlock) < BigInt(args.searchFromBlock) ? payment.nativeExecution.searchFromBlock : args.searchFromBlock, checks: 0, attemptId: args.attemptId, actorUserId: user._id },
      relayError: undefined,
      nativeRecoveryAt: Date.now(),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: payment.orgId,
      actorUserId: user._id,
      action: "disbursement.execution_claimed",
      objectType: "disbursement",
      objectId: payment._id,
      timestamp: Date.now(),
    });
    return { success: true, attemptId: args.attemptId };
}
export const claimNativeExecution = internalMutation({ args: { ...nativeClaimArgs, searchFromBlock: v.string(), attemptId: v.string() }, handler: claimNative });
import { assertPayoutInstructions } from "../shared/payoutInstructions";
