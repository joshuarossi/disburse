import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  signIn,
  TEST_WALLETS,
  createTestMembership,
  createTestUser,
} from "./factories";
import { billingAccess, renewalEnd, DAY } from "../../shared/billing";
import { getOrgLimits } from "../billing";

const hash = `0x${"ab".repeat(32)}`;
describe("Billing lifecycle", () => {
  it('reports the same reserved seats and saved recipients that plan enforcement counts, including after expiry', async () => {
    const t = convexTest(schema);
    const ids = await t.run(async ctx => {
      const ids = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin, plan: 'team' });
      const invited = await createTestMembership(ctx, ids.orgId, await createTestUser(ctx), { status: 'invited' });
      await ctx.db.patch(invited, { invitationExpiresAt: Date.now()+DAY });
      const expired = await createTestMembership(ctx, ids.orgId, await createTestUser(ctx), { status: 'invited' });
      await ctx.db.patch(expired, { invitationExpiresAt: Date.now()-DAY });
      await createTestBeneficiary(ctx, ids.orgId);
      const archived = await createTestBeneficiary(ctx, ids.orgId);
      await ctx.db.patch(archived, { isActive: false });
      return ids;
    });
    const admin = await signIn(t, 'admin');
    const args = { orgId: ids.orgId, sessionToken: admin.sessionToken };
    const before = await t.query(api.billing.get, args);
    expect(before?.usage).toEqual({ activeMembers: 1, reservedSeats: 2, pendingInvitations: 1, recipients: 2, archivedRecipients: 1, activeAccounts: 1 });
    await t.run(ctx => ctx.db.patch(ids.billingId, { paidThroughAt: Date.now()-1 }));
    const after = await t.query(api.billing.get, args);
    expect(after?.status).toBe('free');
    expect(after?.usage).toEqual(before?.usage);
    expect(after?.limits.maxUsers).toBe(1);
  });
  it("reserves seats for pending invitations and blocks accepting after expiry", async () => {
    const t = convexTest(schema);
    const ids = await t.run((ctx) =>
      createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
        plan: "team",
      }),
    );
    const admin = await signIn(t, "admin");
    const viewer = await signIn(t, "viewer");
    await t.run(async (ctx) => {
      await createTestMembership(ctx, ids.orgId, viewer.userId, {
        status: "invited",
      });
      for (let i = 0; i < 3; i++)
        await createTestMembership(ctx, ids.orgId, await createTestUser(ctx), {
          status: "invited",
        });
    });
    await expect(
      t.mutation(api.orgs.inviteMember, {
        orgId: ids.orgId,
        sessionToken: admin.sessionToken,
        memberWalletAddress: TEST_WALLETS.initiator,
        role: "viewer",
      }),
    ).rejects.toThrow("maximum");
    await t.run((ctx) =>
      ctx.db.patch(ids.billingId, { paidThroughAt: Date.now() - 1 }),
    );
    await expect(
      t.mutation(api.orgs.acceptInvite, {
        orgId: ids.orgId,
        sessionToken: viewer.sessionToken,
      }),
    ).rejects.toThrow("renew or upgrade");
  });
  it("ends premium access exactly at the boundary and retains Free for missing or cancelled subscriptions", () => {
    const records = [{ plan: "trial" as const, status: "trial", trialEndsAt: 100 }, { plan: "team" as const, status: "active" }, { plan: "team" as const, status: "cancelled", paidThroughAt: 200 }, null];
    for (const billing of records) expect(billingAccess(billing, 100)).toMatchObject({ source: "free", effectiveTier: { key: "free" }, isActive: true, expiresAt: null });
  });
  it("preserves remaining time on renewal and credits upgrades at the old rate", () => {
    const billing = {
      plan: "starter" as const,
      status: "active",
      paidThroughAt: 10 * DAY,
    };
    expect(renewalEnd(billing, "starter", 0)).toBe(40 * DAY);
    expect(renewalEnd(billing, "team", 0)).toBe(35 * DAY);
    expect(renewalEnd({ ...billing, status: "expired" }, "starter", 0)).toBe(
      30 * DAY,
    );
  });
  it("redeems each receipt once, including mixed-case retries and old-plan replay", async () => {
    const t = convexTest(schema);
    const ids = await t.run((ctx) =>
      createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
    );
    const admin = await signIn(t, "admin");
    await t.run((ctx) =>
      ctx.db.insert("billingPayments", {
        orgId: ids.orgId,
        txHash: hash,
        chainId: 1,
        plan: "team",
        tokenAddress: TEST_WALLETS.admin,
        amountRaw: "50000000",
        paidThroughAt: 0,
        verifiedAt: Date.now(),
      }),
    );
    const args = {
      orgId: ids.orgId,
      sessionToken: admin.sessionToken,
      plan: "team" as const,
      txHash: hash,
    };
    await t.mutation(api.billing.subscribe, args);
    const first = await t.query(api.billing.get, argsForQuery(args));
    await t.mutation(api.billing.subscribe, {
      ...args,
      txHash: "0x" + hash.slice(2).toUpperCase(),
    });
    expect(
      (await t.query(api.billing.get, argsForQuery(args)))?.paidThroughAt,
    ).toBe(first?.paidThroughAt);
    await t.run(async (ctx) => {
      const b = await ctx.db
        .query("billing")
        .withIndex("by_org", (q) => q.eq("orgId", ids.orgId))
        .first();
      await ctx.db.patch(b!._id, { plan: "pro" });
    });
    await t.mutation(api.billing.subscribe, args);
    expect((await t.query(api.billing.get, argsForQuery(args)))?.plan).toBe(
      "pro",
    );
  });
  it("keeps native payment submission, read access and cancellation after expiry", async () => {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      const setup = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      const recipient = await createTestBeneficiary(ctx, setup.orgId);
      const payment = await createTestDisbursement(
        ctx,
        setup.orgId,
        setup.safeId,
        recipient,
        setup.userId,
        { status: "proposed", safeTxHash: hash },
      );
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_org", (q) => q.eq("orgId", setup.orgId))
        .first();
      await ctx.db.patch(billing!._id, { trialEndsAt: Date.now() - 1 });
      expect((await getOrgLimits(ctx, setup.orgId)).maxUsers).toBe(1);
      return { ...setup, payment };
    });
    const admin = await signIn(t, "admin");
    const args = {
      disbursementId: ids.payment,
      sessionToken: admin.sessionToken,
    };
    await expect(
      t.mutation(internal.disbursements.claimNativeExecution, {
        ...args,
        safeTxHash: hash,
        attemptId: 'test-attempt',
        searchFromBlock: '100',
      }),
    ).resolves.toMatchObject({ success: true });
    expect(await t.query(api.disbursements.get, args)).not.toBeNull();
    await expect(t.mutation(api.disbursements.updateStatus, { ...args, status: "cancelled" })).rejects.toThrow("approved account cancellation");
    const draftId = await t.run(async ctx => {
      const original = await ctx.db.get(ids.payment);
      return createTestDisbursement(ctx, ids.orgId, ids.safeId, original!.beneficiaryId!, ids.userId, { status: 'draft' });
    });
    const draft = { ...args, disbursementId: draftId };
    await t.mutation(api.disbursements.updateStatus, { ...draft, status: 'cancelled' });
    expect((await t.query(api.disbursements.get, draft))?.status).toBe('cancelled');
  });
});
function argsForQuery(args: { orgId: any; sessionToken: string }) {
  return { orgId: args.orgId, sessionToken: args.sessionToken };
}
