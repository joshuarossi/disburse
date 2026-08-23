import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { signIn, TEST_ACCOUNTS, TEST_WALLETS } from "../factories";

// billing.subscribe only activates plans backed by a server-verified payment
const TEAM_PAYMENT_TX = "0x" + "ab".repeat(32);

describe("Integration: Organization Setup Flow", () => {
  it("complete org setup: auth -> create org -> link safe", async () => {
    const t = convexTest(schema);

    // Step 1: Generate nonce (creates user, returns server-built SIWE message)
    const { nonce, message } = await t.mutation(api.auth.generateNonce, {
      walletAddress: TEST_WALLETS.admin,
    });

    expect(nonce).toBeDefined();

    // Step 2: Verify signature (authenticates — signature is verified cryptographically)
    const signature = await TEST_ACCOUNTS.admin.signMessage({ message });
    const authResult = await t.mutation(api.auth.verifySignature, {
      walletAddress: TEST_WALLETS.admin,
      signature,
      message,
    });

    expect(authResult.token).toBeDefined();
    expect(authResult.userId).toBeDefined();
    const sessionToken = authResult.token;

    // Step 3: Create organization
    const orgResult = await t.mutation(api.orgs.create, {
      name: "Acme Corporation",
      sessionToken,
    });

    expect(orgResult.orgId).toBeDefined();

    // Step 4: Verify billing record (trial) was created
    const billing = await t.query(api.billing.get, {
      orgId: orgResult.orgId as any,
      sessionToken,
    });

    expect(billing?.plan).toBe("trial");
    expect(billing?.status).toBe("trial");
    expect(billing?.daysRemaining).toBeGreaterThan(0);
    expect(billing?.isActive).toBe(true);

    // Step 5: Link Safe
    const safeAddress = "0x1234567890123456789012345678901234567890";
    const safeResult = await t.mutation(api.safes.link, {
      orgId: orgResult.orgId as any,
      sessionToken,
      chainId: 11155111, // Sepolia
      safeAddress,
    });

    expect(safeResult.safeId).toBeDefined();

    // Step 6: Verify Safe is retrievable (getForOrg returns array of safes, one per chain)
    const safes = await t.query(api.safes.getForOrg, {
      orgId: orgResult.orgId as any,
      sessionToken,
    });

    expect(Array.isArray(safes)).toBe(true);
    expect(safes.length).toBe(1);
    expect(safes[0]?.safeAddress).toBe(safeAddress.toLowerCase());
    expect(safes[0]?.chainId).toBe(11155111);

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
    const admin = await signIn(t, "admin");

    const orgResult = await t.mutation(api.orgs.create, {
      name: "Team Org",
      sessionToken: admin.sessionToken,
    });

    // Upgrade to team plan for more users (requires a pre-verified payment row;
    // subscribe no longer accepts a client-declared paidThroughAt)
    await t.run(async (ctx) => {
      await ctx.db.insert("billingPayments", {
        orgId: orgResult.orgId as any,
        txHash: TEAM_PAYMENT_TX,
        chainId: 1,
        plan: "team",
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        amountRaw: "50000000",
        paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        verifiedAt: Date.now(),
      });
    });

    await t.mutation(api.billing.subscribe, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      plan: "team",
      txHash: TEAM_PAYMENT_TX,
    });

    // Invite approver
    const approverResult = await t.mutation(api.orgs.inviteMember, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      memberWalletAddress: TEST_WALLETS.approver,
      role: "approver",
    });
    expect(approverResult.membershipId).toBeDefined();

    // Invite initiator
    const initiatorResult = await t.mutation(api.orgs.inviteMember, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      memberWalletAddress: TEST_WALLETS.initiator,
      role: "initiator",
    });
    expect(initiatorResult.membershipId).toBeDefined();

    // Invite clerk
    const clerkResult = await t.mutation(api.orgs.inviteMember, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
      memberWalletAddress: TEST_WALLETS.clerk,
      role: "clerk",
    });
    expect(clerkResult.membershipId).toBeDefined();

    // Verify all members (invitees are listed; their memberships are pending
    // acceptance and therefore have status "invited")
    const members = await t.query(api.orgs.listMembers, {
      orgId: orgResult.orgId as any,
      sessionToken: admin.sessionToken,
    });

    expect(members.length).toBe(4);
    expect(members.filter((m) => m?.role === "admin").length).toBe(1);
    expect(members.filter((m) => m?.role === "approver").length).toBe(1);
    expect(members.filter((m) => m?.role === "initiator").length).toBe(1);
    expect(members.filter((m) => m?.role === "clerk").length).toBe(1);
    expect(members.filter((m) => m?.status === "invited").length).toBe(3);
  });

  it("org is visible in user's org list", async () => {
    const t = convexTest(schema);

    const admin = await signIn(t, "admin");

    // Create multiple orgs
    await t.mutation(api.orgs.create, {
      name: "Org A",
      sessionToken: admin.sessionToken,
    });

    await t.mutation(api.orgs.create, {
      name: "Org B",
      sessionToken: admin.sessionToken,
    });

    // List orgs
    const orgs = await t.query(api.orgs.listForUser, {
      sessionToken: admin.sessionToken,
    });

    expect(orgs.length).toBe(2);
    expect(orgs.some((o) => o?.name === "Org A")).toBe(true);
    expect(orgs.some((o) => o?.name === "Org B")).toBe(true);
    expect(orgs.every((o) => o?.role === "admin")).toBe(true);
  });
});
