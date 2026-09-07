import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../_generated/api';
import schema from '../schema';
import {
  createFullOrgSetup,
  createTestMembership,
  signIn,
  TEST_WALLETS,
} from './factories';

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
  );
  const admin = await signIn(t, 'admin');
  const viewer = await signIn(t, 'viewer');
  const viewerMembership = await t.run((ctx) =>
    createTestMembership(ctx, ids.orgId, viewer.userId),
  );
  return { t, ids, admin, viewer, viewerMembership };
}
describe('atomic team member editing', () => {
  it('rolls back profile changes when the final active admin would be removed', async () => {
    const { t, ids, admin } = await setup();
    await expect(
      t.mutation(api.orgs.updateMember, {
        orgId: ids.orgId,
        membershipId: ids.membershipId,
        sessionToken: admin.sessionToken,
        name: 'Changed',
        email: 'changed@example.com',
        role: 'viewer',
      }),
    ).rejects.toThrow('active administrator');
    const unchanged = await t.run((ctx) => ctx.db.get(ids.membershipId));
    expect(unchanged?.role).toBe('admin');
    expect(unchanged?.name).toBeUndefined();
  });
  it('allows editing your own profile without role escalation', async () => {
    const { t, ids, viewer, viewerMembership } = await setup();
    const args = {
      orgId: ids.orgId,
      membershipId: viewerMembership,
      sessionToken: viewer.sessionToken,
      name: 'Viewer',
      email: 'viewer@example.com',
      role: 'viewer' as const,
    };
    await t.mutation(api.orgs.updateMember, args);
    await expect(
      t.mutation(api.orgs.updateMember, { ...args, role: 'admin' }),
    ).rejects.toThrow('administrators');
    expect(await t.run((ctx) => ctx.db.get(viewerMembership))).toMatchObject({
      name: 'Viewer',
      role: 'viewer',
    });
  });
  it('prevents cross-workspace edits even by an administrator', async () => {
    const { t, ids, admin } = await setup();
    const other = await t.run((ctx) => createFullOrgSetup(ctx));
    await expect(
      t.mutation(api.orgs.updateMember, {
        orgId: ids.orgId,
        membershipId: other.membershipId,
        sessionToken: admin.sessionToken,
        name: 'Changed',
        email: '',
        role: 'viewer',
      }),
    ).rejects.toThrow('not found');
  });
});
