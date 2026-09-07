import { CHAIN_NAMES, CHAIN_TOKENS, type SupportedChainId } from "./chains";

export type ActivityEnvironment = "production" | "test" | "unclassified";
export const NATIVE_ASSET_ADDRESS =
  "0x0000000000000000000000000000000000000000";

export function chainEnvironment(chainId?: number): ActivityEnvironment {
  if (chainId === 11155111 || chainId === 84532) return "test";
  if (chainId === 1 || chainId === 137 || chainId === 8453 || chainId === 42161)
    return "production";
  return "unclassified";
}

export function configuredTokenAddress(
  chainId: number | undefined,
  symbol: string,
) {
  const tokens = CHAIN_TOKENS[chainId as SupportedChainId];
  return tokens
    ? Object.values(tokens).find((token) => token.symbol === symbol)?.address
    : undefined;
}

/** Symbols and provider-supplied decimals are display metadata, never asset identity. */
export function identifyAsset(
  chainId: number | undefined,
  address: string | undefined,
  reportedSymbol: string,
) {
  const tokenAddress = address?.toLowerCase();
  const environment = chainEnvironment(chainId);
  const network =
    CHAIN_NAMES[chainId as SupportedChainId] ??
    (chainId ? `Network ${chainId}` : "Unknown network");
  const tokens = CHAIN_TOKENS[chainId as SupportedChainId];
  const token =
    tokens &&
    Object.values(tokens).find((t) => t.address.toLowerCase() === tokenAddress);
  const native =
    tokenAddress === NATIVE_ASSET_ADDRESS && environment !== "unclassified";
  return {
    assetId: `${chainId ?? "unknown"}:${tokenAddress ?? `unresolved:${reportedSymbol}`}`,
    chainId,
    tokenAddress,
    token:
      token?.symbol ??
      (native
        ? chainId === 137
          ? "POL"
          : "ETH"
        : reportedSymbol.slice(0, 80) || "Unknown asset"),
    decimals: token?.decimals ?? (native ? 18 : undefined),
    recognized: Boolean(token || native),
    environment,
    network,
  };
}

export type AssetIdentity = ReturnType<typeof identifyAsset>;

export function supportedReportSymbols(
  environment: ActivityEnvironment,
  chainId?: number,
) {
  const symbols = new Set<string>();
  for (const [id, tokens] of Object.entries(CHAIN_TOKENS)) {
    if (
      chainEnvironment(Number(id)) !== environment ||
      (chainId !== undefined && Number(id) !== chainId)
    )
      continue;
    Object.values(tokens).forEach((token) => symbols.add(token.symbol));
    symbols.add(Number(id) === 137 ? "POL" : "ETH");
  }
  return [...symbols].sort();
}

export function inReportEnvironment(
  asset: AssetIdentity,
  environment: ActivityEnvironment = "production",
) {
  return environment === "unclassified"
    ? asset.environment === "unclassified" || !asset.recognized
    : asset.environment === environment;
}
