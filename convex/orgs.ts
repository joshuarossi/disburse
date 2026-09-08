import { appendAudit } from './audit';
import { v } from 'convex/values';
import { initialBilling } from './lib/licenseManagement';
import { mutation, query } from './_generated/server';
import { getOrgLimits } from './billing';
import { teamSeats } from './lib/teamSeats';
import { requireOrgAccess, requireUser } from './lib/rbac';
import { assertValidAddress } from './lib/validation';
import { getOrCreateUser } from './lib/users';

const SUPPORTED_RELAY_FEE_TOKENS = ['USDC', 'USDT'] as const;
type RelayFeeMode = 'stablecoin_preferred' | 'stablecoin_only';

const DEFAULT_RELAY_FEE_TOKEN_SYMBOL = (() => {
  const envValue = (process.env.VITE_GELATO_DEFAULT_FEE_TOKEN ?? 'USDC')
    .toString()
    .toUpperCase();
  return SUPPORTED_RELAY_FEE_TOKENS.includes(
    envValue as (typeof SUPPORTED_RELAY_FEE_TOKENS)[number],
  )
    ? (envValue as (typeof SUPPORTED_RELAY_FEE_TOKENS)[number])
    : 'USDC';
})();

const DEFAULT_RELAY_FEE_MODE: RelayFeeMode =
  process.env.VITE_GELATO_DEFAULT_FEE_MODE === 'stablecoin_only'
    ? 'stablecoin_only'
    : 'stablecoin_preferred';

function normalizeRelayFeeMode(value?: string | null): RelayFeeMode {
  return value === 'stablecoin_only'
    ? 'stablecoin_only'
    : 'stablecoin_preferred';
}

function normalizeRelayFeeTokenSymbol(value?: string | null) {
  const normalized = (value ?? DEFAULT_RELAY_FEE_TOKEN_SYMBOL)
    .toString()
    .toUpperCase();
  return SUPPORTED_RELAY_FEE_TOKENS.includes(
    normalized as (typeof SUPPORTED_RELAY_FEE_TOKENS)[number],
  )
    ? (normalized as (typeof SUPPORTED_RELAY_FEE_TOKENS)[number])
    : DEFAULT_RELAY_FEE_TOKEN_SYMBOL;
}

// Create a new organization
export const create = mutation({
  args: {
    name: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Resolve caller identity from session token
    const { user } = await requireUser(ctx, args.sessionToken);

    // Create org
    const orgId = await ctx.db.insert('orgs', {
      name: args.name,
      createdBy: user._id,
      screeningEnforcement: "warn",
      relayFeeTokenSymbol: DEFAULT_RELAY_FEE_TOKEN_SYMBOL,
      relayFeeMode: DEFAULT_RELAY_FEE_MODE,
      createdAt: now,
    });

    // Create membership for creator as admin
    await ctx.db.insert('orgMemberships', {
      orgId,
      userId: user._id,
      role: 'admin',
      status: 'active',
      createdAt: now,
    });

    await ctx.db.insert('billing', await initialBilling(ctx, orgId, now));

    // Audit log
    await appendAudit(ctx, {
      orgId,
      actorUserId: user._id,
      action: 'org.created',
      objectType: 'org',
      objectId: orgId,
      timestamp: now,
    });

    return { orgId };
  },
});

// Get orgs for the authenticated user (includes pending invites)
export const listForUser = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);

    // Get memberships
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .filter((q) => q.neq(q.field('status'), 'removed'))
      .collect();

    // Get orgs
    const orgs = await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        const inviter = m.status === 'invited' && m.invitedBy ? await ctx.db.query('orgMemberships').withIndex('by_org_and_user', q => q.eq('orgId', m.orgId).eq('userId', m.invitedBy!)).unique() : null;
        const invitationAvailable = m.status !== 'invited' || ((m.invitationExpiresAt ?? Infinity) > Date.now() && (!m.invitedBy || (inviter?.status === 'active' && inviter.role === 'admin')));
        return org
          ? { ...org, role: m.role, membershipStatus: m.status, invitationAvailable, invitationExpiresAt: m.invitationExpiresAt }
          : null;
      }),
    );

    return orgs.filter(Boolean);
  },
});

// Get single org by ID (members only)
export const get = query({
  args: { orgId: v.id('orgs'), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      'admin',
      'approver',
      'initiator',
      'clerk',
      'viewer',
    ]);
    return await ctx.db.get(args.orgId);
  },
});

// Update org name
export const updateName = mutation({
  args: {
    orgId: v.id('orgs'),
    name: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    // Admin-only, and the membership must be ACTIVE (requireOrgAccess
    // enforces both — an unaccepted admin invite confers no power)
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ['admin'],
    );

    await ctx.db.patch(args.orgId, { name: args.name });

    // Audit log
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: 'org.updated',
      objectType: 'org',
      objectId: args.orgId,
      metadata: { name: args.name },
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Update org relay fee settings
export const updateRelaySettings = mutation({
  args: {
    orgId: v.id('orgs'),
    sessionToken: v.string(),
    relayFeeTokenSymbol: v.string(),
    relayFeeMode: v.union(
      v.literal('stablecoin_preferred'),
      v.literal('stablecoin_only'),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', args.orgId).eq('userId', user._id),
      )
      .first();

    if (!membership || membership.role !== 'admin') {
      throw new Error('Not authorized');
    }

    const relayFeeTokenSymbol = normalizeRelayFeeTokenSymbol(
      args.relayFeeTokenSymbol,
    );
    const relayFeeMode = normalizeRelayFeeMode(args.relayFeeMode);

    await ctx.db.patch(args.orgId, {
      relayFeeTokenSymbol,
      relayFeeMode,
    });

    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: 'org.relaySettingsUpdated',
      objectType: 'org',
      objectId: args.orgId,
      metadata: { relayFeeTokenSymbol, relayFeeMode },
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Update the calling user's own membership name and/or email within an org.
// Used during onboarding to persist profile info right after org creation
// without needing to first fetch the membershipId.
export const updateOwnProfile = mutation({
  args: {
    orgId: v.id('orgs'),
    sessionToken: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', args.orgId).eq('userId', user._id),
      )
      .first();

    if (!membership || membership.status !== 'active') {
      throw new Error('Not a member of this organization');
    }

    const patch: Record<string, string | undefined> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.email !== undefined) patch.email = args.email;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(membership._id, patch);
    }

    return { success: true };
  },
});

// List all members of an org
export const listMembers = query({
  args: {
    orgId: v.id('orgs'),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify user is a member
    const { user } = await requireUser(ctx, args.sessionToken);

    const userMembership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', args.orgId).eq('userId', user._id),
      )
      .first();

    if (!userMembership || userMembership.status !== 'active') {
      throw new Error('Not a member of this organization');
    }

    // Get all memberships for this org
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect();

    // Get user details for each membership
    const members = await Promise.all(
      memberships.map(async (m) => {
        const memberUser = await ctx.db.get(m.userId);
        return memberUser
          ? {
              membershipId: m._id,
              userId: m.userId,
              walletAddress: memberUser.walletAddress,
              email: m.email, // Use membership email (org-specific)
              emailVerifiedAt: m.emailVerifiedAt,
              invitationExpiresAt: m.invitationExpiresAt,
              name: m.name, // Optional display name
              role: m.role,
              paymentPolicy: m.paymentPolicy,
              status: m.status,
              createdAt: m.createdAt,
            }
          : null;
      }),
    );

    return members.filter(Boolean);
  },
});

// Invite a new member to an org
export const inviteMember = mutation({
  args: {
    orgId: v.id('orgs'),
    sessionToken: v.string(),
    memberWalletAddress: v.string(),
    memberName: v.optional(v.string()), // Optional display name
    memberEmail: v.optional(v.string()), // Optional email
    role: v.union(
      v.literal('admin'),
      v.literal('approver'),
      v.literal('initiator'),
      v.literal('clerk'),
      v.literal('viewer'),
    ),
  },
  handler: async (ctx, args) => {
    const memberWalletAddress = args.memberWalletAddress.toLowerCase();
    const now = Date.now();

    assertValidAddress(args.memberWalletAddress, 'member wallet address');

    // Admin-only AND active (unaccepted invites confer no power)
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ['admin'],
    );

    // Check tier limits for users
    const limits = await getOrgLimits(ctx, args.orgId);
    const { reserved } = await teamSeats(ctx, args.orgId);

    // M-03: race-safe lookup-or-create for the invitee
    const memberUser = await getOrCreateUser(ctx, memberWalletAddress);

    // Check if membership already exists
    const existingMembership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', args.orgId).eq('userId', memberUser._id),
      )
      .first();

    const existingReservation = existingMembership?.status === 'invited' && (existingMembership.invitationExpiresAt ?? Infinity) > now ? 1 : 0;
    if (existingMembership?.status !== 'active' && reserved - existingReservation >= limits.maxUsers)
      throw new Error(`Your plan allows a maximum of ${limits.maxUsers} user(s). Please upgrade to add more team members.`);

    if (existingMembership) {
      if (existingMembership.status === 'active') {
        throw new Error('User is already a member of this organization');
      }
      // Re-invite a previously removed member (stays inactive until accepted)
      await ctx.db.patch(existingMembership._id, {
        invitedBy: user._id, invitedAt: now, invitationExpiresAt: now + 7 * 86400_000,
        emailVerifiedAt: undefined, emailVerificationInviteId: undefined,
        role: args.role,
        status: 'invited',
        name: args.memberName,
        email: args.memberEmail,
      });

      // Audit log
      await appendAudit(ctx, {
        orgId: args.orgId,
        actorUserId: user._id,
        action: 'member.reactivated',
        objectType: 'orgMembership',
        objectId: existingMembership._id,
        metadata: {
          memberWalletAddress,
          role: args.role,
          name: args.memberName,
          email: args.memberEmail,
        },
        timestamp: now,
      });

      return { membershipId: existingMembership._id };
    }

    // Create new membership — pending until the invitee accepts (C-06 fix)
    const membershipId = await ctx.db.insert('orgMemberships', {
      invitedBy: user._id, invitedAt: now, invitationExpiresAt: now + 7 * 86400_000,
      orgId: args.orgId,
      userId: memberUser._id,
      name: args.memberName,
      email: args.memberEmail,
      role: args.role,
      status: 'invited',
      createdAt: now,
    });

    // Audit log
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: 'member.invited',
      objectType: 'orgMembership',
      objectId: membershipId,
      metadata: {
        memberWalletAddress,
        role: args.role,
        name: args.memberName,
        email: args.memberEmail,
      },
      timestamp: now,
    });

    return { membershipId };
  },
});

// Accept a pending invite. Only the invited wallet (authenticated via session
// token) can activate their own membership — closing the C-06 gap where
// admins could grant instant active access to arbitrary wallets.
export const acceptInvite = mutation({
  args: {
    orgId: v.id('orgs'),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { user } = await requireUser(ctx, args.sessionToken);

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', args.orgId).eq('userId', user._id),
      )
      .first();

    if (!membership) {
      throw new Error('No membership found for this organization');
    }
    if (membership.status === 'active') {
      return { success: true };
    }
    if (membership.status !== 'invited') {
      throw new Error('No pending invitation for this organization');
    }
    if ((membership.invitationExpiresAt ?? Infinity) <= now) throw new Error('This invitation expired. Ask an administrator to invite you again.');
    if (membership.invitedBy) {
      const inviter = await ctx.db.query('orgMemberships').withIndex('by_org_and_user', q => q.eq('orgId', args.orgId).eq('userId', membership.invitedBy!)).unique();
      if (inviter?.status !== 'active' || inviter.role !== 'admin') throw new Error('This invitation is no longer available. Ask an administrator to invite you again.');
    }

    const limits = await getOrgLimits(ctx, args.orgId);
    const activeMembers = await ctx.db.query('orgMemberships').withIndex('by_org', q => q.eq('orgId', args.orgId))
      .filter(q => q.eq(q.field('status'), 'active')).collect();
    if (activeMembers.length >= limits.maxUsers) throw new Error('No seat available on the current plan. Ask an admin to renew or upgrade.');
    await ctx.db.patch(membership._id, { status: 'active' });

    // Audit log
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: 'member.inviteAccepted',
      objectType: 'orgMembership',
      objectId: membership._id,
      metadata: { role: membership.role },
      timestamp: now,
    });

    return { success: true };
  },
});
// Update a member's role
export const updateMemberRole = mutation({
  args: {
    orgId: v.id('orgs'),
    membershipId: v.id('orgMemberships'),
    sessionToken: v.string(),
    newRole: v.union(
      v.literal('admin'),
      v.literal('approver'),
      v.literal('initiator'),
      v.literal('clerk'),
      v.literal('viewer'),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Admin-only AND active (unaccepted invites confer no power)
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ['admin'],
    );

    // Get target membership
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== args.orgId) {
      throw new Error('Membership not found');
    }

    // Prevent demoting the last admin
    if (membership.role === 'admin' && args.newRole !== 'admin') {
      const adminCount = await ctx.db
        .query('orgMemberships')
        .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
        .filter((q) =>
          q.and(
            q.eq(q.field('role'), 'admin'),
            q.eq(q.field('status'), 'active'),
          ),
        )
        .collect();

      if (adminCount.length <= 1) {
        throw new Error('Cannot demote the last admin');
      }
    }

    const oldRole = membership.role;
    await ctx.db.patch(args.membershipId, { role: args.newRole });

    // Audit log
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: 'member.roleUpdated',
      objectType: 'orgMembership',
      objectId: args.membershipId,
      metadata: { oldRole, newRole: args.newRole },
      timestamp: now,
    });

    return { success: true };
  },
});

// Remove a member from an org
export const removeMember = mutation({
  args: {
    orgId: v.id('orgs'),
    membershipId: v.id('orgMemberships'),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Admin-only AND active (unaccepted invites confer no power)
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ['admin'],
    );

    // Get target membership
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== args.orgId) {
      throw new Error('Membership not found');
    }

    // Prevent removing the last admin
    if (membership.role === 'admin') {
      const adminCount = await ctx.db
        .query('orgMemberships')
        .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
        .filter((q) =>
          q.and(
            q.eq(q.field('role'), 'admin'),
            q.eq(q.field('status'), 'active'),
          ),
        )
        .collect();

      if (adminCount.length <= 1) {
        throw new Error('Cannot remove the last admin');
      }
    }

    // Prevent self-removal
    if (membership.userId === user._id) {
      throw new Error('Cannot remove yourself');
    }

    await ctx.db.patch(args.membershipId, { status: 'removed' });

    // Audit log
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: 'member.removed',
      objectType: 'orgMembership',
      objectId: args.membershipId,
      metadata: { removedUserId: membership.userId },
      timestamp: now,
    });

    return { success: true };
  },
});

// Save the profile and role together so a failed permission change cannot leave
// a partially updated member behind.
export const updateMember = mutation({
  args: {
    orgId: v.id('orgs'),
    membershipId: v.id('orgMemberships'),
    sessionToken: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal('admin'),
      v.literal('approver'),
      v.literal('initiator'),
      v.literal('clerk'),
      v.literal('viewer'),
    ),
  },
  handler: async (ctx, args) => {
    const { user, membership: caller } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ['admin', 'approver', 'initiator', 'clerk', 'viewer'],
    );
    const member = await ctx.db.get(args.membershipId);
    if (!member || member.orgId !== args.orgId || member.status === 'removed')
      throw new Error('Member not found in this workspace');
    if (caller.role !== 'admin' && member.userId !== user._id)
      throw new Error('Only administrators can edit another member');
    if (caller.role !== 'admin' && args.role !== member.role)
      throw new Error('Only administrators can change roles');
    if (
      member.role === 'admin' &&
      member.status === 'active' &&
      args.role !== 'admin'
    ) {
      const admins = await ctx.db
        .query('orgMemberships')
        .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
        .filter((q) =>
          q.and(
            q.eq(q.field('status'), 'active'),
            q.eq(q.field('role'), 'admin'),
          ),
        )
        .collect();
      if (admins.length <= 1)
        throw new Error('Keep at least one active administrator');
    }
    const name = args.name.trim();
    const email = args.email.trim();
    if (name.length > 200)
      throw new Error('Keep the member name under 200 characters');
    if (
      email &&
      (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
      throw new Error('Enter a valid email address');
    await ctx.db.patch(member._id, {
      name: name || undefined,
      email: email || undefined,
      ...(email.toLowerCase() !== (member.email ?? '').toLowerCase() ? { emailVerifiedAt: undefined, emailVerificationInviteId: undefined } : {}),
      role: args.role,
    });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: 'member.updated',
      objectType: 'orgMembership',
      objectId: member._id,
      metadata: { previousRole: member.role, role: args.role },
      timestamp: Date.now(),
    });
  },
});
