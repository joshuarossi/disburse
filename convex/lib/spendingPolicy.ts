import { assertExactAccountChange } from "./accountChange";
import { getAddress } from "viem";
import {
  buildAllowanceGrant,
  buildAllowanceRevocation,
  readAllowanceState,
} from "../../shared/allowance";
import {
  assertCurrentAllowance,
  supportsCurrentAllowance,
} from "../../shared/allowanceDeployments";
import { configuredTokenAddress } from "../../shared/assets";
import type { PreparedOwnerProposal } from "../../shared/ownerProposal";
import type { ExecutionFee } from "../../shared/executionFee";
import type { Doc } from "../_generated/dataModel";
import {
  availableAccountApprovals,
  type AccountAuthority,
} from "./accountAuthority";
import { prepareAccountCalls } from "./accountApproval";
import { getChainClient } from "./safeVerification";

export type PolicyIntent = Doc<"spendingPolicyChanges">["intent"];
export function policyTransaction(
  chainId: number,
  safe: string,
  intent: PolicyIntent,
  nonce: number,
  fee?: ExecutionFee,
) {
  const calls =
    intent.kind === "grant"
      ? buildAllowanceGrant({
          chainId,
          safe,
          module: intent.module,
          delegate: intent.delegate,
          token: intent.token!,
          amount: intent.amount!,
          resetMinutes: intent.resetMinutes!,
          moduleEnabled: intent.moduleEnabled,
          delegateExists: intent.delegateExists,
        })
      : buildAllowanceRevocation(
          chainId,
          intent.module,
          intent.delegate,
          intent.tokenAddress,
        );
  return prepareAccountCalls(chainId, calls, nonce, fee);
}

/** A multisig owner may need independent spending authority. One wallet that can
 * already authorize the whole account cannot be restricted with an allowance. */
export function assertUsefulDelegation(
  authority: AccountAuthority,
  delegate: string,
) {
  if (availableAccountApprovals(authority, [delegate]))
    throw new Error(
      "This wallet can already approve account transactions on its own. An allowance would not limit that authority. Choose another member.",
    );
}

export async function inspectPolicy(
  chainId: number,
  safe: string,
  input: Pick<
    PolicyIntent,
    | "kind"
    | "module"
    | "delegate"
    | "token"
    | "tokenAddress"
    | "amount"
    | "resetMinutes"
  >,
  authority: AccountAuthority,
): Promise<PolicyIntent> {
  const module = getAddress(input.module),
    delegate = getAddress(input.delegate),
    tokenAddress = getAddress(input.tokenAddress);
  const state = await readAllowanceState(
    getChainClient(chainId),
    chainId,
    safe,
    module,
    undefined,
    BigInt(authority.blockNumber),
  );
  if (input.kind === "grant") {
    assertCurrentAllowance(chainId, module);
    if (!supportsCurrentAllowance(state.safeVersion))
      throw new Error(
        "This account version does not support new spending grants",
      );
    assertUsefulDelegation(authority, delegate);
    if (
      !input.token ||
      configuredTokenAddress(chainId, input.token)?.toLowerCase() !==
        tokenAddress.toLowerCase()
    )
      throw new Error(
        "The allowance currency does not match its network contract",
      );
    if (!state.moduleEnabled && state.allowances.length)
      throw new Error(
        "This disabled module has dormant allowances. Revoke them here before activating delegated spending.",
      );
  }
  const previous = state.allowances.find(
    (a) =>
      a.delegate.toLowerCase() === delegate.toLowerCase() &&
      a.token.toLowerCase() === tokenAddress.toLowerCase(),
  );
  if (input.kind === "revoke" && !previous)
    throw new Error("This allowance has already been revoked");
  return {
    ...input,
    module,
    delegate,
    tokenAddress,
    moduleEnabled: state.moduleEnabled,
    delegateExists: state.delegates.some(
      (d) => d.toLowerCase() === delegate.toLowerCase(),
    ),
    previousAmount: String(previous?.amount ?? 0n),
    previousResetMinutes: previous?.resetMinutes ?? 0,
  };
}

export async function assertPolicyProposal(
  policy: Pick<
    Doc<"spendingPolicyChanges">,
    "chainId" | "safeAddress" | "intent" | "executionFee" | "safeTxHash"
  >,
  proposal: PreparedOwnerProposal,
  authority: AccountAuthority,
) {
  if (
    proposal.safeAddress.toLowerCase() !== policy.safeAddress.toLowerCase() ||
    proposal.safeTxHash !== policy.safeTxHash
  )
    throw new Error("The original policy approval cannot be replaced");
  const live = await inspectPolicy(
    policy.chainId,
    policy.safeAddress,
    policy.intent,
    authority,
  );
  for (const field of [
    "moduleEnabled",
    "delegateExists",
    "previousAmount",
    "previousResetMinutes",
  ] as const) {
    if (live[field] !== policy.intent[field])
      throw new Error(
        "The account spending policy changed after this request. Review its original intent before applying it.",
      );
  }
  const canonical = policyTransaction(
    policy.chainId,
    policy.safeAddress,
    policy.intent,
    proposal.safeTransactionData.nonce,
    policy.executionFee,
  );
  await assertExactAccountChange(
    policy.chainId,
    policy.safeAddress,
    canonical,
    proposal,
    authority,
  );
}
