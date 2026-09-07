import { describe, expect, it } from 'vitest';
import { recoverTypedDataAddress, type Hex, type Log } from 'viem';
import { circleAccountCall, circleConfiguration, circleOperationHash, circleOperationSigningData, circlePermitData, circlePrefund, type CircleUserOperation } from '../../../shared/circleExecution';
import { readCircleSettlement } from '../../../shared/circleSettlement';
import success from './fixtures/circleOperation.json';
import successReceipt from './fixtures/circleSuccessReceipt.json';
import failure from './fixtures/circleFailureOperation.json';
import failureReceipt from './fixtures/circleFailureReceipt.json';
import recovery from './fixtures/circleRecoveryOperation.json';
import recoveryReceipt from './fixtures/circleRecoveryReceipt.json';

const numbers = ['nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxPriorityFeePerGas', 'maxFeePerGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'];
function operation(value: Record<string, unknown>): CircleUserOperation { return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, numbers.includes(k) ? BigInt(v as string) : v])) as CircleUserOperation; }
const op = operation(success.userOperation);
const receipt = (value: typeof successReceipt | typeof failureReceipt) => ({ ...value, logs: value.logs.map(log => ({ ...log, blockNumber: BigInt(log.blockNumber), blockTimestamp: BigInt(log.blockTimestamp) })) as Log[] });

describe('Safe executions paid directly in USDC', () => {
  it('reproduces the operation hash included by the live Base Sepolia bundler', () => { expect(circleOperationHash(84532, op)).toBe(success.userOpHash); });
  it('verifies the live Safe owner signature against the complete Safe4337 operation', async () => {
    const validAfter = Number(BigInt(op.signature.slice(0, 14))), validUntil = Number(BigInt(`0x${op.signature.slice(14, 26)}`));
    const signingData = circleOperationSigningData(84532, op, validAfter, validUntil);
    expect(await recoverTypedDataAddress({ ...signingData, signature: `0x${op.signature.slice(26)}` })).toBe(success.owner);
  });
  it('records the successful payment and its real USDC charge', () => {
    expect(readCircleSettlement(84532, op, receipt(successReceipt))).toMatchObject({ status: 'confirmed', fee: 11_848n, token: 'USDC', userOpHash: success.userOpHash });
    expect(success.status.balances).toMatchObject({ ownerETH: '0', safeETH: '0' });
  });
  it('records a failed payment inside a successful bundle, including its charged USDC fee', () => {
    expect(failureReceipt.status).toBe('success');
    expect(readCircleSettlement(84532, operation(failure.userOperation), receipt(failureReceipt))).toMatchObject({ status: 'failed', fee: 5_734n, token: 'USDC', userOpHash: failure.userOpHash });
  });
  it('confirms the next live payment after a failed operation without reusing its nonce or requiring ETH', () => {
    const next = operation(recovery.userOperation);
    expect(next.nonce).toBe(operation(failure.userOperation).nonce + 1n);
    expect(readCircleSettlement(84532, next, receipt(recoveryReceipt))).toMatchObject({ status: 'confirmed', fee: 6_220n, userOpHash: recovery.userOpHash });
    expect(recovery.result.balances).toMatchObject({ ownerETH: '0', safeETH: '0' });
  });
  it.each(['nonce', 'sender', 'callData', 'paymaster', 'gas'])('does not reconcile a receipt for an altered %s', field => {
    const changed = { ...op };
    if (field === 'nonce') changed.nonce++;
    if (field === 'sender') changed.sender = success.owner as Hex;
    if (field === 'callData') changed.callData = '0x1234';
    if (field === 'paymaster') changed.paymaster = success.owner as Hex;
    if (field === 'gas') changed.maxFeePerGas++;
    expect(() => readCircleSettlement(84532, changed, receipt(successReceipt))).toThrow('exact account operation');
  });
  it.each(['missing fee', 'wrong emitter', 'removed', 'duplicate', 'reverted bundle'])('rejects incomplete or contradictory evidence: %s', variant => {
    const value = receipt(successReceipt);
    if (variant === 'missing fee') value.logs = value.logs.filter(l => l.address.toLowerCase() !== op.paymaster.toLowerCase());
    if (variant === 'wrong emitter') value.logs = value.logs.map(l => ({ ...l, address: success.owner as Hex }));
    if (variant === 'removed') value.logs = value.logs.map(l => ({ ...l, removed: true }));
    if (variant === 'duplicate') value.logs.push(...value.logs);
    if (variant === 'reverted bundle') value.status = 'reverted';
    expect(() => readCircleSettlement(84532, op, value)).toThrow();
  });
  it('never substitutes a different gas token or unsupported chain', () => {
    expect(circleConfiguration(84532).token).toBe(success.token);
    expect(() => circleConfiguration(11155111)).toThrow('not available');
    expect(() => circleOperationSigningData(84532, { ...op, paymaster: success.owner as Hex }, 0, 500)).toThrow('does not match');
  });
  it('requires bounded approval time and valid gas and factory fields', () => {
    for (const times of [[0, 0], [-1, 100], [200, 100], [0, 2 ** 48]]) expect(() => circleOperationSigningData(84532, op, ...times as [number, number])).toThrow('bounded');
    for (const change of [{ maxFeePerGas: -1n }, { callGasLimit: 2n ** 128n }, { nonce: -1n }, { factoryData: undefined }]) expect(() => circleOperationSigningData(84532, { ...op, ...change }, 0, 500)).toThrow();
    expect(() => circlePermitData(84532, 0n, '0x')).toThrow('authorization');
    expect(() => circleAccountCall('not an address' as Hex, '0x')).toThrow('Invalid');
  });
  it('uses Circle contract rounding, including the extra micro-USDC on an exact division', () => {
    const small = { ...op, callGasLimit: 1n, verificationGasLimit: 0n, preVerificationGas: 0n, paymasterVerificationGasLimit: 0n, paymasterPostOpGasLimit: 0n, maxFeePerGas: 10n ** 18n };
    expect(circlePrefund(small, 9n, 0n, 1000n)).toBe(11n);
    expect(() => circlePrefund(small, 0n, 0n, 1000n)).toThrow('invalid');
  });
});
