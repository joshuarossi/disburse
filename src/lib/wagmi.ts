import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { fallback, http } from 'viem';
import { getTokensForChain, SUPPORTED_CHAINS } from './chains';

// Backward compatibility: Sepolia tokens (existing Dashboard/Settings use TOKENS.USDC / TOKENS.USDT)
const sepoliaTokens = getTokensForChain(11155111);
export const TOKENS = {
  USDC: {
    address: (sepoliaTokens.USDC?.address ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as `0x${string}`,
    decimals: sepoliaTokens.USDC?.decimals ?? 6,
    symbol: 'USDC',
  },
  USDT: {
    address: (sepoliaTokens.USDT?.address ?? '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06') as `0x${string}`,
    decimals: sepoliaTokens.USDT?.decimals ?? 6,
    symbol: 'USDT',
  },
} as const;

// When set, use a single RPC (e.g. Alchemy/Infura). Otherwise use fallback list below.
// Free public RPCs often throttle or return -32046 "Cannot fulfill request" under load.
const ENV_RPC: Record<number, string | undefined> = {
  1: import.meta.env.VITE_ETHEREUM_RPC_URL,
  137: import.meta.env.VITE_POLYGON_RPC_URL,
  8453: import.meta.env.VITE_BASE_RPC_URL,
  42161: import.meta.env.VITE_ARBITRUM_RPC_URL,
  11155111: import.meta.env.VITE_SEPOLIA_RPC_URL,
  84532: import.meta.env.VITE_BASE_SEPOLIA_RPC_URL,
};

// Fallback RPC lists (CORS-friendly). If one returns -32046 or fails, the next is tried.
const FALLBACK_RPC_URLS: Record<number, string[]> = {
  1: [
    'https://rpc.ankr.com/eth',
    'https://ethereum.publicnode.com',
    'https://cloudflare-eth.com',
  ],
  137: [
    'https://rpc.ankr.com/polygon',
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon.llamarpc.com',
  ],
  8453: ['https://mainnet.base.org'],
  42161: ['https://arb1.arbitrum.io/rpc'],
  11155111: ['https://rpc.sepolia.org'],
  84532: ['https://sepolia.base.org'],
};

function transportForChain(chainId: number) {
  const envUrl = ENV_RPC[chainId];
  if (envUrl) return http(envUrl);
  const urls = FALLBACK_RPC_URLS[chainId];
  if (!urls?.length) return undefined;
  if (urls.length === 1) return http(urls[0]);
  return fallback(urls.map((url) => http(url)));
}

const transports = SUPPORTED_CHAINS.reduce(
  (acc, chain) => {
    const transport = transportForChain(chain.id);
    if (transport) acc[chain.id] = transport;
    return acc;
  },
  {} as Record<(typeof SUPPORTED_CHAINS)[number]['id'], ReturnType<typeof http>>
);

export const config = getDefaultConfig({
  appName: 'Disburse',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: SUPPORTED_CHAINS,
  transports,
  ssr: false,
});
