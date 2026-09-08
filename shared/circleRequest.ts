import {
  concatHex,
  encodeAbiParameters,
  hashStruct,
  hashTypedData,
  isAddress,
  keccak256,
  maxUint256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import {
  circleAccountCall,
  circleConfiguration,
  circleOperationSigningData,
  type CircleUserOperation,
} from "./circleExecution";
import { messageSigningData } from "./safeSignatures";

export const circlePermitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export type CircleRequest = {
  chainId: number;
  safe: Address;
  transaction: { to: Address; data: Hex; operation?: 0 | 1 };
  originalHash: Hex;
  directCall?: boolean;
  permit: { name: string; version: string; nonce: string; amount: string };
  validAfter: number;
  validUntil: number;
  startBlock: string;
  safeNonce: string;
  operation: CircleUserOperation;
};
export function circleFeeSigningData(request: CircleRequest) {
  const { token, paymaster } = circleConfiguration(request.chainId);
  return {
    domain: {
      name: request.permit.name,
      version: request.permit.version,
      chainId: request.chainId,
      verifyingContract: token,
    },
    types: circlePermitTypes,
    primaryType: "Permit" as const,
    message: {
      owner: request.safe,
      spender: paymaster,
      value: BigInt(request.permit.amount),
      nonce: BigInt(request.permit.nonce),
      deadline: maxUint256,
    },
  };
}
export function circleRootSigningData(
  request: CircleRequest,
  stage: "fee" | "operation",
): Hex {
  if (stage === "fee")
    return messageSigningData(
      request.chainId,
      request.safe,
      hashTypedData(circleFeeSigningData(request)),
    );
  const typed = circleOperationSigningData(
    request.chainId,
    request.operation,
    request.validAfter,
    request.validUntil,
  );
  const domain = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [
        keccak256(
          stringToHex(
            "EIP712Domain(uint256 chainId,address verifyingContract)",
          ),
        ),
        BigInt(request.chainId),
        typed.domain.verifyingContract,
      ],
    ),
  );
  return concatHex([
    "0x1901",
    domain,
    hashStruct({
      data: typed.message,
      primaryType: typed.primaryType,
      types: typed.types,
    }),
  ]);
}
export function encodeCircleRequest(request: CircleRequest) {
  return JSON.stringify(request, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}
const uintFields = [
  "nonce",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxPriorityFeePerGas",
  "maxFeePerGas",
  "paymasterVerificationGasLimit",
  "paymasterPostOpGasLimit",
] as const;
const uint = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]{0,77})$/.test(value) &&
  BigInt(value) <= maxUint256;
const hex = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x(?:[a-f0-9]{2})*$/i.test(value);
/** Durable requests remain readable after expiry. Expiry is checked against a
 * confirmed chain checkpoint during recovery, never treated as non-execution. */
export function decodeCircleRequest(encoded: string): CircleRequest {
  try {
    if (encoded.length > 200_000) throw new Error();
    const r = JSON.parse(encoded);
    if (
      !r ||
      typeof r !== "object" ||
      !Number.isSafeInteger(r.chainId) ||
      !isAddress(r.safe) ||
      !isAddress(r.transaction?.to) ||
      !hex(r.transaction.data) ||
      !/^0x[\da-f]{64}$/i.test(r.originalHash) ||
      !uint(r.startBlock) ||
      !uint(r.safeNonce) ||
      !uint(r.permit?.nonce) ||
      !uint(r.permit?.amount) ||
      BigInt(r.permit.amount) <= 0n ||
      BigInt(r.permit.amount) > 20_000_000n ||
      typeof r.permit.name !== "string" ||
      !r.permit.name.length ||
      r.permit.name.length > 80 ||
      typeof r.permit.version !== "string" ||
      r.permit.version.length > 16 ||
      !r.operation ||
      r.operation.sender?.toLowerCase() !== r.safe.toLowerCase() ||
      !hex(r.operation.signature) ||
      r.operation.factory ||
      r.operation.factoryData ||
      !hex(r.operation.paymasterData)
    )
      throw new Error();
    for (const key of uintFields) {
      if (!uint(r.operation[key])) throw new Error();
      r.operation[key] = BigInt(r.operation[key]);
    }
    if (
      (r.directCall !== undefined && typeof r.directCall !== "boolean") ||
      (!r.directCall &&
        r.transaction.to.toLowerCase() !== r.safe.toLowerCase()) ||
      (r.transaction.operation !== undefined &&
        r.transaction.operation !== 0 &&
        r.transaction.operation !== 1) ||
      (!r.directCall && r.transaction.operation === 1) ||
      circleAccountCall(
        r.transaction.to,
        r.transaction.data,
        r.transaction.operation,
      ).toLowerCase() !== r.operation.callData?.toLowerCase()
    )
      throw new Error();
    circleOperationSigningData(
      r.chainId,
      r.operation,
      r.validAfter,
      r.validUntil,
    );
    return r as CircleRequest;
  } catch {
    throw new Error(
      "The saved fee request could not be read. Keep the original payment and contact support before trying another execution.",
    );
  }
}
/** Immediate provider quotes start now; a zero validAfter is not Unix epoch
 * authorization duration. Scheduled requests retain a maximum one-day window. */
export function circleValidityWindow(
  window: { validAfter: number; validUntil: number } | undefined,
  blockTime: number,
  directCall = false,
) {
  if (!window) return { validAfter: 0, validUntil: blockTime + 1800 };
  const { validAfter, validUntil } = window;
  if (
    !directCall ||
    !Number.isSafeInteger(validAfter) ||
    !Number.isSafeInteger(validUntil) ||
    validAfter < 0 ||
    validUntil <= blockTime + 60 ||
    validUntil <= validAfter ||
    validUntil - (validAfter || blockTime) > 86400 ||
    validAfter > blockTime + 90 * 86400
  )
    throw new Error(
      validAfter === 0
        ? "This quote is no longer ready for approval. Review a fresh quote."
        : "Choose a payment date within the next 90 days.",
    );
  return { validAfter, validUntil };
}
