import {
  encodeFunctionData,
  encodePacked,
  erc20Abi,
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
import { AAVE_MARKETS } from "./lendingDeployments";
import { stableAccountBatch } from "./stableAccountBatch";

export const LENDING_CHAINS = [8453, 42161, 84532] as const;
export const LENDING_QUOTE_LIFETIME = 10 * 60_000;
export type LendingSnapshot = {
  chainId: number;
  account: Address;
  asset: Address;
  assetLabel: string;
  blockNumber: string;
  checkedAt: number;
  available: string;
  supplied: string;
  feeBalance: string;
  liquidity: string;
  totalSupply: string;
  supplyCap: string;
  rateRay: string;
  debt: string;
  active: boolean;
  frozen: boolean;
  paused: boolean;
  price: string;
  priceUnit: string;
  priceUpdatedAt: number;
  priceAvailable: boolean;
};
export function lendingAvailability(
  kind: "supply" | "withdraw",
  s: LendingSnapshot,
  now: number,
): string | undefined {
  if (Math.abs(now - s.checkedAt) > 180_000)
    return "Refresh the account balance before continuing.";
  if (!s.active || s.paused)
    return "Aave has paused this reserve. Refresh its status before continuing.";
  if (BigInt(s.debt) > 0n)
    return "This account has an existing Aave loan. Manage its collateral and repayments in Aave before using Earn here.";
  if (BigInt(s.feeBalance) === 0n)
    return "Add some USDC to this company account for execution fees before continuing.";
  if (kind === "withdraw")
    return BigInt(s.liquidity) === 0n
      ? "Aave has no available liquidity for this withdrawal yet. Your position remains in your account."
      : undefined;
  if (s.frozen)
    return "Aave is not accepting new deposits into this reserve. Existing funds can still be withdrawn when liquidity is available.";
  if (
    !s.priceAvailable ||
    s.priceUpdatedAt <= 0 ||
    s.priceUpdatedAt > now + 60_000 ||
    now - s.priceUpdatedAt > 26 * 60 * 60_000
  )
    return "A current USDC price could not be verified. New deposits are paused; you can still review a withdrawal.";
  if (
    BigInt(s.price) * 100n < BigInt(s.priceUnit) * 98n ||
    BigInt(s.price) * 100n > BigInt(s.priceUnit) * 102n
  )
    return "USDC's reported price is outside the deposit safety range. Review your exposure before adding funds.";
  if (BigInt(s.supplyCap) > 0n && BigInt(s.totalSupply) >= BigInt(s.supplyCap))
    return "Aave has reached this reserve's deposit limit. Try again after capacity becomes available.";
}
export function assertLendingAvailable(
  kind: "supply" | "withdraw",
  amount: string,
  s: LendingSnapshot,
  now: number,
) {
  if (!/^[1-9]\d{0,13}$/.test(amount) || BigInt(amount) > 10_000_000_000_000n)
    throw new Error("Enter a positive amount with up to six decimal places.");
  const issue = lendingAvailability(kind, s, now);
  if (issue) throw new Error(issue);
  const quantity = BigInt(amount);
  if (quantity > BigInt(kind === "supply" ? s.available : s.supplied))
    throw new Error(
      kind === "supply"
        ? "The account does not have enough of this asset to lend that amount."
        : "The amount is greater than this account's current lending position.",
    );
  if (kind === "withdraw" && quantity > BigInt(s.liquidity))
    throw new Error(
      "Aave does not have enough available liquidity for that amount. Review a smaller withdrawal or try again later.",
    );
  if (
    kind === "supply" &&
    BigInt(s.supplyCap) > 0n &&
    quantity + BigInt(s.totalSupply) > BigInt(s.supplyCap)
  )
    throw new Error(
      "That amount exceeds Aave's remaining deposit capacity. Review a smaller amount.",
    );
}
export function lendingMarket(chainId: number) {
  const market = AAVE_MARKETS[String(chainId) as keyof typeof AAVE_MARKETS];
  if (!market) throw new Error("Lending is not supported on this network.");
  return market;
}
export const aaveAbi = parseAbi([
  "function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)",
  "function withdraw(address asset,uint256 amount,address to) returns(uint256)",
  "function setUserUseReserveAsCollateral(address asset,bool useAsCollateral)",
  "function getPool() view returns(address)",
  "function getPriceOracle() view returns(address)",
  "function getAssetPrice(address asset) view returns(uint256)",
  "function BASE_CURRENCY_UNIT() view returns(uint256)",
  "function getSourceOfAsset(address asset) view returns(address)",
  "function getReserveTokensAddresses(address asset) view returns(address,address,address)",
  "function getReserveConfigurationData(address asset) view returns(uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)",
  "function getReserveData(address asset) view returns(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)",
  "function getReserveCaps(address asset) view returns(uint256,uint256)",
  "function getPaused(address asset) view returns(bool)",
  "function getVirtualUnderlyingBalance(address asset) view returns(uint256)",
  "function getReserveNormalizedIncome(address asset) view returns(uint256)",
  "function getUserAccountData(address user) view returns(uint256,uint256,uint256,uint256,uint256,uint256)",
  "function UNDERLYING_ASSET_ADDRESS() view returns(address)",
  "function POOL() view returns(address)",
  "function scaledBalanceOf(address user) view returns(uint256)",
  "event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)",
  "event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)",
]);
export type LendingQuote = {
  version: 1;
  provider: "aave_v3";
  kind: "supply" | "withdraw";
  chainId: number;
  account: Address;
  reference: Hex;
  amount: string;
  withdrawAll?: boolean;
  rateRay: string;
  price: string;
  priceUnit: string;
  createdAt: number;
  expiresAt: number;
};
const unsigned = /^(0|[1-9]\d{0,39})$/;
export function validateLendingQuote(quote: LendingQuote) {
  lendingMarket(quote.chainId);
  if (
    quote.withdrawAll !== undefined &&
    (quote.withdrawAll !== true || quote.kind !== "withdraw")
  )
    throw new Error("Only a withdrawal can close the full lending position.");
  if (
    quote.version !== 1 ||
    quote.provider !== "aave_v3" ||
    !["supply", "withdraw"].includes(quote.kind) ||
    !isAddress(quote.account) ||
    quote.account.toLowerCase() === zeroAddress ||
    !/^0x[\da-f]{64}$/i.test(quote.reference) ||
    quote.reference === zeroHash ||
    ![quote.amount, quote.rateRay, quote.price, quote.priceUnit].every(
      (v) => typeof v === "string" && unsigned.test(v),
    ) ||
    BigInt(quote.amount) <= 0n ||
    BigInt(quote.amount) > 10_000_000_000_000n ||
    BigInt(quote.priceUnit) <= 0n ||
    !Number.isSafeInteger(quote.createdAt) ||
    quote.createdAt <= 0 ||
    quote.expiresAt !== quote.createdAt + LENDING_QUOTE_LIFETIME
  )
    throw new Error(
      "The saved lending instructions are invalid. Review the original request.",
    );
}
export function decodeLendingQuote(raw: string): LendingQuote {
  if (raw.length > 3000)
    throw new Error("The saved lending request is too large.");
  const quote = JSON.parse(raw) as LendingQuote;
  if (!quote || typeof quote !== "object")
    throw new Error("The saved lending request is invalid.");
  validateLendingQuote(quote);
  return quote;
}
export function lendingCall(quote: LendingQuote) {
  validateLendingQuote(quote);
  const market = lendingMarket(quote.chainId);
  if (quote.kind === "withdraw")
    return stableAccountBatch(quote.chainId, [
      {
        to: market.pool,
        data: encodeFunctionData({
          abi: aaveAbi,
          functionName: "withdraw",
          args: [
            market.asset,
            quote.withdrawAll ? 2n ** 256n - 1n : BigInt(quote.amount),
            quote.account,
          ],
        }),
      },
    ]);
  return stableAccountBatch(quote.chainId, [
    {
      to: market.asset,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [market.pool, 0n],
      }),
    },
    {
      to: market.asset,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [market.pool, BigInt(quote.amount)],
      }),
    },
    {
      to: market.pool,
      data: encodeFunctionData({
        abi: aaveAbi,
        functionName: "supply",
        args: [market.asset, BigInt(quote.amount), quote.account, 0],
      }),
    },
    {
      to: market.pool,
      data: encodeFunctionData({
        abi: aaveAbi,
        functionName: "setUserUseReserveAsCollateral",
        args: [market.asset, false],
      }),
    },
    {
      to: market.asset,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [market.pool, 0n],
      }),
    },
  ]);
}
export function lendingQuoteHash(quote: LendingQuote) {
  const call = lendingCall(quote);
  return keccak256(
    encodePacked(
      ["uint256", "address", "bytes32", "uint256", "bytes"],
      [
        BigInt(quote.chainId),
        quote.account,
        quote.reference,
        BigInt(quote.expiresAt),
        call.data,
      ],
    ),
  );
}
/** Principal is proven from the pool's event and actual underlying transfer.
 * aToken mint/burn values can also include previously accrued interest. */
export function assertLendingSettlement(
  quote: LendingQuote,
  logs: Log[],
  boundary: { executionStart: number; executionEnd: number },
) {
  validateLendingQuote(quote);
  if (
    !Number.isSafeInteger(boundary.executionStart) ||
    !Number.isSafeInteger(boundary.executionEnd) ||
    boundary.executionStart >= boundary.executionEnd ||
    logs.some((log) => log.removed)
  )
    throw new Error("The lending receipt is not canonical.");
  const market = lendingMarket(quote.chainId),
    account = quote.account.toLowerCase();
  const scoped = logs.filter(
    (log) =>
      !log.removed &&
      log.logIndex !== null &&
      log.logIndex > boundary.executionStart &&
      log.logIndex < boundary.executionEnd,
  );
  const events = parseEventLogs({
    abi: aaveAbi,
    logs: scoped,
    strict: true,
  }).filter(
    (event) => event.address.toLowerCase() === market.pool.toLowerCase(),
  );
  const matching = events.filter((event) =>
    quote.kind === "supply"
      ? event.eventName === "Supply" &&
        event.args.reserve.toLowerCase() === market.asset.toLowerCase() &&
        event.args.user.toLowerCase() === account &&
        event.args.onBehalfOf.toLowerCase() === account &&
        event.args.amount === BigInt(quote.amount) &&
        event.args.referralCode === 0
      : event.eventName === "Withdraw" &&
        event.args.reserve.toLowerCase() === market.asset.toLowerCase() &&
        event.args.user.toLowerCase() === account &&
        event.args.to.toLowerCase() === account &&
        (quote.withdrawAll
          ? event.args.amount > 0n
          : event.args.amount === BigInt(quote.amount)),
  );
  const movements = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: scoped,
    strict: true,
  }).filter((event) =>
    quote.kind === "supply"
      ? event.args.from.toLowerCase() === account
      : event.address.toLowerCase() === market.asset.toLowerCase() &&
        event.args.to.toLowerCase() === account,
  );
  if (
    quote.kind === "withdraw" &&
    parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: scoped,
      strict: true,
    }).some(
      (event) =>
        event.args.from.toLowerCase() === account &&
        (event.address.toLowerCase() !== market.aToken.toLowerCase() ||
          event.args.to.toLowerCase() !== zeroAddress),
    )
  )
    throw new Error(
      "The withdrawal receipt contains an unexpected account debit.",
    );
  if (
    events.length !== 1 ||
    matching.length !== 1 ||
    movements.length !== 1 ||
    movements[0].address.toLowerCase() !== market.asset.toLowerCase() ||
    movements[0].args.value !== matching[0].args.amount ||
    (quote.kind === "supply"
      ? movements[0].args.to
      : movements[0].args.from
    ).toLowerCase() !== market.aToken.toLowerCase()
  )
    throw new Error(
      "The lending receipt does not prove the approved amount and company account.",
    );
  return {
    amount: String(movements[0].args.value),
    logIndex: movements[0].logIndex,
    token: market.asset,
    direction:
      quote.kind === "supply" ? ("outflow" as const) : ("inflow" as const),
  };
}
