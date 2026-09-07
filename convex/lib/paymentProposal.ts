import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { getSafeTxServiceUrl } from '../../shared/safe';
import type { SafeProposal } from './safeProposal';
import { approvalPaths, readAccountAuthority } from './accountAuthority';
import { assembleAccountApprovals, type ApprovalGroup } from './accountApproval';
export type WorkspaceApprovalStatus = { groups: ApprovalGroup[]; paths: Array<{ path: string[]; labels: string[]; approved: boolean }>; names: Array<{ address: string; name: string }> };
export type LoadedPaymentProposal = SafeProposal & { workspace?: WorkspaceApprovalStatus; atBlock?: bigint };

/** Workspace approvals are authoritative for new payments. Existing service proposals retain their original recovery path. */
export async function loadPaymentProposal(ctx: ActionCtx, disbursementId: Id<'disbursements'>, expected: { chainId: number; safeAddress: string; safeTxHash: string }, actorWallet?: string): Promise<LoadedPaymentProposal> {
  const source = await ctx.runQuery(internal.accountApprovals.context, { disbursementId });
  if (source.saved) {
    const proposal = source.saved.proposal;
    if (proposal.safeTxHash.toLowerCase() !== expected.safeTxHash.toLowerCase() || proposal.safeAddress.toLowerCase() !== expected.safeAddress.toLowerCase()) throw new Error('The saved approval belongs to another payment');
    const authority = await readAccountAuthority(expected.chainId, expected.safeAddress);
    const { confirmations, groups } = await assembleAccountApprovals(expected.chainId, authority, proposal, source.signatures);
    const paths = actorWallet ? approvalPaths(authority, actorWallet).map(path => ({ path, labels: path.map(a => source.accountNames.find(n => n.address === a)?.name ?? `${a.slice(0, 8)}…${a.slice(-6)}`), approved: source.signatures.some(s => s.owner === actorWallet.toLowerCase() && s.pathKey === path.join(':')) })) : [];
    return { ...proposal.safeTransactionData, safe: proposal.safeAddress, confirmations, atBlock: BigInt(authority.blockNumber), workspace: { groups, paths, names: source.accountNames } };
  }
  const response = await fetch(`${getSafeTxServiceUrl(expected.chainId)}/v2/multisig-transactions/${expected.safeTxHash}/`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Could not retrieve the saved account proposal. Please retry.');
  return await response.json() as SafeProposal;
}
