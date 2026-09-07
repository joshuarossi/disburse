import { beforeEach, afterEach, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from '../schema';
import { api, internal } from '../_generated/api';
import { CHAIN_TOKENS } from '../../shared/chains';
import { queueReportSource } from '../lib/reportIndex';
import { reportRangePeriods } from '../../shared/reportPeriods';
import { createFullOrgSetup, createTestBeneficiary, createTestDisbursement, signIn, TEST_WALLETS } from './factories';
import { refreshReportIndex } from './reportHelpers';

const timestamp = Date.UTC(2026, 8, 6, 12);
async function setup(count = 1) {
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const ids = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin });
    const deposits = [];
    for (let n = 0; n < count; n++) deposits.push(await ctx.db.insert('deposits', {
      orgId: ids.orgId, safeId: ids.safeId, safeAddress: ids.safeAddress, chainId: 11155111,
      tokenAddress: CHAIN_TOKENS[11155111].USDC.address, tokenSymbol: 'USDC', decimals: 6,
      amountRaw: '1', amount: '0.000001', txHash: `0x${n.toString(16).padStart(64, '0')}`, timestamp,
      toAddress: ids.safeAddress, source: 'safe_tx_service', createdAt: timestamp,
    }));
    return { ...ids, deposits };
  });
  const { sessionToken } = await signIn(t, 'admin');
  return { t, ids, args: { orgId: ids.orgId, sessionToken, environment: 'test' as const } };
}

describe('bounded, recoverable finance report index', () => {
  it('paginates equal timestamps without duplicates and calculates full-range totals independently of the page', async () => {
    const { t, ids, args } = await setup(251);
    await refreshReportIndex(t, ids.orgId);
    const first = await t.query(api.reports.getTransactionReport, args);
    expect(first).toMatchObject({ indexing: false, isDone: false });
    expect(first.items).toHaveLength(100);
    expect(first.totals[0].inflow).toBe('0.000251');
    const second = await t.query(api.reports.getTransactionReport, { ...args, cursor: first.continueCursor, snapshotVersion: first.indexVersion });
    const last = await t.query(api.reports.getTransactionReport, { ...args, cursor: second.continueCursor, snapshotVersion: first.indexVersion });
    expect(last).toMatchObject({ isDone: true, indexing: false });
    expect(last.items).toHaveLength(51);
    expect(new Set([...first.items, ...second.items, ...last.items].map(row => row.rowId)).size).toBe(251);
    const noMatches = await t.query(api.reports.getTransactionReport, { ...args, token: ['USDT'] });
    expect(noMatches).toMatchObject({ items: [], isDone: true, scanned: 0, totals: [] });
  });

  it('shows incomplete backfills and resumes their exact cursor while accepting new source updates', async () => {
    const { t, ids, args } = await setup(61);
    await t.mutation(internal.reportIndex.backfill, { orgId: ids.orgId }); // payments -> deposits
    await t.mutation(internal.reportIndex.backfill, { orgId: ids.orgId }); // first 25 deposits
    const state = await t.run(ctx => ctx.db.query('reportIndexStates').withIndex('by_org', q => q.eq('orgId', ids.orgId)).unique());
    expect(state).toMatchObject({ stage: 'deposits', pending: 25 });
    expect(state?.cursor).toBeTruthy();
    expect((await t.query(api.reports.getTransactionReport, args)).indexing).toBe(true);
    await t.run(async ctx => {
      await ctx.db.patch(ids.deposits[0], { amountRaw: '2', amount: '0.000002' });
      await queueReportSource(ctx, ids.orgId, 'deposit', ids.deposits[0]);
    });
    await refreshReportIndex(t, ids.orgId);
    const report = await t.query(api.reports.getTransactionReport, args);
    expect(report.indexing).toBe(false);
    expect(report.totals[0].inflow).toBe('0.000062');
  });

  it('replaces corrected source amounts and removes superseded entries and aggregate contributions once', async () => {
    const { t, ids, args } = await setup(2);
    await refreshReportIndex(t, ids.orgId);
    await t.run(async ctx => {
      await ctx.db.patch(ids.deposits[0], { amountRaw: '9007199254740993000001' });
      await ctx.db.patch(ids.deposits[1], { supersededBy: ids.deposits[0] });
      for (const id of ids.deposits) {
        await queueReportSource(ctx, ids.orgId, 'deposit', id);
        await queueReportSource(ctx, ids.orgId, 'deposit', id);
      }
    });
    await refreshReportIndex(t, ids.orgId);
    const report = await t.query(api.reports.getTransactionReport, args);
    expect(report.items).toHaveLength(1);
    expect(report.totals[0].inflow).toBe('9007199254740993.000001');
    const count = await t.run(ctx => ctx.db.query('reportAssets').withIndex('by_asset', q => q.eq('orgId', ids.orgId).eq('assetId', report.items[0].assetId)).unique());
    expect(count?.count).toBe(1);
  });

  it('keeps a failed projection out of totals, exposes retry, and does not erase other recorded activity', async () => {
    const { t, ids, args } = await setup(2);
    await refreshReportIndex(t, ids.orgId);
    await t.run(async ctx => {
      await ctx.db.patch(ids.deposits[0], { timestamp: -1 });
      await queueReportSource(ctx, ids.orgId, 'deposit', ids.deposits[0]);
    });
    const job = await t.run(ctx => ctx.db.query('reportIndexJobs').withIndex('by_source', q => q.eq('sourceKey', `deposit:${ids.deposits[0]}`)).unique());
    await t.action(internal.reportIndex.runJob, { jobId: job!._id });
    const report = await t.query(api.reports.getTransactionReport, args);
    expect(report.indexing).toBe(true);
    expect(report.indexErrors[0]).toContain('invalid date');
    expect(report.items).toHaveLength(2); // saved snapshot survives the failed replacement
    await expect(t.query(api.reports.getTransactionReport, { ...args, snapshotVersion: report.indexVersion })).rejects.toThrow('changed');
    await t.run(async ctx => {
      await ctx.db.patch(ids.deposits[0], { timestamp });
      await queueReportSource(ctx, ids.orgId, 'deposit', ids.deposits[0]);
    });
    await refreshReportIndex(t, ids.orgId);
    expect((await t.query(api.reports.getTransactionReport, args)).indexErrors).toEqual([]);
  });

  it('rejects export versions after activity changes and enforces workspace access before reading the index', async () => {
    const { t, ids, args } = await setup();
    await refreshReportIndex(t, ids.orgId);
    const original = await t.query(api.reports.getTransactionReport, args);
    await t.run(ctx => queueReportSource(ctx, ids.orgId, 'deposit', ids.deposits[0]));
    await expect(t.query(api.reports.getTransactionReport, { ...args, snapshotVersion: original.indexVersion })).rejects.toThrow('changed');
    const { sessionToken } = await signIn(t, 'viewer');
    await expect(t.query(api.reports.getTransactionReport, { ...args, sessionToken })).rejects.toThrow();
    await expect(t.query(api.reports.getSpendingByBeneficiary, { ...args, sessionToken })).rejects.toThrow();
    await expect(t.mutation(api.reportIndex.refresh, { orgId: ids.orgId, sessionToken })).rejects.toThrow();
  });

  it('indexes a full pay run once, paginates recipient totals, and updates archived labels without altering settlement values', async () => {
    const { t, ids, args } = await setup(0);
    const beneficiaryIds = await t.run(async ctx => {
      const first = await createTestBeneficiary(ctx, ids.orgId);
      const paymentId = await createTestDisbursement(ctx, ids.orgId, ids.safeId, first, ids.userId, { type: 'batch', status: 'executed' });
      const beneficiaries = [];
      for (let n = 0; n < 200; n++) {
        const beneficiaryId = n === 0 ? first : await createTestBeneficiary(ctx, ids.orgId, { name: `Employee ${n}` });
        beneficiaries.push(beneficiaryId);
        await ctx.db.insert('disbursementRecipients', { disbursementId: paymentId, beneficiaryId, recipientName: `Employee ${n}`, recipientAddress: TEST_WALLETS.initiator, amount: '1.000001', createdAt: timestamp });
      }
      await ctx.db.patch(paymentId, { executedAt: timestamp, totalAmount: '200.0002' });
      await queueReportSource(ctx, ids.orgId, 'payment', paymentId);
      return beneficiaries;
    });
    await refreshReportIndex(t, ids.orgId);
    expect((await t.query(api.reports.getTransactionReport, args)).totals[0].outflow).toBe('200.0002');
    let cursor: string | undefined; let count = 0;
    do {
      const page = await t.query(api.reports.getSpendingByBeneficiary, { ...args, cursor });
      expect(page.items.length).toBeLessThanOrEqual(50);
      expect(page.items.every(row => row.totalPaid === '1.000001' && row.transactionCount === 1)).toBe(true);
      count += page.items.length; cursor = page.isDone ? undefined : page.continueCursor;
    } while (cursor);
    expect(count).toBe(200);
    await t.run(ctx => ctx.db.patch(beneficiaryIds[0], { isActive: false }));
    const recipient = await t.query(api.reports.getTransactionReport, { ...args, beneficiaryId: beneficiaryIds[0] });
    expect(recipient.items[0].beneficiaryName).toContain('(archived)');
    expect(recipient.totals[0].outflow).toBe('1.000001');
  });

  it('uses disjoint UTC buckets, includes leap days and refuses invalid or unbounded custom ranges', () => {
    expect(reportRangePeriods()).toEqual(['all']);
    expect(reportRangePeriods(Date.UTC(2024, 1, 1), Date.UTC(2024, 1, 29))).toEqual(['2024-02']);
    expect(reportRangePeriods(Date.UTC(2024, 0, 31), Date.UTC(2024, 2, 1))).toEqual(['2024-01-31', '2024-02', '2024-03-01']);
    expect(() => reportRangePeriods(0, Date.now())).toThrow('two years');
    expect(() => reportRangePeriods(timestamp, timestamp - 86400000)).toThrow('end date');
  });

  it('backfills verified settlement dates across month end without duplicating a payment or changing its reconciliation ID', async () => {
    const { t, ids, args } = await setup(0);
    const safeTxHash = `0x${'ab'.repeat(32)}`, txHash = `0x${'cd'.repeat(32)}`;
    const observedAt = Date.UTC(2026, 8, 1, 12);
    const settlement = { blockNumber: '123', blockHash: `0x${'ef'.repeat(32)}`, timestamp: Date.UTC(2026, 7, 31, 23, 59, 59) };
    const disbursementId = await t.run(async ctx => {
      const beneficiaryId = await createTestBeneficiary(ctx, ids.orgId);
      const id = await createTestDisbursement(ctx, ids.orgId, ids.safeId, beneficiaryId, ids.userId, { status: 'executed', amount: '1.000001', safeTxHash, txHash });
      await ctx.db.patch(id, { executedAt: observedAt });
      return id;
    });
    await refreshReportIndex(t, ids.orgId);
    const before = await t.query(api.reports.getTransactionReport, args);
    expect(before.items[0]).toMatchObject({ createdAt: observedAt, dateSource: 'recorded' });
    for (let retry = 0; retry < 2; retry++) await t.mutation(internal.disbursements.confirmExecution, { disbursementId, safeTxHash, txHash, settlement });
    await refreshReportIndex(t, ids.orgId);
    const august = await t.query(api.reports.getTransactionReport, { ...args, startDate: Date.UTC(2026, 7, 1), endDate: Date.UTC(2026, 7, 31) });
    const september = await t.query(api.reports.getTransactionReport, { ...args, startDate: Date.UTC(2026, 8, 1), endDate: Date.UTC(2026, 8, 6) });
    expect(august.items).toHaveLength(1);
    expect(august.items[0]).toMatchObject({ rowId: before.items[0].rowId, createdAt: settlement.timestamp, observedAt, dateSource: 'settlement', blockHash: settlement.blockHash });
    expect(august.totals[0].outflow).toBe('1.000001');
    expect(september.items).toEqual([]);
    expect(september.totals).toEqual([]);
    expect((await t.run(ctx => ctx.db.get(disbursementId)))?.executedAt).toBe(observedAt);
    await expect(t.mutation(internal.disbursements.confirmExecution, { disbursementId, safeTxHash, txHash, settlement: { ...settlement, timestamp: settlement.timestamp + 1000 } })).rejects.toThrow('different settlement evidence');
    const audit = await t.run(ctx => ctx.db.query('auditLog').filter(q => q.eq(q.field('action'), 'disbursement.settlement_evidence')).collect());
    expect(audit).toHaveLength(1);
  });
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
