import { isAddress, zeroAddress, type Address, type Hex } from 'viem';
import type { GetQuotePayload } from '@biconomy/abstractjs';
import { verifyCustomerQuote, type CustomerExecutionIntent } from './customerPaidExecution';

export type CustomerServiceRecord = {
  intent: Omit<CustomerExecutionIntent, 'amount' | 'calls'> & { amount: string; calls: { to: Address; data: Hex; value: string }[] };
  quote: GetQuotePayload; startBlock: string;
  account?: { address: Address; owners: Address[]; threshold: number };
};
export function restoreCustomerIntent(record: CustomerServiceRecord): CustomerExecutionIntent {
  return { ...record.intent, amount: BigInt(record.intent.amount), calls: record.intent.calls.map(call => ({ ...call, value: BigInt(call.value) })) };
}
/** Structural validation also applies when reading an expired saved request.
 * Recovery must not depend on an unexpired quote or crash on corrupt metadata. */
export function readServiceRecord(json: string): CustomerServiceRecord {
  if (json.length > 100_000) throw new Error('This execution request is too large');
  try {
    const record = JSON.parse(json) as CustomerServiceRecord;
    const address = (value: unknown) => typeof value === 'string' && isAddress(value) && value.toLowerCase() !== zeroAddress;
    const uint = (value: unknown) => typeof value === 'string' && /^(?:0|[1-9]\d{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
    const bytes = (value: unknown) => typeof value === 'string' && /^0x(?:[\da-f]{2})*$/i.test(value);
    const intent = record?.intent;
    if (!intent || !Number.isSafeInteger(intent.chainId) || intent.chainId <= 0 || !address(intent.owner) || !address(intent.companion) || !address(intent.token) || !uint(intent.amount) || !bytes(intent.initCode) ||
      !Number.isSafeInteger(intent.validAfter) || !Number.isSafeInteger(intent.validUntil) || intent.validAfter < 0 || intent.validUntil <= intent.validAfter ||
      !Array.isArray(intent.calls) || !intent.calls.length || intent.calls.length > 201 || intent.calls.some(call => !call || !address(call.to) || !bytes(call.data) || !uint(call.value)) ||
      typeof record.startBlock !== 'string' || !/^(?:0|[1-9]\d{0,19})$/.test(record.startBlock) || BigInt(record.startBlock) >= 2n ** 64n ||
      !record.quote || typeof record.quote.hash !== 'string' || !/^0x[\da-f]{64}$/i.test(record.quote.hash)) throw new Error();
    if (record.account) {
      const { owners, threshold } = record.account;
      if (!address(record.account.address) || !Array.isArray(owners) || !owners.length || owners.length > 50 || owners.some(owner => !address(owner)) ||
        new Set(owners.map(owner => owner.toLowerCase())).size !== owners.length || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > owners.length) throw new Error();
    }
    return record;
  } catch { throw new Error('The saved setup details could not be read. Keep this request for recovery before starting another setup.'); }
}
export function decodeServiceRecord(json: string, now = Date.now()): CustomerServiceRecord {
  const record = readServiceRecord(json);
  verifyCustomerQuote(record.quote, restoreCustomerIntent(record), now);
  return record;
}
