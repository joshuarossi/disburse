/**
 * Chain and token configuration for multi-chain support.
 * Single source of truth for supported chains and token addresses per chain.
 */

import { mainnet, polygon, base, arbitrum, sepolia, baseSepolia } from 'wagmi/chains';

export type SupportedChainId = 1 | 137 | 8453 | 42161 | 11155111 | 84532;

export interface TokenConfig {
  address: `0x${string}`;
  decimals: number;
  symbol: string;
}

export interface ChainTokenConfig {
  USDC: TokenConfig;
  USDT: TokenConfig;
  PYUSD?: TokenConfig;
}

// Canonical token addresses per chain (Circle USDC, Tether USDT, Paxos PYUSD where available)
const CHAIN_TOKENS: Record<SupportedChainId, ChainTokenConfig> = {
  // Ethereum mainnet
  1: {
    USDC: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const,
      decimals: 6,
      symbol: 'USDC',
    },
    USDT: {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const,
      decimals: 6,
      symbol: 'USDT',
    },
    PYUSD: {
      address: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8' as const,
      decimals: 6,
      symbol: 'PYUSD',
    },
  },
  // Polygon
  137: {
    USDC: {
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as const,
      decimals: 6,
      symbol: 'USDC',
    },
    USDT: {
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as const,
      decimals: 6,
      symbol: 'USDT',
    },
  },
  // Base
  8453: {
    USDC: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
      decimals: 6,
      symbol: 'USDC',
    },
    USDT: {
      address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' as const,
      decimals: 6,
      symbol: 'USDT',
    },
  },
  // Arbitrum One
  42161: {
    USDC: {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const,
      decimals: 6,
      symbol: 'USDC',
    },
    USDT: {
      address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' as const,
      decimals: 6,
      symbol: 'USDT',
    },
    PYUSD: {
      address: '0x46850aD61C2B7d64d08c9C754F45254596696984' as const,
      decimals: 6,
      symbol: 'PYUSD',
    },
  },
  // Sepolia
  11155111: {
    USDC: {
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const,
      decimals: 6,
      symbol: 'USDC',
    },
    USDT: {
      address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06' as const,
      decimals: 6,
      symbol: 'USDT',
    },
    PYUSD: {
      address: '0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9' as const,
      decimals: 6,
      symbol: 'PYUSD',
    },
  },
  // Base Sepolia
  84532: {
    USDC: {
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
      decimals: 6,
      symbol: 'USDC',
    },
    USDT: {
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const, // Using USDC address as placeholder
      decimals: 6,
      symbol: 'USDT',
    },
  },
};

export const SUPPORTED_CHAINS = [mainnet, polygon, base, arbitrum, sepolia, baseSepolia] as const;

export const SUPPORTED_CHAIN_IDS: SupportedChainId[] = [1, 137, 8453, 42161, 11155111, 84532];

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
  const prefix = SAFE_APP_CHAIN_PREFIX[chainId as SupportedChainId] ?? `chain-${chainId}`;
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

export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId);
}

/**
 * Get token configs for a chain. Returns only tokens that exist on that chain.
 */
export function getTokensForChain(chainId: number): Record<string, TokenConfig> {
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
