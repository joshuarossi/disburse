import type { Id } from '../../_generated/dataModel';
import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import { api } from '../../_generated/api';
import schema from '../../schema';
import {
  createTestUser,
  createTestOrg,
  createTestMembership,
  createFullOrgSetup,
  signIn,
  TEST_WALLETS,
} from '../../__tests__/factories';
import { hasRoleOrHigher } from '../rbac';

// convex-test runs scheduled functions on macrotask timers; give them a beat
// to finish inside the test lifecycle so their writes don't land post-test.
function drainScheduled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

describe('RBAC', () => {
  describe('hasRoleOrHigher', () => {
    it('admin has all roles', () => {
      expect(hasRoleOrHigher('admin', 'admin')).toBe(true);
      expect(hasRoleOrHigher('admin', 'approver')).toBe(true);
      expect(hasRoleOrHigher('admin', 'initiator')).toBe(true);
      expect(hasRoleOrHigher('admin', 'clerk')).toBe(true);
      expect(hasRoleOrHigher('admin', 'viewer')).toBe(true);
    });

    it('approver has approver and below', () => {
      expect(hasRoleOrHigher('approver', 'admin')).toBe(false);
      expect(hasRoleOrHigher('approver', 'approver')).toBe(true);
      expect(hasRoleOrHigher('approver', 'initiator')).toBe(true);
      expect(hasRoleOrHigher('approver', 'clerk')).toBe(true);
      expect(hasRoleOrHigher('approver', 'viewer')).toBe(true);
    });

    it('initiator has initiator and below', () => {
      expect(hasRoleOrHigher('initiator', 'admin')).toBe(false);
      expect(hasRoleOrHigher('initiator', 'approver')).toBe(false);
      expect(hasRoleOrHigher('initiator', 'initiator')).toBe(true);
      expect(hasRoleOrHigher('initiator', 'clerk')).toBe(true);
      expect(hasRoleOrHigher('initiator', 'viewer')).toBe(true);
    });

    it('clerk has clerk and below', () => {
      expect(hasRoleOrHigher('clerk', 'admin')).toBe(false);
      expect(hasRoleOrHigher('clerk', 'approver')).toBe(false);
      expect(hasRoleOrHigher('clerk', 'initiator')).toBe(false);
      expect(hasRoleOrHigher('clerk', 'clerk')).toBe(true);
      expect(hasRoleOrHigher('clerk', 'viewer')).toBe(true);
    });

    it('viewer only has viewer role', () => {
      expect(hasRoleOrHigher('viewer', 'admin')).toBe(false);
      expect(hasRoleOrHigher('viewer', 'approver')).toBe(false);
      expect(hasRoleOrHigher('viewer', 'initiator')).toBe(false);
      expect(hasRoleOrHigher('viewer', 'clerk')).toBe(false);
      expect(hasRoleOrHigher('viewer', 'viewer')).toBe(true);
    });
  });

  // requireOrgAccess is exercised through public APIs using REAL signed-in
  // session tokens (generateNonce → sign → verifySignature), matching prod.
  describe('requireOrgAccess', () => {
    it('throws for missing or malformed session token', async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        await createTestOrg(ctx, adminId);
      });

      await expect(
        t.query(api.orgs.listForUser, { sessionToken: 'too-short' }),
      ).rejects.toThrow(/Unauthorized/);
    });

    it('throws for unknown session token (no such session)', async () => {
      const t = convexTest(schema);

      let orgId: Id<'orgs'>;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      await expect(
        t.query(api.orgs.get, {
          orgId: orgId! as any,
          sessionToken: 'f'.repeat(64),
        }),
      ).rejects.toThrow(/Unauthorized: invalid session/);
    });

    it('throws for non-member user', async () => {
      const t = convexTest(schema);

      let orgId: Id<'orgs'>;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        // A user who is NOT a member exists but has no membership row
        await createTestUser(ctx, { walletAddress: TEST_WALLETS.nonMember });
      });

      const nonMember = await signIn(t, 'nonMember');

      await expect(
        t.query(api.orgs.get, {
          orgId: orgId! as any,
          sessionToken: nonMember.sessionToken,
        }),
      ).rejects.toThrow('Not a member of this organization');
    });

    it('throws for inactive membership', async () => {
      const t = convexTest(schema);

      let orgId: Id<'orgs'>;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const viewerId = await createTestUser(ctx, {
          walletAddress: TEST_WALLETS.viewer,
        });
        await createTestMembership(ctx, orgId, viewerId, {
          role: 'viewer',
          status: 'removed',
        });
      });

      const viewer = await signIn(t, 'viewer');

      await expect(
        t.query(api.orgs.get, {
          orgId: orgId! as any,
          sessionToken: viewer.sessionToken,
        }),
      ).rejects.toThrow('Membership is not active');
    });

    it('blocks invited members until they accept their own invite', async () => {
      const t = convexTest(schema);

      let orgId: Id<'orgs'>;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          plan: 'team',
        });
        orgId = setup.orgId;
      });

      const admin = await signIn(t, 'admin');

      // Invite creates a pending membership
      await t.mutation(api.orgs.inviteMember, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
        memberWalletAddress: TEST_WALLETS.viewer,
        role: 'viewer',
      });

      const viewer = await signIn(t, 'viewer');

      // Invited ≠ active: access denied
      await expect(
        t.query(api.orgs.get, {
          orgId: orgId! as any,
          sessionToken: viewer.sessionToken,
        }),
      ).rejects.toThrow('Membership is not active');

      // Only the invitee's own token activates the membership
      await t.mutation(api.orgs.acceptInvite, {
        orgId: orgId! as any,
        sessionToken: viewer.sessionToken,
      });

      const org = await t.query(api.orgs.get, {
        orgId: orgId! as any,
        sessionToken: viewer.sessionToken,
      });
      expect(org).not.toBeNull();
    });

    it('allows access with correct role', async () => {
      const t = convexTest(schema);

      let orgId: Id<'orgs'>;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const admin = await signIn(t, 'admin');

      const org = await t.query(api.orgs.get, {
        orgId: orgId! as any,
        sessionToken: admin.sessionToken,
      });
      expect(org).not.toBeNull();

      await t.run(async (ctx) => {
        const memberships = await ctx.db
          .query('orgMemberships')
          .withIndex('by_org', (q) => q.eq('orgId', orgId as any))
          .collect();
        expect(memberships.length).toBe(1);
        expect(memberships[0]?.role).toBe('admin');
        expect(memberships[0]?.status).toBe('active');
      });
    });

    it('enforces allowed roles per function', async () => {
      const t = convexTest(schema);

      let orgId: Id<'orgs'>;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;

        const initiatorId = await createTestUser(ctx, {
          walletAddress: TEST_WALLETS.initiator,
        });
        await createTestMembership(ctx, orgId, initiatorId, {
          role: 'initiator',
        });

        const viewerId = await createTestUser(ctx, {
          walletAddress: TEST_WALLETS.viewer,
        });
        await createTestMembership(ctx, orgId, viewerId, { role: 'viewer' });
      });

      const initiator = await signIn(t, 'initiator');
      const viewer = await signIn(t, 'viewer');

      // beneficiaries.create allows admin/initiator/clerk only
      await expect(
        t.mutation(api.beneficiaries.create, {
          orgId: orgId! as any,
          sessionToken: viewer.sessionToken,
          type: 'individual',
          name: 'Nope',
          beneficiaryAddress: '0x1234567890123456789012345678901234567890',
        }),
      ).rejects.toThrow(/Insufficient permissions/);

      const result = await t.mutation(api.beneficiaries.create, {
        orgId: orgId! as any,
        sessionToken: initiator.sessionToken,
        type: 'individual',
        name: 'Allowed',
        beneficiaryAddress: '0x1234567890123456789012345678901234567890',
      });
      expect(result.beneficiaryId).toBeDefined();

      await drainScheduled();
    });
  });
});
