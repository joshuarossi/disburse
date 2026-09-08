import { beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi, zeroAddress, type Hex } from "viem";
import {
  accountFeeSetupTransaction,
  inspectAccountFeeSetup,
} from "../lib/accountFeeSetup";
import { SAFE_4337_MODULE } from "../../shared/safe4337";
import runtime from "../../src/lib/__tests__/fixtures/safe4337Runtime.json";
const state = vi.hoisted(() => ({
  enabled: false,
  handler: "0x0000000000000000000000000000000000000000",
  badCode: false,
}));
vi.mock("../lib/safeVerification", () => ({
  getChainClient: () => ({
    getStorageAt: async () => `0x${"00".repeat(12)}${state.handler.slice(2)}`,
    readContract: async () => state.enabled,
    getCode: async ({ address }: { address: string }) =>
      address.toLowerCase() === SAFE_4337_MODULE.toLowerCase() && !state.badCode
        ? (runtime.bytecode as Hex)
        : "0x6000",
  }),
}));
const safe = "0x1111111111111111111111111111111111111111";
beforeEach(() => {
  state.enabled = false;
  state.handler = zeroAddress;
  state.badCode = false;
});
it("accepts only the pinned published fee module runtime", async () => {
  expect(await inspectAccountFeeSetup(8453, safe, 123n)).toMatchObject({
    enabled: false,
    ready: false,
  });
  state.badCode = true;
  await expect(inspectAccountFeeSetup(8453, safe, 123n)).rejects.toThrow(
    "could not be verified",
  );
});
it("does not overwrite an unknown fallback handler", async () => {
  state.handler = "0x2222222222222222222222222222222222222222";
  await expect(inspectAccountFeeSetup(8453, safe, 123n)).rejects.toThrow(
    "custom signature handler",
  );
});
it("requires both the module and handler to declare the account ready", async () => {
  state.enabled = true;
  expect((await inspectAccountFeeSetup(8453, safe, 123n)).ready).toBe(false);
  state.handler = SAFE_4337_MODULE;
  expect((await inspectAccountFeeSetup(8453, safe, 123n)).ready).toBe(true);
  await expect(inspectAccountFeeSetup(84532, safe, 123n)).rejects.toThrow(
    "Base or Arbitrum",
  );
});
it("can repair a partially configured account with the exact missing self-call", () => {
  const tx = accountFeeSetupTransaction(
    8453,
    safe,
    { handler: zeroAddress, enabled: true },
    3,
  );
  expect(tx).toMatchObject({
    to: safe,
    operation: 0,
    value: "0",
    gasPrice: "0",
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: 3,
  });
  expect(
    decodeFunctionData({
      abi: parseAbi(["function setFallbackHandler(address handler)"]),
      data: tx.data as Hex,
    }).args,
  ).toEqual([SAFE_4337_MODULE]);
  const onlyModule = accountFeeSetupTransaction(
    8453,
    safe,
    { handler: SAFE_4337_MODULE, enabled: false },
    3,
  );
  expect(
    decodeFunctionData({
      abi: parseAbi(["function enableModule(address module)"]),
      data: onlyModule.data as Hex,
    }).args,
  ).toEqual([SAFE_4337_MODULE]);
  expect(() =>
    accountFeeSetupTransaction(
      8453,
      safe,
      { handler: SAFE_4337_MODULE, enabled: true },
      3,
    ),
  ).toThrow("already supports");
});
