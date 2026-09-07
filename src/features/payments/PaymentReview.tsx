import { userErrorMessage } from '@/lib/userErrors';
import { AccountCancellation } from "@/components/payments/AccountCancellation";
import { PaymentRecovery } from './PaymentRecovery';
import { paymentStatus } from '../../../shared/paymentQueue';
import { ApprovalPathReview } from './ApprovalPathReview';
import { paymentDebits } from '../../../shared/executionFee';
import { RELAY_FEATURE_ENABLED } from "@/lib/relayConfig";
import { DelegatedPayment } from "./DelegatedPayment";
import { screeningReviewKey } from "../../../shared/screeningReview";
import { PaymentBatchForm } from "@/components/payments/PaymentBatchForm";
import { useState } from "react";
import { Link } from 'react-router-dom';
import { useQuery as useRemoteQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  CalendarDays,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import {
  getChainName,
  getSafeAppUrl,
  getBlockExplorerTxUrl,
} from "@/lib/chains";
import { formatDate, formatMoney } from "@/lib/formatMoney";
import { Dialog } from "@/components/ui/Dialog";
import {
  LoadingRows,
  Notice,
  StatusBadge,
} from "@/components/workspace/WorkspacePrimitives";
import { usePaymentActions } from "./usePaymentActions";

export function PaymentReview({
  id,
  orgId,
  safes,
  org,
  canManage,
  onClose,
}: {
  id: Id<"disbursements">;
  orgId: Id<"orgs">;
  safes: Doc<"safes">[] | undefined;
  org: Doc<"orgs"> | null | undefined;
  canManage: boolean;
  onClose: () => void;
}) {
  const sessionToken = useSessionToken();
  const payment = useQuery(
    api.disbursements.getWithRecipients,
    sessionToken ? { disbursementId: id, sessionToken } : "skip",
  );
  const recovery = useQuery(api.relayJobs.paymentStatus, sessionToken ? { disbursementId: id, sessionToken } : "skip");
  const screening = useQuery(
    api.screeningQueries.checkDisbursementRecipients,
    sessionToken ? { disbursementId: id, sessionToken } : "skip",
  );
  const feeQuote = useQuery(api.relayQuotes.preview,
    RELAY_FEATURE_ENABLED && sessionToken ? { disbursementId: id, sessionToken } : "skip");
  const [usingAllowance, setUsingAllowance] = useState(false);
  const [allowanceFeeMode, setAllowanceFeeMode] = useState<"managed" | "wallet">(RELAY_FEATURE_ENABLED ? "managed" : "wallet");
  const displayedFee = payment?.executionFee ?? ((!usingAllowance || allowanceFeeMode === "managed") && payment && ["draft", "pending"].includes(payment.status) && !payment.safeTxHash ? feeQuote?.fee : undefined);
  const [reviewedFee, setReviewedFee] = useState("");
  const feeBlocked = RELAY_FEATURE_ENABLED && (!feeQuote?.identity || reviewedFee !== feeQuote.identity);
  const [screeningAcknowledged, setScreeningAcknowledged] = useState("");
  const reviewKey = screening ? screeningReviewKey(screening.flagged) : "";
  const screeningBlocked =
    !!payment?.payoutReviewError ||
    !screening ||
    (!!screening.flagged.length &&
      (screening.enforcement === "block" ||
        (screening.enforcement === "warn" &&
          screeningAcknowledged !== reviewKey)));
  const actions = usePaymentActions(safes, org);
  const { address } = useAccount();
  const fetchApprovals = useAction(api.paymentExecution.approvalStatus);
  const members = useQuery(
    api.orgs.listMembers,
    sessionToken ? { orgId, sessionToken } : "skip",
  );
  const approvals = useRemoteQuery({
    queryKey: [
      "payment-approvals",
      id,
      payment?.safeTxHash,
      actions.message,
      sessionToken,
    ],
    queryFn: () =>
      fetchApprovals({ disbursementId: id, sessionToken: sessionToken! }),
    enabled:
      !!sessionToken &&
      !!payment?.safeTxHash &&
      !payment.cancellationId &&
      ["proposed", "scheduled"].includes(payment.status),
    refetchInterval: 15000,
    retry: 1,
  });
  const currentOwner =
    !!address && (approvals.data?.workspace ? approvals.data.workspace.paths.length > 0 : approvals.data?.owners.includes(address.toLowerCase()));
  const alreadyApproved =
    !!address &&
    (approvals.data?.workspace ? approvals.data.workspace.paths.length > 0 && approvals.data.workspace.paths.every(p => p.approved) : approvals.data?.confirmedOwners.includes(address.toLowerCase()));
  const update = useMutation(api.disbursements.updateStatus);
  const reschedule = useMutation(api.disbursements.reschedule);
  const confirmReceipt = useAction(api.paymentExecution.confirm);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changingDate, setChangingDate] = useState(false);
  const [date, setDate] = useState("");
  const [receiptHash, setReceiptHash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const safe = safes?.find((s) => s._id === payment?.safeId);
  const approvalThreshold = approvals.data?.threshold ?? safe?.threshold;
  const approverName = (owner: string) =>
    approvals.data?.workspace?.names.find(n => n.address === owner)?.name ||
    members?.find(member => member?.walletAddress.toLowerCase() === owner)?.name ||
    `${owner.slice(0, 8)}…${owner.slice(-6)}`;
  const mutate = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
      setConfirmCancel(false);
      setChangingDate(false);
    } catch (e) {
      setError(userErrorMessage(e, "Could not update payment"));
    } finally {
      setBusy(false);
    }
  };
  const rows =
    payment?.type === "batch"
      ? payment.recipients.map((r) => ({
          id: r._id,
          name: r.recipientName ?? r.beneficiary?.name ?? "Recipient",
          address: r.recipientAddress,
          amount: r.amount,
        }))
      : payment
        ? [
            {
              id: payment._id,
              name:
                payment.recipientName ??
                payment.beneficiary?.name ??
                "Recipient",
              address:
                payment.recipientAddress ??
                payment.beneficiary?.walletAddress ??
                "",
              amount: payment.amount ?? "0",
            },
          ]
        : [];
  const locked = busy || actions.busy;
  if (editing && payment && payment.chainId)
    return (
      <PaymentBatchForm
        orgId={orgId}
        draft={{
          id: payment._id,
          name: payment.name || payment.memo || "Payment batch",
          purpose: payment.purpose ?? "other",
          chainId: payment.chainId,
          safeId: payment.safeId,
          token: payment.token,
          payDate: payment.scheduledAt,
          recipients: payment.recipients,
        }}
        onClose={() => setEditing(false)}
      />
    );
  return (
    <Dialog
      title="Payment details"
      onClose={() => {
        if (!locked) onClose();
      }}
    >
      {payment === undefined ? (
        <LoadingRows />
      ) : !payment || payment.orgId !== orgId ? (
        <div className="p-6">
          <Notice>This payment is not available in this workspace.</Notice>
        </div>
      ) : (
        <div className="space-y-6 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                {payment.name ||
                  payment.memo ||
                  payment.recipientName ||
                  payment.beneficiary?.name ||
                  "Payment batch"}
              </h2>
              <p className="workspace-description">
                Created {formatDate(payment.createdAt)} · {rows.length}{" "}
                recipient{rows.length === 1 ? "" : "s"}
              </p>
            </div>
            <StatusBadge {...paymentStatus(payment)} {...(recovery?.status === 'exception' ? { status: 'failed' } : {})} />
          </div>
          {(error || actions.error) && (
            <Notice>{error || actions.error}</Notice>
          )}
          {payment.status === 'failed' && payment.relayError && <Notice>{userErrorMessage(payment.relayError, 'This payment failed. Review its original receipt before preparing another payment.')}</Notice>}
          {payment.executionFailure && canManage && <Link className="workspace-button workspace-button-primary" to={`/org/${orgId}/disbursements?new=1`} onClick={onClose}>New payment</Link>}
          {payment.payoutReviewError && <Notice>{payment.payoutReviewError}</Notice>}
          {actions.message && <Notice tone="success">{actions.message}</Notice>}
          {actions.approvalRequest && <ApprovalPathReview key={actions.approvalRequest.paths.map(p => p.path.join(':')).join('|')} paths={actions.approvalRequest.paths} busy={actions.busy} onCancel={actions.dismissApproval} onApprove={path => { const r = actions.approvalRequest!; void actions.run(r.id, r.operation, r.acknowledgedScreening, r.reviewedFeeIdentity, path); }} />}
          <dl className="workspace-detail-grid payment-review-summary rounded-lg border border-white/10 p-5">
            <div>
              <dt>Recipient total</dt>
              <dd className="!text-2xl font-semibold tabular-nums whitespace-nowrap overflow-x-auto">
                {formatMoney(
                  payment.totalAmount ?? payment.amount ?? "0",
                  payment.token,
                  true,
                )}{" "}
                <span className="text-xs font-normal text-slate-400">
                  {payment.token}
                </span>
              </dd>
            </div>
            {displayedFee && <div>
              <dt>Total account debit</dt>
              <dd className="font-semibold tabular-nums">
                {paymentDebits(payment.token, payment.totalAmount ?? payment.amount ?? '0', displayedFee ?? undefined).map(total => <span key={total.token} className="block whitespace-nowrap overflow-x-auto">{formatMoney(total.amount, total.token, true)} {total.token}</span>)}
                <span className="workspace-table-secondary">Includes the payment fee</span>
              </dd>
            </div>}
            <div>
              <dt>Pay date</dt>
              <dd>
                {payment.scheduledAt
                  ? formatDate(payment.scheduledAt)
                  : "As soon as approved"}
                {payment.scheduledAt && (
                  <span className="workspace-table-secondary">
                    {new Date(payment.scheduledAt).toLocaleTimeString(
                      undefined,
                      { hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
                    )}{" "}
                    UTC
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Funding account</dt>
              <dd>
                {safe?.name ?? (payment.chainId
                  ? getChainName(payment.chainId)
                  : "Original account")}
                {safe && (
                  <span className="workspace-table-secondary font-mono">
                    {safe.safeAddress.slice(0, 8)}…{safe.safeAddress.slice(-6)}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Approval requirements</dt>
              <dd>
                {usingAllowance || payment.allowanceExecution ? "Member spending allowance" : approvalThreshold
                  ? `${approvalThreshold} account approval${approvalThreshold === 1 ? "" : "s"}`
                  : "Managed by account owners"}
                <span className="workspace-table-secondary">
                  {usingAllowance || payment.allowanceExecution ? (displayedFee ? "The recipient payment and fee must fit your available allowance" : "The recipient payment must fit your available allowance") : approvals.data ? "Verified against the current account policy" : "Current owner permissions are checked before signing"}
                </span>
              </dd>
            </div>
          </dl>
          {payment.safeTxHash &&
            ["proposed", "scheduled"].includes(payment.status) && (
              <section
                aria-label="Payment approvals"
                className="rounded-lg border border-white/10 p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Approvals</h3>
                  <button
                    className="workspace-action-link"
                    disabled={approvals.isFetching}
                    onClick={() => void approvals.refetch()}
                  >
                    Refresh approvals
                  </button>
                </div>
                {approvals.isPending ? (
                  <p role="status" className="mt-3 text-sm text-slate-400">
                    Checking current account approvals…
                  </p>
                ) : approvals.isError ? (
                  <p role="alert" className="mt-3 text-sm text-red-400">
                    {userErrorMessage(approvals.error, "Could not load the account approvals. Try again shortly.")}
                  </p>
                ) : (
                  approvals.data && (
                    <>
                      <p className="mt-3 text-sm">
                        {approvals.data.confirmedOwners.length} of{" "}
                        {approvals.data.threshold} required approvals received
                      </p>
                      <ul className="mt-3 space-y-2 text-sm">
                        {approvals.data.owners.map((owner) => (
                          <li
                            key={owner}
                            className="flex justify-between gap-3"
                          >
                            <span>
                              {approverName(owner)}
                              {owner === address?.toLowerCase() ? " (you)" : ""}
                            </span>
                            <span className="text-slate-400">
                              {approvals.data.confirmedOwners.includes(owner)
                                ? "Approved"
                                : "Awaiting approval"}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {approvals.data.workspace?.groups.filter(g => g.path.length > 1).map(group => (
                        <section key={group.path.join(':')} aria-label={`${approverName(group.address)} approvals`} className="mt-4 rounded-lg border border-[var(--ws-border)] p-3">
                          <h4 className="font-medium">{approverName(group.address)}</h4>
                          <p className="workspace-description !text-sm">{group.confirmedOwners.length} of {group.threshold} approvals received. Once complete, these count as one approval for {approverName(group.path[group.path.length - 2])}.</p>
                          <ul className="mt-2 space-y-1 text-sm">{group.owners.map(owner => <li key={owner} className="flex justify-between gap-3"><span>{approverName(owner)}{owner === address?.toLowerCase() ? ' (you)' : ''}</span><span className="text-[var(--ws-muted)]">{group.confirmedOwners.includes(owner) ? 'Approved' : 'Awaiting approval'}</span></li>)}</ul>
                        </section>
                      ))}
                      {approvals.data.currentNonce <
                        approvals.data.proposalNonce && (
                        <p className="mt-3 text-sm text-amber-500">
                          An earlier payment or account change must complete
                          before this payment can be sent. You can approve it
                          now.
                        </p>
                      )}
                      {approvals.data.currentNonce >
                        approvals.data.proposalNonce && (
                        <p role="alert" className="mt-3 text-sm text-red-400">
                          This account transaction number has already been used.
                          Reconcile the payment before preparing another.
                        </p>
                      )}
                    </>
                  )
                )}
              </section>
            )}
          <div>
            <h3 className="mb-3 text-sm font-semibold">Recipients</h3>
            <ul className="sm:hidden divide-y divide-white/10 rounded-lg border border-white/10">
              {rows.map(row => <li key={row.id} className="p-3 space-y-2">
                <p className="font-medium">{row.name}</p>
                <p className="font-semibold tabular-nums whitespace-nowrap overflow-x-auto">{formatMoney(row.amount, payment.token, true)} <span className="text-xs font-normal">{payment.token}</span></p>
                <p className="font-mono text-xs text-slate-400 break-all">{row.address}</p>
              </li>)}
            </ul>
            <div className="hidden sm:block max-h-64 overflow-auto rounded-lg border border-white/10">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Saved payout address</th>
                    <th className="numeric">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>
                        <span className="font-mono text-xs" title={row.address}>
                          {row.address.slice(0, 8)}…{row.address.slice(-6)}
                        </span>
                      </td>
                      <td className="numeric">
                        {formatMoney(row.amount, payment.token, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {!!screening?.flagged.length && screening.enforcement !== "off" && (
            <Notice tone="info">
              <p className="font-semibold">Screening review needed</p>
              <ul className="mt-2 space-y-2">
                {screening.flagged.map((r) => <li key={r.beneficiaryId}>
                  <strong>{r.beneficiaryName}</strong>: {r.reason}
                </li>)}
              </ul>
              {screening.enforcement === "block" ? (
                <p>
                  Resolve these results from Recipients before approving or
                  sending.
                </p>
              ) : (
                <label className="mt-3 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={screeningAcknowledged === reviewKey}
                    onChange={(e) =>
                      setScreeningAcknowledged(
                        e.target.checked ? reviewKey : "",
                      )
                    }
                  />
                  <span>
                    I have reviewed these screening warnings and want to
                    continue.
                  </span>
                </label>
              )}
            </Notice>
          )}
          {RELAY_FEATURE_ENABLED && !usingAllowance && ["draft", "pending"].includes(payment.status) && !payment.safeTxHash && (
            <section className="workspace-card p-4 space-y-3">
              <h3 className="font-semibold">Payment fee</h3>
              {!feeQuote ? <p>Loading payment fee…</p> : feeQuote.error ? <Notice>{feeQuote.error}</Notice> : feeQuote.fee && (
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" checked={reviewedFee === feeQuote.identity} onChange={e => setReviewedFee(e.target.checked ? feeQuote.identity! : "")} />
                  <span>I approve a {feeQuote.fee.amount} {feeQuote.fee.token} payment fee. This is added to the recipient total and paid only if the payment succeeds.</span>
                </label>
              )}
            </section>
          )}
          {payment.preparedProposalAt && ['draft', 'pending'].includes(payment.status) && <Notice tone="info">Your signed proposal is saved. Resume preparation to restore it to the approval queue. This reuses the same transaction and does not request another signature.</Notice>}
          {payment.executionFee && payment.safeTxHash && <p className="text-sm text-[var(--ws-muted)]">Approved payment fee: {payment.executionFee.amount} {payment.executionFee.token}</p>}
          {payment.status === "proposed" &&
            payment.scheduledAt &&
            payment.scheduledAt > Date.now() && (
              <Notice tone="info">
                Manual execution sends this payment immediately, before its
                recorded pay date. Use a scheduled instruction for automatic
                execution later.
              </Notice>
            )}
          {canManage &&
            rows.length > 0 &&
            ((payment.status === "draft" && !payment.safeTxHash) ||
              (payment.status === "relaying" &&
                payment.allowanceExecution)) && (
              <DelegatedPayment
                payment={payment}
                blocked={screeningBlocked || actions.busy}
                onBusyChange={setBusy}
                onModeChange={setUsingAllowance}
                onFeeModeChange={setAllowanceFeeMode}
              />
            )}
          <PaymentRecovery id={id} canManage={canManage} payment={payment} retryDisabled={locked || screeningBlocked} onRetryNative={payment.allowanceExecution ? undefined : () => void actions.run(id, 'execute', screeningAcknowledged)} />
          {payment.relayError && payment.status !== 'failed' && !recovery && !payment.nativeExecution && <Notice>{userErrorMessage(payment.relayError, 'This payment needs review. Check its original settlement before trying again.')}</Notice>}
          {payment.status === "scheduled" && (
            <Notice tone="info">
              This payment is scheduled. Complete all required owner signatures
              before its pay date. Signing now does not send it early.
            </Notice>
          )}
          {payment.status === "relaying" && !recovery && !payment.nativeExecution && (
            <Notice tone="info">
              Submission is being reconciled. Do not create a replacement
              payment while the outcome is uncertain.
            </Notice>
          )}
          {payment.safeTxHash && (confirmCancel || payment.cancellationId || payment.status === 'cancelled' && !payment.cancellationConfirmedAt) && <AccountCancellation disbursementId={id} initiallyOpen memberName={wallet => members?.find(m => m?.walletAddress.toLowerCase() === wallet.toLowerCase())?.name || `${wallet.slice(0, 8)}…${wallet.slice(-6)}`} onBack={() => setConfirmCancel(false)} />}
          {confirmCancel && !payment.safeTxHash && payment.status !== 'cancelled' && <div className="space-y-4 rounded-lg border border-[var(--ws-border)] p-4">
            <p className="text-sm">Cancel this payment? It will leave the approval queue and release its budget reservation. No network fee applies.</p>
            <div className="flex flex-wrap gap-2"><button className="workspace-button" disabled={locked} onClick={() => setConfirmCancel(false)}>Keep payment</button><button className="workspace-button" disabled={locked} onClick={() => void mutate(() => update({ disbursementId: id, sessionToken: sessionToken!, status: 'cancelled' }))}>Confirm cancellation</button></div>
          </div>}
          {changingDate && (
            <div className="rounded-lg border border-white/10 p-4">
              <label>
                <span className="finance-label">
                  New payment date and time · local time
                </span>
                <input
                  className="finance-field"
                  type="datetime-local"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <button
                className="workspace-button mt-3"
                disabled={locked || !date}
                onClick={() =>
                  void mutate(() =>
                    reschedule({
                      disbursementId: id,
                      sessionToken: sessionToken!,
                      newScheduledAt: new Date(date).getTime(),
                    }),
                  )
                }
              >
                Save pay date
              </button>
            </div>
          )}
          {payment.safeTxHash && safe && (
            <a
              className="workspace-action-link"
              href={getSafeAppUrl(safe.chainId, safe.safeAddress)}
              target="_blank"
              rel="noreferrer"
            >
              Advanced account details in Safe
              <ExternalLink size={13} />
            </a>
          )}
          {payment.txHash && payment.chainId && (
            <a
              className="workspace-action-link"
              href={getBlockExplorerTxUrl(payment.chainId, payment.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              View settlement receipt
              <ExternalLink size={13} />
            </a>
          )}
          {canManage &&
            !payment.executionFailure &&
            payment.safeTxHash &&
            ["proposed", "relaying", "failed", "scheduled"].includes(
              payment.status,
            ) && (
              <details className="border-t border-white/10 pt-4">
                <summary className="cursor-pointer text-xs text-slate-400">
                  Already executed outside Disburse? Verify a receipt
                </summary>
                <div className="mt-3 flex gap-2">
                  <input
                    aria-label="Settlement transaction hash"
                    className="finance-field font-mono"
                    placeholder="0x transaction hash"
                    value={receiptHash}
                    onChange={(e) => setReceiptHash(e.target.value)}
                  />
                  <button
                    className="workspace-button"
                    disabled={locked || !receiptHash}
                    onClick={() =>
                      void mutate(() =>
                        confirmReceipt({
                          disbursementId: id,
                          sessionToken: sessionToken!,
                          txHash: receiptHash.trim(),
                        }),
                      )
                    }
                  >
                    Verify
                  </button>
                </div>
              </details>
            )}
          {!actions.approvalRequest && !payment.cancellationId && !payment.executionFailure && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
            <div>
              {canManage &&
                [
                  "draft",
                  "pending",
                  "proposed",
                  "scheduled",
                  "failed",
                ].includes(payment.status) && (
                  <button
                    className="workspace-button"
                    disabled={locked}
                    onClick={() => setConfirmCancel(true)}
                  >
                    Cancel payment
                  </button>
                )}
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage &&
                payment.status === "draft" &&
                payment.type === "batch" &&
                payment.purpose !== "invoice" &&
                !payment.safeTxHash && (
                  <button
                    className="workspace-button"
                    disabled={locked}
                    onClick={() => setEditing(true)}
                  >
                    Edit draft
                  </button>
                )}
              {canManage && payment.status === "scheduled" && (
                <button
                  className="workspace-button"
                  disabled={locked}
                  onClick={() => setChangingDate((v) => !v)}
                >
                  <CalendarDays size={14} />
                  Change date
                </button>
              )}
              {canManage &&
                ["proposed", "scheduled"].includes(payment.status) && (
                  <button
                    className="workspace-button"
                    disabled={
                      locked ||
                      screeningBlocked ||
                      !currentOwner ||
                      alreadyApproved ||
                      (approvals.data?.currentNonce ?? 0) >
                        (approvals.data?.proposalNonce ?? 0)
                    }
                    onClick={() =>
                      void actions.run(id, "approve", screeningAcknowledged)
                    }
                  >
                    <ShieldCheck size={14} />
                    {alreadyApproved ? "Approved by you" : "Approve"}
                  </button>
                )}
              {canManage && payment.preparedProposalAt && ['draft', 'pending'].includes(payment.status) && (
                <button className="workspace-button workspace-button-primary" disabled={locked || screeningBlocked || !safe} onClick={() => void actions.run(id, 'resumeProposal', screeningAcknowledged)}>{actions.busy ? 'Resuming…' : 'Resume preparation'}</button>
              )}
              {canManage && !usingAllowance &&
                ["draft", "pending"].includes(payment.status) &&
                !payment.safeTxHash && (
                  <button
                    className="workspace-button workspace-button-primary"
                    disabled={locked || !safe || screeningBlocked || feeBlocked}
                    onClick={() =>
                      void actions.run(id, "propose", screeningAcknowledged, reviewedFee)
                    }
                  >
                    {actions.busy ? "Preparing…" : "Review in wallet"}
                    <ArrowUpRight size={14} />
                  </button>
                )}
              {canManage && payment.status === "proposed" && (
                <button
                  className="workspace-button workspace-button-primary"
                  disabled={
                    locked ||
                    !safe ||
                    screeningBlocked ||
                    !approvals.data?.ready
                  }
                  onClick={() =>
                    void actions.run(id, "execute", screeningAcknowledged)
                  }
                >
                  {actions.busy ? "Processing…" : "Send payment"}
                  <ArrowUpRight size={14} />
                </button>
              )}
            </div>
          </div>}
        </div>
      )}
    </Dialog>
  );
}
