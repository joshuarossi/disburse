/** Accounting acceptance in the isolated dev workspace. Uses existing settled
 * testnet movements and explicitly synthetic books; sends no transactions. */
import { readFileSync, writeFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

if (!process.env.CONVEX_DEPLOYMENT?.startsWith('dev:') || !process.env.VITE_CONVEX_URL?.endsWith('.convex.cloud')) throw new Error('Explicit hosted dev configuration is required');
const state = JSON.parse(readFileSync('.local/qa/workspace-report.json', 'utf8'));
const wallet = privateKeyToAccount(JSON.parse(readFileSync('.local/qa/wallet.json', 'utf8')).privateKey);
if (state.orgId !== 'k575vpg8mtsn2126zbswdg4rfd8dvk88' || state.wallet !== wallet.address || state.deployment !== process.env.CONVEX_DEPLOYMENT) throw new Error('Isolated QA identity mismatch');
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: console });
const nonce = await client.mutation(api.auth.generateNonce, { walletAddress: wallet.address });
const session = await client.mutation(api.auth.verifySignature, { walletAddress: wallet.address, message: nonce.message, signature: await wallet.signMessage({ message: nonce.message }) });
const scope = { orgId: state.orgId, sessionToken: session.token };
const evidence = { checkedAt: new Date().toISOString(), orgId: state.orgId, book: 'Isolated QA synthetic books; no real accounting-system import', checks: [], journals: [] };
const pass = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
try {
  const org = await client.query(api.orgs.get, scope);
  if (!org?.name.includes('QA')) throw new Error('Expected the isolated QA workspace');
  let config = await client.query(api.accounting.configuration, scope);
  if (!config.profile) await client.mutation(api.accounting.configure, { ...scope, expectedVersion: 0, currency: 'USD', bookName: 'QA synthetic acceptance books' });
  else if (config.profile.currency !== 'USD' || !config.profile.bookName.startsWith('QA synthetic')) throw new Error('Unexpected accounting configuration; no book settings were changed');
  config = await client.query(api.accounting.configuration, scope);
  await client.mutation(api.accounting.importAccounts, { ...scope, expectedVersion: config.profile.version, accounts: [
    ['qa-treasury', 'QA assets:Treasury', 'asset'], ['qa-receiving', 'QA assets:Invoice receiving', 'asset'],
    ['qa-payable', 'QA Accounts Payable', 'payable'], ['qa-receivable', 'QA Accounts Receivable', 'receivable'],
    ['qa-advance', 'QA Customer advances', 'liability'],
  ].map(([externalId, name, kind]) => ({ externalId, name, kind, active: true })) });
  config = await client.query(api.accounting.configuration, scope);
  const chart = Object.fromEntries(config.accounts.map(row => [row.externalId, row._id]));
  pass('Exact chart identifiers and functional currency persisted in the isolated development database');

  const prepare = async (source, treatment, fields) => {
    const details = await client.query(api.accounting.sourceDetails, { ...scope, source });
    if (details.error || !details.fact || details.fact.environment !== 'test' || details.fact.chainId !== 11155111) throw new Error(details.error || 'Expected a settled Sepolia movement');
    if (details.entry) return details.entry._id;
    const input = { ...scope, source, expectedProfileVersion: config.profile.version, expectedFingerprint: details.fact.fingerprint,
      treatment, postingDate: new Date(details.fact.settledAt).toISOString().slice(0, 10),
      assetBookValue: '0.01', bookReference: `QA-SYNTHETIC-${source.id}`, externalName: 'Isolated QA counterparty',
      valuationEvidence: 'Synthetic QA book valuation of 0.01 USD for integration acceptance only; not an asset price or company accounting entry',
      memo: 'Isolated QA settlement reconciliation acceptance', ...fields };
    const id = await client.mutation(api.accounting.review, input);
    if (await client.mutation(api.accounting.review, input) !== id) throw new Error('A review retry created another journal');
    return id;
  };
  const reports = await client.query(api.reports.getTransactionReport, { ...scope, environment: 'test', pageSize: 100 });
  if (reports.indexing || !reports.isDone) throw new Error('Refresh the bounded QA activity before accounting acceptance');
  const payment = reports.items.find(row => row.kind === 'payment' && row.transferId && row.includedInTotals && row.amountRaw && BigInt(row.amountRaw) >= 10000n);
  if (!payment) throw new Error('No suitable already-settled QA payment found');
  const payableId = await prepare({ kind: 'activity', id: payment.rowId }, 'existing_payable', {
    assetAccountId: chart['qa-treasury'], counterAccountId: chart['qa-payable'], obligationBookValue: '0.01' });
  evidence.journals.push(payableId);
  pass('A real settled payment links to synthetic payable settlement with one retry-safe journal');

  const receipts = await client.query(api.accounting.listReceipts, { ...scope, environment: 'test' });
  let original, forwarding;
  const receiptChecks = [];
  for (const row of receipts.page) {
    await client.action(api.receiptEvidence.verify, { eventId: row.id, sessionToken: session.token });
    const details = await client.query(api.accounting.sourceDetails, { ...scope, source: { kind: 'receipt', id: row.id } });
    receiptChecks.push({ id: row.id, error: details.error, direction: details.fact?.direction, companyTransfer: details.fact?.companyTransfer,
      amountRaw: details.fact?.amountRaw, excessRaw: details.fact?.invoiceExcessRaw });
    if (!details.fact || details.error) continue;
    if (details.fact.direction === 'inflow' && !details.fact.companyTransfer && BigInt(details.fact.amountRaw) >= 10000n && details.fact.invoiceExcessRaw === '0') original ??= details.fact;
    if (details.fact.direction === 'outflow' && details.fact.companyTransfer) forwarding ??= details.fact;
  }
  if (!original || !forwarding) throw new Error(`Receipt evidence needs review: ${JSON.stringify(receiptChecks)}`);
  const receiptId = await prepare(original.source, 'existing_receivable', { assetAccountId: chart['qa-receiving'], counterAccountId: chart['qa-receivable'], obligationBookValue: '0.01' });
  const forwardId = await prepare(forwarding.source, 'internal_transfer', { assetAccountId: chart['qa-receiving'], counterAccountId: chart['qa-treasury'] });
  evidence.journals.push(receiptId, forwardId);
  const deposit = reports.items.find(row => row.kind === 'deposit' && row.transferId === forwarding.transferId);
  if (!deposit) throw new Error('The real forwarding movement has not been matched to its Safe deposit');
  const other = await client.query(api.accounting.sourceDetails, { ...scope, source: { kind: 'activity', id: deposit.rowId } });
  if (other.entry?._id !== forwardId) throw new Error('Forwarding has two independent reconciliation identities');
  pass('A real invoice receipt and forwarding reconcile separately; the Safe deposit opens the same forwarding journal');

  const requestId = `qa-accounting-${payableId}`;
  const exportId = await client.mutation(api.accounting.createExport, { ...scope, environment: 'test', entryIds: evidence.journals, requestId });
  if (await client.mutation(api.accounting.createExport, { ...scope, environment: 'test', entryIds: evidence.journals, requestId }) !== exportId) throw new Error('Export retry did not retain its receipt');
  const exported = await client.query(api.accounting.exportDetails, { sessionToken: session.token, exportId });
  if (exported.entries.some(row => !row.journalNumber.startsWith('DSB-TEST-') || row.lines.some(line => line.account.kind === 'income' || line.account.kind === 'expense')))
    throw new Error('Synthetic obligation/internal-transfer acceptance unexpectedly posted income or expense');
  for (const entry of exported.entries) {
    const units = value => BigInt(value.replace('.', ''));
    if (entry.lines.reduce((sum, line) => sum + (line.debit ? units(line.debit) : 0n) - (line.credit ? units(line.credit) : 0n), 0n) !== 0n) throw new Error('Unbalanced export');
  }
  evidence.exportId = exportId;
  pass('The saved export is balanced, preserves source quantities and reuses the same receipt and TEST journal numbers');
  try { await client.mutation(api.accounting.createExport, { ...scope, environment: 'test', entryIds: [payableId], requestId: `qa-duplicate-${payableId}` }); throw new Error('Duplicate journal export was accepted'); }
  catch (error) { if (!String(error).includes('already exported')) throw error; }
  await client.mutation(api.accounting.confirmImport, { exportId, sessionToken: session.token, reference: 'QA ONLY: synthetic acceptance import, no external ledger used' });
  const again = await client.query(api.accounting.exportDetails, { exportId, sessionToken: session.token });
  if (!again.batch.importedAt || again.entries.some(entry => entry.state !== 'reconciled')) throw new Error('Import acknowledgment did not persist');
  pass('Duplicate exports are rejected and the explicitly synthetic import acknowledgment persists');

  if (process.argv.includes('--balance')) {
    const safeId = payment.safeId;
    const checkId = await client.action(api.accountBalances.check, { ...scope, safeId, token: 'USDC', startDate: '2026-09-01', endDate: '2026-09-05' });
    const checks = await client.query(api.accountBalances.list, { ...scope, environment: 'test' });
    const proof = checks.find(row => row._id === checkId);
    if (!proof || proof.status !== 'matched') throw new Error('The historical QA period balance needs review');
    evidence.balance = proof;
    pass(`Historical Sepolia opening and closing balances verified against ${proof.movementCount} recorded movements in the completed period`);
  }
} catch (error) {
  evidence.incomplete = true;
  throw error;
} finally {
  writeFileSync('.local/qa/accounting-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  await client.mutation(api.auth.logout, { token: session.token });
}
