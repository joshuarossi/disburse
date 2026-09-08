import { parseUnits } from 'viem';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { assetFields, type ReportRow } from './reportRows';
import { reportPeriods } from '../../shared/reportPeriods';

export async function ensureReportIndex(ctx: MutationCtx, orgId: Id<'orgs'>) {
  const state = await ctx.db.query('reportIndexStates').withIndex('by_org', q => q.eq('orgId', orgId)).unique();
  if (state) return state;
  const id = await ctx.db.insert('reportIndexStates', { orgId, stage: 'payments', pending: 0, revision: 0, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.reportIndex.backfill, { orgId });
  return (await ctx.db.get(id))!;
}

export async function queueReportSource(ctx: MutationCtx, orgId: Id<'orgs'>, kind: 'payment' | 'deposit' | 'outgoing' | 'fee' | 'treasury' | 'service', sourceId: Id<'disbursements'> | Id<'deposits'> | Id<'outgoingTransfers'> | Id<'circleExecutions'> | Id<'treasuryTransfers'> | Id<'treasuryServices'>) {
  const state = await ensureReportIndex(ctx, orgId);
  const sourceKey = `${kind}:${sourceId}`;
  const existing = await ctx.db.query('reportIndexJobs').withIndex('by_source', q => q.eq('sourceKey', sourceKey)).unique();
  if (existing) {
    await ctx.db.patch(existing._id, { nextAt: Date.now(), error: undefined, hasError: false });
    await ctx.db.patch(state._id, { revision: state.revision + 1, updatedAt: Date.now() });
    return;
  }
  const jobId = await ctx.db.insert('reportIndexJobs', { orgId, sourceId, sourceKey, kind, nextAt: Date.now() + 60_000, attempts: 0, hasError: false });
  await ctx.db.patch(state._id, { pending: state.pending + 1, revision: state.revision + 1, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.reportIndex.runJob, { jobId });
}

/** Replace one source and apply only its exact aggregate deltas in the same transaction. */
export async function replaceReportRows(ctx: MutationCtx, job: Doc<'reportIndexJobs'>, rows: ReportRow[]) {
  const old = await ctx.db.query('reportEntries').withIndex('by_source', q => q.eq('sourceKey', job.sourceKey)).take(503);
  if (old.length > 502) throw new Error('Report source contains more rows than its bounded replacement allows');
  const deltas = new Map<string, { row: ReportRow; dimension: string; period: string; inflow: bigint; outflow: bigint; count: number }>();
  const catalogs = new Map<string, { row: ReportRow; count: number; first: number; last: number }>();
  const recipientCatalogs = new Map<string, { row: ReportRow; count: number }>();
  for (const [source, sign] of [[old, -1], [rows, 1]] as const) {
    for (const row of source) {
      if (!Number.isFinite(row.createdAt) || row.createdAt < 0) throw new Error('A recorded transaction has an invalid date');
      const cat = catalogs.get(row.assetId) ?? { row, count: 0, first: row.createdAt, last: row.createdAt };
      cat.count += sign; cat.first = Math.min(cat.first, row.createdAt); cat.last = Math.max(cat.last, row.createdAt);
      catalogs.set(row.assetId, cat);
      if (!row.includedInTotals) continue;
      const dimensions = ['all'];
      if (row.kind === 'payment' && row.beneficiaryId) {
        dimensions.push(`recipient:${row.beneficiaryId}`);
        const key = `${row.beneficiaryId}:${row.assetId}`;
        const recipient = recipientCatalogs.get(key) ?? { row, count: 0 };
        recipient.count += sign; recipientCatalogs.set(key, recipient);
      }
      for (const dimension of dimensions) for (const period of reportPeriods(row.createdAt)) {
        const key = `${dimension}:${period}:${row.assetId}`;
        const delta = deltas.get(key) ?? { row, dimension, period, inflow: 0n, outflow: 0n, count: 0 };
        delta[row.direction] += BigInt(sign) * parseUnits(row.amount, row.decimals!);
        delta.count += sign; deltas.set(key, delta);
      }
    }
  }
  for (const { row, dimension, period, inflow, outflow, count } of deltas.values()) {
    if (!inflow && !outflow && !count) continue;
    const existing = await ctx.db.query('reportTotals').withIndex('by_bucket', q => q.eq('orgId', job.orgId)
      .eq('environment', row.environment).eq('dimension', dimension).eq('period', period).eq('assetId', row.assetId)).unique();
    const values = { inflowRaw: String(BigInt(existing?.inflowRaw ?? '0') + inflow), outflowRaw: String(BigInt(existing?.outflowRaw ?? '0') + outflow), count: (existing?.count ?? 0) + count };
    if (values.count < 0 || BigInt(values.inflowRaw) < 0n || BigInt(values.outflowRaw) < 0n) throw new Error('Report aggregate would become negative');
    if (existing) {
      if (!values.count) await ctx.db.delete(existing._id); else await ctx.db.patch(existing._id, values);
    } else if (values.count) await ctx.db.insert('reportTotals', { orgId: job.orgId, dimension, period, ...assetFields(row), ...values });
  }
  for (const { row, count, first, last } of catalogs.values()) {
    const existing = await ctx.db.query('reportAssets').withIndex('by_asset', q => q.eq('orgId', job.orgId).eq('assetId', row.assetId)).unique();
    const value = { count: (existing?.count ?? 0) + count, firstAt: Math.min(existing?.firstAt ?? first, first), lastAt: Math.max(existing?.lastAt ?? last, last) };
    if (value.count < 0) throw new Error('Report asset count would become negative');
    if (existing) {
      if (value.count) await ctx.db.patch(existing._id, value); else await ctx.db.delete(existing._id);
    }
    else await ctx.db.insert('reportAssets', { orgId: job.orgId, unclassified: !row.recognized || row.environment === 'unclassified', ...assetFields(row), ...value });
  }
  for (const { row, count } of recipientCatalogs.values()) {
    const existing = await ctx.db.query('reportRecipientAssets').withIndex('by_recipient_asset', q => q.eq('orgId', job.orgId).eq('beneficiaryId', row.beneficiaryId!).eq('assetId', row.assetId)).unique();
    const value = (existing?.count ?? 0) + count;
    if (value < 0) throw new Error('Report recipient count would become negative');
    if (existing) {
      if (value) await ctx.db.patch(existing._id, { count: value }); else await ctx.db.delete(existing._id);
    }
    else await ctx.db.insert('reportRecipientAssets', { orgId: job.orgId, beneficiaryId: row.beneficiaryId!, ...assetFields(row), count: value });
  }
  // Avoid replacing unchanged rows: pagination boundaries and row identity remain stable on retries.
  const previous = new Map(old.map(row => [row.rowId, row]));
  for (const row of rows) {
    const existing = previous.get(row.rowId);
    const value = { orgId: job.orgId, sourceKey: job.sourceKey, unclassified: !row.recognized || row.environment === 'unclassified', ...row };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert('reportEntries', value);
    previous.delete(row.rowId);
  }
  for (const row of previous.values()) await ctx.db.delete(row._id);
  const state = await ensureReportIndex(ctx, job.orgId);
  await ctx.db.patch(state._id, { pending: Math.max(0, state.pending - 1), revision: state.revision + 1, updatedAt: Date.now(),
    firstAt: rows.length ? Math.min(state.firstAt ?? Infinity, ...rows.map(row => row.createdAt)) : state.firstAt });
  await ctx.db.delete(job._id);
}
