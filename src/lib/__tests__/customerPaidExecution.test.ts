import { describe, expect, it } from 'vitest';
import { concatHex, decodeAbiParameters, decodeFunctionData, encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { getUserOperationHash } from 'viem/account-abstraction';
import quoteFixture from './fixtures/customerQuote.json';
import { ENTRY_POINT, verifyCustomerQuote, type CustomerExecutionIntent } from '../../../shared/customerPaidExecution';
import type { GetQuotePayload } from '@biconomy/abstractjs';

const quote = quoteFixture as unknown as GetQuotePayload;
const decoded = decodeFunctionData({ abi: parseAbi(['function execute(bytes32 mode, bytes executionCalldata)']), data: quote.userOps[1].userOp.callData });
const calls = decodeAbiParameters([{ type: 'tuple[]', components: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }], decoded.args[1])[0];
const intent: CustomerExecutionIntent = { chainId: 84532, owner: quote.paymentInfo.eoa, companion: quote.paymentInfo.sender, token: quote.paymentInfo.token, amount: 1_000_000n, calls: calls.slice(1), initCode: quote.paymentInfo.initCode, validAfter: 1788797030, validUntil: 1788797630 };
const now = 1788797050_000;
const other = '0x1111111111111111111111111111111111111111' as Address;

// Re-hash attacker-modified operations: a consistent hash is insufficient if
// the operation no longer matches the instructions the customer reviewed.
function rehash(q: GetQuotePayload) {
  for (const d of q.userOps) {
    const op = d.userOp;
    d.userOpHash = getUserOperationHash({ chainId: Number(d.chainId), entryPointAddress: ENTRY_POINT, entryPointVersion: '0.7', userOperation: {
      sender: op.sender, nonce: BigInt(op.nonce), callData: op.callData,
      ...(op.initCode === '0x' ? {} : { factory: op.initCode.slice(0, 42) as Address, factoryData: `0x${op.initCode.slice(42)}` as Hex }),
      callGasLimit: BigInt(op.callGasLimit), verificationGasLimit: BigInt(op.verificationGasLimit), preVerificationGas: BigInt(op.preVerificationGas), maxFeePerGas: BigInt(op.maxFeePerGas), maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas),
      paymaster: op.paymasterAndData.slice(0, 42) as Address, paymasterVerificationGasLimit: BigInt(`0x${op.paymasterAndData.slice(42, 74)}`), paymasterPostOpGasLimit: BigInt(`0x${op.paymasterAndData.slice(74, 106)}`), paymasterData: `0x${op.paymasterAndData.slice(106)}` as Hex, signature: '0x',
    } });
    d.meeUserOpHash = keccak256(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], [d.userOpHash, BigInt(d.lowerBoundTimestamp), BigInt(d.upperBoundTimestamp)])));
  }
  q.hash = keccak256(concatHex(q.userOps.map(op => op.meeUserOpHash).sort()));
}

describe('customer-paid execution authorization', () => {
  it('independently verifies the live Base Sepolia permit quote and exact USDC debit', () => {
    expect(verifyCustomerQuote(quote, intent, now)).toMatchObject({ fee: 23_122n, debit: 1_023_122n, expiresAt: 1788797331_000 });
  });
  it.each([
    ['sponsorship', (q: GetQuotePayload) => { q.paymentInfo.sponsored = true; }],
    ['different fee payer', (q: GetQuotePayload) => { q.paymentInfo.eoa = other; }],
    ['different fee token', (q: GetQuotePayload) => { q.paymentInfo.token = other; }],
    ['different fee recipient', (q: GetQuotePayload) => { q.node = other; }],
    ['refund redirected', (q: GetQuotePayload) => { q.paymentInfo.gasRefundAddress = other; }],
    ['displayed fee reduced', (q: GetQuotePayload) => { q.paymentInfo.tokenWeiAmount = '1'; }],
    ['unbounded fee', (q: GetQuotePayload) => { q.paymentInfo.tokenWeiAmount = '99999999999999999'; }],
    ['native approval fallback', (q: GetQuotePayload) => { q.quoteType = 'onchain'; }],
    ['wrong chain', (q: GetQuotePayload) => { q.userOps[1].chainId = '1'; rehash(q); }],
    ['wrong sender', (q: GetQuotePayload) => { q.userOps[1].userOp.sender = other; rehash(q); }],
    ['altered call bytes', (q: GetQuotePayload) => { q.userOps[1].userOp.callData = '0x1234'; rehash(q); }],
    ['different factory', (q: GetQuotePayload) => { q.userOps[0].userOp.initCode = `${other}${q.userOps[0].userOp.initCode.slice(42)}`; rehash(q); }],
    ['extended validity', (q: GetQuotePayload) => { q.userOps[1].upperBoundTimestamp = '1788807630'; rehash(q); }],
    ['unexpected cleanup', (q: GetQuotePayload) => { q.userOps[1].isCleanUpUserOp = true; }],
    ['extra operation', (q: GetQuotePayload) => { q.userOps.push(q.userOps[1]); }],
    ['wrong commitment', (q: GetQuotePayload) => { q.hash = `0x${'11'.repeat(32)}`; }],
  ] as const)('refuses %s before requesting any wallet signature', (_, modify) => {
    const candidate = structuredClone(quote); modify(candidate);
    expect(() => verifyCustomerQuote(candidate, intent, now)).toThrow('does not match your instructions');
  });
  it.each([undefined, null, {}, { userOps: [] }, 'service error', { paymentInfo: null }])('handles malformed provider responses', value => {
    expect(() => verifyCustomerQuote(value, intent, now)).toThrow('does not match your instructions');
  });
  it('uses the earlier fee-operation expiry and leaves time to authorize', () => {
    expect(() => verifyCustomerQuote(quote, intent, 1788797302_000)).toThrow('expired');
  });
  it('does not accept changed amounts, recipients, owners or networks under an existing quote', () => {
    for (const changed of [{ ...intent, amount: 2_000_000n }, { ...intent, owner: other }, { ...intent, chainId: 11155111 }, { ...intent, calls: [...intent.calls, { to: other, data: '0x' as Hex, value: 1n }] }]) expect(() => verifyCustomerQuote(quote, changed, now)).toThrow();
  });
});
