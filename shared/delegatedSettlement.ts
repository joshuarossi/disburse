import { parseAbiItem, parseEventLogs, type Log } from "viem";
import {
  assertDelegatedReceipt,
  type DelegatedIntent,
} from "./allowanceTransfer";
import { amountToBaseUnits } from "./validation";

/** Principal and allowance events must belong to this exact UserOperation,
 * independently from the fee account's prefund/refund and its other payments. */
export function assertDelegatedCircleReceipt(
  intent: DelegatedIntent,
  token: string,
  logs: Log[],
  boundary: { executionStart: number; executionEnd: number },
) {
  if (intent.feeAuthorization)
    throw new Error("This payment still uses an earlier execution service.");
  const scoped = logs.filter(
    (l) =>
      !l.removed &&
      l.logIndex !== null &&
      l.logIndex > boundary.executionStart &&
      l.logIndex < boundary.executionEnd,
  );
  assertDelegatedReceipt(
    { status: "success", logs: scoped },
    intent.safeAddress,
    token,
    intent,
  );
  const key = (asset: string, to: string, value: bigint) =>
    `${asset.toLowerCase()}:${to.toLowerCase()}:${value}`;
  const expected = [intent, ...(intent.additionalTransfers ?? [])]
    .map((t) =>
      key(
        intent.tokenAddress,
        t.recipientAddress,
        amountToBaseUnits(t.amount, token),
      ),
    )
    .sort();
  const actual = parseEventLogs({
    abi: [
      parseAbiItem(
        "event Transfer(address indexed from,address indexed to,uint256 value)",
      ),
    ],
    logs: scoped,
    strict: true,
  })
    .filter(
      (l) => l.args.from.toLowerCase() === intent.safeAddress.toLowerCase(),
    )
    .map((l) => key(l.address, l.args.to, l.args.value))
    .sort();
  if (
    expected.length !== actual.length ||
    expected.some((value, index) => value !== actual[index])
  )
    throw new Error(
      "The receipt contains different allowance principal transfers.",
    );
}
