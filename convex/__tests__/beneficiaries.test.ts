import { convexTest } from "convex-test";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { api } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import schema from "../schema";
import {
  createTestUser,
  createTestOrg,
  createTestMembership,
  createTestBeneficiary,
  createFullOrgSetup,
  signIn,
  TEST_WALLETS,
} from "./factories";

const instances: Array<{ finishAllScheduledFunctions: (advanceTimers: () => void) => Promise<void> }> = [];
function createHarness() {
  const t = convexTest(schema);
  instances.push(t);
  return t;
}
async function drainScheduled() {
  for (const t of instances) await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  try { await drainScheduled(); }
  finally { instances.length = 0; vi.useRealTimers(); }
});

describe("Beneficiaries", () => {
  describe("create", () => {
    it("creates individual beneficiary", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const admin = await signIn(t, "admin");

      const result = await t.mutation(api.beneficiaries.create, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        type: "individual",
        name: "John Doe",
        beneficiaryAddress: "0x1234567890123456789012345678901234567890",
        notes: "Test beneficiary",
      });

      expect(result.beneficiaryId).toBeDefined();

      // Verify beneficiary was created
      await t.run(async (ctx) => {
        const beneficiary = await ctx.db.get(result.beneficiaryId as any) as Doc<"beneficiaries"> | null;
        expect(beneficiary).not.toBeNull();
        expect(beneficiary?.type).toBe("individual");
        expect(beneficiary?.name).toBe("John Doe");
        expect(beneficiary?.isActive).toBe(true);
      });

      await drainScheduled();
    });

    it("creates business beneficiary", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const admin = await signIn(t, "admin");

      const result = await t.mutation(api.beneficiaries.create, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        type: "business",
        name: "Acme Corp",
        beneficiaryAddress: "0x1234567890123456789012345678901234567890",
      });

      await t.run(async (ctx) => {
        const beneficiary = await ctx.db.get(result.beneficiaryId as any) as Doc<"beneficiaries"> | null;
        expect(beneficiary?.type).toBe("business");
        expect(beneficiary?.name).toBe("Acme Corp");
      });

      await drainScheduled();
    });

    it("normalizes wallet address to lowercase", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const admin = await signIn(t, "admin");

      const mixedCaseAddress = "0xABCDef1234567890123456789012345678901234";
      const result = await t.mutation(api.beneficiaries.create, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        type: "individual",
        name: "Test",
        beneficiaryAddress: mixedCaseAddress,
      });

      await t.run(async (ctx) => {
        const beneficiary = await ctx.db.get(result.beneficiaryId as any) as Doc<"beneficiaries"> | null;
        expect(beneficiary?.walletAddress).toBe(mixedCaseAddress.toLowerCase());
      });

      await drainScheduled();
    });

    it("rejects malformed beneficiary addresses", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const admin = await signIn(t, "admin");

      // H-03: full hex validation — not just a 0x prefix
      await expect(
        t.mutation(api.beneficiaries.create, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          type: "individual",
          name: "Bad Address",
          beneficiaryAddress: "0xnotavalidaddress",
        })
      ).rejects.toThrow(/Invalid beneficiary wallet address/);
    });

    it("allows admin to create", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          role: "admin",
        });
        orgId = setup.orgId;
      });

      const admin = await signIn(t, "admin");

      const result = await t.mutation(api.beneficiaries.create, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        type: "individual",
        name: "Test",
        beneficiaryAddress: "0x1234567890123456789012345678901234567890",
      });

      expect(result.beneficiaryId).toBeDefined();

      await drainScheduled();
    });

    it("allows initiator to create", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;

        const initiatorId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.initiator });
        await createTestMembership(ctx, orgId as any, initiatorId, { role: "initiator" });
      });

      const initiator = await signIn(t, "initiator");

      const result = await t.mutation(api.beneficiaries.create, {
        orgId: orgId! as any,
        sessionToken: initiator.sessionToken,
        type: "individual",
        name: "Test",
        beneficiaryAddress: "0x1234567890123456789012345678901234567890",
      });

      expect(result.beneficiaryId).toBeDefined();

      await drainScheduled();
    });

    it("allows clerk to create", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;

        const clerkId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.clerk });
        await createTestMembership(ctx, orgId as any, clerkId, { role: "clerk" });
      });

      const clerk = await signIn(t, "clerk");

      const result = await t.mutation(api.beneficiaries.create, {
        orgId: orgId! as any,
        sessionToken: clerk.sessionToken,
        type: "individual",
        name: "Test",
        beneficiaryAddress: "0x1234567890123456789012345678901234567890",
      });

      expect(result.beneficiaryId).toBeDefined();

      await drainScheduled();
    });

    it("rejects viewer role", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      const viewer = await signIn(t, "viewer");

      await expect(
        t.mutation(api.beneficiaries.create, {
          orgId: orgId! as any,
          sessionToken: viewer.sessionToken,
          type: "individual",
          name: "Test",
          beneficiaryAddress: "0x1234567890123456789012345678901234567890",
        })
      ).rejects.toThrow();
    });

    it("enforces starter tier limit (25 beneficiaries)", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "starter",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;

        // Create 25 beneficiaries (at limit)
        for (let i = 0; i < 25; i++) {
          await createTestBeneficiary(ctx, orgId as any);
        }
      });

      const admin = await signIn(t, "admin");

      // 26th should fail
      await expect(
        t.mutation(api.beneficiaries.create, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          type: "individual",
          name: "One Too Many",
          beneficiaryAddress: "0x1234567890123456789012345678901234567890",
        })
      ).rejects.toThrow("maximum of 25 beneficiaries");
    });

    it("enforces team tier limit (100 beneficiaries)", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "team",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;

        // Create 100 beneficiaries
        for (let i = 0; i < 100; i++) {
          await createTestBeneficiary(ctx, orgId as any);
        }
      });

      const admin = await signIn(t, "admin");

      // 101st should fail
      await expect(
        t.mutation(api.beneficiaries.create, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          type: "individual",
          name: "One Too Many",
          beneficiaryAddress: "0x1234567890123456789012345678901234567890",
        })
      ).rejects.toThrow("maximum of 100 beneficiaries");
    });

    it("allows unlimited beneficiaries for pro tier", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "pro",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;

        // Create many beneficiaries
        for (let i = 0; i < 110; i++) {
          await createTestBeneficiary(ctx, orgId as any);
        }
      });

      const admin = await signIn(t, "admin");

      // Should still work
      const result = await t.mutation(api.beneficiaries.create, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        type: "individual",
        name: "Another One",
        beneficiaryAddress: "0x1234567890123456789012345678901234567890",
      });

      expect(result.beneficiaryId).toBeDefined();

      await drainScheduled();
    });

    it("creates audit log", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const admin = await signIn(t, "admin");

      await t.mutation(api.beneficiaries.create, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        type: "individual",
        name: "Test",
        beneficiaryAddress: "0x1234567890123456789012345678901234567890",
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const createLog = logs.find((l) => l.action === "beneficiary.created");
        expect(createLog).toBeDefined();
        expect(createLog?.objectType).toBe("beneficiary");
      });

      await drainScheduled();
    });
  });

  describe("update", () => {
    it("updates directory fields and requests review of replacement payout details", async () => {
      const t = createHarness();

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any, {
          type: "individual",
          name: "Old Name",
          notes: "Old notes",
        });
      });

      const admin = await signIn(t, "admin");

      await t.mutation(api.beneficiaries.update, {
        beneficiaryId: beneficiaryId! as any,
        sessionToken: admin.sessionToken,
        type: "business",
        name: "New Name",
        beneficiaryAddress: "0x9999999999999999999999999999999999999999",
        notes: "New notes",
      });

      await t.run(async (ctx) => {
        const beneficiary = await ctx.db.get(beneficiaryId as any) as Doc<"beneficiaries"> | null;
        expect(beneficiary?.type).toBe("business");
        expect(beneficiary?.name).toBe("New Name");
        expect(beneficiary?.walletAddress).not.toBe("0x9999999999999999999999999999999999999999");
        expect(beneficiary?.pendingPayoutChangeId).toBeDefined();
        const request = await ctx.db.get(beneficiary!.pendingPayoutChangeId!);
        expect(request?.proposed.walletAddress).toBe("0x9999999999999999999999999999999999999999");
        expect(beneficiary?.notes).toBe("New notes");
      });
    });

    it("toggles active status", async () => {
      const t = createHarness();

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any, {
          isActive: true,
        });
      });

      const admin = await signIn(t, "admin");

      // Deactivate
      await t.mutation(api.beneficiaries.update, {
        beneficiaryId: beneficiaryId! as any,
        sessionToken: admin.sessionToken,
        isActive: false,
      });

      await t.run(async (ctx) => {
        const beneficiary = await ctx.db.get(beneficiaryId as any) as Doc<"beneficiaries"> | null;
        expect(beneficiary?.isActive).toBe(false);
      });

      // Reactivate
      await t.mutation(api.beneficiaries.update, {
        beneficiaryId: beneficiaryId! as any,
        sessionToken: admin.sessionToken,
        isActive: true,
      });

      await t.run(async (ctx) => {
        const beneficiary = await ctx.db.get(beneficiaryId as any) as Doc<"beneficiaries"> | null;
        expect(beneficiary?.isActive).toBe(true);
      });
    });

    it("rejects viewer role", async () => {
      const t = createHarness();

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      const viewer = await signIn(t, "viewer");

      await expect(
        t.mutation(api.beneficiaries.update, {
          beneficiaryId: beneficiaryId! as any,
          sessionToken: viewer.sessionToken,
          name: "Hacked Name",
        })
      ).rejects.toThrow();
    });

    it("creates audit log", async () => {
      const t = createHarness();

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
      });

      const admin = await signIn(t, "admin");

      await t.mutation(api.beneficiaries.update, {
        beneficiaryId: beneficiaryId! as any,
        sessionToken: admin.sessionToken,
        name: "Updated Name",
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const updateLog = logs.find((l) => l.action === "beneficiary.updated");
        expect(updateLog).toBeDefined();
      });
    });
  });

  describe("list", () => {
    it("returns all beneficiaries for org", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        await createTestBeneficiary(ctx, orgId as any, { name: "Ben 1" });
        await createTestBeneficiary(ctx, orgId as any, { name: "Ben 2" });
        await createTestBeneficiary(ctx, orgId as any, { name: "Ben 3" });
      });

      const admin = await signIn(t, "admin");

      const result = await t.query(api.beneficiaries.list, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
      });

      expect(result.length).toBe(3);
    });

    it("filters by activeOnly", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        await createTestBeneficiary(ctx, orgId as any, { isActive: true });
        await createTestBeneficiary(ctx, orgId as any, { isActive: true });
        await createTestBeneficiary(ctx, orgId as any, { isActive: false });
      });

      const admin = await signIn(t, "admin");

      const result = await t.query(api.beneficiaries.list, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        activeOnly: true,
      });

      expect(result.length).toBe(2);
      expect(result.every((b) => b.isActive)).toBe(true);
    });

    it("allows viewer to list", async () => {
      const t = createHarness();

      let orgId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;

        await createTestBeneficiary(ctx, orgId as any);

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      const viewer = await signIn(t, "viewer");

      const result = await t.query(api.beneficiaries.list, {
        orgId: orgId! as any,
        sessionToken: viewer.sessionToken,
      });

      expect(result.length).toBe(1);
    });
  });

  describe("get", () => {
    it("returns beneficiary with all fields", async () => {
      const t = createHarness();

      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        beneficiaryId = await createTestBeneficiary(ctx, setup.orgId as any, {
          type: "business",
          name: "Test Corp",
          notes: "Test notes",
        });
      });

      const admin = await signIn(t, "admin");

      const result = await t.query(api.beneficiaries.get, {
        beneficiaryId: beneficiaryId! as any,
        sessionToken: admin.sessionToken,
      });

      expect(result).not.toBeNull();
      expect(result?.type).toBe("business");
      expect(result?.name).toBe("Test Corp");
      expect(result?.notes).toBe("Test notes");
    });

    it("returns null for non-existent beneficiary", async () => {
      const t = createHarness();

      // Create then delete a beneficiary so we hold a well-formed ID that no
      // longer points at any document
      let ghostId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        ghostId = await createTestBeneficiary(ctx, setup.orgId as any);
        await ctx.db.delete(ghostId as any);
      });

      const admin = await signIn(t, "admin");

      const result = await t.query(api.beneficiaries.get, {
        beneficiaryId: ghostId! as any,
        sessionToken: admin.sessionToken,
      });

      expect(result).toBeNull();
    });
  });
});
