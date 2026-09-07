import { v } from 'convex/values';
import { decodeEventLog, erc20Abi, type Hex } from 'viem';
import { action, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { requireOrgAccess } from './lib/rbac';
import { getChainClient } from './lib/safeVerification';
import { assertSameSettlement, readSettlementBlock } from './lib/settlementBlock';
import { appendAudit } from './audit';

const args = { eventId: v.id('receivableEvents'), sessionToken: v.string() };
export const context = internalQuery({ args, handler: async (ctx, args) => {
  const event = await ctx.db.get(args.eventId);
  if (!event) throw new Error('Invoice receipt not found');
  await requireOrgAccess(ctx, event.orgId, args.sessionToken, ['admin', 'approver', 'initiator', 'clerk', 'viewer']);
  const invoice = await ctx.db.get(event.invoiceId);
  if (!invoice || invoice.orgId !== event.orgId || !invoice.receivingAddress) throw new Error('Invoice receiving instructions are unavailable');
  return { event, invoice };
} });
export const save = internalMutation({ args: { ...args, txHash: v.string(), blockNumber: v.string(), blockHash: v.string(), amount: v.string(),
  logIndex: v.number(), settledAt: v.number(), fromAddress: v.string(), toAddress: v.string() }, handler: async (ctx, args) => {
  const event = await ctx.db.get(args.eventId);
  if (!event) throw new Error('Invoice receipt not found');
  const { user } = await requireOrgAccess(ctx, event.orgId, args.sessionToken, ['admin', 'approver', 'initiator', 'clerk', 'viewer']);
  if (event.txHash.toLowerCase() !== args.txHash.toLowerCase() || event.blockHash.toLowerCase() !== args.blockHash.toLowerCase()
    || event.blockNumber !== args.blockNumber || event.amount !== args.amount || event.logIndex !== args.logIndex)
    throw new Error('The saved receipt changed. Review its original settlement before trying again.');
  assertSameSettlement(event.settledAt === undefined ? undefined : { blockNumber: event.blockNumber, blockHash: event.blockHash, timestamp: event.settledAt },
    { blockNumber: args.blockNumber, blockHash: args.blockHash, timestamp: args.settledAt });
  if (event.fromAddress && event.fromAddress.toLowerCase() !== args.fromAddress || event.toAddress && event.toAddress.toLowerCase() !== args.toAddress)
    throw new Error('The saved receipt addresses do not match the network evidence');
  if (event.settledAt !== undefined && event.fromAddress && event.toAddress) return;
  await ctx.db.patch(event._id, { settledAt: args.settledAt, fromAddress: args.fromAddress, toAddress: args.toAddress });
  await appendAudit(ctx, { orgId: event.orgId, actorUserId: user._id, action: 'accounting.receipt_evidence_verified', objectType: 'receivable',
    objectId: event.invoiceId, timestamp: Date.now(), metadata: { eventId: event._id, txHash: event.txHash } });
} });

/** Enrich a historical receipt without resetting its scan cursor, recounting
 * invoice principal, or invoking a forwarder. Safe to repeat after interruption. */
export const verify = action({ args, handler: async (ctx, args): Promise<void> => {
  const { event, invoice } = await ctx.runQuery(internal.receiptEvidence.context, args);
  const client = getChainClient(invoice.chainId);
  const receipt = await client.getTransactionReceipt({ hash: event.txHash as Hex });
  if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== event.txHash.toLowerCase()
    || String(receipt.blockNumber) !== event.blockNumber || receipt.blockHash.toLowerCase() !== event.blockHash.toLowerCase())
    throw new Error('This receipt no longer matches its recorded transaction and block. Review the original receipt.');
  const head = [11155111, 84532].includes(invoice.chainId) ? (await client.getBlockNumber()) - 1n : (await client.getBlock({ blockTag: 'finalized' })).number;
  if (head === null || head < receipt.blockNumber) throw new Error('This receipt needs more network confirmations');
  const log = receipt.logs.find(log => log.logIndex === event.logIndex && log.address.toLowerCase() === invoice.tokenAddress.toLowerCase());
  if (!log || log.removed || log.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error('The exact invoice transfer could not be verified');
  const decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics });
  const fromAddress = decoded.args.from.toLowerCase(), toAddress = decoded.args.to.toLowerCase();
  if (decoded.args.value.toString() !== event.amount || (event.kind === 'received'
    ? toAddress !== invoice.receivingAddress : fromAddress !== invoice.receivingAddress || toAddress !== invoice.treasury.toLowerCase()))
    throw new Error('The invoice amount or receiving instructions do not match this transfer');
  const block = await readSettlementBlock(client, invoice.chainId, receipt);
  await ctx.runMutation(internal.receiptEvidence.save, { ...args, txHash: event.txHash, blockNumber: event.blockNumber, blockHash: event.blockHash,
    amount: event.amount, logIndex: event.logIndex, settledAt: block.timestamp, fromAddress, toAddress });
} });
