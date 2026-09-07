import { v } from 'convex/values';
import { parseAbiItem, parseEventLogs } from 'viem';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import { getChainClient, verifySafeOwnership } from './lib/safeVerification';
import { ENTRY_POINT } from '../shared/customerPaidExecution';
import { readServiceRecord } from '../shared/customerServiceRecord';
import { assertCustomerPaidAccount } from './lib/customerPaidAccount';

const event = parseAbiItem('event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)');

/** Provider status is not settlement evidence. Read canonical EntryPoint logs for
 * the exact approved operations, including the separately paid provider fee. */
export const refresh = action({
  args: { operationId: v.id('customerOperations'), sessionToken: v.string() },
  handler: async (ctx, args): Promise<{ state: 'pending' | 'confirmed' | 'failed' | 'expired'; feePaid: boolean; workTxHash?: string }> => {
    const op = await ctx.runQuery(internal.customerOperations.identity, args);
    if (op.state !== 'pending') return { state: op.state, feePaid: op.feePaid, workTxHash: op.workTxHash };
    const record = readServiceRecord(op.record);
    const client = getChainClient(op.chainId);
    if (await client.getChainId() !== op.chainId) throw new Error('The network reader returned a different network. Try checking again.');
    const head = await client.getBlockNumber();
    if (head < 2n || head - 2n < BigInt(op.scanFrom)) return { state: 'pending', feePaid: op.feePaid };
    const finalized = head - 2n;
    const toBlock = BigInt(op.scanFrom) + 1999n < finalized ? BigInt(op.scanFrom) + 1999n : finalized;
    const [anchor, logs] = await Promise.all([
      client.getBlock({ blockNumber: toBlock }),
      client.getLogs({ address: ENTRY_POINT, event, args: { sender: record.intent.companion, userOpHash: record.quote.userOps.map(detail => detail.userOpHash) }, fromBlock: BigInt(op.scanFrom), toBlock, strict: true }),
    ]);
    let feePaid = op.feePaid, feeTxHash = op.feeTxHash, workTxHash = op.workTxHash, workSuccess = op.workSuccess;
    let state: 'pending' | 'confirmed' | 'failed' | 'expired' = 'pending';
    for (const log of logs) {
      const i = record.quote.userOps.findIndex(detail => detail.userOpHash.toLowerCase() === log.args.userOpHash.toLowerCase());
      if (i < 0 || log.removed || log.address.toLowerCase() !== ENTRY_POINT.toLowerCase() || log.args.sender.toLowerCase() !== record.intent.companion.toLowerCase() || log.args.nonce !== BigInt(record.quote.userOps[i].userOp.nonce)) continue;
      const receipt = await client.getTransactionReceipt({ hash: log.transactionHash });
      if (receipt.status !== 'success' || receipt.blockHash !== log.blockHash || receipt.blockNumber !== log.blockNumber || receipt.blockNumber > toBlock || receipt.blockNumber < BigInt(op.scanFrom)) throw new Error('The network returned inconsistent transaction evidence. Check again shortly.');
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (block.hash !== receipt.blockHash) throw new Error('The network reorganized this transaction. Check again shortly.');
      const receiptEvent = parseEventLogs({ abi: [event], logs: receipt.logs, strict: true }).find(item => !item.removed && item.address.toLowerCase() === ENTRY_POINT.toLowerCase() && item.args.userOpHash === log.args.userOpHash && item.args.sender.toLowerCase() === record.intent.companion.toLowerCase() && item.args.nonce === log.args.nonce && item.args.success === log.args.success);
      if (!receiptEvent) throw new Error('The transaction receipt does not confirm this request. Check again shortly.');
      if (i === 0) { feePaid = log.args.success; feeTxHash = log.transactionHash;  }
      else { workTxHash = log.transactionHash; workSuccess = log.args.success; }
    }
    // Advancing beyond the signed validity window after a complete scan proves
    // these exact operations can no longer execute. An outage never proves this.
    const expired = toBlock === finalized && Number(anchor.timestamp) > record.intent.validUntil;
    // A fee operation can settle separately from the work. Keep its permit
    // reserved until it settles or expires, even when the work already failed.
    if (workSuccess !== undefined && (feeTxHash || expired)) state = workSuccess ? 'confirmed' : 'failed';
    else if (workSuccess === undefined && expired) state = 'expired';
    const checkpoint = await client.getBlock({ blockNumber: toBlock });
    if (checkpoint.hash !== anchor.hash) throw new Error('The network reorganized this scan. Check again shortly.');
    return ctx.runMutation(internal.customerOperations.reconcile, { operationId: op._id, state, feePaid, feeTxHash, workTxHash, workSuccess, expectedScanFrom: op.scanFrom, scanFrom: (toBlock + 1n).toString() });
  },
});

export const completeSetup = action({
  args: { operationId: v.id('customerOperations'), sessionToken: v.string() },
  handler: async (ctx, args): Promise<{ safeId: import('./_generated/dataModel').Id<'safes'> }> => {
    const op = await ctx.runQuery(internal.customerOperations.identity, { ...args, requireAdmin: true });
    if (op.state !== 'confirmed') throw new Error('Account setup has not been confirmed');
    const record = readServiceRecord(op.record);
    if (!record.account) throw new Error('Account details are missing from the saved request');
    const verified = await verifySafeOwnership(record.account.address, op.chainId, op.walletAddress);
    const client = getChainClient(op.chainId);
    if (await client.getChainId() !== op.chainId) throw new Error('The network reader returned a different network. Try checking again.');
    await assertCustomerPaidAccount(client, record.account.address, op.chainId, await client.getBlockNumber());
    const normalized = (values: string[]) => values.map(value => value.toLowerCase()).sort().join(':');
    if (verified.threshold !== record.account.threshold || normalized(verified.owners) !== normalized(record.account.owners)) throw new Error('The deployed account has different owners or approval requirements. Review the account before linking it.');
    const linked = await ctx.runQuery(internal.customerOperations.linkedAccount, { operationId: op._id });
    const { safeId } = linked && linked.isActive !== false ? { safeId: linked._id } : await ctx.runMutation(internal.safes.storeVerified, { orgId: op.orgId, sessionToken: args.sessionToken, safeAddress: record.account.address, chainId: op.chainId, ...verified });
    await ctx.runMutation(internal.customerOperations.finish, { operationId: op._id, safeId });
    return { safeId };
  },
});
