import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/** Account identity is explicit. Legacy callers may infer it only when there
 * is exactly one active account, never by taking the first on a network. */
export async function resolveFundingAccount(
  ctx: Pick<QueryCtx, 'db'>,
  input: { orgId: Id<'orgs'>; chainId: number; safeId?: Id<'safes'> },
) {
  if (input.safeId) {
    const safe = await ctx.db.get(input.safeId);
    if (!safe || safe.orgId !== input.orgId || safe.chainId !== input.chainId)
      throw new Error('The funding account does not belong to this workspace and network');
    if (safe.isActive === false)
      throw new Error('The selected funding account is no longer active. Review the account before preparing payments.');
    return safe;
  }
  const accounts = await ctx.db.query('safes')
    .withIndex('by_org_chain', q => q.eq('orgId', input.orgId).eq('chainId', input.chainId))
    .filter(q => q.neq(q.field('isActive'), false)).take(2);
  if (!accounts.length) throw new Error('No Safe linked for this chain. Link a funding account on this network first.');
  if (accounts.length > 1) throw new Error('Choose a funding account. This workspace has more than one account on this network.');
  return accounts[0];
}

/** Older schedules retain the account used by their last occurrence. Adding
 * or archiving an account must never redirect a future payroll run. */
export async function recurringFundingId(ctx: Pick<QueryCtx, 'db'>, series: Doc<'recurringPayments'>) {
  if (series.safeId) return series.safeId;
  if (!series.lastDisbursementId) return undefined;
  const previous = await ctx.db.get(series.lastDisbursementId);
  if (!previous || previous.orgId !== series.orgId || previous.chainId !== series.chainId || previous.recurringPaymentId !== series._id)
    throw new Error('The original schedule account could not be verified. Review this schedule before resuming.');
  return previous.safeId;
}
