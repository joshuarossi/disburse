import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  createTestUser,
  createTestOrg,
  createTestMembership,
  createFullOrgSetup,
  TEST_WALLETS,
} from "./factories";

describe("Billing", () => {
  describe("get", () => {
    it("returns billing info with limits for trial plan", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          plan: "trial",
        });
        orgId = setup.orgId;
      });

      const result = await t.query(api.billing.get, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result).not.toBeNull();
      expect(result?.plan).toBe("trial");
      expect(result?.status).toBe("trial");
      expect(result?.limits).toBeDefined();
      expect(result?.limits.maxUsers).toBe(5); // Trial has Team-level limits
      expect(result?.limits.maxBeneficiaries).toBe(100);
    });

    it("returns correct limits for starter plan", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "starter",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;
      });

      const result = await t.query(api.billing.get, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result?.plan).toBe("starter");
      expect(result?.limits.maxUsers).toBe(1);
      expect(result?.limits.maxBeneficiaries).toBe(25);
    });

    it("returns correct limits for team plan", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "team",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;
      });

      const result = await t.query(api.billing.get, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result?.plan).toBe("team");
      expect(result?.limits.maxUsers).toBe(5);
      expect(result?.limits.maxBeneficiaries).toBe(100);
    });

    it("returns correct limits for pro plan", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "pro",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;
      });

      const result = await t.query(api.billing.get, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result?.plan).toBe("pro");
      expect(result?.limits.maxUsers).toBe(Infinity);
      expect(result?.limits.maxBeneficiaries).toBe(Infinity);
    });

    it("calculates days remaining correctly", async () => {
      const t = convexTest(schema);
      const daysUntilExpiry = 15;
      const trialEndsAt = Date.now() + daysUntilExpiry * 24 * 60 * 60 * 1000;

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "trial",
          trialEndsAt,
          billingStatus: "trial",
        });
        orgId = id;
      });

      const result = await t.query(api.billing.get, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result?.daysRemaining).toBe(daysUntilExpiry);
      expect(result?.isActive).toBe(true);
    });

    it("returns isActive false for expired trial", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "trial",
          trialEndsAt: Date.now() - 1000, // Expired
          billingStatus: "trial",
        });
        orgId = id;
      });

      const result = await t.query(api.billing.get, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result?.isActive).toBe(false);
      expect(result?.daysRemaining).toBe(0);
    });
  });

  describe("subscribe", () => {
    it("updates plan from trial to starter", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          plan: "trial",
        });
        orgId = setup.orgId;
      });

      const paidThroughAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const result = await t.mutation(api.billing.subscribe, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        plan: "starter",
        txHash: "0xtest123",
        paidThroughAt,
      });

      expect(result.success).toBe(true);

      // Verify billing updated
      const billing = await t.query(api.billing.get, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(billing?.plan).toBe("starter");
      expect(billing?.status).toBe("active");
    });

    it("upgrades from starter to team", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "starter",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;
      });

      const paidThroughAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      await t.mutation(api.billing.subscribe, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        plan: "team",
        txHash: "0xtest456",
        paidThroughAt,
      });

      const billing = await t.query(api.billing.get, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(billing?.plan).toBe("team");
    });

    it("creates audit log on subscription", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          plan: "trial",
        });
        orgId = setup.orgId;
      });

      await t.mutation(api.billing.subscribe, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        plan: "pro",
        txHash: "0xtest789",
        paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      // Verify audit log
      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const subscribeLog = logs.find((l) => l.action === "billing.subscribed");
        expect(subscribeLog).toBeDefined();
        expect(subscribeLog?.metadata?.newPlan).toBe("pro");
        expect(subscribeLog?.metadata?.previousPlan).toBe("trial");
      });
    });

    it("rejects non-admin users", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId, { plan: "trial" });
        orgId = id;

        // Add viewer
        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      await expect(
        t.mutation(api.billing.subscribe, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.viewer,
          plan: "starter",
          txHash: "0xtest",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        })
      ).rejects.toThrow();
    });
  });

  describe("isActive", () => {
    it("returns true for active trial", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, { plan: "trial" });
        orgId = setup.orgId;
      });

      const result = await t.query(api.billing.isActive, {
        orgId: orgId! as any,
      });

      expect(result).toBe(true);
    });

    it("returns false for expired trial", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx);
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "trial",
          trialEndsAt: Date.now() - 1000,
          billingStatus: "trial",
        });
        orgId = id;
      });

      const result = await t.query(api.billing.isActive, {
        orgId: orgId! as any,
      });

      expect(result).toBe(false);
    });

    it("returns true for active subscription", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx);
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "pro",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;
      });

      const result = await t.query(api.billing.isActive, {
        orgId: orgId! as any,
      });

      expect(result).toBe(true);
    });

    it("returns false for expired subscription", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx);
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "pro",
          paidThroughAt: Date.now() - 1000,
          billingStatus: "active",
        });
        orgId = id;
      });

      const result = await t.query(api.billing.isActive, {
        orgId: orgId! as any,
      });

      expect(result).toBe(false);
    });

    it("returns false when no billing record exists", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx);
        // Create org without billing (manually)
        orgId = await ctx.db.insert("orgs", {
          name: "Test Org",
          createdBy: userId,
          createdAt: Date.now(),
        });
      });

      const result = await t.query(api.billing.isActive, {
        orgId: orgId! as any,
      });

      expect(result).toBe(false);
    });
  });

  describe("getPlanLimits", () => {
    it("returns all plan limits", async () => {
      const t = convexTest(schema);

      const limits = await t.query(api.billing.getPlanLimits, {});

      expect(limits).toBeDefined();
      expect(limits.trial).toBeDefined();
      expect(limits.starter).toBeDefined();
      expect(limits.team).toBeDefined();
      expect(limits.pro).toBeDefined();

      // Verify correct values
      expect(limits.starter.maxUsers).toBe(1);
      expect(limits.starter.maxBeneficiaries).toBe(25);
      expect(limits.starter.price).toBe(25);

      expect(limits.team.maxUsers).toBe(5);
      expect(limits.team.maxBeneficiaries).toBe(100);
      expect(limits.team.price).toBe(50);

      expect(limits.pro.maxUsers).toBe(Infinity);
      expect(limits.pro.maxBeneficiaries).toBe(Infinity);
      expect(limits.pro.price).toBe(99);
    });
  });
});
