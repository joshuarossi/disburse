import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import schema from "../schema";
import {
  createTestUser,
  createTestOrg,
  createTestMembership,
  createTestSafe,
  createTestBeneficiary,
  createTestDisbursement,
  createFullOrgSetup,
  TEST_WALLETS,
} from "./factories";

describe("Disbursements", () => {
  describe("create", () => {
    it("creates draft disbursement", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
      });

      const result = await t.mutation(api.disbursements.create, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        beneficiaryId: beneficiaryId! as any,
        token: "USDC",
        amount: "100",
        memo: "Test payment",
      });

      expect(result.disbursementId).toBeDefined();

      // Verify disbursement created
      await t.run(async (ctx) => {
        const disbursement = await ctx.db.get(result.disbursementId as any) as Doc<"disbursements"> | null;
        expect(disbursement).not.toBeNull();
        expect(disbursement?.status).toBe("draft");
        expect(disbursement?.token).toBe("USDC");
        expect(disbursement?.amount).toBe("100");
        expect(disbursement?.memo).toBe("Test payment");
      });
    });

    it("requires linked Safe", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        // Create org WITHOUT Safe
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId);
        orgId = id;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
      });

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.admin,
          beneficiaryId: beneficiaryId! as any,
          token: "USDC",
          amount: "100",
        })
      ).rejects.toThrow("No Safe linked");
    });

    it("requires active beneficiary", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any, {
          isActive: false, // Inactive!
        });
      });

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.admin,
          beneficiaryId: beneficiaryId! as any,
          token: "USDC",
          amount: "100",
        })
      ).rejects.toThrow("Beneficiary is not active");
    });

    it("rejects beneficiary from different org", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let otherBeneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        // Create another org with a beneficiary
        const otherUserId = await createTestUser(ctx);
        const { orgId: otherOrgId } = await createTestOrg(ctx, otherUserId);
        otherBeneficiaryId = await createTestBeneficiary(ctx, otherOrgId as any);
      });

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.admin,
          beneficiaryId: otherBeneficiaryId! as any,
          token: "USDC",
          amount: "100",
        })
      ).rejects.toThrow("Invalid beneficiary");
    });

    it("allows admin to create", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          role: "admin",
        });
        orgId = setup.orgId;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
      });

      const result = await t.mutation(api.disbursements.create, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        beneficiaryId: beneficiaryId! as any,
        token: "USDC",
        amount: "100",
      });

      expect(result.disbursementId).toBeDefined();
    });

    it("allows initiator to create", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;
        await createTestSafe(ctx, orgId as any);
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);

        const initiatorId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.initiator });
        await createTestMembership(ctx, orgId as any, initiatorId, { role: "initiator" });
      });

      const result = await t.mutation(api.disbursements.create, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.initiator,
        beneficiaryId: beneficiaryId! as any,
        token: "USDC",
        amount: "100",
      });

      expect(result.disbursementId).toBeDefined();
    });

    it("rejects clerk role", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;
        await createTestSafe(ctx, orgId as any);
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);

        const clerkId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.clerk });
        await createTestMembership(ctx, orgId as any, clerkId, { role: "clerk" });
      });

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.clerk,
          beneficiaryId: beneficiaryId! as any,
          token: "USDC",
          amount: "100",
        })
      ).rejects.toThrow();
    });

    it("rejects viewer role", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;
        await createTestSafe(ctx, orgId as any);
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.viewer,
          beneficiaryId: beneficiaryId! as any,
          token: "USDC",
          amount: "100",
        })
      ).rejects.toThrow();
    });

    it("creates audit log", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
      });

      await t.mutation(api.disbursements.create, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        beneficiaryId: beneficiaryId! as any,
        token: "USDC",
        amount: "100",
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const createLog = logs.find((l) => l.action === "disbursement.created");
        expect(createLog).toBeDefined();
        expect(createLog?.metadata?.token).toBe("USDC");
        expect(createLog?.metadata?.amount).toBe("100");
      });
    });
  });

  describe("updateStatus", () => {
    it("updates status to proposed with safeTxHash", async () => {
      const t = convexTest(schema);

      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const beneficiaryId = await createTestBeneficiary(ctx, setup.orgId as any);
        disbursementId = await createTestDisbursement(
          ctx,
          setup.orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId,
          { status: "draft" }
        );
      });

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        walletAddress: TEST_WALLETS.admin,
        status: "proposed",
        safeTxHash: "0xsafetxhash123",
      });

      await t.run(async (ctx) => {
        const disbursement = await ctx.db.get(disbursementId as any) as Doc<"disbursements"> | null;
        expect(disbursement?.status).toBe("proposed");
        expect(disbursement?.safeTxHash).toBe("0xsafetxhash123");
      });
    });

    it("updates status to executed with txHash", async () => {
      const t = convexTest(schema);

      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const beneficiaryId = await createTestBeneficiary(ctx, setup.orgId as any);
        disbursementId = await createTestDisbursement(
          ctx,
          setup.orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId,
          { status: "proposed", safeTxHash: "0xsafetxhash123" }
        );
      });

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        walletAddress: TEST_WALLETS.admin,
        status: "executed",
        txHash: "0xrealtxhash456",
      });

      await t.run(async (ctx) => {
        const disbursement = await ctx.db.get(disbursementId as any) as Doc<"disbursements"> | null;
        expect(disbursement?.status).toBe("executed");
        expect(disbursement?.txHash).toBe("0xrealtxhash456");
      });
    });

    it("updates status to failed", async () => {
      const t = convexTest(schema);

      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const beneficiaryId = await createTestBeneficiary(ctx, setup.orgId as any);
        disbursementId = await createTestDisbursement(
          ctx,
          setup.orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId,
          { status: "proposed" }
        );
      });

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        walletAddress: TEST_WALLETS.admin,
        status: "failed",
      });

      await t.run(async (ctx) => {
        const disbursement = await ctx.db.get(disbursementId as any) as Doc<"disbursements"> | null;
        expect(disbursement?.status).toBe("failed");
      });
    });

    it("updates status to cancelled", async () => {
      const t = convexTest(schema);

      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const beneficiaryId = await createTestBeneficiary(ctx, setup.orgId as any);
        disbursementId = await createTestDisbursement(
          ctx,
          setup.orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId,
          { status: "draft" }
        );
      });

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        walletAddress: TEST_WALLETS.admin,
        status: "cancelled",
      });

      await t.run(async (ctx) => {
        const disbursement = await ctx.db.get(disbursementId as any) as Doc<"disbursements"> | null;
        expect(disbursement?.status).toBe("cancelled");
      });
    });

    it("creates audit log for status changes", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        const beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
        disbursementId = await createTestDisbursement(
          ctx,
          orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId
        );
      });

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        walletAddress: TEST_WALLETS.admin,
        status: "proposed",
        safeTxHash: "0xhash",
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const statusLog = logs.find((l) => l.action === "disbursement.proposed");
        expect(statusLog).toBeDefined();
        expect(statusLog?.metadata?.safeTxHash).toBe("0xhash");
      });
    });

    it("rejects non-member", async () => {
      const t = convexTest(schema);

      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const beneficiaryId = await createTestBeneficiary(ctx, setup.orgId as any);
        disbursementId = await createTestDisbursement(
          ctx,
          setup.orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId
        );

        // Create non-member user
        await createTestUser(ctx, { walletAddress: TEST_WALLETS.nonMember });
      });

      await expect(
        t.mutation(api.disbursements.updateStatus, {
          disbursementId: disbursementId! as any,
          walletAddress: TEST_WALLETS.nonMember,
          status: "proposed",
        })
      ).rejects.toThrow();
    });
  });

  describe("list", () => {
    it("returns disbursements with beneficiary data", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const beneficiaryId = await createTestBeneficiary(ctx, orgId as any, {
          name: "Test Recipient",
        });
        await createTestDisbursement(
          ctx,
          orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId
        );
      });

      const result = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].beneficiary).not.toBeNull();
      expect(result.items[0].beneficiary?.name).toBe("Test Recipient");
    });

    it("filters by status", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
        await createTestDisbursement(ctx, orgId as any, setup.safeId as any, beneficiaryId as any, setup.userId, { status: "draft" });
        await createTestDisbursement(ctx, orgId as any, setup.safeId as any, beneficiaryId as any, setup.userId, { status: "proposed" });
        await createTestDisbursement(ctx, orgId as any, setup.safeId as any, beneficiaryId as any, setup.userId, { status: "executed" });
      });

      const drafts = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        status: ["draft"],
      });

      expect(drafts.items.length).toBe(1);
      expect(drafts.items[0].status).toBe("draft");
    });

    it("respects limit", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
        for (let i = 0; i < 10; i++) {
          await createTestDisbursement(
            ctx,
            orgId as any,
            setup.safeId as any,
            beneficiaryId as any,
            setup.userId
          );
        }
      });

      const result = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        limit: 5,
      });

      expect(result.items.length).toBe(5);
      expect(result.totalCount).toBe(10);
      expect(result.hasMore).toBe(true);
    });

    it("allows viewer to list", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
        await createTestDisbursement(ctx, orgId as any, setup.safeId as any, beneficiaryId as any, setup.userId);

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      const result = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.viewer,
      });

      expect(result.items.length).toBe(1);
    });
  });

  describe("get", () => {
    it("returns disbursement with beneficiary", async () => {
      const t = convexTest(schema);

      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const beneficiaryId = await createTestBeneficiary(ctx, setup.orgId as any, {
          name: "John Doe",
        });
        disbursementId = await createTestDisbursement(
          ctx,
          setup.orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId,
          { amount: "500", token: "USDT", memo: "Payment" }
        );
      });

      const result = await t.query(api.disbursements.get, {
        disbursementId: disbursementId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result).not.toBeNull();
      expect(result?.amount).toBe("500");
      expect(result?.token).toBe("USDT");
      expect(result?.memo).toBe("Payment");
      expect(result?.beneficiary?.name).toBe("John Doe");
    });

    it("returns null for non-existent disbursement", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
      });

      const result = await t.query(api.disbursements.get, {
        disbursementId: "fake_id" as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result).toBeNull();
    });
  });
});
