/**
 * Chain and token configuration for multi-chain support.
 * Single source of truth for supported chains and token addresses per chain.
 */

import {
  mainnet,
  polygon,
  base,
  arbitrum,
  sepolia,
  baseSepolia,
} from 'wagmi/chains';

import {
  CHAIN_TOKENS,
  type SupportedChainId,
  type TokenConfig,
} from '../../shared/chains';
export type {
  SupportedChainId,
  TokenConfig,
  ChainTokenConfig,
} from '../../shared/chains';

export const SUPPORTED_CHAINS = [
  mainnet,
  polygon,
  base,
  arbitrum,
  sepolia,
  baseSepolia,
] as const;

export const SUPPORTED_CHAIN_IDS: SupportedChainId[] = [
  1, 137, 8453, 42161, 11155111, 84532,
];

export const CHAIN_ID_TO_CHAIN = {
  1: mainnet,
  137: polygon,
  8453: base,
  42161: arbitrum,
  11155111: sepolia,
  84532: baseSepolia,
} as const;

export interface ChainInfo {
  chainId: SupportedChainId;
  chainName: string;
}

export const CHAINS_LIST: ChainInfo[] = [
  { chainId: 1, chainName: 'Ethereum' },
  { chainId: 137, chainName: 'Polygon' },
  { chainId: 8453, chainName: 'Base' },
  { chainId: 42161, chainName: 'Arbitrum' },
  { chainId: 11155111, chainName: 'Sepolia' },
  { chainId: 84532, chainName: 'Base Sepolia' },
];

export function getChainName(chainId: number): string {
  const info = CHAINS_LIST.find((c) => c.chainId === chainId);
  return info?.chainName ?? `Chain ${chainId}`;
}

/** Safe app URL path prefix per chain (e.g. eth, matic, base) */
const SAFE_APP_CHAIN_PREFIX: Record<SupportedChainId, string> = {
  1: 'eth',
  137: 'matic',
  8453: 'base',
  42161: 'arbitrum',
  11155111: 'sep',
  84532: 'basesep',
};

/**
 * Get "View on Safe" URL for a Safe address on a given chain.
 */
export function getSafeAppUrl(chainId: number, safeAddress: string): string {
  const prefix =
    SAFE_APP_CHAIN_PREFIX[chainId as SupportedChainId] ?? `chain-${chainId}`;
  return `https://app.safe.global/${prefix}:${safeAddress}`;
}

/**
 * Get block explorer transaction URL for a chain (e.g. Etherscan, Basescan).
 */
export function getBlockExplorerTxUrl(chainId: number, txHash: string): string {
  const chain = CHAIN_ID_TO_CHAIN[chainId as SupportedChainId];
  const baseUrl = chain?.blockExplorers?.default?.url;
  if (baseUrl) return `${baseUrl}/tx/${txHash}`;
  return `https://etherscan.io/tx/${txHash}`;
}

export function isSupportedChainId(
  chainId: number,
): chainId is SupportedChainId {
  return SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId);
}

/**
 * Get token configs for a chain. Returns only tokens that exist on that chain.
 */
export function getTokensForChain(
  chainId: number,
): Record<string, TokenConfig> {
  const config = CHAIN_TOKENS[chainId as SupportedChainId];
  if (!config) return {};
  const result: Record<string, TokenConfig> = {};
  for (const [symbol, token] of Object.entries(config)) {
    if (token) result[symbol] = token;
  }
  return result;
}

/**
 * Get list of token symbols available on a chain.
 */
export function getTokenSymbolsForChain(chainId: number): string[] {
  return Object.keys(getTokensForChain(chainId));
}

export { CHAIN_TOKENS };


/** Public browser RPC configuration. Subscription or service secrets never belong here. */
export function getPublicRpcUrl(chainId: number): string | undefined {
  const configured = import.meta.env?.[`VITE_RPC_URL_${chainId}`];
  if (configured) return configured;
  if (chainId === 11155111) return import.meta.env?.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  return undefined;
}
