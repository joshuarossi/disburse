import { finishBillingCheckout } from "./lib/billingCheckout";
import { appendAudit } from "./audit";
import { v } from "convex/values";
import {
  mutation,
  query,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import { Id } from "./_generated/dataModel";
import { QueryCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyBillingReceipt } from "./lib/billingReceipt";
import { isValidTxHash } from "./lib/validation";
import {
  paymentConfiguration,
  getPaymentChainId,
  getTreasuryAddress,
  PAYMENT_TOKEN_BY_CHAIN,
} from "./lib/billingConfiguration";
import { teamSeats } from "./lib/teamSeats";

// Plan types
export type PlanType = "trial" | "starter" | "team" | "pro";

export { PLAN_LIMITS } from "../shared/billing";
import { PLAN_LIMITS, billingAccess, renewalEnd, hasPaidTerm } from "../shared/billing";

export async function getOrgLimits(ctx: QueryCtx, orgId: Id<"orgs">) {
  const billing = await ctx.db
    .query("billing")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  const access = billingAccess(billing);
  return access.limits;
}

export const get = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    // Any member can view billing
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (!billing) {
      return null;
    }

    // Share invitation seat accounting. An unavailable usage count must not hide renewal.
    const usage = await Promise.all([
      teamSeats(ctx, args.orgId),
      ctx.db
        .query("beneficiaries")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .take(10001),
      ctx.db
        .query("safes")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .take(1001),
    ])
      .then(([seats, recipients, accounts]) =>
        recipients.length > 10000 || accounts.length > 1000
          ? null
          : {
              activeMembers: seats.active,
              reservedSeats: seats.reserved,
              pendingInvitations: seats.reserved - seats.active,
              recipients: recipients.length,
              archivedRecipients: recipients.filter((r) => r.isActive === false)
                .length,
              activeAccounts: accounts.filter((a) => a.isActive !== false)
                .length,
            },
      )
      .catch(() => null);

    return {
      ...billing,
      ...billingAccess(billing),
      usage,
      paymentConfig: paymentConfiguration(),
      payments: await ctx.db
        .query("billingPayments")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .order("desc")
        .take(50),
    };
  },
});

// ─── Subscription payment verification (C-03 fix) ────────────────────────────
// Plans are activated ONLY after an on-chain USDC transfer to the Disburse
// treasury address has been verified against the claimed txHash. The client
// can no longer declare its own paidThroughAt.

export const PLAN_PERIOD_DAYS = 30;

// Admin gate for billing actions (actions cannot touch the DB directly)
export const assertBillingAdmin = internalQuery({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    const safes = await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return { walletAddress: user.walletAddress, safes };
  },
});

// Persist a verified payment. Internal so only the verification action writes it.
export const recordVerifiedPayment = internalMutation({
  args: {
    checkoutId: v.optional(v.id("billingCheckouts")),
    orgId: v.id("orgs"),
    txHash: v.string(),
    chainId: v.number(),
    plan: v.union(v.literal("starter"), v.literal("team"), v.literal("pro")),
    tokenAddress: v.string(),
    amountRaw: v.string(),
  },
  handler: async (ctx, args) => {
    // Idempotency / double-spend guard: a txHash funds exactly one period
    const existing = await ctx.db
      .query("billingPayments")
      .withIndex("by_tx", (q) => q.eq("txHash", args.txHash.toLowerCase()))
      .first();
    if (existing) {
      if (
        existing.orgId === args.orgId &&
        existing.plan === args.plan &&
        existing.chainId === args.chainId &&
        (!args.checkoutId || existing.checkoutId === args.checkoutId)
      )
        return { verified: true };
      throw new Error("Payment transaction has already been used");
    }

    const now = Date.now();
    if (args.checkoutId) {
      const checkout = await ctx.db.get(args.checkoutId);
      if (
        !checkout ||
        checkout.orgId !== args.orgId ||
        checkout.plan !== args.plan ||
        checkout.chainId !== args.chainId ||
        checkout.tokenAddress.toLowerCase() !==
          args.tokenAddress.toLowerCase() ||
        BigInt(checkout.amountRaw) !== BigInt(args.amountRaw) ||
        (checkout.txHash &&
          checkout.txHash.toLowerCase() !== args.txHash.toLowerCase()) ||
        !["requested", "submitted"].includes(checkout.status)
      )
        throw new Error("Verified payment does not match this checkout");
      await ctx.db.patch(checkout._id, {
        status: "submitted",
        txHash: args.txHash.toLowerCase(),
        updatedAt: now,
      });
    }
    await ctx.db.insert("billingPayments", {
      ...args,
      paidThroughAt: now + PLAN_PERIOD_DAYS * 24 * 60 * 60 * 1000,
      verifiedAt: now,
    });
    return { verified: true };
  },
});

/**
 * Verify on-chain that `txHash` transferred at least the plan price in USDC to
 * the Disburse treasury, then store the verified payment for redemption by
 * `subscribe`. Run these two steps in order from the client.
 */
export const verifySubscriptionPayment = action({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    plan: v.union(v.literal("starter"), v.literal("team"), v.literal("pro")),
    txHash: v.string(),
  },
  handler: async (ctx, args) => {
    // Only org admins may initiate a subscription payment
    const payer = await ctx.runQuery(internal.billing.assertBillingAdmin, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
    });

    if (!isValidTxHash(args.txHash)) {
      throw new Error("Invalid transaction hash");
    }

    const chainId = getPaymentChainId();
    const tokenAddress = PAYMENT_TOKEN_BY_CHAIN[chainId];
    if (!tokenAddress) {
      throw new Error(`Payments not supported on chain ${chainId}`);
    }
    const treasury = getTreasuryAddress();

    const { amountRaw } = await verifyBillingReceipt({
      chainId,
      tokenAddress,
      treasury,
      txHash: args.txHash,
      amountRaw: String(BigInt(PLAN_LIMITS[args.plan].price) * 1_000_000n),
      maxAgeDays: 7,
      allowedPayers: [
        payer.walletAddress,
        ...payer.safes
          .filter((s) => s.chainId === chainId)
          .map((s) => s.safeAddress),
      ],
    });

    await ctx.runMutation(internal.billing.recordVerifiedPayment, {
      orgId: args.orgId,
      txHash: args.txHash.toLowerCase(),
      chainId,
      plan: args.plan,
      tokenAddress,
      amountRaw: amountRaw.toString(),
    });

    return { verified: true };
  },
});

// Subscribe to a plan — requires a server-verified on-chain payment.
async function redeemVerifiedPayment(
  ctx: MutationCtx,
  args: { orgId: Id<"orgs">; plan: "starter" | "team" | "pro"; txHash: string },
  actorUserId: Id<"users">,
) {
  const now = Date.now();

  if (!isValidTxHash(args.txHash)) {
    throw new Error("Invalid transaction hash");
  }

  const billing = await ctx.db
    .query("billing")
    .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
    .first();

  if (!billing) {
    throw new Error("Billing record not found");
  }

  // C-03: activation requires a previously verified on-chain payment
  const payment = await ctx.db
    .query("billingPayments")
    .withIndex("by_tx", (q) => q.eq("txHash", args.txHash.toLowerCase()))
    .first();

  if (!payment) {
    throw new Error(
      "Payment not verified. Call verifySubscriptionPayment first; the transaction must transfer the plan price to the Disburse treasury.",
    );
  }
  if (payment.orgId !== args.orgId || payment.plan !== args.plan) {
    throw new Error(
      "Verified payment does not match this organization or plan",
    );
  }

  if (payment.redeemedAt !== undefined) {
    await finishBillingCheckout(ctx, payment);
    return { success: true };
  }
  const history = await ctx.db
    .query("auditLog")
    .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
    .collect();
  if (
    history.some(
      (entry) =>
        ["billing.subscribed", "billing.upgraded"].includes(entry.action) &&
        String(entry.metadata?.txHash ?? "").toLowerCase() ===
          args.txHash.toLowerCase(),
    )
  ) {
    await ctx.db.patch(payment._id, { redeemedAt: now });
    await finishBillingCheckout(ctx, payment);
    return { success: true };
  }
  if (
    hasPaidTerm(billing, now) &&
    PLAN_LIMITS[args.plan].price < PLAN_LIMITS[billing.plan].price
  )
    throw new Error("Choose a lower plan after the current paid period ends.");
  const previousPlan = billing.plan;
  const paidThroughAt = renewalEnd(billing, args.plan, now);
  await ctx.db.patch(payment._id, { redeemedAt: now, paidThroughAt });
  await finishBillingCheckout(ctx, payment);

  await ctx.db.patch(billing._id, {
    plan: args.plan,
    status: "active",
    paidThroughAt,
    licenseGrant: undefined,
    licenseRevision: (billing.licenseRevision ?? 0) + 1,
    updatedAt: now,
  });

  // Audit log
  await appendAudit(ctx, {
    orgId: args.orgId,
    actorUserId,
    action: "billing.subscribed",
    objectType: "billing",
    objectId: billing._id,
    metadata: {
      previousPlan,
      newPlan: args.plan,
      txHash: args.txHash,
      paidThroughAt,
      price: PLAN_LIMITS[args.plan].price,
      serverVerified: true,
      replacedGrant: billing.licenseGrant?.kind,
    },
    timestamp: now,
  });

  return { success: true };
}

export const subscribe = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    plan: v.union(v.literal("starter"), v.literal("team"), v.literal("pro")),
    txHash: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    return redeemVerifiedPayment(ctx, args, user._id);
  },
});

// A verified checkout settles even after its browser session or trial expires.
export const redeemCheckout = internalMutation({
  args: { checkoutId: v.id("billingCheckouts") },
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get(args.checkoutId);
    if (
      !checkout?.txHash ||
      !["submitted", "applied"].includes(checkout.status)
    )
      throw new Error("Checkout has no verified payment");
    const payment = await ctx.db
      .query("billingPayments")
      .withIndex("by_tx", (q) => q.eq("txHash", checkout.txHash!))
      .unique();
    if (payment?.checkoutId !== checkout._id)
      throw new Error("Checkout payment has not been verified");
    return redeemVerifiedPayment(
      ctx,
      { orgId: checkout.orgId, plan: checkout.plan, txHash: checkout.txHash },
      checkout.createdBy,
    );
  },
});

// Check if org has active subscription (members only)
export const isActive = query({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    // H-04 fix: subscription status is org data; require membership
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    return billingAccess(billing).isActive;
  },
});

// Get plan limits (for frontend display)
export const getPlanLimits = query({
  args: {},
  handler: async () => {
    return PLAN_LIMITS;
  },
});
