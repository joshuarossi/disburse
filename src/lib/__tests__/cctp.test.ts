import { describe, expect, it } from "vitest";
import recoveredTransfer from "./fixtures/cctp-base-sepolia-1.json";
import forwardedTransfer from "./fixtures/cctp-base-sepolia-single-hook-1.json";
import {
  concat,
  encodeAbiParameters,
  encodeEventTopics,
  pad,
  parseAbiItem,
  slice,
  toHex,
  zeroAddress,
  zeroHash,
  type AbiEvent,
  type Address,
  type Hex,
  type Log,
} from "viem";
import {
  assertCctpBurn,
  assertCctpDelivery,
  assertCctpRoute,
  cctpBurnMessage,
  cctpCall,
  cctpConfiguration,
  cctpHook,
  cctpQuoteHash,
  decodeCctpQuote,
  makeCctpQuote,
  validateCctpQuote,
} from "../../../shared/cctp";

const account = "0x1111111111111111111111111111111111111111",
  destination = "0x2222222222222222222222222222222222222222";
const input = {
  reference: `0x${"12".repeat(32)}` as Hex,
  chainId: 84532,
  destinationChainId: 11155111,
  account,
  destination,
  amount: "2000000",
} as const;
const fees = [
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { high: 250000 } },
];
const quote = makeCctpQuote(input, fees, 1_788_845_400_000);
function log(
  declaration: string,
  address: Address,
  logIndex: number,
  args: Record<string, unknown>,
): Log {
  const event = parseAbiItem(declaration as never) as AbiEvent,
    abi = [event] as const;
  return {
    address,
    logIndex,
    removed: false,
    blockNumber: 100n,
    blockHash: zeroHash,
    transactionHash: zeroHash,
    transactionIndex: 0,
    topics: encodeEventTopics({ abi, eventName: event.name, args } as never),
    data: encodeAbiParameters(
      event.inputs.filter((i) => !i.indexed),
      event.inputs.filter((i) => !i.indexed).map((i) => args[i.name!]) as never,
    ),
  } as Log;
}
function transfer(
  from: Address,
  to: Address,
  value: bigint,
  token: Address,
  index: number,
) {
  return log(
    "event Transfer(address indexed from,address indexed to,uint256 value)",
    token,
    index,
    { from, to, value },
  );
}
function sourceLogs(q = quote) {
  const source = cctpConfiguration(q.chainId),
    target = cctpConfiguration(q.destinationChainId);
  return [
    transfer(q.account, source.minter, BigInt(q.total), source.token, 2),
    transfer(source.minter, zeroAddress, BigInt(q.total), source.token, 3),
    log("event MessageSent(bytes message)", source.transmitter, 4, {
      message: cctpBurnMessage(q),
    }),
    log(
      "event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)",
      source.messenger,
      5,
      {
        burnToken: source.token,
        amount: BigInt(q.total),
        depositor: q.account,
        mintRecipient: pad(q.destination, { size: 32 }),
        destinationDomain: target.domain,
        destinationTokenMessenger: pad(target.messenger, { size: 32 }),
        destinationCaller: zeroHash,
        maxFee: BigInt(q.feeLimit),
        minFinalityThreshold: 2000,
        hookData: cctpHook(q.reference, q.version),
      },
    ),
  ];
}
function destinationLogs(q = quote, fee = 200000n) {
  const config = cctpConfiguration(q.destinationChainId),
    body = slice(cctpBurnMessage(q), 148);
  return [
    transfer(
      zeroAddress,
      q.destination,
      BigInt(q.total) - fee,
      config.token,
      10,
    ),
    log(
      "event MintAndWithdraw(address indexed mintRecipient,uint256 amount,address indexed mintToken,uint256 feeCollected)",
      config.messenger,
      11,
      {
        mintRecipient: q.destination,
        amount: BigInt(q.total) - fee,
        mintToken: config.token,
        feeCollected: fee,
      },
    ),
    log(
      "event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)",
      config.transmitter,
      12,
      {
        caller: account,
        sourceDomain: 6,
        nonce: `0x${"bc".repeat(32)}`,
        sender: pad(cctpConfiguration(q.chainId).messenger, { size: 32 }),
        finalityThresholdExecuted: 2000,
        messageBody: concat([
          slice(body, 0, 164),
          toHex(fee, { size: 32 }),
          slice(body, 196),
        ]),
      },
    ),
  ];
}
describe("provider quotes", () => {
  it("uses the documented single-hook format and preserves original composable approvals for recovery", () => {
    expect(quote.version).toBe(2);
    expect(cctpHook(quote.reference)).toBe(
      `0x636374702d666f72776172640000000000000000000000000000000000000000${"12".repeat(20)}`,
    );
    const original = { ...quote, version: 1 as const };
    expect(cctpQuoteHash(original)).not.toBe(cctpQuoteHash(quote));
    expect(
      assertCctpBurn(original, sourceLogs(original), {
        executionStart: 1,
        executionEnd: 6,
      }),
    ).toBeTruthy();
    expect(
      assertCctpDelivery(original, destinationLogs(original)),
    ).toBeTruthy();
    expect(() =>
      assertCctpDelivery(quote, destinationLogs(original)),
    ).toThrow();
  });
  it("keeps the destination minimum separate from every delivery component", () => {
    expect(quote).toMatchObject({
      amount: "2000000",
      total: "2250000",
      feeLimit: "250000",
      protocolFee: "0",
    });
    const fractional = makeCctpQuote(
      input,
      [{ ...fees[0], minimumFee: 1.3 }],
      quote.createdAt,
    );
    expect(BigInt(fractional.protocolFee)).toBeGreaterThanOrEqual(
      (BigInt(fractional.total) * 13n + 99999n) / 100000n,
    );
  });
  it.each([
    null,
    {},
    [],
    [{ finalityThreshold: 1000, forwardFee: { high: 5 }, minimumFee: 0 }],
    [{ ...fees[0], minimumFee: -1 }],
    [{ ...fees[0], forwardFee: { high: 0.1 } }],
    [{ ...fees[0], forwardFee: { high: 0 } }],
  ])("refuses malformed or incomplete provider responses", (response) => {
    expect(() => makeCctpQuote(input, response, quote.createdAt)).toThrow();
  });
  it("binds amounts, destination and unique reference to account approval", () => {
    expect(cctpCall(quote).operation).toBe(1);
    expect(cctpQuoteHash({ ...quote, destination: account })).not.toBe(
      cctpQuoteHash(quote),
    );
    expect(
      cctpQuoteHash({ ...quote, reference: `0x${"34".repeat(32)}` }),
    ).not.toBe(cctpQuoteHash(quote));
    expect(() => validateCctpQuote({ ...quote, total: "2000000" })).toThrow();
    expect(() =>
      validateCctpQuote({ ...quote, expiresAt: quote.expiresAt + 1 }),
    ).toThrow();
  });
  it.each([
    [8453, 84532],
    [84532, 42161],
    [8453, 8453],
    [11155111, 84532],
    [1, 42161],
  ])("refuses unsupported or mixed environments", (source, target) => {
    expect(() => assertCctpRoute(source, target)).toThrow();
  });
});
describe("independent receipts", () => {
  it("verifies the real customer-funded forwarding run and the exact receiving amount and fee", () => {
    const q = decodeCctpQuote(JSON.stringify(forwardedTransfer.quote));
    const logs = (value: typeof forwardedTransfer.source.logs) =>
      value.map((log) => ({
        ...log,
        blockNumber: BigInt(log.blockNumber),
      })) as unknown as Log[];
    expect(q.version).toBe(2);
    expect(
      assertCctpBurn(
        q,
        logs(forwardedTransfer.source.logs),
        forwardedTransfer.sourceBoundary,
      ).logIndex,
    ).toBeGreaterThanOrEqual(0);
    expect(
      assertCctpDelivery(q, logs(forwardedTransfer.destination.logs)),
    ).toMatchObject({ amount: "1000000", fee: "2016033" });
    expect(forwardedTransfer.executionFee).toBe("17455");
    expect(() =>
      assertCctpDelivery(
        { ...q, reference: input.reference },
        logs(forwardedTransfer.destination.logs),
      ),
    ).toThrow();
  });
  it("matches the real original burn and recovered destination without a provider receipt hint", () => {
    const q = decodeCctpQuote(JSON.stringify(recoveredTransfer.quote));
    const logs = (value: typeof recoveredTransfer.source.logs) =>
      value.map((log) => ({
        ...log,
        blockNumber: BigInt(log.blockNumber),
      })) as unknown as Log[];
    expect(
      assertCctpBurn(
        q,
        logs(recoveredTransfer.source.logs),
        recoveredTransfer.sourceBoundary,
      ).logIndex,
    ).toBeGreaterThanOrEqual(0);
    expect(
      assertCctpDelivery(q, logs(recoveredTransfer.destination.logs)),
    ).toMatchObject({
      amount: recoveredTransfer.received,
      fee: recoveredTransfer.deliveryFee,
    });
    expect(() =>
      assertCctpDelivery(
        { ...q, reference: input.reference },
        logs(recoveredTransfer.destination.logs),
      ),
    ).toThrow();
    // Historical v1 bytes remain recoverable; new single-hook approvals differ.
    expect(() =>
      assertCctpBurn(
        { ...q, version: 2 },
        logs(recoveredTransfer.source.logs),
        recoveredTransfer.sourceBoundary,
      ),
    ).toThrow();
  });
  it("proves the exact debit inside one approved operation", () => {
    expect(
      assertCctpBurn(quote, sourceLogs(), {
        executionStart: 1,
        executionEnd: 6,
      }).logIndex,
    ).toBe(2);
    expect(() =>
      assertCctpBurn(quote, sourceLogs(), {
        executionStart: 5,
        executionEnd: 10,
      }),
    ).toThrow();
    expect(() =>
      assertCctpBurn(
        quote,
        [
          ...sourceLogs(),
          transfer(account, destination, 1n, cctpConfiguration(84532).token, 3),
        ],
        { executionStart: 1, executionEnd: 6 },
      ),
    ).toThrow();
  });
  it("refuses another transfer, even between the same accounts and for the same amount", () => {
    const other = { ...quote, reference: `0x${"34".repeat(32)}` as Hex };
    expect(() =>
      assertCctpBurn(quote, sourceLogs(other), {
        executionStart: 1,
        executionEnd: 6,
      }),
    ).toThrow();
    expect(() => assertCctpDelivery(quote, destinationLogs(other))).toThrow();
  });
  it("verifies actual received units and the actual provider fee", () => {
    expect(assertCctpDelivery(quote, destinationLogs())).toMatchObject({
      amount: "2050000",
      fee: "200000",
      logIndex: 10,
    });
    expect(() =>
      assertCctpDelivery(quote, destinationLogs(quote, 250001n)),
    ).toThrow();
  });
  it("requires the real token movement and its CCTP event", () => {
    const logs = destinationLogs();
    expect(() => assertCctpDelivery(quote, logs.slice(1))).toThrow();
    expect(() => assertCctpDelivery(quote, logs.slice(0, 2))).toThrow();
    expect(() =>
      assertCctpDelivery(
        quote,
        logs.map((l, i) => (i === 0 ? { ...l, address: account } : l)),
      ),
    ).toThrow();
    expect(() =>
      assertCctpDelivery(
        quote,
        logs.map((l) => ({ ...l, removed: true })),
      ),
    ).toThrow();
    expect(() => assertCctpDelivery(quote, [...logs, ...logs])).toThrow();
  });
});
