import { expect, it, vi } from "vitest";
import { makeCctpQuote, cctpConfiguration } from "../../shared/cctp";
import { readCctpDeliveryReceipt, scanCctpDelivery } from "../lib/cctpDelivery";
import { cctpRequest } from "../lib/cctpProvider";

const quote = makeCctpQuote(
  {
    reference: `0x${"12".repeat(32)}`,
    chainId: 84532,
    destinationChainId: 11155111,
    account: "0x1111111111111111111111111111111111111111",
    destination: "0x2222222222222222222222222222222222222222",
    amount: "1000000",
  },
  [{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { high: 200000 } }],
  20_000_000,
);
const hash = `0x${"ab".repeat(32)}` as const;
it("treats an unobserved burn as pending while still rejecting missing fee quotes", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response("not found", { status: 404 }));
  vi.stubGlobal("fetch", request);
  try {
    expect(
      await cctpRequest(84532, `/v2/messages/6?transactionHash=${hash}`),
    ).toEqual({ messages: [] });
    await expect(
      cctpRequest(84532, "/v2/burn/USDC/fees/6/0?forward=true"),
    ).rejects.toThrow("unavailable");
    expect(request.mock.calls[0][1].headers).toEqual({
      Accept: "application/json",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
function client() {
  const mock = {
    getBlockNumber: vi.fn().mockResolvedValue(10000n),
    getBlock: vi.fn().mockImplementation(async ({ blockNumber }) => ({
      number: blockNumber,
      timestamp: blockNumber * 10n,
    })),
    getLogs: vi.fn().mockResolvedValue([
      { transactionHash: hash, removed: false },
      { transactionHash: hash, removed: false },
    ]),
    getTransactionReceipt: vi
      .fn()
      .mockResolvedValue({ status: "success", blockNumber: 100n, logs: [] }),
    getChainId: vi.fn().mockResolvedValue(11155111),
  };
  return {
    mock,
    chain: mock as unknown as Parameters<typeof scanCctpDelivery>[0] &
      Parameters<typeof readCctpDeliveryReceipt>[0],
  };
}
it("scans at most 1000 blocks of the receiving account and overlaps checkpoints", async () => {
  const { mock, chain } = client();
  expect(await scanCctpDelivery(chain, quote, "1002")).toEqual({
    hashes: [hash],
    nextBlock: "2000",
    more: true,
  });
  expect(mock.getLogs).toHaveBeenCalledWith(
    expect.objectContaining({
      address: cctpConfiguration(11155111).messenger,
      args: { mintRecipient: quote.destination },
      fromBlock: 1000n,
      toBlock: 1999n,
    }),
  );
  expect(mock.getBlock).not.toHaveBeenCalled();
});
it("bootstraps saved transfers from their creation time without collecting network history", async () => {
  const { mock, chain } = client();
  const scan = await scanCctpDelivery(chain, quote);
  expect(scan.nextBlock).toBe("2970");
  expect(mock.getBlock.mock.calls.length).toBeLessThan(15);
  expect(mock.getLogs).toHaveBeenCalledTimes(1);
  expect(mock.getLogs).toHaveBeenCalledWith(
    expect.objectContaining({ fromBlock: 1970n, toBlock: 2969n }),
  );
});
it("does not advance past an unreadable receipt or log range", async () => {
  const { mock, chain } = client();
  mock.getLogs.mockRejectedValue(new Error("temporary RPC failure"));
  await expect(scanCctpDelivery(chain, quote, "1000")).rejects.toThrow(
    "temporary RPC",
  );
  mock.getTransactionReceipt.mockRejectedValue(
    new Error("receipt temporarily unavailable"),
  );
  await expect(readCctpDeliveryReceipt(chain, quote, hash)).rejects.toThrow(
    "temporarily unavailable",
  );
});
it("does not mark an unrelated receipt or reverted transaction delivered", async () => {
  const { mock, chain } = client();
  expect(await readCctpDeliveryReceipt(chain, quote, hash)).toBeNull();
  mock.getTransactionReceipt.mockResolvedValue({
    status: "reverted",
    blockNumber: 100n,
    logs: [],
  });
  expect(await readCctpDeliveryReceipt(chain, quote, hash)).toBeNull();
  mock.getTransactionReceipt.mockResolvedValue({
    status: "success",
    blockNumber: 10000n,
    logs: [],
  });
  await expect(readCctpDeliveryReceipt(chain, quote, hash)).rejects.toThrow(
    "still confirming",
  );
});
it("rejects invalid checkpoints and excessive candidates, and ignores removed logs", async () => {
  const { mock, chain } = client();
  await expect(scanCctpDelivery(chain, quote, "-1")).rejects.toThrow(
    "checkpoint",
  );
  mock.getLogs.mockResolvedValue([{ transactionHash: hash, removed: true }]);
  expect((await scanCctpDelivery(chain, quote, "10000")).hashes).toEqual([]);
  mock.getLogs.mockResolvedValue(
    Array.from({ length: 21 }, (_, i) => ({
      transactionHash: `0x${String(i).padStart(64, "0")}`,
      removed: false,
    })),
  );
  await expect(scanCctpDelivery(chain, quote, "1000")).rejects.toThrow(
    "more receiving activity",
  );
});
