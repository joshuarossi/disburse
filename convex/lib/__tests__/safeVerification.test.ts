import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifySafeOwnership } from '../safeVerification';
const mocks = vi.hoisted(() => ({ getChainId: vi.fn(), getCode: vi.fn(), readContract: vi.fn(), getBlockNumber: vi.fn(), identity: vi.fn() }));
vi.mock('../safeIdentity', () => ({ assertSafeIdentity: (...args: unknown[]) => mocks.identity(...args) }));
vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  createPublicClient: () => mocks,
}));
const owner = '0x1111111111111111111111111111111111111111';
const safe = '0x2222222222222222222222222222222222222222';
beforeEach(() => {
  mocks.getBlockNumber.mockResolvedValue(123n);
  mocks.identity.mockResolvedValue(undefined);
  mocks.getCode.mockResolvedValue(undefined);
  mocks.getChainId.mockResolvedValue(1);
  mocks.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      functionName === 'getOwners' ? [owner] : 1n,
  );
});
describe('funding account verification', () => {
  it('reads deployed ownership and threshold', async () =>
    expect(await verifySafeOwnership(safe, 1, owner)).toEqual({
      owners: [owner],
      threshold: 1,
    }));
  it('rejects an ordinary address without deployed code', async () => {
    mocks.identity.mockRejectedValue(new Error('No deployed Safe'));
    await expect(verifySafeOwnership(safe, 1, owner)).rejects.toThrow(
      'No deployed Safe',
    );
  });
  it('rejects a caller who is not an owner', async () =>
    expect(verifySafeOwnership(safe, 1, safe)).rejects.toThrow(
      'current approver',
    ));
  it('rejects an invalid threshold', async () => {
    mocks.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) =>
        functionName === 'getOwners' ? [owner] : 2n,
    );
    await expect(verifySafeOwnership(safe, 1, owner)).rejects.toThrow(
      'threshold',
    );
  });
  it('rejects unsupported chains before reading the network', async () =>
    expect(verifySafeOwnership(safe, 999999, owner)).rejects.toThrow(
      'Unsupported',
    ));
});
