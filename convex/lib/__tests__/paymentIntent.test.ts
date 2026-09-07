import { describe, expect, it } from 'vitest';
import { concat, encodeFunctionData, parseAbi, toHex } from 'viem';
import {
  assertPaymentIntent,
  type PaymentCall,
} from '../../../shared/paymentIntent';
const token = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const multiSend = '0x3333333333333333333333333333333333333333';
const abi = parseAbi([
  'function transfer(address to,uint256 amount) returns (bool)',
  'function multiSend(bytes transactions)',
]);
const call: PaymentCall = {
  to: token,
  value: '0',
  operation: 0,
  data: encodeFunctionData({
    abi,
    functionName: 'transfer',
    args: [recipient, 100000001n],
  }),
};
const expected = {
  tokenAddress: token,
  token: 'USDC',
  recipients: [{ recipientAddress: recipient, amount: '100.000001' }],
};
const pack = (c: PaymentCall) =>
  concat([
    toHex(c.operation, { size: 1 }),
    c.to as `0x${string}`,
    toHex(BigInt(c.value), { size: 32 }),
    toHex(BigInt((c.data!.length - 2) / 2), { size: 32 }),
    c.data as `0x${string}`,
  ]);
const batch = (calls: PaymentCall[]): PaymentCall => ({
  to: multiSend,
  value: '0',
  operation: 1,
  data: encodeFunctionData({
    abi,
    functionName: 'multiSend',
    args: [concat(calls.map(pack))],
  }),
});
describe('payment calldata binding', () => {
  it('accepts an exact direct transfer and a canonical batch', () => {
    expect(() =>
      assertPaymentIntent(call, expected, [multiSend]),
    ).not.toThrow();
    expect(() =>
      assertPaymentIntent(batch([call]), expected, [multiSend]),
    ).not.toThrow();
  });
  it('rejects an extra recipient transfer even if the expected transfer is present', () => {
    expect(() =>
      assertPaymentIntent(batch([call, call]), expected, [multiSend]),
    ).toThrow('recipients or amounts');
  });
  it('rejects a one-base-unit amount mismatch', () => {
    expect(() =>
      assertPaymentIntent(
        call,
        {
          ...expected,
          recipients: [{ recipientAddress: recipient, amount: '100' }],
        },
        [multiSend],
      ),
    ).toThrow('recipients or amounts');
  });
  it('rejects a substitute currency or batch contract', () => {
    expect(() =>
      assertPaymentIntent({ ...call, to: recipient }, expected, [multiSend]),
    ).toThrow('unexpected call');
    expect(() =>
      assertPaymentIntent({ ...batch([call]), to: recipient }, expected, [
        multiSend,
      ]),
    ).toThrow('unsupported contract');
  });
  it('rejects native value, nested delegate calls, and appended calldata', () => {
    expect(() =>
      assertPaymentIntent({ ...call, value: '1' }, expected, [multiSend]),
    ).toThrow('native transfer');
    expect(() =>
      assertPaymentIntent(batch([{ ...call, operation: 1 }]), expected, [
        multiSend,
      ]),
    ).toThrow('unexpected call');
    expect(() =>
      assertPaymentIntent({ ...call, data: call.data + '00' }, expected, [
        multiSend,
      ]),
    ).toThrow('Noncanonical');
  });
  it('rejects malformed packed lengths without interpreting partial transfers', () => {
    const data = encodeFunctionData({
      abi,
      functionName: 'multiSend',
      args: ['0x01'],
    });
    expect(() =>
      assertPaymentIntent({ ...batch([call]), data }, expected, [multiSend]),
    ).toThrow('Invalid payment batch');
  });
});

describe('managed relay fee binding', () => {
  const collector = '0x4444444444444444444444444444444444444444';
  const fee = { token: 'USDC', tokenAddress: token, collector, amount: '0.05' };
  const feeCall: PaymentCall = { ...call, data: encodeFunctionData({ abi, functionName: 'transfer', args: [collector, 50000n] }) };
  it('accepts only the exact reviewed fee alongside unchanged recipient amounts', () => {
    expect(() => assertPaymentIntent(batch([call, feeCall]), { ...expected, executionFee: fee }, [multiSend])).not.toThrow();
    for (const calls of [[call], [call, feeCall, feeCall], [call, { ...feeCall, to: recipient }]])
      expect(() => assertPaymentIntent(batch(calls), { ...expected, executionFee: fee }, [multiSend])).toThrow();
    expect(() => assertPaymentIntent(batch([call, feeCall]), { ...expected, executionFee: { ...fee, amount: '0.050001' } }, [multiSend])).toThrow();
  });
  it('supports a separate fee currency without substituting the recipient currency', () => {
    const feeToken = '0x5555555555555555555555555555555555555555';
    const other = { ...fee, token: 'USDT', tokenAddress: feeToken };
    expect(() => assertPaymentIntent(batch([call, { ...feeCall, to: feeToken }]), { ...expected, executionFee: other }, [multiSend])).not.toThrow();
    expect(() => assertPaymentIntent(batch([{ ...call, to: feeToken }, { ...feeCall, to: feeToken }]), { ...expected, executionFee: other }, [multiSend])).toThrow();
  });
});
