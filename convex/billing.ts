import { appendAudit } from "./audit";
import { v } from "convex/values";
import { mutation, query, action, internalQuery, internalMutation } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import { Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { createPublicClient, http } from "viem";
import { isValidTxHash } from "./lib/validation";

// Plan types
export type PlanType = "trial" | "starter" | "team" | "pro";

// Tier limits configuration
export const PLAN_LIMITS = {
  trial: {
    maxUsers: 5, // Same as Team tier during trial
    maxBeneficiaries: 100,
    price: 0,
  },
  starter: {
    maxUsers: 1,
    maxBeneficiaries: 25,
    price: 25,
  },
  team: {
    maxUsers: 5,
    maxBeneficiaries: 100,
    price: 50,
  },
  pro: {
    maxUsers: Infinity,
    maxBeneficiaries: Infinity,
    price: 99,
  },
} as const;

// Helper to get tier limits for an org
export async function getOrgLimits(ctx: QueryCtx, orgId: Id<"orgs">) {
  const billing = await ctx.db
    .query("billing")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();

  if (!billing) {
    return PLAN_LIMITS.trial;
  }

  // Check if trial/subscription is still active
  const now = Date.now();
  if (billing.status === "trial" && billing.trialEndsAt && now > billing.trialEndsAt) {
    // Trial expired - return most restrictive limits
    return { maxUsers: 0, maxBeneficiaries: 0, price: 0 };
  }
  if (billing.status === "active" && billing.paidThroughAt && now > billing.paidThroughAt) {
    // Subscription expired - return most restrictive limits
    return { maxUsers: 0, maxBeneficiaries: 0, price: 0 };
  }

  return PLAN_LIMITS[billing.plan] || PLAN_LIMITS.trial;
}

// Get billing info for an org
export const get = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {

    // Any member can view billing
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin", "approver", "initiator", "clerk", "viewer"]);

    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (!billing) {
      return null;
    }

    // Calculate days remaining
    const now = Date.now();
    let daysRemaining = 0;
    let isActive = false;

    if (billing.status === "trial" && billing.trialEndsAt) {
      daysRemaining = Math.max(0, Math.ceil((billing.trialEndsAt - now) / (24 * 60 * 60 * 1000)));
      isActive = daysRemaining > 0;
    } else if (billing.status === "active" && billing.paidThroughAt) {
      daysRemaining = Math.max(0, Math.ceil((billing.paidThroughAt - now) / (24 * 60 * 60 * 1000)));
      isActive = daysRemaining > 0;
    }

    // Get limits for current plan
    const limits = PLAN_LIMITS[billing.plan] || PLAN_LIMITS.trial;

    return {
      ...billing,
      daysRemaining,
      isActive,
      limits,
    };
  },
});

// ─── Subscription payment verification (C-03 fix) ────────────────────────────
// Plans are activated ONLY after an on-chain USDC transfer to the Disburse
// treasury address has been verified against the claimed txHash. The client
// can no longer declare its own paidThroughAt.

// ERC-20 Transfer event topic (keccak256("Transfer(address,address,address)"))
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const PAYMENT_TOKEN_BY_CHAIN: Record<number, string> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC (Ethereum mainnet)
};

const RPC_URL_BY_CHAIN: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
};

export const PLAN_PERIOD_DAYS = 30;

function getTreasuryAddress(): string {
  const raw = (
    process.env.DISBURSE_BENEFICIARY_ADDRESS ??
    process.env.VITE_DISBURSE_BENEFICIARY_ADDRESS ??
    ""
  )
    .toString()
    .trim();
  if (!raw.startsWith("0x") || raw.length !== 42) {
    throw new Error(
      "Subscription payments are not configured (missing DISBURSE_BENEFICIARY_ADDRESS)"
    );
  }
  return raw.toLowerCase();
}

function getPaymentChainId(): number {
  const raw = (
    process.env.DISBURSE_BENEFICIARY_CHAIN_ID ??
    process.env.VITE_DISBURSE_BENEFICIARY_CHAIN_ID ??
    "1"
  ).toString();
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// Admin gate for billing actions (actions cannot touch the DB directly)
export const assertBillingAdmin = internalQuery({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin"]);
    return { ok: true };
  },
});

// Persist a verified payment. Internal so only the verification action writes it.
export const recordVerifiedPayment = internalMutation({
  args: {
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
      .withIndex("by_tx", (q) => q.eq("txHash", args.txHash))
      .first();
    if (existing) {
      throw new Error("Payment transaction has already been used");
    }

    const now = Date.now();
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
    await ctx.runQuery(internal.billing.assertBillingAdmin, {
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

    const rpcUrl =
      process.env[`RPC_URL_${chainId}` as "RPC_URL_1"] ?? RPC_URL_BY_CHAIN[chainId];
    if (!rpcUrl) {
      throw new Error(`No RPC configured for chain ${chainId}`);
    }

    const client = createPublicClient({ transport: http(rpcUrl) });

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({
        hash: args.txHash as `0x${string}`,
      });
    } catch {
      throw new Error(
        "Transaction not found or not yet confirmed. Try again after it is mined."
      );
    }

    if (receipt.status !== "success") {
      throw new Error("Payment transaction reverted");
    }

    // Reject stale payments (7 days) so old transfers can't be replayed later
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const ageSeconds = Date.now() / 1000 - Number(block.timestamp);
    if (ageSeconds > 7 * 24 * 60 * 60) {
      throw new Error("Payment transaction is older than 7 days");
    }

    // Sum ERC-20 Transfer logs to the treasury for this token
    const toPadded = "0x" + treasury.replace("0x", "").padStart(64, "0");
    let amountRaw = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) continue;
      if ((log.topics[0] ?? "") !== TRANSFER_TOPIC) continue;
      if ((log.topics[2] ?? "").toLowerCase() !== toPadded) continue;
      amountRaw += BigInt(log.data);
    }

    const requiredRaw =
      BigInt(Math.round(PLAN_LIMITS[args.plan].price)) * 1_000_000n; // USDC = 6 decimals
    if (amountRaw < requiredRaw) {
      throw new Error(
        `Payment insufficient: received ${amountRaw} base units, required ${requiredRaw}`
      );
    }

    await ctx.runMutation(internal.billing.recordVerifiedPayment, {
      orgId: args.orgId,
      txHash: args.txHash,
      chainId,
      plan: args.plan,
      tokenAddress,
      amountRaw: amountRaw.toString(),
    });

    return { verified: true };
  },
});

// Subscribe to a plan — requires a server-verified on-chain payment.
export const subscribe = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    plan: v.union(
      v.literal("starter"),
      v.literal("team"),
      v.literal("pro")
    ),
    txHash: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Only admin can change subscription
    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin"]);

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
      .withIndex("by_tx", (q) => q.eq("txHash", args.txHash))
      .first();

    if (!payment) {
      throw new Error(
        "Payment not verified. Call verifySubscriptionPayment first; the transaction must transfer the plan price to the Disburse treasury."
      );
    }
    if (payment.orgId !== args.orgId || payment.plan !== args.plan) {
      throw new Error("Verified payment does not match this organization or plan");
    }

    const previousPlan = billing.plan;

    await ctx.db.patch(billing._id, {
      plan: args.plan,
      status: "active",
      paidThroughAt: payment.paidThroughAt,
      updatedAt: now,
    });

    // Audit log
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "billing.subscribed",
      objectType: "billing",
      objectId: billing._id,
      metadata: {
        previousPlan,
        newPlan: args.plan,
        txHash: args.txHash,
        paidThroughAt: payment.paidThroughAt,
        price: PLAN_LIMITS[args.plan].price,
        serverVerified: true,
      },
      timestamp: now,
    });

    return { success: true };
  },
});

// Legacy alias: upgrade straight to pro. Same server-verified payment
// requirement as `subscribe` — the client can no longer self-declare payment.
export const upgradeToPro = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    txHash: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Only admin can upgrade
    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin"]);

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

    const payment = await ctx.db
      .query("billingPayments")
      .withIndex("by_tx", (q) => q.eq("txHash", args.txHash))
      .first();

    if (!payment || payment.orgId !== args.orgId || payment.plan !== "pro") {
      throw new Error(
        "Payment not verified for the pro plan. Call verifySubscriptionPayment first."
      );
    }

    await ctx.db.patch(billing._id, {
      plan: "pro",
      status: "active",
      paidThroughAt: payment.paidThroughAt,
      updatedAt: now,
    });

    // Audit log
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "billing.upgraded",
      objectType: "billing",
      objectId: billing._id,
      metadata: { txHash: args.txHash, paidThroughAt: payment.paidThroughAt, serverVerified: true },
      timestamp: now,
    });

    return { success: true };
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

    if (!billing) {
      return false;
    }

    const now = Date.now();

    if (billing.status === "trial" && billing.trialEndsAt) {
      return now < billing.trialEndsAt;
    }

    if (billing.status === "active" && billing.paidThroughAt) {
      return now < billing.paidThroughAt;
    }

    return false;
  },
});

// Get plan limits (for frontend display)
export const getPlanLimits = query({
  args: {},
  handler: async () => {
    return PLAN_LIMITS;
  },
});
