import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { assertPaymentReceipt, type PaymentReceipt } from '../executionReceipt';
const safe = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';
const hash = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const expected = {
  safeAddress: safe,
  safeTxHash: hash,
  tokenAddress: token,
  token: 'USDC',
  recipients: [{ recipientAddress: recipient, amount: '100' }],
};
function receipt(amount = 100000000n): PaymentReceipt {
  return {
    status: 'success',
    logs: [
      {
        address: safe,
        topics: encodeEventTopics({
          abi: parseAbi([
            'event ExecutionSuccess(bytes32 txHash, uint256 payment)',
          ]),
          eventName: 'ExecutionSuccess',
        }) as PaymentReceipt['logs'][number]['topics'],
        data: encodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'uint256' }],
          [hash, 0n],
        ),
      },
      {
        address: token,
        topics: encodeEventTopics({
          abi: parseAbi([
            'event Transfer(address indexed from, address indexed to, uint256 value)',
          ]),
          eventName: 'Transfer',
          args: { from: safe, to: recipient },
        }) as PaymentReceipt['logs'][number]['topics'],
        data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
      },
    ],
  };
}
describe('receipt verification', () => {
  it('requires the Safe event and the expected token transfer', () =>
    expect(() => assertPaymentReceipt(receipt(), expected)).not.toThrow());
  it('rejects an unrelated successful transaction', () =>
    expect(() =>
      assertPaymentReceipt({ ...receipt(), logs: [] }, expected),
    ).toThrow('does not confirm'));
  it('rejects a different Safe transaction hash', () =>
    expect(() =>
      assertPaymentReceipt(receipt(), {
        ...expected,
        safeTxHash: '0x' + 'cd'.repeat(32),
      }),
    ).toThrow('does not confirm'));
  it('rejects partial payment and wrong tokens', () => {
    expect(() => assertPaymentReceipt(receipt(99999999n), expected)).toThrow(
      'expected recipient',
    );
    expect(() =>
      assertPaymentReceipt(receipt(), { ...expected, tokenAddress: recipient }),
    ).toThrow('expected recipient');
  });
  it('rejects a reverted receipt even with matching supplied logs', () =>
    expect(() =>
      assertPaymentReceipt({ ...receipt(), status: 'reverted' }, expected),
    ).toThrow('did not succeed'));
});

describe('managed relay fee settlement', () => {
  const collector = '0x4444444444444444444444444444444444444444';
  const fee = { token: 'USDC', tokenAddress: token, collector, amount: '0.05' };
  const feeLog: PaymentReceipt['logs'][number] = {
    address: token,
    topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']), eventName: 'Transfer', args: { from: safe, to: collector } }) as PaymentReceipt['logs'][number]['topics'],
    data: encodeAbiParameters([{ type: 'uint256' }], [50000n]),
  };
  it('requires both the exact fee and full recipient amount', () => {
    const valid = { ...receipt(), logs: [...receipt().logs, feeLog] };
    expect(() => assertPaymentReceipt(valid, { ...expected, executionFee: fee })).not.toThrow();
    expect(() => assertPaymentReceipt(receipt(), { ...expected, executionFee: fee })).toThrow();
    expect(() => assertPaymentReceipt({ ...receipt(), logs: [...receipt(99950000n).logs, feeLog] }, { ...expected, executionFee: fee })).toThrow();
    expect(() => assertPaymentReceipt({ ...valid, logs: [...valid.logs, feeLog] }, { ...expected, executionFee: fee })).toThrow();
  });
});
