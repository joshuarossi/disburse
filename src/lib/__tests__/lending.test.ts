import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
} from "viem";
import {
  aaveAbi,
  assertLendingAvailable,
  assertLendingSettlement,
  decodeLendingQuote,
  lendingAvailability,
  lendingCall,
  lendingMarket,
  lendingQuoteHash,
  LENDING_QUOTE_LIFETIME,
  type LendingQuote,
  type LendingSnapshot,
} from "../../../shared/lending";
import {
  buildSettlementJournal,
  type BookAccount,
} from "../../../shared/accounting";
import supplyReceipt from "./fixtures/aave-base-sepolia-supply-1.json";
import withdrawalReceipt from "./fixtures/aave-base-sepolia-withdraw-2.json";

describe("published Aave Base Sepolia receipts", () => {
  for (const fixture of [supplyReceipt, withdrawalReceipt]) {
    it(`reconciles the actual ${fixture.quote.kind} and rejects another account`, () => {
      const q = decodeLendingQuote(JSON.stringify(fixture.quote));
      const logs = fixture.receipt.logs as unknown as Log[];
      expect(assertLendingSettlement(q, logs, fixture.boundary)).toEqual(
        fixture.principal,
      );
      expect(() =>
        assertLendingSettlement(
          { ...q, account: "0x1111111111111111111111111111111111111111" },
          logs,
          fixture.boundary,
        ),
      ).toThrow();
      expect(() =>
        assertLendingSettlement(q, logs, {
          executionStart: fixture.boundary.executionEnd,
          executionEnd: fixture.boundary.executionEnd + 1,
        }),
      ).toThrow();
    });
  }
});

const now = 1788860000000,
  account = "0x1111111111111111111111111111111111111111" as Address;
const quote: LendingQuote = {
  version: 1,
  provider: "aave_v3",
  kind: "supply",
  chainId: 8453,
  account,
  reference: `0x${"12".repeat(32)}`,
  amount: "100000000",
  rateRay: "30000000000000000000000000",
  price: "100000000",
  priceUnit: "100000000",
  createdAt: now,
  expiresAt: now + LENDING_QUOTE_LIFETIME,
};
const market = lendingMarket(8453);
const position: LendingSnapshot = {
  chainId: 8453,
  account,
  asset: market.asset,
  assetLabel: "USDC",
  blockNumber: "123",
  checkedAt: now,
  available: "200000000",
  supplied: "150000000",
  feeBalance: "200000000",
  liquidity: "1000000000",
  totalSupply: "1000000000",
  supplyCap: "2000000000",
  rateRay: quote.rateRay,
  debt: "0",
  active: true,
  frozen: false,
  paused: false,
  price: quote.price,
  priceUnit: quote.priceUnit,
  priceUpdatedAt: now - 86_400_000,
  priceAvailable: true,
};
function event(
  address: Address,
  logIndex: number,
  topics: ReturnType<typeof encodeEventTopics>,
  data: Hex,
): Log {
  return {
    address,
    logIndex,
    topics: topics as Log["topics"],
    data,
    blockNumber: 123n,
    transactionIndex: 0,
    transactionHash: `0x${"ab".repeat(32)}`,
    blockHash: `0x${"cd".repeat(32)}`,
    removed: false,
  };
}
const transfer = (
  token: Address,
  from: Address,
  to: Address,
  value: bigint,
  index: number,
) =>
  event(
    token,
    index,
    encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from, to },
    }),
    encodeAbiParameters([{ type: "uint256" }], [value]),
  );
function receipt(q = quote) {
  return q.kind === "supply"
    ? [
        transfer(market.asset, account, market.aToken, BigInt(q.amount), 2),
        transfer(
          market.aToken,
          zeroAddress,
          account,
          BigInt(q.amount) + 500n,
          3,
        ),
        event(
          market.pool,
          4,
          encodeEventTopics({
            abi: aaveAbi,
            eventName: "Supply",
            args: {
              reserve: market.asset,
              onBehalfOf: account,
              referralCode: 0,
            },
          }),
          encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }],
            [account, BigInt(q.amount)],
          ),
        ),
      ]
    : [
        transfer(
          market.aToken,
          account,
          zeroAddress,
          BigInt(q.amount) - 500n,
          2,
        ),
        transfer(market.asset, market.aToken, account, BigInt(q.amount), 3),
        event(
          market.pool,
          4,
          encodeEventTopics({
            abi: aaveAbi,
            eventName: "Withdraw",
            args: { reserve: market.asset, user: account, to: account },
          }),
          encodeAbiParameters([{ type: "uint256" }], [BigInt(q.amount)]),
        ),
      ];
}
describe("lending readiness", () => {
  it("keeps withdrawals available during a depeg, stale feed or frozen deposits", () => {
    for (const change of [
      { priceAvailable: false },
      { price: "90000000" },
      { priceUpdatedAt: now - 27 * 3600000 },
      { frozen: true },
    ]) {
      const s = { ...position, ...change };
      expect(lendingAvailability("supply", s, now)).toBeTruthy();
      expect(() =>
        assertLendingAvailable("withdraw", "100000000", s, now),
      ).not.toThrow();
    }
  });
  it.each([
    { paused: true },
    { active: false },
    { debt: "1" },
    { feeBalance: "0" },
    { checkedAt: now - 181000 },
  ])("blocks unavailable or stale account state %j", (change) => {
    for (const kind of ["supply", "withdraw"] as const)
      expect(() =>
        assertLendingAvailable(kind, "1", { ...position, ...change }, now),
      ).toThrow();
  });
  it("uses exact balance, liquidity and reserve capacity limits", () => {
    expect(() =>
      assertLendingAvailable("supply", "200000001", position, now),
    ).toThrow("enough");
    expect(() =>
      assertLendingAvailable(
        "supply",
        "100000000",
        { ...position, supplyCap: "1099999999" },
        now,
      ),
    ).toThrow("capacity");
    expect(() =>
      assertLendingAvailable(
        "withdraw",
        "100000000",
        { ...position, liquidity: "99999999" },
        now,
      ),
    ).toThrow("liquidity");
    expect(() =>
      assertLendingAvailable("withdraw", "150000001", position, now),
    ).toThrow("current lending");
    for (const value of ["0", "-1", "0.1", "1e6", "10000000000001"])
      expect(() =>
        assertLendingAvailable("supply", value, position, now),
      ).toThrow();
  });
});
describe("lending authorization and receipts", () => {
  it("closes a position using the actual withdrawal receipt, including interest and rounding differences", () => {
    const full = { ...quote, kind: "withdraw" as const, withdrawAll: true };
    const actual = { ...full, amount: "100000003" };
    expect(
      assertLendingSettlement(full, receipt(actual), {
        executionStart: 1,
        executionEnd: 5,
      }).amount,
    ).toBe("100000003");
    expect(() =>
      assertLendingSettlement(
        { ...full, withdrawAll: undefined },
        receipt(actual),
        { executionStart: 1, executionEnd: 5 },
      ),
    ).toThrow();
    expect(lendingQuoteHash(full)).not.toBe(
      lendingQuoteHash({ ...full, withdrawAll: undefined }),
    );
    expect(() => lendingCall({ ...quote, withdrawAll: true })).toThrow(
      "Only a withdrawal",
    );
  });
  it("binds the exact chain, company account, amount, expiry and unique request", () => {
    for (const change of [
      { amount: "99999999" },
      { chainId: 42161 },
      { account: market.pool },
      { reference: `0x${"23".repeat(32)}` as Hex },
      { createdAt: now + 1000, expiresAt: quote.expiresAt + 1000 },
    ])
      expect(lendingQuoteHash({ ...quote, ...change })).not.toBe(
        lendingQuoteHash(quote),
      );
    expect(() =>
      decodeLendingQuote(JSON.stringify({ ...quote, amount: "1e8" })),
    ).toThrow();
    expect(() =>
      decodeLendingQuote(
        JSON.stringify({ ...quote, expiresAt: now + 99_999_999 }),
      ),
    ).toThrow();
    expect(() => lendingCall({ ...quote, chainId: 1 })).toThrow(
      "not supported",
    );
  });
  it("atomically limits approval, supplies to the company, disables collateral and removes allowance", () => {
    const call = lendingCall(quote);
    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "multiSend",
          stateMutability: "payable",
          inputs: [{ name: "transactions", type: "bytes" }],
          outputs: [],
        },
      ],
      data: call.data,
    });
    let payload = decoded.args![0].slice(2);
    const calls: { to: Address; data: Hex }[] = [];
    while (payload.length) {
      expect(payload.slice(0, 2)).toBe("00");
      const to = `0x${payload.slice(2, 42)}` as Address;
      expect(BigInt(`0x${payload.slice(42, 106)}`)).toBe(0n);
      const size = Number(BigInt(`0x${payload.slice(106, 170)}`));
      calls.push({ to, data: `0x${payload.slice(170, 170 + size * 2)}` });
      payload = payload.slice(170 + size * 2);
    }
    expect(calls).toHaveLength(5);
    expect(
      decodeFunctionData({ abi: erc20Abi, data: calls[1].data }).args,
    ).toEqual([market.pool, 100000000n]);
    expect(
      decodeFunctionData({ abi: aaveAbi, data: calls[2].data }).args,
    ).toEqual([market.asset, 100000000n, account, 0]);
    expect(
      decodeFunctionData({ abi: aaveAbi, data: calls[3].data }).args,
    ).toEqual([market.asset, false]);
    expect(
      decodeFunctionData({ abi: erc20Abi, data: calls[4].data }).args,
    ).toEqual([market.pool, 0n]);
  });
  it("proves underlying principal without treating accrued aToken mint/burn interest as another payment", () => {
    for (const kind of ["supply", "withdraw"] as const) {
      const q = { ...quote, kind };
      expect(
        assertLendingSettlement(q, receipt(q), {
          executionStart: 1,
          executionEnd: 5,
        }),
      ).toMatchObject({
        amount: quote.amount,
        direction: kind === "supply" ? "outflow" : "inflow",
      });
    }
  });
  it("rejects wrong amounts, removed events, unrelated operations and an extra wallet debit", () => {
    const boundary = { executionStart: 1, executionEnd: 5 };
    expect(() =>
      assertLendingSettlement({ ...quote, amount: "1" }, receipt(), boundary),
    ).toThrow();
    expect(() =>
      assertLendingSettlement(
        quote,
        receipt().map((log) => ({ ...log, removed: true })),
        boundary,
      ),
    ).toThrow("canonical");
    expect(() =>
      assertLendingSettlement(quote, receipt(), {
        executionStart: 4,
        executionEnd: 8,
      }),
    ).toThrow();
    const q = { ...quote, kind: "withdraw" as const };
    expect(() =>
      assertLendingSettlement(
        q,
        [...receipt(q), transfer(market.asset, account, market.pool, 1n, 4)],
        boundary,
      ),
    ).toThrow("unexpected");
  });
});
describe("lending book reconciliation", () => {
  const book = (
    id: string,
    kind: BookAccount["kind"] = "asset",
  ): BookAccount => ({ id, name: id, externalId: id, kind, version: 1 });
  const common = {
    currency: "USD" as const,
    companyTransfer: false,
    assetAccount: book("cash"),
    counterAccount: book("aave"),
  };
  it("transfers deposit carrying value without recognizing an expense", () => {
    const input = {
      ...common,
      treatment: "investment_deposit" as const,
      lendingMovement: "supply" as const,
      direction: "outflow" as const,
      assetBookValue: "99.95",
    };
    expect(
      buildSettlementJournal(input).map((l) => [
        l.account.id,
        l.debit,
        l.credit,
      ]),
    ).toEqual([
      ["cash", "", "99.95"],
      ["aave", "99.95", ""],
    ]);
    expect(() =>
      buildSettlementJournal({ ...input, treatment: "expense" }),
    ).toThrow("verified lending");
  });
  it("recognizes only a reviewed unrecorded difference on withdrawal and avoids double interest accrual", () => {
    const input = {
      ...common,
      treatment: "investment_withdrawal" as const,
      lendingMovement: "withdraw" as const,
      direction: "inflow" as const,
      assetBookValue: "101.00",
      obligationBookValue: "100.00",
    };
    expect(() => buildSettlementJournal(input)).toThrow("income");
    expect(
      buildSettlementJournal({
        ...input,
        differenceAccount: book("interest", "income"),
      }).map((l) => [l.account.id, l.debit, l.credit]),
    ).toEqual([
      ["cash", "101.00", ""],
      ["aave", "", "100.00"],
      ["interest", "", "1.00"],
    ]);
    expect(
      buildSettlementJournal({ ...input, obligationBookValue: "101.00" }),
    ).toHaveLength(2);
  });
});
