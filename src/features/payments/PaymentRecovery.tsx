import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { userErrorMessage } from "@/lib/userErrors";
import { useState } from "react";
import { walletSendDeclined } from "../../../shared/paymentQueue";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";

export function PaymentRecovery({
  id,
  canManage,
  payment,
  onRetryNative,
  retryDisabled = false,
}: {
  id: Id<"disbursements">;
  canManage: boolean;
  payment?: Doc<"disbursements">;
  onRetryNative?: () => void;
  retryDisabled?: boolean;
}) {
  useWorkspaceLanguage();
  const sessionToken = useSessionToken();
  const managed = useQuery(
    api.relayJobs.paymentStatus,
    sessionToken ? { disbursementId: id, sessionToken } : "skip",
  );
  const native =
    payment?.nativeExecution && payment.status === "relaying"
      ? payment
      : undefined;
  const status =
    managed ??
    (native
      ? {
          status:
            native.relayStatus === "Needs investigation"
              ? "exception"
              : "submitted",
          canResume: false,
          error: native.relayError,
        }
      : null);
  const resume = useMutation(api.relayJobs.resume);
  const recheck = useMutation(api.relayJobs.recheck);
  const recheckNative = useMutation(api.nativePayments.recheck);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const declined = !!native && walletSendDeclined(native);
  const reverted = !!native?.nativeExecution?.revertedAt && !native.txHash;
  if (!status || status.status === "confirmed" || status.status === "failed")
    return null;
  return (
    <section
      className="rounded-lg border border-[var(--ws-border)] p-4 space-y-3"
      aria-label={tx("Payment recovery")}
    >
      <h3 className="text-sm font-semibold">
        {reverted
          ? tx("Transaction reverted")
          : declined
            ? tx("Wallet approval declined")
            : status.status === "exception"
              ? tx("Payment needs attention")
              : tx("Tracking your payment")}
      </h3>
      <p className="text-sm text-[var(--ws-muted)]">
        {reverted
          ? tx(
              "The network transaction reverted. The original authorization is saved for review and retry.",
            )
          : declined
            ? tx(
                "The wallet declined the send request. Your original payment authorization is saved.",
              )
            : ((status.error
                ? userErrorMessage(
                    status.error,
                    "We could not verify settlement. Check the original payment again.",
                  )
                : undefined) ??
              (native
                ? tx(
                    "We are checking whether your approved payment settled on the network.",
                  )
                : tx(
                    "The payment service is processing your approved payment.",
                  )))}
      </p>
      {declined && canManage && onRetryNative && (
        <button
          className="workspace-button workspace-button-primary"
          disabled={busy || retryDisabled}
          onClick={onRetryNative}
        >
          {tx("Retry original payment")}
        </button>
      )}
      <p className="text-xs text-[var(--ws-muted)]">
        {status.canResume
          ? tx(
              "No submission was attempted. Resume sends the payment and fee you already approved.",
            )
          : tx(
              "Check the original submission before preparing a replacement. Checking settlement does not send another payment.",
            )}
      </p>
      {canManage && status.status !== "prepared" && (
        <button
          className="workspace-button"
          disabled={busy}
          onClick={async () => {
            if (!sessionToken || busy) return;
            setBusy(true);
            setMessage("");
            try {
              await (
                native ? recheckNative : status.canResume ? resume : recheck
              )({ disbursementId: id, sessionToken });
              setMessage(
                status.canResume
                  ? "Submission resumed. This payment will update when verification completes."
                  : "Settlement check requested. This payment will update when verification completes.",
              );
            } catch (error) {
              setMessage(
                userErrorMessage(error, "Could not check settlement."),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? tx("Working…")
            : status.canResume
              ? tx("Resume payment")
              : tx("Check settlement")}
        </button>
      )}
      {message && (
        <p role="status" className="text-sm">
          {tx(message)}
        </p>
      )}
    </section>
  );
}
