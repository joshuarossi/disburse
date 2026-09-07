import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import { api, internal } from '../_generated/api';
import { CHAIN_TOKENS } from '../../shared/chains';
import { createFullOrgSetup, createTestBeneficiary, createTestDisbursement, signIn, TEST_WALLETS } from './factories';
import { refreshReportIndex } from './reportHelpers';
import { depositScanUrl, parseAccountTransfer } from '../lib/depositSync';

const txHash = `0x${'ab'.repeat(32)}`, safeTxHash = `0x${'cd'.repeat(32)}`;
const timestamp = Date.UTC(2026, 7, 31, 23, 59, 59);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 6)); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(ctx => createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }));
  const { sessionToken } = await signIn(t, 'admin');
  const fields = { orgId: ids.orgId, safeId: ids.safeId, chainId: 11155111, safeAddress: ids.safeAddress,
    tokenAddress: CHAIN_TOKENS[11155111].USDC.address, tokenSymbol: 'USDC', decimals: 6,
    amountRaw: '1000001', amount: '1.000001', txHash, transferId: `e${txHash.slice(2)}1`, blockNumber: 123, timestamp,
    fromAddress: ids.safeAddress, toAddress: TEST_WALLETS.approver, source: 'safe_tx_service' as const };
  return { t, ids, fields, scope: { orgId: ids.orgId, sessionToken, environment: 'test' as const } };
}
async function payment(s: Awaited<ReturnType<typeof setup>>, status: 'proposed' | 'executed' = 'executed') {
  return s.t.run(async ctx => {
    const beneficiaryId = await createTestBeneficiary(ctx, s.ids.orgId, { walletAddress: s.fields.toAddress, name: 'Vendor' });
    const id = await createTestDisbursement(ctx, s.ids.orgId, s.ids.safeId, beneficiaryId, s.ids.userId,
      { amount: s.fields.amount, status, safeTxHash, ...(status === 'executed' ? { txHash } : {}) });
    await ctx.db.patch(id, { recipientAddress: s.fields.toAddress, recipientName: 'Vendor', tokenAddress: s.fields.tokenAddress });
    return { id, beneficiaryId };
  });
}

it('includes transfers made directly through Safe and retains them after repeated syncs', async () => {
  const s = await setup();
  const id = await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, s.fields);
  await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, s.fields);
  await refreshReportIndex(s.t, s.ids.orgId);
  const report = await s.t.query(api.reports.getTransactionReport, s.scope);
  expect(report.items).toHaveLength(1);
  expect(report.items[0]).toMatchObject({ sourceId: id, kind: 'account_transfer', direction: 'outflow', amount: '1.000001', transferId: s.fields.transferId, dateSource: 'provider' });
  expect(report.totals[0].outflow).toBe('1.000001');
  expect(await s.t.run(ctx => ctx.db.query('disbursements').collect())).toEqual([]);
  const other = await signIn(s.t, 'nonMember');
  await expect(s.t.query(api.reports.getTransactionReport, { ...s.scope, sessionToken: other.sessionToken })).rejects.toThrow();
});

it('adds transfer evidence to an already recorded payment without changing its ID or counting it twice', async () => {
  const s = await setup(); const p = await payment(s);
  await refreshReportIndex(s.t, s.ids.orgId);
  const original = await s.t.query(api.reports.getTransactionReport, s.scope);
  await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, s.fields);
  await refreshReportIndex(s.t, s.ids.orgId);
  const report = await s.t.query(api.reports.getTransactionReport, s.scope);
  expect(report.items).toHaveLength(1);
  expect(report.items[0]).toMatchObject({ rowId: original.items[0].rowId, sourceId: p.id, kind: 'payment', transferId: s.fields.transferId, createdAt: timestamp });
  expect(report.totals[0].outflow).toBe('1.000001');
});

it('retains an exported transfer ID when Disburse confirms the payment later', async () => {
  const s = await setup(); const p = await payment(s, 'proposed');
  await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, s.fields);
  await refreshReportIndex(s.t, s.ids.orgId);
  const original = await s.t.query(api.reports.getTransactionReport, s.scope);
  expect(original.items[0].kind).toBe('account_transfer');
  expect((await s.t.run(ctx => ctx.db.get(p.id)))?.status).toBe('proposed');
  await s.t.mutation(internal.disbursements.confirmExecution, { disbursementId: p.id, safeTxHash, txHash,
    settlement: { blockNumber: '123', blockHash: `0x${'ef'.repeat(32)}`, timestamp } });
  await refreshReportIndex(s.t, s.ids.orgId);
  const report = await s.t.query(api.reports.getTransactionReport, s.scope);
  expect(report.items).toHaveLength(1);
  expect(report.items[0]).toMatchObject({ rowId: original.items[0].rowId, kind: 'payment', sourceId: p.id, dateSource: 'settlement' });
  expect(report.totals[0].outflow).toBe('1.000001');
});

it('matches equal batch legs one for one and keeps additional transfers and fees separate', async () => {
  const s = await setup(); const p = await payment(s);
  await s.t.run(async ctx => {
    await ctx.db.patch(p.id, { type: 'batch', totalAmount: '2.000002', executionFee: { token: 'USDC', tokenAddress: s.fields.tokenAddress, collector: TEST_WALLETS.viewer, amount: '0.05' } });
    for (let n = 0; n < 2; n++) await ctx.db.insert('disbursementRecipients', { disbursementId: p.id, beneficiaryId: p.beneficiaryId,
      recipientAddress: s.fields.toAddress, recipientName: 'Vendor', amount: s.fields.amount, createdAt: Date.now() });
  });
  for (let n = 1; n <= 3; n++) await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, { ...s.fields, transferId: `e${txHash.slice(2)}${n}` });
  await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, { ...s.fields, transferId: `e${txHash.slice(2)}4`, toAddress: TEST_WALLETS.viewer, amount: '0.05', amountRaw: '50000' });
  await refreshReportIndex(s.t, s.ids.orgId);
  const report = await s.t.query(api.reports.getTransactionReport, s.scope);
  expect(report.items).toHaveLength(4);
  expect(new Set(report.items.map(r => r.transferId)).size).toBe(4);
  expect(report.items.filter(r => r.kind === 'fee')).toHaveLength(1);
  expect(report.items.filter(r => r.kind === 'account_transfer')).toHaveLength(1);
  expect(report.totals[0].outflow).toBe('3.050003');
  const spending = await s.t.query(api.reports.getSpendingByBeneficiary, s.scope);
  expect(spending.items[0].totalPaid).toBe('2.000002');
});

it('does not match a same-symbol token or another network, account or recipient', async () => {
  const s = await setup(); await payment(s);
  await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, { ...s.fields, tokenAddress: TEST_WALLETS.viewer });
  await expect(s.t.mutation(internal.depositsData.upsertOutgoingTransfer, { ...s.fields, chainId: 1 })).rejects.toThrow('account and network');
  await expect(s.t.mutation(internal.depositsData.upsertOutgoingTransfer, { ...s.fields, fromAddress: TEST_WALLETS.viewer })).rejects.toThrow('account and network');
  await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, { ...s.fields, transferId: `e${txHash.slice(2)}2`, toAddress: TEST_WALLETS.viewer });
  await refreshReportIndex(s.t, s.ids.orgId);
  const report = await s.t.query(api.reports.getTransactionReport, s.scope);
  expect(report.items.filter(r => r.kind === 'payment')[0]).toMatchObject({ includedInTotals: false, transferMatch: 'pending' });
  expect(report.items.find(r => r.tokenAddress === TEST_WALLETS.viewer.toLowerCase())?.includedInTotals).toBe(false);
  expect(report.totals[0].outflow).toBe('1.000001');
});

it('rejects changed chain evidence and holds exports when the provider disagrees with a verified settlement block', async () => {
  const s = await setup(); const p = await payment(s);
  await s.t.run(ctx => ctx.db.patch(p.id, { settlement: { blockNumber: '124', blockHash: `0x${'ef'.repeat(32)}`, timestamp } }));
  await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, s.fields);
  await expect(s.t.mutation(internal.depositsData.upsertOutgoingTransfer, { ...s.fields, amountRaw: '9' })).rejects.toThrow('conflicts');
  const job = await s.t.run(ctx => ctx.db.query('reportIndexJobs').filter(q => q.eq(q.field('kind'), 'outgoing')).first());
  await s.t.action(internal.reportIndex.runJob, { jobId: job!._id });
  const report = await s.t.query(api.reports.getTransactionReport, s.scope);
  expect(report.indexing).toBe(true);
  expect(report.indexErrors[0]).toContain('verified payment block');
  await expect(s.t.query(api.reports.getTransactionReport, { ...s.scope, snapshotVersion: report.indexVersion })).rejects.toThrow();
});

it('upgrades completed incoming-only histories with a full all-transfer scan and handles self-transfers once in each direction', async () => {
  const s = await setup();
  const syncId = await s.t.run(ctx => ctx.db.insert('depositSyncs', { orgId: s.ids.orgId, safeId: s.ids.safeId, chainId: 11155111,
    lastSyncedAt: Date.now(), lastFullScanAt: Date.now(), completedThrough: Date.now() - 60_000 }));
  await s.t.mutation(internal.depositsData.requestSync, { safeId: s.ids.safeId });
  const sync = await s.t.run(ctx => ctx.db.get(syncId));
  expect(sync?.scan).toMatchObject({ from: 0, full: true, scope: 'all' });
  expect(sync?.scan?.cursor).toContain('/transfers/');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ next: null, results: [{ type: 'ERC20_TRANSFER', transferId: s.fields.transferId,
    transactionHash: txHash, executionDate: new Date(timestamp).toISOString(), blockNumber: 123,
    to: s.ids.safeAddress, from: s.ids.safeAddress, value: '1000001', tokenAddress: s.fields.tokenAddress }] }))));
  await s.t.action(internal.deposits.process, { syncId });
  expect((await s.t.run(ctx => ctx.db.get(syncId)))?.historyScope).toBe('all');
  await refreshReportIndex(s.t, s.ids.orgId);
  const report = await s.t.query(api.reports.getTransactionReport, s.scope);
  expect(report.items).toHaveLength(2);
  expect(report.totals[0]).toMatchObject({ inflow: '1.000001', outflow: '1.000001', net: '0' });
});

it('finishes an interrupted legacy cursor before starting its complete history scan', async () => {
  const s = await setup(); const through = Date.now() - 60_000;
  const cursor = depositScanUrl(11155111, s.ids.safeAddress, 0, through);
  const syncId = await s.t.run(ctx => ctx.db.insert('depositSyncs', { orgId: s.ids.orgId, safeId: s.ids.safeId, chainId: 11155111,
    lastSyncedAt: 0, generation: 1, scan: { from: 0, through, cursor, page: 20, full: true } }));
  await s.t.mutation(internal.depositsData.requestSync, { safeId: s.ids.safeId });
  expect((await s.t.run(ctx => ctx.db.get(syncId)))?.scan?.cursor).toBe(cursor);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ next: null, results: [] }))));
  await s.t.action(internal.deposits.process, { syncId });
  expect((await s.t.run(ctx => ctx.db.get(syncId)))?.historyScope).toBeUndefined();
  await s.t.mutation(internal.depositsData.requestSync, { safeId: s.ids.safeId });
  expect((await s.t.run(ctx => ctx.db.get(syncId)))?.scan).toMatchObject({ from: 0, scope: 'all' });
});

it('rejects transfers unrelated to the Safe and preserves transfer/log identity in the parser', () => {
  const base = { type: 'ERC20_TRANSFER', transferId: `e${txHash.slice(2)}42`, transactionHash: txHash,
    executionDate: new Date(timestamp).toISOString(), blockNumber: 123, from: TEST_WALLETS.admin,
    to: TEST_WALLETS.viewer, tokenAddress: CHAIN_TOKENS[11155111].USDC.address, value: '1' };
  expect(parseAccountTransfer(base, 11155111, TEST_WALLETS.admin, 0, Date.now())).toMatchObject({ transferId: base.transferId, amount: '0.000001' });
  expect(() => parseAccountTransfer(base, 11155111, TEST_WALLETS.initiator, 0, Date.now())).toThrow('invalid payment details');
});
