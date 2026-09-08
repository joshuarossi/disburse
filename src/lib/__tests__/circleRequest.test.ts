import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  hashTypedData,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  circleFeeSigningData,
  circleRootSigningData,
  circleValidityWindow,
  decodeCircleRequest,
  encodeCircleRequest,
  type CircleRequest,
} from "../../../shared/circleRequest";
import {
  circleOperationSigningData,
  type CircleUserOperation,
} from "../../../shared/circleExecution";
import {
  messageSigningData,
  nestedSigningData,
  recoverSafeSigner,
  safeMessageTypes,
} from "../../../shared/safeSignatures";
import fixture from "./fixtures/circleRecoveryOperation.json";

it("accepts a short immediate provider quote without treating zero as its start date", () => {
  const now = 1_783_000_000, quote = { validAfter: 0, validUntil: now + 600 };
  expect(circleValidityWindow(quote, now, true)).toEqual(quote);
  expect(() => circleValidityWindow({ ...quote, validUntil: now + 60 }, now, true)).toThrow("fresh quote");
  expect(() => circleValidityWindow({ ...quote, validUntil: now + 86401 }, now, true)).toThrow();
  expect(() => circleValidityWindow(quote, now, false)).toThrow();
});
it("preserves scheduled authorization boundaries when accepting immediate quotes", () => {
  const now = 1_783_000_000, validAfter = now + 89 * 86400;
  expect(circleValidityWindow({ validAfter, validUntil: validAfter + 86400 }, now, true).validAfter).toBe(validAfter);
  for (const window of [{ validAfter, validUntil: validAfter + 86401 }, { validAfter: now + 91 * 86400, validUntil: now + 92 * 86400 }, { validAfter, validUntil: validAfter }, { validAfter: NaN, validUntil: now + 600 }])
    expect(() => circleValidityWindow(window, now, true)).toThrow();
});

const uintFields = [
  "nonce",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxPriorityFeePerGas",
  "maxFeePerGas",
  "paymasterVerificationGasLimit",
  "paymasterPostOpGasLimit",
];
const operation = Object.fromEntries(
  Object.entries(fixture.userOperation).map(([k, v]) => [
    k,
    uintFields.includes(k) ? BigInt(v) : v,
  ]),
) as CircleUserOperation;
const actualCall = decodeFunctionData({
  abi: parseAbi([
    "function executeUserOp(address to,uint256 value,bytes data,uint8 operation)",
  ]),
  data: operation.callData,
});
const request: CircleRequest = {
  chainId: 84532,
  safe: operation.sender,
  originalHash: `0x${"12".repeat(32)}`,
  directCall: true,
  transaction: { to: actualCall.args[0], data: actualCall.args[2] },
  permit: { name: "USDC", version: "2", nonce: "2", amount: "500000" },
  startBlock: "100",
  safeNonce: "0",
  validAfter: 0,
  validUntil: Number(BigInt(`0x${operation.signature.slice(14, 26)}`)),
  operation,
};
describe("persisted customer-paid account approvals", () => {
  it("round-trips an actual operation with exact integer gas and permit amounts after expiry", () => {
    expect(decodeCircleRequest(encodeCircleRequest(request))).toEqual(request);
  });
  it("uses the exact Safe4337 EIP-712 preimage for nested owner checks", () => {
    expect(keccak256(circleRootSigningData(request, "operation"))).toBe(
      hashTypedData(
        circleOperationSigningData(
          request.chainId,
          operation,
          request.validAfter,
          request.validUntil,
        ),
      ),
    );
  });
  it("binds fee approvals to the Safe, paymaster, USDC nonce and maximum amount", () => {
    const original = circleRootSigningData(request, "fee");
    expect(original).toBe(
      messageSigningData(
        request.chainId,
        request.safe,
        hashTypedData(circleFeeSigningData(request)),
      ),
    );
    for (const permit of [
      { ...request.permit, amount: "500001" },
      { ...request.permit, nonce: "3" },
    ])
      expect(circleRootSigningData({ ...request, permit }, "fee")).not.toBe(
        original,
      );
    expect(
      circleRootSigningData(
        { ...request, safe: `0x${"44".repeat(20)}` },
        "fee",
      ),
    ).not.toBe(original);
  });
  it("keeps a fee authorization separate from the complete execution authorization", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const signature = await signer.sign({
      hash: keccak256(circleRootSigningData(request, "fee")),
    });
    expect(
      await recoverSafeSigner(
        keccak256(circleRootSigningData(request, "operation")),
        signature,
      ),
    ).not.toBe(signer.address.toLowerCase());
  });
  it("verifies a human signature through two owning Safes against the same root operation", async () => {
    const signer = privateKeyToAccount(generatePrivateKey()),
      parent = `0x${"22".repeat(20)}` as Hex,
      grandparent = `0x${"33".repeat(20)}` as Hex;
    const path = [request.safe, parent, grandparent],
      nested = nestedSigningData(
        request.chainId,
        path,
        circleRootSigningData(request, "operation"),
      );
    const signature = await signer.signTypedData({
      domain: { chainId: request.chainId, verifyingContract: grandparent },
      types: safeMessageTypes,
      primaryType: "SafeMessage",
      message: { message: nested.message },
    });
    expect(await recoverSafeSigner(nested.hash, signature)).toBe(
      signer.address.toLowerCase(),
    );
    expect(
      await recoverSafeSigner(
        nestedSigningData(
          request.chainId,
          [request.safe, grandparent],
          circleRootSigningData(request, "operation"),
        ).hash,
        signature,
      ),
    ).not.toBe(signer.address.toLowerCase());
  });
  it.each([
    "chain",
    "payer",
    "amount",
    "nonce",
    "gas",
    "factory",
    "data",
    "call mismatch",
    "call mode",
    "too large",
  ])(
    "stops on a corrupt saved %s without converting it to a new request",
    (field) => {
      const r = JSON.parse(encodeCircleRequest(request));
      if (field === "chain") r.chainId = 1;
      if (field === "payer") r.safe = `0x${"11".repeat(20)}`;
      if (field === "amount") r.permit.amount = "Infinity";
      if (field === "nonce") r.operation.nonce = "-1";
      if (field === "gas") r.operation.maxFeePerGas = "1e30";
      if (field === "factory") r.operation.factory = request.safe;
      if (field === "data") r.transaction.data = "invalid";
      if (field === "call mismatch") r.transaction.data = "0x1234";
      if (field === "call mode") r.directCall = false;
      if (field === "too large") r.extra = "x".repeat(200_001);
      expect(() => decodeCircleRequest(JSON.stringify(r))).toThrow(
        "saved fee request",
      );
    },
  );
});
