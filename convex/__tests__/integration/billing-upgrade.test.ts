import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { createTestBeneficiary, TEST_WALLETS } from "../factories";

describe("Integration: Billing Upgrade Flow", () => {
  it("trial -> starter -> team -> pro upgrade path", async () => {
    const t = convexTest(schema);

    // Step 1: Create org (starts with trial)
    await t.mutation(api.auth.generateNonce, {
      walletAddress: TEST_WALLETS.admin,
    });

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Upgrade Test Org",
      walletAddress: TEST_WALLETS.admin,
    });

    // Verify trial
    let billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(billing?.plan).toBe("trial");
    expect(billing?.limits.maxUsers).toBe(5); // Trial has team limits
    expect(billing?.limits.maxBeneficiaries).toBe(100);

    // Step 2: Upgrade to starter
    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      plan: "starter",
      txHash: "0xstarter_tx",
      paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(billing?.plan).toBe("starter");
    expect(billing?.status).toBe("active");
    expect(billing?.limits.maxUsers).toBe(1);
    expect(billing?.limits.maxBeneficiaries).toBe(25);

    // Step 3: Upgrade to team
    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      plan: "team",
      txHash: "0xteam_tx",
      paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(billing?.plan).toBe("team");
    expect(billing?.limits.maxUsers).toBe(5);
    expect(billing?.limits.maxBeneficiaries).toBe(100);

    // Step 4: Upgrade to pro
    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      plan: "pro",
      txHash: "0xpro_tx",
      paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
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
    await t.mutation(api.auth.generateNonce, {
      walletAddress: TEST_WALLETS.admin,
    });

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Limit Test Org",
      walletAddress: TEST_WALLETS.admin,
    });

    // Upgrade to starter
    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      plan: "starter",
      txHash: "0xstarter",
      paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
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
        walletAddress: TEST_WALLETS.admin,
        type: "individual",
        name: "One Too Many",
        beneficiaryAddress: "0x1111111111111111111111111111111111111111",
      })
    ).rejects.toThrow("maximum of 25 beneficiaries");

    // Upgrade to team
    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      plan: "team",
      txHash: "0xteam",
      paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    // Now should work
    const result = await t.mutation(api.beneficiaries.create, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      type: "individual",
      name: "Now It Works",
      beneficiaryAddress: "0x2222222222222222222222222222222222222222",
    });

    expect(result.beneficiaryId).toBeDefined();
  });

  it("hitting user limit triggers upgrade", async () => {
    const t = convexTest(schema);

    // Create org with starter plan
    await t.mutation(api.auth.generateNonce, {
      walletAddress: TEST_WALLETS.admin,
    });

    const orgResult = await t.mutation(api.orgs.create, {
      name: "User Limit Org",
      walletAddress: TEST_WALLETS.admin,
    });

    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      plan: "starter",
      txHash: "0xstarter",
      paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    // Try to add second user (starter only allows 1)
    await expect(
      t.mutation(api.orgs.inviteMember, {
        orgId: orgResult.orgId as any,
        walletAddress: TEST_WALLETS.admin,
        memberWalletAddress: TEST_WALLETS.viewer,
        role: "viewer",
      })
    ).rejects.toThrow("maximum of 1 user");

    // Upgrade to team
    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      plan: "team",
      txHash: "0xteam",
      paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    // Now invite works
    const inviteResult = await t.mutation(api.orgs.inviteMember, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      memberWalletAddress: TEST_WALLETS.viewer,
      role: "viewer",
    });

    expect(inviteResult.membershipId).toBeDefined();
  });

  it("subscription expiration blocks actions", async () => {
    const t = convexTest(schema);

    // Create org with expired subscription
    await t.mutation(api.auth.generateNonce, {
      walletAddress: TEST_WALLETS.admin,
    });

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Expired Test Org",
      walletAddress: TEST_WALLETS.admin,
    });

    // Subscribe with already expired date
    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      plan: "starter",
      txHash: "0xexpired",
      paidThroughAt: Date.now() - 1000, // Already expired
    });

    // Verify isActive returns false
    const isActive = await t.query(api.billing.isActive, {
      orgId: orgResult.orgId as any,
    });

    expect(isActive).toBe(false);

    // Verify billing shows isActive false
    const billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(billing?.isActive).toBe(false);
    expect(billing?.daysRemaining).toBe(0);
  });

  it("trial expiration", async () => {
    const t = convexTest(schema);

    await t.mutation(api.auth.generateNonce, {
      walletAddress: TEST_WALLETS.admin,
    });

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Trial Expiry Org",
      walletAddress: TEST_WALLETS.admin,
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
    });

    expect(isActive).toBe(false);

    const billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(billing?.plan).toBe("trial");
    expect(billing?.isActive).toBe(false);
  });
});
