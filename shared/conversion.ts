import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getContractAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseEventLogs,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { CONVERSION_MARKETS } from "./conversionDeployments";
import { stableAccountBatch } from "./stableAccountBatch";
import { circleConfiguration } from "./circleExecution";
import type { CircleFeeProof } from "./circleSettlement";

export const CONVERSION_CHAINS = [8453, 42161, 84532] as const;
export const CONVERSION_QUOTE_LIFETIME = 10 * 60_000;
export const CONVERSION_SLIPPAGE_BPS = [10, 50, 100] as const;
export const CONVERSION_POOL_FEES = [100, 500, 3000] as const;
const poolInitCodeHash =
  "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";
export function conversionMarket(chainId: number) {
  const market =
    CONVERSION_MARKETS[String(chainId) as keyof typeof CONVERSION_MARKETS];
  if (!market)
    throw new Error("Conversions are not supported on this network.");
  return market;
}
export function conversionAssets(chainId: number, tokenIn: string) {
  const market = conversionMarket(chainId);
  const input = market.assets.find(
    (a) => a.address.toLowerCase() === tokenIn.toLowerCase(),
  );
  const output = market.assets.find(
    (a) => a.address.toLowerCase() !== tokenIn.toLowerCase(),
  );
  if (!input || !output)
    throw new Error("Choose a supported currency for this account.");
  return { input, output };
}
export const conversionAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "function allowance(address user,address token,address spender) view returns(uint160,uint48,uint48)",
  "function factory() view returns(address)",
  "function getPool(address,address,uint24) view returns(address)",
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function fee() view returns(uint24)",
  "function liquidity() view returns(uint128)",
  "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
]);
export function conversionPool(chainId: number, fee: number): Address {
  const market = conversionMarket(chainId);
  const [a, b] = [...market.assets.map((a) => a.address)].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  return getContractAddress({
    from: market.factory,
    opcode: "CREATE2",
    bytecodeHash: poolInitCodeHash,
    salt: keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint24" }],
        [a, b, fee],
      ),
    ),
  });
}
export type ConversionQuote = {
  version: 1;
  provider: "uniswap_v3";
  kind: "conversion";
  chainId: number;
  account: Address;
  reference: Hex;
  tokenIn: Address;
  tokenOut: Address;
  amount: string;
  expectedInput: string;
  maximumInput: string;
  pool: Address;
  poolFee: number;
  slippageBps: number;
  priceImpactBps: number;
  blockNumber: string;
  createdAt: number;
  expiresAt: number;
};
export type ConversionSnapshot = {
  chainId: number;
  account: Address;
  checkedAt: number;
  blockNumber: string;
  balances: { address: Address; symbol: string; amount: string }[];
  feeBalance: string;
};
const positive = /^[1-9]\d{0,13}$/;
export function maximumConversionInput(amount: string, slippageBps: number) {
  if (
    !positive.test(amount) ||
    !(CONVERSION_SLIPPAGE_BPS as readonly number[]).includes(slippageBps)
  )
    throw new Error("Choose a valid amount and price tolerance.");
  return (
    (BigInt(amount) * BigInt(10000 + slippageBps) + 9999n) /
    10000n
  ).toString();
}
export function validateConversionQuote(q: ConversionQuote) {
  const assets = conversionAssets(q.chainId, q.tokenIn);
  if (
    q.version !== 1 ||
    q.provider !== "uniswap_v3" ||
    q.kind !== "conversion" ||
    !isAddress(q.account) ||
    q.account.toLowerCase() === zeroAddress ||
    !/^0x[\da-fA-F]{64}$/.test(q.reference) ||
    q.reference === zeroHash ||
    q.tokenOut?.toLowerCase() !== assets.output.address.toLowerCase() ||
    !positive.test(q.amount) ||
    !positive.test(q.expectedInput) ||
    !positive.test(q.maximumInput) ||
    BigInt(q.amount) > 10_000_000_000_000n ||
    !(CONVERSION_POOL_FEES as readonly number[]).includes(q.poolFee) ||
    q.pool?.toLowerCase() !==
      conversionPool(q.chainId, q.poolFee).toLowerCase() ||
    q.maximumInput !== maximumConversionInput(q.expectedInput, q.slippageBps) ||
    !Number.isSafeInteger(q.priceImpactBps) ||
    q.priceImpactBps < 0 ||
    q.priceImpactBps > 100 ||
    !/^\d{1,30}$/.test(q.blockNumber) ||
    !Number.isSafeInteger(q.createdAt) ||
    q.createdAt <= 0 ||
    !Number.isSafeInteger(q.expiresAt) ||
    q.expiresAt - q.createdAt !== CONVERSION_QUOTE_LIFETIME
  )
    throw new Error(
      "The conversion review could not be verified. Request a fresh quote.",
    );
  // A token-to-token exchange-rate guard, not an assertion of either token's USD price.
  if (
    BigInt(q.expectedInput) * 100n < BigInt(q.amount) * 98n ||
    BigInt(q.expectedInput) * 100n > BigInt(q.amount) * 102n
  )
    throw new Error(
      "The exchange rate is outside the supported stablecoin range. Review the currencies before converting.",
    );
}
export function decodeConversionQuote(raw: string): ConversionQuote {
  if (raw.length > 12_000)
    throw new Error("The saved conversion review is too large.");
  const q = JSON.parse(raw) as ConversionQuote;
  if (!q || typeof q !== "object" || typeof q.tokenIn !== "string")
    throw new Error("The saved conversion review is invalid.");
  validateConversionQuote(q);
  return q;
}
export function conversionCall(q: ConversionQuote) {
  validateConversionQuote(q);
  const market = conversionMarket(q.chainId),
    deadline = BigInt(Math.floor(q.expiresAt / 1000));
  const approve = (amount: bigint) => ({
    to: q.tokenIn,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [market.permit2, amount],
    }),
  });
  const permit = (amount: bigint, expiry: number) => ({
    to: market.permit2,
    data: encodeFunctionData({
      abi: conversionAbi,
      functionName: "approve",
      args: [q.tokenIn, market.router, amount, expiry],
    }),
  });
  // Universal Router 2.1.1 requires the sixth minHopPriceX36 argument. Single-hop
  // exact-output swaps are also bounded by amountInMaximum, atomically.
  const input = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes" },
      { type: "bool" },
      { type: "uint256[]" },
    ],
    [
      q.account,
      BigInt(q.amount),
      BigInt(q.maximumInput),
      encodePacked(
        ["address", "uint24", "address"],
        [q.tokenOut, q.poolFee, q.tokenIn],
      ),
      true,
      [],
    ],
  );
  return stableAccountBatch(q.chainId, [
    approve(0n),
    approve(BigInt(q.maximumInput)),
    permit(BigInt(q.maximumInput), Number(deadline)),
    {
      to: market.router,
      data: encodeFunctionData({
        abi: conversionAbi,
        functionName: "execute",
        args: ["0x01", [input], deadline],
      }),
    },
    permit(0n, 0),
    approve(0n),
  ]);
}
export function conversionQuoteHash(q: ConversionQuote) {
  const call = conversionCall(q);
  return keccak256(
    encodePacked(
      ["string", "uint256", "address", "bytes32", "bytes32"],
      [
        "disburse-conversion-v1",
        BigInt(q.chainId),
        q.account,
        q.reference,
        keccak256(call.data),
      ],
    ),
  );
}
export function assertConversionSettlement(
  q: ConversionQuote,
  logs: Log[],
  boundary: {
    executionStart: number;
    executionEnd: number;
    feeProof?: CircleFeeProof;
  },
) {
  validateConversionQuote(q);
  if (
    !Number.isSafeInteger(boundary.executionStart) ||
    !Number.isSafeInteger(boundary.executionEnd) ||
    boundary.executionEnd <= boundary.executionStart ||
    logs.some((l) => l.removed)
  )
    throw new Error("The conversion execution boundary could not be verified.");
  const scoped = logs.filter(
    (l) =>
      l.logIndex !== null &&
      l.logIndex > boundary.executionStart &&
      l.logIndex < boundary.executionEnd,
  );
  const account = q.account.toLowerCase(),
    pool = q.pool.toLowerCase(),
    market = conversionMarket(q.chainId);
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: scoped,
    strict: true,
  });
  // Circle's post-operation refund precedes the EntryPoint completion event.
  // Exclude only the exact, independently reconciled fee refund. Other token
  // movements, including another refund-like transfer, still invalidate proof.
  const refund = boundary.feeProof?.refund;
  const fee = circleConfiguration(q.chainId);
  const isFeeRefund = (l: (typeof transfers)[number]) =>
    refund !== undefined &&
    l.logIndex === refund.logIndex &&
    l.address.toLowerCase() === fee.token.toLowerCase() &&
    l.args.from.toLowerCase() === fee.paymaster.toLowerCase() &&
    l.args.to.toLowerCase() === account &&
    String(l.args.value) === refund.amountRaw;
  if (refund && transfers.filter(isFeeRefund).length !== 1)
    throw new Error("The conversion fee refund could not be verified.");
  const involved = transfers.filter(
    (l) =>
      !isFeeRefund(l) &&
      [q.tokenIn.toLowerCase(), q.tokenOut.toLowerCase()].includes(
        l.address.toLowerCase(),
      ) &&
      (l.args.from.toLowerCase() === account ||
        l.args.to.toLowerCase() === account),
  );
  const debits = involved.filter(
    (l) =>
      l.address.toLowerCase() === q.tokenIn.toLowerCase() &&
      l.args.from.toLowerCase() === account &&
      l.args.to.toLowerCase() === pool,
  );
  const credits = involved.filter(
    (l) =>
      l.address.toLowerCase() === q.tokenOut.toLowerCase() &&
      l.args.from.toLowerCase() === pool &&
      l.args.to.toLowerCase() === account,
  );
  if (
    involved.length !== 2 ||
    debits.length !== 1 ||
    credits.length !== 1 ||
    debits[0].args.value <= 0n ||
    debits[0].args.value > BigInt(q.maximumInput) ||
    credits[0].args.value !== BigInt(q.amount)
  )
    throw new Error(
      "The conversion did not match its approved debit and exact receipt.",
    );
  const swaps = parseEventLogs({
    abi: conversionAbi,
    eventName: "Swap",
    logs: scoped,
    strict: true,
  }).filter((l) => l.address.toLowerCase() === pool);
  const inputIs0 = q.tokenIn.toLowerCase() < q.tokenOut.toLowerCase();
  if (
    swaps.length !== 1 ||
    swaps[0].args.sender.toLowerCase() !== market.router.toLowerCase() ||
    swaps[0].args.recipient.toLowerCase() !== account ||
    (inputIs0 ? swaps[0].args.amount0 : swaps[0].args.amount1) !==
      debits[0].args.value ||
    (inputIs0 ? swaps[0].args.amount1 : swaps[0].args.amount0) !==
      -BigInt(q.amount)
  )
    throw new Error("The published pool has not confirmed this conversion.");
  return {
    logIndex: debits[0].logIndex,
    outputLogIndex: credits[0].logIndex,
    amount: debits[0].args.value.toString(),
  };
}
