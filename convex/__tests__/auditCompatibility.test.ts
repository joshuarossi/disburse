import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../_generated/api';
import schema from '../schema';
import { appendAudit } from '../audit';
import { createFullOrgSetup, signIn, TEST_WALLETS } from './factories';

describe('audit history compatibility', () => {
  it('preserves structured POC events while normalizing newly written events', async () => {
    const t = convexTest(schema);
    const ids = await t.run((ctx) =>
      createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
    );
    await t.run(async (ctx) => {
      const fields = {
        orgId: ids.orgId,
        actorUserId: ids.userId,
        action: 'test.recorded',
        objectType: 'test',
        objectId: 'historical',
        timestamp: Date.now(),
      };
      await ctx.db.insert('auditLog', {
        ...fields,
        metadata: { tags: [], detail: { before: { amount: '100' } } },
      });
      await appendAudit(ctx, {
        ...fields,
        objectId: 'new',
        metadata: { tags: ['payroll'], detail: { amount: '100' } },
      });
    });
    const { sessionToken } = await signIn(t, 'admin');
    const rows = await t.query(api.audit.list, {
      orgId: ids.orgId,
      sessionToken,
    });
    expect(rows.find((row) => row.objectId === 'historical')?.metadata).toEqual(
      { tags: [], detail: { before: { amount: '100' } } },
    );
    expect(rows.find((row) => row.objectId === 'new')?.metadata).toEqual({
      tags: '["payroll"]',
      detail: '{"amount":"100"}',
    });
  });
});
