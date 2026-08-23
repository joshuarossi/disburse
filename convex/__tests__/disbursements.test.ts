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
  createTestBatchDisbursement,
  createFullOrgSetup,
  signIn,
  TEST_WALLETS,
} from "./factories";

// updateStatus hash-integrity validation requires well-formed 32-byte hashes
const SAFE_TX_HASH = "0x" + "ab".repeat(32);
const TX_HASH = "0x" + "cd".repeat(32);

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

      const admin = await signIn(t, "admin");

      const result = await t.mutation(api.disbursements.create, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        chainId: 11155111,
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

      const admin = await signIn(t, "admin");

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          chainId: 11155111,
          beneficiaryId: beneficiaryId! as any,
          token: "USDC",
          amount: "100",
        })
      ).rejects.toThrow(/No Safe linked/);
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

      const admin = await signIn(t, "admin");

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          chainId: 11155111,
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

      const admin = await signIn(t, "admin");

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          chainId: 11155111,
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

      const admin = await signIn(t, "admin");

      const result = await t.mutation(api.disbursements.create, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        chainId: 11155111,
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

      const initiator = await signIn(t, "initiator");

      const result = await t.mutation(api.disbursements.create, {
        orgId: orgId! as any,
        sessionToken: initiator.sessionToken,
        chainId: 11155111,
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

      const clerk = await signIn(t, "clerk");

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          sessionToken: clerk.sessionToken,
          chainId: 11155111,
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

      const viewer = await signIn(t, "viewer");

      await expect(
        t.mutation(api.disbursements.create, {
          orgId: orgId! as any,
          sessionToken: viewer.sessionToken,
          chainId: 11155111,
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

      const admin = await signIn(t, "admin");

      await t.mutation(api.disbursements.create, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        chainId: 11155111,
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

      const admin = await signIn(t, "admin");

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        sessionToken: admin.sessionToken,
        status: "proposed",
        safeTxHash: SAFE_TX_HASH,
      });

      await t.run(async (ctx) => {
        const disbursement = await ctx.db.get(disbursementId as any) as Doc<"disbursements"> | null;
        expect(disbursement?.status).toBe("proposed");
        expect(disbursement?.safeTxHash).toBe(SAFE_TX_HASH);
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
          { status: "proposed", safeTxHash: SAFE_TX_HASH }
        );
      });

      const admin = await signIn(t, "admin");

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        sessionToken: admin.sessionToken,
        status: "executed",
        txHash: TX_HASH,
      });

      await t.run(async (ctx) => {
        const disbursement = await ctx.db.get(disbursementId as any) as Doc<"disbursements"> | null;
        expect(disbursement?.status).toBe("executed");
        expect(disbursement?.txHash).toBe(TX_HASH);
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

      const admin = await signIn(t, "admin");

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        sessionToken: admin.sessionToken,
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

      const admin = await signIn(t, "admin");

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        sessionToken: admin.sessionToken,
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

      const admin = await signIn(t, "admin");

      await t.mutation(api.disbursements.updateStatus, {
        disbursementId: disbursementId! as any,
        sessionToken: admin.sessionToken,
        status: "proposed",
        safeTxHash: SAFE_TX_HASH,
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const statusLog = logs.find((l) => l.action === "disbursement.proposed");
        expect(statusLog).toBeDefined();
        expect(statusLog?.metadata?.safeTxHash).toBe(SAFE_TX_HASH);
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

      const nonMember = await signIn(t, "nonMember");

      await expect(
        t.mutation(api.disbursements.updateStatus, {
          disbursementId: disbursementId! as any,
          sessionToken: nonMember.sessionToken,
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

      const admin = await signIn(t, "admin");

      const result = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
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

      const admin = await signIn(t, "admin");

      const drafts = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
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

      const admin = await signIn(t, "admin");

      const result = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
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

      const viewer = await signIn(t, "viewer");

      const result = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        sessionToken: viewer.sessionToken,
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

      const admin = await signIn(t, "admin");

      const result = await t.query(api.disbursements.get, {
        disbursementId: disbursementId! as any,
        sessionToken: admin.sessionToken,
      });

      expect(result).not.toBeNull();
      expect(result?.amount).toBe("500");
      expect(result?.token).toBe("USDT");
      expect(result?.memo).toBe("Payment");
      expect(result?.beneficiary?.name).toBe("John Doe");
    });

    it("returns null for non-existent disbursement", async () => {
      const t = convexTest(schema);

      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const beneficiaryId = await createTestBeneficiary(ctx, setup.orgId as any);
        // Create then delete so we hold a well-formed ID that no longer exists
        const id = await createTestDisbursement(
          ctx,
          setup.orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId
        );
        await ctx.db.delete(id as any);
        disbursementId = id;
      });

      const admin = await signIn(t, "admin");

      const result = await t.query(api.disbursements.get, {
        disbursementId: disbursementId! as any,
        sessionToken: admin.sessionToken,
      });

      expect(result).toBeNull();
    });
  });

  describe("createBatch", () => {
    it("creates batch disbursement with multiple recipients", async () => {
      const t = convexTest(schema);

      let orgId: string;
      const beneficiaryIds: string[] = [];
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        
        // Create multiple beneficiaries
        beneficiaryIds.push(await createTestBeneficiary(ctx, orgId as any, { name: "Beneficiary 1" }));
        beneficiaryIds.push(await createTestBeneficiary(ctx, orgId as any, { name: "Beneficiary 2" }));
        beneficiaryIds.push(await createTestBeneficiary(ctx, orgId as any, { name: "Beneficiary 3" }));
      });

      const admin = await signIn(t, "admin");

      const result = await t.mutation(api.disbursements.createBatch, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        chainId: 11155111,
        token: "USDC",
        recipients: [
          { beneficiaryId: beneficiaryIds[0] as any, amount: "100" },
          { beneficiaryId: beneficiaryIds[1] as any, amount: "200" },
          { beneficiaryId: beneficiaryIds[2] as any, amount: "300" },
        ],
        memo: "Batch payment",
      });

      expect(result.disbursementId).toBeDefined();

      // Verify disbursement created
      await t.run(async (ctx) => {
        const disbursement = await ctx.db.get(result.disbursementId as any) as Doc<"disbursements"> | null;
        expect(disbursement).not.toBeNull();
        expect(disbursement?.type).toBe("batch");
        expect(disbursement?.status).toBe("draft");
        expect(disbursement?.token).toBe("USDC");
        expect(disbursement?.totalAmount).toBe("600");
        expect(disbursement?.memo).toBe("Batch payment");
        expect(disbursement?.beneficiaryId).toBeUndefined();
        expect(disbursement?.amount).toBeUndefined();

        // Verify recipients created
        const recipients = await ctx.db
          .query("disbursementRecipients")
          .withIndex("by_disbursement", (q) => q.eq("disbursementId", result.disbursementId as any))
          .collect();
        
        expect(recipients.length).toBe(3);
        expect(recipients[0].amount).toBe("100");
        expect(recipients[1].amount).toBe("200");
        expect(recipients[2].amount).toBe("300");
      });
    });

    it("requires at least one recipient", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const admin = await signIn(t, "admin");

      await expect(
        t.mutation(api.disbursements.createBatch, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          chainId: 11155111,
          token: "USDC",
          recipients: [],
        })
      ).rejects.toThrow("At least one recipient is required");
    });

    it("rejects duplicate beneficiaries", async () => {
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

      const admin = await signIn(t, "admin");

      await expect(
        t.mutation(api.disbursements.createBatch, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          chainId: 11155111,
          token: "USDC",
          recipients: [
            { beneficiaryId: beneficiaryId! as any, amount: "100" },
            { beneficiaryId: beneficiaryId! as any, amount: "200" }, // Duplicate!
          ],
        })
      ).rejects.toThrow("Duplicate beneficiaries");
    });

    it("rejects invalid amounts", async () => {
      const t = convexTest(schema);

      let orgId: string;
      const beneficiaryIds: string[] = [];
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        beneficiaryIds.push(await createTestBeneficiary(ctx, orgId as any));
        beneficiaryIds.push(await createTestBeneficiary(ctx, orgId as any));
      });

      const admin = await signIn(t, "admin");

      // Test zero amount
      await expect(
        t.mutation(api.disbursements.createBatch, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          chainId: 11155111,
          token: "USDC",
          recipients: [
            { beneficiaryId: beneficiaryIds[0] as any, amount: "0" },
          ],
        })
      ).rejects.toThrow();

      // Test negative amount
      await expect(
        t.mutation(api.disbursements.createBatch, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          chainId: 11155111,
          token: "USDC",
          recipients: [
            { beneficiaryId: beneficiaryIds[0] as any, amount: "-10" },
          ],
        })
      ).rejects.toThrow();
    });

    it("requires active beneficiaries", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any, {
          isActive: false,
        });
      });

      const admin = await signIn(t, "admin");

      await expect(
        t.mutation(api.disbursements.createBatch, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          chainId: 11155111,
          token: "USDC",
          recipients: [
            { beneficiaryId: beneficiaryId! as any, amount: "100" },
          ],
        })
      ).rejects.toThrow("Beneficiary is not active");
    });

    it("requires linked Safe", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let beneficiaryId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId);
        orgId = id;
        beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
      });

      const admin = await signIn(t, "admin");

      await expect(
        t.mutation(api.disbursements.createBatch, {
          orgId: orgId! as any,
          sessionToken: admin.sessionToken,
          chainId: 11155111,
          token: "USDC",
          recipients: [
            { beneficiaryId: beneficiaryId! as any, amount: "100" },
          ],
        })
      ).rejects.toThrow(/No Safe linked/);
    });

    it("creates audit log", async () => {
      const t = convexTest(schema);

      let orgId: string;
      const beneficiaryIds: string[] = [];
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        beneficiaryIds.push(await createTestBeneficiary(ctx, orgId as any));
        beneficiaryIds.push(await createTestBeneficiary(ctx, orgId as any));
      });

      const admin = await signIn(t, "admin");

      await t.mutation(api.disbursements.createBatch, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        chainId: 11155111,
        token: "USDC",
        recipients: [
          { beneficiaryId: beneficiaryIds[0] as any, amount: "100" },
          { beneficiaryId: beneficiaryIds[1] as any, amount: "200" },
        ],
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const createLog = logs.find((l) => l.action === "disbursement.created");
        expect(createLog).toBeDefined();
        expect(createLog?.metadata?.type).toBe("batch");
        expect(createLog?.metadata?.token).toBe("USDC");
        expect(createLog?.metadata?.totalAmount).toBe("300");
        expect(createLog?.metadata?.recipientCount).toBe(2);
      });
    });
  });

  describe("getWithRecipients", () => {
    it("returns batch disbursement with recipients", async () => {
      const t = convexTest(schema);

      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const beneficiary1 = await createTestBeneficiary(ctx, setup.orgId as any, { name: "Ben 1" });
        const beneficiary2 = await createTestBeneficiary(ctx, setup.orgId as any, { name: "Ben 2" });
        
        const { disbursementId: id } = await createTestBatchDisbursement(
          ctx,
          setup.orgId as any,
          setup.safeId as any,
          [
            { beneficiaryId: beneficiary1 as any, amount: "100" },
            { beneficiaryId: beneficiary2 as any, amount: "200" },
          ],
          setup.userId
        );
        disbursementId = id;
      });

      const admin = await signIn(t, "admin");

      const result = await t.query(api.disbursements.getWithRecipients, {
        disbursementId: disbursementId! as any,
        sessionToken: admin.sessionToken,
      });

      expect(result).not.toBeNull();
      expect(result?.type).toBe("batch");
      expect(result?.totalAmount).toBe("300");
      expect(result?.recipients).toBeDefined();
      expect(result?.recipients?.length).toBe(2);
      expect(result?.recipients?.[0].amount).toBe("100");
      expect(result?.recipients?.[1].amount).toBe("200");
      expect(result?.recipients?.[0].beneficiary?.name).toBe("Ben 1");
      expect(result?.recipients?.[1].beneficiary?.name).toBe("Ben 2");
    });

    it("returns single disbursement correctly", async () => {
      const t = convexTest(schema);

      let disbursementId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const beneficiaryId = await createTestBeneficiary(ctx, setup.orgId as any, {
          name: "Single Beneficiary",
        });
        disbursementId = await createTestDisbursement(
          ctx,
          setup.orgId as any,
          setup.safeId as any,
          beneficiaryId as any,
          setup.userId
        );
      });

      const admin = await signIn(t, "admin");

      const result = await t.query(api.disbursements.getWithRecipients, {
        disbursementId: disbursementId! as any,
        sessionToken: admin.sessionToken,
      });

      expect(result).not.toBeNull();
      expect(result?.type).toBe("single");
      expect(result?.amount).toBe("100");
      expect(result?.beneficiary?.name).toBe("Single Beneficiary");
      expect(result?.recipients).toEqual([]);
    });
  });

  describe("list with batch disbursements", () => {
    it("shows Batch label for batch disbursements", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        // Create single disbursement
        const singleBeneficiary = await createTestBeneficiary(ctx, orgId as any, { name: "Single" });
        await createTestDisbursement(
          ctx,
          orgId as any,
          setup.safeId as any,
          singleBeneficiary as any,
          setup.userId
        );

        // Create batch disbursement
        const batchBeneficiary1 = await createTestBeneficiary(ctx, orgId as any);
        const batchBeneficiary2 = await createTestBeneficiary(ctx, orgId as any);
        await createTestBatchDisbursement(
          ctx,
          orgId as any,
          setup.safeId as any,
          [
            { beneficiaryId: batchBeneficiary1 as any, amount: "100" },
            { beneficiaryId: batchBeneficiary2 as any, amount: "200" },
          ],
          setup.userId
        );
      });

      const admin = await signIn(t, "admin");

      const result = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
      });

      expect(result.items.length).toBe(2);
      
      const single = result.items.find((d) => d.beneficiary?.name === "Single");
      // Batch rows now render as "<first recipient> +N" instead of a bare "Batch" label
      const batch = result.items.find((d) => d.type === "batch");
      
      expect(single).toBeDefined();
      expect(single?.type).toBe("single");
      expect(single?.amount).toBe("100");
      
      expect(batch).toBeDefined();
      expect(batch?.type).toBe("batch");
      expect(batch?.beneficiary?.name).toMatch(/ \+1$/);
      expect(batch?.displayAmount || batch?.totalAmount).toBe("300");
    });

    it("uses totalAmount for batch disbursements in list", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const beneficiary1 = await createTestBeneficiary(ctx, orgId as any);
        const beneficiary2 = await createTestBeneficiary(ctx, orgId as any);
        await createTestBatchDisbursement(
          ctx,
          orgId as any,
          setup.safeId as any,
          [
            { beneficiaryId: beneficiary1 as any, amount: "50.50" },
            { beneficiaryId: beneficiary2 as any, amount: "75.25" },
          ],
          setup.userId
        );
      });

      const admin = await signIn(t, "admin");

      const result = await t.query(api.disbursements.list, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].type).toBe("batch");
      expect(result.items[0].displayAmount || result.items[0].totalAmount).toBe("125.75");
    });
  });
});
