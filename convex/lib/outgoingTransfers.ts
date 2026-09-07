import { v, type Infer } from 'convex/values';
import { parseUnits } from 'viem';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { paymentReportRows, exactReportAmount } from './reportRows';
import { queueReportSource } from './reportIndex';

export const outgoingTransferFields = {
  orgId: v.id('orgs'), safeId: v.id('safes'), chainId: v.number(), safeAddress: v.string(),
  tokenAddress: v.string(), tokenSymbol: v.string(), decimals: v.number(), amountRaw: v.string(), amount: v.string(),
  txHash: v.string(), transferId: v.string(), blockNumber: v.optional(v.number()), timestamp: v.number(),
  fromAddress: v.string(), toAddress: v.string(), source: v.literal('safe_tx_service'),
};
export const outgoingTransferValidator = v.object(outgoingTransferFields);

export async function storeOutgoingTransfer(ctx: MutationCtx, input: Infer<typeof outgoingTransferValidator>) {
  const args = { ...input, safeAddress: input.safeAddress.toLowerCase(), tokenAddress: input.tokenAddress.toLowerCase(),
    fromAddress: input.fromAddress.toLowerCase(), toAddress: input.toAddress.toLowerCase(),
    txHash: input.txHash.toLowerCase(), transferId: input.transferId.toLowerCase() };
  const safe = await ctx.db.get(args.safeId);
  if (!safe || safe.orgId !== args.orgId || safe.chainId !== args.chainId || safe.safeAddress.toLowerCase() !== args.safeAddress || args.fromAddress !== args.safeAddress)
    throw new Error('Outgoing transfer does not belong to this account and network');
  if (![args.tokenAddress, args.toAddress].every(a => /^0x[\da-f]{40}$/.test(a)) || !/^0x[\da-f]{64}$/.test(args.txHash)
    || !/^[ei][\da-f_,]{64,511}$/.test(args.transferId) || !args.transferId.startsWith(`${args.tokenAddress === '0x0000000000000000000000000000000000000000' ? 'i' : 'e'}${args.txHash.slice(2)}`)
    || !/^\d{1,100}$/.test(args.amountRaw) || !Number.isInteger(args.decimals) || args.decimals < 0 || args.decimals > 255
    || !Number.isSafeInteger(args.timestamp) || args.timestamp < 0 || args.timestamp > Date.now()
    || !Number.isSafeInteger(args.blockNumber) || args.blockNumber! < 0)
    throw new Error('Invalid outgoing transfer identity, units or date');
  const existing = await ctx.db.query('outgoingTransfers').withIndex('by_safe_transfer', q => q.eq('safeId', safe._id).eq('transferId', args.transferId)).unique();
  if (existing) {
    if (existing.txHash !== args.txHash || existing.tokenAddress !== args.tokenAddress || BigInt(existing.amountRaw) !== BigInt(args.amountRaw)
      || existing.fromAddress !== args.fromAddress || existing.toAddress !== args.toAddress || existing.blockNumber !== args.blockNumber || existing.timestamp !== args.timestamp)
      throw new Error('Outgoing transfer conflicts with its previously recorded chain evidence');
    return existing._id;
  }
  const id = await ctx.db.insert('outgoingTransfers', { ...args, createdAt: Date.now() });
  await queueReportSource(ctx, args.orgId, 'outgoing', id);
  return id;
}

/** A receipt log can satisfy exactly one recipient/fee leg, including identical batch amounts. */
export async function matchOutgoingPayment(ctx: MutationCtx, payment: Doc<'disbursements'>) {
  const changed: Id<'outgoingTransfers'>[] = [];
  if (payment.status !== 'executed' || !payment.txHash) return changed;
  const transfers = await ctx.db.query('outgoingTransfers').withIndex('by_safe_tx', q => q.eq('safeId', payment.safeId).eq('txHash', payment.txHash!.toLowerCase())).take(1001);
  if (!transfers.length) return changed;
  if (transfers.length > 1000) throw new Error('This transaction exceeds the 1,000-transfer reconciliation limit');
  const rows = await paymentReportRows(ctx, payment._id, false);
  const claimed = new Set(transfers.filter(t => t.paymentRowId).map(t => t.paymentRowId));
  for (const row of rows) {
    if (claimed.has(row.rowId) || !exactReportAmount(row.amount, row)) continue;
    const amountRaw = parseUnits(row.amount, row.decimals!);
    const transfer = transfers.find(t => !t.paymentRowId && t.orgId === payment.orgId && t.chainId === payment.chainId
      && t.tokenAddress === row.tokenAddress?.toLowerCase() && t.toAddress === row.beneficiaryWallet.toLowerCase() && BigInt(t.amountRaw) === amountRaw);
    if (!transfer) continue;
    if (payment.settlement && (payment.settlement.blockNumber !== String(transfer.blockNumber) || payment.settlement.timestamp !== transfer.timestamp)) {
      await ctx.db.patch(transfer._id, { matchError: 'The indexed transfer date differs from the verified payment block. Recheck the original transaction before exporting.' });
      await queueReportSource(ctx, payment.orgId, 'outgoing', transfer._id);
      continue;
    }
    transfer.paymentRowId = row.rowId;
    await ctx.db.patch(transfer._id, { paymentId: payment._id, paymentRowId: row.rowId,
      reconciliationId: transfer.reconciliationId ?? row.rowId, matchError: undefined });
    claimed.add(row.rowId); changed.push(transfer._id);
    await queueReportSource(ctx, payment.orgId, 'outgoing', transfer._id);
  }
  return changed;
}

export async function matchOutgoingTransaction(ctx: MutationCtx, safeId: Id<'safes'>, txHash: string) {
  const payments = await ctx.db.query('disbursements').withIndex('by_safe_tx', q => q.eq('safeId', safeId).eq('txHash', txHash)).take(21);
  if (payments.length > 20) throw new Error('This transaction exceeds the linked-payment reconciliation limit');
  for (const payment of payments) {
    await matchOutgoingPayment(ctx, payment);
    // Even an unmatched transfer changes the evidence available for this intent.
    if (payment.status === 'executed') await queueReportSource(ctx, payment.orgId, 'payment', payment._id);
  }
  const transfers = await ctx.db.query('outgoingTransfers').withIndex('by_safe_tx', q => q.eq('safeId', safeId).eq('txHash', txHash)).take(1001);
  if (transfers.length > 1000) throw new Error('This transaction exceeds the 1,000-transfer reconciliation limit');
  for (const transfer of transfers) if (!transfer.reconciliationId) await ctx.db.patch(transfer._id, { reconciliationId: `${transfer._id}:transfer` });
}
