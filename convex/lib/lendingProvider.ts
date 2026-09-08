import { erc20Abi, parseAbi, type Address } from "viem";
import {
  aaveAbi,
  assertLendingAvailable,
  lendingMarket,
  type LendingSnapshot,
  type LendingQuote,
} from "../../shared/lending";
import { circleConfiguration } from "../../shared/circleExecution";
import { getChainClient } from "./safeVerification";
import { verifyPinnedContract } from "./pinnedContract";

const oracleAbi = parseAbi([
  "function ASSET_TO_USD_AGGREGATOR() view returns(address)",
  "function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns(uint8)",
]);
const priceFeeds: Record<number, Address> = {
  8453: "0x1550207eAeB590D1557a6E6C066D3d57B5A4Dc65",
  42161: "0xDbFF913E9058C1E60446150D23Bb0fFE9144d531",
  84532: "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165",
};
const changed =
  "Aave changed its contracts or asset configuration. This integration needs a provider review before another operation.";

/** Every value belongs to one confirmed block. Oracle failure prevents new
 * deposits but does not turn a sound withdrawal into an unavailable service. */
export async function readLendingPosition(
  chainId: number,
  account: Address,
): Promise<LendingSnapshot> {
  const market = lendingMarket(chainId),
    client = getChainClient(chainId);
  const height = await client.getBlockNumber();
  const blockNumber = height > 2n ? height - 2n : height;
  const block = await client.getBlock({ blockNumber });
  if (
    (await client.getChainId()) !== chainId ||
    Math.abs(Date.now() - Number(block.timestamp) * 1000) > 180_000
  )
    throw new Error(
      "The network is not returning a current account balance. Try refreshing shortly.",
    );
  await Promise.all(
    market.contracts.map((pin) =>
      verifyPinnedContract(client, blockNumber, pin, changed),
    ),
  );
  const [
    pool,
    oracle,
    tokens,
    underlying,
    tokenPool,
    decimals,
    config,
    reserve,
    caps,
    paused,
    available,
    supplied,
    liquidity,
    virtualLiquidity,
    income,
    debt,
    feeBalance,
  ] = await Promise.all([
    client.readContract({
      address: market.provider,
      abi: aaveAbi,
      functionName: "getPool",
      blockNumber,
    }),
    client.readContract({
      address: market.provider,
      abi: aaveAbi,
      functionName: "getPriceOracle",
      blockNumber,
    }),
    client.readContract({
      address: market.dataProvider,
      abi: aaveAbi,
      functionName: "getReserveTokensAddresses",
      args: [market.asset],
      blockNumber,
    }),
    client.readContract({
      address: market.aToken,
      abi: aaveAbi,
      functionName: "UNDERLYING_ASSET_ADDRESS",
      blockNumber,
    }),
    client.readContract({
      address: market.aToken,
      abi: aaveAbi,
      functionName: "POOL",
      blockNumber,
    }),
    client.readContract({
      address: market.asset,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber,
    }),
    client.readContract({
      address: market.dataProvider,
      abi: aaveAbi,
      functionName: "getReserveConfigurationData",
      args: [market.asset],
      blockNumber,
    }),
    client.readContract({
      address: market.dataProvider,
      abi: aaveAbi,
      functionName: "getReserveData",
      args: [market.asset],
      blockNumber,
    }),
    client.readContract({
      address: market.dataProvider,
      abi: aaveAbi,
      functionName: "getReserveCaps",
      args: [market.asset],
      blockNumber,
    }),
    client.readContract({
      address: market.dataProvider,
      abi: aaveAbi,
      functionName: "getPaused",
      args: [market.asset],
      blockNumber,
    }),
    client.readContract({
      address: market.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: market.aToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: market.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [market.aToken],
      blockNumber,
    }),
    client.readContract({
      address: market.dataProvider,
      abi: aaveAbi,
      functionName: "getVirtualUnderlyingBalance",
      args: [market.asset],
      blockNumber,
    }),
    client.readContract({
      address: market.pool,
      abi: aaveAbi,
      functionName: "getReserveNormalizedIncome",
      args: [market.asset],
      blockNumber,
    }),
    client.readContract({
      address: market.pool,
      abi: aaveAbi,
      functionName: "getUserAccountData",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: circleConfiguration(chainId).token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
      blockNumber,
    }),
  ]);
  if (
    pool.toLowerCase() !== market.pool.toLowerCase() ||
    oracle.toLowerCase() !== market.oracle.toLowerCase() ||
    tokens[0].toLowerCase() !== market.aToken.toLowerCase() ||
    underlying.toLowerCase() !== market.asset.toLowerCase() ||
    tokenPool.toLowerCase() !== market.pool.toLowerCase() ||
    decimals !== 6 ||
    config[0] !== 6n
  )
    throw new Error(changed);
  let price = "0",
    priceUnit = "100000000",
    priceUpdatedAt = 0,
    priceAvailable = false;
  try {
    const [source, poolPrice, unit] = await Promise.all([
      client.readContract({
        address: oracle,
        abi: aaveAbi,
        functionName: "getSourceOfAsset",
        args: [market.asset],
        blockNumber,
      }),
      client.readContract({
        address: oracle,
        abi: aaveAbi,
        functionName: "getAssetPrice",
        args: [market.asset],
        blockNumber,
      }),
      client.readContract({
        address: oracle,
        abi: aaveAbi,
        functionName: "BASE_CURRENCY_UNIT",
        blockNumber,
      }),
    ]);
    if (
      source.toLowerCase() !== market.priceSource.toLowerCase() ||
      unit !== 100_000_000n
    )
      throw new Error(changed);
    const feed =
      chainId === 84532
        ? source
        : await client.readContract({
            address: source,
            abi: oracleAbi,
            functionName: "ASSET_TO_USD_AGGREGATOR",
            blockNumber,
          });
    if (feed.toLowerCase() !== priceFeeds[chainId].toLowerCase())
      throw new Error(changed);
    const [round, decimals] = await Promise.all([
      client.readContract({
        address: feed,
        abi: oracleAbi,
        functionName: "latestRoundData",
        blockNumber,
      }),
      client.readContract({
        address: feed,
        abi: oracleAbi,
        functionName: "decimals",
        blockNumber,
      }),
    ]);
    if (
      decimals !== 8 ||
      round[1] <= 0n ||
      round[4] < round[0] ||
      poolPrice <= 0n
    )
      throw new Error("A current price is unavailable.");
    // Inspect the uncapped feed too. A price adapter's cap must not hide a depeg.
    price = String(round[1]);
    priceUnit = String(unit);
    priceUpdatedAt = Number(round[3]) * 1000;
    priceAvailable = true;
  } catch {
    // The UI retains balances and offers withdrawal if the reserve permits it.
  }
  return {
    chainId,
    account,
    asset: market.asset,
    assetLabel: market.assetLabel,
    blockNumber: String(blockNumber),
    checkedAt: Number(block.timestamp) * 1000,
    available: String(available),
    supplied: String(supplied),
    feeBalance: String(feeBalance),
    liquidity: String(
      liquidity < virtualLiquidity ? liquidity : virtualLiquidity,
    ),
    totalSupply: String(
      reserve[2] + (reserve[1] * income + 10n ** 27n - 1n) / 10n ** 27n,
    ),
    supplyCap: String(caps[1] * 1_000_000n),
    rateRay: String(reserve[5]),
    debt: String(debt[1]),
    active: config[8],
    frozen: config[9],
    paused,
    price,
    priceUnit,
    priceUpdatedAt,
    priceAvailable,
  };
}
export async function verifyLendingFunding(quote: LendingQuote) {
  const snapshot = await readLendingPosition(quote.chainId, quote.account);
  assertLendingAvailable(
    quote.kind,
    quote.withdrawAll ? snapshot.supplied : quote.amount,
    snapshot,
    Date.now(),
  );
  if (quote.expiresAt <= Date.now())
    throw new Error(
      "This lending review expired. Close it and review a fresh amount.",
    );
  return snapshot;
}
