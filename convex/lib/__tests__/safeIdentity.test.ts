import { beforeEach, describe, expect, it, vi } from 'vitest';
import { padHex } from 'viem';
import { assertSafeIdentity } from '../safeIdentity';
const safe = '0x1111111111111111111111111111111111111111';
const singleton = '0x2222222222222222222222222222222222222222';
const factory = '0x3333333333333333333333333333333333333333';
vi.mock('@safe-global/safe-deployments', async () => {
  const { keccak256 } = await import('viem');
  const deployment = (address: string, code: `0x${string}`) => ({ networkAddresses: { '1': address }, deployments: { canonical: { address, codeHash: keccak256(code) } } });
  return {
    getSafeSingletonDeployments: () => deployment('0x2222222222222222222222222222222222222222', '0x6001'),
    getSafeL2SingletonDeployments: () => undefined,
    getProxyFactoryDeployments: () => deployment('0x3333333333333333333333333333333333333333', '0x6002'),
  };
});
const client = { getCode: vi.fn(), getStorageAt: vi.fn(), readContract: vi.fn(), call: vi.fn() };
const verify = () => assertSafeIdentity(client as any, safe, 1, 100n);
beforeEach(() => {
  vi.resetAllMocks();
  client.getCode.mockImplementation(async ({ address }) => address === singleton ? '0x6001' : address === factory ? '0x6002' : '0x6003');
  client.getStorageAt.mockResolvedValue(padHex(singleton, { size: 32 }));
  client.readContract.mockResolvedValue('0x6004');
  client.call.mockResolvedValue({ data: '0x6003' });
});
describe('canonical funding account identity', () => {
  it('accepts a matching proxy and published singleton at one block', async () => {
    await expect(verify()).resolves.toBeUndefined();
    expect(client.call).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 100n }));
  });
  it('rejects an imitation proxy even when its storage claims a real singleton', async () => {
    client.call.mockResolvedValue({ data: '0x6005' });
    await expect(verify()).rejects.toThrow('proxy could not be verified');
  });
  it('rejects modified code at a published singleton address', async () => {
    client.getCode.mockImplementation(async ({ address }) => address === singleton ? '0xdeadbeef' : '0x6003');
    await expect(verify()).rejects.toThrow('verified Safe implementation');
  });
  it('rejects an unrecognized singleton', async () => {
    client.getStorageAt.mockResolvedValue(padHex(safe, { size: 32 }));
    await expect(verify()).rejects.toThrow('verified Safe implementation');
  });
  it('does not trust a factory with changed code', async () => {
    client.getCode.mockImplementation(async ({ address }) => address === singleton ? '0x6001' : '0x6003');
    await expect(verify()).rejects.toThrow('proxy could not be verified');
    expect(client.readContract).not.toHaveBeenCalled();
  });
  it('rejects missing account code', async () => {
    client.getCode.mockResolvedValue(undefined);
    await expect(verify()).rejects.toThrow('No deployed Safe');
  });
});
