import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import schema from '../schema';
import { createFullOrgSetup, createTestBeneficiary, createTestDisbursement, createTestSafe, signIn, TEST_WALLETS } from './factories';
import { refreshReportIndex } from './reportHelpers';
import { queueReportSource } from '../lib/reportIndex';
import { configuredTokenAddress } from '../../shared/assets';
import { buildSettlementJournal, bookUnits, type BookAccount } from '../../shared/accounting';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 6)); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const txHash = `0x${'aa'.repeat(32)}`;
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(ctx => createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }));
  const { sessionToken } = await signIn(t, 'admin');
  const scope = { orgId: ids.orgId, sessionToken };
  await t.mutation(api.accounting.configure, { ...scope, currency: 'USD', bookName: 'QuickBooks company books', expectedVersion: 0 });
  await t.mutation(api.accounting.importAccounts, { ...scope, expectedVersion: 1, accounts: [
    { externalId: '0010', name: 'Digital assets:Operations', kind: 'asset', active: true },
    { externalId: '0011', name: 'Digital assets:Invoice receipts', kind: 'asset', active: true },
    { externalId: '2100', name: 'Accounts Payable', kind: 'payable', active: true },
    { externalId: '1200', name: 'Accounts Receivable', kind: 'receivable', active: true },
    { externalId: '2200', name: 'Customer advances', kind: 'liability', active: true },
    { externalId: '6100', name: 'Professional services', kind: 'expense', active: true },
    { externalId: '7100', name: 'Realized losses', kind: 'expense', active: true },
    { externalId: '4100', name: 'Realized gains', kind: 'income', active: true },
  ] });
  const config = await t.query(api.accounting.configuration, scope);
  const chart = Object.fromEntries(config.accounts.map(a => [a.externalId, a._id]));
  const transfer = { orgId: ids.orgId, safeId: ids.safeId, safeAddress: ids.safeAddress.toLowerCase(), chainId: 11155111,
    tokenSymbol: 'USDC', tokenAddress: configuredTokenAddress(11155111, 'USDC')!, decimals: 6,
    amount: '100.000001', amountRaw: '100000001', txHash, transferId: `e${txHash.slice(2)}4`, blockNumber: 100,
    timestamp: Date.UTC(2026, 7, 31, 23, 59, 59), fromAddress: ids.safeAddress.toLowerCase(), toAddress: TEST_WALLETS.approver.toLowerCase(), source: 'safe_tx_service' as const };
  return { t, ids, scope, chart, transfer };
}
async function outgoing(s: Awaited<ReturnType<typeof setup>>) {
  await s.t.mutation(internal.depositsData.upsertOutgoingTransfer, s.transfer);
  await refreshReportIndex(s.t, s.ids.orgId);
  const report = await s.t.query(api.reports.getTransactionReport, { ...s.scope, environment: 'test' });
  const source = { kind: 'activity' as const, id: report.items[0].rowId };
  const detail = await s.t.query(api.accounting.sourceDetails, { ...s.scope, source });
  expect(detail.error).toBeNull();
  const args = { ...s.scope, source, expectedFingerprint: detail.fact!.fingerprint, expectedProfileVersion: 2,
    treatment: 'existing_payable' as const, postingDate: '2026-08-31', assetBookValue: '99.80', obligationBookValue: '100.00',
    assetAccountId: s.chart['0010'], counterAccountId: s.chart['2100'], differenceAccountId: s.chart['4100'],
    bookReference: 'QBO-BILL-7001', externalName: 'Example vendor', valuationEvidence: 'Carrying value from August close schedule',
    memo: 'Settlement of previously recorded vendor bill' };
  return { source, detail, args };
}

it('settles an already-booked bill using separate carrying and obligation values without another expense', async () => {
  const s = await setup();
  const bill = await s.t.run(async ctx => {
    const beneficiaryId = await createTestBeneficiary(ctx, s.ids.orgId, { walletAddress: s.transfer.toAddress });
    const paymentId = await createTestDisbursement(ctx, s.ids.orgId, s.ids.safeId, beneficiaryId, s.ids.userId, { amount: s.transfer.amount, status: 'executed', txHash });
    await ctx.db.patch(paymentId, { recipientAddress: s.transfer.toAddress, tokenAddress: s.transfer.tokenAddress });
    return ctx.db.insert('invoices', { orgId: s.ids.orgId, beneficiaryId, invoiceNumber: 'VENDOR-100', normalizedNumber: 'vendor-100', amount: s.transfer.amount,
      token: 'USDC', dueDate: Date.now(), createdBy: s.ids.userId, createdAt: Date.now(), updatedAt: Date.now(), disbursementId: paymentId });
  });
  const { args, detail } = await outgoing(s);
  expect(detail.fact!.references).toContainEqual({ kind: 'bill', id: bill, number: 'VENDOR-100' });
  const id = await s.t.mutation(api.accounting.review, args);
  const entry = (await s.t.run(ctx => ctx.db.get(id)))!;
  expect(entry.fact.amount).toBe('100.000001');
  expect(entry.lines.map(l => [l.account.externalId, l.debit, l.credit])).toEqual([
    ['0010', '', '99.80'], ['2100', '100.00', ''], ['4100', '', '0.20'],
  ]);
  expect(entry.lines.filter(l => l.account.kind === 'expense')).toHaveLength(0);
  expect(await s.t.mutation(api.accounting.review, args)).toBe(id);
  expect(await s.t.run(ctx => ctx.db.query('accountingEntries').collect())).toHaveLength(1);
});

it('reuses the export receipt after an interrupted response and refuses a new export of the same journal', async () => {
  const s = await setup(), { args } = await outgoing(s);
  const id = await s.t.mutation(api.accounting.review, args);
  const input = { ...s.scope, environment: 'test' as const, requestId: 'test-export-request-0001', entryIds: [id] };
  const exportId = await s.t.mutation(api.accounting.createExport, input);
  expect(await s.t.mutation(api.accounting.createExport, input)).toBe(exportId);
  await expect(s.t.mutation(api.accounting.createExport, { ...input, requestId: 'test-export-request-0002' })).rejects.toThrow('already exported');
  const first = await s.t.query(api.accounting.exportDetails, { exportId, sessionToken: s.scope.sessionToken });
  await s.t.mutation(api.accounting.importAccounts, { ...s.scope, expectedVersion: 2,
    accounts: [{ externalId: '0010', name: 'Renamed asset account', kind: 'asset', active: false }] });
  const second = await s.t.query(api.accounting.exportDetails, { exportId, sessionToken: s.scope.sessionToken });
  expect(second.entries[0].lines).toEqual(first.entries[0].lines);
  await s.t.mutation(api.accounting.confirmImport, { exportId, sessionToken: s.scope.sessionToken, reference: 'QBO-IMPORT-200' });
  await expect(s.t.mutation(api.accounting.confirmImport, { exportId, sessionToken: s.scope.sessionToken, reference: 'DIFFERENT' })).rejects.toThrow('already has');
  expect(await s.t.run(ctx => ctx.db.get(id))).toMatchObject({ state: 'reconciled', importedReference: 'QBO-IMPORT-200' });
});

it('preserves a posted journal and requires its reversal and replacement to be exported together in an open period', async () => {
  const s = await setup(), { args } = await outgoing(s);
  const originalId = await s.t.mutation(api.accounting.review, args);
  const exported = await s.t.mutation(api.accounting.createExport, { ...s.scope, environment: 'test', entryIds: [originalId], requestId: 'original-export-0001' });
  await expect(s.t.mutation(api.accounting.review, { ...args, replaces: originalId, correctionReason: 'Reviewed carrying value correction' })).rejects.toThrow('Confirm whether');
  await s.t.mutation(api.accounting.confirmImport, { exportId: exported, sessionToken: s.scope.sessionToken, reference: 'QBO-IMPORTED-200' });
  const original = (await s.t.run(ctx => ctx.db.get(originalId)))!;
  await s.t.mutation(api.accounting.configure, { ...s.scope, expectedVersion: 2, currency: 'USD', bookName: 'QuickBooks', closedThrough: '2026-08-31' });
  await expect(s.t.mutation(api.accounting.review, { ...args, expectedProfileVersion: 3, replaces: originalId, correctionReason: 'Reviewed carrying value correction' })).rejects.toThrow('closed through');
  const replacementId = await s.t.mutation(api.accounting.review, { ...args, expectedProfileVersion: 3, postingDate: '2026-09-01',
    replaces: originalId, correctionReason: 'Reviewed carrying value correction', assetBookValue: '99.90' });
  const replacement = (await s.t.run(ctx => ctx.db.get(replacementId)))!;
  const reversal = (await s.t.run(ctx => ctx.db.get(replacement.pairedEntryId!)))!;
  expect(reversal.lines).toEqual(original.lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })));
  expect((await s.t.run(ctx => ctx.db.get(originalId)))!.lines).toEqual(original.lines);
  await expect(s.t.mutation(api.accounting.createExport, { ...s.scope, environment: 'test', requestId: 'replacement-export-0001', entryIds: [replacementId] })).rejects.toThrow('together');
  await s.t.mutation(api.accounting.createExport, { ...s.scope, environment: 'test', requestId: 'correction-export-0001', entryIds: [replacementId, reversal._id] });
});

it('voids an unexported review during correction instead of producing an orphan reversal', async () => {
  const s = await setup(), { args } = await outgoing(s);
  const id = await s.t.mutation(api.accounting.review, args);
  const replacement = await s.t.mutation(api.accounting.review, { ...args, replaces: id, correctionReason: 'Corrected before importing into the books', assetBookValue: '99.90' });
  expect(await s.t.run(ctx => ctx.db.get(id))).toMatchObject({ state: 'void', supersededBy: replacement });
  expect(await s.t.run(ctx => ctx.db.query('accountingEntries').collect())).toHaveLength(2);
});

it('keeps the original reversal paired when a pending replacement is corrected and retried', async () => {
  const s = await setup(), { args } = await outgoing(s);
  const originalId = await s.t.mutation(api.accounting.review, args);
  const exportId = await s.t.mutation(api.accounting.createExport, { ...s.scope, environment: 'test', entryIds: [originalId], requestId: 'posted-original-export' });
  await s.t.mutation(api.accounting.confirmImport, { exportId, sessionToken: s.scope.sessionToken, reference: 'QBO-POSTED' });
  const firstId = await s.t.mutation(api.accounting.review, { ...args, replaces: originalId, correctionReason: 'First corrected valuation', assetBookValue: '99.90' });
  const first = (await s.t.run(ctx => ctx.db.get(firstId)))!;
  const correction = { ...args, replaces: firstId, postingDate: '2026-09-01', correctionReason: 'Final reviewed valuation', assetBookValue: '99.95' };
  const finalId = await s.t.mutation(api.accounting.review, correction);
  expect(await s.t.mutation(api.accounting.review, correction)).toBe(finalId);
  expect(await s.t.run(ctx => ctx.db.get(firstId))).toMatchObject({ state: 'void' });
  expect(await s.t.run(ctx => ctx.db.get(first.pairedEntryId!))).toMatchObject({ pairedEntryId: finalId, postingDate: '2026-09-01' });
  expect(await s.t.run(ctx => ctx.db.get(finalId))).toMatchObject({ pairedEntryId: first.pairedEntryId });
  await s.t.mutation(api.accounting.createExport, { ...s.scope, environment: 'test', entryIds: [finalId, first.pairedEntryId!], requestId: 'final-correction-export' });
  expect((await s.t.run(ctx => ctx.db.query('accountingEntries').collect())).filter(e => e.state === 'ready')).toHaveLength(0);
});

it('matches an existing book transaction without producing a journal to import again', async () => {
  const s = await setup(), { args } = await outgoing(s);
  const id = await s.t.mutation(api.accounting.review, { ...args, treatment: 'already_recorded' });
  expect(await s.t.run(ctx => ctx.db.get(id))).toMatchObject({ state: 'reconciled', lines: [], importedReference: args.bookReference });
  await expect(s.t.mutation(api.accounting.createExport, { ...s.scope, environment: 'test', entryIds: [id], requestId: 'duplicate-match-export' })).rejects.toThrow('already exported or changed');
});

it('recognizes both sides of an Operations-to-Payroll transfer as one internal movement', async () => {
  const s = await setup();
  const payroll = await s.t.run(ctx => createTestSafe(ctx, s.ids.orgId, { safeAddress: s.transfer.toAddress }));
  const { args, detail } = await outgoing(s);
  expect(detail.fact!.companyTransfer).toBe(true);
  await expect(s.t.mutation(api.accounting.review, args)).rejects.toThrow('company accounts');
  const entryId = await s.t.mutation(api.accounting.review, { ...args, treatment: 'internal_transfer', counterAccountId: s.chart['0011'] });
  const depositId = await s.t.run(ctx => ctx.db.insert('deposits', { ...s.transfer, safeId: payroll, safeAddress: s.transfer.toAddress, createdAt: Date.now() }));
  await s.t.run(ctx => queueReportSource(ctx, s.ids.orgId, 'deposit', depositId));
  await refreshReportIndex(s.t, s.ids.orgId);
  const other = await s.t.query(api.accounting.sourceDetails, { ...s.scope, source: { kind: 'activity', id: `${depositId}:deposit` } });
  expect(other.fact!.key).toBe(detail.fact!.key);
  expect(other.entry?._id).toBe(entryId);
  expect((await s.t.run(ctx => ctx.db.get(entryId)))!.lines.every(l => l.account.kind === 'asset')).toBe(true);
});

it('rejects stale evidence, account mappings from another workspace and unbalanced policy choices', async () => {
  const s = await setup(), { args } = await outgoing(s);
  await expect(s.t.mutation(api.accounting.review, { ...args, expectedFingerprint: 'stale' })).rejects.toThrow('evidence changed');
  await expect(s.t.mutation(api.accounting.review, { ...args, assetBookValue: '100.001' })).rejects.toThrow('decimal places');
  await expect(s.t.mutation(api.accounting.review, { ...args, differenceAccountId: s.chart['7100'] })).rejects.toThrow('gain / income');
  await expect(s.t.mutation(api.accounting.review, { ...args, counterAccountId: s.chart['6100'] })).rejects.toThrow('accounting treatment');
  const other = await signIn(s.t, 'nonMember');
  await expect(s.t.query(api.accounting.sourceDetails, { ...s.scope, sessionToken: other.sessionToken, source: args.source })).rejects.toThrow();
  const foreignAccount = await s.t.run(async ctx => {
    const org = await createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.nonMember });
    return ctx.db.insert('accountingAccounts', { orgId: org.orgId, externalId: '0010', name: 'Foreign holding', kind: 'asset', active: true, version: 1, updatedAt: Date.now() });
  });
  await expect(s.t.mutation(api.accounting.review, { ...args, assetAccountId: foreignAccount })).rejects.toThrow('this workspace');
  expect(await s.t.run(ctx => ctx.db.query('accountingEntries').collect())).toHaveLength(0);
});

it('allows a documented zero book-value match for a sub-cent transfer without a zero-line journal', async () => {
  const s = await setup(), { args } = await outgoing(s);
  const id = await s.t.mutation(api.accounting.review, { ...args, treatment: 'already_recorded', assetBookValue: '0.00',
    valuationEvidence: 'No carrying value in the book, reviewed against the asset schedule' });
  expect(await s.t.run(ctx => ctx.db.get(id))).toMatchObject({ assetBookValue: '0.00', lines: [], state: 'reconciled' });
});

it('requires a customer liability split for invoice overpayments and rechecks changed allocations before export', async () => {
  const s = await setup();
  const receiver = '0x8888888888888888888888888888888888888888';
  const ids = await s.t.run(async ctx => {
    const invoice = await ctx.db.insert('receivables', { orgId: s.ids.orgId, safeId: s.ids.safeId, createdBy: s.ids.userId,
      number: 'AR-OVER', normalizedNumber: 'ar-over', customerName: 'Customer LLC', description: 'Services', items: [{ description: 'Service', quantity: 1, unitPrice: '20' }],
      token: 'USDC', tokenAddress: s.transfer.tokenAddress, chainId: s.transfer.chainId, treasury: s.transfer.safeAddress,
      amount: '20', dueDate: Date.now(), state: 'issued', receivingAddress: receiver, received: '25000000', forwarded: '0', createdAt: Date.now(), updatedAt: Date.now() });
    const receipt = await ctx.db.insert('receivableEvents', { invoiceId: invoice, orgId: s.ids.orgId, amount: '25000000',
      blockNumber: '100', blockHash: `0x${'bb'.repeat(32)}`, recordedAt: Date.now(), settledAt: s.transfer.timestamp,
      key: 'overpayment', kind: 'received', txHash, logIndex: 2, fromAddress: TEST_WALLETS.approver.toLowerCase(), toAddress: receiver });
    return { invoice, receipt };
  });
  const source = { kind: 'receipt' as const, id: ids.receipt };
  const detail = await s.t.query(api.accounting.sourceDetails, { ...s.scope, source });
  expect(detail.fact).toMatchObject({ invoiceAppliedRaw: '20000000', invoiceExcessRaw: '5000000' });
  const args = { ...s.scope, source, expectedFingerprint: detail.fact!.fingerprint, expectedProfileVersion: 2, postingDate: '2026-08-31',
    treatment: 'existing_receivable' as const, assetBookValue: '25.00', obligationBookValue: '20.00',
    assetAccountId: s.chart['0011'], counterAccountId: s.chart['1200'], differenceAccountId: s.chart['4100'],
    externalName: 'Customer LLC', bookReference: 'QBO-AR-OVER', valuationEvidence: 'Reviewed receivable and liability valuation', memo: 'Invoice overpayment' };
  await expect(s.t.mutation(api.accounting.review, args)).rejects.toThrow('book value');
  await expect(s.t.mutation(api.accounting.review, { ...args, advanceBookValue: '5', advanceAccountId: s.chart['4100'] })).rejects.toThrow('customer liability');
  const id = await s.t.mutation(api.accounting.review, { ...args, advanceBookValue: '5', advanceAccountId: s.chart['2200'] });
  expect((await s.t.run(ctx => ctx.db.get(id)))!.lines.map(line => [line.account.kind, line.debit, line.credit]))
    .toEqual([['asset', '25.00', ''], ['receivable', '', '20.00'], ['liability', '', '5.00']]);
  const laterId = await s.t.run(ctx => ctx.db.insert('receivableEvents', { invoiceId: ids.invoice, orgId: s.ids.orgId, amount: '1000000',
    blockNumber: '101', blockHash: `0x${'ee'.repeat(32)}`, recordedAt: Date.now(), settledAt: s.transfer.timestamp + 1000,
    key: 'second-overpayment', kind: 'received', txHash: `0x${'cc'.repeat(32)}`, logIndex: 3, fromAddress: TEST_WALLETS.approver.toLowerCase(), toAddress: receiver }));
  const later = await s.t.query(api.accounting.sourceDetails, { ...s.scope, source: { kind: 'receipt', id: laterId } });
  await expect(s.t.mutation(api.accounting.review, { ...args, source: later.fact!.source, expectedFingerprint: later.fact!.fingerprint }))
    .rejects.toThrow('already fully funded');
  await s.t.run(ctx => ctx.db.insert('receivableEvents', { invoiceId: ids.invoice, orgId: s.ids.orgId, amount: '1000000',
    blockNumber: '99', blockHash: `0x${'ff'.repeat(32)}`, recordedAt: Date.now(), settledAt: s.transfer.timestamp - 1000,
    key: 'backfilled-earlier-receipt', kind: 'received', txHash: `0x${'dd'.repeat(32)}`, logIndex: 3, fromAddress: TEST_WALLETS.approver.toLowerCase(), toAddress: receiver }));
  await expect(s.t.mutation(api.accounting.createExport, { ...s.scope, environment: 'test', requestId: 'stale-overpayment-export', entryIds: [id] }))
    .rejects.toThrow('evidence changed');
});

it('keeps exact book math beyond floating-point limits and does not treat customer collections as revenue', () => {
  expect(bookUnits('9007199254740993.01', 'USD')).toBe(900719925474099301n);
  const asset: BookAccount = { id: 'asset', externalId: '1', name: 'Holding', kind: 'asset', version: 1 };
  const ar: BookAccount = { id: 'ar', externalId: '2', name: 'Accounts receivable', kind: 'receivable', version: 1 };
  const lines = buildSettlementJournal({ treatment: 'existing_receivable', direction: 'inflow', currency: 'USD',
    assetBookValue: '10.00', obligationBookValue: '10.00', assetAccount: asset, counterAccount: ar, externalName: 'Customer in books', companyTransfer: false });
  expect(lines.map(l => l.account.kind)).toEqual(['asset', 'receivable']);
  expect(() => buildSettlementJournal({ treatment: 'customer_advance', direction: 'inflow', currency: 'USD', assetBookValue: '10',
    assetAccount: asset, counterAccount: { ...ar, kind: 'income' }, companyTransfer: false })).toThrow('accounting treatment');
});

it('records one partial customer collection and one internal forwarding journal, shared with the main-account deposit', async () => {
  const s = await setup();
  const receiver = '0x8888888888888888888888888888888888888888';
  const receivedTx = `0x${'cc'.repeat(32)}`;
  const ids = await s.t.run(async ctx => {
    const invoice = await ctx.db.insert('receivables', { orgId: s.ids.orgId, safeId: s.ids.safeId, createdBy: s.ids.userId,
      number: 'AR-7', normalizedNumber: 'ar-7', customerName: 'Customer LLC', description: 'Services', items: [{ description: 'Service', quantity: 1, unitPrice: '20' }],
      token: 'USDC', tokenAddress: s.transfer.tokenAddress, chainId: s.transfer.chainId, treasury: s.transfer.safeAddress,
      amount: '20', dueDate: Date.now(), state: 'issued', receivingAddress: receiver, received: '10000001', forwarded: '10000001', createdAt: Date.now(), updatedAt: Date.now() });
    const evidence = { invoiceId: invoice, orgId: s.ids.orgId, amount: '10000001', blockNumber: '100', blockHash: `0x${'bb'.repeat(32)}`,
      recordedAt: Date.now(), settledAt: s.transfer.timestamp };
    const receipt = await ctx.db.insert('receivableEvents', { ...evidence, key: 'receipt7', kind: 'received', txHash: receivedTx, logIndex: 2,
      fromAddress: TEST_WALLETS.approver.toLowerCase(), toAddress: receiver });
    const forwarding = await ctx.db.insert('receivableEvents', { ...evidence, key: 'forwarding7', kind: 'forwarded', txHash, logIndex: 4, fromAddress: receiver, toAddress: s.transfer.safeAddress });
    const deposit = await ctx.db.insert('deposits', { ...s.transfer, amount: '10.000001', amountRaw: '10000001', fromAddress: receiver,
      toAddress: s.transfer.safeAddress, createdAt: Date.now() });
    await queueReportSource(ctx, s.ids.orgId, 'deposit', deposit);
    return { invoice, receipt, forwarding, deposit };
  });
  const detail = await s.t.query(api.accounting.sourceDetails, { ...s.scope, source: { kind: 'receipt', id: ids.receipt } });
  const common = { ...s.scope, expectedProfileVersion: 2, postingDate: '2026-08-31', assetBookValue: '10.00',
    valuationEvidence: 'Reviewed customer receivable and asset carrying schedule', memo: 'Partial collection for AR-7', bookReference: 'QBO-AR-7' };
  const received = await s.t.mutation(api.accounting.review, { ...common, source: detail.fact!.source, expectedFingerprint: detail.fact!.fingerprint,
    treatment: 'existing_receivable', assetAccountId: s.chart['0011'], counterAccountId: s.chart['1200'], obligationBookValue: '10', externalName: 'Customer LLC' });
  const forward = await s.t.query(api.accounting.sourceDetails, { ...s.scope, source: { kind: 'receipt', id: ids.forwarding } });
  const forwarded = await s.t.mutation(api.accounting.review, { ...common, source: forward.fact!.source, expectedFingerprint: forward.fact!.fingerprint,
    treatment: 'internal_transfer', assetAccountId: s.chart['0011'], counterAccountId: s.chart['0010'] });
  await refreshReportIndex(s.t, s.ids.orgId);
  const deposit = await s.t.query(api.accounting.sourceDetails, { ...s.scope, source: { kind: 'activity', id: `${ids.deposit}:deposit` } });
  expect(deposit.entry?._id).toBe(forwarded);
  expect(deposit.fact!.key).toBe(forward.fact!.key);
  const entries = await s.t.run(ctx => ctx.db.query('accountingEntries').collect());
  expect(entries.map(entry => entry._id)).toEqual([received, forwarded]);
  expect(entries.flatMap(entry => entry.lines).filter(line => line.account.kind === 'income')).toHaveLength(0);
  expect(entries.flatMap(entry => entry.lines).filter(line => line.account.kind === 'receivable')).toHaveLength(1);
});
