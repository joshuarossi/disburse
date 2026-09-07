import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeEventTopics, padHex, parseAbi, parseAbiItem } from 'viem';
import schema from '../schema';
import { api, internal } from '../_generated/api';
import { createFullOrgSetup, signIn, TEST_WALLETS } from './factories';
import quoteFixture from '../../src/lib/__tests__/fixtures/customerQuote.json';
import { ENTRY_POINT } from '../../shared/customerPaidExecution';
import { SAFE_4337_MODULE } from '../../shared/safe4337';
import runtime from '../../src/lib/__tests__/fixtures/safe4337Runtime.json';
import { verifySafeOwnership } from '../lib/safeVerification';

const chain = vi.hoisted(() => ({ getChainId: vi.fn(), getBlockNumber: vi.fn(), getBlock: vi.fn(), getLogs: vi.fn(), getTransactionReceipt: vi.fn(), getStorageAt: vi.fn(), readContract: vi.fn(), getCode: vi.fn() }));
vi.mock('../lib/safeVerification', () => ({ getChainClient: () => chain, verifySafeOwnership: vi.fn() }));
const blockHash = `0x${'cd'.repeat(32)}`;
const feeHash = `0x${'11'.repeat(32)}`;
const workHash = `0x${'22'.repeat(32)}`;
const now = 1788797050_000;
const decoded = decodeFunctionData({ abi: parseAbi(['function execute(bytes32 mode, bytes executionCalldata)']), data: quoteFixture.userOps[1].userOp.callData as `0x${string}` });
const calls = decodeAbiParameters([{ type: 'tuple[]', components: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }], decoded.args[1])[0];
const record = JSON.stringify({ quote: quoteFixture, startBlock: '100', intent: { chainId: 84532, owner: quoteFixture.paymentInfo.eoa, companion: quoteFixture.paymentInfo.sender, token: quoteFixture.paymentInfo.token, amount: '1000000', calls: calls.slice(1).map(c => ({ ...c, value: c.value.toString() })), initCode: quoteFixture.paymentInfo.initCode, validAfter: 1788797030, validUntil: 1788797630 }, account: { address: '0x6F3247C769e2b8e7BEE392D102106Ad1D6b52278', owners: [quoteFixture.paymentInfo.eoa], threshold: 1 } });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  chain.getChainId.mockResolvedValue(84532);
  chain.getBlockNumber.mockResolvedValue(500n);
  chain.getBlock.mockImplementation(async ({ blockNumber }) => ({ hash: blockHash, number: blockNumber, timestamp: BigInt(Math.floor(Date.now() / 1000)) }));
  chain.getLogs.mockResolvedValue([]);
  chain.getStorageAt.mockResolvedValue(padHex(SAFE_4337_MODULE, { size: 32 }));
  chain.readContract.mockResolvedValue(true);
  chain.getCode.mockResolvedValue(runtime.bytecode);
  vi.mocked(verifySafeOwnership).mockResolvedValue({ owners: [quoteFixture.paymentInfo.eoa], threshold: 1 });
  chain.getTransactionReceipt.mockImplementation(async ({ hash }) => ({ status: 'success', blockNumber: 490n, blockHash, logs: [rawLog(hash === feeHash ? 0 : 1, true)] }));
});
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(ctx => createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }));
  const auth = await signIn(t, 'admin');
  // This suite tests session-bound journaling; signature recovery has its own real-signature suite.
  await t.run(ctx => ctx.db.patch(auth.userId, { walletAddress: quoteFixture.paymentInfo.eoa }));
  return { t, ids, args: { orgId: ids.orgId, sessionToken: auth.sessionToken, record } };
}
function log(index: number, success: boolean) {
  const op = quoteFixture.userOps[index];
  return { address: ENTRY_POINT, args: { userOpHash: op.userOpHash, sender: op.userOp.sender, nonce: BigInt(op.userOp.nonce), success }, transactionHash: index ? workHash : feeHash, blockNumber: 490n, blockHash, removed: false };
}
function rawLog(index: number, success: boolean) {
  const entry = log(index, success);
  return { ...entry, data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }], [entry.args.nonce, success, 1n, 1n]), topics: encodeEventTopics({ abi: [parseAbiItem('event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)')], eventName: 'UserOperationEvent', args: { userOpHash: entry.args.userOpHash as `0x${string}`, sender: entry.args.sender as `0x${string}`, paymaster: TEST_WALLETS.admin as `0x${string}` } }) };
}
it('records the original request idempotently and blocks a concurrent different setup', async () => {
  const { t, args } = await setup();
  const first = await t.mutation(api.customerOperations.begin, args);
  expect(await t.mutation(api.customerOperations.begin, args)).toBe(first);
  expect((await t.query(api.customerOperations.current, { orgId: args.orgId, sessionToken: args.sessionToken }))?._id).toBe(first);
  expect((await t.run(ctx => ctx.db.query('customerOperations').collect())).length).toBe(1);
  await t.run(ctx => ctx.db.patch(first, { hash: workHash }));
  await expect(t.mutation(api.customerOperations.begin, args)).rejects.toThrow('earlier setup request');
});
it('rejects a different wallet, a viewer, and expired quotes without creating a recovery record', async () => {
  const { t, args, ids } = await setup();
  const forged = JSON.parse(record); forged.intent.owner = TEST_WALLETS.viewer;
  await expect(t.mutation(api.customerOperations.begin, { ...args, record: JSON.stringify(forged) })).rejects.toThrow();
  const viewer = await signIn(t, 'viewer');
  await t.run(ctx => ctx.db.insert('orgMemberships', { orgId: ids.orgId, userId: viewer.userId, role: 'viewer', status: 'active', createdAt: now }));
  await expect(t.mutation(api.customerOperations.begin, { ...args, sessionToken: viewer.sessionToken })).rejects.toThrow('permissions');
  vi.setSystemTime(now + 600_000);
  await expect(t.mutation(api.customerOperations.begin, args)).rejects.toThrow('expired');
  expect(await t.run(ctx => ctx.db.query('customerOperations').collect())).toEqual([]);
});
it('locks the payer across organizations so simultaneous setups cannot reuse a USDC permit nonce', async () => {
  const { t, args, ids } = await setup();
  await t.mutation(api.customerOperations.begin, args);
  const anotherOrg = await t.run(async ctx => {
    const original = (await ctx.db.get(ids.orgId))!;
    const { _id, _creationTime, ...fields } = original; void _id; void _creationTime;
    const orgId = await ctx.db.insert('orgs', { ...fields, name: 'Another company' });
    const membership = (await ctx.db.query('orgMemberships').withIndex('by_org_and_user', q => q.eq('orgId', ids.orgId).eq('userId', ids.userId)).unique())!;
    const { _id: mid, _creationTime: mt, ...memberFields } = membership; void mid; void mt;
    await ctx.db.insert('orgMemberships', { ...memberFields, orgId });
    return orgId;
  });
  await expect(t.mutation(api.customerOperations.begin, { ...args, orgId: anotherOrg })).rejects.toThrow('earlier account setup for this wallet');
  expect(await t.query(api.customerOperations.conflict, { orgId: anotherOrg, chainId: 84532, sessionToken: args.sessionToken })).toHaveProperty('operationId');
  expect(await t.run(ctx => ctx.db.query('customerOperations').collect())).toHaveLength(1);
});
it('does not turn an RPC outage into expiry or permit another paid request', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  vi.setSystemTime(now + 1_000_000);
  chain.getLogs.mockRejectedValue(new Error('RPC unavailable'));
  await expect(t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).rejects.toThrow('RPC unavailable');
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ open: true, state: 'pending', scanFrom: '100', feePaid: false });
});
it('checks both exact EntryPoint operation hashes and records the separately paid fee', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  chain.getLogs.mockResolvedValue([log(0, true), log(1, true)]);
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toEqual({ state: 'confirmed', feePaid: true, workTxHash: workHash });
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ state: 'confirmed', open: true, feePaid: true, feeTxHash: feeHash, workTxHash: workHash });
});
it('a failed work operation releases retry but retains the provider fee', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  chain.getLogs.mockResolvedValue([log(0, true), log(1, false)]);
  chain.getTransactionReceipt.mockImplementation(async ({ hash }) => ({ status: 'success', blockNumber: 490n, blockHash, logs: [rawLog(hash === feeHash ? 0 : 1, hash === feeHash)] }));
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toMatchObject({ state: 'failed', feePaid: true });
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ open: false, feePaid: true });
});
it.each(['address', 'sender', 'nonce', 'hash', 'removed'] as const)('does not accept unrelated or removed logs: %s', async mismatch => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  const forged = log(1, true);
  if (mismatch === 'address') forged.address = TEST_WALLETS.viewer as typeof ENTRY_POINT;
  if (mismatch === 'sender') forged.args.sender = TEST_WALLETS.viewer;
  if (mismatch === 'nonce') forged.args.nonce++;
  if (mismatch === 'hash') forged.args.userOpHash = feeHash;
  if (mismatch === 'removed') forged.removed = true;
  chain.getLogs.mockResolvedValue([log(0, true), forged]);
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toMatchObject({ state: 'pending' });
});
it('waits for the work validity window even when the fee operation failed', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  chain.getLogs.mockResolvedValue([log(0, false)]);
  chain.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 490n, blockHash, logs: [rawLog(0, false)] });
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toMatchObject({ state: 'pending', feePaid: false });
});
it('only expires after a complete canonical scan beyond the signed validity window', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  vi.setSystemTime(now + 1_000_000);
  chain.getBlockNumber.mockResolvedValue(3000n);
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toMatchObject({ state: 'pending' });
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toMatchObject({ state: 'expired', feePaid: false });
});
it('does not advance the scan across a changed canonical block', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  chain.getLogs.mockResolvedValue([log(0, true)]);
  chain.getBlock.mockImplementation(async ({ blockNumber }) => ({ hash: blockNumber === 490n ? feeHash : blockHash, number: blockNumber, timestamp: BigInt(now / 1000) }));
  await expect(t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).rejects.toThrow('reorganized');
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ scanFrom: '100', feePaid: false });
});

it('does not discard a successful deposit when the fee window expires without evidence of a fee', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  chain.getLogs.mockResolvedValue([log(1, true)]);
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toMatchObject({ state: 'pending' });
  vi.setSystemTime(now + 1_000_000);
  chain.getBlockNumber.mockResolvedValue(600n);
  chain.getLogs.mockResolvedValue([]);
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toMatchObject({ state: 'confirmed', feePaid: false });
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ workSuccess: true, workTxHash: workHash, open: true });
});
it('does not release a failed setup while its separately authorized fee can still execute', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  chain.getLogs.mockResolvedValue([log(1, false)]);
  chain.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 490n, blockHash, logs: [rawLog(1, false)] });
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toMatchObject({ state: 'pending' });
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ workSuccess: false, open: true });
  vi.setSystemTime(now + 1_000_000); chain.getBlockNumber.mockResolvedValue(600n); chain.getLogs.mockResolvedValue([]);
  expect(await t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).toMatchObject({ state: 'failed', feePaid: false });
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ open: false });
});
it('allows the original payer to recover its own request after org access is revoked, without granting org write access', async () => {
  const { t, args, ids } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  await t.run(async ctx => {
    const membership = (await ctx.db.query('orgMemberships').withIndex('by_org_and_user', q => q.eq('orgId', ids.orgId).eq('userId', ids.userId)).unique())!;
    await ctx.db.patch(membership._id, { role: 'viewer' });
  });
  const identity = { operationId, sessionToken: args.sessionToken };
  expect(await t.action(api.customerExecution.refresh, identity)).toMatchObject({ state: 'pending' });
  await expect(t.action(api.customerExecution.completeSetup, identity)).rejects.toThrow('permissions');
  const other = await signIn(t, 'viewer');
  await expect(t.action(api.customerExecution.refresh, { ...identity, sessionToken: other.sessionToken })).rejects.toThrow('wallet that started');
});
it('a changed scan checkpoint prevents expiry even when the first log response was empty', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  vi.setSystemTime(now + 1_000_000);
  chain.getBlock.mockResolvedValueOnce({ hash: blockHash, number: 498n, timestamp: BigInt((now + 1_000_000) / 1000) }).mockResolvedValueOnce({ hash: feeHash, number: 498n, timestamp: BigInt((now + 1_000_000) / 1000) });
  await expect(t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).rejects.toThrow('reorganized this scan');
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ state: 'pending', scanFrom: '100', open: true });
});
it('an inconsistent receipt cannot advance the scan or permit a duplicate setup', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  chain.getLogs.mockResolvedValue([log(1, true)]);
  chain.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 490n, blockHash, logs: [] });
  await expect(t.action(api.customerExecution.refresh, { operationId, sessionToken: args.sessionToken })).rejects.toThrow('does not confirm');
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ scanFrom: '100', open: true });
});
it('ignores an overlapping stale scan result', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  await t.mutation(internal.customerOperations.reconcile, { operationId, state: 'pending', feePaid: true, feeTxHash: feeHash, expectedScanFrom: '100', scanFrom: '499' });
  expect(await t.mutation(internal.customerOperations.reconcile, { operationId, state: 'expired', feePaid: false, expectedScanFrom: '100', scanFrom: '600' })).toMatchObject({ state: 'pending', feePaid: true });
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ scanFrom: '499', open: true });
});

it('links a confirmed account once and retains its original setup evidence on repeated completion', async () => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  chain.getLogs.mockResolvedValue([log(0, true), log(1, true)]);
  const identity = { operationId, sessionToken: args.sessionToken };
  await t.action(api.customerExecution.refresh, identity);
  const result = await t.action(api.customerExecution.completeSetup, identity);
  expect(await t.action(api.customerExecution.completeSetup, identity)).toEqual(result);
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ open: false, state: 'confirmed', safeId: result.safeId, feeTxHash: feeHash, workTxHash: workHash });
  expect(await t.run(ctx => ctx.db.get(result.safeId))).toMatchObject({ chainId: 84532, owners: [quoteFixture.paymentInfo.eoa], threshold: 1 });
});

it.each(['disabled module', 'different handler', 'unverified code', 'changed owners'] as const)('keeps paid setup recoverable when the deployed account has %s', async failure => {
  const { t, args } = await setup();
  const operationId = await t.mutation(api.customerOperations.begin, args);
  chain.getLogs.mockResolvedValue([log(0, true), log(1, true)]);
  const identity = { operationId, sessionToken: args.sessionToken };
  await t.action(api.customerExecution.refresh, identity);
  if (failure === 'disabled module') chain.readContract.mockResolvedValue(false);
  if (failure === 'different handler') chain.getStorageAt.mockResolvedValue(padHex(TEST_WALLETS.admin as `0x${string}`, { size: 32 }));
  if (failure === 'unverified code') chain.getCode.mockResolvedValue('0x6000');
  if (failure === 'changed owners') vi.mocked(verifySafeOwnership).mockResolvedValue({ owners: [TEST_WALLETS.admin], threshold: 1 });
  await expect(t.action(api.customerExecution.completeSetup, identity)).rejects.toThrow(failure === 'changed owners' ? 'different owners' : 'not configured for stablecoin');
  expect(await t.run(ctx => ctx.db.get(operationId))).toMatchObject({ state: 'confirmed', open: true, feePaid: true, workTxHash: workHash });
  expect((await t.run(ctx => ctx.db.query('safes').collect())).filter(safe => safe.chainId === 84532)).toEqual([]);
});

it.each(['missing account', 'invalid address', 'invalid owners', 'duplicate owners', 'invalid threshold', 'invalid block', 'invalid amount'] as const)('rejects %s before accepting a setup request', async failure => {
  const { t, args } = await setup();
  const malformed = JSON.parse(record);
  if (failure === 'missing account') delete malformed.account;
  if (failure === 'invalid address') malformed.account.address = 'private provider diagnostics';
  if (failure === 'invalid owners') malformed.account.owners = 'not an array';
  if (failure === 'duplicate owners') malformed.account.owners.push(malformed.account.owners[0].toLowerCase());
  if (failure === 'invalid threshold') malformed.account.threshold = 9;
  if (failure === 'invalid block') malformed.startBlock = '9'.repeat(100);
  if (failure === 'invalid amount') malformed.intent.amount = 'Infinity';
  await expect(t.mutation(api.customerOperations.begin, { ...args, record: JSON.stringify(malformed) })).rejects.toThrow(failure === 'missing account' ? 'Account details are missing' : 'saved setup details could not be read');
  expect(await t.run(ctx => ctx.db.query('customerOperations').collect())).toEqual([]);
});
