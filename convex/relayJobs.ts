import { v } from 'convex/values';
import { internalMutation, internalQuery, query, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { requireOrgAccess } from './lib/rbac';
import { assertPaymentMayProceed } from './lib/disbursementPolicy';
import { assertMemberPaymentPolicy } from './lib/paymentLimits';
import { appendAudit } from './audit';
import { assertCurrentAllowance } from '../shared/allowanceDeployments';

export const get = internalQuery({ args: { jobId: v.id('relayJobs') }, handler: (ctx, args) => ctx.db.get(args.jobId) });
export const reserve = internalMutation({
  args: { disbursementId: v.id('disbursements'), safeTxHash: v.string(), sessionToken: v.optional(v.string()), scheduledVersion: v.optional(v.number()), chainId: v.number(), to: v.string(), data: v.string(), searchFromBlock: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.disbursementId);
    if (!p) throw new Error('Payment not found');
    const access = args.sessionToken ? await requireOrgAccess(ctx, p.orgId, args.sessionToken, ['admin', 'approver', 'initiator']) : undefined;
    const existing = await ctx.db.query('relayJobs').withIndex('by_payment', q => q.eq('disbursementId', p._id)).first();
    if (existing) {
      if (existing.safeTxHash !== args.safeTxHash) throw new Error('Payment already has a different relay authorization');
      return existing._id;
    }
    const safe = await ctx.db.get(p.safeId);
    if (p.safeTxHash !== args.safeTxHash || p.chainId !== args.chainId || !p.executionFee || p.allowanceExecution || safe?.safeAddress.toLowerCase() !== args.to.toLowerCase()) throw new Error('Payment authorization changed');
    if (args.scheduledVersion !== undefined) {
      if (p.status !== 'scheduled' || p.scheduledVersion !== args.scheduledVersion || !p.scheduledAt || p.scheduledAt > Date.now()) throw new Error('Scheduled payment changed or is not due');
    } else if (!args.sessionToken || p.status !== 'proposed') throw new Error('Payment is not ready to send');
    await assertPaymentMayProceed(ctx, p);
    await assertMemberPaymentPolicy(ctx, p.orgId, p.createdBy, p.token, p.totalAmount ?? p.amount ?? '0', p.scheduledAt ?? Date.now(), p._id);
    const now = Date.now();
    const jobId = await ctx.db.insert('relayJobs', { disbursementId: p._id, orgId: p.orgId, chainId: args.chainId, safeTxHash: args.safeTxHash, to: args.to, data: args.data, searchFromBlock: args.searchFromBlock, provider: 'gelato_turbo', status: 'prepared', attempts: 0, createdAt: now, updatedAt: now });
    await ctx.db.patch(p._id, { status: 'relaying', relayStatus: 'Preparing submission', updatedAt: now });
    await appendAudit(ctx, { orgId: p.orgId, actorUserId: access?.user._id ?? p.createdBy, action: 'disbursement.relay_reserved', objectType: 'disbursement', objectId: p._id, timestamp: now, metadata: { jobId, provider: 'gelato_turbo', fee: p.executionFee.amount, feeToken: p.executionFee.token } });
    await ctx.scheduler.runAfter(0, internal.relayExecutor.process, { jobId });
    return jobId;
  },
});
// Claim once BEFORE calling the provider. A timeout is ambiguous, never permission to send again.
export const begin = internalMutation({ args: { jobId: v.id('relayJobs') }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.jobId);
  if (!job || job.status !== 'prepared') return false;
  const payment = await ctx.db.get(job.disbursementId);
  if (!payment) return false;
  try {
    if (payment.allowanceExecution) assertCurrentAllowance(job.chainId, payment.allowanceExecution.module);
    await assertPaymentMayProceed(ctx, payment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recipient review is required';
    await ctx.db.patch(job._id, { status: 'exception', neverSubmitted: true, error: message, updatedAt: Date.now() });
    await ctx.db.patch(payment._id, { relayStatus: 'Payment review required', relayError: message, updatedAt: Date.now() });
    return false;
  }
  await ctx.db.patch(job._id, { status: 'submitting', neverSubmitted: undefined, attempts: job.attempts + 1, updatedAt: Date.now() });
  return true;
} });
export const update = internalMutation({
  args: { jobId: v.id('relayJobs'), status: v.union(v.literal('submitted'), v.literal('confirmed'), v.literal('exception')), searchFromBlock: v.optional(v.string()), providerId: v.optional(v.string()), txHash: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === 'confirmed') return;
    if (job.providerId && args.providerId && job.providerId !== args.providerId) throw new Error('Provider request cannot be replaced');
    const patch = { status: args.status, error: args.error, searchFromBlock: args.searchFromBlock ?? job.searchFromBlock };
    await ctx.db.patch(job._id, { ...patch, providerId: args.providerId ?? job.providerId, txHash: args.txHash ?? job.txHash, attempts: job.attempts + 1, updatedAt: Date.now() });
    const p = await ctx.db.get(job.disbursementId);
    if (p && p.status !== 'executed') {
      await ctx.db.patch(p._id, { relayTaskId: args.providerId ?? job.providerId, txHash: args.txHash ?? job.txHash, relayStatus: args.status === 'exception' ? 'Needs investigation' : 'Submitted', relayError: args.error, updatedAt: Date.now() });
    }
  },
});
export const recover = internalMutation({ args: {}, handler: async ctx => {
  for (const status of ['prepared', 'submitting', 'submitted'] as const) {
    const jobs = await ctx.db.query('relayJobs').withIndex('by_status_updated', q => q.eq('status', status)).take(20);
    for (const job of jobs) {
      if (job.attempts >= 120) {
        const error = job.status === 'prepared' ? 'The payment service remained unavailable. No submission was attempted.' : 'Confirmation window exceeded. Check the original payment before taking further action.';
        await ctx.db.patch(job._id, { status: 'exception', neverSubmitted: job.status === 'prepared', error, updatedAt: Date.now() });
        await ctx.db.patch(job.disbursementId, { relayStatus: 'Needs investigation', relayError: error, updatedAt: Date.now() });
      } else {
        // Rotate the bounded queue even if a scheduled worker is delayed.
        await ctx.db.patch(job._id, { updatedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.relayExecutor.process, { jobId: job._id });
      }
    }
  }
} });

// Waiting for an earlier Safe nonce or a transient provider outage is not a failed payment.
export const deferScheduled = internalMutation({
  args: { disbursementId: v.id('disbursements'), scheduledVersion: v.number(), attempt: v.number() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.disbursementId);
    if (!p || p.status !== 'scheduled' || p.scheduledVersion !== args.scheduledVersion) return;
    if (args.attempt >= 120) {
      await ctx.db.patch(p._id, { status: 'failed', relayStatus: 'Needs review', relayError: 'The payment could not be submitted within one hour of retries. Review approvals and payment service availability.', updatedAt: Date.now() });
      return;
    }
    await ctx.db.patch(p._id, { relayStatus: 'Waiting to submit', relayError: 'Waiting for account approvals, earlier account transactions, or the payment service. We will retry automatically.', updatedAt: Date.now() });
    await ctx.scheduler.runAfter(30000, internal.relayExecutor.fire, { ...args, attempt: args.attempt + 1 });
  },
});

export const paymentStatus = query({ args: { disbursementId: v.id('disbursements'), sessionToken: v.string() }, handler: async (ctx, args) => {
  const payment = await ctx.db.get(args.disbursementId);
  if (!payment) throw new Error('Payment not found');
  await requireOrgAccess(ctx, payment.orgId, args.sessionToken, ['admin', 'approver', 'initiator', 'clerk', 'viewer']);
  const job = await ctx.db.query('relayJobs').withIndex('by_payment', q => q.eq('disbursementId', payment._id)).first();
  return job ? { canResume: job.status === 'exception' && job.neverSubmitted === true, status: payment.status === 'executed' ? 'confirmed' : job.status, updatedAt: job.updatedAt, error: payment.status === 'executed' ? undefined : job.error, txHash: job.txHash } : null;
} });

export const recheck = mutation({ args: { disbursementId: v.id('disbursements'), sessionToken: v.string() }, handler: async (ctx, args) => {
  const payment = await ctx.db.get(args.disbursementId);
  if (!payment) throw new Error('Payment not found');
  const { user } = await requireOrgAccess(ctx, payment.orgId, args.sessionToken, ['admin', 'approver', 'initiator']);
  const job = await ctx.db.query('relayJobs').withIndex('by_payment', q => q.eq('disbursementId', payment._id)).first();
  if (!job) throw new Error('No managed submission exists for this payment');
  if (payment.status === 'executed') return;
  if (job.neverSubmitted) throw new Error('This payment was never submitted. Resume the approved payment instead.');
  if (job.status === 'prepared') throw new Error('The original submission is still being prepared');
  // Reconciliation only. Never reset to prepared or issue another provider request.
  await ctx.db.patch(job._id, { status: 'submitted', attempts: 0, error: undefined, updatedAt: Date.now() });
  await ctx.db.patch(payment._id, { relayStatus: 'Checking settlement', relayError: undefined, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.relayExecutor.process, { jobId: job._id });
  await appendAudit(ctx, { orgId: payment.orgId, actorUserId: user._id, action: 'disbursement.settlement_recheck', objectType: 'disbursement', objectId: payment._id, timestamp: Date.now(), metadata: { jobId: job._id } });
} });

export const deferPreparation = internalMutation({
  args: { jobId: v.id('relayJobs') },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'prepared') return;
    const error = 'The payment service is unavailable. No submission has been attempted. We will retry automatically.';
    await ctx.db.patch(job._id, { attempts: job.attempts + 1, error, updatedAt: Date.now() });
    await ctx.db.patch(job.disbursementId, { relayStatus: 'Waiting to submit', relayError: error, updatedAt: Date.now() });
  },
});

// Resume only when the durable worker never claimed a provider submission.
export const resume = mutation({
  args: { disbursementId: v.id('disbursements'), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error('Payment not found');
    const { user } = await requireOrgAccess(ctx, payment.orgId, args.sessionToken, ['admin', 'approver', 'initiator']);
    const job = await ctx.db.query('relayJobs').withIndex('by_payment', q => q.eq('disbursementId', payment._id)).first();
    if (!job || job.status !== 'exception' || !job.neverSubmitted || job.providerId || job.txHash || payment.status !== 'relaying')
      throw new Error('Only a payment that was never submitted can resume. Check settlement for an existing submission.');
    await assertPaymentMayProceed(ctx, payment);
    await assertMemberPaymentPolicy(ctx, payment.orgId, payment.createdBy, payment.token, payment.totalAmount ?? payment.amount ?? '0', Date.now(), payment._id);
    if (payment.delegatedBy && payment.delegatedBy !== payment.createdBy)
      await assertMemberPaymentPolicy(ctx, payment.orgId, payment.delegatedBy, payment.token, payment.totalAmount ?? payment.amount ?? '0', Date.now(), payment._id);
    const now = Date.now();
    await ctx.db.patch(job._id, { status: 'prepared', neverSubmitted: undefined, attempts: 0, error: undefined, updatedAt: now });
    await ctx.db.patch(payment._id, { relayStatus: 'Preparing submission', relayError: undefined, updatedAt: now });
    await appendAudit(ctx, { orgId: payment.orgId, actorUserId: user._id, action: 'disbursement.submission_resumed', objectType: 'disbursement', objectId: payment._id, timestamp: now });
    await ctx.scheduler.runAfter(0, internal.relayExecutor.process, { jobId: job._id });
  },
});
