import { expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import {
  customerWalletBatch,
  customerWalletExecutionData,
  type WalletCalls,
} from "../../../shared/walletCalls";
import {
  submitCustomerWalletCalls,
  walletRequestNotAccepted,
} from "../services/metamaskCalls";
const payer = "0x1111111111111111111111111111111111111111" as Address;
const batchId = `0x${"aa".repeat(32)}` as Hex;
const intent: WalletCalls = {
  chainId: 8453,
  payer,
  calls: [
    { to: "0x2222222222222222222222222222222222222222", data: "0x12345678" },
  ],
};
it("requires atomic execution with no native value and preserves the exact saved calls", () => {
  expect(customerWalletBatch(intent, batchId)).toEqual({
    version: "2.0.0",
    id: batchId,
    chainId: "0x2105",
    atomicRequired: true,
    from: payer,
    calls: [{ ...intent.calls[0], value: "0x0" }],
  });
  const decoded = decodeFunctionData({
    abi: parseAbi(["function execute(bytes32 mode,bytes executionData)"]),
    data: customerWalletExecutionData(intent),
  });
  expect(decoded.args[0]).toBe(`0x01${"00".repeat(31)}`);
});
it("refuses unsupported networks, invalid calls, an empty batch and unbounded call counts", () => {
  for (const invalid of [
    { ...intent, chainId: 11155111 },
    { ...intent, calls: [] },
    { ...intent, calls: Array(202).fill(intent.calls[0]) },
    { ...intent, calls: [{ ...intent.calls[0], data: "0x1" as Hex }] },
  ])
    expect(() => customerWalletBatch(invalid, batchId)).toThrow();
});
it("does not send when the wallet changes after the database claim", async () => {
  const request = vi.fn(async ({ method }: { method: string }) =>
    method === "eth_chainId" ? "0x2105" : [],
  );
  await expect(
    submitCustomerWalletCalls(intent, batchId, { request }),
  ).rejects.toSatisfy(walletRequestNotAccepted);
  expect(
    request.mock.calls.some(([r]) => r.method === "wallet_sendCalls"),
  ).toBe(false);
});
it("preserves an unknown submitting response and never calls the native transaction API", async () => {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_accounts") return [payer];
    if (method === "wallet_getCapabilities")
      return { "0x2105": { atomic: { status: "ready" } } };
    throw new Error("Connection lost after submitting");
  });
  await expect(
    submitCustomerWalletCalls(intent, batchId, { request }),
  ).rejects.not.toSatisfy(walletRequestNotAccepted);
  expect(
    request.mock.calls.filter(([r]) => r.method === "wallet_sendCalls"),
  ).toHaveLength(1);
  expect(
    request.mock.calls.some(([r]) => r.method === "eth_sendTransaction"),
  ).toBe(false);
});
