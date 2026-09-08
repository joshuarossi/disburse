import {
  erc20Abi,
  getAddress,
  hashTypedData,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import {
  applyCircleGasEstimate,
  circleAccountCall,
  circleConfiguration,
  circlePermitData,
  circlePrefund,
  circleSignature,
} from "../../shared/circleExecution";
import {
  circleFeeSigningData,
  circleRootSigningData,
  type CircleRequest,
} from "../../shared/circleRequest";
import { circleRpc } from "../../shared/circleTransport";
import { packSafeSignatures } from "../../shared/safeSignatures";
import { assertCustomerPaidAccount } from "./customerPaidAccount";
import { getChainClient } from "./safeVerification";
import {
  assembleDataApprovals,
  type SavedAccountSignature,
} from "./accountApproval";
import type { AccountAuthority } from "./accountAuthority";
import { DEFAULT_CIRCLE_FEE_LIMIT } from "../../shared/circleQueue";

const paymasterAbi = parseAbi([
  "function token() view returns(address)",
  "function paused() view returns(bool)",
  "function fetchPrice() view returns(uint256)",
  "function feeSpread() view returns(uint32)",
  "function additionalGasCharge() view returns(uint256)",
]);
const permitAbi = parseAbi([
  "function name() view returns(string)",
  "function version() view returns(string)",
  "function nonces(address owner) view returns(uint256)",
  "function DOMAIN_SEPARATOR() view returns(bytes32)",
]);
const nonceAbi = parseAbi([
  "function getNonce(address sender,uint192 key) view returns(uint256)",
]);
export async function circleAccountState(
  chainId: number,
  safe: Address,
  nonceKey = 0n,
) {
  const client = getChainClient(chainId),
    config = circleConfiguration(chainId);
  const block = await client.getBlock();
  await assertCustomerPaidAccount(client, safe, chainId, block.number);
  const safeNonce = await client.readContract({
    address: safe,
    abi: parseAbi(["function nonce() view returns(uint256)"]),
    functionName: "nonce",
    blockNumber: block.number,
  });
  const [
    network,
    token,
    paused,
    price,
    spread,
    additionalGas,
    balance,
    allowance,
    name,
    version,
    permitNonce,
    separator,
    nonce,
    fees,
  ] = await Promise.all([
    client.getChainId(),
    ...(
      [
        "token",
        "paused",
        "fetchPrice",
        "feeSpread",
        "additionalGasCharge",
      ] as const
    ).map((functionName) =>
      client.readContract({
        address: config.paymaster,
        abi: paymasterAbi,
        functionName,
        blockNumber: block.number,
      }),
    ),
    client.readContract({
      address: config.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [safe],
      blockNumber: block.number,
    }),
    client.readContract({
      address: config.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [safe, config.paymaster],
      blockNumber: block.number,
    }),
    ...(["name", "version", "nonces", "DOMAIN_SEPARATOR"] as const).map(
      (functionName) =>
        client.readContract({
          address: config.token,
          abi: permitAbi,
          functionName,
          ...(functionName === "nonces" ? { args: [safe] } : {}),
          blockNumber: block.number,
        }),
    ),
    client.readContract({
      address: config.entryPoint,
      abi: nonceAbi,
      functionName: "getNonce",
      args: [safe, nonceKey],
      blockNumber: block.number,
    }),
    client.estimateFeesPerGas(),
  ]);
  if (
    network !== chainId ||
    typeof token !== "string" ||
    token.toLowerCase() !== config.token.toLowerCase() ||
    paused !== false ||
    typeof balance !== "bigint" ||
    typeof allowance !== "bigint" ||
    typeof nonce !== "bigint" ||
    typeof fees !== "object" ||
    !fees ||
    typeof fees.maxFeePerGas !== "bigint" ||
    typeof fees.maxPriorityFeePerGas !== "bigint" ||
    typeof price !== "bigint" ||
    typeof additionalGas !== "bigint" ||
    typeof spread !== "number" ||
    typeof name !== "string" ||
    typeof version !== "string" ||
    typeof permitNonce !== "bigint"
  )
    throw new Error(
      "USDC execution fees are temporarily unavailable on this network. Try again shortly.",
    );
  return {
    client,
    config,
    block,
    price,
    spread: BigInt(spread),
    additionalGas,
    balance,
    allowance,
    name,
    version,
    permitNonce,
    separator,
    nonce,
    safeNonce,
    fees,
  };
}
export async function prepareCircleRequest(input: {
  chainId: number;
  safe: string;
  transaction: { to: string; data: string };
  originalHash: string;
  principalUSDC: bigint;
  directCall?: boolean;
  previousPermit?: { nonce: string; amount: string };
  nonceKey?: bigint;
  queueFeeLimit?: bigint;
}): Promise<CircleRequest> {
  const safe = getAddress(input.safe),
    state = await circleAccountState(input.chainId, safe, input.nonceKey);
  if (
    !input.directCall &&
    input.transaction.to.toLowerCase() !== safe.toLowerCase()
  )
    throw new Error(
      "The approved transaction belongs to a different company account",
    );
  const to = getAddress(input.transaction.to);
  const request: CircleRequest = {
    chainId: input.chainId,
    safe,
    transaction: { to, data: input.transaction.data as Hex },
    originalHash: input.originalHash as Hex,
    ...(input.directCall ? { directCall: true } : {}),
    permit: {
      name: state.name,
      version: state.version,
      nonce: String(state.permitNonce),
      amount: "1",
    },
    validAfter: 0,
    validUntil: Number(state.block.timestamp) + 1800,
    startBlock: String(state.block.number),
    safeNonce: String(state.safeNonce),
    operation: {
      sender: safe,
      nonce: state.nonce,
      callData: circleAccountCall(to, input.transaction.data as Hex),
      callGasLimit: 2_000_000n + BigInt(input.transaction.data.length) * 100n,
      verificationGasLimit: 2_000_000n,
      preVerificationGas: 300_000n,
      maxFeePerGas: state.fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: state.fees.maxPriorityFeePerGas,
      paymaster: state.config.paymaster,
      paymasterVerificationGasLimit: 2_000_000n,
      paymasterPostOpGasLimit: 150_000n,
      paymasterData: "0x",
      signature: circleSignature(
        0,
        Number(state.block.timestamp) + 1800,
        `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
      ),
    },
  };
  const estimate = circlePrefund(
    request.operation,
    state.price,
    state.additionalGas,
    state.spread,
  );
  // An unused permit has no token-level expiry. Reuse its exact cap until its
  // nonce advances, so a previously signed permit cannot raise a newer cap.
  const estimateWithMargin = (estimate * 125n + 99n) / 100n;
  const estimatedCap =
    input.nonceKey && estimateWithMargin < DEFAULT_CIRCLE_FEE_LIMIT
      ? DEFAULT_CIRCLE_FEE_LIMIT
      : estimateWithMargin;
  const amount =
    input.queueFeeLimit ??
    (input.previousPermit?.nonce === String(state.permitNonce)
      ? BigInt(input.previousPermit.amount)
      : state.allowance > estimatedCap
        ? state.allowance
        : estimatedCap);
  if (
    input.previousPermit?.nonce === String(state.permitNonce) &&
    BigInt(input.previousPermit.amount) !== amount
  )
    throw new Error(
      "The earlier fee permit must keep its approved limit. Check that execution before preparing another.",
    );
  if (amount < estimate)
    throw new Error(
      "The current fee authorization is too small for this operation. Complete or revoke the original fee authorization first.",
    );
  if (amount > 20_000_000n || amount <= 0n)
    throw new Error(
      "The execution fee exceeds the supported review limit. Wait for lower network fees.",
    );
  if (state.allowance > amount)
    throw new Error(
      "This account has a larger existing service allowance. Review and reduce that allowance before authorizing a lower fee limit.",
    );
  if (state.balance < input.principalUSDC + amount)
    throw new Error(
      "The company account needs enough USDC for its payments and the maximum execution fee. Add USDC or lower the payment amount.",
    );
  request.permit.amount = String(amount);
  const typed = circleFeeSigningData(request);
  // Compare the domain separately, without assuming a token's name/version.
  const { hashDomain } = await import("viem");
  if (
    hashDomain({
      domain: { ...typed.domain, chainId: BigInt(typed.domain.chainId) },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    }).toLowerCase() !== String(state.separator).toLowerCase()
  )
    throw new Error(
      "This currency does not support the required fee authorization.",
    );
  return request;
}
export async function finishCircleFeeApproval(
  request: CircleRequest,
  authority: AccountAuthority,
  signatures: SavedAccountSignature[],
) {
  const collected = await assembleDataApprovals(
    request.chainId,
    authority,
    circleRootSigningData(request, "fee"),
    signatures,
  );
  if (collected.confirmations.length < authority.nodes[0].threshold)
    return null;
  const next = structuredClone(request);
  next.operation.paymasterData = circlePermitData(
    request.chainId,
    BigInt(request.permit.amount),
    packSafeSignatures(
      collected.confirmations.slice(0, authority.nodes[0].threshold),
    ),
  );
  const estimate = await circleRpc(
    request.chainId,
    "eth_estimateUserOperationGas",
    [next.operation, circleConfiguration(request.chainId).entryPoint],
  );
  next.operation = applyCircleGasEstimate(next.operation, estimate);
  const state = await circleAccountState(
    request.chainId,
    request.safe,
    request.operation.nonce >> 64n,
  );
  // A third party can submit the public permit ahead of the UserOp. Circle
  // deliberately accepts this; the remaining bounded allowance must cover gas.
  if (
    state.permitNonce < BigInt(request.permit.nonce) ||
    state.nonce !== request.operation.nonce ||
    Number(state.block.timestamp) >= request.validUntil - 60
  )
    throw new Error(
      "The fee authorization changed or expired. Check the original request before starting another.",
    );
  if (
    circlePrefund(
      next.operation,
      state.price,
      state.additionalGas,
      state.spread,
    ) > BigInt(request.permit.amount)
  )
    throw new Error(
      "Network fees increased beyond the amount approved. The payment was not submitted.",
    );
  if (state.allowance > BigInt(request.permit.amount))
    throw new Error(
      "The service allowance changed. Review the original fee authorization before continuing.",
    );
  if (
    keccak256(circleRootSigningData(next, "operation")) !==
    hashTypedData(
      (await import("../../shared/circleExecution")).circleOperationSigningData(
        next.chainId,
        next.operation,
        next.validAfter,
        next.validUntil,
      ),
    )
  )
    throw new Error("The account operation could not be verified.");
  return next;
}
