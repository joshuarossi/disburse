// Shared validation for payment forms and server mutations.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function isValidAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS_RE.test(value);
}

export function assertValidAddress(
  value: unknown,
  label = 'address',
): asserts value is string {
  if (!isValidAddress(value)) {
    throw new Error(
      `Invalid ${label}: expected a 20-byte hex address (0x + 40 hex chars)`,
    );
  }
}

export function isValidTxHash(value: unknown): value is string {
  return typeof value === 'string' && TX_HASH_RE.test(value);
}

export function assertValidTxHash(
  value: unknown,
  label = 'tx hash',
): asserts value is string {
  if (!isValidTxHash(value)) {
    throw new Error(
      `Invalid ${label}: expected a 32-byte hex hash (0x + 64 hex chars)`,
    );
  }
}

// Decimal count per supported token symbol. All supported assets are 6-decimal
// stablecoins today; DAI-style 18-decimal assets must be added here explicitly.
const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
  EURC: 6,
};

export function getTokenDecimals(token: string): number {
  const decimals = TOKEN_DECIMALS[token.toUpperCase()];
  if (decimals === undefined) {
    throw new Error(`Unsupported token: ${token}`);
  }
  return decimals;
}

/**
 * Validate a human-readable token amount string:
 * - digits only with at most `decimals` fractional places
 * - strictly positive
 * - rejects scientific notation, whitespace, sign prefixes
 */
export function assertValidAmount(amount: string, token: string): void {
  const decimals = getTokenDecimals(token);
  const re = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!re.test(amount)) {
    throw new Error(
      `Invalid amount "${amount}": must be a positive decimal with at most ${decimals} decimal places for ${token}`,
    );
  }
  // Redundant positivity check in case regex is loosened later.
  if (parseFloat(amount) <= 0) {
    throw new Error('Amount must be greater than zero');
  }
}

/** Convert a validated human-readable amount to integer base units (as BigInt). */
export function amountToBaseUnits(amount: string, token: string): bigint {
  const decimals = getTokenDecimals(token);
  assertValidAmount(amount, token);
  const [whole, frac = ''] = amount.split('.');
  const fracPadded = frac.padEnd(decimals, '0');
  return BigInt(`${whole}${fracPadded}`);
}

/** Convert integer base units back to a human-readable decimal string. */
export function formatBaseUnits(baseUnits: bigint, token: string): string {
  const decimals = getTokenDecimals(token);
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const whole = abs / 10n ** BigInt(decimals);
  const frac = (abs % 10n ** BigInt(decimals))
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}
