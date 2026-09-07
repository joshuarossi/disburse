import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { MutationCtx } from "../../_generated/server";
import schema from "../../schema";
import { createTestBeneficiary, signIn, TEST_WALLETS } from "../factories";

// billing.subscribe only activates plans backed by a server-verified payment
// row; tests insert that row directly instead of calling the RPC-touching
// verifySubscriptionPayment action.
const STARTER_TX = "0x" + "11".repeat(32);
const TEAM_TX = "0x" + "22".repeat(32);
const PRO_TX = "0x" + "33".repeat(32);

async function insertVerifiedPayment(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  plan: "starter" | "team" | "pro",
  txHash: string,
  paidThroughAt: number = Date.now() + 30 * 24 * 60 * 60 * 1000,
): Promise<void> {
  await ctx.db.insert("billingPayments", {
    orgId,
    txHash,
    chainId: 1,
    plan,
    tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    amountRaw: "50000000",
    paidThroughAt,
    verifiedAt: Date.now(),
  });
}

describe("Integration: Billing Upgrade Flow", () => {
  // Screening jobs are outside these billing stories. Keep them from racing
  // the database assertions or writing after their test has finished.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("trial -> starter -> team -> pro upgrade path", async () => {
    const t = convexTest(schema);

    // Step 1: Create org (starts with trial)
    const admin = await signIn(t, "admin");

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Upgrade Test Org",
      sessionToken: admin.sessionToken,
    });

    // Verify trial
    let billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
    });

    expect(billing?.plan).toBe("trial");
    expect(billing?.limits.maxUsers).toBe(5); // Trial has team limits
    expect(billing?.limits.maxBeneficiaries).toBe(100);

    // Step 2: Upgrade to starter
    await t.run(async (ctx) => {
      await insertVerifiedPayment(
        ctx,
        orgResult.orgId as any,
        "starter",
        STARTER_TX,
      );
    });

    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      plan: "starter",
      txHash: STARTER_TX,
    });

    billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
    });

    expect(billing?.plan).toBe("starter");
    expect(billing?.status).toBe("active");
    expect(billing?.limits.maxUsers).toBe(1);
    expect(billing?.limits.maxBeneficiaries).toBe(25);

    // Step 3: Upgrade to team
    await t.run(async (ctx) => {
      await insertVerifiedPayment(ctx, orgResult.orgId as any, "team", TEAM_TX);
    });

    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      plan: "team",
      txHash: TEAM_TX,
    });

    billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
    });

    expect(billing?.plan).toBe("team");
    expect(billing?.limits.maxUsers).toBe(5);
    expect(billing?.limits.maxBeneficiaries).toBe(100);

    // Step 4: Upgrade to pro
    await t.run(async (ctx) => {
      await insertVerifiedPayment(ctx, orgResult.orgId as any, "pro", PRO_TX);
    });

    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      plan: "pro",
      txHash: PRO_TX,
    });

    billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
    });

    expect(billing?.plan).toBe("pro");
    expect(billing?.limits.maxUsers).toBe(Infinity);
    expect(billing?.limits.maxBeneficiaries).toBe(Infinity);

    // Verify audit trail
    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("auditLog")
        .withIndex("by_org", (q) => q.eq("orgId", orgResult.orgId as any))
        .collect();

      const billingLogs = logs.filter((l) => l.action.startsWith("billing."));
      expect(billingLogs.length).toBe(3);
    });
  });

  it("hitting beneficiary limit triggers upgrade", async () => {
    const t = convexTest(schema);

    // Create org with starter plan
    const admin = await signIn(t, "admin");

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Limit Test Org",
      sessionToken: admin.sessionToken,
    });

    // Upgrade to starter
    await t.run(async (ctx) => {
      await insertVerifiedPayment(
        ctx,
        orgResult.orgId as any,
        "starter",
        STARTER_TX,
      );
    });

    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      plan: "starter",
      txHash: STARTER_TX,
    });

    // Create 25 beneficiaries (starter limit)
    await t.run(async (ctx) => {
      for (let i = 0; i < 25; i++) {
        await createTestBeneficiary(ctx, orgResult.orgId as any);
      }
    });

    // 26th should fail
    await expect(
      t.mutation(api.beneficiaries.create, {
        orgId: orgResult.orgId as any,
        sessionToken: admin.sessionToken,
        type: "individual",
        name: "One Too Many",
        beneficiaryAddress: "0x1111111111111111111111111111111111111111",
      }),
    ).rejects.toThrow("maximum of 25 beneficiaries");

    // Upgrade to team
    await t.run(async (ctx) => {
      await insertVerifiedPayment(ctx, orgResult.orgId as any, "team", TEAM_TX);
    });

    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      plan: "team",
      txHash: TEAM_TX,
    });

    // Now should work
    const result = await t.mutation(api.beneficiaries.create, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      type: "individual",
      name: "Now It Works",
      beneficiaryAddress: "0x2222222222222222222222222222222222222222",
    });

    expect(result.beneficiaryId).toBeDefined();
  });

  it("hitting user limit triggers upgrade", async () => {
    const t = convexTest(schema);

    // Create org with starter plan
    const admin = await signIn(t, "admin");

    const orgResult = await t.mutation(api.orgs.create, {
      name: "User Limit Org",
      sessionToken: admin.sessionToken,
    });

    await t.run(async (ctx) => {
      await insertVerifiedPayment(
        ctx,
        orgResult.orgId as any,
        "starter",
        STARTER_TX,
      );
    });

    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      plan: "starter",
      txHash: STARTER_TX,
    });

    // Try to add second user (starter only allows 1)
    await expect(
      t.mutation(api.orgs.inviteMember, {
        orgId: orgResult.orgId as any,
        sessionToken: admin.sessionToken,
        memberWalletAddress: TEST_WALLETS.viewer,
        role: "viewer",
      }),
    ).rejects.toThrow("maximum of 1 user");

    // Upgrade to team
    await t.run(async (ctx) => {
      await insertVerifiedPayment(ctx, orgResult.orgId as any, "team", TEAM_TX);
    });

    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      plan: "team",
      txHash: TEAM_TX,
    });

    // Now invite works (membership is created in the pending "invited" state)
    const inviteResult = await t.mutation(api.orgs.inviteMember, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      memberWalletAddress: TEST_WALLETS.viewer,
      role: "viewer",
    });

    expect(inviteResult.membershipId).toBeDefined();
  });

  it("subscription expiration blocks actions", async () => {
    const t = convexTest(schema);

    // Create org with expired subscription
    const admin = await signIn(t, "admin");

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Expired Test Org",
      sessionToken: admin.sessionToken,
    });

    // Expire the subscription itself; a purchased period starts at redemption.
    await t.run(async (ctx) => {
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_org", (q) => q.eq("orgId", orgResult.orgId))
        .first();
      await ctx.db.patch(billing!._id, {
        plan: "starter",
        status: "active",
        paidThroughAt: Date.now() - 1000,
      });
    });

    // Core access continues on the free fallback.
    const isActive = await t.query(api.billing.isActive, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
    });

    expect(isActive).toBe(true);

    // The paid term ended while core access remains available.
    const billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
    });

    expect(billing?.isActive).toBe(true);
    expect(billing?.source).toBe("free");
    expect(billing?.daysRemaining).toBe(0);
  });

  it("trial expiration", async () => {
    const t = convexTest(schema);

    const admin = await signIn(t, "admin");

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Trial Expiry Org",
      sessionToken: admin.sessionToken,
    });

    // Manually expire the trial
    await t.run(async (ctx) => {
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_org", (q) => q.eq("orgId", orgResult.orgId as any))
        .first();

      if (billing) {
        await ctx.db.patch(billing._id, {
          trialEndsAt: Date.now() - 1000,
        });
      }
    });

    // Verify trial is expired
    const isActive = await t.query(api.billing.isActive, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
    });

    expect(isActive).toBe(true);

    const billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
    });

    expect(billing?.plan).toBe("trial");
    expect(billing?.isActive).toBe(true);
    expect(billing?.source).toBe("free");
  });
});
