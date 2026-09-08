import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import schema from '../schema';
import { createFullOrgSetup, createTestBeneficiary, createTestDisbursement, signIn, TEST_WALLETS } from './factories';
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { feeIdentity } from '../../shared/executionFee';
const provider = vi.hoisted(() => ({ sendTransaction: vi.fn(), getStatus: vi.fn(), getCapabilities: vi.fn(), getBalance: vi.fn(), configurationError: false }));
vi.mock('../lib/managedRelay', () => ({ managedRelay: () => { if (provider.configurationError) throw new Error('Provider unavailable'); return provider; } }));
const chain = vi.hoisted(() => ({ getBlockNumber: vi.fn(), getLogs: vi.fn(), getTransactionReceipt: vi.fn(), getBlock: vi.fn(), getChainId: vi.fn() }));
vi.mock('../lib/safeVerification', () => ({ getChainClient: () => chain }));
const hash = '0x' + 'ab'.repeat(32);
const fee = { token: 'USDC', tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', collector: TEST_WALLETS.admin, amount: '0.05' };
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const org = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin });
    const beneficiaryId = await createTestBeneficiary(ctx, org.orgId);
    const disbursementId = await createTestDisbursement(ctx, org.orgId, org.safeId, beneficiaryId, org.userId, { status: 'proposed', safeTxHash: hash });
    await ctx.db.patch(disbursementId, { executionFee: fee, chainId: 1 });
    const safe = await ctx.db.get(org.safeId);
    return { ...org, disbursementId, to: safe!.safeAddress };
  });
  const { sessionToken } = await signIn(t, 'admin');
  const args = { disbursementId: ids.disbursementId, safeTxHash: hash, sessionToken, chainId: 1, to: ids.to, data: '0x1234' };
  return { t, ids, args };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { provider.configurationError = false; vi.clearAllTimers(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('refuses application-funded relay configuration before inspecting a Gas Tank or sending', async () => {
  const t = convexTest(schema);
  vi.stubEnv('GELATO_API_KEY', 'private-relay-test-key');
  vi.stubEnv('GELATO_1_FEE_COLLECTOR', fee.collector);
  vi.stubEnv('GELATO_1_FEE_USDC', fee.amount);
  await expect(t.action(internal.relayExecutor.configurationCheck, { chainId: 1, token: 'USDC' })).rejects.toThrow('customer-paid execution service');
  expect(provider.getBalance).not.toHaveBeenCalled();
  expect(provider.getCapabilities).not.toHaveBeenCalled();
  expect(provider.sendTransaction).not.toHaveBeenCalled();
  expect(await t.run(ctx => ctx.db.query('relayJobs').collect())).toHaveLength(0);
});
describe('managed relay durability and authorization', () => {
  it('reserves once and allows only one provider submission claim', async () => {
    vi.useFakeTimers();
    const { t, args } = await setup();
    const id = await t.mutation(internal.relayJobs.reserve, args);
    expect(await t.mutation(internal.relayJobs.reserve, args)).toBe(id);
    expect(await t.mutation(internal.relayJobs.begin, { jobId: id })).toBe(true);
    expect(await t.mutation(internal.relayJobs.begin, { jobId: id })).toBe(false);
    await t.mutation(internal.relayJobs.update, { jobId: id, status: 'submitted', error: 'Response interrupted' });
    expect(await t.mutation(internal.relayJobs.begin, { jobId: id })).toBe(false);
    expect((await t.run(ctx => ctx.db.get(args.disbursementId)))?.status).toBe('relaying');
  });
  it('rejects changed intent, substituted account, and cancelled schedules', async () => {
    const { t, args, ids } = await setup();
    await expect(t.mutation(internal.relayJobs.reserve, { ...args, safeTxHash: '0x' + 'cd'.repeat(32) })).rejects.toThrow('changed');
    await expect(t.mutation(internal.relayJobs.reserve, { ...args, to: fee.collector })).rejects.toThrow('changed');
    await t.run(ctx => ctx.db.patch(ids.disbursementId, { status: 'cancelled', scheduledVersion: 2, scheduledAt: Date.now() - 1000 }));
    await expect(t.mutation(internal.relayJobs.reserve, { ...args, sessionToken: undefined, scheduledVersion: 1 })).rejects.toThrow('changed');
  });
  it('never changes a stored provider request or treats provider submission as payment', async () => {
    vi.useFakeTimers();
    const { t, args } = await setup();
    const jobId = await t.mutation(internal.relayJobs.reserve, args);
    await t.mutation(internal.relayJobs.begin, { jobId });
    await t.mutation(internal.relayJobs.update, { jobId, status: 'submitted', providerId: 'request-1' });
    await expect(t.mutation(internal.relayJobs.update, { jobId, status: 'submitted', providerId: 'request-2' })).rejects.toThrow('replaced');
    await t.mutation(internal.relayJobs.update, { jobId, status: 'submitted', txHash: `0x${'11'.repeat(32)}` });
    await expect(t.mutation(internal.relayJobs.update, { jobId, status: 'submitted', txHash: `0x${'22'.repeat(32)}` })).rejects.toThrow('Original transaction cannot be replaced');
    expect((await t.run(ctx => ctx.db.get(args.disbursementId)))?.status).toBe('relaying');
  });
  it('rejects unsigned fee changes and includes the fee in member budgets', async () => {
    const { t, args, ids } = await setup();
    await t.run(async ctx => {
      await ctx.db.patch(ids.disbursementId, { status: 'draft', safeTxHash: undefined, amount: '100' });
      const m = await ctx.db.query('orgMemberships').withIndex('by_org_and_user', q => q.eq('orgId', ids.orgId).eq('userId', ids.userId)).first();
      await ctx.db.patch(m!._id, { paymentPolicy: { token: 'USDC', perPayment: '100' } });
    });
    const accept = { disbursementId: ids.disbursementId, sessionToken: args.sessionToken, reviewedIdentity: feeIdentity(fee) };
    await expect(t.mutation(api.relayQuotes.accept, { ...accept, reviewedIdentity: 'changed' })).rejects.toThrow('fee changed');
    await expect(t.mutation(api.relayQuotes.accept, accept)).rejects.toThrow('per-payment limit');
  });
});


describe('managed worker transport recovery', () => {
  it('records the provider request and sends the persisted calldata once', async () => {
    vi.useFakeTimers();
    const { t, args } = await setup();
    const jobId = await t.mutation(internal.relayJobs.reserve, args);
    provider.sendTransaction.mockResolvedValue('0x' + '12'.repeat(32));
    provider.getStatus.mockResolvedValue({ status: 100, chainId: 1 });
    await t.action(internal.relayExecutor.process, { jobId });
    await t.action(internal.relayExecutor.process, { jobId });
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(provider.sendTransaction).toHaveBeenCalledWith({ chainId: 1, to: args.to, data: args.data }, { retries: { max: 0 } });
    expect((await t.run(ctx => ctx.db.get(jobId)))?.providerId).toBe('0x' + '12'.repeat(32));
    expect((await t.run(ctx => ctx.db.get(args.disbursementId)))?.status).toBe('relaying');
  });
  it('does not resubmit after an ambiguous timeout and does not expose provider credentials', async () => {
    vi.useFakeTimers();
    const { t, args } = await setup();
    const jobId = await t.mutation(internal.relayJobs.reserve, args);
    provider.sendTransaction.mockRejectedValue(new Error('https://provider/rpc?apiKey=SECRET'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isExecuted: false }) }));
    await t.action(internal.relayExecutor.process, { jobId });
    await t.action(internal.relayExecutor.process, { jobId });
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    const job = await t.run(ctx => ctx.db.get(jobId));
    expect(JSON.stringify(job)).not.toContain('SECRET');
    expect(job?.status).toBe('submitted');
    expect((await t.run(ctx => ctx.db.get(args.disbursementId)))?.status).toBe('relaying');
  });
});


describe('scheduled managed payment waiting', () => {
  it('keeps a blocked account queue scheduled and ignores cancelled or superseded retries', async () => {
    vi.useFakeTimers();
    const { t, ids } = await setup();
    await t.run(ctx => ctx.db.patch(ids.disbursementId, { status: 'scheduled', scheduledVersion: 1, scheduledAt: Date.now() - 1 }));
    const args = { disbursementId: ids.disbursementId, scheduledVersion: 1, attempt: 0 };
    await t.mutation(internal.relayJobs.deferScheduled, args);
    expect((await t.run(ctx => ctx.db.get(ids.disbursementId)))?.status).toBe('scheduled');
    await t.run(ctx => ctx.db.patch(ids.disbursementId, { status: 'cancelled', scheduledVersion: 2 }));
    await t.mutation(internal.relayJobs.deferScheduled, { ...args, attempt: 120 });
    expect((await t.run(ctx => ctx.db.get(ids.disbursementId)))?.status).toBe('cancelled');
  });
});


it('does not submit a scheduled payment after the creator loses payment access', async () => {
  const { t, ids, args } = await setup();
  await t.run(async ctx => {
    const m = await ctx.db.query('orgMemberships').withIndex('by_org_and_user', q => q.eq('orgId', ids.orgId).eq('userId', ids.userId)).first();
    await ctx.db.patch(m!._id, { role: 'viewer' });
    await ctx.db.patch(ids.disbursementId, { status: 'scheduled', scheduledVersion: 1, scheduledAt: Date.now() - 1 });
  });
  await expect(t.mutation(internal.relayJobs.reserve, { ...args, sessionToken: undefined, scheduledVersion: 1 })).rejects.toThrow('creator no longer');
});

it('rechecks an exception without making its authorization submit-able again', async () => {
  vi.useFakeTimers();
  const { t, args } = await setup();
  const jobId = await t.mutation(internal.relayJobs.reserve, args);
  await t.mutation(internal.relayJobs.begin, { jobId });
  await t.mutation(internal.relayJobs.update, { jobId, status: 'exception', providerId: 'original-request', error: 'Interrupted' });
  const review = await t.query(api.disbursements.list, { orgId: (await t.run(ctx => ctx.db.get(args.disbursementId)))!.orgId, sessionToken: args.sessionToken, status: ['draft', 'pending', 'proposed', 'failed'], includeRelayExceptions: true });
  expect(review.items.map(p => p._id)).toContain(args.disbursementId);
  await t.mutation(api.relayJobs.recheck, { disbursementId: args.disbursementId, sessionToken: args.sessionToken });
  expect(await t.mutation(internal.relayJobs.begin, { jobId })).toBe(false);
  expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: 'submitted', providerId: 'original-request' });
  const visible = await t.query(api.relayJobs.paymentStatus, { disbursementId: args.disbursementId, sessionToken: args.sessionToken });
  expect(visible).not.toHaveProperty('data');
});

it('includes payments executed by a delegate in that member’s monthly budget', async () => {
  const { t, ids, args } = await setup();
  await t.run(async ctx => {
    const other = await ctx.db.insert('users', { walletAddress: '0x9999999999999999999999999999999999999999', createdAt: Date.now() });
    const p = (await ctx.db.get(ids.disbursementId))!;
    const { _id: ignoredId, _creationTime: ignoredTime, ...fields } = p;
    void ignoredId; void ignoredTime;
    await ctx.db.insert('disbursements', { ...fields, createdBy: other, delegatedBy: ids.userId, amount: '99.95', status: 'executed' });
    const membership = await ctx.db.query('orgMemberships').withIndex('by_org_and_user', q => q.eq('orgId', ids.orgId).eq('userId', ids.userId)).first();
    await ctx.db.patch(membership!._id, { paymentPolicy: { token: 'USDC', perMonth: '100' } });
    await ctx.db.patch(ids.disbursementId, { amount: '0.01' });
  });
  await expect(t.mutation(internal.relayJobs.reserve, args)).rejects.toThrow('monthly allowance');
});

it('continues independent settlement discovery when provider status is unavailable', async () => {
  vi.useFakeTimers();
  const { t, args } = await setup();
  const jobId = await t.mutation(internal.relayJobs.reserve, args);
  await t.mutation(internal.relayJobs.begin, { jobId });
  await t.mutation(internal.relayJobs.update, { jobId, status: 'submitted', providerId: 'original' });
  provider.getStatus.mockRejectedValue(new Error('Provider offline'));
  const fetchProposal = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isExecuted: false }) });
  vi.stubGlobal('fetch', fetchProposal);
  await t.action(internal.relayExecutor.process, { jobId });
  expect(fetchProposal).toHaveBeenCalledTimes(1);
  expect(provider.sendTransaction).not.toHaveBeenCalled();
  expect((await t.run(ctx => ctx.db.get(jobId)))?.providerId).toBe('original');
});

it('retains a retryable prepared job when the provider cannot initialize before submission', async () => {
  vi.useFakeTimers();
  const { t, args } = await setup();
  const jobId = await t.mutation(internal.relayJobs.reserve, args);
  provider.configurationError = true;
  await t.action(internal.relayExecutor.process, { jobId });
  expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: 'prepared', attempts: 1 });
  expect(provider.sendTransaction).not.toHaveBeenCalled();
  provider.configurationError = false;
  provider.sendTransaction.mockResolvedValue('recovered-request');
  await t.action(internal.relayExecutor.process, { jobId });
  expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: 'submitted', providerId: 'recovered-request' });
});

it('rotates recovery work so twenty unresolved payments do not starve later jobs', async () => {
  vi.useFakeTimers();
  const { t, args } = await setup();
  const first = await t.mutation(internal.relayJobs.reserve, args);
  const ids = await t.run(async ctx => {
    const { _id, _creationTime, ...job } = (await ctx.db.get(first))!;
    void _id; void _creationTime;
    const ids = [first];
    for (let i = 0; i < 24; i++) ids.push(await ctx.db.insert('relayJobs', { ...job, updatedAt: Date.now() - 1000 }));
    await ctx.db.patch(first, { updatedAt: Date.now() - 1000 });
    return ids;
  });
  const cutoff = Date.now();
  await t.mutation(internal.relayJobs.recover, {});
  vi.setSystemTime(cutoff + 60000);
  await t.mutation(internal.relayJobs.recover, {});
  const jobs = await t.run(ctx => Promise.all(ids.map(id => ctx.db.get(id))));
  expect(jobs.every(j => j!.updatedAt >= cutoff)).toBe(true);
});

it('resumes only a never-submitted payment and permits just one resume claim', async () => {
  vi.useFakeTimers();
  const { t, args } = await setup();
  const jobId = await t.mutation(internal.relayJobs.reserve, args);
  await t.run(ctx => ctx.db.patch(jobId, { attempts: 120 }));
  await t.mutation(internal.relayJobs.recover, {});
  expect(await t.query(api.relayJobs.paymentStatus, { disbursementId: args.disbursementId, sessionToken: args.sessionToken })).toMatchObject({ canResume: true });
  await t.mutation(api.relayJobs.resume, { disbursementId: args.disbursementId, sessionToken: args.sessionToken });
  await expect(t.mutation(api.relayJobs.resume, { disbursementId: args.disbursementId, sessionToken: args.sessionToken })).rejects.toThrow('never submitted');
  expect(await t.mutation(internal.relayJobs.begin, { jobId })).toBe(true);
  expect(await t.mutation(internal.relayJobs.begin, { jobId })).toBe(false);
  await t.mutation(internal.relayJobs.update, { jobId, status: 'exception', error: 'Ambiguous response' });
  await expect(t.mutation(api.relayJobs.resume, { disbursementId: args.disbursementId, sessionToken: args.sessionToken })).rejects.toThrow('never submitted');
});

it('reconciles a lost managed response from SafeL2 execution logs without a provider id or a second submission', async () => {
  const { t, ids, args } = await setup();
  await t.run(ctx => ctx.db.patch(ids.safeId, { chainId: 1 }));
  const p = (await t.run(ctx => ctx.db.get(ids.disbursementId)))!;
  const b = (await t.run(ctx => ctx.db.get(p.beneficiaryId!)))!;
  const txHash = `0x${'cd'.repeat(32)}` as `0x${string}`, blockHash = `0x${'ef'.repeat(32)}` as `0x${string}`;
  const event = { address: ids.to, topics: encodeEventTopics({ abi: parseAbi(['event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)']), eventName: 'ExecutionSuccess', args: { txHash: hash as `0x${string}` } }), data: encodeAbiParameters([{ type: 'uint256' }], [0n]), transactionHash: txHash, removed: false };
  const transfer = (to: string, amount: bigint) => ({ address: fee.tokenAddress, topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']), eventName: 'Transfer', args: { from: ids.to as `0x${string}`, to: to as `0x${string}` } }), data: encodeAbiParameters([{ type: 'uint256' }], [amount]) });
  chain.getBlockNumber.mockResolvedValue(500n);
  chain.getChainId.mockResolvedValue(1);
  chain.getBlock.mockResolvedValue({ number: 490n, hash: blockHash, timestamp: 1770000000n });
  chain.getLogs.mockResolvedValue([event]);
  chain.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 490n, blockHash, logs: [event, transfer(b.walletAddress, 100000000n), transfer(fee.collector, 50000n)] });
  const jobId = await t.mutation(internal.relayJobs.reserve, { ...args, searchFromBlock: '488' });
  await t.mutation(internal.relayJobs.begin, { jobId });
  await t.action(internal.relayExecutor.process, { jobId });
  expect(provider.sendTransaction).not.toHaveBeenCalled();
  expect((await t.query(internal.relayJobs.get, { jobId }))?.status).toBe('confirmed');
  expect(await t.run(ctx => ctx.db.get(ids.disbursementId))).toMatchObject({ status: 'executed', txHash });
});

it.each(['confirmed', 'reorganized', 'unconfirmed', 'wrong account'])('handles a relayed Safe failure using verified intent and canonical evidence: %s', async variant => {
  vi.useFakeTimers();
  const { t, ids, args } = await setup();
  await t.run(ctx => ctx.db.patch(ids.safeId, { chainId: 1 }));
  const txHash = `0x${'cd'.repeat(32)}` as `0x${string}`, blockHash = `0x${'ef'.repeat(32)}` as `0x${string}`;
  const event = {
    address: variant === 'wrong account' ? TEST_WALLETS.viewer : ids.to,
    topics: encodeEventTopics({ abi: parseAbi(['event ExecutionFailure(bytes32 indexed txHash,uint256 payment)']), eventName: 'ExecutionFailure', args: { txHash: hash as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [0n]), transactionHash: txHash, removed: false,
  };
  chain.getBlockNumber.mockResolvedValue(variant === 'unconfirmed' ? 490n : 500n);
  chain.getChainId.mockResolvedValue(1);
  chain.getBlock.mockResolvedValue({ number: 490n, hash: variant === 'reorganized' ? `0x${'99'.repeat(32)}` : blockHash, timestamp: 1770000000n });
  chain.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 490n, blockHash, logs: [event] });
  const jobId = await t.mutation(internal.relayJobs.reserve, { ...args, searchFromBlock: '488' });
  await t.mutation(internal.relayJobs.begin, { jobId });
  await t.mutation(internal.relayJobs.update, { jobId, status: 'submitted', providerId: 'original-request' });
  provider.getStatus.mockResolvedValue({ status: 200, chainId: 1, hash: txHash });
  await t.action(internal.relayExecutor.process, { jobId });
  const p = await t.run(ctx => ctx.db.get(ids.disbursementId));
  const job = await t.query(internal.relayJobs.get, { jobId });
  if (variant === 'confirmed') {
    expect(p).toMatchObject({ status: 'failed', txHash, relayStatus: 'Execution failed' });
    expect(job).toMatchObject({ status: 'failed', txHash });
    await t.mutation(api.relayJobs.recheck, { disbursementId: ids.disbursementId, sessionToken: args.sessionToken });
    await t.mutation(internal.relayJobs.update, { jobId, status: 'submitted' });
    expect((await t.query(internal.relayJobs.get, { jobId }))?.status).toBe('failed');
  } else {
    expect(p?.status).toBe('relaying');
    expect(job?.txHash).toBeUndefined();
    expect(p?.txHash).toBeUndefined();
  }
  expect(p?.settlement).toBeUndefined();
  expect(provider.sendTransaction).not.toHaveBeenCalled();
});
