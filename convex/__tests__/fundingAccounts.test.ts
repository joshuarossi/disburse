import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import schema from '../schema';
import { createFullOrgSetup, createTestBeneficiary, createTestSafe, signIn, TEST_WALLETS } from './factories';
import { PREPARATION_LEAD_MS } from '../../shared/recurrence';

async function setup() {
  vi.useFakeTimers();
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const org = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin });
    const payrollId = await createTestSafe(ctx, org.orgId, { safeAddress: '0x9999999999999999999999999999999999999999' });
    const beneficiaryId = await createTestBeneficiary(ctx, org.orgId);
    return { ...org, payrollId, beneficiaryId };
  });
  const { sessionToken } = await signIn(t, 'admin');
  const args = { orgId: ids.orgId, sessionToken, name: 'Payroll', purpose: 'payroll' as const,
    chainId: 11155111, token: 'USDC', recipients: [{ beneficiaryId: ids.beneficiaryId, amount: '10.000001' }] };
  return { t, ids, args };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('named funding accounts', () => {
  it('requires an explicit choice across every legacy and grouped payment entry point', async () => {
    const { t, args, ids } = await setup();
    await expect(t.mutation(api.paymentRuns.create, args)).rejects.toThrow('Choose a funding account');
    await expect(t.mutation(api.paymentRuns.createGrouped, { orgId: args.orgId, sessionToken: args.sessionToken,
      name: args.name, purpose: args.purpose, recipients: args.recipients.map(r => ({ ...r, chainId: args.chainId, token: args.token })) })).rejects.toThrow('Choose a funding account');
    await expect(t.mutation(api.disbursements.create, { orgId: args.orgId, sessionToken: args.sessionToken,
      chainId: args.chainId, token: args.token, beneficiaryId: ids.beneficiaryId, amount: '10' })).rejects.toThrow('Choose a funding account');
    await expect(t.mutation(api.disbursements.createBatch, { orgId: args.orgId, sessionToken: args.sessionToken,
      chainId: args.chainId, token: args.token, recipients: args.recipients })).rejects.toThrow('Choose a funding account');
    expect(await t.run(ctx => ctx.db.query('disbursements').collect())).toHaveLength(0);
  });

  it('saves the chosen account and preserves it when a draft is edited without changing funding', async () => {
    const { t, args, ids } = await setup();
    const { disbursementId } = await t.mutation(api.paymentRuns.create, { ...args, safeId: ids.payrollId });
    const { orgId: _orgId, ...fields } = args;
    void _orgId;
    await t.mutation(api.paymentRuns.updateDraft, { ...fields, disbursementId, name: 'Reviewed payroll' });
    expect(await t.run(ctx => ctx.db.get(disbursementId))).toMatchObject({ safeId: ids.payrollId, totalAmount: '10.000001' });
  });

  it('does not group payments from different accounts into the same transaction', async () => {
    const { t, args, ids } = await setup();
    const second = await t.run(ctx => createTestBeneficiary(ctx, ids.orgId, { name: 'Second colleague', walletAddress: TEST_WALLETS.approver }));
    const result = await t.mutation(api.paymentRuns.createGrouped, { orgId: args.orgId, sessionToken: args.sessionToken,
      name: args.name, purpose: args.purpose, recipients: [
        { beneficiaryId: ids.beneficiaryId, amount: '10', chainId: args.chainId, token: args.token, safeId: ids.payrollId },
        { beneficiaryId: second, amount: '20', chainId: args.chainId, token: args.token, safeId: ids.safeId },
      ] });
    expect(result.batches).toHaveLength(2);
    const payments = await t.run(ctx => ctx.db.query('disbursements').collect());
    expect(payments.map(p => [p.safeId, p.totalAmount])).toEqual([[ids.payrollId, '10'], [ids.safeId, '20']]);
  });

  it('rejects an archived, wrong-network or foreign account without falling back', async () => {
    const { t, args, ids } = await setup();
    const foreign = await t.run(ctx => createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.viewer }));
    await expect(t.mutation(api.paymentRuns.create, { ...args, safeId: foreign.safeId })).rejects.toThrow('does not belong');
    await t.run(ctx => ctx.db.patch(ids.payrollId, { chainId: 8453 }));
    await expect(t.mutation(api.paymentRuns.create, { ...args, safeId: ids.payrollId })).rejects.toThrow('does not belong');
    await t.run(ctx => ctx.db.patch(ids.payrollId, { chainId: 11155111, isActive: false }));
    await expect(t.mutation(api.paymentRuns.create, { ...args, safeId: ids.payrollId })).rejects.toThrow('no longer active');
    expect(await t.run(ctx => ctx.db.query('disbursements').collect())).toHaveLength(0);
  });

  it('keeps scheduled payroll on its original account, including migrated schedules', async () => {
    const { t, args, ids } = await setup();
    const { recurringPaymentId } = await t.mutation(api.paymentRuns.create, { ...args, safeId: ids.payrollId,
      cadence: 'monthly', payDate: Date.now() + 5 * 86400_000 });
    await t.run(ctx => ctx.db.patch(recurringPaymentId!, { safeId: undefined }));
    const series = (await t.run(ctx => ctx.db.get(recurringPaymentId!)))!;
    vi.setSystemTime(series.nextPayDate - PREPARATION_LEAD_MS);
    await t.mutation(internal.paymentRuns.prepareNext, { recurringPaymentId: series._id, version: series.version });
    const next = (await t.run(ctx => ctx.db.get(series._id)))!;
    expect(next.safeId).toBe(ids.payrollId);
    expect(await t.run(ctx => ctx.db.get(next.lastDisbursementId!))).toMatchObject({ safeId: ids.payrollId });
    await t.run(ctx => ctx.db.patch(ids.payrollId, { isActive: false }));
    vi.setSystemTime(next.nextPayDate - PREPARATION_LEAD_MS);
    await t.mutation(internal.paymentRuns.prepareNext, { recurringPaymentId: next._id, version: next.version });
    expect(await t.run(ctx => ctx.db.get(series._id))).toMatchObject({ status: 'paused', pauseReason: expect.stringContaining('no longer active') });
    expect(await t.run(ctx => ctx.db.query('disbursements').collect())).toHaveLength(2);
  });

  it('allows archiving Operations while Payroll has an active recurring schedule', async () => {
    const { t, args, ids } = await setup();
    await t.mutation(api.paymentRuns.create, { ...args, safeId: ids.payrollId, cadence: 'weekly', payDate: Date.now() + 5 * 86400_000 });
    await t.mutation(api.safes.unlink, { safeId: ids.safeId, sessionToken: args.sessionToken });
    expect(await t.run(ctx => ctx.db.get(ids.safeId))).toMatchObject({ isActive: false });
    expect(await t.run(ctx => ctx.db.get(ids.payrollId))).not.toMatchObject({ isActive: false });
  });
});
