import { v } from 'convex/values';
import { assertPostingDate } from '../../shared/accounting';

export const balanceCheckpoint = v.object({ blockNumber: v.string(), blockHash: v.string(), timestamp: v.number(), balanceRaw: v.string() });
export const balanceProof = {
  safeId: v.id('safes'), token: v.string(), tokenAddress: v.string(), decimals: v.number(), chainId: v.number(),
  accountName: v.string(), accountAddress: v.string(), environment: v.union(v.literal('production'), v.literal('test')),
  startDate: v.string(), endDate: v.string(), opening: balanceCheckpoint, closing: balanceCheckpoint,
  inflowRaw: v.string(), outflowRaw: v.string(), differenceRaw: v.string(), movementCount: v.number(),
  unresolvedCount: v.number(), reportRevision: v.number(), historyThrough: v.number(),
  status: v.union(v.literal('matched'), v.literal('needs_review')),
};
export function balancePeriod(startDate: string, endDate: string) {
  assertPostingDate(startDate); assertPostingDate(endDate);
  const from = Date.parse(startDate), through = Date.parse(endDate) + 86_400_000;
  if (through <= from || through - from > 366 * 86_400_000) throw new Error('Choose a period of 1 to 366 days');
  if (through > Date.now()) throw new Error('Choose completed dates, through yesterday at the latest');
  return { from, through };
}
export type ChainBlock = { number: bigint; hash: string; timestamp: bigint };
export function validateBalanceBlock(block: ChainBlock, expectedNumber?: bigint) {
  if (block.number < 0n || expectedNumber !== undefined && block.number !== expectedNumber || !/^0x[\da-f]{64}$/i.test(block.hash)
    || block.timestamp < 0n || block.timestamp > BigInt(Math.floor(Date.now() / 1000) + 300))
    throw new Error('The network returned inconsistent block evidence');
  return block;
}
/** Last finalized block strictly before the UTC boundary. Exact-boundary
 * transfers belong to the following period, including chains with equal times. */
export async function blockBefore(read: (number: bigint) => Promise<ChainBlock>, finalized: ChainBlock, boundaryMs: number) {
  validateBalanceBlock(finalized);
  const target = BigInt(Math.floor(boundaryMs / 1000));
  if (finalized.timestamp < target) throw new Error('The end of this period has not been finalized on the network yet');
  let lower = 0n, upper = finalized.number;
  const first = validateBalanceBlock(await read(0n), 0n);
  if (first.timestamp >= target) throw new Error('Choose a period after this network began recording blocks');
  let result = first;
  for (let count = 0; lower < upper && count < 64; count++) {
    const middle = (lower + upper + 1n) / 2n;
    const block = validateBalanceBlock(await read(middle), middle);
    if (block.timestamp < target) { lower = middle; result = block; } else upper = middle - 1n;
  }
  if (lower !== upper) throw new Error('Could not resolve the accounting date within the block lookup limit');
  const next = validateBalanceBlock(await read(lower + 1n), lower + 1n);
  if (result.number !== lower || result.timestamp >= target || next.timestamp < target)
    throw new Error('The accounting date no longer matches its network blocks. Try the check again.');
  return result;
}
