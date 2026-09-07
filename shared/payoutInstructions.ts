/** Saved payout instructions are constraints, not suggestions to overwrite. */
export function payoutInstructionError(
  recipient: {
    name: string;
    preferredToken?: string;
    preferredChainId?: number;
  },
  payment: { token: string; chainId: number },
): string | undefined {
  if (
    recipient.preferredToken &&
    recipient.preferredToken.toUpperCase() !== payment.token.toUpperCase()
  ) {
    return `${recipient.name} requests ${recipient.preferredToken.toUpperCase()}. This payment uses ${payment.token.toUpperCase()}. Create a payment in the requested currency; automatic conversion is not available.`;
  }
  if (
    recipient.preferredChainId !== undefined &&
    recipient.preferredChainId !== payment.chainId
  ) {
    return `${recipient.name} requests a different network. Select a funding account on their saved network; automatic bridging is not available.`;
  }
}

export function assertPayoutInstructions(
  recipient: Parameters<typeof payoutInstructionError>[0],
  payment: Parameters<typeof payoutInstructionError>[1],
) {
  const error = payoutInstructionError(recipient, payment);
  if (error) throw new Error(error);
}
import { CHAIN_TOKENS, type SupportedChainId } from "./chains";

export function validateSavedPayoutInstructions(recipient: {
  preferredToken?: string | null;
  preferredChainId?: number | null;
}) {
  const token = recipient.preferredToken?.toUpperCase();
  const network = recipient.preferredChainId;
  if (token && !["USDC", "USDT", "PYUSD"].includes(token))
    throw new Error(`Unsupported payout currency: ${token}`);
  if (network != null && !CHAIN_TOKENS[network as SupportedChainId])
    throw new Error("Unsupported payout network");
  if (
    token &&
    network != null &&
    !Object.keys(CHAIN_TOKENS[network as SupportedChainId]).includes(token)
  )
    throw new Error(
      `${token} is not supported on the requested payout network`,
    );
}

export function parsePayoutNetwork(value: string): number | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, "");
  if (!normalized) return undefined;
  const networks: Record<string, number> = {
    ethereum: 1,
    mainnet: 1,
    polygon: 137,
    base: 8453,
    arbitrum: 42161,
    arbitrumone: 42161,
    sepolia: 11155111,
    basesepolia: 84532,
  };
  return networks[normalized] ?? Number(normalized);
}
