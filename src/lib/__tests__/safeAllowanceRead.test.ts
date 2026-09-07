import { beforeEach, describe, expect, it, vi } from 'vitest';
import release from './fixtures/allowance-v1-runtime.json';
import {
  getAllowanceDeployments,
  readAllowanceSnapshot,
} from '../safeAllowance';
const rpc = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  getCode: vi.fn(),
  readContract: vi.fn(),
}));
vi.mock('viem', async (original) => ({
  ...(await original<typeof import('viem')>()),
  createPublicClient: () => rpc,
}));
const safe = '0x1111111111111111111111111111111111111111';
const delegate = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';
const module = getAllowanceDeployments(1)[0].address;
const response = ({ functionName }: { functionName: string }) => {
  switch (functionName) {
    case 'isModuleEnabled':
      return true;
    case 'getOwners':
      return [safe];
    case 'VERSION':
      return '1.4.1';
    case 'getDelegates':
      return [[delegate], 0];
    case 'delegates':
      return [delegate, 0, 0];
    case 'getTokens':
      return [token];
    case 'getTokenAllowance':
      return [100000000n, 25000000n, 1440n, 29000000n, 3n];
    default:
      throw new Error('Unexpected read');
  }
};
beforeEach(() => {
  vi.clearAllMocks();
  rpc.getBlockNumber.mockResolvedValue(123n);
  rpc.getCode.mockResolvedValue(release.runtime);
  rpc.readContract.mockImplementation(response);
});
describe('on-chain allowance discovery', () => {
  it('discovers grants without relying on app members and reads one block', async () => {
    const snapshot = await readAllowanceSnapshot(1, safe, module);
    expect(snapshot.delegates).toEqual([delegate]);
    expect(snapshot.allowances[0]).toMatchObject({
      delegate,
      token,
      amount: 100000000n,
      spent: 25000000n,
      resetMinutes: 1440,
    });
    expect(
      rpc.readContract.mock.calls.every(([args]) => args.blockNumber === 123n),
    ).toBe(true);
  });
  it('retains dormant grants so enabling cannot hide previous authority', async () => {
    rpc.readContract.mockImplementation((args) =>
      args.functionName === 'isModuleEnabled' ? false : response(args),
    );
    const snapshot = await readAllowanceSnapshot(1, safe, module);
    expect(snapshot.moduleEnabled).toBe(false);
    expect(snapshot.allowances).toHaveLength(1);
  });
  it('omits revoked zero allowances', async () => {
    rpc.readContract.mockImplementation((args) =>
      args.functionName === 'getTokenAllowance'
        ? [0n, 0n, 0n, 0n, 3n]
        : response(args),
    );
    expect((await readAllowanceSnapshot(1, safe, module)).allowances).toEqual(
      [],
    );
  });
  it('fails closed for undeployed code and RPC failures', async () => {
    rpc.getCode.mockResolvedValue('0x');
    await expect(readAllowanceSnapshot(1, safe, module)).rejects.toThrow(
      'not deployed',
    );
    rpc.getCode.mockRejectedValue(new Error('RPC unavailable'));
    await expect(readAllowanceSnapshot(1, safe, module)).rejects.toThrow(
      'RPC unavailable',
    );
  });
  it('rejects a repeating pagination cursor instead of presenting a partial list', async () => {
    rpc.readContract.mockImplementation((args) =>
      args.functionName === 'getDelegates' ? [[delegate], 1] : response(args),
    );
    await expect(readAllowanceSnapshot(1, safe, module)).rejects.toThrow(
      'completely',
    );
  });
  it('rejects a contract with the right address but unverified bytecode', async () => {
    rpc.getCode.mockResolvedValue('0x1234');
    await expect(readAllowanceSnapshot(1, safe, module)).rejects.toThrow('verified Safe release');
  });
  it('checks one member without enumerating the directory and retains dormant grants', async () => {
    rpc.readContract.mockImplementation(args => args.functionName === 'delegates' ? ['0x0000000000000000000000000000000000000000', 0, 0] : response(args));
    const result = await readAllowanceSnapshot(1, safe, module, delegate);
    expect(result.delegates).toEqual([]);
    expect(result.allowances).toHaveLength(1);
    expect(rpc.readContract.mock.calls.some(([args]) => args.functionName === 'getDelegates')).toBe(false);
  });
  it('refuses oversized token histories instead of returning partial authority', async () => {
    rpc.readContract.mockImplementation(args => args.functionName === 'getTokens' ? Array(101).fill(token) : response(args));
    await expect(readAllowanceSnapshot(1, safe, module, delegate)).rejects.toThrow('too large');
  });
});
