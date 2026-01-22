import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { TEST_WALLETS } from "../factories";

describe("Integration: Organization Setup Flow", () => {
  it("complete org setup: auth -> create org -> link safe", async () => {
    const t = convexTest(schema);

    // Step 1: Generate nonce (creates user)
    const { nonce } = await t.mutation(api.auth.generateNonce, {
      walletAddress: TEST_WALLETS.admin,
    });

    expect(nonce).toBeDefined();

    // Step 2: Verify signature (authenticates)
    const authResult = await t.mutation(api.auth.verifySignature, {
      walletAddress: TEST_WALLETS.admin,
      signature: "0xfakesig",
      message: `Sign in with nonce: ${nonce}`,
    });

    expect(authResult.sessionId).toBeDefined();
    expect(authResult.userId).toBeDefined();

    // Step 3: Create organization
    const orgResult = await t.mutation(api.orgs.create, {
      name: "Acme Corporation",
      walletAddress: TEST_WALLETS.admin,
    });

    expect(orgResult.orgId).toBeDefined();

    // Step 4: Verify billing record (trial) was created
    const billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(billing?.plan).toBe("trial");
    expect(billing?.status).toBe("trial");
    expect(billing?.daysRemaining).toBeGreaterThan(0);
    expect(billing?.isActive).toBe(true);

    // Step 5: Link Safe
    const safeAddress = "0x1234567890123456789012345678901234567890";
    const safeResult = await t.mutation(api.safes.link, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      chainId: 11155111, // Sepolia
      safeAddress,
    });

    expect(safeResult.safeId).toBeDefined();

    // Step 6: Verify Safe is retrievable
    const safe = await t.query(api.safes.getForOrg, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(safe).not.toBeNull();
    expect(safe?.safeAddress).toBe(safeAddress.toLowerCase());
    expect(safe?.chainId).toBe(11155111);

    // Verify complete audit trail
    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("auditLog")
        .withIndex("by_org", (q) => q.eq("orgId", orgResult.orgId as any))
        .collect();

      expect(logs.length).toBeGreaterThanOrEqual(2);
      expect(logs.some((l) => l.action === "org.created")).toBe(true);
      expect(logs.some((l) => l.action === "safe.linked")).toBe(true);
    });
  });

  it("multi-user org setup: admin creates org -> invites team", async () => {
    const t = convexTest(schema);

    // Admin sets up org
    await t.mutation(api.auth.generateNonce, {
      walletAddress: TEST_WALLETS.admin,
    });

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Team Org",
      walletAddress: TEST_WALLETS.admin,
    });

    // Upgrade to team plan for more users
    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      plan: "team",
      txHash: "0xtxhash",
      paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    // Invite approver
    const approverResult = await t.mutation(api.orgs.inviteMember, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      memberWalletAddress: TEST_WALLETS.approver,
      role: "approver",
    });
    expect(approverResult.membershipId).toBeDefined();

    // Invite initiator
    const initiatorResult = await t.mutation(api.orgs.inviteMember, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      memberWalletAddress: TEST_WALLETS.initiator,
      role: "initiator",
    });
    expect(initiatorResult.membershipId).toBeDefined();

    // Invite clerk
    const clerkResult = await t.mutation(api.orgs.inviteMember, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
      memberWalletAddress: TEST_WALLETS.clerk,
      role: "clerk",
    });
    expect(clerkResult.membershipId).toBeDefined();

    // Verify all members
    const members = await t.query(api.orgs.listMembers, {
      orgId: orgResult.orgId as any,
      walletAddress: TEST_WALLETS.admin,
    });

    expect(members.length).toBe(4);
    expect(members.filter((m) => m?.role === "admin").length).toBe(1);
    expect(members.filter((m) => m?.role === "approver").length).toBe(1);
    expect(members.filter((m) => m?.role === "initiator").length).toBe(1);
    expect(members.filter((m) => m?.role === "clerk").length).toBe(1);
  });

  it("org is visible in user's org list", async () => {
    const t = convexTest(schema);

    await t.mutation(api.auth.generateNonce, {
      walletAddress: TEST_WALLETS.admin,
    });

    // Create multiple orgs
    await t.mutation(api.orgs.create, {
      name: "Org A",
      walletAddress: TEST_WALLETS.admin,
    });

    await t.mutation(api.orgs.create, {
      name: "Org B",
      walletAddress: TEST_WALLETS.admin,
    });

    // List orgs
    const orgs = await t.query(api.orgs.listForUser, {
      walletAddress: TEST_WALLETS.admin,
    });

    expect(orgs.length).toBe(2);
    expect(orgs.some((o) => o?.name === "Org A")).toBe(true);
    expect(orgs.some((o) => o?.name === "Org B")).toBe(true);
    expect(orgs.every((o) => o?.role === "admin")).toBe(true);
  });
});
