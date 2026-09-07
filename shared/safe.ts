// Safe Transaction Service endpoints used by the client and backend.
const SAFE_TX_SERVICE_URL_BY_CHAIN: Record<number, string> = {
  1: "https://api.safe.global/tx-service/eth/api",
  137: "https://api.safe.global/tx-service/pol/api",
  8453: "https://api.safe.global/tx-service/base/api",
  42161: "https://api.safe.global/tx-service/arb1/api",
  11155111: "https://api.safe.global/tx-service/sep/api",
  84532: "https://api.safe.global/tx-service/basesep/api",
};

export function getSafeTxServiceUrl(chainId: number): string {
  const url = SAFE_TX_SERVICE_URL_BY_CHAIN[chainId];
  if (!url) {
    throw new Error(`Unsupported chain for Safe: ${chainId}`);
  }
  return url;
}

// Persisted cursors may predate Safe's API migration. Rewrite only the exact
// documented legacy origins and paths; never follow an arbitrary redirect.
export function normalizeSafeServiceUrl(input: string): string {
  const url = new URL(input);
  const legacy: Record<string, number> = {
    mainnet: 1,
    polygon: 137,
    base: 8453,
    arbitrum: 42161,
    sepolia: 11155111,
    "base-sepolia": 84532,
  };
  for (const [network, chainId] of Object.entries(legacy)) {
    if (
      url.origin === `https://safe-transaction-${network}.safe.global` &&
      url.pathname.startsWith("/api/")
    ) {
      const current = new URL(getSafeTxServiceUrl(chainId));
      url.host = current.host;
      url.pathname = current.pathname + url.pathname.slice(4);
      return url.toString();
    }
  }
  return input;
}
