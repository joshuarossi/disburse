import { convexTest } from 'convex-test';
import { expect, it } from 'vitest';
import schema from '../schema';
import { api } from '../_generated/api';
import { createFullOrgSetup, createTestBeneficiary, createTestDisbursement, signIn, TEST_WALLETS } from './factories';

it('keeps overview and upcoming filters aligned while retaining overdue instructions for review', async () => {
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const ids = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin });
    const beneficiary = await createTestBeneficiary(ctx, ids.orgId);
    const payments = [];
    for (const [status, offset] of [['draft', -86400000], ['draft', 86400000], ['scheduled', -86400000], ['scheduled', 86400000], ['executed', 86400000]] as const) {
      const id = await createTestDisbursement(ctx, ids.orgId, ids.safeId, beneficiary, ids.userId, { status });
      await ctx.db.patch(id, { scheduledAt: Date.now() + offset });
      payments.push(id);
    }
    return { ...ids, payments };
  });
  const { sessionToken } = await signIn(t, 'admin');
  const args = { orgId: ids.orgId, sessionToken, environment: "test" as const };
  const overview = await t.query(api.workspace.overview, args);
  const upcoming = await t.query(api.disbursements.list, { ...args, upcomingOnly: true });
  expect(overview.scheduledCount).toBe(2);
  expect(new Set(overview.upcoming.map(p => p._id))).toEqual(new Set(upcoming.items.map(p => p._id)));
  expect(overview.exceptions.map(p => p._id)).toContain(ids.payments[2]);
  expect(overview.exceptions.find(p => p._id === ids.payments[0])?.exceptionReason).toBe('Approval deadline missed');
  expect(overview.draftCount).toBe(1);
  expect(overview.needsReview).toBe(0);
  expect(overview.plannedDebits).toEqual([{safeId:ids.safeId,token:'USDC',amount:'400'}]);
  expect(overview.plansIncomplete).toBe(false);
  expect(overview.upcoming.map(p => p._id)).not.toContain(ids.payments[0]);
  const attention = await t.query(api.disbursements.list, { ...args, status: ['failed'], includeOverdueScheduled: true });
  expect(new Set(attention.items.map(p => p._id))).toEqual(new Set([ids.payments[0],ids.payments[2]]));
});

it('shows declined wallet sends and blocked recipient submissions in the same review queue on Overview and Payments', async () => {
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const ids = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin });
    const recipient = await createTestBeneficiary(ctx, ids.orgId);
    const declined = await createTestDisbursement(ctx, ids.orgId, ids.safeId, recipient, ids.userId, { status: 'relaying' });
    await ctx.db.patch(declined, { nativeExecution: { startedAt: Date.now()-1000, checks: 0, walletRejectedAt: Date.now() } });
    const blocked = await createTestDisbursement(ctx, ids.orgId, ids.safeId, recipient, ids.userId, { status: 'relaying' });
    await ctx.db.patch(blocked, { relayStatus: 'Payment review required' });
    return { ...ids, declined, blocked };
  });
  const { sessionToken } = await signIn(t, 'admin');
  const args = { orgId: ids.orgId, sessionToken, environment: 'test' as const };
  const overview = await t.query(api.workspace.overview, args);
  const payments = await t.query(api.disbursements.list, { ...args, status: ['failed'], includeRelayExceptions: true });
  expect(new Set(overview.exceptions.map(p => p._id))).toEqual(new Set([ids.declined, ids.blocked]));
  expect(new Set(payments.items.map(p => p._id))).toEqual(new Set([ids.declined, ids.blocked]));
  expect(overview.exceptions.find(p => p._id === ids.declined)?.exceptionReason).toBe('Wallet approval declined');
});
