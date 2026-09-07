import type { QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { amountToBaseUnits, formatBaseUnits } from './validation';

// App authorization, not a change to the Safe's owners or on-chain threshold.
// Non-cancelled batches reserve the creator's budget in the planned UTC month.
export async function assertMemberPaymentPolicy(
  ctx: Pick<QueryCtx, 'db'>,
  orgId: Id<'orgs'>,
  userId: Id<'users'>,
  token: string,
  amount: string,
  payAt: number,
  excludeId?: Id<'disbursements'>,
) {
  const membership = await ctx.db
    .query('orgMemberships')
    .withIndex('by_org_and_user', (q) =>
      q.eq('orgId', orgId).eq('userId', userId),
    )
    .first();
  if (!membership || membership.status !== 'active' || !['admin', 'approver', 'initiator'].includes(membership.role))
    throw new Error('The payment creator no longer has permission to submit payments');
  const policy = membership.paymentPolicy;
  if (!policy) return;
  if (policy.token !== token.toUpperCase())
    throw new Error(
      `This member is authorized to create payments only in ${policy.token}`,
    );
  const current = excludeId ? await ctx.db.get(excludeId) : null;
  const fee = current?.executionFee;
  if (fee && fee.token !== policy.token)
    throw new Error(`This member's spending limit requires fees in ${policy.token}`);
  const requested = amountToBaseUnits(amount, token) + (fee ? amountToBaseUnits(fee.amount, token) : 0n);
  if (
    policy.perPayment &&
    requested > amountToBaseUnits(policy.perPayment, token)
  )
    throw new Error(
      `Payment exceeds this member's ${policy.perPayment} ${token} per-payment limit`,
    );
  if (!policy.perMonth) return;
  const date = new Date(payAt);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const created = await ctx.db
    .query('disbursements')
    .withIndex('by_org_creator', (q) =>
      q.eq('orgId', orgId).eq('createdBy', userId),
    )
    .collect();
  const delegated = await ctx.db.query('disbursements').withIndex('by_org_delegate', q => q.eq('orgId', orgId).eq('delegatedBy', userId)).collect();
  const payments = [...new Map([...created, ...delegated].map(p => [p._id, p])).values()];
  const reserved = payments.reduce((sum, payment) => {
    const when = payment.scheduledAt ?? payment.createdAt;
    if (
      payment._id === excludeId ||
      payment.status === 'cancelled' ||
      payment.token.toUpperCase() !== policy.token ||
      when < start ||
      when >= end
    )
      return sum;
    const value = payment.totalAmount ?? payment.amount;
    return sum + (value ? amountToBaseUnits(value, token) : 0n) + (payment.executionFee?.token === token ? amountToBaseUnits(payment.executionFee.amount, token) : 0n);
  }, 0n);
  const budget = amountToBaseUnits(policy.perMonth, token);
  if (reserved + requested > budget)
    throw new Error(
      `Payment exceeds this member's monthly allowance. ${formatBaseUnits(budget > reserved ? budget - reserved : 0n, token)} ${token} remains for the planned payment month.`,
    );
}
