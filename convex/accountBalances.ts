import { ORG_READER_ROLES } from '../shared/roles';
import { v } from 'convex/values';
import { erc20Abi, parseUnits, type Address } from 'viem';
import { action, internalMutation, internalQuery, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireOrgAccess } from './lib/rbac';
import { getChainClient } from './lib/safeVerification';
import { reportPage } from './lib/reportPagination';
import { balancePeriod, balanceProof, blockBefore, validateBalanceBlock, type ChainBlock } from './lib/balanceProof';
import { CHAIN_TOKENS, type SupportedChainId } from '../shared/chains';
import { chainEnvironment } from '../shared/assets';
import { appendAudit } from './audit';


const reviewers: typeof ORG_READER_ROLES = ['admin', 'approver', 'clerk'];
async function historicalRead<T>(read: () => Promise<T>, checkpoint = 'network'): Promise<T> {
  try { return await read(); }
  catch (error) {
    console.warn('Historical read unavailable', { checkpoint, error: error instanceof Error ? error.name : 'UnknownError' });
    throw new Error('Historical network data is unavailable. No balance check was saved. Try the check again shortly.');
  }
}
const request = { orgId: v.id('orgs'), safeId: v.id('safes'), token: v.string(), sessionToken: v.string(), startDate: v.string(), endDate: v.string() };
async function reportVersion(ctx: QueryCtx, orgId: Id<'orgs'>, expected?: number) {
  const state = await ctx.db.query('reportIndexStates').withIndex('by_org', q => q.eq('orgId', orgId)).unique();
  const error = await ctx.db.query('reportIndexJobs').withIndex('by_org_error', q => q.eq('orgId', orgId).eq('hasError', true)).first();
  if (!state || state.stage !== 'done' || state.pending || error) throw new Error('Finish refreshing account history in Transactions before checking balances');
  if (expected !== undefined && state.revision !== expected) throw new Error('Account history changed during this check. Run it again with the refreshed history.');
  return state.revision;
}
export const context = internalQuery({ args: request, handler: async (ctx, args) => {
  await requireOrgAccess(ctx, args.orgId, args.sessionToken, reviewers);
  const safe = await ctx.db.get(args.safeId);
  if (!safe || safe.orgId !== args.orgId) throw new Error('Choose an account in this workspace');
  const tokens = Object.values(CHAIN_TOKENS[safe.chainId as SupportedChainId] ?? {});
  const token = tokens.find(t => t.symbol === args.token);
  const environment = chainEnvironment(safe.chainId);
  if (!token || environment === 'unclassified') throw new Error('Choose a supported account currency');
  const period = balancePeriod(args.startDate, args.endDate);
  const history = await ctx.db.query('depositSyncs').withIndex('by_safe', q => q.eq('safeId', args.safeId)).unique();
  if (!history?.lastFullScanAt || history.historyScope !== 'all' || (history.completedThrough ?? 0) < period.through)
    throw new Error('Refresh this account’s complete incoming and outgoing history through the end of the period first');
  return { safe, token, environment, ...period, historyThrough: history.completedThrough!, revision: await reportVersion(ctx, args.orgId) };
} });
export const movements = internalQuery({ args: { ...request, revision: v.number(), cursor: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireOrgAccess(ctx, args.orgId, args.sessionToken, reviewers);
  await reportVersion(ctx, args.orgId, args.revision);
  const safe = await ctx.db.get(args.safeId);
  if (!safe || safe.orgId !== args.orgId) throw new Error('Account not found');
  const token = Object.values(CHAIN_TOKENS[safe.chainId as SupportedChainId] ?? {}).find(t => t.symbol === args.token);
  if (!token) throw new Error('Unsupported account currency');
  const { from, through } = balancePeriod(args.startDate, args.endDate);
  return ctx.db.query('reportEntries').withIndex('by_account_asset_time', q => q.eq('orgId', args.orgId).eq('safeId', args.safeId)
    .eq('assetId', `${safe.chainId}:${token.address.toLowerCase()}`).gte('createdAt', from).lt('createdAt', through)).paginate(reportPage(args.cursor, 100));
} });
export const save = internalMutation({ args: { orgId: v.id('orgs'), sessionToken: v.string(), ...balanceProof }, handler: async (ctx, args) => {
  const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, reviewers);
  await reportVersion(ctx, args.orgId, args.reportRevision);
  const { sessionToken, ...proof } = args; void sessionToken;
  const id = await ctx.db.insert('accountBalanceChecks', { ...proof, checkedBy: user._id, checkedAt: Date.now() });
  await appendAudit(ctx, { orgId: args.orgId, actorUserId: user._id, action: 'accounting.balance_checked', objectType: 'accounting',
    objectId: id, timestamp: Date.now(), metadata: { safeId: args.safeId, startDate: args.startDate, endDate: args.endDate, status: args.status } });
  return id;
} });
export const check = action({ args: request, handler: async (ctx, args): Promise<Id<'accountBalanceChecks'>> => {
  const source = await ctx.runQuery(internal.accountBalances.context, args);
  const { safe, token } = source, client = getChainClient(safe.chainId, { historical: true });
  if (await historicalRead(() => client.getChainId()) !== safe.chainId) throw new Error('The account network could not be verified');
  const readBlock = async (number: bigint): Promise<ChainBlock> => {
    const row = await historicalRead(() => client.getBlock({ blockNumber: number }), String(number));
    if (row.number === null || !row.hash) throw new Error('The network block is unavailable');
    return validateBalanceBlock({ number: row.number, hash: row.hash, timestamp: row.timestamp }, number);
  };
  const finalized = await historicalRead(() => client.getBlock({ blockTag: 'finalized' }));
  if (finalized.number === null || !finalized.hash) throw new Error('Finalized network history is currently unavailable');
  const head = { number: finalized.number, hash: finalized.hash, timestamp: finalized.timestamp };
  const lookups = new Map<bigint, Promise<ChainBlock>>();
  const lookup = (number: bigint) => {
    if (!lookups.has(number)) lookups.set(number, readBlock(number));
    return lookups.get(number)!;
  };
  const opening = await blockBefore(lookup, head, source.from);
  const closing = await blockBefore(lookup, head, source.through);
  const balanceAt = async (block: ChainBlock) => {
    // No deployed token at the checkpoint means no units existed yet. An RPC
    // error is never interpreted as a zero balance.
    const code = await client.getBytecode({ address: token.address, blockNumber: block.number });
    return !code || code === '0x' ? 0n : client.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf',
      args: [safe.safeAddress as Address], blockNumber: block.number });
  };
  let openingBalance: bigint, closingBalance: bigint;
  try { [openingBalance, closingBalance] = await Promise.all([balanceAt(opening), balanceAt(closing)]); }
  catch { throw new Error('Historical balances are unavailable for this period. No balance check was saved. Try again when account history is available.'); }
  let inflow = 0n, outflow = 0n, unresolvedCount = 0, cursor: string | undefined, done = false, movementCount = 0;
  const seen = new Set<string>();
  for (let count = 0; !done && count < 500; count++) {
    const page = await ctx.runQuery(internal.accountBalances.movements, { ...args, revision: source.revision, cursor });
    for (const row of page.page) {
      if (!row.includedInTotals || !row.transferId || !row.blockNumber || row.dateSource === 'recorded') { unresolvedCount++; continue; }
      const block = BigInt(row.blockNumber);
      if (block <= opening.number || block > closing.number || seen.has(row.transferId)) { unresolvedCount++; continue; }
      seen.add(row.transferId); movementCount++;
      const raw = BigInt(row.amountRaw ?? parseUnits(row.amount, token.decimals));
      if (raw < 0n) throw new Error('A historical movement has an invalid quantity');
      if (row.direction === 'inflow') inflow += raw; else outflow += raw;
    }
    cursor = page.continueCursor; done = page.isDone;
  }
  if (!done) throw new Error('This period exceeds 50,000 movements. Check a shorter period.');
  const [openingAgain, closingAgain] = await Promise.all([readBlock(opening.number), readBlock(closing.number)]);
  if (openingAgain.hash !== opening.hash || closingAgain.hash !== closing.hash) throw new Error('Network block evidence changed during this check. Try again.');
  const difference = closingBalance - (openingBalance + inflow - outflow);
  const checkpoint = (block: ChainBlock, balance: bigint) => ({ blockNumber: String(block.number), blockHash: block.hash.toLowerCase(), timestamp: Number(block.timestamp) * 1000, balanceRaw: String(balance) });
  return ctx.runMutation(internal.accountBalances.save, { orgId: args.orgId, sessionToken: args.sessionToken, safeId: safe._id,
    chainId: safe.chainId, token: token.symbol, tokenAddress: token.address.toLowerCase(), decimals: token.decimals,
    accountName: safe.name ?? 'Company account', accountAddress: safe.safeAddress, environment: source.environment,
    startDate: args.startDate, endDate: args.endDate, opening: checkpoint(opening, openingBalance), closing: checkpoint(closing, closingBalance),
    inflowRaw: String(inflow), outflowRaw: String(outflow), differenceRaw: String(difference), movementCount, unresolvedCount,
    reportRevision: source.revision, historyThrough: source.historyThrough, status: difference === 0n && !unresolvedCount ? 'matched' : 'needs_review' });
} });
export const list = query({ args: { orgId: v.id('orgs'), sessionToken: v.string(), environment: v.union(v.literal('production'), v.literal('test')) }, handler: async (ctx, args) => {
  await requireOrgAccess(ctx, args.orgId, args.sessionToken, ORG_READER_ROLES);
  return ctx.db.query('accountBalanceChecks').withIndex('by_org_environment', q => q.eq('orgId', args.orgId).eq('environment', args.environment)).order('desc').take(20);
} });
