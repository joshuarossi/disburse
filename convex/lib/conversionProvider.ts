import {
  BaseError,
  ContractFunctionRevertedError,
  erc20Abi,
  zeroAddress,
  type Address,
} from "viem";
import {
  CONVERSION_POOL_FEES,
  CONVERSION_QUOTE_LIFETIME,
  conversionAbi,
  conversionAssets,
  conversionMarket,
  conversionPool,
  maximumConversionInput,
  validateConversionQuote,
  type ConversionQuote,
  type ConversionSnapshot,
} from "../../shared/conversion";
import { circleConfiguration } from "../../shared/circleExecution";
import { getChainClient } from "./safeVerification";
import { verifyPinnedContract } from "./pinnedContract";

const changed =
  "Uniswap's contracts or currency configuration changed. This route needs a provider review before another conversion.";
export async function readConversionSnapshot(
  chainId: number,
  account: Address,
): Promise<ConversionSnapshot> {
  const market = conversionMarket(chainId),
    client = getChainClient(chainId);
  const height = await client.getBlockNumber(),
    blockNumber = height > 2n ? height - 2n : height;
  const block = await client.getBlock({ blockNumber });
  if (
    (await client.getChainId()) !== chainId ||
    Math.abs(Date.now() - Number(block.timestamp) * 1000) > 180_000
  )
    throw new Error(
      "The network is not returning current conversion balances. Try refreshing shortly.",
    );
  await Promise.all(
    market.contracts.map((pin) =>
      verifyPinnedContract(client, blockNumber, pin, changed),
    ),
  );
  const balances = await Promise.all(
    market.assets.map(async (asset) => {
      const [decimals, balance] = await Promise.all([
        client.readContract({
          address: asset.address,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber,
        }),
        client.readContract({
          address: asset.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
          blockNumber,
        }),
      ]);
      if (decimals !== asset.decimals) throw new Error(changed);
      return {
        address: asset.address,
        symbol: asset.symbol,
        amount: String(balance),
      };
    }),
  );
  if (
    (
      await client.readContract({
        address: market.quoter,
        abi: conversionAbi,
        functionName: "factory",
        blockNumber,
      })
    ).toLowerCase() !== market.factory.toLowerCase()
  )
    throw new Error(changed);
  const feeBalance = balances.find(
    (b) =>
      b.address.toLowerCase() ===
      circleConfiguration(chainId).token.toLowerCase(),
  );
  if (!feeBalance) throw new Error(changed);
  return {
    chainId,
    account,
    checkedAt: Number(block.timestamp) * 1000,
    blockNumber: String(blockNumber),
    balances,
    feeBalance: feeBalance.amount,
  };
}

async function poolQuote(
  chainId: number,
  tokenIn: Address,
  amount: string,
  fee: number,
  blockNumber: bigint,
) {
  const market = conversionMarket(chainId),
    client = getChainClient(chainId),
    { input, output } = conversionAssets(chainId, tokenIn);
  const pool = await client.readContract({
    address: market.factory,
    abi: conversionAbi,
    functionName: "getPool",
    args: [input.address, output.address, fee],
    blockNumber,
  });
  if (pool === zeroAddress) return null;
  if (pool.toLowerCase() !== conversionPool(chainId, fee).toLowerCase())
    throw new Error(changed);
  const [factory, token0, token1, poolFee, liquidity, slot] = await Promise.all(
    [
      client.readContract({
        address: pool,
        abi: conversionAbi,
        functionName: "factory",
        blockNumber,
      }),
      client.readContract({
        address: pool,
        abi: conversionAbi,
        functionName: "token0",
        blockNumber,
      }),
      client.readContract({
        address: pool,
        abi: conversionAbi,
        functionName: "token1",
        blockNumber,
      }),
      client.readContract({
        address: pool,
        abi: conversionAbi,
        functionName: "fee",
        blockNumber,
      }),
      client.readContract({
        address: pool,
        abi: conversionAbi,
        functionName: "liquidity",
        blockNumber,
      }),
      client.readContract({
        address: pool,
        abi: conversionAbi,
        functionName: "slot0",
        blockNumber,
      }),
    ],
  );
  const tokens = [
    input.address.toLowerCase(),
    output.address.toLowerCase(),
  ].sort();
  if (
    factory.toLowerCase() !== market.factory.toLowerCase() ||
    token0.toLowerCase() !== tokens[0] ||
    token1.toLowerCase() !== tokens[1] ||
    poolFee !== fee
  )
    throw new Error(changed);
  if (liquidity === 0n || slot[0] === 0n || !slot[6]) return null;
  try {
    const { result } = await client.simulateContract({
      address: market.quoter,
      abi: conversionAbi,
      functionName: "quoteExactOutputSingle",
      args: [
        {
          tokenIn: input.address,
          tokenOut: output.address,
          amount: BigInt(amount),
          fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
      blockNumber,
    });
    const before = slot[0] ** 2n,
      after = result[1] ** 2n,
      change = before > after ? before - after : after - before;
    const priceImpactBps = Number((change * 10000n + before - 1n) / before);
    return {
      pool,
      poolFee: fee,
      expectedInput: String(result[0]),
      priceImpactBps,
    };
  } catch (error) {
    if (
      error instanceof BaseError &&
      error.walk((e) => e instanceof ContractFunctionRevertedError) instanceof
        ContractFunctionRevertedError
    )
      return null;
    // A broken RPC is not evidence that every pool lacks liquidity.
    throw error;
  }
}
export async function quoteConversion(
  snapshot: ConversionSnapshot,
  tokenIn: Address,
  amount: string,
  slippageBps: number,
  reference: ConversionQuote["reference"],
): Promise<ConversionQuote> {
  if (!/^[1-9]\d{0,13}$/.test(amount) || BigInt(amount) > 10_000_000_000_000n)
    throw new Error(
      "Enter a positive receiving amount with up to six decimal places.",
    );
  if (Math.abs(Date.now() - snapshot.checkedAt) > 180_000)
    throw new Error(
      "Refresh the account before requesting a conversion quote.",
    );
  const { input, output } = conversionAssets(snapshot.chainId, tokenIn);
  const candidates = await Promise.all(
    CONVERSION_POOL_FEES.map((fee) =>
      poolQuote(
        snapshot.chainId,
        tokenIn,
        amount,
        fee,
        BigInt(snapshot.blockNumber),
      ),
    ),
  );
  const routes = candidates
    .filter(
      (q): q is NonNullable<typeof q> =>
        !!q &&
        BigInt(q.expectedInput) > 0n &&
        q.priceImpactBps <= 100 &&
        BigInt(q.expectedInput) * 100n >= BigInt(amount) * 98n &&
        BigInt(q.expectedInput) * 100n <= BigInt(amount) * 102n,
    )
    .sort((a, b) =>
      BigInt(a.expectedInput) < BigInt(b.expectedInput) ? -1 : 1,
    );
  const route = routes[0];
  if (!route)
    throw new Error(
      "No supported quote has enough liquidity at an acceptable exchange rate. Try a smaller amount or refresh later. Your funds have not moved.",
    );
  const now = Date.now();
  const quote: ConversionQuote = {
    version: 1,
    provider: "uniswap_v3",
    kind: "conversion",
    chainId: snapshot.chainId,
    account: snapshot.account,
    reference,
    tokenIn: input.address,
    tokenOut: output.address,
    amount,
    ...route,
    maximumInput: maximumConversionInput(route.expectedInput, slippageBps),
    slippageBps,
    blockNumber: snapshot.blockNumber,
    createdAt: now,
    expiresAt: now + CONVERSION_QUOTE_LIFETIME,
  };
  validateConversionQuote(quote);
  assertConversionBalance(quote, snapshot);
  return quote;
}
function assertConversionBalance(q: ConversionQuote, s: ConversionSnapshot) {
  const input = s.balances.find(
    (b) => b.address.toLowerCase() === q.tokenIn.toLowerCase(),
  );
  if (!input || BigInt(input.amount) < BigInt(q.maximumInput))
    throw new Error(
      "This account does not have enough of the paying currency for the maximum conversion amount.",
    );
  if (
    BigInt(s.feeBalance) === 0n ||
    (q.tokenIn.toLowerCase() ===
      circleConfiguration(q.chainId).token.toLowerCase() &&
      BigInt(s.feeBalance) <= BigInt(q.maximumInput))
  )
    throw new Error(
      "Keep some USDC in the company account for execution fees. Reduce the conversion amount or add funds.",
    );
}
export async function verifyConversionFunding(q: ConversionQuote) {
  validateConversionQuote(q);
  if (q.expiresAt <= Date.now())
    throw new Error(
      "This conversion review expired. Stop the old request before reviewing a fresh quote.",
    );
  const snapshot = await readConversionSnapshot(q.chainId, q.account);
  assertConversionBalance(q, snapshot);
  const live = await poolQuote(
    q.chainId,
    q.tokenIn,
    q.amount,
    q.poolFee,
    BigInt(snapshot.blockNumber),
  );
  if (
    !live ||
    BigInt(live.expectedInput) > BigInt(q.maximumInput) ||
    live.priceImpactBps > 100
  )
    throw new Error(
      "The conversion price or liquidity changed beyond your approved limit. Stop this request and review a fresh quote.",
    );
}
