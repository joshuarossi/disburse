import {
  conversionMarket,
  conversionAssets,
  conversionPool,
  CONVERSION_QUOTE_LIFETIME,
  maximumConversionInput,
  type ConversionQuote,
} from "../../../shared/conversion";
import { treasuryServiceHash } from "../../../shared/treasuryService";
import { keccak256, toHex, type Address } from "viem";
import {
  assertLendingAvailable,
  lendingMarket,
  LENDING_QUOTE_LIFETIME,
  type LendingQuote,
  type LendingSnapshot,
} from "../../../shared/lending";
import { readCircleFixture, saveCircleFixture } from "./circle";
import { safes } from "./fixtures";

export const readServiceFixture = () =>
  JSON.parse(sessionStorage.getItem("qa:treasury-service") ?? "null");
const save = (value: unknown) =>
  sessionStorage.setItem("qa:treasury-service", JSON.stringify(value));
export async function serviceFixtureAction(
  name: string,
  args: {
    safeId?: string;
    kind?: "supply" | "withdraw" | "conversion";
    tokenIn?: string;
    slippageBps?: number;
    amount?: string;
    requestId?: string;
    withdrawAll?: boolean;
  },
) {
  const scenario = sessionStorage.getItem("qa:scenario") ?? "",
    saved = readServiceFixture();
  const account = safes.find((a) => a._id === args.safeId) ?? safes[0],
    market = lendingMarket(account.chainId);
  const s: LendingSnapshot = {
    chainId: account.chainId,
    account: account.safeAddress as Address,
    asset: market.asset,
    assetLabel: market.assetLabel,
    blockNumber: "123",
    checkedAt: Date.now(),
    available: "25000000000",
    supplied: "5000000000",
    feeBalance: scenario.endsWith("no-fees") ? "0" : "25000000000",
    liquidity: scenario.endsWith("liquidity") ? "1000000" : "1000000000000",
    totalSupply: "1000000000000",
    supplyCap: "2000000000000",
    rateRay: "35000000000000000000000000",
    debt: "0",
    active: true,
    frozen: false,
    paused: scenario.endsWith("paused"),
    price: scenario.endsWith("depeg") ? "94000000" : "100000000",
    priceUnit: "100000000",
    priceUpdatedAt: Date.now() - 1000,
    priceAvailable: !scenario.endsWith("stale-price"),
  };
  if (name === "conversionActions:balances") {
    if (scenario.endsWith("balance-outage"))
      throw new Error("Provider RPC https://private.example.invalid failed");
    const route = conversionMarket(account.chainId);
    return {
      chainId: account.chainId,
      account: account.safeAddress,
      checkedAt: Date.now(),
      blockNumber: "123",
      feeBalance: "25000000000",
      balances: route.assets.map((a) => ({ ...a, amount: "25000000000" })),
    };
  }
  if (name === "treasuryServiceActions:position") {
    if (scenario.endsWith("position-outage"))
      throw new Error("Provider RPC https://private.example.invalid failed");
    return s;
  }
  if (
    name === "treasuryServiceActions:prepare" ||
    name === "conversionActions:prepare"
  ) {
    if (scenario.endsWith("no-liquidity"))
      throw new Error(
        "No supported quote has enough liquidity at an acceptable exchange rate. Try a smaller amount or refresh later. Your funds have not moved.",
      );
    if (scenario.endsWith("quote-outage"))
      throw new Error("Aave could not be reached. Try again shortly.");
    if (saved?.open) {
      if (saved.requestId === args.requestId) return saved._id;
      throw new Error(
        "This account already has a treasury request. Complete or stop it before reviewing another.",
      );
    }
    if (args.kind !== "conversion")
      assertLendingAvailable(args.kind!, args.amount!, s, Date.now());
    const now = Date.now(),
      quote: LendingQuote | ConversionQuote =
        args.kind === "conversion"
          ? {
              version: 1,
              provider: "uniswap_v3",
              kind: "conversion",
              chainId: account.chainId,
              account: account.safeAddress as Address,
              reference: keccak256(toHex(args.requestId!)),
              tokenIn: args.tokenIn! as Address,
              tokenOut: conversionAssets(account.chainId, args.tokenIn!).output
                .address,
              amount: args.amount!,
              expectedInput: args.amount!,
              maximumInput: maximumConversionInput(
                args.amount!,
                args.slippageBps!,
              ),
              pool: conversionPool(account.chainId, 100),
              poolFee: 100,
              slippageBps: args.slippageBps!,
              priceImpactBps: 1,
              blockNumber: "123",
              createdAt: now,
              expiresAt: now + CONVERSION_QUOTE_LIFETIME,
            }
          : {
              version: 1,
              provider: "aave_v3",
              kind: args.kind!,
              chainId: account.chainId,
              account: account.safeAddress as Address,
              reference: keccak256(toHex(args.requestId!)),
              amount: args.amount!,
              rateRay: s.rateRay,
              price: s.price,
              priceUnit: s.priceUnit,
              createdAt: now,
              expiresAt: now + LENDING_QUOTE_LIFETIME,
            };
    if (args.withdrawAll && quote.provider === "aave_v3")
      quote.withdrawAll = true;
    save({
      _id: "service1",
      orgId: "demo",
      safeId: account._id,
      chainId: account.chainId,
      kind: quote.kind,
      provider: quote.provider,
      requestId: args.requestId,
      quote: JSON.stringify(quote),
      hash: treasuryServiceHash(quote),
      status: "quoted",
      open: true,
      createdAt: now,
      updatedAt: now,
    });
    sessionStorage.removeItem("qa:circle");
    if (scenario.endsWith("quote-lost"))
      throw new Error(
        "The review response was interrupted. Open the saved request from your treasury activity.",
      );
    return "service1";
  }
  if (name === "treasuryServices:stop") {
    const current = readCircleFixture();
    if (saved.status === "processing" || saved.sourceTxHash)
      throw new Error("Check the original request before cancelling.");
    if (current?.operationApprovalStartedAt || current?.stage === "ready") {
      sessionStorage.setItem(
        "qa:treasury-service-originalCircle",
        JSON.stringify(current),
      );
      save({
        ...saved,
        cancellationRequestedAt: Date.now(),
        circleExecutionId: current._id,
      });
      sessionStorage.removeItem("qa:circle");
      return { cancelled: false, executionId: current._id };
    }
    if (current)
      saveCircleFixture({ ...current, open: false, stage: "cancelled" });
    save({ ...saved, open: false, status: "cancelled" });
    return { cancelled: true };
  }
}
export function serviceCircleStep(name: string) {
  const saved = readServiceFixture();
  if (!saved) return;
  if (name === "circlePayments:prepare" && !saved.cancellationRequestedAt)
    save({ ...saved, status: "approving", circleExecutionId: "circle1" });
  if (name === "circlePayments:submit" && !saved.cancellationRequestedAt)
    save({ ...saved, status: "processing" });
  if (name === "circlePayments:recheck") {
    const current = readCircleFixture();
    if (["confirmed", "failed", "expired"].includes(current?.stage)) {
      const quote = JSON.parse(saved.quote);
      save({
        ...saved,
        open: false,
        status:
          saved.cancellationRequestedAt && current.stage !== "expired"
            ? "cancelled"
            : current.stage === "confirmed"
              ? "completed"
              : current.stage,
        settledAmount:
          !saved.cancellationRequestedAt && current.stage === "confirmed"
            ? String(
                BigInt(
                  quote.provider === "uniswap_v3"
                    ? quote.expectedInput
                    : quote.amount,
                ) + (quote.withdrawAll ? 1n : 0n),
              )
            : undefined,
        sourceTxHash:
          !saved.cancellationRequestedAt && current.stage === "confirmed"
            ? `0x${"ab".repeat(32)}`
            : undefined,
      });
      if (saved.cancellationRequestedAt && current.stage !== "expired") {
        const original = JSON.parse(
          sessionStorage.getItem("qa:treasury-service-originalCircle")!,
        );
        sessionStorage.setItem(
          "qa:treasury-service-originalCircle",
          JSON.stringify({ ...original, stage: "cancelled", open: false }),
        );
      }
    }
  }
}
