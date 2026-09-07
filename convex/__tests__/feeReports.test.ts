import { beforeEach, afterEach, vi } from 'vitest';
import { refreshReportIndex } from './reportHelpers';
import { CHAIN_TOKENS } from '../../shared/chains';
import { parseUnits } from 'viem';
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from '../schema';
import { api } from '../_generated/api';
import { createFullOrgSetup, createTestBeneficiary, createTestDisbursement, signIn, TEST_WALLETS } from './factories';

describe('payment fees in accounting reports', () => {
  it('counts one fee per batch, filters the fee currency independently, and separates net cash flow', async () => {
    const t = convexTest(schema);
    const ids = await t.run(async ctx => {
      const ids = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin });
      const beneficiaryId = await createTestBeneficiary(ctx, ids.orgId);
      const paymentId = await createTestDisbursement(ctx, ids.orgId, ids.safeId, beneficiaryId, ids.userId, { type: 'batch', status: 'executed' });
      await ctx.db.patch(paymentId, { totalAmount: '3.000003', executionFee: { token: 'USDT', amount: '0.050001', tokenAddress: CHAIN_TOKENS[11155111].USDT!.address, collector: TEST_WALLETS.approver } });
      for (const amount of ['1.000001', '2.000002']) await ctx.db.insert('disbursementRecipients', { disbursementId: paymentId, beneficiaryId, recipientAddress: TEST_WALLETS.initiator, recipientName: 'Vendor', amount, createdAt: Date.now() });
      return { ...ids, beneficiaryId };
    });
    const { sessionToken } = await signIn(t, 'admin');
    await refreshReportIndex(t, ids.orgId);
    const args = { orgId: ids.orgId, sessionToken, environment: "test" as const };
    const report = await t.query(api.reports.getTransactionReport, args);
    expect(report.items.filter(r => r.kind === 'fee')).toHaveLength(1);
    expect(new Set(report.items.map(r => r.rowId)).size).toBe(3);
    expect(report.totals).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'USDT', amount: '0.050001', inflow: '0', outflow: '0.050001', net: '-0.050001' })]));
    expect(report.totals).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'USDC', amount: '3.000003', inflow: '0', outflow: '3.000003', net: '-3.000003' })]));
    const feesOnly = await t.query(api.reports.getTransactionReport, { ...args, token: ['USDT'] });
    expect(feesOnly.items.map(r => r.kind)).toEqual(['fee']);
    const vendor = await t.query(api.reports.getTransactionReport, { ...args, beneficiaryId: ids.beneficiaryId });
    expect(vendor.items).toHaveLength(2);
    expect(vendor.items.every(r => r.kind === 'payment')).toBe(true);
  });
});

it('reports native and custom deposits without applying stablecoin precision', async () => {
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const ids = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin });
    for (const [tokenSymbol, amount, decimals] of [['ETH', '0.010000000000000001', 18], ['ETH', '0.02', 18], ['CUSTOM', '1.123456789', 9]] as const) {
      await ctx.db.insert('deposits', {
        orgId: ids.orgId, safeId: ids.safeId, chainId: 11155111,
        safeAddress: TEST_WALLETS.admin, tokenAddress: tokenSymbol === "ETH" ? "0x0000000000000000000000000000000000000000" : TEST_WALLETS.viewer,
        tokenSymbol, decimals, amountRaw: parseUnits(amount, decimals).toString(), amount,
        txHash: `0x${'1'.repeat(64)}`, timestamp: Date.now(),
        toAddress: TEST_WALLETS.admin, source: 'safe_tx_service', createdAt: Date.now(),
      });
    }
    return ids;
  });
  const { sessionToken } = await signIn(t, 'admin');
  await refreshReportIndex(t, ids.orgId);
  const report = await t.query(api.reports.getTransactionReport, { orgId: ids.orgId, sessionToken, environment: "test" });
  expect(report.items).toHaveLength(3);
  expect(report.totals).toEqual(expect.arrayContaining([expect.objectContaining({ token: 'ETH', amount: '0.030000000000000001', inflow: '0.030000000000000001', outflow: '0', net: '0.030000000000000001' })]));
  expect(report.totals.find(total => total.token === 'CUSTOM')).toBeUndefined();
  expect(report.items.find(item => item.token === 'CUSTOM')).toMatchObject({ amount: '1.123456789', includedInTotals: false });
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
