import { describe, expect, it } from 'vitest';
import { decodeFunctionData, parseAbi, zeroAddress, type Hex } from 'viem';
import { customerPaidSafeConfig, SAFE_4337_MODULE, SAFE_4337_SETUP, supportedSafe4337Handler } from '../../../shared/safe4337';
import runtime from './fixtures/safe4337Runtime.json';

const owner = '0x01585228489577cdCdbd5eBb822C7c439a2c564c';
const second = '0x1111111111111111111111111111111111111111';
describe('customer-paid Safe configuration', () => {
  it('enables only the published module and preserves all chosen owners and their threshold', () => {
    const config = customerPaidSafeConfig(84532, [owner, second], 2);
    expect(config.owners).toEqual([owner, second]);
    expect(config.threshold).toBe(2);
    expect(config.to).toBe(SAFE_4337_SETUP);
    expect(config.fallbackHandler).toBe(SAFE_4337_MODULE);
    const call = decodeFunctionData({ abi: parseAbi(['function enableModules(address[] modules)']), data: config.data });
    expect(call.args[0]).toEqual([SAFE_4337_MODULE]);
  });
  it.each([
    [[], 1], [[owner], 0], [[owner], 2], [[owner], 1.5],
    [[owner, owner.toLowerCase()], 1], [[zeroAddress], 1], [['0x1234'], 1],
  ] as Array<[string[], number]>)('refuses invalid ownership before preparing a paid deployment', (owners, threshold) => {
    expect(() => customerPaidSafeConfig(84532, owners, threshold)).toThrow('valid, distinct account owners');
  });
  it('rejects an unpublished network and an address containing different runtime code', () => {
    expect(() => customerPaidSafeConfig(123456789, [owner], 1)).toThrow('not available');
    for (const code of [undefined, '0x', '0x6000'] as Array<Hex | undefined>) expect(supportedSafe4337Handler(84532, SAFE_4337_MODULE, code)).toBe(false);
    expect(supportedSafe4337Handler(84532, second, runtime.bytecode as Hex)).toBe(false);
    expect(supportedSafe4337Handler(123456789, SAFE_4337_MODULE, runtime.bytecode as Hex)).toBe(false);
  });
  it('accepts the exact verified runtime as a nested Safe signature handler', () => {
    for (const chainId of [1, 8453, 84532, 42161, 421614]) expect(supportedSafe4337Handler(chainId, SAFE_4337_MODULE, runtime.bytecode as Hex)).toBe(true);
  });
});
