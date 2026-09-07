import {
  concat,
  encodeFunctionData,
  parseAbi,
  toHex,
  zeroAddress,
  type Hex,
  type Address,
} from "viem";
import { getMultiSendCallOnlyDeployments } from "@safe-global/safe-deployments";
import {
  allowanceTransferAbi,
  type DelegatedIntent,
} from "./allowanceTransfer";
import { amountToBaseUnits } from "./validation";

/** Signed allowance transfers execute atomically: every recipient receives the full amount, plus a separate reviewed fee. */
export function delegatedAccountCall(intent: DelegatedIntent, token: string) {
  const fee = intent.feeAuthorization;
  const transferData = (
    tokenAddress: string,
    recipient: string,
    amount: bigint,
    signature: string,
  ) =>
    encodeFunctionData({
      abi: allowanceTransferAbi,
      functionName: "executeAllowanceTransfer",
      args: [
        intent.safeAddress as Address,
        tokenAddress as Address,
        recipient as Address,
        amount,
        zeroAddress,
        0n,
        intent.delegate as Address,
        signature as Hex,
      ],
    });
  if (!fee && !intent.additionalTransfers?.length)
    return {
      to: intent.module as Address,
      data: transferData(
        intent.tokenAddress,
        intent.recipientAddress,
        amountToBaseUnits(intent.amount, token),
        intent.signature,
      ),
    };
  const deployment = getMultiSendCallOnlyDeployments({
    version: "1.4.1",
    network: String(intent.chainId),
  });
  const entry = deployment?.networkAddresses[String(intent.chainId)];
  const to = Array.isArray(entry) ? entry[0] : entry;
  if (!to)
    throw new Error(
      "Batched allowance execution is not supported on this network.",
    );
  const call = (
    tokenAddress: string,
    recipient: string,
    amount: bigint,
    signature: string,
  ) => {
    const data = transferData(tokenAddress, recipient, amount, signature);
    return concat([
      toHex(0, { size: 1 }),
      intent.module as Address,
      toHex(0, { size: 32 }),
      toHex((data.length - 2) / 2, { size: 32 }),
      data,
    ]);
  };
  return {
    to: to as Address,
    data: encodeFunctionData({
      abi: parseAbi(["function multiSend(bytes transactions)"]),
      functionName: "multiSend",
      args: [
        concat([
          call(
            intent.tokenAddress,
            intent.recipientAddress,
            amountToBaseUnits(intent.amount, token),
            intent.signature,
          ),
          ...(intent.additionalTransfers ?? []).map((t) =>
            call(
              intent.tokenAddress,
              t.recipientAddress,
              amountToBaseUnits(t.amount, token),
              t.signature,
            ),
          ),
          ...(fee
            ? [
                call(
                  fee.tokenAddress,
                  fee.collector,
                  amountToBaseUnits(fee.amount, fee.token),
                  fee.signature,
                ),
              ]
            : []),
        ]),
      ],
    }),
  };
}
