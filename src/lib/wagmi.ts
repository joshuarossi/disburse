import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

// Token addresses on Sepolia
export const TOKENS = {
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
} as const;

export const config = getDefaultConfig({
  appName: 'Disburse',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [sepolia],
  ssr: false,
});
