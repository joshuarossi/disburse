import { v } from 'convex/values';
import { internalAction, internalMutation, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { requireOrgAccess } from './lib/rbac';
import { ensureReportIndex, queueReportSource, replaceReportRows } from './lib/reportIndex';
import { depositReportRows, paymentReportRows, outgoingReportRows } from './lib/reportRows';
import type { Id } from './_generated/dataModel';
import { reportPage } from './lib/reportPagination';
import { matchOutgoingPayment } from './lib/outgoingTransfers';
import { circleFeeReportRows, hasCircleFeeProof } from './lib/circleFeeReports';
import { treasuryReportRows } from './lib/treasuryReports';

export const refresh = mutation({
  args: { orgId: v.id('orgs'), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, ['admin', 'approver', 'initiator', 'clerk', 'viewer']);
    const state = await ensureReportIndex(ctx, args.orgId);
    if (state.stage !== 'done') await ctx.scheduler.runAfter(0, internal.reportIndex.backfill, { orgId: args.orgId });
    const jobs = await ctx.db.query('reportIndexJobs').withIndex('by_org_error', q => q.eq('orgId', args.orgId).eq('hasError', true)).take(20);
    for (const job of jobs) { await ctx.db.patch(job._id, { nextAt: Date.now() + 60_000 }); await ctx.scheduler.runAfter(0, internal.reportIndex.runJob, { jobId: job._id }); }
    return { retrying: jobs.length, indexing: state.stage !== 'done' || state.pending > 0 };
  },
});
export const backfill = internalMutation({
  args: { orgId: v.id('orgs') },
  handler: async (ctx, { orgId }) => {
    const state = await ensureReportIndex(ctx, orgId);
    if (state.stage === 'done') return;
    const payments = state.stage === 'payments';
    const result = payments
      ? await ctx.db.query('disbursements').withIndex('by_org', q => q.eq('orgId', orgId)).paginate(reportPage(state.cursor, 25))
      : state.stage === 'deposits' ? await ctx.db.query('deposits').withIndex('by_org', q => q.eq('orgId', orgId)).paginate(reportPage(state.cursor, 25))
      : state.stage === 'outgoing' ? await ctx.db.query('outgoingTransfers').withIndex('by_org', q => q.eq('orgId', orgId)).paginate(reportPage(state.cursor, 25))
      : state.stage === 'fees' ? await ctx.db.query('circleExecutions').withIndex('by_org', q => q.eq('orgId', orgId)).paginate(reportPage(state.cursor, 25))
      : await ctx.db.query('treasuryTransfers').withIndex('by_org', q => q.eq('orgId', orgId)).paginate(reportPage(state.cursor, 25));
    for (const source of result.page) await queueReportSource(ctx, orgId, payments ? 'payment' : state.stage === 'deposits' ? 'deposit' : state.stage === 'outgoing' ? 'outgoing' : state.stage === 'fees' ? 'fee' : 'treasury', source._id);
    const stage = result.isDone ? payments ? 'deposits' : state.stage === 'deposits' ? 'outgoing' : state.stage === 'outgoing' ? 'fees' : state.stage === 'fees' ? 'treasury' : 'done' : state.stage;
    await ctx.db.patch(state._id, { stage, cursor: result.isDone ? undefined : result.continueCursor,
      completeAt: stage === 'done' ? Date.now() : undefined, updatedAt: Date.now() });
    if (stage !== 'done') await ctx.scheduler.runAfter(100, internal.reportIndex.backfill, { orgId });
  },
});
export const processJob = internalMutation({
  args: { jobId: v.id('reportIndexJobs') },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    const source = await ctx.db.get(job.sourceId);
    if (source && source.orgId !== job.orgId) throw new Error('Report source belongs to another workspace');
    if (job.kind === 'payment') {
      const payment = await ctx.db.get(job.sourceId as Id<'disbursements'>);
      if (payment) {
        const matched = await matchOutgoingPayment(ctx, payment);
        // Replace previously shown transfers and their payment context atomically.
        for (const id of matched) {
          const transferJob = await ctx.db.query('reportIndexJobs').withIndex('by_source', q => q.eq('sourceKey', `outgoing:${id}`)).unique();
          if (transferJob) await replaceReportRows(ctx, transferJob, []);
        }
      }
    }
    if (job.kind === 'fee') {
      const execution = await ctx.db.get(job.sourceId as Id<'circleExecutions'>);
      if (execution && hasCircleFeeProof(execution)) {
        // Remove the two gross projections in the same transaction that adds
        // their net fee. Later transfer syncs also consult the settled proof.
        for (const direction of ['prefund', 'refund'] as const) {
          const proof = execution.feeProof![direction];
          if (!proof) continue;
          const transferId = `e${execution.txHash!.slice(2).toLowerCase()}${proof.logIndex}`;
          const transfer = direction === 'prefund'
            ? await ctx.db.query('outgoingTransfers').withIndex('by_safe_transfer', q => q.eq('safeId', execution.safeId).eq('transferId', transferId)).unique()
            : await ctx.db.query('deposits').withIndex('by_safe_transfer', q => q.eq('safeId', execution.safeId).eq('transferId', transferId)).unique();
          if (!transfer || transfer.orgId !== job.orgId) continue;
          const kind = direction === 'prefund' ? 'outgoing' as const : 'deposit' as const;
          await queueReportSource(ctx, job.orgId, kind, transfer._id);
          const transferJob = (await ctx.db.query('reportIndexJobs').withIndex('by_source', q => q.eq('sourceKey', `${kind}:${transfer._id}`)).unique())!;
          const transferRows = direction === 'prefund' ? await outgoingReportRows(ctx, transfer._id as Id<'outgoingTransfers'>) : await depositReportRows(ctx, transfer._id as Id<'deposits'>);
          await replaceReportRows(ctx, transferJob, transferRows);
        }
      }
    }
    if (job.kind === 'treasury') {
      for (const row of await treasuryReportRows(ctx, job.sourceId as Id<'treasuryTransfers'>)) {
        const transfer = row.direction === 'outflow'
          ? await ctx.db.query('outgoingTransfers').withIndex('by_safe_transfer', q => q.eq('safeId', row.safeId).eq('transferId', row.transferId!)).unique()
          : await ctx.db.query('deposits').withIndex('by_safe_transfer', q => q.eq('safeId', row.safeId).eq('transferId', row.transferId)).unique();
        if (!transfer || transfer.orgId !== job.orgId) continue;
        const kind = row.direction === 'outflow' ? 'outgoing' as const : 'deposit' as const;
        await queueReportSource(ctx, job.orgId, kind, transfer._id);
        const transferJob = (await ctx.db.query('reportIndexJobs').withIndex('by_source', q => q.eq('sourceKey', `${kind}:${transfer._id}`)).unique())!;
        const transferRows = row.direction === 'outflow' ? await outgoingReportRows(ctx, transfer._id as Id<'outgoingTransfers'>) : await depositReportRows(ctx, transfer._id as Id<'deposits'>);
        await replaceReportRows(ctx, transferJob, transferRows);
      }
    }
    const rows = job.kind === 'payment' ? await paymentReportRows(ctx, job.sourceId as Id<'disbursements'>)
      : job.kind === 'deposit' ? await depositReportRows(ctx, job.sourceId as Id<'deposits'>)
      : job.kind === 'fee' ? await circleFeeReportRows(ctx, job.sourceId as Id<'circleExecutions'>)
      : job.kind === 'treasury' ? await treasuryReportRows(ctx, job.sourceId as Id<'treasuryTransfers'>)
      : await outgoingReportRows(ctx, job.sourceId as Id<'outgoingTransfers'>);
    await replaceReportRows(ctx, job, rows);
  },
});
export const failJob = internalMutation({
  args: { jobId: v.id('reportIndexJobs'), error: v.string() },
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get(jobId);
    if (job) await ctx.db.patch(jobId, { attempts: job.attempts + 1, hasError: true, error: error.slice(0, 240), nextAt: Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(job.attempts, 6)) });
  },
});
export const runJob = internalAction({
  args: { jobId: v.id('reportIndexJobs') },
  handler: async (ctx, args) => {
    try { await ctx.runMutation(internal.reportIndex.processJob, args); }
    catch (error) { await ctx.runMutation(internal.reportIndex.failJob, { ...args, error: error instanceof Error ? error.message : 'The report index could not be updated' }); }
  },
});
export const recover = internalMutation({
  args: {}, handler: async ctx => {
    const maintenance = await ctx.db.query('reportMaintenance').withIndex('by_key', q => q.eq('key', 'orgs')).unique();
    const orgs = await ctx.db.query('orgs').paginate(reportPage(maintenance?.cursor, 25));
    for (const org of orgs.page) {
      const state = await ensureReportIndex(ctx, org._id);
      if (state.stage !== 'done' && state.updatedAt < Date.now() - 120_000) await ctx.scheduler.runAfter(0, internal.reportIndex.backfill, { orgId: org._id });
    }
    const value = { cursor: orgs.isDone ? undefined : orgs.continueCursor };
    if (maintenance) await ctx.db.patch(maintenance._id, value); else await ctx.db.insert('reportMaintenance', { key: 'orgs', ...value });
    const jobs = await ctx.db.query('reportIndexJobs').withIndex('by_due', q => q.lte('nextAt', Date.now())).take(20);
    for (const job of jobs) { await ctx.db.patch(job._id, { nextAt: Date.now() + 120_000 }); await ctx.scheduler.runAfter(0, internal.reportIndex.runJob, { jobId: job._id }); }
  },
});
