import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Dialog } from "@/components/ui/Dialog";
import {
  LoadingRows,
  Notice,
} from "@/components/workspace/WorkspacePrimitives";
import { getChainName } from "@/lib/chains";
import type { PayoutDetails } from "../../../shared/recipientAssurance";

function Instructions({
  details,
  label,
}: {
  details: PayoutDetails;
  label: string;
}) {
  return (
    <section className="rounded-xl border border-white/10 p-4 space-y-2">
      <h3 className="text-sm font-semibold">{label}</h3>
      <p className="break-all font-mono text-sm leading-6">
        {details.walletAddress || "No address saved"}
      </p>
      <p className="text-sm text-slate-400">
        {details.preferredToken ?? "Currency chosen per payment"} ·{" "}
        {details.preferredChainId
          ? getChainName(details.preferredChainId)
          : "Network chosen per payment"}
      </p>
    </section>
  );
}

export function PayoutReview({
  beneficiaryId,
  onClose,
}: {
  beneficiaryId: Id<"beneficiaries">;
  onClose: () => void;
}) {
  const sessionToken = useSessionToken();
  const review = useQuery(
    api.recipientReviews.get,
    sessionToken ? { beneficiaryId, sessionToken } : "skip",
  );
  const request = useMutation(api.recipientReviews.request);
  const decide = useMutation(api.recipientReviews.decide);
  const withdraw = useMutation(api.recipientReviews.withdraw);
  const [method, setMethod] = useState<
    "known_contact" | "in_person" | "verified_portal"
  >("known_contact");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (operation: () => Promise<unknown>, close = true) => {
    if (busy || !sessionToken) return;
    setBusy(true);
    setError("");
    try {
      await operation();
      if (close) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the review");
    } finally {
      setBusy(false);
    }
  };
  const pending = review?.pending;
  return (
    <Dialog
      title="Review payout details"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {!review ? (
        <LoadingRows />
      ) : (
        <div className="space-y-5 p-6">
          <div>
            <h2 className="text-xl font-semibold">{review.recipient.name}</h2>
            <p className="workspace-description">
              Confirm the complete address, currency and network using contact
              details you already trust. Incoming transfers and copied
              transaction history are not proof of ownership.
            </p>
          </div>
          {error && <Notice>{error}</Notice>}
          {!pending ? (
            <>
              <Instructions
                details={review.recipient}
                label={
                  review.recipient.payoutReviewStatus === "approved"
                    ? "Approved payout instructions"
                    : "Saved payout instructions · review needed"
                }
              />
              {review.recipient.payoutReviewStatus !== "approved" && (
                <Notice tone="info">
                  Existing recipient records need a first review before their
                  next payment. Previously settled payments stay in your
                  history.
                </Notice>
              )}
              {review.canRequest &&
                review.recipient.isActive &&
                review.recipient.walletAddress &&
                review.recipient.payoutReviewStatus !== "approved" && (
                  <button
                    className="workspace-button workspace-button-primary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          request({
                            beneficiaryId,
                            sessionToken: sessionToken!,
                          }),
                        false,
                      )
                    }
                  >
                    Request payout review
                  </button>
                )}
            </>
          ) : (
            <>
              {pending.collectionId && (
                <Notice tone="info">
                  These details were submitted through a recipient link. Confirm
                  them using your established contact details before approval;
                  the link does not verify who submitted them or who controls
                  the address.
                </Notice>
              )}
              {pending.baseVersion > 0 && (
                <Instructions
                  details={pending.before}
                  label="Currently approved instructions"
                />
              )}
              <Instructions
                details={pending.proposed}
                label={
                  pending.baseVersion
                    ? "Proposed replacement"
                    : "Payout instructions to verify"
                }
              />
              {!!review.lookalikes.length && (
                <Notice>
                  This address has the same beginning and ending as the saved
                  address for {review.lookalikes.join(", ")}. Compare every
                  character and confirm it through your trusted contact.
                </Notice>
              )}
              <Notice tone="info">
                Payments to this recipient are on hold during review. Approving
                changed details requires new payments and new approvals.
              </Notice>
              <details className="text-sm text-slate-400">
                <summary className="cursor-pointer">
                  If a payment has already been signed
                </summary>
                <p className="mt-2">
                  Previously signed Safe transactions remain valid on-chain
                  until executed or cancelled by the account owners. This review
                  prevents their use through Disburse.
                </p>
              </details>
              {review.independentRequired && review.isRequester && (
                <Notice tone="info">
                  Another approver must review this request because you
                  submitted the details.
                </Notice>
              )}
              {review.canDecide &&
                !review.independentRequired &&
                review.isRequester && (
                  <p className="text-sm text-slate-400">
                    You are the only available approver. Record how you verified
                    these details independently with the recipient.
                  </p>
                )}
              {(review.canDecide || review.canWithdraw) && (
                <>
                  {review.canDecide && (
                    <label className="block">
                      <span className="finance-label">
                        Verification channel
                      </span>
                      <select
                        className="finance-field"
                        value={method}
                        onChange={(e) =>
                          setMethod(e.target.value as typeof method)
                        }
                        disabled={busy}
                      >
                        <option value="known_contact">
                          Known contact · call or established channel
                        </option>
                        <option value="in_person">Confirmed in person</option>
                        <option value="verified_portal">
                          Previously verified recipient portal
                        </option>
                      </select>
                    </label>
                  )}
                  <label className="block">
                    <span className="finance-label">Review note</span>
                    <textarea
                      className="finance-field min-h-24"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Who confirmed the instructions, when, and through which established channel? Do not include passwords or private keys."
                      minLength={10}
                      maxLength={1000}
                      disabled={busy}
                    />
                  </label>
                  {review.canDecide && (
                    <label className="flex items-start gap-3 text-sm leading-6">
                      <input
                        type="checkbox"
                        className="mt-1.5"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        disabled={busy}
                      />
                      <span>
                        I verified the full instructions with the recipient
                        through the independent channel above.
                      </span>
                    </label>
                  )}
                  <div className="flex flex-wrap justify-end gap-3">
                    {review.canWithdraw && (
                      <button
                        className="workspace-button"
                        disabled={busy || reason.trim().length < 10}
                        onClick={() =>
                          void run(() =>
                            withdraw({
                              changeId: pending._id,
                              sessionToken: sessionToken!,
                              reason,
                            }),
                          )
                        }
                      >
                        Withdraw request
                      </button>
                    )}
                    {review.canDecide && (
                      <>
                        <button
                          className="workspace-button"
                          disabled={busy || reason.trim().length < 10}
                          onClick={() =>
                            void run(() =>
                              decide({
                                changeId: pending._id,
                                sessionToken: sessionToken!,
                                decision: "rejected",
                                reason,
                              }),
                            )
                          }
                        >
                          Reject details
                        </button>
                        <button
                          className="workspace-button workspace-button-primary"
                          disabled={
                            busy || !confirmed || reason.trim().length < 10
                          }
                          onClick={() =>
                            void run(() =>
                              decide({
                                changeId: pending._id,
                                sessionToken: sessionToken!,
                                decision: "approved",
                                reason,
                                verificationMethod: method,
                                confirmedIndependently: confirmed,
                              }),
                            )
                          }
                        >
                          Approve payout details
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}
          {!!review.changes.filter((c) => c.status !== "pending").length && (
            <details className="border-t border-white/10 pt-4">
              <summary className="cursor-pointer text-sm">
                Review history
              </summary>
              <ul className="mt-4 space-y-3">
                {review.changes
                  .filter((c) => c.status !== "pending")
                  .map((c) => (
                    <li key={c._id} className="text-sm">
                      <strong className="capitalize">{c.status}</strong> ·{" "}
                      {new Date(c.reviewedAt ?? c.requestedAt).toLocaleString()}
                      <p className="text-slate-400">{c.reason}</p>
                      {c.collectionId && (
                        <p className="text-xs text-slate-400">
                          Submitted through a recipient link
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}
