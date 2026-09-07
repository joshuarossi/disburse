import {
  getMultiSendDeployments,
  getMultiSendCallOnlyDeployments,
} from "@safe-global/safe-deployments";
import { hashMessage, keccak256, parseAbi, type Address, type Hex } from "viem";
import { recoverAddress } from "./signatures";
import { getChainClient } from "./safeVerification";
import { assertSafeIdentity } from "./safeIdentity";
import { assertSignatureHandler, authorityAbi } from './accountAuthority';
import { packSafeSignatures, transactionSigningData, type AccountSignature, type SafeTransactionData } from '../../shared/safeSignatures';
import type { ExecutionFee } from "../../shared/executionFee";
import { CHAIN_TOKENS, type SupportedChainId } from "../../shared/chains";
import {
  assertPaymentIntent,
  type PaymentCall,
} from "../../shared/paymentIntent";

const abi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
]);
const zero = "0x0000000000000000000000000000000000000000";
export type SafeProposal = PaymentCall & {
  safe: string;
  safeTxGas: string | number;
  baseGas: string | number;
  gasPrice: string;
  gasToken: string;
  refundReceiver?: string | null;
  nonce: string | number;
  confirmations?: AccountSignature[];
};
export async function assertSafeProposal(
  tx: SafeProposal,
  expected: {
    chainId: number;
    safeAddress: string;
    safeTxHash: string;
    token: string;
    tokenAddress?: string;
    relayFeeToken?: string;
    executionFee?: ExecutionFee;
    recipients: Array<{ recipientAddress: string; amount: string }>;
  },
  requireSignatures: boolean,
) {
  if (tx.safe.toLowerCase() !== expected.safeAddress.toLowerCase())
    throw new Error("Proposal belongs to another funding account");
  const tokens = CHAIN_TOKENS[expected.chainId as SupportedChainId];
  const token =
    tokens &&
    Object.entries(tokens).find(
      ([symbol]) => symbol === expected.token.toUpperCase(),
    )?.[1];
  if (!token) throw new Error("Unsupported payment currency");
  if (expected.tokenAddress && expected.tokenAddress.toLowerCase() !== token.address.toLowerCase()) throw new Error("The payment currency contract has changed. Review a new payment before signing.");
  const client = getChainClient(expected.chainId);
  if (expected.executionFee && (BigInt(tx.gasPrice) !== 0n || BigInt(tx.baseGas) !== 0n || BigInt(tx.safeTxGas) !== 0n || (tx.gasToken || zero).toLowerCase() !== zero || (tx.refundReceiver || zero).toLowerCase() !== zero))
    throw new Error("The reviewed execution fee cannot include an additional Safe gas refund");
  const blockNumber = await client.getBlockNumber();
  const safe = expected.safeAddress as Address;
  await assertSafeIdentity(client, safe, expected.chainId, blockNumber);
  const deployments = ["1.3.0", "1.4.1"]
    .flatMap((version) => [
      getMultiSendDeployments({ network: String(expected.chainId), version }),
      getMultiSendCallOnlyDeployments({
        network: String(expected.chainId),
        version,
      }),
    ])
    .filter((d) => !!d);
  const allowed = deployments.flatMap((d) => {
    const entry = d.networkAddresses[String(expected.chainId)];
    return entry ? (Array.isArray(entry) ? entry : [entry]) : [];
  });
  assertPaymentIntent(
    tx,
    { ...expected, tokenAddress: token.address },
    allowed,
  );
  if (tx.operation === 1) {
    const deployment = deployments
      .flatMap((d) => Object.values(d.deployments))
      .find((d) => d?.address.toLowerCase() === tx.to.toLowerCase());
    const code = await client.getCode({
      address: tx.to as Address,
      blockNumber,
    });
    if (!deployment || !code || keccak256(code) !== deployment.codeHash)
      throw new Error(
        "Batch contract code does not match its supported deployment",
      );
  }
  if (
    !expected.executionFee && (tx.gasToken || zero).toLowerCase() !==
    (expected.relayFeeToken || zero).toLowerCase()
  )
    throw new Error(
      "Proposal fee currency differs from the saved payment settings",
    );
  const hash = await client.readContract({
    address: safe,
    abi,
    functionName: "getTransactionHash",
    blockNumber,
    args: [
      tx.to as Address,
      BigInt(tx.value),
      (tx.data || "0x") as Hex,
      tx.operation,
      BigInt(tx.safeTxGas),
      BigInt(tx.baseGas),
      BigInt(tx.gasPrice),
      (tx.gasToken || zero) as Address,
      (tx.refundReceiver || zero) as Address,
      BigInt(tx.nonce),
    ],
  });
  if (hash.toLowerCase() !== expected.safeTxHash.toLowerCase())
    throw new Error("Proposal data does not match the saved transaction hash");
  if (!requireSignatures) return;
  const status = await readOwnerApprovalStatus(
    tx,
    expected.chainId,
    expected.safeAddress,
    hash,
    blockNumber,
  );
  if (status.currentNonce !== status.proposalNonce)
    throw new Error(
      "Earlier account transactions must complete, or this proposal was already consumed. Review the account queue.",
    );
  if (status.threshold < 1 || status.confirmedOwners.length < status.threshold)
    throw new Error("The account still needs owner signatures");
}

/** Read cryptographically verified partial approvals without requiring execution readiness. */
export async function readOwnerApprovalStatus(
  tx: SafeProposal,
  chainId: number,
  safeAddress: string,
  hash: Hex,
  atBlock?: bigint,
) {
  const client = getChainClient(chainId);
  const blockNumber = atBlock ?? (await client.getBlockNumber());
  const safe = safeAddress as Address;
  const [owners, threshold, nonce] = await Promise.all([
    client.readContract({
      address: safe,
      abi,
      functionName: "getOwners",
      blockNumber,
    }),
    client.readContract({
      address: safe,
      abi,
      functionName: "getThreshold",
      blockNumber,
    }),
    client.readContract({
      address: safe,
      abi,
      functionName: "nonce",
      blockNumber,
    }),
  ]);
  const confirmed = new Set<string>();
  for (const c of tx.confirmations ?? []) {
    if (c.isContractSignature) {
      if (!owners.some(o => o.toLowerCase() === c.owner.toLowerCase())) continue;
      await assertSafeIdentity(client, c.owner as Address, chainId, blockNumber);
      await assertSignatureHandler(client, c.owner as Address, chainId, blockNumber);
      const data = transactionSigningData(chainId, safeAddress, { ...tx, data: tx.data ?? '0x', operation: tx.operation as 0 | 1, nonce: Number(tx.nonce), safeTxGas: String(tx.safeTxGas), baseGas: String(tx.baseGas), refundReceiver: tx.refundReceiver ?? zero } as SafeTransactionData);
      if (keccak256(data).toLowerCase() !== hash.toLowerCase()) throw new Error('Contract approval does not match the account transaction');
      await client.readContract({ address: safe, abi: authorityAbi, functionName: 'checkNSignatures', args: [hash, data, packSafeSignatures([c]), 1n], blockNumber });
      confirmed.add(c.owner.toLowerCase());
      continue;
    }
    if (!/^0x[0-9a-fA-F]{130}$/.test(c.signature))
      throw new Error("Complete contract-owner signature payments in Safe");
    const v = Number.parseInt(c.signature.slice(-2), 16);
    if (![27, 28, 31, 32].includes(v))
      throw new Error("This signature type must be executed through Safe");
    const signature = (
      v > 30 ? c.signature.slice(0, -2) + (v - 4).toString(16) : c.signature
    ) as Hex;
    const recovered = (
      await recoverAddress({
        hash: v > 30 ? hashMessage({ raw: hash }) : hash,
        signature,
      })
    ).toLowerCase();
    if (recovered !== c.owner.toLowerCase())
      throw new Error(
        "A proposal signature is not from a current account owner",
      );
    if (owners.some((o) => o.toLowerCase() === recovered)) confirmed.add(recovered);
  }
  return {
    owners: owners.map((owner) => owner.toLowerCase()),
    confirmedOwners: [...confirmed],
    threshold: Number(threshold),
    currentNonce: Number(nonce),
    proposalNonce: Number(tx.nonce),
    ready:
      threshold > 0n &&
      BigInt(confirmed.size) >= threshold &&
      nonce === BigInt(tx.nonce),
  };
}
