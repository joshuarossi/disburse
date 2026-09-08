import { expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { assertScheduledTransfers } from "../../shared/scheduledSettlement";
import { prepareAccountTransaction } from "../lib/accountApproval";
import { circleConfiguration } from "../../shared/circleExecution";
const safe = "0x1111111111111111111111111111111111111111",
  a = "0x2222222222222222222222222222222222222222",
  b = "0x3333333333333333333333333333333333333333";
const config = circleConfiguration(84532),
  event = parseAbiItem(
    "event Transfer(address indexed from,address indexed to,uint256 value)",
  );
const intent = {
  chainId: 84532,
  token: "USDC",
  recipients: [
    { recipientAddress: a, amount: "1" },
    { recipientAddress: b, amount: "2" },
  ],
};
const call = prepareAccountTransaction(intent, 0);
const request = {
  chainId: 84532,
  safe: safe as Address,
  transaction: {
    to: call.to as Address,
    data: call.data as Hex,
    operation: call.operation as 0 | 1,
  },
};
const log = (
  to: Address,
  amount: bigint,
  logIndex: number,
  token: Address = config.token,
  from: Address = safe,
): Log => ({
  address: token,
  topics: encodeEventTopics({
    abi: [event],
    eventName: "Transfer",
    args: { from, to },
  }) as [Hex, ...Hex[]],
  data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  logIndex,
  removed: false,
  blockNumber: 1n,
  blockHash: `0x${"aa".repeat(32)}`,
  transactionHash: `0x${"bb".repeat(32)}`,
  transactionIndex: 0,
});
const boundary = { executionStart: 3, executionEnd: 9 };
it("settles exactly the approved batch while ignoring provider prefunding, refunds and another operation", () => {
  expect(() =>
    assertScheduledTransfers(
      request,
      [
        log(config.paymaster, 10000n, 1),
        log(a, 1000000n, 4),
        log(b, 2000000n, 5),
        log(safe, 5000n, 6, config.token, config.paymaster),
        log(a, 1000000n, 10),
      ],
      boundary,
    ),
  ).not.toThrow();
});
it.each([
  "missing",
  "overpayment",
  "wrong-token",
  "outside-operation",
  "removed",
  "extra",
])(
  "rejects %s transfer evidence even when the UserOperation reports success",
  (mode) => {
    const logs = [log(a, 1000000n, 4), log(b, 2000000n, 5)];
    if (mode === "missing") logs.pop();
    if (mode === "overpayment") logs[1] = log(b, 2000001n, 5);
    if (mode === "wrong-token") logs[1] = log(b, 2000000n, 5, a);
    if (mode === "outside-operation") logs[1].logIndex = 10;
    if (mode === "removed") logs[1].removed = true;
    if (mode === "extra") logs.push(log(a, 1n, 7));
    expect(() => assertScheduledTransfers(request, logs, boundary)).toThrow(
      "every approved recipient",
    );
  },
);
