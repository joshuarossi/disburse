import { walletDeclined } from '@/lib/walletErrors';
import { screeningReviewKey } from '../../../shared/screeningReview';
import { walletSendDeclined } from '../../../shared/paymentQueue';
import { useRef, useState } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { convex } from '@/lib/convex';
import { useSessionToken } from '@/lib/session';
import { RELAY_FEATURE_ENABLED, resolveRelaySettings } from '@/lib/relayConfig';


type Operation = 'propose' | 'execute' | 'approve' | 'resumeProposal';
type ApprovalRequest = { id: Id<'disbursements'>; operation: Operation; acknowledgedScreening: string; reviewedFeeIdentity: string; paths: Array<{ path: string[]; labels: string[]; approved: boolean }> };
/** Every payment uses the same persisted workspace approval flow. */
export function usePaymentActions(safes: Doc<'safes'>[] | undefined, org: Doc<'orgs'> | null | undefined) {
  const sessionToken = useSessionToken();
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [busy, setBusy] = useState(false), lock = useRef(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const run = async (id: Id<'disbursements'>, operation: Operation, acknowledgedScreening = '', reviewedFeeIdentity = '', selectedPath?: string[]) => {
    if (!sessionToken || !address || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    let savedHash: string | undefined, claimed = false;
    const identity = { disbursementId: id, sessionToken };
    try {
      const payment = await convex.query(api.disbursements.getWithRecipients, identity);
      if (!payment || payment.orgId !== org?._id) throw new Error('Payment not found in this workspace');
      if (payment.payoutReviewError) throw new Error(payment.payoutReviewError);
      const safe = safes?.find(s => s._id === payment.safeId);
      if (!safe || !payment.chainId) throw new Error('Link the original funding account before continuing');
      const screening = await convex.query(api.screeningQueries.checkDisbursementRecipients, identity);
      if (screening.flagged.length && screening.enforcement === 'block') throw new Error('One or more recipients need screening review. Resolve their screening results before continuing.');
      if (screening.flagged.length && screening.enforcement === 'warn' && acknowledgedScreening !== screeningReviewKey(screening.flagged)) throw new Error('Review and acknowledge the current screening warnings before continuing.');
      if (chainId !== payment.chainId) await switchChainAsync({ chainId: payment.chainId });
      if (payment.safeTxHash && payment.approvalMethod !== 'workspace') await convex.action(api.accountApprovals.recoverOriginal, identity);
      const saveApproval = async () => {
        const request = await convex.action(api.accountApprovals.forSigning, identity);
        const paths = request.paths.filter(p => !p.approved);
        if (!paths.length) return request.proposal.safeTxHash;
        if (!selectedPath && (paths.length > 1 || paths[0].path.length > 1)) {
          setApprovalRequest({ id, operation, acknowledgedScreening, reviewedFeeIdentity, paths });
          return null;
        }
        const path = selectedPath ?? paths[0].path;
        if (!paths.some(p => p.path.join(':') === path.join(':'))) throw new Error('Your approval path changed. Review the account requirements again.');
        const { signAccountApproval } = await import('@/lib/accountApproval');
        const signature = await signAccountApproval(payment.chainId!, address, request.proposal, path);
        const hash = await convex.action(api.accountApprovals.save, { ...identity, proposal: request.proposal, path, signature });
        setApprovalRequest(null);
        return hash;
      };
      if (operation === 'propose' || operation === 'resumeProposal') {
        let hash: string, fee = payment.executionFee;
        if (operation === 'resumeProposal') {
          if (!payment.safeTxHash) throw new Error('No saved approval was found');
          hash = payment.safeTxHash;
        } else {
          if (!['draft', 'pending'].includes(payment.status) || payment.safeTxHash) throw new Error('This payment already has a proposal. Resume the original payment.');
          await convex.mutation(api.disbursements.updateStatus, { ...identity, status: 'pending' });
          fee = RELAY_FEATURE_ENABLED ? await convex.mutation(api.relayQuotes.accept, { ...identity, reviewedIdentity: reviewedFeeIdentity }) : undefined;
          if (fee) await convex.action(api.relayExecutor.checkFee, { ...identity, reviewedIdentity: reviewedFeeIdentity });
          const result = await saveApproval();
          if (!result) return;
          hash = result;
        }
        savedHash = hash;
        const fields = { ...identity, safeTxHash: hash, relayFeeToken: fee?.tokenAddress, relayFeeTokenSymbol: fee?.token, relayFeeMode: resolveRelaySettings(org).relayFeeMode };
        if (RELAY_FEATURE_ENABLED && payment.scheduledAt && payment.scheduledAt > Date.now()) await convex.mutation(api.disbursements.schedule, { ...fields, scheduledAt: payment.scheduledAt });
        else await convex.mutation(api.disbursements.updateStatus, { ...fields, status: 'proposed' });
        setMessage('Payment prepared. Account approvers can review and approve it here before the pay date.');
      } else if (operation === 'approve') {
        if (!payment.safeTxHash || !['proposed', 'scheduled'].includes(payment.status)) throw new Error('No proposal is ready for approval');
        await convex.action(api.paymentExecution.verifyProposal, { ...identity, requireSignatures: false });
        if (!await saveApproval()) return;
        setMessage('Your approval is saved. The current account requirements determine when the payment can be sent.');
      } else {
        const retryRejected = walletSendDeclined(payment);
        if (!payment.safeTxHash || (payment.status !== 'proposed' && !retryRejected)) throw new Error('Only an approved proposal can be sent from this flow.');
        await convex.action(api.paymentExecution.verifyProposal, { ...identity, requireSignatures: true });
        if (payment.executionFee) {
          await convex.action(api.relayExecutor.submit, identity);
        } else {
          const transaction = await convex.action(api.accountApprovals.execution, identity);
          const attempt = await convex.action(api.nativePayments.start, { ...identity, safeTxHash: payment.safeTxHash });
          claimed = true;
          let txHash: string;
          try {
            txHash = await (await import('@/lib/accountApproval')).sendApprovedAccountPayment(payment.chainId, address, transaction);
          } catch (error) {
            if (!walletDeclined(error)) throw error;
            await convex.mutation(api.nativePayments.walletRejected, { ...identity, attemptId: attempt.attemptId });
            setMessage('Wallet approval declined. Your payment approvals are saved. Retry the original payment when you are ready.');
            return;
          }
          await convex.mutation(api.disbursements.updateStatus, { ...identity, status: 'relaying', txHash, relayStatus: 'submitted' });
        }
        setMessage('Payment submitted. Settlement will be verified before it is marked paid.');
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Could not complete this action';
      setError(savedHash ? `Your signed proposal is saved. Use Resume preparation to continue with the same transaction. ${detail}` : claimed ? `We saved the original payment and will check its settlement. Use Check settlement to refresh its status. ${detail}` : detail);
    } finally { lock.current = false; setBusy(false); }
  };
  return { run, busy, error, message, approvalRequest, dismissApproval: () => setApprovalRequest(null), clear: () => { setError(''); setMessage(''); } };
}
