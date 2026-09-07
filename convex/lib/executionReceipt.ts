import { decodeEventLog, parseAbi, type TransactionReceipt } from 'viem';
import { amountToBaseUnits } from './validation';
import type { ExecutionFee } from '../../shared/executionFee';
import { accountExecutionOutcome } from '../../shared/accountExecution';
const tokenEvents = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export type PaymentReceipt = Pick<TransactionReceipt, 'status'> & {
  logs: Array<
    Pick<TransactionReceipt['logs'][number], 'address' | 'topics' | 'data'>
  >;
};

export function assertPaymentReceipt(
  receipt: PaymentReceipt,
  expected: {
    safeAddress: string;
    safeTxHash: string;
    tokenAddress: string;
    token: string;
    recipients: Array<{ recipientAddress: string; amount: string }>;
    executionFee?: ExecutionFee;
  },
) {
  if (receipt.status !== 'success')
    throw new Error('The transaction did not succeed on chain');
  let safeExecuted = false;
  const transferred = new Map<string, bigint>();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === expected.safeAddress.toLowerCase()) {
      if (accountExecutionOutcome(log, expected.safeTxHash) === 'success') safeExecuted = true;
    }
    if ([expected.tokenAddress, expected.executionFee?.tokenAddress].some(a => a?.toLowerCase() === log.address.toLowerCase())) {
      try {
        const event = decodeEventLog({
          abi: tokenEvents,
          data: log.data,
          topics: log.topics,
        });
        if (
          event.args.from.toLowerCase() === expected.safeAddress.toLowerCase()
        ) {
          const recipient = `${log.address.toLowerCase()}:${event.args.to.toLowerCase()}`;
          transferred.set(
            recipient,
            (transferred.get(recipient) ?? 0n) + event.args.value,
          );
        }
      } catch {
        /* Not a Transfer log. */
      }
    }
  }
  if (!safeExecuted)
    throw new Error('Receipt does not confirm execution of this Safe payment');
  const required = new Map<string, bigint>();
  for (const recipient of expected.recipients) {
    const address = `${expected.tokenAddress.toLowerCase()}:${recipient.recipientAddress.toLowerCase()}`;
    required.set(
      address,
      (required.get(address) ?? 0n) +
        amountToBaseUnits(recipient.amount, expected.token),
    );
  }
  if (!required.size) throw new Error('Payment has no recipients to verify');
  if (expected.executionFee) {
    const fee = expected.executionFee;
    const address = `${fee.tokenAddress.toLowerCase()}:${fee.collector.toLowerCase()}`;
    required.set(address, (required.get(address) ?? 0n) + amountToBaseUnits(fee.amount, fee.token));
  }
  for (const [address, amount] of required) {
    if (expected.executionFee ? transferred.get(address) !== amount : (transferred.get(address) ?? 0n) < amount)
      throw new Error(
        'Receipt does not contain the expected recipient transfers',
      );
  }
}
