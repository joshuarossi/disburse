import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { requireOrgAccess } from './lib/rbac';
import { assertValidAmount, amountToBaseUnits } from './lib/validation';
import { appendAudit } from './audit';

export const update = mutation({
  args: {
    membershipId: v.id('orgMemberships'),
    sessionToken: v.string(),
    policy: v.union(
      v.null(),
      v.object({
        token: v.string(),
        perPayment: v.optional(v.string()),
        perMonth: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.status !== 'active')
      throw new Error('Active team member not found');
    const { user } = await requireOrgAccess(
      ctx,
      membership.orgId,
      args.sessionToken,
      ['admin'],
    );
    if (args.policy) {
      if (!['USDC', 'USDT', 'PYUSD', 'EURC'].includes(args.policy.token))
        throw new Error('Choose a supported payment currency');
      if (args.policy.perPayment)
        assertValidAmount(args.policy.perPayment, args.policy.token);
      if (args.policy.perMonth)
        assertValidAmount(args.policy.perMonth, args.policy.token);
      if (
        args.policy.perPayment &&
        args.policy.perMonth &&
        amountToBaseUnits(args.policy.perPayment, args.policy.token) >
          amountToBaseUnits(args.policy.perMonth, args.policy.token)
      )
        throw new Error(
          'The per-payment limit cannot exceed the monthly allowance',
        );
    }
    await ctx.db.patch(membership._id, {
      paymentPolicy: args.policy ?? undefined,
    });
    await appendAudit(ctx, {
      orgId: membership.orgId,
      actorUserId: user._id,
      action: 'member.payment_policy_updated',
      objectType: 'membership',
      objectId: membership._id,
      metadata: {
        token: args.policy?.token ?? null,
        perPayment: args.policy?.perPayment ?? null,
        perMonth: args.policy?.perMonth ?? null,
      },
      timestamp: Date.now(),
    });
  },
});
