import { v, type Infer } from 'convex/values';
import type { TransactionReceipt } from 'viem';
import type { getChainClient } from './safeVerification';

export const settlementBlockValidator = v.object({ blockNumber: v.string(), blockHash: v.string(), timestamp: v.number() });
export type SettlementBlock = Infer<typeof settlementBlockValidator>;
export function validateSettlementBlock(value: SettlementBlock) {
  if (!/^\d{1,30}$/.test(value.blockNumber) || !/^0x[\da-f]{64}$/i.test(value.blockHash)
    || !Number.isSafeInteger(value.timestamp) || value.timestamp <= 0 || value.timestamp > Date.now() + 300_000)
    throw new Error('The confirmed settlement block has invalid date or identity evidence');
}
export async function readSettlementBlock(
  client: Pick<ReturnType<typeof getChainClient>, 'getBlock' | 'getChainId'>,
  chainId: number,
  receipt: Pick<TransactionReceipt, 'blockNumber' | 'blockHash'>,
): Promise<SettlementBlock> {
  const [network, block] = await Promise.all([client.getChainId(), client.getBlock({ blockNumber: receipt.blockNumber })]);
  if (network !== chainId || block.number !== receipt.blockNumber || !block.hash || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
    throw new Error('The settlement receipt no longer matches its network block');
  const evidence = { blockNumber: String(block.number), blockHash: block.hash.toLowerCase(), timestamp: Number(block.timestamp) * 1000 };
  validateSettlementBlock(evidence);
  return evidence;
}
export function assertSameSettlement(previous: SettlementBlock | undefined, next: SettlementBlock) {
  validateSettlementBlock(next);
  if (previous && (previous.blockNumber !== next.blockNumber || previous.blockHash.toLowerCase() !== next.blockHash.toLowerCase() || previous.timestamp !== next.timestamp))
    throw new Error('This payment already has different settlement evidence. Review the original receipt before changing its accounting date.');
}
