import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { createFullOrgSetup, createTestBeneficiary, TEST_WALLETS } from "../factories";

describe("Integration: Disbursement Flow", () => {
  it("complete disbursement: draft -> proposed -> executed", async () => {
    const t = convexTest(schema);

    // Setup: Create org with Safe and beneficiary
    let orgId: string;
    let beneficiaryId: string;
    await t.run(async (ctx) => {
      const setup = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      orgId = setup.orgId;
      beneficiaryId = await createTestBeneficiary(ctx, orgId as any, {
        name: "Contractor Payment",
        type: "individual",
      });
    });

    // Step 1: Create draft disbursement
    const createResult = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      walletAddress: TEST_WALLETS.admin,
      beneficiaryId: beneficiaryId! as any,
      token: "USDC",
      amount: "1500.00",
      memo: "January invoice payment",
    });

    expect(createResult.disbursementId).toBeDefined();

    // Verify draft status
    let disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(disbursement?.status).toBe("draft");
    expect(disbursement?.token).toBe("USDC");
    expect(disbursement?.amount).toBe("1500.00");

    // Step 2: Propose to Safe (after Safe tx is created)
    const safeTxHash = "0xsafetxhash123abc";
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
      status: "proposed",
      safeTxHash,
    });

    // Verify proposed status
    disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(disbursement?.status).toBe("proposed");
    expect(disbursement?.safeTxHash).toBe(safeTxHash);

    // Step 3: Execute (after Safe tx is executed)
    const txHash = "0xrealtxhash456def";
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
      status: "executed",
      txHash,
    });

    // Verify executed status
    disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(disbursement?.status).toBe("executed");
    expect(disbursement?.txHash).toBe(txHash);

    // Verify complete audit trail
    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("auditLog")
        .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
        .collect();

      const disbursementLogs = logs.filter((l) =>
        l.action.startsWith("disbursement.")
      );

      expect(disbursementLogs.length).toBe(3);
      expect(disbursementLogs.some((l) => l.action === "disbursement.created")).toBe(true);
      expect(disbursementLogs.some((l) => l.action === "disbursement.proposed")).toBe(true);
      expect(disbursementLogs.some((l) => l.action === "disbursement.executed")).toBe(true);
    });
  });

  it("failed disbursement: draft -> proposed -> failed", async () => {
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

    // Create and propose
    const createResult = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      walletAddress: TEST_WALLETS.admin,
      beneficiaryId: beneficiaryId! as any,
      token: "USDT",
      amount: "500",
    });

    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
      status: "proposed",
      safeTxHash: "0xsafetx",
    });

    // Mark as failed
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
      status: "failed",
    });

    const disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(disbursement?.status).toBe("failed");
  });

  it("cancelled disbursement: draft -> cancelled", async () => {
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

    // Create draft
    const createResult = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      walletAddress: TEST_WALLETS.admin,
      beneficiaryId: beneficiaryId! as any,
      token: "USDC",
      amount: "100",
    });

    // Cancel before proposing
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
      status: "cancelled",
    });

    const disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(disbursement?.status).toBe("cancelled");
  });

  it("multiple disbursements with filtering", async () => {
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

    // Create multiple disbursements with different statuses
    const draft1 = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      walletAddress: TEST_WALLETS.admin,
      beneficiaryId: beneficiaryId! as any,
      token: "USDC",
      amount: "100",
    });

    const draft2 = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      walletAddress: TEST_WALLETS.admin,
      beneficiaryId: beneficiaryId! as any,
      token: "USDC",
      amount: "200",
    });

    // Propose one
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: draft1.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
      status: "proposed",
      safeTxHash: "0xhash1",
    });

    // Execute it
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: draft1.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
      status: "executed",
      txHash: "0xtx1",
    });

    // Filter by draft
    const drafts = await t.query(api.disbursements.list, {
      orgId: orgId! as any,
      walletAddress: TEST_WALLETS.admin,
      status: "draft",
    });
    expect(drafts.length).toBe(1);

    // Filter by executed
    const executed = await t.query(api.disbursements.list, {
      orgId: orgId! as any,
      walletAddress: TEST_WALLETS.admin,
      status: "executed",
    });
    expect(executed.length).toBe(1);
    expect(executed[0].amount).toBe("100");

    // All disbursements
    const all = await t.query(api.disbursements.list, {
      orgId: orgId! as any,
      walletAddress: TEST_WALLETS.admin,
    });
    expect(all.length).toBe(2);
  });

  it("disbursement includes beneficiary details", async () => {
    const t = convexTest(schema);

    let orgId: string;
    let beneficiaryId: string;
    await t.run(async (ctx) => {
      const setup = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      orgId = setup.orgId;
      beneficiaryId = await createTestBeneficiary(ctx, orgId as any, {
        name: "Alice Smith",
        walletAddress: "0xalice",
        type: "individual",
      });
    });

    const createResult = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      walletAddress: TEST_WALLETS.admin,
      beneficiaryId: beneficiaryId! as any,
      token: "USDC",
      amount: "50",
    });

    const disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(disbursement?.beneficiary).not.toBeNull();
    expect(disbursement?.beneficiary?.name).toBe("Alice Smith");
    expect(disbursement?.beneficiary?.walletAddress).toBe("0xalice");
  });
});
