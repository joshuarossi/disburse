import { getDefaultConfig } from '@rainbow-me/rainbowkit';
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

export const config = getDefaultConfig({
  appName: 'Disburse',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: SUPPORTED_CHAINS,
  ssr: false,
});
