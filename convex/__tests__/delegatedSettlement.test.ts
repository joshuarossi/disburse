import { expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  type Log,
} from "viem";
import { assertDelegatedCircleReceipt } from "../../shared/delegatedSettlement";
import { delegatedAccountCall } from "../../shared/delegatedAccountCall";
import { CURRENT_ALLOWANCE } from "../../shared/allowanceDeployments";
import { circleConfiguration } from "../../shared/circleExecution";
import type { DelegatedIntent } from "../../shared/allowanceTransfer";
import { TEST_WALLETS } from "./factories";
const safe = TEST_WALLETS.nonMember,
  recipient = TEST_WALLETS.viewer,
  delegate = TEST_WALLETS.approver;
const intent: DelegatedIntent = {
  chainId: 8453,
  safeAddress: safe,
  module: CURRENT_ALLOWANCE.address,
  delegate,
  nonce: 1,
  signature: "0x",
  hash: `0x${"12".repeat(32)}`,
  tokenAddress: circleConfiguration(8453).token,
  recipientAddress: recipient,
  amount: "0.1",
};
function transfer(
  index = 5,
  amount = 100000n,
  token = intent.tokenAddress,
  to = recipient,
): Log {
  return {
    address: token,
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    topics: encodeEventTopics({
      abi: parseAbi([
        "event Transfer(address indexed from,address indexed to,uint256 value)",
      ]),
      eventName: "Transfer",
      args: { from: safe, to },
    }),
    logIndex: index,
    removed: false,
  } as Log;
}
function allowance(index = 6, nonce = 1, to = recipient): Log {
  return {
    address: intent.module,
    topics: encodeEventTopics({
      abi: parseAbi([
        "event ExecuteAllowanceTransfer(address indexed safe,address delegate,address token,address to,uint96 value,uint16 nonce)",
      ]),
      eventName: "ExecuteAllowanceTransfer",
      args: { safe },
    }),
    data: encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint96" },
        { type: "uint16" },
      ],
      [delegate, intent.tokenAddress as `0x${string}`, to, 100000n, nonce],
    ),
    logIndex: index,
    removed: false,
  } as Log;
}
const boundary = { executionStart: 3, executionEnd: 20 };
it("accepts exact principal/module evidence inside the operation, excluding unrelated bundled transfers", () => {
  expect(() =>
    assertDelegatedCircleReceipt(
      intent,
      "USDC",
      [transfer(1), allowance(2), transfer(), allowance(), transfer(25)],
      boundary,
    ),
  ).not.toThrow();
});
it.each([
  "other_operation",
  "removed",
  "wrong_nonce",
  "duplicate_principal",
  "extra_recipient",
  "wrong_token",
])("rejects %s evidence", (kind) => {
  const logs =
    kind === "other_operation"
      ? [transfer(1), allowance(2)]
      : kind === "removed"
        ? [{ ...transfer(), removed: true }, allowance()]
        : kind === "wrong_nonce"
          ? [transfer(), allowance(6, 2)]
          : kind === "duplicate_principal"
            ? [transfer(), allowance(), transfer(8)]
            : kind === "extra_recipient"
              ? [
                  transfer(),
                  allowance(),
                  transfer(8, 1n, intent.tokenAddress, TEST_WALLETS.initiator),
                ]
              : [transfer(5, 100000n, TEST_WALLETS.admin), allowance()];
  expect(() =>
    assertDelegatedCircleReceipt(intent, "USDC", logs, boundary),
  ).toThrow();
});
it("preserves the assigned account as caller for every item in a batch, with no reusable principal signature", () => {
  const batch = {
    ...intent,
    additionalTransfers: [
      {
        recipientAddress: TEST_WALLETS.initiator,
        nonce: 2,
        hash: intent.hash,
        signature: "0x",
        amount: "0.1",
      },
    ],
  };
  const call = delegatedAccountCall(batch, "USDC");
  expect(call.operation).toBe(1);
  expect(() =>
    assertDelegatedCircleReceipt(
      batch,
      "USDC",
      [
        transfer(),
        allowance(),
        transfer(8, 100000n, intent.tokenAddress, TEST_WALLETS.initiator),
        allowance(9, 2, TEST_WALLETS.initiator),
      ],
      boundary,
    ),
  ).not.toThrow();
  expect(delegatedAccountCall(intent, "USDC").operation).toBe(0);
});
