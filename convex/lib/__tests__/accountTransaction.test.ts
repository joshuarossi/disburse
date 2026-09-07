import { expect, it } from 'vitest';
import { decodeFunctionData, erc20Abi, encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { prepareAccountTransaction } from '../accountApproval';
import { assertPaymentIntent } from '../../../shared/paymentIntent';
import { matchesAccountExecution } from '../../../shared/accountExecution';
import { CHAIN_TOKENS } from '../../../shared/chains';
const recipient = '0x1111111111111111111111111111111111111111';
const expected = { chainId: 11155111, token: 'USDC', recipients: [{ recipientAddress: recipient, amount: '123456789012345678.000001' }] };
it('preserves exact principal beyond floating-point precision in a single payment', () => {
  const tx = prepareAccountTransaction(expected, 3);
  const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data as `0x${string}` });
  expect(decoded).toMatchObject({ functionName: 'transfer', args: [recipient, 123456789012345678000001n] });
  expect(tx).toMatchObject({ nonce: 3, value: '0', gasPrice: '0', gasToken: '0x0000000000000000000000000000000000000000' });
});
it('uses the same exact payment-intent validation for batches and a batch of one', () => {
  for (const recipients of [expected.recipients, [...expected.recipients, { recipientAddress: recipient, amount: '2.000002' }]]) {
    const tx = prepareAccountTransaction({ ...expected, recipients }, 7);
    expect(() => assertPaymentIntent(tx, { ...expected, recipients, tokenAddress: CHAIN_TOKENS[11155111].USDC.address }, [tx.to])).not.toThrow();
  }
});
it('rejects unsupported currencies, overprecision, empty payments and invalid nonces', () => {
  for (const change of [{ chainId: 0 }, { token: 'ETH' }, { recipients: [] }, { recipients: [{ recipientAddress: recipient, amount: '1.0000001' }] }]) expect(() => prepareAccountTransaction({ ...expected, ...change }, 1)).toThrow();
  expect(() => prepareAccountTransaction(expected, 1.5)).toThrow();
  expect(() => prepareAccountTransaction(expected, -1)).toThrow();
});
for (const indexed of [false, true]) it(`finds an original Safe execution with ${indexed ? 'indexed' : 'data'} transaction identity`, () => {
  const hash = `0x${'ab'.repeat(32)}` as const;
  const abi = parseAbi([indexed ? 'event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)' : 'event ExecutionSuccess(bytes32 txHash,uint256 payment)']);
  const log = { topics: encodeEventTopics({ abi, eventName: 'ExecutionSuccess', args: { txHash: hash } }) as string[], data: indexed ? encodeAbiParameters([{ type: 'uint256' }], [0n]) : encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [hash, 0n]) };
  expect(matchesAccountExecution(log, hash)).toBe(true);
  expect(matchesAccountExecution(log, `0x${'cd'.repeat(32)}`)).toBe(false);
  expect(matchesAccountExecution({ ...log, removed: true }, hash)).toBe(false);
});
