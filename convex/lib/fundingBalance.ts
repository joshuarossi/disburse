import { parseAbi, type Address } from 'viem';
import { CHAIN_TOKENS, type SupportedChainId } from '../../shared/chains';
import { paymentDebits, type ExecutionFee } from '../../shared/executionFee';
import { amountToBaseUnits, formatBaseUnits } from './validation';
import { getChainClient } from './safeVerification';

export async function assertFundingBalance(chainId: number, safeAddress: string, token: string, amount: string, fee?: ExecutionFee) {
  const client = getChainClient(chainId);
  const blockNumber = await client.getBlockNumber();
  for (const debit of paymentDebits(token, amount, fee)) {
    const config = Object.entries(CHAIN_TOKENS[chainId as SupportedChainId] ?? {}).find(([symbol]) => symbol === debit.token)?.[1];
    if (!config) throw new Error('Unsupported payment currency');
    const balance = await client.readContract({ address: config.address, abi: parseAbi(['function balanceOf(address account) view returns (uint256)']), functionName: 'balanceOf', args: [safeAddress as Address], blockNumber });
    if (balance < amountToBaseUnits(debit.amount, debit.token)) throw new Error(`The funding account needs ${debit.amount} ${debit.token}, including applicable fees. Available: ${formatBaseUnits(balance, debit.token)} ${debit.token}.`);
  }
}
