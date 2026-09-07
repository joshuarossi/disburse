import {
  decodeEventLog,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { getMultiSendCallOnlyDeployments } from "@safe-global/safe-deployments";
import type { PreparedOwnerProposal } from "../../shared/ownerProposal";
import {
  approvalSigningData,
  type SafeTransactionData,
} from "../../shared/safeSignatures";
import type { ExecutionFee } from "../../shared/executionFee";
import { amountToBaseUnits } from "../../shared/validation";
import { accountExecutionOutcome } from "../../shared/accountExecution";
import type { AccountAuthority } from "./accountAuthority";
import { getChainClient } from "./safeVerification";
const hashAbi = parseAbi([
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
]);
const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export async function assertExactAccountChange(
  chainId: number,
  safeAddress: string,
  canonical: SafeTransactionData,
  proposal: PreparedOwnerProposal,
  authority: AccountAuthority,
) {
  if (
    safeAddress.toLowerCase() !== authority.root ||
    proposal.safeAddress.toLowerCase() !== authority.root
  )
    throw new Error("Account change belongs to another funding account");
  for (const field of Object.keys(canonical) as (keyof typeof canonical)[]) {
    if (
      String(canonical[field]).toLowerCase() !==
      String(proposal.safeTransactionData[field]).toLowerCase()
    )
      throw new Error("Account transaction differs from the reviewed change");
  }
  const digest = approvalSigningData(chainId, [authority.root], canonical).hash;
  if (digest.toLowerCase() !== proposal.safeTxHash.toLowerCase())
    throw new Error("Account hash differs from the reviewed change");
  const client = getChainClient(chainId),
    blockNumber = BigInt(authority.blockNumber);
  if (canonical.operation === 1)
    await assertBatchContract(chainId, canonical.to, blockNumber);
  const t = canonical;
  const onchainHash = await client.readContract({
    address: safeAddress as Address,
    abi: hashAbi,
    functionName: "getTransactionHash",
    blockNumber,
    args: [
      t.to as Address,
      BigInt(t.value),
      t.data as Hex,
      t.operation,
      BigInt(t.safeTxGas),
      BigInt(t.baseGas),
      BigInt(t.gasPrice),
      t.gasToken as Address,
      t.refundReceiver as Address,
      BigInt(t.nonce),
    ],
  });
  if (onchainHash.toLowerCase() !== digest.toLowerCase())
    throw new Error("The funding account returned a different approval hash");
}

export function accountChangeReceiptOutcome(
  receipt: {
    status: string;
    logs: {
      address: string;
      data: string;
      topics: readonly string[];
      removed?: boolean;
    }[];
  },
  policy: {
    safeAddress: string;
    safeTxHash: string;
    executionFee?: ExecutionFee;
  },
) {
  if (receipt.status !== "success") return "failure";
  const results = receipt.logs
    .filter((l) => l.address.toLowerCase() === policy.safeAddress.toLowerCase())
    .map((l) => accountExecutionOutcome(l, policy.safeTxHash))
    .filter((r) => r !== null);
  if (results.length !== 1)
    throw new Error("The receipt does not confirm this account transaction");
  if (results[0] === "success" && policy.executionFee) {
    const fee = policy.executionFee;
    const transfers = receipt.logs
      .filter(
        (l) =>
          !l.removed &&
          l.address.toLowerCase() === fee.tokenAddress.toLowerCase(),
      )
      .flatMap((log) => {
        try {
          return [
            decodeEventLog({
              abi: transferAbi,
              eventName: "Transfer",
              data: log.data as Hex,
              topics: log.topics as [Hex, ...Hex[]],
            }).args,
          ];
        } catch {
          return [];
        }
      })
      .filter((t) => t.from.toLowerCase() === policy.safeAddress.toLowerCase());
    if (
      transfers.length !== 1 ||
      transfers[0].to.toLowerCase() !== fee.collector.toLowerCase() ||
      transfers[0].value !== amountToBaseUnits(fee.amount, fee.token)
    )
      throw new Error(
        "The receipt does not confirm the reviewed execution fee",
      );
  }
  return results[0];
}

export async function assertBatchContract(
  chainId: number,
  address: string,
  blockNumber: bigint,
) {
  const client = getChainClient(chainId);
  const deployment = getMultiSendCallOnlyDeployments({
    version: "1.4.1",
    network: String(chainId),
  });
  const code = await client.getCode({
    address: address as Address,
    blockNumber,
  });
  if (
    !code ||
    !Object.values(deployment?.deployments ?? {}).some(
      (d) =>
        d?.address.toLowerCase() === address.toLowerCase() &&
        d.codeHash === keccak256(code),
    )
  )
    throw new Error("The account batch contract could not be verified");
}
