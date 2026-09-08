import { expect, it, vi } from "vitest";
import { scheduledScanStart } from "../lib/circleRecovery";
it("finds the block immediately before a future payment window with logarithmic reads", async () => {
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: 1000n + blockNumber * 2n,
    hash: `0x${"11".repeat(32)}`,
  }));
  const result = await scheduledScanStart(
    { getBlock } as unknown as Parameters<typeof scheduledScanStart>[0],
    100n,
    4_000_000n,
    7_000_000,
  );
  expect(result).toBe(3_499_499n);
  expect(getBlock.mock.calls.length).toBeLessThan(25);
});
it("does not skip a block when the saved start is already in the valid window", async () => {
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: 7000n,
    hash: `0x${"11".repeat(32)}`,
  }));
  expect(
    await scheduledScanStart(
      { getBlock } as unknown as Parameters<typeof scheduledScanStart>[0],
      100n,
      1000n,
      6999,
    ),
  ).toBe(100n);
});
it("rejects inconsistent block-number evidence instead of skipping a range", async () => {
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber + 1n,
    timestamp: blockNumber,
    hash: `0x${"11".repeat(32)}`,
  }));
  await expect(
    scheduledScanStart(
      { getBlock } as unknown as Parameters<typeof scheduledScanStart>[0],
      100n,
      1000n,
      900,
    ),
  ).rejects.toThrow("inconsistent block");
});
