import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import schema from '../schema';
import { api, internal } from '../_generated/api';
import { createFullOrgSetup, createTestBeneficiary, signIn, TEST_WALLETS } from './factories';
import { allowanceModules, type DelegatedIntent } from '../../shared/allowanceTransfer';
import { CHAIN_TOKENS } from '../../shared/chains';
import { allowanceDeployments } from '../../shared/allowanceDeployments';

// Historical fee authorizations still need nonce and recovery coverage. The
// production adapter is disabled and is checked without mocks in serviceBillingBoundary.
vi.mock('../lib/relayConfiguration', () => ({ relayConfiguration: () => ({ fee: { token: 'USDC', tokenAddress: CHAIN_TOKENS[11155111].USDC.address, collector: TEST_WALLETS.viewer, amount: '0.05' } }) }));

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const ids = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin });
    const beneficiaryId = await createTestBeneficiary(ctx, ids.orgId);
    const beneficiary = await ctx.db.get(beneficiaryId);
    return { ...ids, beneficiaryId, recipientAddress: beneficiary!.walletAddress };
  });
  const { sessionToken } = await signIn(t, 'admin');
  const fields = { orgId: ids.orgId, sessionToken, name: 'Delegated invoice', purpose: 'invoice' as const, token: 'USDC', chainId: 11155111, recipients: [{ beneficiaryId: ids.beneficiaryId, amount: '0.010001' }] };
  const { disbursementId } = await t.mutation(api.paymentRuns.create, fields);
  const intent: DelegatedIntent = { chainId: 11155111, safeAddress: ids.safeAddress, module: allowanceModules(11155111)[0], delegate: TEST_WALLETS.admin, nonce: 7, hash: `0x${'ab'.repeat(32)}`, signature: `0x${'cd'.repeat(65)}`, tokenAddress: CHAIN_TOKENS[11155111].USDC.address, recipientAddress: ids.recipientAddress, amount: '0.010001' };
  return { t, ids, fields, sessionToken, intent, disbursementId };
}
describe('delegated payment reservations and recovery', () => {
  it('rejects new authorizations from legacy spending modules', async () => {
    const { t, sessionToken, intent, disbursementId } = await setup();
    const legacy = allowanceDeployments(11155111).find(d => d.legacy)!;
    await expect(t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent: { ...intent, module: legacy.address } })).rejects.toThrow('Funding instructions changed');
    expect((await t.run(ctx => ctx.db.get(disbursementId)))?.status).toBe('draft');
    expect(await t.run(ctx => ctx.db.query('delegationReservations').collect())).toHaveLength(0);
  });
  it('stops a prepared legacy submission while preserving existing authorizations for reconciliation', async () => {
    const { t, ids, intent, disbursementId } = await setup();
    const legacy = allowanceDeployments(11155111).find(d => d.legacy)!;
    const oldIntent = { ...intent, module: legacy.address };
    const jobId = await t.run(async ctx => {
      await ctx.db.patch(disbursementId, { status: 'relaying', allowanceExecution: oldIntent });
      return ctx.db.insert('relayJobs', { disbursementId, orgId: ids.orgId, chainId: 11155111, safeTxHash: intent.hash, to: intent.safeAddress, data: '0x', searchFromBlock: '123', provider: 'gelato_turbo', status: 'prepared', attempts: 0, createdAt: Date.now(), updatedAt: Date.now() });
    });
    expect(await t.mutation(internal.relayJobs.begin, { jobId })).toBe(false);
    expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: 'exception', neverSubmitted: true, attempts: 0 });
    const context = await t.query(internal.delegatedPayments.context, { disbursementId });
    expect(context.payment.allowanceExecution).toEqual(oldIntent);
  });
  it('locks the exact authorization and prevents a second draft consuming the same allowance nonce', async () => {
    const { t, fields, sessionToken, intent, disbursementId } = await setup();
    await t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent });
    const second = await t.mutation(api.paymentRuns.create, fields);
    await expect(t.mutation(internal.delegatedPayments.claim, { disbursementId: second.disbursementId, sessionToken, intent })).rejects.toThrow('already reserved');
    expect(await t.run(ctx => ctx.db.get(disbursementId))).toMatchObject({ status: 'relaying', relayStatus: 'awaiting_wallet', allowanceExecution: intent });
    await expect(t.mutation(api.disbursements.updateStatus, { disbursementId, sessionToken, status: 'failed' })).rejects.toThrow('delegated authorization');
  });
  it('rejects a changed amount, funding account, delegate or recipient preference at claim time', async () => {
    const { t, ids, sessionToken, intent, disbursementId } = await setup();
    for (const altered of [{ ...intent, amount: '0.02' }, { ...intent, chainId: 8453 }, { ...intent, delegate: TEST_WALLETS.initiator }]) {
      await expect(t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent: altered })).rejects.toThrow();
    }
    await t.run(ctx => ctx.db.patch(ids.beneficiaryId, { preferredToken: 'USDT' }));
    await expect(t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent })).rejects.toThrow('requests USDT');
    expect(await t.run(ctx => ctx.db.get(disbursementId))).toMatchObject({ status: 'draft' });
  });
  it('does not lose receipt reconciliation when a recipient or funding account is later deactivated', async () => {
    const { t, ids, sessionToken, intent, disbursementId } = await setup();
    await t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent });
    await t.run(async ctx => { await ctx.db.patch(ids.beneficiaryId, { isActive: false }); await ctx.db.patch(ids.safeId, { isActive: false }); });
    const context = await t.query(internal.delegatedPayments.context, { disbursementId });
    expect(context.payment.allowanceExecution).toEqual(intent);
    expect(context.recipientAddress).toBe(ids.recipientAddress);
  });
  it('keeps delegated payment authorization available after trial expiry', async () => {
    const { t, ids, sessionToken, intent, disbursementId } = await setup();
    await t.run(ctx => ctx.db.patch(ids.billingId, { trialEndsAt: Date.now() - 1 }));
    await t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent });
    expect(await t.run(ctx => ctx.db.get(disbursementId))).toMatchObject({ status: 'relaying', allowanceExecution: intent });
  });
  it('allows only the same authorization to resume after a verified reverted transaction', async () => {
    const { t, sessionToken, intent, disbursementId } = await setup();
    await t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent });
    const txHash = `0x${'ef'.repeat(32)}`;
    await t.run(ctx => ctx.db.patch(disbursementId, { txHash }));
    await t.mutation(internal.delegatedPayments.markReverted, { disbursementId, txHash });
    const saved = await t.run(ctx => ctx.db.get(disbursementId));
    expect(saved?.txHash).toBeUndefined();
    expect(saved?.allowanceExecution).toEqual(intent);
    expect(saved?.delegationKey).toBeTruthy();
    expect(saved?.status).toBe('relaying');
  });
});

describe('historical delegated fee authorizations', () => {
  it('atomically reserves recipient and fee authorizations and queues a relay', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const { t, fields, sessionToken, intent, disbursementId } = await setup();
      const collector = TEST_WALLETS.viewer;
      vi.stubEnv('GELATO_TESTNET_API_KEY', 'test-only-placeholder');
      vi.stubEnv('GELATO_11155111_FEE_COLLECTOR', collector);
      vi.stubEnv('GELATO_11155111_FEE_USDC', '0.05');
      const feeAuthorization = { token: 'USDC', tokenAddress: intent.tokenAddress, collector, amount: '0.05', nonce: 8, hash: `0x${'ef'.repeat(32)}`, signature: `0x${'ab'.repeat(65)}` };
      await t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent: { ...intent, feeAuthorization }, relayFromBlock: '12345' });
      const payment = await t.run(ctx => ctx.db.get(disbursementId));
      expect(payment).toMatchObject({ status: 'relaying', relayStatus: 'Preparing submission', executionFee: { amount: '0.05', token: 'USDC' } });
      const jobs = await t.run(ctx => ctx.db.query('relayJobs').collect());
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ status: 'prepared', searchFromBlock: '12345', safeTxHash: intent.hash });
      const second = await t.mutation(api.paymentRuns.create, fields);
      await expect(t.mutation(internal.delegatedPayments.claim, { disbursementId: second.disbursementId, sessionToken, intent: { ...intent, nonce: 8 } })).rejects.toThrow('already reserved');
    } finally { vi.unstubAllEnvs(); vi.useRealTimers(); }
  });
  it('rolls back the fee and relay when the total exceeds the app limit', async () => {
    const { vi } = await import('vitest');
    try {
      const { t, ids, sessionToken, intent, disbursementId } = await setup();
      vi.stubEnv('GELATO_TESTNET_API_KEY', 'test-only-placeholder');
      vi.stubEnv('GELATO_11155111_FEE_COLLECTOR', TEST_WALLETS.viewer);
      vi.stubEnv('GELATO_11155111_FEE_USDC', '0.05');
      await t.run(async ctx => {
        const m = await ctx.db.query('orgMemberships').withIndex('by_org_and_user', q => q.eq('orgId', ids.orgId).eq('userId', ids.userId)).first();
        await ctx.db.patch(m!._id, { paymentPolicy: { token: 'USDC', perPayment: '0.06' } });
      });
      const feeAuthorization = { token: 'USDC', tokenAddress: intent.tokenAddress, collector: TEST_WALLETS.viewer, amount: '0.05', nonce: 8, hash: `0x${'ef'.repeat(32)}`, signature: `0x${'ab'.repeat(65)}` };
      await expect(t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent: { ...intent, feeAuthorization }, relayFromBlock: '12345' })).rejects.toThrow('per-payment');
      expect((await t.run(ctx => ctx.db.get(disbursementId)))?.executionFee).toBeUndefined();
      expect(await t.run(ctx => ctx.db.query('relayJobs').collect())).toHaveLength(0);
    } finally { vi.unstubAllEnvs(); }
  });
});

it('reserves every recipient nonce in a delegated batch and one fee nonce', async () => {
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  try {
    const { t, ids, sessionToken, intent, disbursementId, fields } = await setup();
    vi.stubEnv('GELATO_TESTNET_API_KEY', 'test-only-placeholder');
    vi.stubEnv('GELATO_11155111_FEE_COLLECTOR', TEST_WALLETS.viewer);
    vi.stubEnv('GELATO_11155111_FEE_USDC', '0.05');
    await t.run(async ctx => {
      const beneficiaryId = await createTestBeneficiary(ctx, ids.orgId, { walletAddress: TEST_WALLETS.approver });
      await ctx.db.insert('disbursementRecipients', { disbursementId, beneficiaryId, recipientAddress: TEST_WALLETS.approver, payoutVersion: 1, amount: '0.02', createdAt: Date.now() });
      await ctx.db.patch(disbursementId, { totalAmount: '0.030001' });
    });
    const additionalTransfers = [{ recipientAddress: TEST_WALLETS.approver, amount: '0.02', nonce: 8, hash: `0x${'ab'.repeat(32)}`, signature: intent.signature }];
    const feeAuthorization = { token: 'USDC', tokenAddress: intent.tokenAddress, collector: TEST_WALLETS.viewer, amount: '0.05', nonce: 9, hash: `0x${'ef'.repeat(32)}`, signature: intent.signature };
    await t.mutation(internal.delegatedPayments.claim, { disbursementId, sessionToken, intent: { ...intent, additionalTransfers, feeAuthorization }, relayFromBlock: '12345' });
    expect(await t.run(ctx => ctx.db.query('delegationReservations').collect())).toHaveLength(3);
    expect(await t.run(ctx => ctx.db.query('relayJobs').collect())).toHaveLength(1);
    const second = await t.mutation(api.paymentRuns.create, fields);
    await expect(t.mutation(internal.delegatedPayments.claim, { disbursementId: second.disbursementId, sessionToken, intent: { ...intent, nonce: 8 } })).rejects.toThrow('already reserved');
  } finally { vi.unstubAllEnvs(); vi.useRealTimers(); }
});
