import { CHAIN_TOKENS, type SupportedChainId } from '../../shared/chains';
import { amountToBaseUnits, assertValidAddress } from './validation';
import type { ExecutionFee } from '../../shared/executionFee';

// The collector belongs to the managed Gelato project. No operator key or gas wallet.
export function relayConfiguration(chainId: number, symbol: string): { fee: ExecutionFee } {
  const prefix = `GELATO_${chainId}_`;
  const collector = process.env[`${prefix}FEE_COLLECTOR`];
  const amount = process.env[`${prefix}FEE_${symbol}`];
  const token = Object.entries(CHAIN_TOKENS[chainId as SupportedChainId] ?? {}).find(([key]) => key === symbol)?.[1];
  const testnet = [11155111, 84532].includes(chainId);
  if (!process.env[testnet ? 'GELATO_TESTNET_API_KEY' : 'GELATO_API_KEY'] || !collector || !amount || !token || !['USDC', 'USDT'].includes(symbol))
    throw new Error('Managed payments are not configured for this network and fee currency. Contact support.');
  assertValidAddress(collector, 'Fee collector');
  if (amountToBaseUnits(amount, symbol) <= 0n) throw new Error('Invalid payment service fee configuration');
  return { fee: { token: symbol, tokenAddress: token.address, collector, amount } };
}
