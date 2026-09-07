import { assertMemberPaymentPolicy } from './lib/paymentLimits';
import { appendAudit } from './audit';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrgAccess } from './lib/rbac';
import { relayConfiguration } from './lib/relayConfiguration';
import { feeIdentity } from '../shared/executionFee';

export const preview = query({
  args: { disbursementId: v.id('disbursements'), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error('Payment not found');
    await requireOrgAccess(ctx, payment.orgId, args.sessionToken, ['admin', 'approver', 'initiator', 'clerk', 'viewer']);
    if (payment.executionFee) return { fee: payment.executionFee, identity: feeIdentity(payment.executionFee), error: null };
    const org = await ctx.db.get(payment.orgId);
    try {
      const fee = payment.executionFee ?? relayConfiguration(payment.chainId!, org?.relayFeeTokenSymbol || 'USDC').fee;
      return { fee, identity: feeIdentity(fee), error: null };
    } catch (error) { return { fee: null, identity: null, error: error instanceof Error ? error.message : 'Payment service unavailable' }; }
  },
});
export const accept = mutation({
  args: { disbursementId: v.id('disbursements'), sessionToken: v.string(), reviewedIdentity: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error('Payment not found');
    await requireOrgAccess(ctx, payment.orgId, args.sessionToken, ['admin', 'approver', 'initiator']);
    if (!['draft', 'pending'].includes(payment.status) || payment.safeTxHash || payment.allowanceExecution) throw new Error('This payment already has an authorization');
    const org = await ctx.db.get(payment.orgId);
    const fee = payment.executionFee ?? relayConfiguration(payment.chainId!, org?.relayFeeTokenSymbol || 'USDC').fee;
    if (feeIdentity(fee) !== args.reviewedIdentity) throw new Error('The execution fee changed. Review the current quote before signing.');
    await ctx.db.patch(payment._id, { executionFee: fee, relayFeeToken: fee.tokenAddress, relayFeeTokenSymbol: fee.token, updatedAt: Date.now() });
    await assertMemberPaymentPolicy(ctx, payment.orgId, payment.createdBy, payment.token, payment.totalAmount ?? payment.amount ?? '0', payment.scheduledAt ?? Date.now(), payment._id);
    await appendAudit(ctx, { orgId: payment.orgId, actorUserId: payment.createdBy, action: 'disbursement.fee_reviewed', objectType: 'disbursement', objectId: payment._id, timestamp: Date.now(), metadata: { amount: fee.amount, token: fee.token, collector: fee.collector } });
    return fee;
  },
});
