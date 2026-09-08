import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { userErrorMessage } from "@/lib/userErrors";
import { scheduleDateTime } from "@/lib/formatMoney";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { CustomerPaidExecution } from "./CustomerPaidExecution";

export function ScheduledPayment({
  paymentId,
  payAt,
  blocked,
  canManage,
  memberName,
  onBusyChange,
}: {
  paymentId: Id<"disbursements">;
  payAt: number;
  blocked: boolean;
  canManage: boolean;
  memberName: (wallet: string) => string;
  onBusyChange: (busy: boolean) => void;
}) {
  const sessionToken = useSessionToken();
  const identity = { disbursementId: paymentId, sessionToken: sessionToken! };
  const schedule = useQuery(
    api.paymentSchedules.get,
    sessionToken ? identity : "skip",
  );
  const create = useMutation(api.paymentSchedules.create),
    stop = useMutation(api.paymentSchedules.stop),
    reset = useMutation(api.paymentSchedules.returnToDraft);
  const [busy, setBusy] = useState(false),
    lock = useRef(false),
    [error, setError] = useState(""),
    [confirmStop, setConfirmStop] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      await work();
      setConfirmStop(false);
    } catch (e) {
      setError(
        userErrorMessage(
          e,
          "The scheduled payment could not be updated. Its original authorization is saved.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };
  const terminal =
    !!schedule &&
    ["paid", "failed", "expired", "cancelled"].includes(schedule.status);
  return (
    <section
      className="space-y-4 rounded-xl border border-[var(--ws-border)] p-5"
      aria-label="Scheduled payment"
    >
      <div>
        <h3 className="font-semibold">Automatic payment</h3>
        <p className="mt-1 text-sm text-[var(--ws-muted)]">
          Pay on {scheduleDateTime(payAt)}. Your account pays the service fee in
          USDC.
        </p>
      </div>
      {error && <Notice>{error}</Notice>}
      {schedule === undefined && (
        <p role="status">Loading the saved schedule…</p>
      )}
      {schedule === null && (
        <>
          <p className="text-sm text-[var(--ws-muted)]">
            Approve the recipients, fee limit and pay date now. The payment can
            run within 24 hours of that date. Keep enough funds in the account;
            this approval does not reserve a balance.
          </p>
          {canManage && (
            <button
              className="workspace-button workspace-button-primary"
              disabled={busy || blocked || !sessionToken}
              onClick={() => void run(() => create(identity))}
            >
              {busy ? "Preparing…" : "Review scheduled payment"}
            </button>
          )}
        </>
      )}
      {schedule && (
        <>
          {schedule.status === "armed" && (
            <Notice tone="info">
              Scheduled for automatic payment. No further wallet confirmation is
              needed. We will check the current account approvals, recipient
              details and balance before sending.
            </Notice>
          )}
          {schedule.status === "paused" &&
            !schedule.cancellationRequestedAt && (
              <Notice>
                {userErrorMessage(
                  schedule.error,
                  "Automatic sending is paused. Review this payment and resume when the issue is resolved.",
                )}
              </Notice>
            )}
          {schedule.cancellationRequestedAt && !terminal && (
            <Notice tone="info">
              Automatic sending is paused. Complete the cancellation below to
              invalidate the signed payment. Pausing alone does not revoke its
              authorization.
            </Notice>
          )}
          {schedule.status === "cancelled" && (
            <Notice tone="info">This scheduled payment is cancelled.</Notice>
          )}
          {schedule.status !== "cancelled" &&
            !schedule.cancellationRequestedAt && (
              <CustomerPaidExecution
                source={{ paymentScheduleId: schedule._id }}
                ready={schedule.status === "review"}
                blocked={blocked || !canManage || busy}
                memberName={memberName}
                onBusyChange={onBusyChange}
                armed={schedule.status === "armed"}
                compact
              />
            )}
          {schedule.cancellationRequestedAt && schedule.status !== "paid" && (
            <CustomerPaidExecution
              source={{ scheduleCancellationId: schedule._id }}
              ready={!terminal}
              blocked={!canManage || busy}
              memberName={memberName}
              onBusyChange={onBusyChange}
              compact
            />
          )}
          {canManage &&
            !terminal &&
            schedule.status !== "processing" &&
            !schedule.cancellationRequestedAt &&
            !confirmStop && (
              <button
                className="workspace-button"
                disabled={busy}
                onClick={() => setConfirmStop(true)}
              >
                Cancel scheduled payment
              </button>
            )}
          {confirmStop && (
            <div className="space-y-3 border-t border-[var(--ws-border)] pt-4">
              <p className="text-sm">
                Stop this payment? If an execution approval has been signed,
                account owners must approve a cancellation and pay its network
                fee. An unsigned payment can be cancelled without a fee.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="workspace-button"
                  disabled={busy}
                  onClick={() => setConfirmStop(false)}
                >
                  Keep schedule
                </button>
                <button
                  className="workspace-button"
                  disabled={busy}
                  onClick={() => void run(() => stop(identity))}
                >
                  Continue cancellation
                </button>
              </div>
            </div>
          )}
          {canManage && terminal && schedule.status !== "paid" && (
            <button
              className="workspace-button"
              disabled={busy}
              onClick={() => void run(() => reset(identity))}
            >
              Return payment to draft
            </button>
          )}
        </>
      )}
    </section>
  );
}
