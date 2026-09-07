import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { api, internal } from '../_generated/api';
import schema from '../schema';
import { createFullOrgSetup, signIn, TEST_WALLETS } from './factories';
import { refreshReportIndex } from './reportHelpers';
import { configuredTokenAddress } from '../../shared/assets';
import { balancePeriod, blockBefore } from '../lib/balanceProof';

const rpc = vi.hoisted(() => ({ getChainId: vi.fn(), getBlock: vi.fn(), getBytecode: vi.fn(), readContract: vi.fn() }));
vi.mock('../lib/safeVerification', () => ({ getChainClient: () => rpc }));
const epoch = BigInt(Date.UTC(2026, 7, 30) / 1000);
const block = (number: bigint) => ({ number, hash: `0x${number.toString(16).padStart(64, '0')}`, timestamp: epoch + number * 12n });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 6)); vi.resetAllMocks();
  rpc.getChainId.mockResolvedValue(11155111);
  rpc.getBlock.mockImplementation(async ({ blockNumber }) => block(blockNumber ?? 40000n));
  rpc.getBytecode.mockResolvedValue('0x1234');
  rpc.readContract.mockImplementation(async ({ blockNumber }) => blockNumber < 10000n ? 200000000n : 100000000n);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(ctx => createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }));
  const { sessionToken } = await signIn(t, 'admin');
  const hash = `0x${'aa'.repeat(32)}`;
  await t.mutation(internal.depositsData.upsertOutgoingTransfer, { orgId: ids.orgId, safeId: ids.safeId, safeAddress: ids.safeAddress.toLowerCase(), chainId: 11155111,
    tokenSymbol: 'USDC', tokenAddress: configuredTokenAddress(11155111, 'USDC')!, decimals: 6, amount: '100', amountRaw: '100000000',
    txHash: hash, transferId: `e${hash.slice(2)}1`, blockNumber: 10000, timestamp: Number(block(10000n).timestamp) * 1000,
    fromAddress: ids.safeAddress.toLowerCase(), toAddress: TEST_WALLETS.approver.toLowerCase(), source: 'safe_tx_service' });
  await refreshReportIndex(t, ids.orgId);
  const history = await t.run(ctx => ctx.db.insert('depositSyncs', { orgId: ids.orgId, safeId: ids.safeId, chainId: 11155111,
    lastSyncedAt: Date.now(), lastFullScanAt: Date.now(), completedThrough: Date.now(), historyScope: 'all' }));
  const args = { orgId: ids.orgId, safeId: ids.safeId, sessionToken, token: 'USDC', startDate: '2026-08-31', endDate: '2026-08-31' };
  return { t, ids, args, history };
}
it('matches opening plus recorded flows to closing units at precise UTC block boundaries', async () => {
  const s = await setup();
  const id = await s.t.action(api.accountBalances.check, s.args);
  const proof = await s.t.run(ctx => ctx.db.get(id));
  expect(proof).toMatchObject({ status: 'matched', opening: { blockNumber: '7199', balanceRaw: '200000000' },
    closing: { blockNumber: '14399', balanceRaw: '100000000' }, outflowRaw: '100000000', inflowRaw: '0', differenceRaw: '0', movementCount: 1 });
  expect(rpc.readContract.mock.calls.every(([args]) => typeof args.blockNumber === 'bigint')).toBe(true);
  expect(await s.t.query(api.accountBalances.list, { orgId: s.ids.orgId, sessionToken: s.args.sessionToken, environment: 'production' })).toEqual([]);
});
it('retains a discrepancy as needs review rather than calling an incomplete balance reconciled', async () => {
  const s = await setup();
  rpc.readContract.mockImplementation(async ({ blockNumber }) => blockNumber < 10000n ? 200000000n : 99000000n);
  const id = await s.t.action(api.accountBalances.check, s.args);
  expect(await s.t.run(ctx => ctx.db.get(id))).toMatchObject({ status: 'needs_review', differenceRaw: '-1000000' });
});
it('refuses incomplete history and changed report revisions without saving a successful check', async () => {
  const s = await setup();
  await s.t.run(ctx => ctx.db.patch(s.history, { completedThrough: Date.UTC(2026, 7, 31) }));
  await expect(s.t.action(api.accountBalances.check, s.args)).rejects.toThrow('complete incoming and outgoing');
  expect(rpc.getBlock).not.toHaveBeenCalled();
  await s.t.run(ctx => ctx.db.patch(s.history, { completedThrough: Date.now() }));
  rpc.getBytecode.mockImplementationOnce(async () => {
    await s.t.run(async ctx => { const state = await ctx.db.query('reportIndexStates').first(); await ctx.db.patch(state!._id, { revision: state!.revision + 1 }); });
    return '0x1234';
  });
  await expect(s.t.action(api.accountBalances.check, s.args)).rejects.toThrow('history changed');
  expect(await s.t.run(ctx => ctx.db.query('accountBalanceChecks').collect())).toEqual([]);
});
it('does not treat unavailable historical RPC data as a zero balance', async () => {
  const s = await setup();
  rpc.getBytecode.mockRejectedValue(new Error('Historical state unavailable'));
  await expect(s.t.action(api.accountBalances.check, s.args)).rejects.toThrow('Historical balances are unavailable');
  expect(await s.t.run(ctx => ctx.db.query('accountBalanceChecks').collect())).toEqual([]);
});
it('rejects a different network and unauthorized account access before querying balances', async () => {
  const s = await setup(), other = await signIn(s.t, 'nonMember');
  await expect(s.t.action(api.accountBalances.check, { ...s.args, sessionToken: other.sessionToken })).rejects.toThrow();
  expect(rpc.getChainId).not.toHaveBeenCalled();
  rpc.getChainId.mockResolvedValue(1);
  await expect(s.t.action(api.accountBalances.check, s.args)).rejects.toThrow('network could not be verified');
});
it('places equal-timestamp blocks on the correct side of an accounting boundary', async () => {
  const read = async (n: bigint) => ({ ...block(n), timestamp: epoch + (n / 3n) * 12n });
  const result = await blockBefore(read, await read(100n), Number(epoch + 24n) * 1000);
  expect(result.number).toBe(5n);
  expect(() => balancePeriod('2026-09-06', '2026-09-06')).toThrow('completed dates');
  expect(() => balancePeriod('2026-02-30', '2026-03-01')).toThrow('valid accounting date');
});
