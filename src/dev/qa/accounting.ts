/* eslint-disable @typescript-eslint/no-explicit-any -- local browser fixtures only */
import { configuredTokenAddress, identifyAsset } from '../../../shared/assets';
import { safes, wallet } from './fixtures';

export function accountingFixture(name: string, args: any, scenario: string | null): any {
  const accounts = [
    ['holding', '0010', 'Digital assets:Operations', 'asset'],
    ['receiving', '0011', 'Digital assets:Invoice receipts', 'asset'],
    ['payable', '2100', 'Accounts Payable', 'payable'],
    ['receivable', '1200', 'Accounts Receivable', 'receivable'],
    ['advance', '2200', 'Customer advances', 'liability'],
    ['expense', '6100', 'Professional services', 'expense'],
    ['loss', '7100', 'Realized losses', 'expense'],
    ['gain', '4100', 'Realized gains', 'income'],
  ].map(([_id, externalId, label, kind]) => ({ _id, externalId, name: label, kind, orgId: 'demo', active: true, version: 1, updatedAt: 1 }));
  const snapshot = (id: string) => { const { _id, ...account } = accounts.find(a => a._id === id)!; return { ...account, id: _id }; };
  const profile = { _id: 'profile', orgId: 'demo', currency: 'USD', bookName: 'Northstar · QuickBooks', version: 2, nextJournal: 3, updatedAt: 1 };
  const excess = scenario === 'accounting-excess';
  const fact = { key: `8453:e${'ab'.repeat(32)}4`, fingerprint: 'verified-settlement-identity',
    source: { kind: excess ? 'receipt' : 'activity', id: excess ? 'receipt1' : 'activity1' }, label: excess ? 'Invoice INV-1042 · Acme Studio' : 'Studio North · INV-1042',
    chainId: 8453, token: 'USDC', tokenAddress: configuredTokenAddress(8453, 'USDC'), decimals: 6,
    amount: excess ? '1250.000001' : '100.000001', amountRaw: excess ? '1250000001' : '100000001', transferId: `e${'ab'.repeat(32)}4`, txHash: `0x${'ab'.repeat(32)}`,
    blockNumber: '123', blockHash: `0x${'cd'.repeat(32)}`, settledAt: Date.UTC(2026, 7, 31, 23, 59, 59), dateSource: 'settlement', environment: 'production',
    safeId: 'safe1', accountAddress: safes[0].safeAddress, accountName: excess ? 'Invoice INV-1042 receiving account' : 'Operations',
    counterpartyAddress: wallet, direction: excess ? 'inflow' : 'outflow', companyTransfer: false,
    references: [{ kind: excess ? 'invoice' : 'bill', id: 'bill1', number: 'INV-1042' }],
    ...(excess ? { invoiceAppliedRaw: '1000000000', invoiceExcessRaw: '250000001' } : {}),
  };
  const entry = { _id: 'journal1', _creationTime: 1, orgId: 'demo', journalNumber: 'DSB-1', fact, currency: 'USD', treatment: 'existing_payable',
    postingDate: '2026-08-31', assetBookValue: '99.80', obligationBookValue: '100.00', bookReference: 'QBO-BILL-1042', externalName: 'Studio North',
    valuationEvidence: 'Carrying value from August close schedule', memo: 'Settle previously recorded invoice INV-1042',
    lines: [{ account: snapshot('holding'), debit: '', credit: '99.80' }, { account: snapshot('payable'), debit: '100.00', credit: '', name: 'Studio North' },
      { account: snapshot('gain'), debit: '', credit: '0.20' }], state: 'ready', reviewedBy: 'user1', reviewedAt: 1, profileVersion: 2 };
  const batch = { _id: 'export1', orgId: 'demo', requestId: 'qa-export-request', entryIds: ['journal1'], currency: 'USD', environment: 'production', createdBy: 'user1', createdAt: Date.UTC(2026, 8, 1) };
  const page = (rows: any[]) => ({ page: rows, isDone: true, continueCursor: '' });
  switch (name) {
    case 'accountBalances:list': return args.environment === 'test' ? [] : [{ _id: 'balance1', orgId: 'demo', safeId: 'safe1', chainId: 8453,
      token: 'USDC', tokenAddress: configuredTokenAddress(8453, 'USDC'), decimals: 6, accountName: 'Operations', accountAddress: safes[0].safeAddress,
      environment: 'production', startDate: '2026-08-01', endDate: '2026-08-31',
      opening: { blockNumber: '100', blockHash: `0x${'ab'.repeat(32)}`, timestamp: Date.UTC(2026, 6, 31, 23, 59, 58), balanceRaw: '5000000000' },
      closing: { blockNumber: '200', blockHash: `0x${'cd'.repeat(32)}`, timestamp: Date.UTC(2026, 7, 31, 23, 59, 58), balanceRaw: '4500000000' },
      inflowRaw: '500000000', outflowRaw: '1000000000', differenceRaw: '0', status: 'matched', movementCount: 12, unresolvedCount: 0,
      reportRevision: 10, historyThrough: Date.UTC(2026, 8, 1), checkedAt: Date.UTC(2026, 8, 1, 12) }];
    case 'accounting:configuration': return { profile, accounts, canConfigure: true, canReview: true };
    case 'accounting:sourceDetails': return ['accounting-evidence-missing', 'accounting-receipt-legacy'].includes(scenario ?? '')
      ? { fact: null, error: 'Refresh account history to match this movement to settled transfer evidence first', entry: null, history: [], historyLimited: false }
      : { fact, entry: scenario === 'accounting-correction' ? { ...entry, state: 'reconciled', exportId: 'export1' } : null, history: [], historyLimited: false, assetAccountId: excess ? 'receiving' : 'holding', error: null };
    case 'accounting:listReceipts': return page([{ id: 'receipt1', label: fact.label, amount: fact.amount, token: 'USDC', settledAt: fact.settledAt, companyTransfer: false, error: null }]);
    case 'accounting:listEntries': return page(args.environment === 'test' ? [] : [entry]);
    case 'accounting:listExports': return page(args.environment === 'test' ? [] : [batch]);
    case 'accounting:exportDetails': return { batch, entries: [{ ...entry, state: 'exported', exportId: 'export1' }] };
    case 'reports:getTransactionReport': return { items: [{ ...identifyAsset(8453, fact.tokenAddress, 'USDC'),
      rowId: 'activity1', sourceId: 'payment1', createdAt: fact.settledAt, kind: 'payment', status: 'executed', direction: 'outflow',
      safeId: 'safe1', accountAddress: fact.accountAddress, beneficiaryName: fact.label, beneficiaryWallet: wallet, amount: '100.000001',
      includedInTotals: true }], totals: [], assets: [], isDone: true, continueCursor: '', indexVersion: 1, indexing: false, indexErrors: [], rangeError: '' };
  }
}
