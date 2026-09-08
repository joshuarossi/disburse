import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi, keccak256, toHex, type Hex } from "viem";
import {
  walletSetupBatch,
  predictedWalletSafe,
  parseWalletBatchStatus,
  type WalletSetupIntent,
} from "../../../shared/walletSetup";
import {
  checkSetupWallet,
  submitWalletSetup,
  walletSetupNotAccepted,
} from "../services/metamaskSetup";
import fixture from "./fixtures/safeProxyCreationCode.json";
const payer = "0x01585228489577cdCdbd5eBb822C7c439a2c564c",
  address = "0x2abcD6635af17B7Dfb8d5b876a8f92d97fb3d1A1";
const intent: WalletSetupIntent = {
  chainId: 8453,
  payer,
  owners: [payer],
  threshold: 1,
  address,
  salt: toHex(981738871n, { size: 32 }),
  deposit: "1000000",
};
const batchId = keccak256(toHex("wallet-setup-test"));

describe("MetaMask company setup", () => {
  it("predicts the same address as the released Safe SDK using published factory bytecode", () => {
    expect(predictedWalletSafe(intent, fixture.code as Hex).toLowerCase()).toBe(
      address.toLowerCase(),
    );
  });
  it("requires one atomic batch with the exact deployment and full USDC deposit", () => {
    const batch = walletSetupBatch(intent, batchId);
    expect(batch).toMatchObject({
      version: "2.0.0",
      id: batchId,
      chainId: "0x2105",
      from: payer,
      atomicRequired: true,
    });
    expect(batch.calls).toHaveLength(2);
    expect(batch.calls.every((call) => call.value === "0x0")).toBe(true);
    expect(
      decodeFunctionData({ abi: erc20Abi, data: batch.calls[1].data }),
    ).toMatchObject({ functionName: "transfer", args: [address, 1000000n] });
    expect(batch).not.toHaveProperty("capabilities.paymasterService");
    expect(
      walletSetupBatch({ ...intent, deposit: "0" }, batchId).calls,
    ).toHaveLength(1);
  });
  it.each([84532, 11155111, 1, 137])(
    "does not advertise the complete setup service on unsupported network %s",
    (chainId) => {
      expect(() => walletSetupBatch({ ...intent, chainId }, batchId)).toThrow(
        "Base and Arbitrum",
      );
    },
  );
  it("does not submit when the account, network or atomic capability changes", async () => {
    for (const change of ["account", "chain", "capability"]) {
      const request = vi.fn(async ({ method }: { method: string }) =>
        method === "eth_accounts"
          ? [change === "account" ? address : payer]
          : method === "eth_chainId"
            ? change === "chain"
              ? "0x1"
              : "0x2105"
            : {
                "0x2105": {
                  atomic: {
                    status: change === "capability" ? "unsupported" : "ready",
                  },
                },
              },
      );
      await expect(checkSetupWallet(intent, { request })).rejects.toThrow();
      expect(
        request.mock.calls.every(
          ([call]) => call.method !== "wallet_sendCalls",
        ),
      ).toBe(true);
    }
  });
  it("submits exactly once and retains uncertainty if the wallet response is lost", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Response lost"));
    await expect(
      submitWalletSetup(intent, batchId, { request }),
    ).rejects.toThrow("Response lost");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      method: "wallet_sendCalls",
      params: [{ id: batchId, atomicRequired: true }],
    });
  });
  it("rejects a different returned batch ID without creating another request", async () => {
    const request = vi.fn().mockResolvedValue({ id: "0x123" });
    await expect(
      submitWalletSetup(intent, batchId, { request }),
    ).rejects.toThrow("original setup request");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    {},
    { status: 200, chainId: "0x1" },
    {
      status: 200,
      chainId: "0x2105",
      receipts: [{ transactionHash: "not-a-hash" }],
    },
    {
      status: 200,
      chainId: "0x2105",
      receipts: [{ transactionHash: batchId }, { transactionHash: batchId }],
    },
  ])("rejects malformed or unrelated wallet status", (value) => {
    expect(() => parseWalletBatchStatus(value, 8453)).toThrow();
  });
  it("leaves settlement confirmation to the server even when the wallet reports success", () => {
    expect(
      parseWalletBatchStatus(
        {
          status: 200,
          chainId: "0x2105",
          receipts: [{ transactionHash: batchId }],
        },
        8453,
      ),
    ).toEqual({ status: 200, txHash: batchId });
  });
  it("distinguishes a rejected request from an ambiguous duplicate or transport error", () => {
    expect(walletSetupNotAccepted({ code: 4001 })).toBe(true);
    expect(walletSetupNotAccepted({ code: 5750 })).toBe(true);
    expect(walletSetupNotAccepted({ code: 5720 })).toBe(false);
    expect(walletSetupNotAccepted({ code: -32000 })).toBe(false);
    expect(walletSetupNotAccepted(new Error("Connection lost"))).toBe(false);
  });
});
