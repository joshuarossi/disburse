import { getMultiSendCallOnlyDeployments } from "@safe-global/safe-deployments";
import {
  concat,
  encodeFunctionData,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

/** Execute published provider calls from the Safe, with no native-token debit. */
export function stableAccountBatch(
  chainId: number,
  calls: Array<{ to: Address; data: Hex }>,
) {
  if (!calls.length || calls.length > 201)
    throw new Error("Choose a supported number of account operations.");
  const deployment = getMultiSendCallOnlyDeployments({
    version: "1.4.1",
    network: String(chainId),
  });
  const addresses = deployment?.networkAddresses[String(chainId)];
  const to = Array.isArray(addresses) ? addresses[0] : addresses;
  if (!to)
    throw new Error("Account batches are not supported on this network.");
  return {
    to: to as Address,
    operation: 1 as const,
    data: encodeFunctionData({
      abi: parseAbi(["function multiSend(bytes transactions)"]),
      functionName: "multiSend",
      args: [
        concat(
          calls.map((call) =>
            concat([
              toHex(0, { size: 1 }),
              call.to,
              toHex(0, { size: 32 }),
              toHex((call.data.length - 2) / 2, { size: 32 }),
              call.data,
            ]),
          ),
        ),
      ],
    }),
  };
}
