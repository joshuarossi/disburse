import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';
import schema from '../schema';
import { api, internal } from '../_generated/api';
import { createFullOrgSetup, createTestBeneficiary, createTestDisbursement, createTestUser, signIn, TEST_ACCOUNTS, TEST_WALLETS } from './factories';
import { approvalSigningData, transactionSigningData } from '../../shared/safeSignatures';
import { CURRENT_ALLOWANCE } from '../../shared/allowanceDeployments';
import runtime from '../../src/lib/__tests__/fixtures/allowance-v1-runtime.json';
import { CHAIN_TOKENS } from '../../shared/chains';
import { feeIdentity } from '../../shared/executionFee';
import { accountChangeReceiptOutcome } from '../lib/accountChange';
import type { AccountAuthority } from '../lib/accountAuthority';

const state = vi.hoisted(() => ({ graph: null as AccountAuthority | null, enabled: true, allowanceNonce: 1, amount: 0n, spent: 0n, reset: 0, registered: true, badCode: false, check: vi.fn(), receipt: null as any, getLogs: vi.fn(), send: vi.fn(), status: vi.fn(), call: vi.fn(), getTransaction: vi.fn() }));
const token = CHAIN_TOKENS[11155111].USDC.address;
const parent = '0x8888888888888888888888888888888888888888';
vi.mock('../lib/safeIdentity', () => ({ assertSafeIdentity: async () => {} }));
vi.mock('../lib/accountAuthority', async original => ({ ...(await original<typeof import('../lib/accountAuthority')>()), readAccountAuthority: async () => structuredClone(state.graph), assertSignatureHandler: async () => {} }));
vi.mock('@safe-global/safe-deployments', async original => {
  const actual = await original<typeof import('@safe-global/safe-deployments')>();
  return { ...actual, getMultiSendCallOnlyDeployments: (options: Parameters<typeof actual.getMultiSendCallOnlyDeployments>[0]) => {
    const deployment = actual.getMultiSendCallOnlyDeployments(options)!;
    return { ...deployment, deployments: Object.fromEntries(Object.entries(deployment.deployments).map(([k, d]) => [k, d ? { ...d, codeHash: keccak256('0x6000') } : d])) };
  } };
});
vi.mock('../lib/managedRelay', () => ({ managedRelay: () => ({ getCapabilities: async () => ({ 11155111: { feeCollector: TEST_WALLETS.viewer, tokens: [{ address: token, decimals: 6 }] } }), getBalance: async () => ({ balance: 100n }), sendTransaction: state.send, getStatus: state.status }) }));
// Historical signed-fee fixtures exercise recovery after transport retirement.
// Production configuration refuses these quotes; serviceBillingBoundary tests the real adapter.
vi.mock('../lib/relayConfiguration', () => ({ relayConfiguration: () => ({ fee: { token: 'USDC', tokenAddress: token, collector: TEST_WALLETS.viewer, amount: '0.05' } }) }));
vi.mock('../lib/safeVerification', () => ({ getChainClient: () => ({
  getBlockNumber: async () => 123n, getChainId: async () => 11155111,
  getCode: async ({ address }: { address: string }) => state.badCode ? '0x6001' : address.toLowerCase() === CURRENT_ALLOWANCE.address.toLowerCase() ? runtime.runtime : '0x6000',
  getLogs: state.getLogs, call: state.call, getTransaction: state.getTransaction,
  getTransactionReceipt: async () => state.receipt,
  getBlock: async () => ({ number: 120n, hash: `0x${'cd'.repeat(32)}`, timestamp: BigInt(Math.floor(Date.now() / 1000) - 40) }),
  readContract: async ({ functionName, address, args }: { functionName: string; address: string; args: any[] }) => {
    const node = state.graph!.nodes.find(n => n.address === address.toLowerCase());
    if (functionName === 'getOwners') return node!.owners;
    if (functionName === 'getThreshold') return BigInt(node!.threshold);
    if (functionName === 'nonce') return BigInt(node!.nonce);
    if (functionName === 'VERSION') return '1.4.1';
    if (functionName === 'isModuleEnabled') return state.enabled;
    if (functionName === 'getDelegates') return [state.registered ? [TEST_WALLETS.initiator, TEST_WALLETS.admin] : [], 0];
    if (functionName === 'getTokens') return [token];
    if (functionName === 'getTokenAllowance') return [state.amount, state.spent, BigInt(state.reset), 10n, BigInt(state.allowanceNonce)];
    if (functionName === 'balanceOf') return 100000000n;
    if (functionName === 'checkNSignatures') return state.check(args);
    if (functionName === 'generateTransferHash') return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint96' }, { type: 'address' }, { type: 'uint96' }, { type: 'uint16' }], args as [Hex, Hex, Hex, bigint, Hex, bigint, number]));
    if (functionName === 'getTransactionHash') {
      const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce] = args;
      return keccak256(transactionSigningData(11155111, address, { to, value: String(value), data, operation, safeTxGas: String(safeTxGas), baseGas: String(baseGas), gasPrice: String(gasPrice), gasToken, refundReceiver, nonce: Number(nonce) }));
    }
    throw new Error(`Unexpected RPC: ${functionName}`);
  },
}) }));
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.check.mockReset(); state.enabled = true; state.allowanceNonce = 1; state.amount = 0n; state.spent = 0n; state.reset = 0; state.registered = true; state.badCode = false; state.receipt = null;
  state.call.mockResolvedValue({ data: '0x' }); state.getTransaction.mockReset();
  state.getLogs.mockResolvedValue([]); state.send.mockResolvedValue('provider-one'); state.status.mockResolvedValue({ chainId: 11155111, status: 100 });
  vi.stubEnv('GELATO_TESTNET_API_KEY', 'test-service');
  vi.stubEnv('GELATO_11155111_FEE_COLLECTOR', TEST_WALLETS.viewer);
  vi.stubEnv('GELATO_11155111_FEE_USDC', '0.05');
});
afterEach(() => { vi.clearAllTimers(); vi.unstubAllEnvs(); vi.useRealTimers(); });
async function setup(nested = false) {
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const ids = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin });
    for (const role of ['approver', 'initiator', 'clerk', 'viewer'] as const) {
      const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS[role] });
      await ctx.db.insert('orgMemberships', { orgId: ids.orgId, userId, role, status: 'active', createdAt: Date.now() });
    }
    return ids;
  });
  const root = ids.safeAddress.toLowerCase();
  state.graph = { root, blockNumber: '123', nodes: nested ? [
    { address: root, owners: [parent], threshold: 1, nonce: 3, contracts: [parent] },
    { address: parent, owners: [TEST_WALLETS.admin.toLowerCase(), TEST_WALLETS.approver.toLowerCase()], threshold: 2, nonce: 88, contracts: [] },
  ] : [{ address: root, owners: [TEST_WALLETS.admin.toLowerCase(), TEST_WALLETS.approver.toLowerCase()], threshold: 2, nonce: 3, contracts: [] }] };
  const admin = await signIn(t, 'admin'), approver = await signIn(t, 'approver');
  const request = { safeId: ids.safeId, sessionToken: admin.sessionToken, requestId: crypto.randomUUID(), kind: 'grant' as const, module: CURRENT_ALLOWANCE.address, delegate: TEST_WALLETS.initiator, token: 'USDC', amount: '10', resetMinutes: 1440 };
  const create = () => t.action(api.spendingPolicies.create, request);
  const sign = async (policyChangeId: Awaited<ReturnType<typeof create>>, role: 'admin' | 'approver' = 'admin') => {
    const identity = { policyChangeId, sessionToken: (role === 'admin' ? admin : approver).sessionToken };
    const view = await t.action(api.spendingPolicies.approvals, identity);
    const path = view.paths[0].path;
    const signature = await TEST_ACCOUNTS[role].sign({ hash: approvalSigningData(11155111, path, view.proposal.safeTransactionData).hash });
    const args = { ...identity, path, signature, safeTxHash: view.proposal.safeTxHash };
    await t.action(api.spendingPolicies.approve, args);
    return args;
  };
  return { t, ids, admin, approver, request, create, sign };
}
it('allows an administrator to request a policy without being an account signer', async () => {
  const { t, request, create } = await setup();
  state.graph!.nodes[0].owners = [TEST_WALLETS.approver.toLowerCase()]; state.graph!.nodes[0].threshold = 1;
  const policyChangeId = await create();
  const view = await t.action(api.spendingPolicies.approvals, { policyChangeId, sessionToken: request.sessionToken });
  expect(view.paths).toEqual([]); expect(view.ready).toBe(false);
  expect(await t.run(ctx => ctx.db.query('accountSignatures').collect())).toHaveLength(0);
});
it('lets one owner of a two-approval account have a bounded allowance, but rejects a wallet with unilateral authority', async () => {
  const { t, request } = await setup();
  await t.action(api.spendingPolicies.create, { ...request, delegate: TEST_WALLETS.admin });
  state.graph!.nodes[0].threshold = 1;
  await expect(t.action(api.spendingPolicies.create, { ...request, requestId: crypto.randomUUID(), delegate: TEST_WALLETS.admin })).rejects.toThrow('on its own');
});
it('applies the same unilateral-authority rule through owning accounts', async () => {
  const { t, request } = await setup(true);
  await t.action(api.spendingPolicies.create, { ...request, delegate: TEST_WALLETS.admin });
  state.graph!.nodes[1].threshold = 1;
  await expect(t.action(api.spendingPolicies.create, { ...request, requestId: crypto.randomUUID(), delegate: TEST_WALLETS.admin })).rejects.toThrow('on its own');
});
it('requires both direct approvals and preserves approvals on repeated submission', async () => {
  const { t, request, create, sign } = await setup();
  const policyChangeId = await create(), identity = { policyChangeId, sessionToken: request.sessionToken };
  await sign(policyChangeId);
  await expect(t.action(api.spendingPolicies.execute, identity)).rejects.toThrow('needs account approvals');
  const second = await sign(policyChangeId, 'approver');
  await t.action(api.spendingPolicies.approve, second);
  expect((await t.action(api.spendingPolicies.approvals, identity)).ready).toBe(true);
  expect(await t.run(ctx => ctx.db.query('accountSignatures').collect())).toHaveLength(2);
});
it('collects both parent signatures and verifies the contract signature before execution', async () => {
  const { t, request, create, sign } = await setup(true);
  const policyChangeId = await create(), identity = { policyChangeId, sessionToken: request.sessionToken };
  await sign(policyChangeId); await sign(policyChangeId, 'approver');
  const view = await t.action(api.spendingPolicies.approvals, identity);
  expect(view.ready).toBe(true); expect(view.groups.find(g => g.address === parent)?.confirmedOwners).toHaveLength(2);
  expect(state.check).toHaveBeenCalled();
  const prepared = await t.action(api.spendingPolicies.execute, identity);
  expect(prepared.managed).toBe(false); expect(prepared.to.toLowerCase()).toBe(state.graph!.root);
});
it('reserves a shared account nonce so a policy and payment cannot overwrite one another', async () => {
  const { t, ids, admin, create } = await setup();
  const policyChangeId = await create();
  const disbursementId = await t.run(async ctx => {
    const beneficiaryId = await createTestBeneficiary(ctx, ids.orgId, { walletAddress: TEST_WALLETS.viewer });
    const id = await createTestDisbursement(ctx, ids.orgId, ids.safeId, beneficiaryId, ids.userId, { amount: '1', status: 'pending' });
    await ctx.db.patch(id, { recipientAddress: TEST_WALLETS.viewer }); return id;
  });
  const payment = await t.action(api.accountApprovals.forSigning, { disbursementId, sessionToken: admin.sessionToken });
  expect(payment.proposal.safeTransactionData.nonce).toBe(4);
  const source = await t.query(internal.spendingPolicyData.context, { policyChangeId });
  expect(source.saved.nonce).toBe(3);
});
it('idempotent create retries return the existing request and concurrent new requests cannot reserve one nonce', async () => {
  const { t, create, request } = await setup();
  const first = await create(); expect(await create()).toBe(first);
  expect(await t.run(ctx => ctx.db.query('accountProposals').collect())).toHaveLength(1);
  const attempts = await Promise.allSettled([t.action(api.spendingPolicies.create, { ...request, requestId: crypto.randomUUID() }), t.action(api.spendingPolicies.create, { ...request, requestId: crypto.randomUUID() })]);
  expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const reservations = await t.run(ctx => ctx.db.query('accountProposals').collect());
  expect(new Set(reservations.map(r => r.nonce)).size).toBe(reservations.length);
});
it('rejects a changed allowance, but ordinary spending in its interval does not invalidate the approved change', async () => {
  const { t, create, sign, request } = await setup();
  state.amount = 5000000n;
  const policyChangeId = await create(); await sign(policyChangeId);
  state.spent = 1000000n; await sign(policyChangeId, 'approver');
  const identity = { policyChangeId, sessionToken: request.sessionToken };
  expect((await t.action(api.spendingPolicies.approvals, identity)).ready).toBe(true);
  state.amount = 6000000n;
  await expect(t.action(api.spendingPolicies.execute, identity)).rejects.toThrow('changed after');
});
it('rejects dormant grants, unregistered members, unrelated workspaces and unauthorized roles', async () => {
  const { t, create, request } = await setup();
  state.amount = 100n; state.enabled = false;
  await expect(create()).rejects.toThrow('dormant');
  state.enabled = true;
  await expect(t.action(api.spendingPolicies.create, { ...request, delegate: TEST_WALLETS.viewer })).rejects.toThrow('permission to make payments');
  const outsider = await signIn(t, 'nonMember');
  await expect(t.action(api.spendingPolicies.create, { ...request, sessionToken: outsider.sessionToken })).rejects.toThrow('member');
  const initiator = await signIn(t, 'initiator');
  await expect(t.action(api.spendingPolicies.create, { ...request, sessionToken: initiator.sessionToken })).rejects.toThrow('permissions');
});
it('blocks new grants after expiry but permits inspection and revocation on an archived account', async () => {
  const { t, ids, create, request, sign } = await setup();
  await t.run(async ctx => { await ctx.db.patch(ids.billingId, { trialEndsAt: Date.now() - 1000, status: 'expired' }); await ctx.db.patch(ids.safeId, { isActive: false }); });
  expect(await t.query(api.safes.getForOrg, { orgId: ids.orgId, sessionToken: request.sessionToken })).toHaveLength(0);
  expect(await t.query(api.safes.getForOrg, { orgId: ids.orgId, sessionToken: request.sessionToken, includeArchived: true })).toHaveLength(1);
  await expect(create()).rejects.toThrow();
  state.amount = 1000000n;
  const policyChangeId = await t.action(api.spendingPolicies.create, { ...request, kind: 'revoke', token: undefined, amount: undefined, resetMinutes: undefined, tokenAddress: token });
  await sign(policyChangeId); await sign(policyChangeId, 'approver');
  const prepared = await t.action(api.spendingPolicies.execute, { policyChangeId, sessionToken: request.sessionToken });
  expect(prepared.managed).toBe(false);
});
it('invalidates a grant when its delegate loses payment permission before execution', async () => {
  const { t, ids, create, request, sign } = await setup();
  const policyChangeId = await create(); await sign(policyChangeId); await sign(policyChangeId, 'approver');
  await t.run(async ctx => {
    const delegate = await ctx.db.query('users').withIndex('by_wallet', q => q.eq('walletAddress', TEST_WALLETS.initiator.toLowerCase())).first();
    const membership = await ctx.db.query('orgMemberships').withIndex('by_org_and_user', q => q.eq('orgId', ids.orgId).eq('userId', delegate!._id)).first();
    await ctx.db.patch(membership!._id, { role: 'viewer' });
  });
  await expect(t.action(api.spendingPolicies.execute, { policyChangeId, sessionToken: request.sessionToken })).rejects.toThrow('permission to make payments');
});
it('rejects forged signatures, current parent-signature failure and altered transaction data', async () => {
  const { t, create, request, sign } = await setup(true);
  const policyChangeId = await create(), identity = { policyChangeId, sessionToken: request.sessionToken };
  const view = await t.action(api.spendingPolicies.approvals, identity);
  const directSignature = await TEST_ACCOUNTS.admin.sign({ hash: view.proposal.safeTxHash as Hex });
  await expect(t.action(api.spendingPolicies.approve, { ...identity, safeTxHash: view.proposal.safeTxHash, path: view.paths[0].path, signature: directSignature })).rejects.toThrow('signature');
  await sign(policyChangeId); await sign(policyChangeId, 'approver');
  state.check.mockRejectedValueOnce(new Error('Invalid contract signature'));
  await expect(t.action(api.spendingPolicies.execute, identity)).rejects.toThrow('Invalid contract');
  await t.run(async ctx => { const saved = await ctx.db.query('accountProposals').withIndex('by_policy', q => q.eq('policyChangeId', policyChangeId)).unique(); await ctx.db.patch(saved!._id, { proposal: { ...saved!.proposal, safeTransactionData: { ...saved!.proposal.safeTransactionData, value: '1' } } }); });
  await expect(t.action(api.spendingPolicies.execute, identity)).rejects.toThrow('differs');
});
it('keeps a declined wallet attempt tied to the original policy and rejects stale or cross-actor retries', async () => {
  const { t, request, create, sign, approver } = await setup();
  const policyChangeId = await create(), identity = { policyChangeId, sessionToken: request.sessionToken };
  await sign(policyChangeId); await sign(policyChangeId, 'approver');
  const first = await t.action(api.spendingPolicies.execute, identity);
  await expect(t.mutation(api.spendingPolicyData.walletRejected, { ...identity, sessionToken: approver.sessionToken, attemptId: first.attemptId })).rejects.toThrow('no longer current');
  await t.mutation(api.spendingPolicyData.walletRejected, { ...identity, attemptId: first.attemptId });
  const second = await t.action(api.spendingPolicies.execute, identity);
  expect(second.attemptId).not.toBe(first.attemptId); expect(second.data).toBe(first.data);
  await expect(t.mutation(api.spendingPolicyData.walletRejected, { ...identity, attemptId: first.attemptId })).rejects.toThrow('no longer current');
  await t.mutation(api.spendingPolicyData.recordBroadcast, { ...identity, attemptId: second.attemptId, txHash: `0x${'aa'.repeat(32)}` });
  await expect(t.mutation(api.spendingPolicyData.walletRejected, { ...identity, attemptId: second.attemptId })).rejects.toThrow('no longer current');
});
it('never rebroadcasts an unknown wallet response and reconciles only the original Safe execution', async () => {
  const { t, request, create, sign } = await setup();
  const policyChangeId = await create(), identity = { policyChangeId, sessionToken: request.sessionToken };
  await sign(policyChangeId); await sign(policyChangeId, 'approver');
  await t.action(api.spendingPolicies.execute, identity);
  await expect(t.action(api.spendingPolicies.execute, identity)).rejects.toThrow('original policy submission');
  const source = await t.query(internal.spendingPolicyData.context, { policyChangeId });
  const hash = `0x${'aa'.repeat(32)}` as Hex;
  const log = { address: source.policy.safeAddress, topics: [keccak256(stringToHex('ExecutionSuccess(bytes32,uint256)'))], data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [source.policy.safeTxHash as Hex, 0n]), transactionHash: hash };
  state.getLogs.mockResolvedValue([log]);
  state.receipt = { status: 'success', blockNumber: 120n, blockHash: `0x${'cd'.repeat(32)}`, logs: [log] };
  await t.action(internal.spendingPolicyRecovery.reconcile, { policyChangeId });
  const final = await t.query(internal.spendingPolicyData.context, { policyChangeId });
  expect(final.policy.status).toBe('applied'); expect(final.policy.txHash).toBe(hash);
});
it('binds managed policy fees to reviewed currency, collector and amount', async () => {
  const { t, request } = await setup();
  const fee = { token: 'USDC', tokenAddress: token, collector: TEST_WALLETS.viewer, amount: '0.05' };
  await expect(t.action(api.spendingPolicies.create, { ...request, feeToken: 'USDC', reviewedFee: 'different' })).rejects.toThrow('Review the policy execution fee');
  const policyChangeId = await t.action(api.spendingPolicies.create, { ...request, feeToken: 'USDC', reviewedFee: feeIdentity(fee) });
  expect((await t.query(internal.spendingPolicyData.context, { policyChangeId })).policy.executionFee).toEqual(fee);
});
it('a lost managed response has one provider submission and independent chain recovery', async () => {
  const { t, request, sign } = await setup();
  const fee = { token: 'USDC', tokenAddress: token, collector: TEST_WALLETS.viewer, amount: '0.05' };
  const policyChangeId = await t.action(api.spendingPolicies.create, { ...request, feeToken: 'USDC', reviewedFee: feeIdentity(fee) });
  await sign(policyChangeId); await sign(policyChangeId, 'approver');
  const prepared = await t.action(api.spendingPolicies.execute, { policyChangeId, sessionToken: request.sessionToken });
  expect(prepared.managed).toBe(true); state.send.mockRejectedValueOnce(new Error('Lost response'));
  await t.action(internal.spendingPolicyRelay.process, { policyChangeId });
  await t.action(internal.spendingPolicyRelay.process, { policyChangeId });
  expect(state.send).toHaveBeenCalledTimes(1); expect(state.getLogs).toHaveBeenCalled();
  const source = await t.query(internal.spendingPolicyData.context, { policyChangeId });
  expect(source.policy.status).toBe('processing'); expect(source.policy.execution?.providerId).toBeUndefined();
});
it('an arbitrary receipt or missing fee transfer never counts as an applied policy', () => {
  const safeTxHash = `0x${'ab'.repeat(32)}`, safeAddress = parent;
  expect(() => accountChangeReceiptOutcome({ status: 'success', logs: [] }, { safeTxHash, safeAddress })).toThrow('does not confirm');
  const log = { address: safeAddress, topics: [keccak256(stringToHex('ExecutionSuccess(bytes32,uint256)'))], data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [safeTxHash as Hex, 0n]) };
  expect(() => accountChangeReceiptOutcome({ status: 'success', logs: [log] }, { safeTxHash, safeAddress, executionFee: { token: 'USDC', tokenAddress: token, collector: TEST_WALLETS.viewer, amount: '0.05' } })).toThrow('execution fee');
});

// Cancellation uses the same real signature and RPC fixture as policy approvals.
async function cancellationFixture(nested = false, managed = false) {
  const base = await setup(nested);
  const policyChangeId = await base.create();
  await base.sign(policyChangeId);
  const fee = { token: 'USDC', tokenAddress: token, collector: TEST_WALLETS.viewer, amount: '0.05' };
  const source = { policyChangeId, sessionToken: base.admin.sessionToken, ...(managed ? { feeToken: 'USDC', reviewedFee: feeIdentity(fee) } : {}) };
  const cancellationId = await base.t.action(api.accountCancellations.create, source);
  const identity = { cancellationId, sessionToken: base.admin.sessionToken };
  const signCancellation = async (role: 'admin' | 'approver' = 'admin') => {
    const as = { ...identity, sessionToken: (role === 'admin' ? base.admin : base.approver).sessionToken };
    const view = await base.t.action(api.accountCancellations.approvals, as);
    const path = view.paths[0].path;
    const signature = await TEST_ACCOUNTS[role].sign({ hash: approvalSigningData(11155111, path, view.proposal.safeTransactionData).hash });
    const args = { ...as, safeTxHash: view.proposal.safeTxHash, path, signature };
    await base.t.action(api.accountCancellations.approve, args); return args;
  };
  return { ...base, policyChangeId, source, cancellationId, identity, signCancellation };
}
function confirmedChange(safeTxHash: string, address = state.graph!.root, failure = false) {
  const transactionHash = `0x${'aa'.repeat(32)}` as Hex;
  const log = { address, topics: [keccak256(stringToHex(`Execution${failure ? 'Failure' : 'Success'}(bytes32,uint256)`))], data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [safeTxHash as Hex, 0n]), transactionHash };
  state.getLogs.mockResolvedValue([log]);
  state.receipt = { status: 'success', blockNumber: 120n, blockHash: `0x${'cd'.repeat(32)}`, logs: [log] };
  return transactionHash;
}
it('cancellation uses the original nonce, preserves signed evidence and blocks further policy approval and execution', async () => {
  const { t, policyChangeId, cancellationId, identity, sign, source } = await cancellationFixture();
  const view = await t.action(api.accountCancellations.approvals, identity);
  expect(view.proposal.safeTransactionData).toMatchObject({ to: state.graph!.root, value: '0', data: '0x', operation: 0, nonce: 3 });
  expect(await t.action(api.accountCancellations.create, source)).toBe(cancellationId);
  const original = await t.query(internal.spendingPolicyData.context, { policyChangeId });
  expect(original.policy.status).toBe('pending'); expect(original.signatures).toHaveLength(1);
  expect(original.saved.proposal.safeTxHash).not.toBe(view.proposal.safeTxHash);
  await expect(sign(policyChangeId, 'approver')).rejects.toThrow('cancellation');
  await expect(t.action(api.spendingPolicies.execute, { policyChangeId, sessionToken: identity.sessionToken })).rejects.toThrow('cancellation');
});
it('cancellation requires both direct account approvals', async () => {
  const { t, identity, signCancellation } = await cancellationFixture();
  await signCancellation();
  await expect(t.action(api.accountCancellations.execute, identity)).rejects.toThrow('needs account approvals');
  const signature = await signCancellation('approver');
  await t.action(api.accountCancellations.approve, signature);
  expect((await t.action(api.accountCancellations.approvals, identity)).ready).toBe(true);
  expect((await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId })).signatures).toHaveLength(2);
});
it('nested cancellation verifies EIP1271 parent approvals and rejects the original payment signature', async () => {
  const { t, identity, signCancellation, policyChangeId } = await cancellationFixture(true);
  const view = await t.action(api.accountCancellations.approvals, identity);
  const original = await t.query(internal.spendingPolicyData.context, { policyChangeId });
  await expect(t.action(api.accountCancellations.approve, { ...identity, path: view.paths[0].path, safeTxHash: view.proposal.safeTxHash, signature: original.signatures[0].signature })).rejects.toThrow('signature');
  await signCancellation(); await signCancellation('approver');
  expect((await t.action(api.accountCancellations.approvals, identity)).groups.find(g => g.address === parent)?.confirmedOwners).toHaveLength(2);
  state.check.mockRejectedValueOnce(new Error('Parent authority changed'));
  await expect(t.action(api.accountCancellations.execute, identity)).rejects.toThrow('Parent authority');
});
it('a cancellation keeps native retries tied to the original payload and actor', async () => {
  const { t, identity, approver, signCancellation } = await cancellationFixture();
  await signCancellation(); await signCancellation('approver');
  const first = await t.action(api.accountCancellations.execute, identity);
  await expect(t.action(api.accountCancellations.execute, identity)).rejects.toThrow('original cancellation submission');
  await expect(t.mutation(api.accountCancellationData.walletResult, { ...identity, sessionToken: approver.sessionToken, attemptId: first.attemptId, rejected: true })).rejects.toThrow('no longer current');
  await t.mutation(api.accountCancellationData.walletResult, { ...identity, attemptId: first.attemptId, rejected: true });
  const second = await t.action(api.accountCancellations.execute, identity);
  expect(second.data).toBe(first.data); expect(second.attemptId).not.toBe(first.attemptId);
  await expect(t.mutation(api.accountCancellationData.walletResult, { ...identity, attemptId: first.attemptId, rejected: true })).rejects.toThrow('no longer current');
});
it('a lost cancellation response is recovered from the exact Safe event and only then cancels the original', async () => {
  const { t, identity, policyChangeId, signCancellation } = await cancellationFixture(true);
  await signCancellation(); await signCancellation('approver');
  await t.action(api.accountCancellations.execute, identity);
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId: identity.cancellationId });
  expect((await t.query(internal.spendingPolicyData.context, { policyChangeId })).policy.status).toBe('pending');
  const c = await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId });
  confirmedChange(c.cancellation.safeTxHash);
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId: identity.cancellationId });
  const final = await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId });
  expect(final.cancellation.status).toBe('applied'); expect(final.cancellation.settlement?.blockNumber).toBe('120');
  expect(final.target.status).toBe('cancelled'); expect(final.target.cancellationConfirmedAt).toBeTruthy();
  expect(final.originalProposal.proposal.safeTxHash).toBe(c.cancellation.originalHash);
});
it('a completed original policy is reconciled as applied instead of cancelled', async () => {
  const { t, identity, policyChangeId } = await cancellationFixture();
  const c = await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId });
  confirmedChange(c.cancellation.originalHash);
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId: identity.cancellationId });
  expect((await t.query(internal.spendingPolicyData.context, { policyChangeId })).policy.status).toBe('applied');
  const final = await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId });
  expect(final.cancellation.status).toBe('failed'); expect(final.cancellation.error).toContain('completed before');
});
it('an original ExecutionFailure consumes the nonce without claiming the policy or cancellation applied', async () => {
  const { t, identity, policyChangeId } = await cancellationFixture();
  const c = await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId });
  confirmedChange(c.cancellation.originalHash, undefined, true);
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId: identity.cancellationId });
  expect((await t.query(internal.spendingPolicyData.context, { policyChangeId })).policy.status).toBe('failed');
  expect((await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId })).cancellation.status).toBe('failed');
});
it('cancelled account nonces cannot be reused by later policy requests', async () => {
  const { t, identity, request } = await cancellationFixture();
  const c = await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId });
  const next = await t.action(api.spendingPolicies.create, { ...request, requestId: crypto.randomUUID() });
  expect((await t.query(internal.spendingPolicyData.context, { policyChangeId: next })).saved.nonce).toBe(4);
  confirmedChange(c.cancellation.safeTxHash);
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId: identity.cancellationId });
  state.graph!.nodes[0].nonce = 4;
  expect((await t.action(api.spendingPolicies.approvals, { policyChangeId: next, sessionToken: request.sessionToken })).blockedReason).toBeNull();
});
it('cancellation remains available after billing expiry, account archival and delegate removal', async () => {
  const { t, ids, identity, signCancellation } = await cancellationFixture();
  await t.run(async ctx => { await ctx.db.patch(ids.billingId, { status: 'expired', trialEndsAt: Date.now() - 1 }); await ctx.db.patch(ids.safeId, { isActive: false }); });
  await signCancellation(); await signCancellation('approver');
  expect((await t.action(api.accountCancellations.execute, identity)).managed).toBe(false);
});
it('cancellation rejects unauthorized members and a nonce consumed before request', async () => {
  const { t, source, identity, approver } = await cancellationFixture();
  const outsider = await signIn(t, 'nonMember'), viewer = await signIn(t, 'viewer');
  await expect(t.action(api.accountCancellations.approvals, { ...identity, sessionToken: outsider.sessionToken })).rejects.toThrow('member');
  await expect(t.action(api.accountCancellations.create, { ...source, sessionToken: viewer.sessionToken })).rejects.toThrow('permission');
  await t.run(async ctx => { const c = await ctx.db.get(identity.cancellationId); await ctx.db.patch(c!._id, { status: 'failed' }); });
  state.graph!.nodes[0].nonce = 4;
  await expect(t.action(api.accountCancellations.create, { ...source, sessionToken: approver.sessionToken })).rejects.toThrow('already used');
});
it('cancellation cannot be fabricated by a status mutation or finalized without settlement evidence', async () => {
  const { t, identity } = await cancellationFixture();
  await expect(t.mutation(internal.accountCancellationData.checkpoint, { cancellationId: identity.cancellationId, outcome: 'applied' })).rejects.toThrow('settlement evidence');
});
it('managed cancellation sends once during response loss and requires its exact reviewed fee transfer', async () => {
  const { t, identity, signCancellation } = await cancellationFixture(true, true);
  await signCancellation(); await signCancellation('approver');
  await t.action(api.accountCancellations.execute, identity);
  state.send.mockRejectedValueOnce(new Error('lost response'));
  await t.action(internal.accountCancellationRelay.process, { cancellationId: identity.cancellationId });
  await t.action(internal.accountCancellationRelay.process, { cancellationId: identity.cancellationId });
  expect(state.send).toHaveBeenCalledTimes(1);
  const c = await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId });
  confirmedChange(c.cancellation.safeTxHash);
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId: identity.cancellationId });
  expect((await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId })).cancellation.status).toBe('processing');
  const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
  state.receipt.logs.push({ address: token, topics: [keccak256(stringToHex('Transfer(address,address,uint256)')), topic(c.cancellation.safeAddress), topic(TEST_WALLETS.viewer)], data: encodeAbiParameters([{ type: 'uint256' }], [50000n]) });
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId: identity.cancellationId });
  expect((await t.query(internal.accountCancellationData.context, { cancellationId: identity.cancellationId })).cancellation.status).toBe('applied');
});
it('a signed payment keeps its budget status and cannot be signed, sent, rescheduled or locally cancelled during cancellation', async () => {
  const { t, ids, admin } = await setup();
  const disbursementId = await t.run(async ctx => {
    const beneficiaryId = await createTestBeneficiary(ctx, ids.orgId, { walletAddress: TEST_WALLETS.viewer });
    const id = await createTestDisbursement(ctx, ids.orgId, ids.safeId, beneficiaryId, ids.userId, { amount: '1', status: 'pending' });
    await ctx.db.patch(id, { recipientAddress: TEST_WALLETS.viewer }); return id;
  });
  const as = { disbursementId, sessionToken: admin.sessionToken };
  const request = await t.action(api.accountApprovals.forSigning, as), path = request.paths[0].path;
  const signature = await TEST_ACCOUNTS.admin.sign({ hash: approvalSigningData(11155111, path, request.proposal.safeTransactionData).hash });
  await t.action(api.accountApprovals.save, { ...as, path, signature, proposal: request.proposal });
  await expect(t.mutation(api.disbursements.updateStatus, { ...as, status: 'cancelled' })).rejects.toThrow('Signed payments');
  const cancellationId = await t.action(api.accountCancellations.create, as);
  expect((await t.run(ctx => ctx.db.get(disbursementId)))?.status).toBe('pending');
  await expect(t.action(api.accountApprovals.forSigning, as)).rejects.toThrow('cancellation');
  await expect(t.action(api.accountApprovals.execution, as)).rejects.toThrow('cancellation');
  await expect(t.mutation(api.disbursements.updateStatus, { ...as, status: 'cancelled' })).rejects.toThrow('cancellation');
  const c = await t.query(internal.accountCancellationData.context, { cancellationId });
  confirmedChange(c.cancellation.safeTxHash);
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId });
  expect((await t.run(ctx => ctx.db.get(disbursementId)))?.status).toBe('cancelled');
});
it('verifies the exact transfers when the original payment wins the cancellation race', async () => {
  const { t, ids, admin } = await setup();
  const disbursementId = await t.run(async ctx => {
    const recipient = await createTestBeneficiary(ctx, ids.orgId, { walletAddress: TEST_WALLETS.viewer });
    const id = await createTestDisbursement(ctx, ids.orgId, ids.safeId, recipient, ids.userId, { amount: '1', status: 'pending' });
    await ctx.db.patch(id, { recipientAddress: TEST_WALLETS.viewer }); return id;
  });
  const as = { disbursementId, sessionToken: admin.sessionToken };
  const request = await t.action(api.accountApprovals.forSigning, as), path = request.paths[0].path;
  const signature = await TEST_ACCOUNTS.admin.sign({ hash: approvalSigningData(11155111, path, request.proposal.safeTransactionData).hash });
  await t.action(api.accountApprovals.save, { ...as, path, signature, proposal: request.proposal });
  const cancellationId = await t.action(api.accountCancellations.create, as);
  confirmedChange(request.proposal.safeTxHash);
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId });
  expect((await t.run(ctx => ctx.db.get(disbursementId)))?.status).toBe('pending');
  const topic = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;
  state.receipt.logs.push({ address: token, topics: [keccak256(stringToHex('Transfer(address,address,uint256)')), topic(ids.safeAddress), topic(TEST_WALLETS.viewer)], data: encodeAbiParameters([{ type: 'uint256' }], [1000000n]) });
  await t.action(internal.accountCancellationRecovery.reconcile, { cancellationId });
  const original = await t.run(ctx => ctx.db.get(disbursementId));
  expect(original?.status).toBe('executed'); expect(original?.settlement?.blockNumber).toBe('120');
  expect((await t.query(internal.accountCancellationData.context, { cancellationId })).cancellation.status).toBe('failed');
});
it('cancellation approval and queued provider submission reject a superseded target atomically', async () => {
  const { t, identity, signCancellation, policyChangeId } = await cancellationFixture(false, true);
  const signed = await signCancellation(); await signCancellation('approver');
  const prepared = await t.action(api.accountCancellations.execute, identity);
  await t.run(ctx => ctx.db.patch(policyChangeId, { status: 'applied' }));
  await expect(t.mutation(internal.accountCancellationData.begin, { cancellationId: identity.cancellationId, attemptId: prepared.attemptId })).rejects.toThrow('already completed');
  await t.run(ctx => ctx.db.patch(identity.cancellationId, { status: 'pending' }));
  await expect(t.mutation(internal.accountCancellationData.sign, { ...signed, digest: signed.safeTxHash })).rejects.toThrow('already completed');
});

async function nativeAllowanceFixture(batch = false) {
  const base = await setup(true);
  state.amount = 5000000n;
  const disbursementId = await base.t.run(async ctx => {
    const one = await createTestBeneficiary(ctx, base.ids.orgId, { walletAddress: TEST_WALLETS.viewer });
    const id = await createTestDisbursement(ctx, base.ids.orgId, base.ids.safeId, one, base.ids.userId, { amount: batch ? '2' : '1', status: 'draft', type: batch ? 'batch' : 'single' });
    if (batch) {
      const two = await createTestBeneficiary(ctx, base.ids.orgId, { walletAddress: TEST_WALLETS.approver });
      for (const [beneficiaryId, recipientAddress] of [[one, TEST_WALLETS.viewer], [two, TEST_WALLETS.approver]] as const) await ctx.db.insert('disbursementRecipients', { disbursementId: id, beneficiaryId, recipientAddress, amount: '1', payoutVersion: (await ctx.db.get(beneficiaryId))!.payoutVersion, createdAt: Date.now() });
    }
    return id;
  });
  const args = { disbursementId, sessionToken: base.admin.sessionToken, feeMode: 'wallet' as const };
  const quote = await base.t.action(api.delegatedPayments.quote, args);
  const signature = await TEST_ACCOUNTS.admin.signMessage({ message: { raw: quote.hash as Hex } });
  const additionalSignatures = await Promise.all(quote.additionalTransfers.map(x => TEST_ACCOUNTS.admin.signMessage({ message: { raw: x.hash as Hex } })));
  const prepareArgs = { ...args, hash: quote.hash, signature, additionalSignatures };
  const prepare = () => base.t.action(api.delegatedPayments.prepare, prepareArgs);
  const identity = { disbursementId, sessionToken: args.sessionToken };
  return { ...base, quote, prepareArgs, prepare, identity, disbursementId };
}
it('native allowance quotes work without a managed provider and include no fee authorization', async () => {
  vi.unstubAllEnvs();
  const { t, quote, prepare, identity } = await nativeAllowanceFixture();
  expect(quote.fee).toBeUndefined(); expect(quote.feeHash).toBeUndefined();
  const intent = await prepare(); expect(intent.feeAuthorization).toBeUndefined();
  expect((await t.run(ctx => ctx.db.get(identity.disbursementId)))?.executionFee).toBeUndefined();
  expect(await t.run(ctx => ctx.db.query('relayJobs').collect())).toHaveLength(0);
  expect((await t.action(api.delegatedNative.start, identity)).to.toLowerCase()).toBe(CURRENT_ALLOWANCE.address.toLowerCase());
});
it('native allowance batches authorize every recipient and use one atomic call', async () => {
  const { t, prepareArgs, prepare, quote, identity } = await nativeAllowanceFixture(true);
  expect(quote.additionalTransfers).toHaveLength(1);
  await expect(t.action(api.delegatedPayments.prepare, { ...prepareArgs, additionalSignatures: [] })).rejects.toThrow('Every recipient');
  await prepare(); const prepared = await t.action(api.delegatedNative.start, identity);
  expect(prepared.to.toLowerCase()).not.toBe(CURRENT_ALLOWANCE.address.toLowerCase());
  expect(prepared.data.length).toBeGreaterThan(1000);
  expect(await t.run(ctx => ctx.db.query('delegationReservations').collect())).toHaveLength(2);
});
it('native allowance authorization rejects a hidden fee, forged signature and changed grant', async () => {
  const { t, prepareArgs } = await nativeAllowanceFixture();
  await expect(t.action(api.delegatedPayments.prepare, { ...prepareArgs, feeHash: `0x${'aa'.repeat(32)}`, feeSignature: prepareArgs.signature })).rejects.toThrow('must not include');
  const wrong = await TEST_ACCOUNTS.approver.signMessage({ message: { raw: prepareArgs.hash as Hex } });
  await expect(t.action(api.delegatedPayments.prepare, { ...prepareArgs, signature: wrong })).rejects.toThrow('not signed by your wallet');
  state.amount = 0n;
  await expect(t.action(api.delegatedPayments.prepare, prepareArgs)).rejects.toThrow('No active allowance');
});
it('only the original delegate can retry a wallet-declined native allowance send', async () => {
  const { t, identity, prepare, approver } = await nativeAllowanceFixture();
  await prepare();
  const first = await t.action(api.delegatedNative.start, identity);
  await expect(t.action(api.delegatedNative.start, identity)).rejects.toThrow('original wallet submission');
  await expect(t.mutation(api.nativePayments.walletRejected, { ...identity, sessionToken: approver.sessionToken, attemptId: first.attemptId })).rejects.toThrow('no longer current');
  await t.mutation(api.nativePayments.walletRejected, { ...identity, attemptId: first.attemptId });
  const second = await t.action(api.delegatedNative.start, identity);
  expect(second.data).toBe(first.data); expect(second.attemptId).not.toBe(first.attemptId);
  await expect(t.mutation(api.nativePayments.walletRejected, { ...identity, attemptId: first.attemptId })).rejects.toThrow('no longer current');
});
it('native allowance sends remain available after trial expiry', async () => {
  const { t, ids, identity, prepare } = await nativeAllowanceFixture();
  await prepare();
  await t.run(ctx => ctx.db.patch(ids.billingId, { status: 'expired', trialEndsAt: Date.now() - 1 }));
  const request = await t.action(api.delegatedNative.start, identity);
  expect(request.attemptId).toBeTruthy();
  expect((await t.run(ctx => ctx.db.get(identity.disbursementId)))?.executionFee).toBeUndefined();
});
it('recovers a declined allowance payment and permits the next payment after its nonce advances', async () => {
  const { t, ids, identity, quote, prepare } = await nativeAllowanceFixture();
  await prepare();
  const first = await t.action(api.delegatedNative.start, identity);
  await t.mutation(api.nativePayments.walletRejected, { ...identity, attemptId: first.attemptId });
  const original = (await t.run(ctx => ctx.db.get(identity.disbursementId)))!;
  const next = await t.mutation(api.disbursements.create, { orgId: ids.orgId, sessionToken: identity.sessionToken, beneficiaryId: original.beneficiaryId!, amount: '1', token: 'USDC', chainId: 11155111 });
  await expect(t.action(api.delegatedPayments.quote, { ...identity, disbursementId: next.disbursementId, feeMode: 'wallet' })).rejects.toThrow('ALLOWANCE_AUTHORIZATION_RESERVED');
  const retry = await t.action(api.delegatedNative.start, identity);
  expect(retry.data).toBe(first.data);
  const txHash = `0x${'aa'.repeat(32)}` as Hex, safe = state.graph!.root;
  const topic = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;
  const moduleLog = { address: CURRENT_ALLOWANCE.address, topics: [keccak256(stringToHex('ExecuteAllowanceTransfer(address,address,address,address,uint96,uint16)')), topic(safe)], data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint96' }, { type: 'uint16' }], [TEST_WALLETS.admin, token, quote.recipientAddress as Hex, 1000000n, quote.nonce]), transactionHash: txHash };
  state.getLogs.mockResolvedValue([moduleLog]);
  state.receipt = { status: 'success', blockNumber: 120n, blockHash: `0x${'cd'.repeat(32)}`, logs: [moduleLog, { address: token, topics: [keccak256(stringToHex('Transfer(address,address,uint256)')), topic(safe), topic(quote.recipientAddress)], data: encodeAbiParameters([{ type: 'uint256' }], [1000000n]) }] };
  await t.action(internal.nativePayments.reconcile, { disbursementId: identity.disbursementId });
  const saved = await t.run(ctx => ctx.db.get(identity.disbursementId));
  expect(saved?.status, JSON.stringify({ status: saved?.status, error: saved?.relayError, txHash: saved?.txHash, checkpoint: saved?.nativeExecution, getLogs: state.getLogs.mock.calls.length })).toBe('executed'); expect(saved?.txHash).toBe(txHash); expect(saved?.nativeRecoveryAt).toBeUndefined(); expect(saved?.settlement?.blockNumber).toBe('120');
  state.allowanceNonce = quote.nonce + 1;
  const nextQuote = await t.action(api.delegatedPayments.quote, { ...identity, disbursementId: next.disbursementId, feeMode: 'wallet' });
  expect(nextQuote.nonce).toBe(quote.nonce + 1);
  expect(await t.run(ctx => ctx.db.query('delegationReservations').collect())).toHaveLength(1);
});
it('a reverted native allowance receipt needs confirmations and exact calldata before retry', async () => {
  const { t, identity, prepare } = await nativeAllowanceFixture();
  await prepare(); const original = await t.action(api.delegatedNative.start, identity);
  const txHash = `0x${'aa'.repeat(32)}`;
  state.getTransaction.mockResolvedValue({ to: original.to, input: original.data, value: 0n });
  await t.action(api.delegatedPayments.recordSubmission, { ...identity, txHash });
  state.receipt = { status: 'reverted', blockNumber: 123n, blockHash: `0x${'cd'.repeat(32)}`, logs: [] };
  await t.action(internal.nativePayments.reconcile, { disbursementId: identity.disbursementId });
  expect((await t.run(ctx => ctx.db.get(identity.disbursementId)))?.nativeExecution?.revertedAt).toBeUndefined();
  state.receipt.blockNumber = 120n;
  state.getTransaction.mockResolvedValue({ to: TEST_WALLETS.viewer, input: '0x', value: 0n });
  await t.action(internal.nativePayments.reconcile, { disbursementId: identity.disbursementId });
  expect((await t.run(ctx => ctx.db.get(identity.disbursementId)))?.nativeExecution?.revertedAt).toBeUndefined();
  state.getTransaction.mockResolvedValue({ to: original.to, input: original.data, value: 0n });
  await t.action(internal.nativePayments.reconcile, { disbursementId: identity.disbursementId });
  const saved = await t.run(ctx => ctx.db.get(identity.disbursementId));
  expect(saved?.nativeExecution?.revertedTxHash).toBe(txHash);
  expect(saved?.nativeExecution?.walletRejectedAt).toBeUndefined();
  expect(saved?.txHash).toBeUndefined();
  const retry = await t.action(api.delegatedNative.start, identity);
  expect(retry.data).toBe(original.data);
  expect(retry.attemptId).not.toBe(original.attemptId);
});
