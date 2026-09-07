export const PAYMENT_TOKEN_BY_CHAIN: Record<number, string> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC (Ethereum mainnet)
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Circle test USDC
};

export const RPC_URL_BY_CHAIN: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
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
      chainId: chainId as 1 | 11155111,
      treasury: getTreasuryAddress(),
      tokenAddress: PAYMENT_TOKEN_BY_CHAIN[chainId],
      symbol: "USDC" as const,
      decimals: 6,
      testnet: chainId === 11155111,
      network: chainId === 1 ? "Ethereum" : "Sepolia",
      explorer:
        chainId === 1 ? "https://etherscan.io" : "https://sepolia.etherscan.io",
    };
  } catch {
    return null;
  }
}
