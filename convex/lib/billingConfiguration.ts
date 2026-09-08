import { billingNetwork } from '../../shared/billingNetwork';
import { circleConfiguration } from '../../shared/circleExecution';

export const PAYMENT_TOKEN_BY_CHAIN: Record<number, string> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC (Ethereum mainnet)
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Circle test USDC
  8453: circleConfiguration(8453).token,
  84532: circleConfiguration(84532).token,
  42161: circleConfiguration(42161).token,
};

export const RPC_URL_BY_CHAIN: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  8453: 'https://base-rpc.publicnode.com',
  84532: 'https://base-sepolia-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
  421614: 'https://arbitrum-sepolia-rpc.publicnode.com',
};


export function getTreasuryAddress(): string {
  const raw = (
    process.env.DISBURSE_BENEFICIARY_ADDRESS ??
    process.env.VITE_DISBURSE_BENEFICIARY_ADDRESS ??
    ""
  )
    .toString()
    .trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw) || /^0x0{40}$/i.test(raw)) {
    throw new Error(
      "Subscription payments are not configured (missing DISBURSE_BENEFICIARY_ADDRESS)",
    );
  }
  return raw.toLowerCase();
}

export function getPaymentChainId(): number {
  const raw = (
    process.env.DISBURSE_BENEFICIARY_CHAIN_ID ??
    process.env.VITE_DISBURSE_BENEFICIARY_CHAIN_ID ??
    "1"
  ).toString();
  const n = Number(raw);
  if (!PAYMENT_TOKEN_BY_CHAIN[n])
    throw new Error("Unsupported subscription payment network");
  return n;
}

export function paymentConfiguration() {
  try {
    const chainId = getPaymentChainId();
    return {
      chainId,
      treasury: getTreasuryAddress(),
      tokenAddress: PAYMENT_TOKEN_BY_CHAIN[chainId],
      symbol: "USDC" as const,
      decimals: 6,
      ...billingNetwork(chainId),
    };
  } catch {
    return null;
  }
}
