import type { Infer } from 'convex/values';
import { formatUnits, parseUnits } from 'viem';
import type { QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { identifyAsset } from '../../shared/assets';
import { accountingFact, accountingSource } from './accountingValidators';
import { depositReportRows, outgoingReportRows, paymentReportRows, type ReportRow } from './reportRows';
import { circleFeeReportRows } from './circleFeeReports';
import { treasuryServiceReportRows } from './treasuryServiceReports';

export type AccountingFact = Infer<typeof accountingFact>;
export type AccountingSource = Infer<typeof accountingSource>;
type ReadCtx = Pick<QueryCtx, 'db'>;
export const accountingLocation = (fact: Pick<AccountingFact, 'chainId' | 'accountAddress' | 'tokenAddress'>) =>
  `${fact.chainId}:${fact.accountAddress.toLowerCase()}:${fact.tokenAddress.toLowerCase()}`;

async function companyLocation(ctx: ReadCtx, orgId: Id<'orgs'>, chainId: number, address: string) {
  const safe = await ctx.db.query('safes').withIndex('by_org_chain_address', q => q.eq('orgId', orgId).eq('chainId', chainId).eq('safeAddress', address.toLowerCase())).first();
  if (safe) return safe.name ?? 'Company account';
  const invoice = await ctx.db.query('receivables').withIndex('by_receiving_address', q => q.eq('orgId', orgId).eq('chainId', chainId).eq('receivingAddress', address.toLowerCase())).first();
  return invoice ? `Invoice ${invoice.number} receiving account` : undefined;
}
function finish(fact: Omit<AccountingFact, 'key' | 'fingerprint'>): AccountingFact {
  if (![fact.accountAddress, fact.counterpartyAddress].every(address => /^0x[\da-fA-F]{40}$/.test(address))
    || !/^\d{1,30}$/.test(fact.blockNumber ?? '') || !Number.isSafeInteger(fact.settledAt) || fact.settledAt <= 0)
    throw new Error('The settled account, counterparty or date evidence is incomplete');
  if (!fact.transferId || !/^(e[\da-fA-F]{64}\d+|i[\da-fA-F]{64}\d*(,\d+)*|c[\da-fA-F]{64}:\d+:(\d+|none))$/.test(fact.transferId))
    throw new Error('This movement needs its canonical chain-transfer identifier');
  const from = fact.direction === 'outflow' ? fact.accountAddress : fact.counterpartyAddress;
  const to = fact.direction === 'inflow' ? fact.accountAddress : fact.counterpartyAddress;
  const key = `${fact.chainId}:${fact.transferId.toLowerCase()}`;
  return { ...fact, key, fingerprint: [key, fact.tokenAddress.toLowerCase(), fact.amountRaw, from.toLowerCase(), to.toLowerCase(),
    fact.blockNumber, fact.blockHash ?? '', fact.settledAt, fact.companyTransfer, fact.invoiceAppliedRaw ?? '', fact.invoiceExcessRaw ?? '',
    ...(fact.treasuryTransferId ? [fact.treasuryTransferId, fact.deliveryFeeRaw ?? ''] : []),
    ...(fact.treasuryServiceId ? [fact.treasuryServiceId, fact.lendingMovement ?? '', fact.conversionMovement ?? ''] : []),
    ...(fact.customerRefund ? ['customer_refund', ...fact.references.map(r=>r.id)] : [])].join('|') };
}

/** Read the underlying records again, not just an asynchronously built report.
 * Matching both sides of a company transfer uses the same chain/log identity. */
export async function loadAccountingFact(ctx: QueryCtx, orgId: Id<'orgs'>, source: AccountingSource): Promise<AccountingFact> {
  if (source.id.length > 200) throw new Error('Invalid source reference');
  if(source.kind === 'credit_note') {
    const id=ctx.db.normalizeId('receivableCreditNotes',source.id), credit=id?await ctx.db.get(id):null;
    const invoice=credit?await ctx.db.get(credit.invoiceId):null;
    if(!credit || !invoice || credit.orgId !== orgId || invoice.orgId !== orgId)throw new Error('Credit note not found in this workspace.');
    const asset=identifyAsset(invoice.chainId,invoice.tokenAddress,invoice.token);
    if(!asset.recognized || asset.environment === 'unclassified' || asset.decimals === undefined || !asset.tokenAddress)throw new Error('The credit note currency needs review.');
    const key=`credit_note:${credit._id}`;
    return {key,source,fingerprint:[key,credit.amountRaw,credit.number,credit.reason,credit.issuedAt,invoice._id,asset.tokenAddress].join('|'),label:`Credit ${credit.number} · ${invoice.customerName}`,
      nonCash:'credit_note',direction:'noncash',companyTransfer:false,chainId:invoice.chainId,token:asset.token,tokenAddress:asset.tokenAddress,decimals:asset.decimals,
      amountRaw:credit.amountRaw,amount:formatUnits(BigInt(credit.amountRaw),asset.decimals),settledAt:credit.issuedAt,dateSource:'document',environment:asset.environment,
      safeId:invoice.safeId,accountAddress:invoice.treasury,accountName:`Invoice ${invoice.number}`,counterpartyAddress:'',
      references:[{kind:'invoice',id:invoice._id,number:invoice.number},{kind:'credit_note',id:credit._id,number:credit.number}]};
  }
  if (source.kind === 'receipt') {
    const id = ctx.db.normalizeId('receivableEvents', source.id);
    const event = id ? await ctx.db.get(id) : null;
    if (!event || event.orgId !== orgId) throw new Error('Receipt not found in this workspace');
    const invoice = await ctx.db.get(event.invoiceId);
    if (!invoice || invoice.orgId !== orgId || !invoice.receivingAddress || !event.settledAt)
      throw new Error('This receipt needs verified settlement-date evidence before reconciliation');
    const asset = identifyAsset(invoice.chainId, invoice.tokenAddress, invoice.token);
    if (!asset.recognized || asset.environment === 'unclassified' || !/^\d{1,100}$/.test(event.amount) || BigInt(event.amount) <= 0n)
      throw new Error('This receipt has incomplete asset evidence');
    const account = await ctx.db.get(invoice.safeId);
    if (account?.orgId !== orgId) throw new Error('The receipt funding account could not be verified');
    const direction = event.kind === 'received' ? 'inflow' as const : 'outflow' as const;
    const other = direction === 'outflow' ? invoice.treasury : event.fromAddress;
    if (!other) throw new Error('Refresh this receipt to verify the sender before reconciliation');
    const companyAccountName = await companyLocation(ctx, orgId, invoice.chainId, other);
    let invoiceAppliedRaw: string | undefined, invoiceExcessRaw: string | undefined;
    if (event.kind === 'received' && !companyAccountName) {
      const events = await ctx.db.query('receivableEvents').withIndex('by_invoice', q => q.eq('invoiceId', invoice._id)).take(1001);
      if (events.length > 1000) throw new Error('This invoice exceeds the 1,000-receipt reconciliation review limit');
      const previous = events.filter(row => row.kind === 'received' && (BigInt(row.blockNumber) < BigInt(event.blockNumber)
        || (row.blockNumber === event.blockNumber && row.logIndex < event.logIndex))).reduce((sum, row) => sum + BigInt(row.amount), 0n);
      const credits=await ctx.db.query('receivableCreditNotes').withIndex('by_invoice',q=>q.eq('invoiceId',invoice._id)).take(101);
      if(credits.length > 100)throw new Error('This invoice exceeds the credit-note review limit.');
      // Subsequent credits never rewrite an earlier receipt's allocation.
      const credited=credits.filter(c=>c.issuedAt <= event.settledAt!).reduce((sum,c)=>sum+BigInt(c.amountRaw),0n);
      const expected=invoice.voidedAt && invoice.voidedAt <= event.settledAt ? 0n : parseUnits(invoice.amount,asset.decimals!)-credited;
      const remaining = expected - previous;
      const applied = remaining <= 0n ? 0n : remaining < BigInt(event.amount) ? remaining : BigInt(event.amount);
      invoiceAppliedRaw = applied.toString(); invoiceExcessRaw = (BigInt(event.amount) - applied).toString();
    }
    return finish({ source, label: `Invoice ${invoice.number} · ${event.kind === 'received' ? invoice.customerName : 'Forwarding'}`,
      chainId: invoice.chainId, token: asset.token, tokenAddress: asset.tokenAddress!, decimals: asset.decimals!,
      amountRaw: event.amount, amount: formatUnits(BigInt(event.amount), asset.decimals!), transferId: `e${event.txHash.slice(2).toLowerCase()}${event.logIndex}`,
      txHash: event.txHash.toLowerCase(), blockNumber: event.blockNumber, blockHash: event.blockHash, settledAt: event.settledAt,
      dateSource: 'settlement', environment: asset.environment, safeId: invoice.safeId,
      accountAddress: invoice.receivingAddress, accountName: `Invoice ${invoice.number} receiving account`,
      counterpartyAddress: other.toLowerCase(), direction, companyTransfer: !!companyAccountName, companyAccountName,
      invoiceAppliedRaw, invoiceExcessRaw,
      references: [{ kind: 'invoice', id: invoice._id, number: invoice.number }],
    });
  }
  const indexed = await ctx.db.query('reportEntries').withIndex('by_org_row', q => q.eq('orgId', orgId).eq('rowId', source.id)).unique();
  if (!indexed) throw new Error('Activity not found. Refresh account history before reconciling.');
  let rows: ReportRow[];
  if (indexed.treasuryServiceId) rows = await treasuryServiceReportRows(ctx, indexed.treasuryServiceId);
  else if (indexed.treasuryTransferId) rows = await treasuryReportRows(ctx, indexed.treasuryTransferId);
  else if (indexed.kind === 'deposit') rows = await depositReportRows(ctx, indexed.sourceId as Id<'deposits'>);
  else if (indexed.kind === 'account_transfer') rows = await outgoingReportRows(ctx, indexed.sourceId as Id<'outgoingTransfers'>);
  else if (indexed.kind === 'fee' && ctx.db.normalizeId('circleExecutions', indexed.sourceId)) rows = await circleFeeReportRows(ctx, indexed.sourceId as Id<'circleExecutions'>);
  else rows = await paymentReportRows(ctx, indexed.sourceId as Id<'disbursements'>);
  const row = rows.find(row => row.rowId === indexed.rowId);
  if (!row || !row.includedInTotals || !row.chainId || row.environment === 'unclassified'
    || !row.tokenAddress || row.decimals === undefined || !row.transferId || !row.txHash || !row.blockNumber
    || row.dateSource === 'recorded' || !row.dateSource || row.transferMatch === 'pending')
    throw new Error('Refresh account history to match this movement to settled transfer evidence first');
  // Safe IDs identify individual transfers. Circle's c+tx:prefund:refund ID
  // represents the verified net of two transfers, retained in its fee proof.
  const prefix = row.transferId.slice(0, 65).toLowerCase();
  if (!['e', 'i', 'c'].includes(prefix[0]) || prefix.slice(1) !== row.txHash.slice(2).toLowerCase())
    throw new Error('This historical transfer needs its canonical chain-transfer identifier');
  const raw = row.amountRaw ?? parseUnits(row.amount, row.decimals).toString();
  if (!/^\d{1,100}$/.test(raw) || BigInt(raw) <= 0n) throw new Error('This movement has no positive settled quantity');
  const account = await ctx.db.get(row.safeId);
  if (account?.orgId !== orgId) throw new Error('Account not found in this workspace');
  const transfer = row.treasuryTransferId ? await ctx.db.get(row.treasuryTransferId) : null;
  if (row.treasuryTransferId && transfer?.orgId !== orgId) throw new Error('The company transfer could not be verified');
  const other = transfer ? await ctx.db.get(row.direction === 'outflow' ? transfer.destinationSafeId : transfer.safeId) : null;
  const companyAccountName = transfer ? other?.name ?? 'Company account' : await companyLocation(ctx, orgId, row.chainId, row.beneficiaryWallet);
  const bills = row.kind === 'payment' ? await ctx.db.query('invoices').withIndex('by_payment', q => q.eq('disbursementId', row.sourceId as Id<'disbursements'>)).take(101) : [];
  if (bills.length > 100) throw new Error('This payment exceeds the bill-reference review limit');
  const payment=row.kind === 'payment'?await ctx.db.get(row.sourceId as Id<'disbursements'>):null;
  const refundInvoice=payment?.refundInvoiceId?await ctx.db.get(payment.refundInvoiceId):null;
  if(refundInvoice && (refundInvoice.orgId !== orgId || refundInvoice.chainId !== row.chainId || refundInvoice.tokenAddress.toLowerCase() !== row.tokenAddress.toLowerCase()))throw new Error('This refund has inconsistent invoice evidence.');
  return finish({ source, label: row.memo ? `${row.beneficiaryName} · ${row.memo}` : row.beneficiaryName,
    chainId: row.chainId, token: row.token, tokenAddress: row.tokenAddress, decimals: row.decimals,
    amountRaw: raw, amount: formatUnits(BigInt(raw), row.decimals), transferId: row.transferId, txHash: row.txHash.toLowerCase(),
    blockNumber: row.blockNumber, blockHash: row.blockHash, settledAt: row.createdAt, dateSource: row.dateSource,
    environment: row.environment, safeId: row.safeId, accountAddress: row.accountAddress.toLowerCase(),
    accountName: account.name ?? 'Company account', counterpartyAddress: row.beneficiaryWallet.toLowerCase(),
    direction: row.direction, companyTransfer: !!companyAccountName, companyAccountName,
    treasuryTransferId: transfer?._id, deliveryFeeRaw: transfer && row.direction === 'inflow' ? transfer.deliveryFee : undefined,
    treasuryServiceId: row.treasuryServiceId, lendingMovement: row.serviceKind === "conversion" ? undefined : row.serviceKind,
    conversionMovement: row.serviceKind === "conversion" ? row.direction : undefined,
    customerRefund: refundInvoice ? true : undefined,
    references: [...bills.filter(bill => bill.orgId === orgId && bill.beneficiaryId === row.beneficiaryId).map(bill => ({ kind: 'bill' as const, id: bill._id, number: bill.invoiceNumber })),...(refundInvoice?[{kind:'invoice' as const,id:refundInvoice._id,number:refundInvoice.number}]:[])],
  });
}
import { treasuryReportRows } from './treasuryReports';
