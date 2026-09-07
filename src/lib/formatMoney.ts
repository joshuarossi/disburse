/** Preserve decimal precision when rendering amounts, including values above
 * Number.MAX_SAFE_INTEGER. The underlying balances and records remain strings. */
export function formatMoney(
  amount: string | number,
  token?: string,
  precise = false,
) {
  const text = String(amount);
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) return 'Unavailable';
  const negative = match[1] === '-';
  const units =
    BigInt(match[2]) * 1_000_000n + BigInt((match[3] ?? '').padEnd(6, '0'));
  const rounded = precise ? units : ((units + 5000n) / 10000n) * 10000n;
  const integer = rounded / 1_000_000n;
  let fraction = (rounded % 1_000_000n).toString().padStart(6, '0');
  fraction = precise
    ? fraction.replace(/0+$/, '').padEnd(2, '0')
    : fraction.slice(0, 2);
  const separator =
    new Intl.NumberFormat().formatToParts(1.1).find((p) => p.type === 'decimal')
      ?.value ?? '.';
  const prefix = token === 'EURC' ? '€' : '$';
  return `${negative && rounded !== 0n ? '-' : ''}${prefix}${new Intl.NumberFormat().format(integer)}${separator}${fraction}`;
}
export function formatDate(
  timestamp: number | undefined,
  options?: Intl.DateTimeFormatOptions,
) {
  return timestamp
    ? new Date(timestamp).toLocaleDateString(
        undefined,
        options ?? {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        },
      )
    : 'Not scheduled';
}

/** Native and historical assets have no assumed dollar value. */
export function formatAssetAmount(amount: string, token: string, recognized = true) {
  if (recognized && ['USDC', 'USDT', 'PYUSD', 'EURC', 'DAI'].includes(token)) {
    return formatMoney(amount, token, true);
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) return 'Unavailable';
  const integer = new Intl.NumberFormat().format(BigInt(match[2]));
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const separator = new Intl.NumberFormat().formatToParts(1.1).find(p => p.type === 'decimal')?.value ?? '.';
  return `${match[1]}${integer}${fraction ? separator + fraction : ''}`;
}

export const scheduleDateTime = (at: number) => `${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
