import {
  concatHex,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { getMultiSendCallOnlyDeployments } from "@safe-global/safe-deployments";
import { approvalPaths, type AccountAuthority } from "./accountAuthority";
import {
  approvalSigningData,
  packSafeSignatures,
  recoverSafeSigner,
  type AccountSignature,
  type SafeTransactionData,
} from "../../shared/safeSignatures";
import type { PreparedOwnerProposal } from "../../shared/ownerProposal";
import type { ExecutionFee } from "../../shared/executionFee";
import { amountToBaseUnits } from "./validation";
import { configuredTokenAddress } from "../../shared/assets";

export type SavedAccountSignature = {
  path: string[];
  owner: string;
  signature: string;
};
import type { ApprovalGroup } from "../../shared/accountApprovalView";
export type { ApprovalGroup } from "../../shared/accountApprovalView";
const zero = "0x0000000000000000000000000000000000000000";
const abi = parseAbi([
  "function transfer(address to,uint256 value) returns (bool)",
  "function multiSend(bytes transactions)",
]);
export function prepareAccountTransaction(
  expected: {
    chainId: number;
    token: string;
    recipients: { recipientAddress: string; amount: string }[];
    executionFee?: ExecutionFee;
  },
  nonce: number,
): SafeTransactionData {
  const token = configuredTokenAddress(expected.chainId, expected.token);
  if (
    !token ||
    !Number.isSafeInteger(nonce) ||
    nonce < 0 ||
    !expected.recipients.length ||
    expected.recipients.length > 200
  )
    throw new Error("Invalid account payment");
  const calls = expected.recipients.map((r) => ({
    to: token as Address,
    data: encodeFunctionData({
      abi,
      functionName: "transfer",
      args: [
        r.recipientAddress as Address,
        amountToBaseUnits(r.amount, expected.token),
      ],
    }),
  }));
  return prepareAccountCalls(
    expected.chainId,
    calls,
    nonce,
    expected.executionFee,
  );
}
/** Only zero-value CALLs; the canonical batch contract cannot delegate arbitrary code. */
export function prepareAccountCalls(
  chainId: number,
  inputCalls: { to: string; data: string }[],
  nonce: number,
  fee?: ExecutionFee,
): SafeTransactionData {
  const calls = [...inputCalls];
  if (fee) {
    if (
      configuredTokenAddress(chainId, fee.token)?.toLowerCase() !==
      fee.tokenAddress.toLowerCase()
    )
      throw new Error("Unsupported account execution fee currency");
    calls.push({
      to: fee.tokenAddress,
      data: encodeFunctionData({
        abi,
        functionName: "transfer",
        args: [
          fee.collector as Address,
          amountToBaseUnits(fee.amount, fee.token),
        ],
      }),
    });
  }
  if (
    !calls.length ||
    calls.length > 201 ||
    !Number.isSafeInteger(nonce) ||
    nonce < 0
  )
    throw new Error("Invalid account transaction");
  let to: string = calls[0].to,
    data: string = calls[0].data;
  if (calls.length > 1) {
    const deployment = getMultiSendCallOnlyDeployments({
      version: "1.4.1",
      network: String(chainId),
    });
    const network = deployment?.networkAddresses[String(chainId)];
    to = (Array.isArray(network) ? network[0] : network) ?? "";
    if (!to) throw new Error("Batch payments are unavailable on this network");
    data = encodeFunctionData({
      abi,
      functionName: "multiSend",
      args: [
        concatHex(
          calls.map((c) =>
            concatHex([
              "0x00",
              c.to as Address,
              toHex(0, { size: 32 }),
              toHex((c.data.length - 2) / 2, { size: 32 }),
              c.data as Hex,
            ]),
          ),
        ),
      ],
    });
  }
  return {
    to,
    data,
    operation: calls.length > 1 ? 1 : 0,
    value: "0",
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: zero,
    refundReceiver: zero,
    nonce,
  };
}
export async function verifyAccountSignature(
  chainId: number,
  authority: AccountAuthority,
  proposal: PreparedOwnerProposal,
  signed: SavedAccountSignature,
) {
  const path = signed.path.map((a) => a.toLowerCase());
  if (
    !approvalPaths(authority, signed.owner).some(
      (p) => p.join(":") === path.join(":"),
    )
  )
    throw new Error(
      "Your current account authority does not include this approval path",
    );
  if (
    keccak256(
      approvalSigningData(
        chainId,
        [authority.root],
        proposal.safeTransactionData,
      ).data,
    ).toLowerCase() !== proposal.safeTxHash.toLowerCase()
  )
    throw new Error("The approval no longer matches the saved payment");
  const digest = approvalSigningData(
    chainId,
    path,
    proposal.safeTransactionData,
  ).hash;
  if (
    (await recoverSafeSigner(digest, signed.signature)) !==
    signed.owner.toLowerCase()
  )
    throw new Error("The approval signature does not belong to this member");
  return digest;
}
export async function assembleAccountApprovals(
  chainId: number,
  authority: AccountAuthority,
  proposal: PreparedOwnerProposal,
  saved: SavedAccountSignature[],
) {
  if (saved.length > 500) throw new Error("Too many account approvals");
  const valid = new Map<string, AccountSignature[]>();
  for (const signature of saved) {
    // Authority changes may remove a former owner or an entire path. Preserve
    // their evidence but do not count it toward today's approval requirements.
    if (
      !approvalPaths(authority, signature.owner).some(
        (p) => p.join(":") === signature.path.join(":"),
      )
    )
      continue;
    await verifyAccountSignature(chainId, authority, proposal, signature);
    const key = signature.path.join(":");
    const list = valid.get(key) ?? [];
    if (!list.some((s) => s.owner === signature.owner))
      list.push({ owner: signature.owner, signature: signature.signature });
    valid.set(key, list);
  }
  const groups: ApprovalGroup[] = [];
  let visits = 0;
  const assemble = (
    address: string,
    ancestors: string[],
  ): AccountSignature[] => {
    if (++visits > 128 || ancestors.length > 3 || ancestors.includes(address))
      throw new Error("Unsupported account approval hierarchy");
    const node = authority.nodes.find((n) => n.address === address)!;
    const path = [...ancestors, address];
    const signatures = [...(valid.get(path.join(":")) ?? [])];
    for (const contract of node.contracts) {
      const child = authority.nodes.find((n) => n.address === contract)!;
      const collected = assemble(contract, path);
      if (collected.length >= child.threshold)
        signatures.push({
          owner: contract,
          signature: packSafeSignatures(collected.slice(0, child.threshold)),
          isContractSignature: true,
        });
    }
    signatures.sort((a, b) => (a.owner < b.owner ? -1 : 1));
    groups.push({
      address,
      path,
      owners: node.owners,
      threshold: node.threshold,
      confirmedOwners: signatures.map((s) => s.owner),
    });
    return signatures;
  };
  const confirmations = assemble(authority.root, []);
  return { confirmations, groups };
}
