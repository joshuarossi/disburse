import { amountToBaseUnits, formatBaseUnits } from './validation';
export type ExecutionFee = {
  token: string;
  tokenAddress: string;
  collector: string;
  amount: string;
};
export function feeIdentity(fee: ExecutionFee) {
  return `${fee.token}:${fee.tokenAddress.toLowerCase()}:${fee.collector.toLowerCase()}:${fee.amount}`;
}

/** Account debits retain their currency; never add unlike stablecoins together. */
export function paymentDebits(token: string, amount: string, fee?: ExecutionFee) {
  const totals = new Map([[token, amountToBaseUnits(amount, token)]]);
  if (fee) totals.set(fee.token, (totals.get(fee.token) ?? 0n) + amountToBaseUnits(fee.amount, fee.token));
  return [...totals].map(([currency, value]) => ({ token: currency, amount: formatBaseUnits(value, currency) }));
}
