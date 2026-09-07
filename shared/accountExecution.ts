import { keccak256, stringToHex } from 'viem';
const executionTopics = ['ExecutionSuccess(bytes32,uint256)', 'ExecutionFailure(bytes32,uint256)'].map(s => keccak256(stringToHex(s)).toLowerCase());
/** Safe and SafeL2 encode txHash in different places; both identify the same intent. */
export function accountExecutionOutcome(log: { removed?: boolean; topics: readonly string[]; data: string }, safeTxHash: string): 'success' | 'failure' | null {
  if (log.removed || !executionTopics.includes(log.topics[0]?.toLowerCase())) return null;
  const hash = log.topics.length === 2 && log.data.length === 66 ? log.topics[1] : log.topics.length === 1 && log.data.length === 130 ? `0x${log.data.slice(2, 66)}` : '';
  return hash.toLowerCase() === safeTxHash.toLowerCase() ? log.topics[0].toLowerCase() === executionTopics[0] ? 'success' : 'failure' : null;
}
export function matchesAccountExecution(log: { removed?: boolean; topics: readonly string[]; data: string }, safeTxHash: string) { return accountExecutionOutcome(log, safeTxHash) !== null; }
