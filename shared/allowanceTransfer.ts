import { parseAbi, decodeEventLog, type Hex } from "viem";
import { allowanceDeployments } from "./allowanceDeployments";
import { amountToBaseUnits } from "./validation";
export const allowanceTransferAbi = parseAbi([
  "function getTokenAllowance(address safe,address delegate,address token) view returns (uint256[5])",
  "function generateTransferHash(address safe,address token,address to,uint96 amount,address paymentToken,uint96 payment,uint16 nonce) view returns (bytes32)",
  "function executeAllowanceTransfer(address safe,address token,address to,uint96 amount,address paymentToken,uint96 payment,address delegate,bytes signature)",
  "event ExecuteAllowanceTransfer(address indexed safe,address delegate,address token,address to,uint96 value,uint16 nonce)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export function allowanceModules(chainId: number) {
  return allowanceDeployments(chainId)
    .filter((d) => !d.legacy)
    .map((d) => d.address);
}
export type FeeAuthorization = {
  token: string;
  tokenAddress: string;
  collector: string;
  amount: string;
  nonce: number;
  hash: string;
  signature: string;
};
export type DelegatedIntent = {
  additionalTransfers?: Array<{
    recipientAddress: string;
    amount: string;
    nonce: number;
    hash: string;
    signature: string;
  }>;
  feeAuthorization?: FeeAuthorization;
  chainId: number;
  safeAddress: string;
  module: string;
  delegate: string;
  nonce: number;
  hash: string;
  signature: string;
  tokenAddress: string;
  recipientAddress: string;
  amount: string;
};
export function assertDelegatedReceipt(
  receipt: {
    status: string;
    logs: Array<{ address: string; data: Hex; topics: [Hex, ...Hex[]] | [] }>;
  },
  safe: string,
  token: string,
  intent: DelegatedIntent,
) {
  if (receipt.status !== "success")
    throw new Error("The delegated transaction did not succeed.");
  let moduleTransfers = 0;
  let transferred = 0n;
  const amount = amountToBaseUnits(intent.amount, token);
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({
        abi: allowanceTransferAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        event.eventName === "ExecuteAllowanceTransfer" &&
        log.address.toLowerCase() === intent.module.toLowerCase() &&
        event.args.safe.toLowerCase() === safe.toLowerCase() &&
        event.args.delegate.toLowerCase() === intent.delegate.toLowerCase() &&
        event.args.token.toLowerCase() === intent.tokenAddress.toLowerCase() &&
        event.args.to.toLowerCase() === intent.recipientAddress.toLowerCase() &&
        event.args.value === amount &&
        event.args.nonce === intent.nonce
      )
        moduleTransfers++;
      if (
        event.eventName === "Transfer" &&
        log.address.toLowerCase() === intent.tokenAddress.toLowerCase() &&
        event.args.from.toLowerCase() === safe.toLowerCase() &&
        event.args.to.toLowerCase() === intent.recipientAddress.toLowerCase()
      )
        transferred += event.args.value;
    } catch {
      /* Unrelated event. */
    }
  }
  for (const transfer of intent.additionalTransfers ?? []) {
    assertDelegatedReceipt(receipt, safe, token, {
      ...intent,
      ...transfer,
      additionalTransfers: undefined,
      feeAuthorization: undefined,
    });
  }
  if (intent.feeAuthorization) {
    const fee = intent.feeAuthorization;
    // Verify a separate authorization and the exact ERC-20 debit to the reviewed collector.
    assertDelegatedReceipt(receipt, safe, fee.token, {
      ...intent,
      additionalTransfers: undefined,
      feeAuthorization: undefined,
      nonce: fee.nonce,
      hash: fee.hash,
      signature: fee.signature,
      tokenAddress: fee.tokenAddress,
      recipientAddress: fee.collector,
      amount: fee.amount,
    });
  }
  if (moduleTransfers !== 1 || transferred !== amount)
    throw new Error(
      "Receipt does not match this delegated payment, amount and authorization.",
    );
}
