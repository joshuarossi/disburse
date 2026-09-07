import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFundingBalance } from '../fundingBalance';
const client = vi.hoisted(() => ({ getBlockNumber: vi.fn(), readContract: vi.fn() }));
vi.mock('../safeVerification', () => ({ getChainClient: () => client }));
const safe = '0x1111111111111111111111111111111111111111';
const fee = { token: 'USDC', tokenAddress: safe, collector: safe, amount: '0.05' };
beforeEach(() => { vi.clearAllMocks(); client.getBlockNumber.mockResolvedValue(123n); });
describe('funding balance before wallet approval', () => {
  it('rejects a balance that covers recipients but not the stablecoin fee', async () => {
    client.readContract.mockResolvedValue(1000000000n);
    await expect(assertFundingBalance(11155111, safe, 'USDC', '1000', fee)).rejects.toThrow('1000.05 USDC');
  });
  it('accepts exact coverage and checks unlike fee currencies independently', async () => {
    client.readContract.mockResolvedValueOnce(1000050000n);
    await expect(assertFundingBalance(11155111, safe, 'USDC', '1000', fee)).resolves.toBeUndefined();
    client.readContract.mockResolvedValueOnce(1000000000n).mockResolvedValueOnce(49999n);
    await expect(assertFundingBalance(11155111, safe, 'USDT', '1000', fee)).rejects.toThrow('Available: 0.049999 USDC');
  });
});
