import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireOrgAccess } from './lib/rbac';
import { appendAudit } from './audit';
import { accountKind, accountingSource, bookCurrency, reviewInput } from './lib/accountingValidators';
import { accountingLocation, loadAccountingFact } from './lib/accountingSource';
import { assertPostingDate, buildSettlementJournal, bookUnits, formatBookUnits, type BookAccount, type JournalLine } from '../shared/accounting';
import { reportPage } from './lib/reportPagination';
import { chainEnvironment, identifyAsset } from '../shared/assets';
import { formatUnits } from 'viem';

const readers = ['admin', 'approver', 'initiator', 'clerk', 'viewer'] as const;
const accountants = ['admin', 'approver', 'clerk'] as const;
const access = { orgId: v.id('orgs'), sessionToken: v.string() };
const canonicalJson = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
    : item);
const environment = v.union(v.literal('production'), v.literal('test'));
const text = (value: string, label: string, max = 200, min = 1) => {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || [...trimmed].some(char => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char)))
    throw new Error(`${label} must contain ${min} to ${max} characters`);
  return trimmed;
};
async function profileFor(ctx: QueryCtx, orgId: Id<'orgs'>) {
  const profile = await ctx.db.query('accountingProfiles').withIndex('by_org', q => q.eq('orgId', orgId)).unique();
  if (!profile) throw new Error('Set up the accounting book and chart of accounts first');
  return profile;
}
async function bookAccount(ctx: QueryCtx, orgId: Id<'orgs'>, id?: Id<'accountingAccounts'>): Promise<BookAccount> {
  const row = id ? await ctx.db.get(id) : null;
  if (!row || row.orgId !== orgId || !row.active) throw new Error('Choose an active account from this workspace’s chart of accounts');
  return { id: row._id, externalId: row.externalId, name: row.name, kind: row.kind, version: row.version };
}
async function audit(ctx: MutationCtx, orgId: Id<'orgs'>, userId: Id<'users'>, action: string, objectId: string, metadata?: Parameters<typeof appendAudit>[1]['metadata']) {
  await appendAudit(ctx, { orgId, actorUserId: userId, action: `accounting.${action}`, objectType: 'accounting', objectId, metadata, timestamp: Date.now() });
}

export const configuration = query({
  args: access,
  handler: async (ctx, args) => {
    const { membership } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...readers]);
    const profile = await ctx.db.query('accountingProfiles').withIndex('by_org', q => q.eq('orgId', args.orgId)).unique();
    const accounts = await ctx.db.query('accountingAccounts').withIndex('by_org', q => q.eq('orgId', args.orgId)).take(1001);
    if (accounts.length > 1000) throw new Error('This chart exceeds the 1,000-account review limit');
    return { profile, accounts, canConfigure: membership.role === 'admin', canReview: accountants.some(role => role === membership.role) };
  },
});

export const configure = mutation({
  args: { ...access, currency: bookCurrency, bookName: v.string(), closedThrough: v.optional(v.string()),
    expectedVersion: v.number(), reopenReason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, ['admin']);
    const profile = await ctx.db.query('accountingProfiles').withIndex('by_org', q => q.eq('orgId', args.orgId)).unique();
    if ((profile?.version ?? 0) !== args.expectedVersion) throw new Error('Accounting settings changed. Reload before saving.');
    if (profile && profile.nextJournal > 1 && profile.currency !== args.currency)
      throw new Error('The functional currency cannot change after journals have been prepared');
    const closedThrough = args.closedThrough || undefined;
    if (closedThrough) assertPostingDate(closedThrough);
    if (profile?.closedThrough && (!closedThrough || closedThrough < profile.closedThrough))
      text(args.reopenReason ?? '', 'Reason for reopening the period', 500, 10);
    if (closedThrough && (!profile?.closedThrough || closedThrough > profile.closedThrough)) {
      for (const state of ['ready', 'exported'] as const) {
        const pending = await ctx.db.query('accountingEntries').withIndex('by_org_state_date', q => q.eq('orgId', args.orgId)
          .eq('state', state).lte('postingDate', closedThrough)).first();
        if (pending) throw new Error('Reconcile the prepared journals in this period before closing it');
      }
    }
    const fields = { currency: args.currency, bookName: text(args.bookName, 'Book name', 100), closedThrough, version: args.expectedVersion + 1, updatedAt: Date.now() };
    const id = profile?._id ?? await ctx.db.insert('accountingProfiles', { orgId: args.orgId, ...fields, nextJournal: 1 });
    if (profile) await ctx.db.patch(id, fields);
    await audit(ctx, args.orgId, user._id, 'configured', id, { ...fields, previousClosedThrough: profile?.closedThrough, reopenReason: args.reopenReason });
    return id;
  },
});

export const importAccounts = mutation({
  args: { ...access, expectedVersion: v.number(), accounts: v.array(v.object({ externalId: v.string(), name: v.string(), kind: accountKind, active: v.boolean() })) },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, ['admin']);
    const profile = await profileFor(ctx, args.orgId);
    if (profile.version !== args.expectedVersion) throw new Error('The chart changed. Refresh your import preview.');
    if (!args.accounts.length || args.accounts.length > 500) throw new Error('Import between 1 and 500 chart accounts at a time');
    const rows = args.accounts.map(row => ({ ...row, externalId: text(row.externalId, 'External account ID', 100), name: text(row.name, 'Exact account name', 200) }));
    if (new Set(rows.map(row => row.externalId)).size !== rows.length || new Set(rows.map(row => row.name.toLowerCase())).size !== rows.length)
      throw new Error('The chart contains duplicate account IDs or names');
    const existing = await ctx.db.query('accountingAccounts').withIndex('by_org', q => q.eq('orgId', args.orgId)).take(1001);
    const ids = new Set(existing.map(row => row.externalId));
    if (existing.length + rows.filter(row => !ids.has(row.externalId)).length > 1000) throw new Error('Use a chart of up to 1,000 accounts');
    const names = new Map(existing.filter(row => !rows.some(next => next.externalId === row.externalId)).map(row => [row.name.toLowerCase(), row.externalId]));
    if (rows.some(row => names.has(row.name.toLowerCase()))) throw new Error('An account name is already mapped to a different external ID');
    let changed = 0;
    for (const row of rows) {
      const previous = existing.find(old => old.externalId === row.externalId);
      if (previous && previous.name === row.name && previous.kind === row.kind && previous.active === row.active) continue;
      const fields = { ...row, version: (previous?.version ?? 0) + 1, updatedAt: Date.now() };
      if (previous) await ctx.db.patch(previous._id, fields);
      else await ctx.db.insert('accountingAccounts', { ...fields, orgId: args.orgId });
      changed++;
    }
    if (changed) await ctx.db.patch(profile._id, { version: profile.version + 1, updatedAt: Date.now() });
    await audit(ctx, args.orgId, user._id, 'chart_imported', profile._id, { changed, supplied: rows.length });
    return { changed };
  },
});

export const sourceDetails = query({
  args: { ...access, source: accountingSource },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...readers]);
    let fact;
    try { fact = await loadAccountingFact(ctx, args.orgId, args.source); }
    catch (error) {
      return { fact: null, entry: null, history: [], historyLimited: false, assetAccountId: undefined,
        error: error instanceof Error ? error.message : 'Settlement evidence could not be read' };
    }
    const movement = await ctx.db.query('accountingMovements').withIndex('by_movement', q => q.eq('orgId', args.orgId).eq('key', fact.key)).unique();
    const history = await ctx.db.query('accountingEntries').withIndex('by_movement', q => q.eq('orgId', args.orgId).eq('fact.key', fact.key)).order('desc').take(101);
    const mapping = await ctx.db.query('accountingMappings').withIndex('by_location', q => q.eq('orgId', args.orgId).eq('location', accountingLocation(fact))).unique();
    return { fact, entry: movement ? await ctx.db.get(movement.entryId) : null, history: history.slice(0, 100), historyLimited: history.length > 100, assetAccountId: mapping?.accountId, error: null };
  },
});

export const review = mutation({
  args: { ...access, ...reviewInput, expectedProfileVersion: v.number(), replaces: v.optional(v.id('accountingEntries')), correctionReason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...accountants]);
    const profile = await profileFor(ctx, args.orgId);
    if (profile.version !== args.expectedProfileVersion) throw new Error('The chart or accounting settings changed. Review the current mappings.');
    const fact = await loadAccountingFact(ctx, args.orgId, args.source);
    if (fact.fingerprint !== args.expectedFingerprint) throw new Error('The settlement evidence changed. Review the refreshed movement.');
    assertPostingDate(args.postingDate, profile.closedThrough);
    const bookReference = text(args.bookReference, 'Book / obligation reference', 200);
    const valuationEvidence = text(args.valuationEvidence, 'Book value evidence', 1000, 10);
    const memo = text(args.memo, 'Journal description', 500);
    const value = formatBookUnits(bookUnits(args.assetBookValue, profile.currency, args.treatment === 'already_recorded'), profile.currency);
    const receiptHasExcess = !!fact.invoiceExcessRaw && BigInt(fact.invoiceExcessRaw) > 0n;
    if (args.treatment === 'existing_receivable' && fact.invoiceAppliedRaw === '0')
      throw new Error('The invoice was already fully funded. Record this receipt as a customer advance or match its existing book entry.');
    const lines: JournalLine[] = args.treatment === 'already_recorded' ? [] : buildSettlementJournal({
      ...args, treatment: args.treatment, direction: fact.direction, companyTransfer: fact.companyTransfer, currency: profile.currency,
      assetAccount: await bookAccount(ctx, args.orgId, args.assetAccountId),
      counterAccount: await bookAccount(ctx, args.orgId, args.counterAccountId),
      differenceAccount: args.differenceAccountId ? await bookAccount(ctx, args.orgId, args.differenceAccountId) : undefined,
      receiptHasExcess, advanceBookValue: args.advanceBookValue,
      advanceAccount: args.advanceAccountId ? await bookAccount(ctx, args.orgId, args.advanceAccountId) : undefined,
    });
    const movement = await ctx.db.query('accountingMovements').withIndex('by_movement', q => q.eq('orgId', args.orgId).eq('key', fact.key)).unique();
    const previous = movement ? await ctx.db.get(movement.entryId) : null;
    const core = { fact, currency: profile.currency, treatment: args.treatment, postingDate: args.postingDate, assetBookValue: value,
      obligationBookValue: ['existing_payable', 'existing_receivable'].includes(args.treatment) && args.obligationBookValue
        ? formatBookUnits(bookUnits(args.obligationBookValue, profile.currency), profile.currency) : undefined,
      advanceBookValue: receiptHasExcess && args.treatment === 'existing_receivable' ? formatBookUnits(bookUnits(args.advanceBookValue ?? '', profile.currency), profile.currency) : undefined,
      bookReference, externalName: args.externalName?.trim() || undefined, valuationEvidence, memo, lines, profileVersion: profile.version };
    if (previous && (!args.replaces || previous.replaces === args.replaces)) {
      // An interrupted response can be retried without another journal number.
      if (canonicalJson(Object.keys(core).sort().map(k => previous[k as keyof typeof core])) === canonicalJson(Object.keys(core).sort().map(k => core[k as keyof typeof core])))
        return previous._id;
      throw new Error('This transfer is already reviewed. Open its existing reconciliation to make a linked correction.');
    }
    if (args.replaces && (!previous || previous._id !== args.replaces || previous.orgId !== args.orgId))
      throw new Error('The reconciliation changed. Reload before correcting it.');
    if (previous?.state === 'exported') throw new Error('Confirm whether the earlier export was imported before preparing its correction');
    let nextNumber = profile.nextJournal;
    const journalPrefix = fact.environment === 'test' ? 'DSB-TEST' : 'DSB';
    let reversalId: Id<'accountingEntries'> | undefined;
    if (previous) {
      const reason = text(args.correctionReason ?? '', 'Correction reason', 500, 10);
      if (previous.treatment === 'already_recorded') throw new Error('Correct the matched transaction in your book of record. It was not created by a Disburse journal.');
      if (args.treatment === 'already_recorded') throw new Error('A journal correction needs replacement journal lines');
      // Reversals have the exact original amounts, names and account mapping
      // snapshots. The accounting date must be open even if the original is closed.
      const { _id, _creationTime, ...originalFields } = previous;
      void _id; void _creationTime;
      if (previous.state === 'reconciled') reversalId = await ctx.db.insert('accountingEntries', { ...originalFields,
        orgId: args.orgId, journalNumber: `${journalPrefix}-${nextNumber++}`, postingDate: args.postingDate,
        memo: `Reversal of ${previous.journalNumber}: ${reason}`,
        lines: previous.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })),
        reviewedBy: user._id, reviewedAt: Date.now(), state: 'ready', reversalOf: previous._id,
        exportId: undefined, importedReference: undefined, reconciledAt: undefined, supersededBy: undefined, replaces: undefined, correctionReason: reason,
        pairedEntryId: undefined,
      });
      // Revising an unexported correction must keep the reversal of the posted
      // original paired with the latest replacement, with the same open date.
      if (previous.state === 'ready' && previous.pairedEntryId) {
        const reversal = await ctx.db.get(previous.pairedEntryId);
        if (!reversal || reversal.orgId !== args.orgId || !reversal.reversalOf || reversal.state !== 'ready' || reversal.exportId)
          throw new Error('The pending correction pair needs review before it can be changed');
        reversalId = reversal._id;
        await ctx.db.patch(reversalId, { postingDate: args.postingDate });
      }
    }
    const entryId = await ctx.db.insert('accountingEntries', { orgId: args.orgId, ...core, journalNumber: `${journalPrefix}-${nextNumber++}`,
      reviewedBy: user._id, reviewedAt: Date.now(), state: args.treatment === 'already_recorded' ? 'reconciled' : 'ready',
      reconciledAt: args.treatment === 'already_recorded' ? Date.now() : undefined,
      importedReference: args.treatment === 'already_recorded' ? bookReference : undefined, replaces: previous?._id,
      correctionReason: previous ? args.correctionReason!.trim() : undefined,
      pairedEntryId: reversalId,
    });
    if (movement) await ctx.db.patch(movement._id, { entryId }); else await ctx.db.insert('accountingMovements', { orgId: args.orgId, key: fact.key, entryId });
    if (previous) await ctx.db.patch(previous._id, { supersededBy: entryId, ...(previous.state === 'ready' ? { state: 'void' as const } : {}) });
    if (reversalId) await ctx.db.patch(reversalId, { pairedEntryId: entryId });
    if (args.assetAccountId && args.treatment !== 'already_recorded') {
      const location = accountingLocation(fact);
      const mapping = await ctx.db.query('accountingMappings').withIndex('by_location', q => q.eq('orgId', args.orgId).eq('location', location)).unique();
      if (mapping) await ctx.db.patch(mapping._id, { accountId: args.assetAccountId, updatedAt: Date.now() });
      else await ctx.db.insert('accountingMappings', { orgId: args.orgId, location, accountId: args.assetAccountId, updatedAt: Date.now() });
    }
    await ctx.db.patch(profile._id, { nextJournal: nextNumber });
    await audit(ctx, args.orgId, user._id, previous ? 'corrected' : 'reviewed', entryId, { movement: fact.key, treatment: args.treatment, replaces: previous?._id });
    return entryId;
  },
});

export const listEntries = query({
  args: { ...access, environment, state: v.optional(v.union(v.literal('ready'), v.literal('exported'), v.literal('reconciled'), v.literal('void'))), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...readers]);
    const base = args.state ? ctx.db.query('accountingEntries').withIndex('by_org_state', q => q.eq('orgId', args.orgId).eq('state', args.state!))
      : ctx.db.query('accountingEntries').withIndex('by_org_date', q => q.eq('orgId', args.orgId));
    return base.filter(q => q.eq(q.field('fact.environment'), args.environment)).order('desc').paginate(reportPage(args.cursor, 50));
  },
});

export const listReceipts = query({
  args: { ...access, environment, cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...readers]);
    const page = await ctx.db.query('receivableEvents').withIndex('by_org_time', q => q.eq('orgId', args.orgId))
      .order('desc').paginate(reportPage(args.cursor, 50));
    const items = [];
    for (const event of page.page) {
      const invoice = await ctx.db.get(event.invoiceId);
      if (invoice?.orgId !== args.orgId || chainEnvironment(invoice.chainId) !== args.environment) continue;
      try {
        // Listing is bounded by this page. Allocation and full source validation
        // happen when opening a receipt, not by rereading every invoice's history
        // for every row on this page.
        const asset = identifyAsset(invoice.chainId, invoice.tokenAddress, invoice.token);
        if (!asset.recognized || asset.decimals === undefined || !event.settledAt) throw new Error('Refresh the receipt to verify its asset and settlement date');
        const key = `${invoice.chainId}:e${event.txHash.slice(2).toLowerCase()}${event.logIndex}`;
        const movement = await ctx.db.query('accountingMovements').withIndex('by_movement', q => q.eq('orgId', args.orgId).eq('key', key)).unique();
        const entry = movement ? await ctx.db.get(movement.entryId) : null;
        items.push({ id: event._id, label: `Invoice ${invoice.number} · ${event.kind === 'received' ? invoice.customerName : 'Forwarding'}`,
          amount: formatUnits(BigInt(event.amount), asset.decimals), token: asset.token, settledAt: event.settledAt,
          companyTransfer: event.kind === 'forwarded', state: entry?.state, error: null as string | null });
      } catch (error) {
        items.push({ id: event._id, label: `Invoice ${invoice.number}`, amount: '', token: invoice.token, settledAt: event.settledAt ?? event.recordedAt,
          companyTransfer: event.kind === 'forwarded', state: undefined, error: error instanceof Error ? error.message : 'Receipt evidence needs review' });
      }
    }
    return { ...page, page: items };
  },
});

export const createExport = mutation({
  args: { ...access, environment, requestId: v.string(), entryIds: v.array(v.id('accountingEntries')) },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...accountants]);
    const requestId = text(args.requestId, 'Export request ID', 100, 16);
    if (!args.entryIds.length || args.entryIds.length > 100 || new Set(args.entryIds).size !== args.entryIds.length)
      throw new Error('Choose between 1 and 100 different journals for one export');
    const selected = [...args.entryIds].sort();
    const existing = await ctx.db.query('accountingExports').withIndex('by_request', q => q.eq('orgId', args.orgId).eq('requestId', requestId)).unique();
    if (existing) {
      if (JSON.stringify([...existing.entryIds].sort()) !== JSON.stringify(selected) || existing.environment !== args.environment)
        throw new Error('This export request was already used for a different selection');
      return existing._id;
    }
    const profile = await profileFor(ctx, args.orgId);
    const entries: Doc<'accountingEntries'>[] = [];
    for (const id of selected) {
      const entry = await ctx.db.get(id);
      if (!entry || entry.orgId !== args.orgId || entry.fact.environment !== args.environment)
        throw new Error('A selected journal is not in this workspace and activity environment');
      if (entry.state !== 'ready' || entry.exportId) throw new Error('A journal was already exported or changed. Download its original export instead.');
      assertPostingDate(entry.postingDate, profile.closedThrough);
      if (entry.currency !== profile.currency || !entry.lines.length) throw new Error('A selected journal cannot be exported to this book');
      if (entry.pairedEntryId && !selected.includes(entry.pairedEntryId))
        throw new Error('Export the reversal and replacement together so the correction is complete');
      if (!entry.reversalOf) {
        const current = await loadAccountingFact(ctx, args.orgId, entry.fact.source);
        if (current.fingerprint !== entry.fact.fingerprint) throw new Error('Settlement evidence changed. Correct the journal before exporting it.');
      }
      const balance = entry.lines.reduce((sum, line) => sum + (line.debit ? bookUnits(line.debit, entry.currency) : 0n) - (line.credit ? bookUnits(line.credit, entry.currency) : 0n), 0n);
      if (balance !== 0n) throw new Error('The journal is not balanced');
      entries.push(entry);
    }
    const exportId = await ctx.db.insert('accountingExports', { orgId: args.orgId, requestId, entryIds: selected,
      currency: profile.currency, environment: args.environment, createdBy: user._id, createdAt: Date.now() });
    for (const entry of entries) await ctx.db.patch(entry._id, { state: 'exported', exportId });
    await audit(ctx, args.orgId, user._id, 'export_prepared', exportId, { count: entries.length, environment: args.environment });
    return exportId;
  },
});

export const listExports = query({
  args: { ...access, environment, cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...readers]);
    return ctx.db.query('accountingExports').withIndex('by_org', q => q.eq('orgId', args.orgId))
      .filter(q => q.eq(q.field('environment'), args.environment)).order('desc').paginate(reportPage(args.cursor, 30));
  },
});

export const exportDetails = query({
  args: { exportId: v.id('accountingExports'), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.exportId);
    if (!batch) throw new Error('Export not found');
    await requireOrgAccess(ctx, batch.orgId, args.sessionToken, [...readers]);
    const entries = await Promise.all(batch.entryIds.map(id => ctx.db.get(id)));
    if (entries.some(entry => !entry || entry.orgId !== batch.orgId || entry.exportId !== batch._id))
      throw new Error('Export journal evidence is incomplete');
    return { batch, entries: entries as Doc<'accountingEntries'>[] };
  },
});

export const confirmImport = mutation({
  args: { exportId: v.id('accountingExports'), sessionToken: v.string(), reference: v.string() },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.exportId);
    if (!batch) throw new Error('Export not found');
    const { user } = await requireOrgAccess(ctx, batch.orgId, args.sessionToken, [...accountants]);
    const reference = text(args.reference, 'Import reference from your books', 200);
    if (batch.importedAt) {
      if (batch.importedReference !== reference) throw new Error('This export already has a confirmed import reference');
      return;
    }
    for (const id of batch.entryIds) {
      const entry = await ctx.db.get(id);
      if (!entry || entry.orgId !== batch.orgId || entry.exportId !== batch._id || entry.state !== 'exported')
        throw new Error('The export journal state needs review');
      await ctx.db.patch(entry._id, { state: 'reconciled', importedReference: reference, reconciledAt: Date.now() });
    }
    await ctx.db.patch(batch._id, { importedAt: Date.now(), importedReference: reference });
    await audit(ctx, batch.orgId, user._id, 'import_confirmed', batch._id, { reference });
  },
});
