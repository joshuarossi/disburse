import { describe, expect, it } from "vitest";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Address,
  type Hex,
  type Log,
} from "viem";
import {
  CONVERSION_QUOTE_LIFETIME,
  assertConversionSettlement,
  conversionAbi,
  conversionCall,
  conversionMarket,
  conversionPool,
  conversionQuoteHash,
  decodeConversionQuote,
  maximumConversionInput,
  type ConversionQuote,
} from "../../../shared/conversion";
import { treasuryServicePrincipalUSDC } from "../../../shared/treasuryService";
import {
  buildSettlementJournal,
  type BookAccount,
} from "../../../shared/accounting";
import buyMock from "./fixtures/uniswap-base-sepolia-buy-mock-1.json";
import buyUSDC from "./fixtures/uniswap-base-sepolia-buy-usdc-1.json";

describe("published conversion receipt with a customer fee refund", () => {
  for (const actualBuy of [buyMock, buyUSDC])
    it(`separates principal and fee refund when paying ${actualBuy.quote.tokenIn}`, () => {
      const quote = decodeConversionQuote(JSON.stringify(actualBuy.quote));
      const logs = actualBuy.receipt.logs as unknown as Log[];
      expect(
        assertConversionSettlement(quote, logs, actualBuy.boundary),
      ).toEqual(actualBuy.principal);
      // The same real receipt must not settle without its verified fee evidence.
      expect(() =>
        assertConversionSettlement(quote, logs, {
          executionStart: actualBuy.boundary.executionStart,
          executionEnd: actualBuy.boundary.executionEnd,
        }),
      ).toThrow();
      for (const refund of [
        { ...actualBuy.boundary.feeProof.refund, amountRaw: "1" },
        {
          ...actualBuy.boundary.feeProof.refund,
          logIndex: actualBuy.principal.logIndex,
        },
      ])
        expect(() =>
          assertConversionSettlement(quote, logs, {
            ...actualBuy.boundary,
            feeProof: { ...actualBuy.boundary.feeProof, refund },
          }),
        ).toThrow();
      const originalRefund = logs.find(
        (l) => l.logIndex === actualBuy.boundary.feeProof.refund.logIndex,
      )!;
      expect(() =>
        assertConversionSettlement(
          quote,
          [
            ...logs,
            { ...originalRefund, logIndex: originalRefund.logIndex! + 1 },
          ],
          actualBuy.boundary,
        ),
      ).toThrow();
      expect(() =>
        assertConversionSettlement(
          { ...quote, account: "0x1111111111111111111111111111111111111111" },
          logs,
          actualBuy.boundary,
        ),
      ).toThrow();
    });
});
const market = conversionMarket(8453),
  account = "0x1111111111111111111111111111111111111111" as Address;
const q: ConversionQuote = {
  version: 1,
  provider: "uniswap_v3",
  kind: "conversion",
  chainId: 8453,
  account,
  reference: `0x${"12".repeat(32)}`,
  tokenIn: market.assets[0].address,
  tokenOut: market.assets[1].address,
  amount: "100000000",
  expectedInput: "100010000",
  maximumInput: maximumConversionInput("100010000", 50),
  pool: conversionPool(8453, 100),
  poolFee: 100,
  slippageBps: 50,
  priceImpactBps: 1,
  blockNumber: "123",
  createdAt: 1788860000000,
  expiresAt: 1788860000000 + CONVERSION_QUOTE_LIFETIME,
};
const log = (
  address: Address,
  index: number,
  topics: ReturnType<typeof encodeEventTopics>,
  data: Hex,
): Log => ({
  address,
  logIndex: index,
  topics: topics as Log["topics"],
  data,
  blockNumber: 123n,
  blockHash: `0x${"cd".repeat(32)}`,
  transactionHash: `0x${"ab".repeat(32)}`,
  transactionIndex: 0,
  removed: false,
});
const transfer = (
  token: Address,
  from: Address,
  to: Address,
  amount: bigint,
  index: number,
) =>
  log(
    token,
    index,
    encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from, to },
    }),
    encodeAbiParameters([{ type: "uint256" }], [amount]),
  );
function receipt(quote = q, input = 100015000n) {
  const inputIs0 = quote.tokenIn.toLowerCase() < quote.tokenOut.toLowerCase();
  return [
    transfer(
      quote.tokenOut,
      quote.pool,
      quote.account,
      BigInt(quote.amount),
      2,
    ),
    transfer(quote.tokenIn, quote.account, quote.pool, input, 3),
    log(
      quote.pool,
      4,
      encodeEventTopics({
        abi: conversionAbi,
        eventName: "Swap",
        args: { sender: market.router, recipient: quote.account },
      }),
      encodeAbiParameters(
        [
          { type: "int256" },
          { type: "int256" },
          { type: "uint160" },
          { type: "uint128" },
          { type: "int24" },
        ],
        [
          inputIs0 ? input : -BigInt(quote.amount),
          inputIs0 ? -BigInt(quote.amount) : input,
          2n ** 96n,
          100000000000n,
          0,
        ],
      ),
    ),
  ];
}
function batch(data: Hex) {
  const inner = decodeFunctionData({
    abi: [
      {
        type: "function",
        name: "multiSend",
        stateMutability: "payable",
        inputs: [{ type: "bytes", name: "transactions" }],
        outputs: [],
      },
    ],
    data,
  }).args[0].slice(2);
  const calls = [];
  let i = 0;
  while (i < inner.length) {
    const operation = Number.parseInt(inner.slice(i, i + 2), 16);
    const to = `0x${inner.slice(i + 2, i + 42)}` as Address;
    const value = BigInt(`0x${inner.slice(i + 42, i + 106)}`);
    const length = Number(BigInt(`0x${inner.slice(i + 106, i + 170)}`));
    calls.push({
      operation,
      to,
      value,
      data: `0x${inner.slice(i + 170, i + 170 + length * 2)}` as Hex,
    });
    i += 170 + length * 2;
  }
  return calls;
}
describe("bounded exact-receipt conversion", () => {
  it("builds the current router encoding and clears both levels of spending approval", () => {
    const calls = batch(conversionCall(q).data);
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.operation === 0 && c.value === 0n)).toBe(true);
    expect(
      decodeFunctionData({ abi: erc20Abi, data: calls[0].data }).args,
    ).toEqual([market.permit2, 0n]);
    expect(
      decodeFunctionData({ abi: erc20Abi, data: calls[1].data }).args,
    ).toEqual([market.permit2, BigInt(q.maximumInput)]);
    expect(calls[2].to).toBe(market.permit2.toLowerCase());
    expect(calls[3].to).toBe(market.router.toLowerCase());
    const swap = decodeFunctionData({
      abi: conversionAbi,
      data: calls[3].data,
    });
    expect(swap.functionName).toBe("execute");
    if (swap.functionName !== "execute")
      throw new Error("Expected router execute");
    expect(swap.args[0]).toBe("0x01");
    expect(swap.args[2]).toBe(BigInt(Math.floor(q.expiresAt / 1000)));
    const decoded = decodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes" },
        { type: "bool" },
        { type: "uint256[]" },
      ],
      swap.args[1][0],
    );
    expect(decoded).toEqual([
      account,
      BigInt(q.amount),
      BigInt(q.maximumInput),
      `0x${q.tokenOut.slice(2)}000064${q.tokenIn.slice(2)}`.toLowerCase(),
      true,
      [],
    ]);
    expect(
      decodeFunctionData({ abi: conversionAbi, data: calls[4].data }).args,
    ).toEqual([q.tokenIn, market.router, 0n, 0]);
    expect(
      decodeFunctionData({ abi: erc20Abi, data: calls[5].data }).args,
    ).toEqual([market.permit2, 0n]);
    expect(treasuryServicePrincipalUSDC(q)).toBe(q.maximumInput);
    expect(
      treasuryServicePrincipalUSDC({
        ...q,
        tokenIn: q.tokenOut,
        tokenOut: q.tokenIn,
      }),
    ).toBe("0");
  });
  it("rounds the debit cap upward and rejects broad tolerances, malformed routes and exchange-rate outliers", () => {
    expect(maximumConversionInput("1", 10)).toBe("2");
    for (const changed of [
      { slippageBps: 500 },
      { maximumInput: "100010000" },
      { tokenOut: q.tokenIn },
      { pool: account },
      { poolFee: 2500 },
      { expiresAt: q.expiresAt + 1 },
      { priceImpactBps: 101 },
      { amount: "0" },
      {
        expectedInput: "95000000",
        maximumInput: maximumConversionInput("95000000", 50),
      },
    ])
      expect(() =>
        decodeConversionQuote(JSON.stringify({ ...q, ...changed })),
      ).toThrow();
  });
  it("binds currency direction, exact receipt, cap and request identity into authorization", () => {
    expect(
      conversionQuoteHash({ ...q, tokenIn: q.tokenOut, tokenOut: q.tokenIn }),
    ).not.toBe(conversionQuoteHash(q));
    expect(
      conversionQuoteHash({ ...q, reference: `0x${"13".repeat(32)}` }),
    ).not.toBe(conversionQuoteHash(q));
    expect(conversionQuoteHash({ ...q, amount: "99999999" })).not.toBe(
      conversionQuoteHash(q),
    );
  });
  it("records actual input while requiring the exact output and matching pool event", () => {
    expect(
      assertConversionSettlement(q, receipt(), {
        executionStart: 1,
        executionEnd: 5,
      }),
    ).toEqual({ logIndex: 3, outputLogIndex: 2, amount: "100015000" });
    const reversed = { ...q, tokenIn: q.tokenOut, tokenOut: q.tokenIn };
    expect(
      assertConversionSettlement(reversed, receipt(reversed), {
        executionStart: 1,
        executionEnd: 5,
      }).amount,
    ).toBe("100015000");
  });
  it("rejects a partial output, over-cap debit, extra movement, unrelated operation or removed log", () => {
    const original = receipt();
    for (const logs of [
      [
        transfer(q.tokenOut, q.pool, account, 99999999n, 2),
        ...original.slice(1),
      ],
      receipt(q, BigInt(q.maximumInput) + 1n),
      [...original, transfer(q.tokenIn, account, market.router, 1n, 4)],
      original.map((l) => ({ ...l, removed: true })),
      original.slice(0, 2),
    ])
      expect(() =>
        assertConversionSettlement(q, logs, {
          executionStart: 1,
          executionEnd: 5,
        }),
      ).toThrow();
    expect(() =>
      assertConversionSettlement(q, original, {
        executionStart: 4,
        executionEnd: 6,
      }),
    ).toThrow();
  });
});
it("reconciles both conversion legs through clearing without treating the receipt as revenue", () => {
  const asset: BookAccount = {
      id: "cash",
      externalId: "1000",
      version: 1,
      name: "Cash",
      kind: "asset",
    },
    clearing: BookAccount = {
      id: "clearing",
      externalId: "1050",
      version: 1,
      name: "Conversion clearing",
      kind: "asset",
    },
    loss: BookAccount = {
      id: "loss",
      externalId: "6000",
      version: 1,
      name: "Conversion difference",
      kind: "expense",
    };
  const common = {
    treatment: "currency_conversion" as const,
    currency: "USD" as const,
    companyTransfer: false,
    assetAccount: asset,
    counterAccount: clearing,
  };
  const outgoing = buildSettlementJournal({
    ...common,
    direction: "outflow",
    conversionMovement: "outflow",
    assetBookValue: "100.05",
  });
  expect(outgoing.map((l) => [l.account.id, l.debit, l.credit])).toEqual([
    ["cash", "", "100.05"],
    ["clearing", "100.05", ""],
  ]);
  const incoming = buildSettlementJournal({
    ...common,
    direction: "inflow",
    conversionMovement: "inflow",
    assetBookValue: "100.00",
    obligationBookValue: "100.05",
    differenceAccount: loss,
  });
  expect(incoming.map((l) => [l.account.id, l.debit, l.credit])).toEqual([
    ["cash", "100.00", ""],
    ["clearing", "", "100.05"],
    ["loss", "0.05", ""],
  ]);
  expect(() =>
    buildSettlementJournal({
      ...common,
      direction: "inflow",
      conversionMovement: "inflow",
      assetBookValue: "100.00",
    }),
  ).toThrow();
  expect(() =>
    buildSettlementJournal({
      ...common,
      direction: "inflow",
      assetBookValue: "100.00",
    }),
  ).toThrow();
});
