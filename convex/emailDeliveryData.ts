import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { invitationAvailable } from "./teamInvitations";

export const claim = internalMutation({
  args: { deliveryId: v.id("emailDeliveries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId),
      now = Date.now();
    if (
      !row ||
      !["queued", "sending", "unknown"].includes(row.status) ||
      (row.leaseUntil ?? 0) > now
    )
      return null;
    const invitation = await ctx.db.get(row.invitationId);
    if (!(await invitationAvailable(ctx, invitation))) {
      await ctx.db.patch(row._id, {
        status: "cancelled",
        sealedPayload: undefined,
        nextAttemptAt: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      return null;
    }
    // Stay inside the provider's 24-hour idempotency retention, including outages.
    if (
      row.attempts >= 5 ||
      (row.firstAttemptAt !== undefined &&
        now - row.firstAttemptAt >= 23 * 3600_000) ||
      !row.sealedPayload
    ) {
      await ctx.db.patch(row._id, {
        status: "unknown",
        sealedPayload: undefined,
        nextAttemptAt: undefined,
        leaseUntil: undefined,
        error:
          "Delivery could not be confirmed. Resend a replacement invitation.",
        updatedAt: now,
      });
      return null;
    }
    const attempt = row.attempts + 1;
    await ctx.db.patch(row._id, {
      status: "sending",
      attempts: attempt,
      firstAttemptAt: row.firstAttemptAt ?? now,
      leaseUntil: now + 2 * 60_000,
      nextAttemptAt: now + 2 * 60_000,
      updatedAt: now,
    });
    return {
      sealedPayload: row.sealedPayload,
      context: row.context,
      attempt,
      expectedEmail: invitation!.email,
    };
  },
});
export const complete = internalMutation({
  args: {
    deliveryId: v.id("emailDeliveries"),
    attempt: v.number(),
    providerId: v.optional(v.string()),
    error: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId),
      now = Date.now();
    if (!row || row.attempts !== args.attempt || row.status !== "sending")
      return;
    if (args.providerId) {
      await ctx.db.patch(row._id, {
        status: "submitted",
        providerId: args.providerId,
        sealedPayload: undefined,
        nextAttemptAt: undefined,
        leaseUntil: undefined,
        error: undefined,
        updatedAt: now,
      });
    } else {
      const retry =
        !!args.retryable &&
        row.attempts < 5 &&
        now - (row.firstAttemptAt ?? now) < 22 * 3600_000;
      await ctx.db.patch(row._id, {
        status: args.retryable ? "unknown" : "failed",
        sealedPayload: retry ? row.sealedPayload : undefined,
        nextAttemptAt: retry
          ? now + Math.min(15, 2 ** row.attempts) * 60_000
          : undefined,
        leaseUntil: undefined,
        error:
          args.error?.slice(0, 500) || "Email delivery could not be confirmed.",
        updatedAt: now,
      });
    }
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("emailDeliveries")
      .withIndex("by_next_attempt", (q) =>
        q.gt("nextAttemptAt", 0).lte("nextAttemptAt", Date.now()),
      )
      .take(10);
    for (const row of rows) {
      await ctx.db.patch(row._id, { nextAttemptAt: Date.now() + 2 * 60_000 });
      await ctx.scheduler.runAfter(0, internal.emailDelivery.deliver, {
        deliveryId: row._id,
      });
    }
  },
});
export const providerEvent = internalMutation({
  args: {
    providerId: v.string(),
    eventId: v.string(),
    occurredAt: v.number(),
    kind: v.union(
      v.literal("submitted"),
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("emailDeliveries")
      .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
      .unique();
    // A delivery webhook may arrive before the send response is persisted.
    if (!row) return false;
    if (
      row.providerEventId === args.eventId ||
      args.occurredAt < (row.providerEventAt ?? 0) ||
      row.status === "cancelled"
    )
      return true;
    const priority = { submitted: 1, delivered: 2, failed: 3, bounced: 4 };
    if (
      args.occurredAt === row.providerEventAt &&
      (priority[row.status as keyof typeof priority] ?? 0) >=
        priority[args.kind]
    )
      return true;
    // A delayed 'sent' event cannot erase a delivered/bounced outcome.
    if (
      args.kind === "submitted" &&
      ["delivered", "bounced", "failed"].includes(row.status)
    )
      return true;
    if (["bounced", "failed"].includes(row.status) && ["submitted", "delivered"].includes(args.kind)) return true;
    await ctx.db.patch(row._id, {
      status: args.kind,
      providerEventAt: args.occurredAt,
      providerEventId: args.eventId,
      updatedAt: Date.now(),
      error:
        args.kind === "bounced"
          ? "The recipient's mail server rejected this invitation. Verify their email before resending."
          : args.kind === "failed"
            ? "The email service reported a delivery failure. Verify the address before resending."
            : undefined,
    });
    return true;
  },
});
