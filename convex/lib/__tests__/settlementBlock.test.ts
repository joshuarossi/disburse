import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSameSettlement, readSettlementBlock, validateSettlementBlock } from '../settlementBlock';

const hash = `0x${'ab'.repeat(32)}` as `0x${string}`;
const timestamp = Date.UTC(2026, 7, 31, 23, 59, 59);
const evidence = { blockNumber: '123', blockHash: hash, timestamp };
const receipt = { blockNumber: 123n, blockHash: hash };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 2)); });
afterEach(() => vi.useRealTimers());

describe('settlement date evidence', () => {
  function client() {
    return { getChainId: vi.fn().mockResolvedValue(11155111), getBlock: vi.fn().mockResolvedValue({
      number: 123n, hash, timestamp: BigInt(timestamp / 1000),
    }) };
  }
  const read = (rpc: ReturnType<typeof client>) => readSettlementBlock(rpc as unknown as Parameters<typeof readSettlementBlock>[0], 11155111, receipt);
  it('uses the mined block timestamp rather than the day the app discovers a payment', async () => {
    const rpc = client();
    expect(await read(rpc)).toEqual(evidence);
    expect(rpc.getBlock).toHaveBeenCalledWith({ blockNumber: 123n });
  });
  it('refuses a wrong network, reorged block or receipt/block-number mismatch', async () => {
    const rpc = client();
    rpc.getChainId.mockResolvedValueOnce(1);
    await expect(read(rpc)).rejects.toThrow('no longer matches');
    rpc.getBlock.mockResolvedValueOnce({ number: 123n, hash: `0x${'cd'.repeat(32)}`, timestamp: 1n });
    await expect(read(rpc)).rejects.toThrow('no longer matches');
    rpc.getBlock.mockResolvedValueOnce({ number: 124n, hash, timestamp: 1n });
    await expect(read(rpc)).rejects.toThrow('no longer matches');
  });
  it('refuses invalid or future timestamps and malformed block identities', () => {
    for (const invalid of [0, NaN, Infinity, 1.5, Date.now() + 300_001])
      expect(() => validateSettlementBlock({ ...evidence, timestamp: invalid })).toThrow('invalid');
    expect(() => validateSettlementBlock({ ...evidence, blockNumber: '-1' })).toThrow('invalid');
    expect(() => validateSettlementBlock({ ...evidence, blockHash: '0x123' })).toThrow('invalid');
  });
  it('allows identical proof to be retried but preserves an established settlement date', () => {
    expect(() => assertSameSettlement(undefined, evidence)).not.toThrow();
    expect(() => assertSameSettlement(evidence, { ...evidence, blockHash: hash.toUpperCase().replace('0X', '0x') })).not.toThrow();
    expect(() => assertSameSettlement(evidence, { ...evidence, timestamp: timestamp + 1000 })).toThrow('different settlement evidence');
  });
});
