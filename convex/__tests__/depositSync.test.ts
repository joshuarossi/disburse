import { refreshReportIndex } from './reportHelpers';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import schema from '../schema';
import { api, internal } from '../_generated/api';
import { CHAIN_TOKENS } from '../../shared/chains';
import { parseDeposit, validateDepositCursor, depositScanUrl } from '../lib/depositSync';
import { createFullOrgSetup, signIn, TEST_WALLETS } from './factories';

const txHash = `0x${'a1'.repeat(32)}`;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(ctx => createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }));
  const { sessionToken } = await signIn(t, 'admin');
  await t.mutation(internal.depositsData.requestSync, { safeId: ids.safeId });
  const sync = await t.run(ctx => ctx.db.query('depositSyncs').first());
  if (!sync) throw new Error('No sync started');
  const fields = { orgId: ids.orgId, safeId: ids.safeId, chainId: 11155111, safeAddress: ids.safeAddress, tokenAddress: CHAIN_TOKENS[11155111].USDC.address, tokenSymbol: 'USDC', decimals: 6, amountRaw: '1', amount: '0.000001', timestamp: Date.now() - 86400_000, txHash, transferId: `e${txHash.slice(2)}1`, fromAddress: TEST_WALLETS.approver, toAddress: ids.safeAddress, source: 'safe_tx_service' as const };
  return { t, ids, sync, fields, scope: { orgId: ids.orgId, sessionToken } };
}

it('keeps separate transfers in one transaction and the same Safe linked to another organization', async () => {
  const { t, ids, fields } = await setup();
  await t.mutation(internal.depositsData.upsertDeposit, fields);
  await t.mutation(internal.depositsData.upsertDeposit, { ...fields, transferId: `e${txHash.slice(2)}2` });
  await t.mutation(internal.depositsData.upsertDeposit, fields);
  const other = await t.run(async ctx => {
    const other = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.viewer });
    await ctx.db.patch(other.safeId, { safeAddress: ids.safeAddress });
    return other;
  });
  await t.mutation(internal.depositsData.upsertDeposit, { ...fields, orgId: other.orgId, safeId: other.safeId });
  expect(await t.run(ctx => ctx.db.query('deposits').collect())).toHaveLength(3);
});

it('respects provider backoff and pauses archived accounts without losing their continuation', async () => {
  const { t, ids, sync, scope } = await setup();
  const state = (await t.mutation(internal.depositsData.claimPage, { syncId: sync._id }))!;
  await t.mutation(internal.depositsData.failed, { syncId: sync._id, generation: state.generation!, cursor: state.scan!.cursor, leaseUntil: state.leaseUntil, error: 'Rate limited', retryAfterMs: 7200_000 });
  expect((await t.run(ctx => ctx.db.get(sync._id)))?.nextAttemptAt).toBe(Date.now() + 7200_000);
  await t.run(ctx => ctx.db.patch(ids.safeId, { isActive: false }));
  expect(await t.query(api.depositsData.statusForOrg, scope)).toEqual([]);
  vi.setSystemTime(Date.now() + 7200_001);
  await t.mutation(internal.depositsData.recover, {});
  const paused = await t.run(ctx => ctx.db.get(sync._id));
  expect(paused?.nextAttemptAt).toBeUndefined();
  expect(paused?.scan?.cursor).toBe(state.scan!.cursor);
});

it('migrates legacy collapsed records once, preserves prior values and does not double-count duplicate legacy rows', async () => {
  const { t, fields, scope } = await setup();
  const { transferId, ...legacy } = fields;
  void transferId;
  await t.run(async ctx => {
    await ctx.db.insert('deposits', { ...legacy, amountRaw: '99', amount: '0.000099', createdAt: Date.now() });
    await ctx.db.insert('deposits', { ...legacy, createdAt: Date.now() });
  });
  await t.mutation(internal.depositsData.upsertDeposit, fields);
  await t.mutation(internal.depositsData.upsertDeposit, { ...fields, transferId: `e${txHash.slice(2)}2` });
  const rows = await t.run(ctx => ctx.db.query('deposits').collect());
  expect(rows).toHaveLength(3);
  expect(rows.filter(d => !d.supersededBy)).toHaveLength(2);
  expect(rows.find(d => d.legacyRecord)?.legacyRecord?.amountRaw).toBe('99');
  await refreshReportIndex(t, scope.orgId);
  const report = await t.query(api.reports.getTransactionReport, { ...scope, environment: 'test' });
  expect(report.items).toHaveLength(2);
  expect(report.totals[0].inflow).toBe('0.000002');
});

it('commits rows and cursor atomically, retains equal timestamps and advances the watermark only after the final page', async () => {
  const { t, sync, fields } = await setup();
  const state = await t.mutation(internal.depositsData.claimPage, { syncId: sync._id });
  const next = new URL(sync.scan!.cursor); next.searchParams.set('offset', '100');
  const args = { syncId: sync._id, generation: state!.generation!, leaseUntil: state!.leaseUntil, cursor: state!.scan!.cursor, next: next.toString(), deposits: [fields] };
  expect(await t.mutation(internal.depositsData.storePage, args)).toBe(true);
  expect(await t.mutation(internal.depositsData.storePage, args)).toBe(false);
  let checkpoint = await t.run(ctx => ctx.db.get(sync._id));
  expect(checkpoint?.completedThrough).toBeUndefined();
  expect(checkpoint?.lastSyncedAt).toBe(0);
  const second = await t.mutation(internal.depositsData.claimPage, { syncId: sync._id });
  await t.mutation(internal.depositsData.storePage, { ...args, cursor: second!.scan!.cursor, leaseUntil: second!.leaseUntil, next: null, deposits: [{ ...fields, transferId: `e${txHash.slice(2)}2` }] });
  checkpoint = await t.run(ctx => ctx.db.get(sync._id));
  expect(checkpoint?.completedThrough).toBe(sync.scan!.through);
  expect(checkpoint?.scan).toBeUndefined();
  expect(await t.run(ctx => ctx.db.query('deposits').collect())).toHaveLength(2);
});

it('continues beyond the old pagination cap and includes history before account linking', async () => {
  const { t, sync, ids } = await setup();
  const historyTime = Date.now() - 365 * 86400_000;
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('offset') ?? 0) / 100;
    const next = new URL(url); next.searchParams.set('offset', String((page + 1) * 100));
    return new Response(JSON.stringify({ next: page === 29 ? null : next.toString(), results: [{ type: 'ERC20_TRANSFER', transferId: `e${txHash.slice(2)}${page}`, transactionHash: txHash, executionDate: new Date(historyTime).toISOString(), blockNumber: 100, to: ids.safeAddress, from: TEST_WALLETS.approver, value: '1', tokenAddress: CHAIN_TOKENS[11155111].USDC.address, tokenInfo: { symbol: 'Wrong metadata', decimals: 0 } }] }));
  }));
  for (let i = 0; i < 8; i++) await t.action(internal.deposits.process, { syncId: sync._id });
  expect(fetch).toHaveBeenCalledTimes(30);
  const rows = await t.run(ctx => ctx.db.query('deposits').collect());
  expect(rows).toHaveLength(30);
  expect(rows.every(r => r.amount === '0.000001' && r.tokenSymbol === 'USDC')).toBe(true);
  expect((await t.run(ctx => ctx.db.get(sync._id)))?.lastFullScanAt).toBeTypeOf('number');
});

it('retains its page after an outage and exposes a retry without a false successful refresh', async () => {
  const { t, sync, scope } = await setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  await t.action(internal.deposits.process, { syncId: sync._id });
  const status = await t.query(api.depositsData.statusForOrg, scope);
  expect(status[0]).toMatchObject({ lastSyncedAt: null, historyReconciled: false, syncing: false });
  expect(status[0].error).toContain('HTTP 503');
  const checkpoint = await t.run(ctx => ctx.db.get(sync._id));
  expect(checkpoint?.scan?.cursor).toBe(sync.scan!.cursor);
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ results: [], next: null })));
  await t.action(api.deposits.syncForOrg, { ...scope, force: true });
  await t.action(internal.deposits.process, { syncId: sync._id });
  expect((await t.query(api.depositsData.statusForOrg, scope))[0]).toMatchObject({ error: null, historyReconciled: true, syncing: false });
});

it('rejects cross-account pages atomically and does not expose sync state outside the organization', async () => {
  const { t, sync, fields, scope } = await setup();
  const state = await t.mutation(internal.depositsData.claimPage, { syncId: sync._id });
  await expect(t.mutation(internal.depositsData.storePage, { syncId: sync._id, generation: state!.generation!, cursor: state!.scan!.cursor, leaseUntil: state!.leaseUntil, next: null, deposits: [fields, { ...fields, transferId: `e${txHash.slice(2)}2`, toAddress: TEST_WALLETS.viewer }] })).rejects.toThrow('destination');
  expect(await t.run(ctx => ctx.db.query('deposits').collect())).toHaveLength(0);
  expect((await t.run(ctx => ctx.db.get(sync._id)))?.scan?.cursor).toBe(sync.scan!.cursor);
  const outsider = await signIn(t, 'nonMember');
  await expect(t.query(api.depositsData.statusForOrg, { ...scope, sessionToken: outsider.sessionToken })).rejects.toThrow();
});

it('rejects unsafe or repeated continuation URLs and ignores collectibles', () => {
  const base = depositScanUrl(11155111, TEST_WALLETS.admin, 0, Date.now());
  expect(() => validateDepositCursor(base.replace('api.safe.global', 'attacker.invalid'), base)).toThrow();
  const legacy = base.replace('https://api.safe.global/tx-service/sep/api', 'https://safe-transaction-sepolia.safe.global/api');
  expect(validateDepositCursor(legacy, base)).toBe(base);
  expect(() => validateDepositCursor(base.replace('/tx-service/sep/', '/tx-service/eth/'), base)).toThrow();
  expect(() => validateDepositCursor(base, base, base)).toThrow('advance');
  expect(() => validateDepositCursor(`${base}&token_address=${TEST_WALLETS.viewer}`, base)).toThrow('filters');
  expect(() => validateDepositCursor(`${base}&limit=0`, base)).toThrow('filters');
  expect(parseDeposit({ type: 'ERC721_TRANSFER' }, 11155111, TEST_WALLETS.admin, 0, Date.now())).toBeNull();
});
