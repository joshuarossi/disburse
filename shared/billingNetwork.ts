export function billingNetwork(chainId: number) {
  const networks: Record<
    number,
    { network: string; explorer: string; testnet: boolean }
  > = {
    1: {
      network: "Ethereum",
      explorer: "https://etherscan.io",
      testnet: false,
    },
    11155111: {
      network: "Sepolia",
      explorer: "https://sepolia.etherscan.io",
      testnet: true,
    },
    8453: { network: "Base", explorer: "https://basescan.org", testnet: false },
    84532: {
      network: "Base Sepolia",
      explorer: "https://sepolia.basescan.org",
      testnet: true,
    },
    42161: {
      network: "Arbitrum",
      explorer: "https://arbiscan.io",
      testnet: false,
    },
    421614: {
      network: "Arbitrum Sepolia",
      explorer: "https://sepolia.arbiscan.io",
      testnet: true,
    },
  };
  return networks[chainId];
}
