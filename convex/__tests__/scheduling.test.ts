import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import schema from '../schema';
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  signIn,
  TEST_WALLETS,
} from './factories';

const safeTxHash = '0x' + 'ab'.repeat(32);
async function setup(
  status: Doc<'disbursements'>['status'] = 'proposed',
  blocked = false,
) {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const beneficiaryId = await createTestBeneficiary(ctx, org.orgId);
    const disbursementId = await createTestDisbursement(
      ctx,
      org.orgId,
      org.safeId,
      beneficiaryId,
      org.userId,
      { status, safeTxHash },
    );
    if (blocked) {
      await ctx.db.patch(org.orgId, { screeningEnforcement: 'block' });
      await ctx.db.insert('screeningResults', {
        orgId: org.orgId,
        beneficiaryId,
        status: 'confirmed_match',
        matches: [],
        screenedAt: Date.now(),
      });
    }
    return { disbursementId };
  });
  const { sessionToken } = await signIn(t, 'admin');
  return {
    t,
    args: {
      ...ids,
      sessionToken,
      safeTxHash,
      scheduledAt: Date.now() + 60_000,
    },
  };
}

describe('scheduled payment policy', () => {
  it.each(['executed', 'cancelled', 'relaying'] as const)(
    'cannot schedule a %s payment',
    async (status) => {
      const { t, args } = await setup(status);
      await expect(
        t.mutation(api.disbursements.schedule, args),
      ).rejects.toThrow('Invalid status transition');
      expect(
        (await t.run((ctx) => ctx.db.get(args.disbursementId)))?.status,
      ).toBe(status);
    },
  );
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid schedule %s',
    async (scheduledAt) => {
      const { t, args } = await setup();
      await expect(
        t.mutation(api.disbursements.schedule, { ...args, scheduledAt }),
      ).rejects.toThrow('future');
    },
  );
  it('rejects malformed Safe transaction hashes', async () => {
    const { t, args } = await setup();
    await expect(
      t.mutation(api.disbursements.schedule, { ...args, safeTxHash: 'fake' }),
    ).rejects.toThrow('safeTxHash');
  });
  it('applies screening blocks to scheduling', async () => {
    const { t, args } = await setup('proposed', true);
    await expect(t.mutation(api.disbursements.schedule, args)).rejects.toThrow(
      "Payment blocked by your workspace's screening policy",
    );
  });
  it('applies screening blocks to rescheduling', async () => {
    const { t, args } = await setup('scheduled', true);
    await expect(
      t.mutation(api.disbursements.reschedule, {
        disbursementId: args.disbursementId,
        sessionToken: args.sessionToken,
        newScheduledAt: args.scheduledAt,
      }),
    ).rejects.toThrow("Payment blocked by your workspace's screening policy");
  });
  it('records a valid scheduled job and its version', async () => {
    const { t, args } = await setup();
    await t.mutation(api.disbursements.schedule, args);
    const payment = await t.run((ctx) => ctx.db.get(args.disbursementId));
    expect(payment).toMatchObject({
      status: 'scheduled',
      scheduledAt: args.scheduledAt,
      scheduledVersion: 1,
    });
  });
});

describe('proposal recovery', () => {
  it('allows an unsigned pending draft to recover after a rejected signature', async () => {
    const { t, args } = await setup('pending');
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: args.disbursementId,
      sessionToken: args.sessionToken,
      status: 'draft',
    });
    expect(
      (await t.run((ctx) => ctx.db.get(args.disbursementId)))?.status,
    ).toBe('draft');
  });
  it('cannot roll an already submitted payment back into a draft', async () => {
    const { t, args } = await setup('relaying');
    await expect(
      t.mutation(api.disbursements.updateStatus, {
        disbursementId: args.disbursementId,
        sessionToken: args.sessionToken,
        status: 'draft',
      }),
    ).rejects.toThrow('Invalid status transition');
  });
});

describe('manual execution claim', () => {
  it('accepts a proposal once and rejects a second execution claim', async () => {
    const { t, args } = await setup();
    const claim = {
      disbursementId: args.disbursementId,
      sessionToken: args.sessionToken,
      safeTxHash,
      attemptId: 'test-attempt',
      searchFromBlock: '100',
    };
    await t.mutation(internal.disbursements.claimNativeExecution, claim);
    await expect(
      t.mutation(internal.disbursements.claimNativeExecution, claim),
    ).rejects.toThrow();
    expect(
      (await t.run((ctx) => ctx.db.get(args.disbursementId)))?.status,
    ).toBe('relaying');
  });
  it('rejects a substituted proposal hash without claiming execution', async () => {
    const { t, args } = await setup();
    await expect(
      t.mutation(internal.disbursements.claimNativeExecution, {
        disbursementId: args.disbursementId,
        sessionToken: args.sessionToken,
        safeTxHash: '0x' + 'cd'.repeat(32),
        attemptId: 'test-attempt',
        searchFromBlock: '100',
      }),
    ).rejects.toThrow();
    expect(
      (await t.run((ctx) => ctx.db.get(args.disbursementId)))?.status,
    ).toBe('proposed');
  });
});
