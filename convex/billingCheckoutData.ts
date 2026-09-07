import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import { paymentConfiguration } from "./lib/billingConfiguration";
import { PLAN_LIMITS, hasPaidTerm } from "../shared/billing";
import { billingCheckoutCall } from "./lib/billingCheckout";
import { isValidTxHash } from "../shared/validation";
import { appendAudit } from "./audit";

export const current = query({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin"]);
    return ctx.db
      .query("billingCheckouts")
      .withIndex("by_org_active", (q) =>
        q.eq("orgId", args.orgId).eq("active", true),
      )
      .unique();
  },
});

export const get = query({
  args: {
    orgId: v.id("orgs"),
    checkoutId: v.id("billingCheckouts"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin"]);
    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout || checkout.orgId !== args.orgId)
      throw new Error("Subscription checkout not found");
    return checkout;
  },
});

export const create = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    requestId: v.string(),
    plan: v.union(v.literal("starter"), v.literal("team"), v.literal("pro")),
    chainId: v.number(),
    treasury: v.string(),
    tokenAddress: v.string(),
    amountRaw: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId))
      throw new Error("Invalid checkout request");
    const existing = await ctx.db
      .query("billingCheckouts")
      .withIndex("by_request", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (existing.createdBy !== user._id || existing.plan !== args.plan)
        throw new Error("Checkout request changed");
      return existing._id;
    }
    const active = await ctx.db
      .query("billingCheckouts")
      .withIndex("by_org_active", (q) =>
        q.eq("orgId", args.orgId).eq("active", true),
      )
      .unique();
    if (active) {
      if (
        active.plan !== args.plan ||
        active.payer !== user.walletAddress.toLowerCase() ||
        active.chainId !== args.chainId ||
        active.treasury !== args.treasury.toLowerCase() ||
        active.tokenAddress !== args.tokenAddress.toLowerCase() ||
        active.amountRaw !== args.amountRaw
      )
        throw new Error(
          "Finish or discard the earlier checkout before choosing another payment",
        );
      return active._id;
    }
    if (args.plan === "starter") throw new Error("Starter limits are included in Free access. No subscription payment is needed for those limits.");
    const terms = paymentConfiguration();
    const amountRaw = String(BigInt(PLAN_LIMITS[args.plan].price) * 1_000_000n);
    if (
      !terms ||
      terms.chainId !== args.chainId ||
      terms.treasury.toLowerCase() !== args.treasury.toLowerCase() ||
      terms.tokenAddress.toLowerCase() !== args.tokenAddress.toLowerCase() ||
      args.amountRaw !== amountRaw
    )
      throw new Error("Subscription terms changed. Review checkout again.");
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
    if (!billing) throw new Error("Billing record not found");
    if (
      hasPaidTerm(billing) &&
      PLAN_LIMITS[args.plan].price < PLAN_LIMITS[billing.plan].price
    )
      throw new Error(
        "A lower plan is available after the current paid term ends",
      );
    const payer = user.walletAddress.toLowerCase();
    if (
      await ctx.db
        .query("billingCheckouts")
        .withIndex("by_payer_active", (q) =>
          q.eq("chainId", terms.chainId).eq("payer", payer).eq("active", true),
        )
        .first()
    )
      throw new Error(
        "This wallet has an unresolved subscription checkout in another workspace",
      );
    const now = Date.now();
    const id = await ctx.db.insert("billingCheckouts", {
      orgId: args.orgId,
      createdBy: user._id,
      requestId: args.requestId,
      plan: args.plan,
      payer,
      chainId: terms.chainId,
      treasury: terms.treasury.toLowerCase(),
      tokenAddress: terms.tokenAddress.toLowerCase(),
      amountRaw,
      status: "prepared",
      active: true,
      checks: 0,
      createdAt: now,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "billing.checkout_prepared",
      objectType: "billing",
      objectId: id,
      timestamp: now,
      metadata: { plan: args.plan, chainId: terms.chainId, amountRaw, payer },
    });
    return id;
  },
});

export const context = internalQuery({
  args: {
    checkoutId: v.id("billingCheckouts"),
    sessionToken: v.optional(v.string()),
    sender: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout) throw new Error("Subscription checkout not found");
    if (args.sessionToken) {
      const { user } = await requireOrgAccess(
        ctx,
        checkout.orgId,
        args.sessionToken,
        ["admin"],
      );
      if (args.sender && user.walletAddress.toLowerCase() !== checkout.payer)
        throw new Error("Connect the wallet that prepared this checkout");
    } else if (args.sender)
      throw new Error("Sign in before requesting payment");
    return checkout;
  },
});

export const claim = internalMutation({
  args: {
    checkoutId: v.id("billingCheckouts"),
    sessionToken: v.string(),
    nonce: v.number(),
    fromBlock: v.string(),
    attemptId: v.string(),
  },
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout) throw new Error("Subscription checkout not found");
    const { user } = await requireOrgAccess(
      ctx,
      checkout.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (user.walletAddress.toLowerCase() !== checkout.payer)
      throw new Error("Connect the wallet that prepared this checkout");
    if (checkout.status !== "prepared" || !checkout.active)
      throw new Error(
        "The original wallet request must be checked before another payment",
      );
    if (
      !Number.isSafeInteger(args.nonce) ||
      args.nonce < 0 ||
      !/^\d+$/.test(args.fromBlock)
    )
      throw new Error("Invalid payment checkpoint");
    const now = Date.now();
    await ctx.db.patch(checkout._id, {
      status: "requested",
      nonce: args.nonce,
      fromBlock: args.fromBlock,
      attemptId: args.attemptId,
      recoveryAt: now + 60_000,
      checks: 0,
      updatedAt: now,
    });
    return {
      ...billingCheckoutCall(checkout),
      chainId: checkout.chainId,
      payer: checkout.payer,
      nonce: args.nonce,
      attemptId: args.attemptId,
    };
  },
});

export const walletResult = mutation({
  args: {
    checkoutId: v.id("billingCheckouts"),
    sessionToken: v.string(),
    attemptId: v.string(),
    txHash: v.optional(v.string()),
    declined: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout) throw new Error("Subscription checkout not found");
    const { user } = await requireOrgAccess(
      ctx,
      checkout.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (
      user.walletAddress.toLowerCase() !== checkout.payer ||
      checkout.attemptId !== args.attemptId
    )
      throw new Error("Wallet response does not belong to this checkout");
    if (args.declined === !!args.txHash || (!args.declined && !args.txHash))
      throw new Error("Report a receipt or an explicit wallet decline");
    if (args.txHash && !isValidTxHash(args.txHash))
      throw new Error("Invalid transaction hash");
    if (
      (checkout.txHash && args.txHash?.toLowerCase() === checkout.txHash) ||
      (checkout.status === "declined" && args.declined)
    )
      return;
    if (checkout.status !== "requested" || checkout.txHash)
      throw new Error("The original wallet result cannot be replaced");
    await ctx.db.patch(checkout._id, {
      status: args.declined ? "declined" : "submitted",
      active: !args.declined,
      txHash: args.txHash?.toLowerCase(),
      recoveryAt: args.declined ? undefined : Date.now(),
      updatedAt: Date.now(),
    });
    if (!args.declined)
      await ctx.scheduler.runAfter(
        0,
        internal.billingCheckoutActions.reconcile,
        { checkoutId: checkout._id },
      );
  },
});

export const discard = mutation({
  args: { checkoutId: v.id("billingCheckouts"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get(args.checkoutId);
    if (!checkout) throw new Error("Subscription checkout not found");
    await requireOrgAccess(ctx, checkout.orgId, args.sessionToken, ["admin"]);
    if (checkout.status !== "prepared")
      throw new Error(
        "A wallet request already exists. Check its original receipt.",
      );
    await ctx.db.patch(checkout._id, {
      status: "cancelled",
      active: false,
      updatedAt: Date.now(),
    });
  },
});

export const checkpoint = internalMutation({
  args: {
    checkoutId: v.id("billingCheckouts"),
    reset: v.optional(v.boolean()),
    fromBlock: v.optional(v.string()),
    error: v.optional(v.string()),
    txHash: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal("reverted"), v.literal("cancelled"))),
  },
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get(args.checkoutId);
    if (
      !checkout?.active ||
      !["requested", "submitted"].includes(checkout.status)
    )
      return;
    const checks = args.reset ? 0 : checkout.checks + 1;
    await ctx.db.patch(checkout._id, {
      checks,
      ...(args.outcome
        ? {
            active: false,
            status: args.outcome,
            ...(args.outcome === "cancelled"
              ? { replacementHash: args.txHash }
              : { txHash: args.txHash }),
          }
        : {}),
      fromBlock: args.fromBlock ?? checkout.fromBlock,
      error: args.error,
      recoveryAt:
        args.outcome || checks >= 120 ? undefined : Date.now() + 60_000,
      updatedAt: Date.now(),
    });
  },
});

export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("billingCheckouts")
      .withIndex("by_recovery", (q) =>
        q.gt("recoveryAt", 0).lte("recoveryAt", Date.now()),
      )
      .take(20);
    for (const row of rows) {
      await ctx.db.patch(row._id, { recoveryAt: Date.now() + 60_000 });
      await ctx.scheduler.runAfter(
        0,
        internal.billingCheckoutActions.reconcile,
        { checkoutId: row._id },
      );
    }
  },
});
