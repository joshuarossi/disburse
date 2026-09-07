import { describe, expect, it } from 'vitest';
import { encodeEventTopics, encodeAbiParameters, type Hex } from 'viem';
import { allowanceTransferAbi, assertDelegatedReceipt, type DelegatedIntent } from '../../../shared/allowanceTransfer';
const safe = '0x1111111111111111111111111111111111111111';
const delegate = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';
const recipient = '0x4444444444444444444444444444444444444444';
const module = '0x5555555555555555555555555555555555555555';
const intent: DelegatedIntent = { chainId: 11155111, safeAddress: safe, module, delegate, nonce: 7, hash: `0x${'ab'.repeat(32)}`, signature: '0x', tokenAddress: token, recipientAddress: recipient, amount: '0.010001' };
function receipt(nonce = 7, amount = 10001n) {
  return { status: 'success', logs: [
    { address: module, topics: encodeEventTopics({ abi: allowanceTransferAbi, eventName: 'ExecuteAllowanceTransfer', args: { safe } }) as [Hex, ...Hex[]], data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint96' }, { type: 'uint16' }], [delegate, token, recipient, amount, nonce]) },
    { address: token, topics: encodeEventTopics({ abi: allowanceTransferAbi, eventName: 'Transfer', args: { from: safe, to: recipient } }) as [Hex, ...Hex[]], data: encodeAbiParameters([{ type: 'uint256' }], [amount]) },
  ] };
}
describe('delegated settlement evidence', () => {
  it('requires the precise allowance sequence and exact recipient transfer', () => { expect(() => assertDelegatedReceipt(receipt(), safe, 'USDC', intent)).not.toThrow(); });
  it('rejects another authorization, amount, module, missing token transfer and reverted transaction', () => {
    for (const r of [receipt(8), receipt(7, 10002n), { ...receipt(), status: 'reverted' }, { ...receipt(), logs: receipt().logs.slice(0, 1) }, { ...receipt(), logs: receipt().logs.map(log => ({ ...log, address: recipient })) }]) expect(() => assertDelegatedReceipt(r, safe, 'USDC', intent)).toThrow();
  });
});

it('requires the full recipient amount and a separately authorized stablecoin fee', () => {
  const collector = '0x6666666666666666666666666666666666666666';
  const feeAuthorization = { token: 'USDC', tokenAddress: token, collector, amount: '0.05', nonce: 8, hash: `0x${'ef'.repeat(32)}`, signature: '0x' };
  const feeLogs = [
    { address: module, topics: encodeEventTopics({ abi: allowanceTransferAbi, eventName: 'ExecuteAllowanceTransfer', args: { safe } }) as [Hex, ...Hex[]], data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint96' }, { type: 'uint16' }], [delegate, token, collector, 50000n, 8]) },
    { address: token, topics: encodeEventTopics({ abi: allowanceTransferAbi, eventName: 'Transfer', args: { from: safe, to: collector } }) as [Hex, ...Hex[]], data: encodeAbiParameters([{ type: 'uint256' }], [50000n]) },
  ];
  const expected = { ...intent, feeAuthorization };
  expect(() => assertDelegatedReceipt({ status: 'success', logs: [...receipt().logs, ...feeLogs] }, safe, 'USDC', expected)).not.toThrow();
  expect(() => assertDelegatedReceipt(receipt(), safe, 'USDC', expected)).toThrow();
  expect(() => assertDelegatedReceipt({ status: 'success', logs: [...receipt(7, 10000n).logs, ...feeLogs] }, safe, 'USDC', expected)).toThrow();
  expect(() => assertDelegatedReceipt({ status: 'success', logs: [...receipt().logs, ...feeLogs] }, safe, 'USDC', { ...expected, feeAuthorization: { ...feeAuthorization, amount: '0.050001' } })).toThrow();
});

it('requires settlement evidence for every recipient in a delegated batch', () => {
  const second = '0x7777777777777777777777777777777777777777';
  const secondLogs = [
    { address: module, topics: encodeEventTopics({ abi: allowanceTransferAbi, eventName: 'ExecuteAllowanceTransfer', args: { safe } }) as [Hex, ...Hex[]], data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint96' }, { type: 'uint16' }], [delegate, token, second, 20001n, 8]) },
    { address: token, topics: encodeEventTopics({ abi: allowanceTransferAbi, eventName: 'Transfer', args: { from: safe, to: second } }) as [Hex, ...Hex[]], data: encodeAbiParameters([{ type: 'uint256' }], [20001n]) },
  ];
  const expected = { ...intent, additionalTransfers: [{ recipientAddress: second, amount: '0.020001', nonce: 8, hash: intent.hash, signature: '0x' }] };
  expect(() => assertDelegatedReceipt({ status: 'success', logs: [...receipt().logs, ...secondLogs] }, safe, 'USDC', expected)).not.toThrow();
  expect(() => assertDelegatedReceipt(receipt(), safe, 'USDC', expected)).toThrow();
  expect(() => assertDelegatedReceipt({ status: 'success', logs: [...receipt().logs, ...secondLogs] }, safe, 'USDC', { ...expected, additionalTransfers: [{ ...expected.additionalTransfers[0], nonce: 9 }] })).toThrow();
});
