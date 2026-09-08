import {
  circleAccountCall,
  circleConfiguration,
  circleSignature,
} from "../../../shared/circleExecution";
import {
  encodeCircleRequest,
  type CircleRequest,
} from "../../../shared/circleRequest";
import { safes, wallet } from "./fixtures";
import type { Address } from "viem";
export function readCircleFixture() {
  return JSON.parse(sessionStorage.getItem("qa:circle") ?? "null");
}
export function saveCircleFixture(value: unknown) {
  sessionStorage.setItem("qa:circle", JSON.stringify(value));
}
export function createCircleFixture() {
  const safe = safes[0].safeAddress as Address,
    config = circleConfiguration(8453),
    until = Math.floor(Date.now() / 1000) + 1800;
  const request: CircleRequest = {
    chainId: 8453,
    safe,
    transaction: { to: safe, data: "0x1234" },
    originalHash: `0x${"ab".repeat(32)}`,
    permit: { name: "USDC", version: "2", nonce: "0", amount: "500000" },
    validAfter: 0,
    validUntil: until,
    safeNonce: "0",
    startBlock: "100",
    operation: {
      sender: safe,
      nonce: 0n,
      callData: circleAccountCall(safe, "0x1234"),
      callGasLimit: 200000n,
      verificationGasLimit: 900000n,
      preVerificationGas: 100000n,
      maxFeePerGas: 10000000n,
      maxPriorityFeePerGas: 1000000n,
      paymaster: config.paymaster,
      paymasterVerificationGasLimit: 300000n,
      paymasterPostOpGasLimit: 80000n,
      paymasterData: "0x",
      signature: circleSignature(
        0,
        until,
        `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
      ),
    },
  };
  const schedule = JSON.parse(sessionStorage.getItem("qa:schedule") ?? "null");
  if (
    sessionStorage.getItem("qa:scenario")?.startsWith("circle-schedule-") &&
    schedule &&
    !schedule.cancellationRequestedAt
  ) {
    request.validAfter = schedule.validAfter;
    request.validUntil = schedule.validUntil;
    request.operation.nonce = 3n << 64n;
    request.operation.signature = circleSignature(
      request.validAfter,
      request.validUntil,
      `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
    );
  }
  const result = {
    _id: "circle1",
    record: encodeCircleRequest(request),
    revision: 0,
    stage: "fee",
    open: true,
    updatedAt: Date.now(),
  };
  saveCircleFixture(result);
  return result;
}
export async function signCircleApproval() {
  const scenario = sessionStorage.getItem("qa:scenario") ?? "";
  if (!scenario.startsWith("circle-"))
    throw new Error("Wallet operations are disabled in visual QA.");
  sessionStorage.setItem(
    "qa:circle-signatures",
    String(Number(sessionStorage.getItem("qa:circle-signatures") ?? "0") + 1),
  );
  if (scenario.endsWith("declined"))
    throw Object.assign(
      new Error(
        "User denied transaction signature. Request Arguments: calldata 0x1234 Version: viem@2",
      ),
      { code: 4001 },
    );
  if (scenario.endsWith("wallet-changed"))
    throw new Error(
      "Your wallet or network changed. Reconnect the original wallet before approving.",
    );
  return `0x${"11".repeat(32)}${"22".repeat(32)}1b`;
}
export const circleFixtureWallet = wallet;
