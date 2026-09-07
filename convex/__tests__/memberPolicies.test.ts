import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../_generated/api';
import schema from '../schema';
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestMembership,
  createTestUser,
  signIn,
  TEST_WALLETS,
} from './factories';

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const userId = await createTestUser(ctx, {
      walletAddress: TEST_WALLETS.initiator,
    });
    const membershipId = await createTestMembership(ctx, org.orgId, userId, {
      role: 'initiator',
    });
    const beneficiaryId = await createTestBeneficiary(ctx, org.orgId);
    return { ...org, membershipId, beneficiaryId };
  });
  const admin = await signIn(t, 'admin');
  const initiator = await signIn(t, 'initiator');
  await t.mutation(api.memberPolicies.update, {
    membershipId: ids.membershipId,
    sessionToken: admin.sessionToken,
    policy: { token: 'USDC', perPayment: '100', perMonth: '150' },
  });
  return {
    t,
    ids,
    admin,
    initiator,
    args: {
      orgId: ids.orgId,
      sessionToken: initiator.sessionToken,
      beneficiaryId: ids.beneficiaryId,
      chainId: 11155111,
      token: 'USDC',
      amount: '100',
    },
  };
}

describe('member payment delegation', () => {
  it('prevents a member from increasing their own allowance', async () => {
    const { t, ids, initiator } = await setup();
    await expect(
      t.mutation(api.memberPolicies.update, {
        membershipId: ids.membershipId,
        sessionToken: initiator.sessionToken,
        policy: null,
      }),
    ).rejects.toThrow('Insufficient permissions');
  });
  it('enforces per-payment limits and rejects currency substitution', async () => {
    const { t, args } = await setup();
    await expect(
      t.mutation(api.disbursements.create, { ...args, amount: '100.000001' }),
    ).rejects.toThrow('per-payment limit');
    await expect(
      t.mutation(api.disbursements.create, { ...args, token: 'USDT' }),
    ).rejects.toThrow('only in USDC');
  });
  it('reserves monthly allowance for drafts and releases it on cancellation', async () => {
    const { t, args } = await setup();
    const first = await t.mutation(api.disbursements.create, args);
    await expect(t.mutation(api.disbursements.create, args)).rejects.toThrow(
      'monthly allowance',
    );
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: first.disbursementId,
      sessionToken: args.sessionToken,
      status: 'cancelled',
    });
    expect(await t.mutation(api.disbursements.create, args)).toHaveProperty(
      'disbursementId',
    );
  });
  it('applies the allowance to a whole batch', async () => {
    const { t, ids, args } = await setup();
    const other = await t.run((ctx) => createTestBeneficiary(ctx, ids.orgId));
    await expect(
      t.mutation(api.paymentRuns.create, {
        orgId: ids.orgId,
        sessionToken: args.sessionToken,
        name: 'Payroll',
        purpose: 'payroll',
        chainId: args.chainId,
        token: args.token,
        payDate: Date.now() + 60000,
        recipients: [
          { beneficiaryId: ids.beneficiaryId, amount: '60' },
          { beneficiaryId: other, amount: '60' },
        ],
      }),
    ).rejects.toThrow('per-payment limit');
  });
  it('rejects a fabricated executed status from the public API', async () => {
    const { t, args } = await setup();
    const { disbursementId } = await t.mutation(api.disbursements.create, args);
    await expect(
      t.mutation(api.disbursements.updateStatus, {
        disbursementId,
        sessionToken: args.sessionToken,
        status: 'executed',
        txHash: '0x' + 'aa'.repeat(32),
      }),
    ).rejects.toThrow('verified on chain');
  });
});
