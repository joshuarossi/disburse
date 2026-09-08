import type { Infer } from 'convex/values';
import { v } from 'convex/values';
import { formatUnits } from 'viem';
import type { QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { configuredTokenAddress, identifyAsset, type AssetIdentity } from '../../shared/assets';
import { reportRowFields } from './reportValidators';
import { isCircleFeeMovement } from './circleFeeReports';

export const reportRowValidator = v.object(reportRowFields);
export type ReportRow = Infer<typeof reportRowValidator>;
export function exactReportAmount(amount: string, asset: { recognized: boolean; decimals?: number }) {
  return asset.recognized && amount.length <= 100 && /^\d+(\.\d+)?$/.test(amount)
    && (amount.split('.')[1]?.length ?? 0) <= (asset.decimals ?? 0);
}
type ReportAsset = Pick<ReportRow, 'assetId' | 'chainId' | 'tokenAddress' | 'token' | 'decimals' | 'recognized' | 'environment' | 'network'>;
export function assetFields(asset: ReportAsset): AssetIdentity {
  const { assetId, chainId, tokenAddress, token, decimals, recognized, environment, network } = asset;
  return { assetId, chainId, tokenAddress, token, decimals, recognized, environment, network };
}

export async function paymentReportRows(ctx: QueryCtx, id: Id<'disbursements'>, withTransfers = true): Promise<ReportRow[]> {
  const d = await ctx.db.get(id);
  if (!d || d.status !== 'executed') return [];
  const account = await ctx.db.get(d.safeId);
  const asset = identifyAsset(d.chainId, d.tokenAddress ?? configuredTokenAddress(d.chainId, d.token), d.token);
  const common = { sourceId: d._id, createdAt: d.settlement?.timestamp ?? d.executedAt ?? d.updatedAt ?? d.createdAt,
    observedAt: d.executedAt ?? d.updatedAt ?? d.createdAt, dateSource: d.settlement ? 'settlement' as const : 'recorded' as const,
    blockNumber: d.settlement?.blockNumber, blockHash: d.settlement?.blockHash, status: d.status,
    memo: d.memo, txHash: d.txHash, safeId: d.safeId, accountAddress: account?.safeAddress ?? '', direction: 'outflow' as const };
  const rows: ReportRow[] = [];
  if (d.executionFee) {
    const feeAsset = identifyAsset(d.chainId, d.executionFee.tokenAddress, d.executionFee.token);
    rows.push({ ...common, ...feeAsset, rowId: `${d._id}:fee`, kind: 'fee', amount: d.executionFee.amount,
      beneficiaryName: 'Payment fee', beneficiaryWallet: d.executionFee.collector,
      includedInTotals: exactReportAmount(d.executionFee.amount, feeAsset) && feeAsset.environment !== 'unclassified' });
  }
  const recipients: { _id: string; beneficiaryId?: Id<'beneficiaries'>; recipientName?: string; recipientAddress?: string; amount: string }[] = d.type === 'batch'
    ? await ctx.db.query('disbursementRecipients').withIndex('by_disbursement', q => q.eq('disbursementId', d._id)).take(501)
    : [{ _id: 'payment', beneficiaryId: d.beneficiaryId, recipientName: d.recipientName,
      recipientAddress: d.recipientAddress, amount: d.amount ?? '0' }];
  if (recipients.length > 500) throw new Error('This historical batch exceeds the 500-recipient report indexing limit');
  if (!recipients.length) recipients.push({ _id: 'batch', beneficiaryId: undefined,
    recipientName: 'Batch', recipientAddress: '', amount: d.totalAmount ?? d.amount ?? '0' });
  for (const r of recipients) {
    const b = r.beneficiaryId ? await ctx.db.get(r.beneficiaryId) : null;
    rows.push({ ...common, ...asset, rowId: `${d._id}:${r._id}`, kind: 'payment', amount: r.amount,
      beneficiaryId: b?.orgId === d.orgId ? b._id : undefined,
      beneficiaryName: r.recipientName ?? (b?.orgId === d.orgId ? b.name : 'Unknown recipient'),
      beneficiaryWallet: r.recipientAddress ?? (b?.orgId === d.orgId ? b.walletAddress : ''),
      includedInTotals: exactReportAmount(r.amount, asset) && asset.environment !== 'unclassified' });
  }
  const hasTransferHistory = withTransfers && d.txHash ? !!(await ctx.db.query('outgoingTransfers')
    .withIndex('by_safe_tx', q => q.eq('safeId', d.safeId).eq('txHash', d.txHash!.toLowerCase())).first()) : false;
  if (withTransfers) for (const row of rows) {
    const transfer = await ctx.db.query('outgoingTransfers').withIndex('by_payment_row', q => q.eq('paymentRowId', row.rowId)).unique();
    if (!transfer || transfer.orgId !== d.orgId || transfer.safeId !== d.safeId || transfer.paymentId !== d._id) {
      // Once chain movements exist, an unmatched intent must not be counted
      // alongside a possibly identical transfer with different legacy details.
      if (hasTransferHistory) { row.includedInTotals = false; row.transferMatch = 'pending'; }
      continue;
    }
    row.transferMatch = 'matched';
    row.rowId = transfer.reconciliationId ?? row.rowId;
    row.transferId = transfer.transferId;
    row.amountRaw = transfer.amountRaw;
    row.createdAt = d.settlement?.timestamp ?? transfer.timestamp;
    row.dateSource = d.settlement ? 'settlement' : 'provider';
    row.blockNumber = d.settlement?.blockNumber ?? String(transfer.blockNumber);
  }
  return rows;
}

export async function depositReportRows(ctx: QueryCtx, id: Id<'deposits'>): Promise<ReportRow[]> {
  const d = await ctx.db.get(id);
  if (!d || d.supersededBy || await isCircleFeeMovement(ctx, d, 'refund')) return [];
  const account = await ctx.db.get(d.safeId);
  const asset = identifyAsset(d.chainId, d.tokenAddress, d.tokenSymbol);
  const validRaw = d.amountRaw.length <= 100 && /^\d+$/.test(d.amountRaw);
  const amount = asset.recognized && validRaw ? formatUnits(BigInt(d.amountRaw), asset.decimals!) : d.amount;
  return [{ ...asset, sourceId: d._id, rowId: `${d._id}:deposit`, createdAt: d.timestamp,
    observedAt: d.createdAt, dateSource: 'provider', blockNumber: d.blockNumber === undefined ? undefined : String(d.blockNumber),
    amount, amountRaw: d.amountRaw, transferId: d.transferId, status: 'received', txHash: d.txHash, beneficiaryName: 'External', beneficiaryWallet: d.fromAddress ?? '',
    safeId: d.safeId, accountAddress: account?.safeAddress ?? d.safeAddress, kind: 'deposit', direction: 'inflow',
    includedInTotals: validRaw && exactReportAmount(amount, asset) && asset.environment !== 'unclassified' }];
}

export async function outgoingReportRows(ctx: QueryCtx, id: Id<'outgoingTransfers'>): Promise<ReportRow[]> {
  const t = await ctx.db.get(id);
  if (!t || await isCircleFeeMovement(ctx, t, 'prefund')) return [];
  if (t.matchError) throw new Error(t.matchError);
  if (t.paymentId && t.paymentRowId) {
    const payment = await ctx.db.get(t.paymentId);
    if (payment?.status === 'executed' && payment.orgId === t.orgId && payment.safeId === t.safeId) return [];
  }
  const asset = identifyAsset(t.chainId, t.tokenAddress, t.tokenSymbol);
  const validRaw = /^\d{1,100}$/.test(t.amountRaw);
  const amount = validRaw && asset.recognized ? formatUnits(BigInt(t.amountRaw), asset.decimals!) : t.amount;
  return [{ ...asset, rowId: t.reconciliationId ?? `${t._id}:transfer`, sourceId: t._id, kind: 'account_transfer', direction: 'outflow',
    amount, amountRaw: t.amountRaw, createdAt: t.timestamp, observedAt: t.createdAt, dateSource: 'provider', blockNumber: String(t.blockNumber),
    transferId: t.transferId, txHash: t.txHash, status: 'executed', beneficiaryName: 'Unmatched outflow', beneficiaryWallet: t.toAddress,
    safeId: t.safeId, accountAddress: t.safeAddress, memo: 'No matching Disburse payment · review against your books',
    includedInTotals: validRaw && exactReportAmount(amount, asset) && asset.environment !== 'unclassified' }];
}
