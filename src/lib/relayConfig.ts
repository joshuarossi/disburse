export type RelayFeeMode = 'stablecoin_preferred' | 'stablecoin_only';

export const SUPPORTED_RELAY_FEE_TOKENS = ['USDC', 'USDT'] as const;
export type RelayFeeTokenSymbol = (typeof SUPPORTED_RELAY_FEE_TOKENS)[number];

const relayEnabledEnv = (import.meta.env.VITE_GELATO_RELAY_ENABLED ?? 'true')
  .toString()
  .toLowerCase();

export const RELAY_FEATURE_ENABLED =
  relayEnabledEnv !== 'false' && relayEnabledEnv !== '0';

const envFeeToken = (import.meta.env.VITE_GELATO_DEFAULT_FEE_TOKEN ?? 'USDC')
  .toString()
  .toUpperCase();

const envFeeMode = (import.meta.env.VITE_GELATO_DEFAULT_FEE_MODE ??
  'stablecoin_preferred')
  .toString();

export const DEFAULT_RELAY_FEE_TOKEN_SYMBOL: RelayFeeTokenSymbol =
  SUPPORTED_RELAY_FEE_TOKENS.includes(envFeeToken as RelayFeeTokenSymbol)
    ? (envFeeToken as RelayFeeTokenSymbol)
    : 'USDC';

export const DEFAULT_RELAY_FEE_MODE: RelayFeeMode =
  envFeeMode === 'stablecoin_only' ? 'stablecoin_only' : 'stablecoin_preferred';

export function resolveRelaySettings(org?: {
  relayFeeTokenSymbol?: string | null;
  relayFeeMode?: string | null;
}): {
  relayFeeTokenSymbol: RelayFeeTokenSymbol;
  relayFeeMode: RelayFeeMode;
} {
  const token = (org?.relayFeeTokenSymbol ?? DEFAULT_RELAY_FEE_TOKEN_SYMBOL)
    .toString()
    .toUpperCase();
  const relayFeeTokenSymbol = SUPPORTED_RELAY_FEE_TOKENS.includes(
    token as RelayFeeTokenSymbol
  )
    ? (token as RelayFeeTokenSymbol)
    : DEFAULT_RELAY_FEE_TOKEN_SYMBOL;

  const mode = (org?.relayFeeMode ?? DEFAULT_RELAY_FEE_MODE).toString();
  const relayFeeMode: RelayFeeMode =
    mode === 'stablecoin_only' ? 'stablecoin_only' : 'stablecoin_preferred';

  return { relayFeeTokenSymbol, relayFeeMode };
}
