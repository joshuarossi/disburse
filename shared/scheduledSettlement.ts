import { getMultiSendCallOnlyDeployments } from "@safe-global/safe-deployments";
import { parseAbiItem, parseEventLogs, type Log } from "viem";
import type { CircleRequest } from "./circleRequest";
import { decodePaymentTransfers } from "./paymentIntent";

/** Match only the principal transfers inside this UserOperation. Fee prefunding,
 * refunds and other operations in the same bundle cannot settle this payment. */
export function assertScheduledTransfers(
  request: Pick<CircleRequest, "chainId" | "transaction" | "safe">,
  logs: Log[],
  boundary: { executionStart: number; executionEnd: number },
) {
  const deployment = getMultiSendCallOnlyDeployments({
    version: "1.4.1",
    network: String(request.chainId),
  });
  const entry = deployment?.networkAddresses[String(request.chainId)];
  const expected = decodePaymentTransfers(
    {
      ...request.transaction,
      operation: request.transaction.operation ?? 0,
      value: "0",
    },
    entry ? (Array.isArray(entry) ? entry : [entry]) : [],
  );
  const key = (token: string, recipient: string, amount: bigint) =>
    `${token.toLowerCase()}:${recipient.toLowerCase()}:${amount}`;
  const intended = expected
    .map((t) => key(t.tokenAddress, t.recipientAddress, t.amountRaw))
    .sort();
  const actual = parseEventLogs({
    abi: [
      parseAbiItem(
        "event Transfer(address indexed from,address indexed to,uint256 value)",
      ),
    ],
    logs,
    strict: true,
  })
    .filter(
      (l) =>
        !l.removed &&
        l.logIndex !== null &&
        l.logIndex > boundary.executionStart &&
        l.logIndex < boundary.executionEnd &&
        l.args.from.toLowerCase() === request.safe.toLowerCase(),
    )
    .map((l) => key(l.address, l.args.to, l.args.value))
    .sort();
  if (
    !intended.length ||
    intended.length !== actual.length ||
    intended.some((t, i) => t !== actual[i])
  )
    throw new Error(
      "The receipt does not contain every approved recipient transfer.",
    );
}
