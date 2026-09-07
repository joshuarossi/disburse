import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import {
  paymentFollowup,
  paymentFollowupCopy,
  type PaymentFollowupPhase,
} from "../shared/paymentFollowup";
import { fingerprint } from "../shared/fingerprint";
import type { Doc } from "./_generated/dataModel";
import { chainEnvironment } from "../shared/assets";

const readers = ["admin", "approver", "initiator", "clerk", "viewer"] as const;
const writers = ["admin", "approver", "initiator"];
const inputKey = (p: Doc<"disbursements">, safe: Doc<"safes"> | null) =>
  fingerprint({
    status: p.status,
    scheduledAt: p.scheduledAt,
    safeId: p.safeId,
    chainId: p.chainId,
    createdBy: p.createdBy,
    account: safe && {
      address: safe.safeAddress,
      chainId: safe.chainId,
      orgId: safe.orgId,
      isActive: safe.isActive,
    },
  });

/** Backfill historical schedules once; lease only due work, twenty payments per minute. */
export const due = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const historical = await ctx.db
      .query("disbursements")
      .withIndex("by_followup", (q) => q.eq("followupAt", undefined))
      .take(50);
    for (const p of historical)
      await ctx.db.patch(p._id, {
        followupAt:
          p.scheduledAt && !["executed", "cancelled"].includes(p.status)
            ? now
            : 0,
      });
    const due = await ctx.db
      .query("disbursements")
      .withIndex("by_followup", (q) =>
        q.gt("followupAt", 0).lte("followupAt", now),
      )
      .take(20);
    for (const p of due) {
      const attempt = (p.followupAttempt ?? 0) + 1;
      await ctx.db.patch(p._id, {
        followupAt: now + 120_000,
        followupAttempt: attempt,
      });
      await ctx.scheduler.runAfter(0, internal.paymentFollowupChecks.process, {
        disbursementId: p._id,
        attempt,
      });
    }
    return due.length;
  },
});

export const context = internalQuery({
  args: { disbursementId: v.id("disbursements"), attempt: v.number() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.disbursementId);
    if (!p || p.followupAttempt !== args.attempt) return null;
    const safe = await ctx.db.get(p.safeId);
    return {
      payment: p,
      inputKey: inputKey(p, safe),
      safe: safe?.orgId === p.orgId ? safe : null,
      decision: paymentFollowup(p, Date.now()),
    };
  },
});

export const record = internalMutation({
  args: {
    disbursementId: v.id("disbursements"),
    attempt: v.number(),
    inputKey: v.string(),
    phase: v.union(v.string(), v.null()),
    owners: v.array(v.string()),
    ownershipBlock: v.optional(v.string()),
    ownershipError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment || payment.followupAttempt !== args.attempt) return false;
    const safe = await ctx.db.get(payment.safeId);
    if (inputKey(payment, safe) !== args.inputKey) {
      await ctx.db.patch(payment._id, { followupAt: Date.now() });
      return false;
    }
    const now = Date.now();
    const decision = paymentFollowup(payment, now);
    if (decision.phase !== args.phase) {
      await ctx.db.patch(payment._id, { followupAt: now });
      return false;
    }
    if (
      decision.phase &&
      !args.ownershipError &&
      (!args.ownershipBlock || !args.owners.length)
    )
      throw new Error(
        "Current account approvers must be verified or marked unavailable",
      );
    const existing = await ctx.db
      .query("paymentNotifications")
      .withIndex("by_payment", (q) => q.eq("disbursementId", payment._id))
      .first();
    // Recheck ownership hourly without generating another unread reminder unless
    // the phase, UTC day, verification availability or responsible team changes.
    await ctx.db.patch(payment._id, {
      followupAt: decision.phase
        ? Math.min(
            decision.nextAt,
            now + (args.ownershipError ? 15 : 60) * 60_000,
          )
        : decision.nextAt,
    });
    if (!decision.phase) {
      if (existing?.isOpen)
        await ctx.db.patch(existing._id, { isOpen: false, updatedAt: now });
      return true;
    }
    const members = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q) => q.eq("orgId", payment.orgId))
      .take(1001);
    if (members.length > 1000)
      throw new Error(
        "The team is too large to resolve reminder assignments completely",
      );
    const currentOwners = new Set(args.owners.map((o) => o.toLowerCase()));
    const assignedUserIds = [];
    for (const member of members) {
      if (member.status !== "active" || !writers.includes(member.role))
        continue;
      const user = await ctx.db.get(member.userId);
      if (
        member.role === "admin" ||
        member.userId === payment.createdBy ||
        (user && currentOwners.has(user.walletAddress.toLowerCase()))
      )
        assignedUserIds.push(member.userId);
    }
    assignedUserIds.sort();
    const changed =
      !existing ||
      !existing.isOpen ||
      existing.revisionKey !== decision.revisionKey ||
      !!existing.ownershipError !== !!args.ownershipError ||
      fingerprint(existing.assignedUserIds) !== fingerprint(assignedUserIds);
    const fields = {
      orgId: payment.orgId,
      environment: chainEnvironment(payment.chainId),
      disbursementId: payment._id,
      phase: decision.phase,
      revisionKey: decision.revisionKey,
      revision: (existing?.revision ?? 0) + (changed ? 1 : 0),
      isOpen: true,
      coordinatorUserId: payment.createdBy,
      assignedUserIds,
      owners: args.owners.map((o) => o.toLowerCase()),
      ownershipBlock: args.ownershipBlock,
      ownershipCheckedAt: args.ownershipError ? undefined : now,
      ownershipError: args.ownershipError,
      updatedAt: changed ? now : existing!.updatedAt,
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else
      await ctx.db.insert("paymentNotifications", {
        ...fields,
        createdAt: now,
      });
    return true;
  },
});

export const list = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    environment: v.union(
      v.literal("production"),
      v.literal("test"),
      v.literal("unclassified"),
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      [...readers],
    );
    const page = await ctx.db
      .query("paymentNotifications")
      .withIndex("by_org_open", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("environment", args.environment)
          .eq("isOpen", true),
      )
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    const items = [];
    for (const n of page.page) {
      const p = n.disbursementId ? await ctx.db.get(n.disbursementId) : null;
      const series = n.recurringPaymentId
        ? await ctx.db.get(n.recurringPaymentId)
        : null;
      if (p?.orgId !== args.orgId && series?.orgId !== args.orgId) continue;
      const phase = p
        ? paymentFollowup(p, Date.now()).phase
        : series?.status === "paused" && series.pauseReason
          ? "schedule_paused"
          : null;
      if (!phase) continue;
      const read = await ctx.db
        .query("paymentNotificationReads")
        .withIndex("by_notification_user", (q) =>
          q.eq("notificationId", n._id).eq("userId", user._id),
        )
        .first();
      const assigned =
        writers.includes(membership.role) &&
        (membership.role === "admin" || n.assignedUserIds.includes(user._id));
      items.push({
        id: n._id,
        revision: n.revision,
        phase: phase as PaymentFollowupPhase,
        ...paymentFollowupCopy[phase],
        disbursementId: p?._id,
        recurringPaymentId: series?._id,
        paymentName: p?.name || p?.memo || series?.name || "Scheduled payment",
        payAt: p?.scheduledAt ?? series!.nextPayDate,
        chainId: p?.chainId ?? series?.chainId,
        assigned,
        unread: assigned && (read?.revision ?? 0) < n.revision,
        ownershipError: n.ownershipError,
        pauseReason: series?.pauseReason,
        updatedAt: n.updatedAt,
      });
    }
    return { items, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const markRead = mutation({
  args: {
    notificationId: v.id("paymentNotifications"),
    revision: v.number(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const n = await ctx.db.get(args.notificationId);
    if (!n) return false;
    const { user } = await requireOrgAccess(ctx, n.orgId, args.sessionToken, [
      ...readers,
    ]);
    if (n.revision !== args.revision) return false;
    const old = await ctx.db
      .query("paymentNotificationReads")
      .withIndex("by_notification_user", (q) =>
        q.eq("notificationId", n._id).eq("userId", user._id),
      )
      .first();
    if (old && old.revision >= n.revision) return true;
    const fields = {
      notificationId: n._id,
      userId: user._id,
      revision: n.revision,
      readAt: Date.now(),
    };
    if (old) await ctx.db.patch(old._id, fields);
    else await ctx.db.insert("paymentNotificationReads", fields);
    return true;
  },
});
