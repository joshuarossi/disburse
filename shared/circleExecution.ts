import {
  concatHex,
  encodeFunctionData,
  encodePacked,
  getAddress,
  hashTypedData,
  isAddress,
  isHex,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { configuredTokenAddress } from "./assets";
import { SAFE_4337_MODULE, SAFE_4337_SETUP } from "./safe4337";
export { SAFE_4337_MODULE, SAFE_4337_SETUP } from "./safe4337";

// Published Safe4337Module 0.3.0, EntryPoint 0.7 and Circle's permissionless
// TokenPaymasterV07. No application gas account or provider subscription.
export const CIRCLE_ENTRY_POINT =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;
export const CIRCLE_PAYMASTERS: Readonly<Record<number, Address>> = {
  8453: "0x6C973eBe80dCD8660841D4356bf15c32460271C9",
  42161: "0x6C973eBe80dCD8660841D4356bf15c32460271C9",
  84532: "0x31BE08D380A21fc740883c0BC434FcFc88740b58",
  421614: "0x31BE08D380A21fc740883c0BC434FcFc88740b58",
};
export function supportsCircleFees(chainId: number | undefined) {
  return (
    chainId !== undefined &&
    Object.prototype.hasOwnProperty.call(CIRCLE_PAYMASTERS, chainId)
  );
}
export type CircleUserOperation = {
  sender: Address;
  nonce: bigint;
  factory?: Address;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  paymaster: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  paymasterData: Hex;
  signature: Hex;
};
export const safeOperationTypes = {
  SafeOp: [
    { name: "safe", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "verificationGasLimit", type: "uint128" },
    { name: "callGasLimit", type: "uint128" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "maxPriorityFeePerGas", type: "uint128" },
    { name: "maxFeePerGas", type: "uint128" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "validAfter", type: "uint48" },
    { name: "validUntil", type: "uint48" },
    { name: "entryPoint", type: "address" },
  ],
} as const;
export function circleConfiguration(chainId: number) {
  const paymaster = CIRCLE_PAYMASTERS[chainId];
  const token = configuredTokenAddress(chainId, "USDC");
  if (!paymaster || !token)
    throw new Error("USDC execution fees are not available on this network");
  return {
    paymaster,
    token: getAddress(token),
    entryPoint: CIRCLE_ENTRY_POINT,
    module: SAFE_4337_MODULE,
    setup: SAFE_4337_SETUP,
  };
}
export function circlePermitData(
  chainId: number,
  amount: bigint,
  signature: Hex,
): Hex {
  const { token } = circleConfiguration(chainId);
  if (
    amount <= 0n ||
    amount >= 2n ** 256n ||
    !isHex(signature, { strict: true }) ||
    signature.length < 132
  )
    throw new Error("Invalid USDC fee authorization");
  return encodePacked(
    ["uint8", "address", "uint256", "bytes"],
    [0, token, amount, signature],
  );
}
export function circlePaymasterAndData(op: CircleUserOperation): Hex {
  return concatHex([
    op.paymaster,
    toHex(op.paymasterVerificationGasLimit, { size: 16 }),
    toHex(op.paymasterPostOpGasLimit, { size: 16 }),
    op.paymasterData,
  ]);
}
export function circleOperationSigningData(
  chainId: number,
  op: CircleUserOperation,
  validAfter: number,
  validUntil: number,
) {
  const config = circleConfiguration(chainId);
  if (
    op.paymaster.toLowerCase() !== config.paymaster.toLowerCase() ||
    !isAddress(op.sender) ||
    !isHex(op.callData, { strict: true })
  )
    throw new Error(
      "This execution request does not match the supported account service",
    );
  if (
    !Number.isSafeInteger(validAfter) ||
    !Number.isSafeInteger(validUntil) ||
    validAfter < 0 ||
    validUntil <= validAfter ||
    validUntil >= 2 ** 48
  )
    throw new Error("Use a bounded execution window");
  if (
    !!op.factory !== !!op.factoryData ||
    (op.factory && !isAddress(op.factory)) ||
    (op.factoryData && !isHex(op.factoryData, { strict: true }))
  )
    throw new Error("Invalid account deployment");
  for (const value of [
    op.callGasLimit,
    op.verificationGasLimit,
    op.maxPriorityFeePerGas,
    op.maxFeePerGas,
    op.paymasterVerificationGasLimit,
    op.paymasterPostOpGasLimit,
  ]) {
    if (value < 0n || value >= 2n ** 128n)
      throw new Error("Invalid execution gas limit");
  }
  if (
    op.nonce < 0n ||
    op.nonce >= 2n ** 256n ||
    op.preVerificationGas < 0n ||
    op.preVerificationGas >= 2n ** 256n ||
    op.maxFeePerGas < op.maxPriorityFeePerGas
  )
    throw new Error("Invalid execution gas or transaction number");
  return {
    domain: { chainId, verifyingContract: config.module },
    types: safeOperationTypes,
    primaryType: "SafeOp" as const,
    message: {
      safe: op.sender,
      nonce: op.nonce,
      initCode:
        op.factory && op.factoryData
          ? concatHex([op.factory, op.factoryData])
          : ("0x" as Hex),
      callData: op.callData,
      verificationGasLimit: op.verificationGasLimit,
      callGasLimit: op.callGasLimit,
      preVerificationGas: op.preVerificationGas,
      maxPriorityFeePerGas: op.maxPriorityFeePerGas,
      maxFeePerGas: op.maxFeePerGas,
      paymasterAndData: circlePaymasterAndData(op),
      validAfter,
      validUntil,
      entryPoint: config.entryPoint,
    },
  };
}
export function circleOperationHash(chainId: number, op: CircleUserOperation) {
  return getUserOperationHash({
    userOperation: op,
    chainId,
    entryPointAddress: CIRCLE_ENTRY_POINT,
    entryPointVersion: "0.7",
  });
}
export function circleSafeHash(
  chainId: number,
  op: CircleUserOperation,
  validAfter: number,
  validUntil: number,
) {
  return hashTypedData(
    circleOperationSigningData(chainId, op, validAfter, validUntil),
  );
}
export function circleSignature(
  validAfter: number,
  validUntil: number,
  ownerSignatures: Hex,
) {
  if (
    !Number.isSafeInteger(validAfter) ||
    !Number.isSafeInteger(validUntil) ||
    validAfter < 0 ||
    validUntil <= validAfter ||
    validUntil >= 2 ** 48 ||
    !isHex(ownerSignatures, { strict: true }) ||
    ownerSignatures.length < 132
  )
    throw new Error("Invalid account approval");
  return concatHex([
    encodePacked(["uint48", "uint48"], [validAfter, validUntil]),
    ownerSignatures,
  ]);
}
/** CALL into the recipient contract. Batch callers must separately validate a
 * published MultiSendCallOnly target before requesting a delegatecall. */
export function circleAccountCall(
  to: Address,
  data: Hex,
  operation: 0 | 1 = 0,
): Hex {
  if (
    !isAddress(to) ||
    !isHex(data, { strict: true }) ||
    (operation !== 0 && operation !== 1)
  )
    throw new Error("Invalid account operation");
  return encodeFunctionData({
    abi: parseAbi([
      "function executeUserOp(address to,uint256 value,bytes data,uint8 operation)",
    ]),
    functionName: "executeUserOp",
    args: [to, 0n, data, operation],
  });
}
/** Matches Circle TokenPaymasterV07's prefund calculation, including the fee
 * spread and rounding. The token/native exchange rate may change before mining. */
export function circlePrefund(
  op: CircleUserOperation,
  tokenPerNative: bigint,
  additionalGas: bigint,
  spreadBps: bigint,
) {
  if (
    tokenPerNative <= 0n ||
    additionalGas < 0n ||
    spreadBps < 0n ||
    spreadBps > 10_000n
  )
    throw new Error("The payment service returned an invalid fee estimate");
  const gas =
    op.callGasLimit +
    op.verificationGasLimit +
    op.preVerificationGas +
    op.paymasterVerificationGasLimit +
    op.paymasterPostOpGasLimit +
    additionalGas;
  const base = (gas * op.maxFeePerGas * tokenPerNative) / 10n ** 18n + 1n;
  return base + (base * spreadBps) / 10_000n;
}
/** ERC-4337 permits a bundler to omit paymaster estimates. Keep the reviewed
 * limits in that case; require all three account estimates and validate every
 * supplied field before adding the execution margin. */
export function applyCircleGasEstimate(
  operation: CircleUserOperation,
  estimate: unknown,
): CircleUserOperation {
  if (!estimate || typeof estimate !== "object" || Array.isArray(estimate))
    throw new Error(
      "The execution service returned an unreadable fee estimate.",
    );
  const next = { ...operation };
  for (const key of [
    "callGasLimit",
    "verificationGasLimit",
    "preVerificationGas",
    "paymasterVerificationGasLimit",
    "paymasterPostOpGasLimit",
  ] as const) {
    const value = (estimate as Record<string, unknown>)[key];
    if (value === undefined && key.startsWith("paymaster")) continue;
    if (
      typeof value !== "string" ||
      !/^0x[\da-f]{1,32}$/i.test(value) ||
      BigInt(value) <= 0n
    )
      throw new Error(
        "The execution service returned an invalid gas estimate.",
      );
    const gas = (BigInt(value) * 120n + 99n) / 100n;
    if (gas > 60_000_000n)
      throw new Error(
        "This payment is too large for the execution service. Use a smaller batch.",
      );
    next[key] = gas;
  }
  return next;
}
