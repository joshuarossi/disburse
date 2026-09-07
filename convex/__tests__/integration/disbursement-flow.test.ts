import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import { api, internal } from '../../_generated/api';
import schema from '../../schema';
import {
  createFullOrgSetup,
  createTestBeneficiary,
  signIn,
  TEST_WALLETS,
} from '../factories';

// updateStatus hash-integrity validation requires well-formed 32-byte hashes
const SAFE_TX_HASH = '0x' + 'ab'.repeat(32);
const TX_HASH = '0x' + 'cd'.repeat(32);

// Beneficiary destination addresses are validated server-side on creation
const ALICE_ADDRESS = '0x' + 'a'.repeat(39) + '1';

describe('Integration: Disbursement Flow', () => {
  it('complete disbursement: draft -> proposed -> executed', async () => {
    const t = convexTest(schema);

    // Setup: Create org with Safe and beneficiary
    let orgId: string;
    let beneficiaryId: string;
    await t.run(async (ctx) => {
      const setup = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      orgId = setup.orgId;
      beneficiaryId = await createTestBeneficiary(ctx, orgId as any, {
        name: 'Contractor Payment',
        type: 'individual',
      });
    });

    const admin = await signIn(t, 'admin');

    // Step 1: Create draft disbursement
    const createResult = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      sessionToken: admin.sessionToken,
      chainId: 11155111,
      beneficiaryId: beneficiaryId! as any,
      token: 'USDC',
      amount: '1500.00',
      memo: 'January invoice payment',
    });

    expect(createResult.disbursementId).toBeDefined();

    // Verify draft status
    let disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
    });

    expect(disbursement?.status).toBe('draft');
    expect(disbursement?.token).toBe('USDC');
    expect(disbursement?.amount).toBe('1500.00');

    // Step 2: Propose to Safe (after Safe tx is created)
    const safeTxHash = SAFE_TX_HASH;
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
      status: 'proposed',
      safeTxHash,
    });

    // Verify proposed status
    disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
    });

    expect(disbursement?.status).toBe('proposed');
    expect(disbursement?.safeTxHash).toBe(safeTxHash);

    // Step 3: Execute (after Safe tx is executed)
    const txHash = TX_HASH;
    await t.mutation(internal.disbursements.confirmExecution, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
      safeTxHash: SAFE_TX_HASH,
      txHash,
    });

    // Verify executed status
    disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
    });

    expect(disbursement?.status).toBe('executed');
    expect(disbursement?.txHash).toBe(txHash);

    // Verify complete audit trail
    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query('auditLog')
        .withIndex('by_org', (q) => q.eq('orgId', orgId as any))
        .collect();

      const disbursementLogs = logs.filter((l) =>
        l.action.startsWith('disbursement.'),
      );

      expect(disbursementLogs.length).toBe(3);
      expect(
        disbursementLogs.some((l) => l.action === 'disbursement.created'),
      ).toBe(true);
      expect(
        disbursementLogs.some((l) => l.action === 'disbursement.proposed'),
      ).toBe(true);
      expect(
        disbursementLogs.some((l) => l.action === 'disbursement.executed'),
      ).toBe(true);
    });
  });

  it('failed disbursement: draft -> proposed -> failed', async () => {
    const t = convexTest(schema);

    let orgId: string;
    let beneficiaryId: string;
    await t.run(async (ctx) => {
      const setup = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      orgId = setup.orgId;
      beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
    });

    const admin = await signIn(t, 'admin');

    // Create and propose
    const createResult = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      sessionToken: admin.sessionToken,
      chainId: 11155111,
      beneficiaryId: beneficiaryId! as any,
      token: 'USDT',
      amount: '500',
    });

    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
      status: 'proposed',
      safeTxHash: SAFE_TX_HASH,
    });

    // Mark as failed
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
      status: 'failed',
    });

    const disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
    });

    expect(disbursement?.status).toBe('failed');
  });

  it('cancelled disbursement: draft -> cancelled', async () => {
    const t = convexTest(schema);

    let orgId: string;
    let beneficiaryId: string;
    await t.run(async (ctx) => {
      const setup = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      orgId = setup.orgId;
      beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
    });

    const admin = await signIn(t, 'admin');

    // Create draft
    const createResult = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      sessionToken: admin.sessionToken,
      chainId: 11155111,
      beneficiaryId: beneficiaryId! as any,
      token: 'USDC',
      amount: '100',
    });

    // Cancel before proposing
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
      status: 'cancelled',
    });

    const disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
    });

    expect(disbursement?.status).toBe('cancelled');
  });

  it('multiple disbursements with filtering', async () => {
    const t = convexTest(schema);

    let orgId: string;
    let beneficiaryId: string;
    await t.run(async (ctx) => {
      const setup = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      orgId = setup.orgId;
      beneficiaryId = await createTestBeneficiary(ctx, orgId as any);
    });

    const admin = await signIn(t, 'admin');

    // Create multiple disbursements with different statuses
    const draft1 = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      sessionToken: admin.sessionToken,
      chainId: 11155111,
      beneficiaryId: beneficiaryId! as any,
      token: 'USDC',
      amount: '100',
    });

    await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      sessionToken: admin.sessionToken,
      chainId: 11155111,
      beneficiaryId: beneficiaryId! as any,
      token: 'USDC',
      amount: '200',
    });

    // Propose one
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId: draft1.disbursementId as any,
      sessionToken: admin.sessionToken,
      status: 'proposed',
      safeTxHash: SAFE_TX_HASH,
    });

    // Execute it
    await t.mutation(internal.disbursements.confirmExecution, {
      disbursementId: draft1.disbursementId as any,
      sessionToken: admin.sessionToken,
      safeTxHash: SAFE_TX_HASH,
      txHash: TX_HASH,
    });

    // Filter by draft
    const drafts = await t.query(api.disbursements.list, {
      orgId: orgId! as any,
      sessionToken: admin.sessionToken,
      status: ['draft'],
    });
    expect(drafts.items.length).toBe(1);

    // Filter by executed
    const executed = await t.query(api.disbursements.list, {
      orgId: orgId! as any,
      sessionToken: admin.sessionToken,
      status: ['executed'],
    });
    expect(executed.items.length).toBe(1);
    expect(executed.items[0].amount).toBe('100');

    // All disbursements
    const all = await t.query(api.disbursements.list, {
      orgId: orgId! as any,
      sessionToken: admin.sessionToken,
    });
    expect(all.items.length).toBe(2);
    expect(all.totalCount).toBe(2);
  });

  it('disbursement includes beneficiary details', async () => {
    const t = convexTest(schema);

    let orgId: string;
    let beneficiaryId: string;
    await t.run(async (ctx) => {
      const setup = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      orgId = setup.orgId;
      beneficiaryId = await createTestBeneficiary(ctx, orgId as any, {
        name: 'Alice Smith',
        walletAddress: ALICE_ADDRESS,
        type: 'individual',
      });
    });

    const admin = await signIn(t, 'admin');

    const createResult = await t.mutation(api.disbursements.create, {
      orgId: orgId! as any,
      sessionToken: admin.sessionToken,
      chainId: 11155111,
      beneficiaryId: beneficiaryId! as any,
      token: 'USDC',
      amount: '50',
    });

    const disbursement = await t.query(api.disbursements.get, {
      disbursementId: createResult.disbursementId as any,
      sessionToken: admin.sessionToken,
    });

    expect(disbursement?.beneficiary).not.toBeNull();
    expect(disbursement?.beneficiary?.name).toBe('Alice Smith');
    expect(disbursement?.beneficiary?.walletAddress).toBe(ALICE_ADDRESS);
  });
});
import { beforeEach, afterEach, vi } from 'vitest';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
