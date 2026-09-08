import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { formatUnits } from "viem";
import { assetFields } from "./lib/reportRows";
import { reportPage } from "./lib/reportPagination";
import { reportRangePeriods } from "../shared/reportPeriods";
import { environmentValidator } from "./lib/activityEnvironment";
import type { ActivityEnvironment } from "../shared/assets";

const reportFilters = {
  orgId: v.id("orgs"), sessionToken: v.string(), startDate: v.optional(v.number()), endDate: v.optional(v.number()),
  chainId: v.optional(v.number()), chainIds: v.optional(v.array(v.number())), environment: v.optional(environmentValidator),
  cursor: v.optional(v.string()), pageSize: v.optional(v.number()), snapshotVersion: v.optional(v.number()),
};
type Scope = { orgId: Id<'orgs'>; sessionToken: string; startDate?: number; endDate?: number; chainId?: number; chainIds?: number[]; environment?: ActivityEnvironment; snapshotVersion?: number };
async function reportState(ctx: QueryCtx, args: Scope) {
  await requireOrgAccess(ctx, args.orgId, args.sessionToken, ['admin', 'approver', 'initiator', 'clerk', 'viewer']);
  const state = await ctx.db.query('reportIndexStates').withIndex('by_org', q => q.eq('orgId', args.orgId)).unique();
  const errors = await ctx.db.query('reportIndexJobs').withIndex('by_org_error', q => q.eq('orgId', args.orgId).eq('hasError', true)).take(3);
  const indexing = !state || state.stage !== 'done' || state.pending > 0;
  if (args.snapshotVersion !== undefined && (indexing || args.snapshotVersion !== state?.revision))
    throw new Error('Report activity changed during export. Refresh the report and try again.');
  let periods: string[] = [], rangeError = '';
  try { periods = reportRangePeriods(args.startDate, args.endDate, state?.firstAt); }
  catch (e) { rangeError = e instanceof Error ? e.message : 'Choose a valid date range'; }
  return { periods, rangeError, indexing, indexVersion: state?.revision ?? 0, indexErrors: errors.map(e => e.error ?? 'Report indexing is delayed') };
}
function chainMatches(row: { chainId?: number }, args: Scope) {
  return (args.chainId === undefined || row.chainId === args.chainId) && (!args.chainIds?.length || (row.chainId !== undefined && args.chainIds.includes(row.chainId)));
}
function totalShape(asset: Doc<'reportTotals'>, inflow: bigint, outflow: bigint) {
  return { ...assetFields(asset), amount: formatUnits(inflow + outflow, asset.decimals!), inflow: formatUnits(inflow, asset.decimals!),
    outflow: formatUnits(outflow, asset.decimals!), net: formatUnits(inflow - outflow, asset.decimals!) };
}

export const getTransactionReport = query({
  args: { ...reportFilters, status: v.optional(v.array(v.string())), beneficiaryId: v.optional(v.id('beneficiaries')),
    token: v.optional(v.array(v.string())), assetIds: v.optional(v.array(v.string())), assetSearch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const state = await reportState(ctx, args);
    const environment = args.environment ?? 'production';
    const from = state.rangeError ? 0 : args.startDate ?? 0;
    const through = state.rangeError || args.endDate === undefined ? Number.MAX_SAFE_INTEGER : args.endDate + 86400000;
    const base = environment === 'unclassified'
      ? ctx.db.query('reportEntries').withIndex('by_org_unclassified_time', q => q.eq('orgId', args.orgId).eq('unclassified', true).gte('createdAt', from).lt('createdAt', through))
      : args.beneficiaryId
      ? ctx.db.query('reportEntries').withIndex('by_org_environment_recipient_time', q => q.eq('orgId', args.orgId).eq('environment', environment).eq('beneficiaryId', args.beneficiaryId)
        .gte('createdAt', from).lt('createdAt', through))
      : args.assetIds?.length === 1
        ? ctx.db.query('reportEntries').withIndex('by_org_asset_time', q => q.eq('orgId', args.orgId).eq('assetId', args.assetIds![0]).gte('createdAt', from).lt('createdAt', through))
      : args.token?.length === 1
        ? ctx.db.query('reportEntries').withIndex('by_org_environment_token_time', q => q.eq('orgId', args.orgId).eq('environment', environment).eq('token', args.token![0]).gte('createdAt', from).lt('createdAt', through))
      : args.chainId !== undefined
        ? ctx.db.query('reportEntries').withIndex('by_org_environment_chain_time', q => q.eq('orgId', args.orgId).eq('environment', environment).eq('chainId', args.chainId).gte('createdAt', from).lt('createdAt', through))
      : ctx.db.query('reportEntries').withIndex('by_org_environment_time', q => q.eq('orgId', args.orgId).eq('environment', environment)
        .gte('createdAt', from).lt('createdAt', through));
    // Indexed common filters plus an explicit read budget for combined filters.
    const page = await base.filter(q => q.and(
      environment === 'unclassified' ? q.eq(q.field('unclassified'), true) : q.eq(q.field('environment'), environment),
      args.beneficiaryId ? q.eq(q.field('beneficiaryId'), args.beneficiaryId) : true,
      args.chainId !== undefined ? q.eq(q.field('chainId'), args.chainId) : true,
      args.chainIds?.length ? q.or(...args.chainIds.map(id => q.eq(q.field('chainId'), id))) : true,
      args.status?.length ? q.or(...args.status.map(status => q.eq(q.field('status'), status))) : true,
      args.token?.length ? q.and(q.eq(q.field('recognized'), true), q.or(...args.token.map(token => q.eq(q.field('token'), token)))) : true,
      args.assetIds?.length ? q.or(...args.assetIds.map(asset => q.eq(q.field('assetId'), asset))) : true,
    )).order('desc').paginate(reportPage(args.cursor, args.pageSize ?? 100));
    const matches = page.page.filter(row => !state.rangeError && chainMatches(row, args)
      && (!args.beneficiaryId || row.beneficiaryId === args.beneficiaryId)
      && (!args.status?.length || args.status.includes(row.status))
      && (!args.token?.length || (row.recognized && args.token.includes(row.token)))
      && (!args.assetIds?.length || args.assetIds.includes(row.assetId)));
    const accounts = new Map(await Promise.all([...new Set(matches.map(row => row.safeId))].map(async id => [id, await ctx.db.get(id)] as const)));
    const items = await Promise.all(matches.map(async row => {
      const b = row.beneficiaryId ? await ctx.db.get(row.beneficiaryId) : null;
      const account = accounts.get(row.safeId);
      const knownAccount = account?.orgId === args.orgId && account.chainId === row.chainId && account.safeAddress.toLowerCase() === row.accountAddress.toLowerCase();
      return { ...row, _id: row.sourceId,
        accountName: knownAccount ? `${account.name || 'Account'}${account.isActive === false ? ' (archived)' : ''}` : 'Account',
        beneficiaryName: `${row.beneficiaryName}${b?.orgId === args.orgId && !b.isActive ? ' (archived)' : ''}` };
    }));
    const catalog = environment === 'unclassified'
      ? args.assetSearch
        ? await ctx.db.query('reportAssets').withIndex('by_org_unclassified_address', q => q.eq('orgId', args.orgId).eq('unclassified', true).eq('tokenAddress', args.assetSearch!.trim().toLowerCase())).take(101)
        : await ctx.db.query('reportAssets').withIndex('by_org_unclassified', q => q.eq('orgId', args.orgId).eq('unclassified', true)).take(101)
      : args.assetSearch
      ? await ctx.db.query('reportAssets').withIndex('by_org_environment_address', q => q.eq('orgId', args.orgId).eq('environment', environment).eq('tokenAddress', args.assetSearch!.trim().toLowerCase())).take(101)
      : await ctx.db.query('reportAssets').withIndex('by_org_environment', q => q.eq('orgId', args.orgId).eq('environment', environment)).take(101);
    const grouped = new Map<string, { asset: Doc<'reportTotals'>; inflow: bigint; outflow: bigint }>();
    const dimension = args.beneficiaryId ? `recipient:${args.beneficiaryId}` : 'all';
    for (const period of state.periods) {
      // Only recognized configured assets have aggregates. The registry has fewer
      // than 64 exact identities; refuse expansion beyond that bound explicitly.
      const totals = await ctx.db.query('reportTotals').withIndex('by_bucket', q => q.eq('orgId', args.orgId).eq('environment', environment).eq('dimension', dimension).eq('period', period)).take(65);
      if (totals.length > 64) throw new Error('This report exceeds the configured asset summary limit');
      for (const row of totals) {
        if (!chainMatches(row, args) || (args.token?.length && !args.token.includes(row.token)) || (args.assetIds?.length && !args.assetIds.includes(row.assetId))) continue;
        const total = grouped.get(row.assetId) ?? { asset: row, inflow: 0n, outflow: 0n };
        if (!args.status?.length || args.status.includes('received')) total.inflow += BigInt(row.inflowRaw);
        if (!args.status?.length || args.status.includes('executed')) total.outflow += BigInt(row.outflowRaw);
        grouped.set(row.assetId, total);
      }
    }
    return { items, totals: [...grouped.values()].map(({ asset, inflow, outflow }) => totalShape(asset, inflow, outflow)),
      environment, assets: catalog.slice(0, 100).filter(row => row.count > 0 && chainMatches(row, args)).map(assetFields), assetsTruncated: catalog.length > 100,
      excludedCount: items.filter(row => !row.includedInTotals).length, continueCursor: page.continueCursor, isDone: page.isDone, scanned: page.page.length,
      ...state };
  },
});

export const getSpendingByBeneficiary = query({
  args: { ...reportFilters, type: v.optional(v.union(v.literal('individual'), v.literal('business'))) },
  handler: async (ctx, args) => {
    const state = await reportState(ctx, args);
    const environment = args.environment ?? 'production';
    const page = await ctx.db.query('reportRecipientAssets').withIndex('by_org_environment', q => q.eq('orgId', args.orgId).eq('environment', environment))
      .paginate(reportPage(args.cursor, args.pageSize ?? 50));
    const items = [];
    for (const asset of page.page) {
      if (state.rangeError || !asset.count || !chainMatches(asset, args)) continue;
      const b = await ctx.db.get(asset.beneficiaryId);
      if (!b || b.orgId !== args.orgId || (args.type && (b.type ?? 'individual') !== args.type)) continue;
      let total = 0n, count = 0;
      for (const period of state.periods) {
        const row = await ctx.db.query('reportTotals').withIndex('by_bucket', q => q.eq('orgId', args.orgId).eq('environment', environment)
          .eq('dimension', `recipient:${b._id}`).eq('period', period).eq('assetId', asset.assetId)).unique();
        if (row) { total += BigInt(row.outflowRaw); count += row.count; }
      }
      if (!count) continue;
      items.push({ ...assetFields(asset), beneficiaryId: b._id, beneficiaryName: `${b.name}${!b.isActive ? ' (archived)' : ''}`,
        beneficiaryType: b.type ?? 'individual', beneficiaryWallet: b.walletAddress, transactionCount: count, totalPaid: formatUnits(total, asset.decimals!) });
    }
    return { items, continueCursor: page.continueCursor, isDone: page.isDone, scanned: page.page.length, ...state };
  },
});
