import { useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useQuery as useRemoteQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { api } from "../../../convex/_generated/api";
import type { CircleSource } from "../../../convex/lib/circleSource";
import { decodeCircleRequest } from "../../../shared/circleRequest";
import { useSessionToken } from "@/lib/session";
import { walletDeclined, walletErrorMessage } from "@/lib/walletErrors";
import { userErrorMessage } from "@/lib/userErrors";
import { scheduleDateTime } from "@/lib/formatMoney";
import { Notice } from "@/components/workspace/WorkspacePrimitives";

export function CustomerPaidExecution({
  source,
  ready,
  blocked,
  memberName,
  onBusyChange,
  compact = false,
  armed = false,
}: {
  source: CircleSource;
  ready: boolean;
  blocked: boolean;
  memberName: (wallet: string) => string;
  onBusyChange: (busy: boolean) => void;
  compact?: boolean;
  armed?: boolean;
}) {
  const subject = source.accountSetupId
    ? "account setup"
    : source.billingCheckoutId
      ? "subscription"
      : source.disbursementId || source.paymentScheduleId
        ? "payment"
        : source.policyChangeId
          ? "policy"
          : source.receivableId
            ? "collection"
            : source.receivingSetupSafeId
              ? "receiving setup"
              : "cancellation";
  const submitLabel = source.paymentScheduleId
    ? "Schedule payment"
    : subject === "account setup"
      ? "Create company account"
      : subject === "subscription"
        ? "Pay subscription"
        : subject === "payment"
          ? "Send payment"
          : subject === "policy"
            ? "Apply policy"
            : subject === "collection"
              ? "Collect invoice funds"
              : subject === "receiving setup"
                ? "Set up receiving"
                : "Confirm cancellation";
  const sessionToken = useSessionToken(),
    { address } = useAccount();
  const execution = useQuery(
    api.circlePayments.get,
    sessionToken ? { ...source, sessionToken } : "skip",
  );
  const prepare = useAction(api.circlePayments.prepare),
    approve = useAction(api.circlePayments.approve),
    advance = useAction(api.circlePayments.advance),
    submit = useAction(api.circlePayments.submit),
    recheck = useAction(api.circlePayments.recheck);
  const fetchApprovals = useAction(api.circlePayments.approvals);
  const [busy, setBusy] = useState(false),
    lock = useRef(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [consent, setConsent] = useState("");
  const approvals = useRemoteQuery({
    queryKey: [
      "circle-approvals",
      execution?._id,
      execution?.revision,
      execution?.updatedAt,
      sessionToken,
    ],
    queryFn: () =>
      fetchApprovals({
        executionId: execution!._id,
        sessionToken: sessionToken!,
      }),
    enabled:
      !blocked &&
      !armed &&
      !!sessionToken &&
      !!execution?.open &&
      ["fee", "operation", "ready"].includes(execution.stage),
    refetchInterval: 15_000,
    retry: 1,
  });
  let request,
    recordError = "";
  if (execution) {
    try {
      request = decodeCircleRequest(execution.record);
    } catch (e) {
      recordError = userErrorMessage(
        e,
        "The saved fee request could not be read. Check its status before creating another.",
      );
    }
  }
  const consentKey =
    execution && request
      ? `${execution._id}:${request.permit.amount}:${request.originalHash}`
      : "";
  const reviewed = !!consentKey && consent === consentKey;
  const expired = !!request && request.validUntil * 1000 <= Date.now();
  const run = async (work: () => Promise<unknown>, success?: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (success) setNotice(success);
    } catch (e) {
      if (walletDeclined(e))
        setNotice(
          `Wallet confirmation cancelled. Your ${subject} and saved approvals are unchanged.`,
        );
      else
        setError(
          walletErrorMessage(
            e,
            `Could not complete this step. Your original ${subject} is saved.`,
          ),
        );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };
  const identity =
    execution && sessionToken
      ? { executionId: execution._id, sessionToken }
      : null;
  return (
    <section
      className={`scroll-mt-24 space-y-4 ${compact ? "border-t border-[var(--ws-border)] pt-4" : "rounded-xl border border-[var(--ws-border)] p-5"}`}
      aria-label="Execution fees"
    >
      <div>
        <h3 className="font-semibold text-[var(--ws-text)]">
          {source.paymentScheduleId
            ? "Fee and approvals"
            : `${submitLabel} with fees in USDC`}
        </h3>
        <p className="mt-1 text-sm text-[var(--ws-muted)]">
          Your company account pays the execution service directly.
          {subject === "payment" &&
            " Recipients receive their full approved amounts."}
          {subject === "collection" &&
            " The full invoice balance moves into your company account."}
        </p>
      </div>
      {notice && <Notice tone="info">{notice}</Notice>}
      {(recordError || error || execution?.error) && (
        <Notice>
          {recordError ||
            error ||
            userErrorMessage(
              execution?.error,
              "Check the original fee request again shortly.",
            )}
        </Notice>
      )}
      {execution === undefined && (
        <p role="status" className="text-sm text-[var(--ws-muted)]">
          Loading saved fee requests…
        </p>
      )}
      {request && execution && (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-[var(--ws-muted)]">Maximum execution fee</dt>
            <dd className="text-right tabular-nums font-medium">
              {formatUnits(BigInt(request.permit.amount), 6)} USDC
            </dd>
            {execution.fee !== undefined && (
              <>
                <dt className="text-[var(--ws-muted)]">Actual fee charged</dt>
                <dd className="text-right tabular-nums">
                  {formatUnits(BigInt(execution.fee), 6)} USDC
                </dd>
              </>
            )}
            {execution.open && (
              <>
                <dt className="text-[var(--ws-muted)]">Approval expires</dt>
                <dd className="text-right">
                  {source.paymentScheduleId
                    ? scheduleDateTime(request.validUntil * 1000)
                    : new Date(request.validUntil * 1000).toLocaleString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                </dd>
              </>
            )}
          </dl>
          {execution.open && (
            <p className="text-sm text-[var(--ws-muted)]">
              Unused fees return to this account. A failed execution can still
              incur a fee.
              {!armed &&
                " Account owners approve the fee limit first, then the complete execution."}
            </p>
          )}
          {execution.stage === "submitting" && (
            <Notice tone="info">
              Your execution request is saved. We are checking the original
              transaction before marking this {subject} complete.
            </Notice>
          )}
          {execution.stage === "failed" && (
            <Notice>
              The execution service could not complete this attempt. The fee
              above was charged. Check the original {subject} before reviewing a
              new fee request.
            </Notice>
          )}
          {execution.stage === "expired" && (
            <Notice tone="info">
              This request expired without executing. No execution fee was
              charged for this request. Your original {subject} approvals are
              saved.
            </Notice>
          )}
          {execution.stage === "confirmed" && (
            <Notice tone="info">
              The execution service completed its request. The account receipt
              determines whether the {subject} completed.
            </Notice>
          )}
          {execution.stage === "cancelled" && (
            <Notice tone="info">
              This execution authorization has been cancelled.
            </Notice>
          )}
          {execution.open &&
            !armed &&
            ["fee", "operation", "ready"].includes(execution.stage) &&
            !expired && (
              <>
                <p className="text-sm font-medium">
                  {execution.stage === "fee"
                    ? "1. Approve the fee limit"
                    : "2. Approve the execution"}
                </p>
                {approvals.isPending && !blocked && (
                  <p role="status" className="text-sm text-[var(--ws-muted)]">
                    Checking account approvals…
                  </p>
                )}
                {approvals.isPending && blocked && !busy && (
                  <p className="text-sm text-[var(--ws-muted)]">
                    An account owner with payment access can complete these
                    approvals.
                  </p>
                )}
                {approvals.isError && (
                  <Notice>
                    Account approvals could not be checked.{" "}
                    <button
                      className="workspace-action-link"
                      onClick={() => void approvals.refetch()}
                    >
                      Try again
                    </button>
                  </Notice>
                )}
                {approvals.data && (
                  <p className="text-sm text-[var(--ws-muted)]">
                    {approvals.data.approved} of {approvals.data.threshold}{" "}
                    required account approvals
                  </p>
                )}
                <label className="flex items-start gap-3 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) =>
                      setConsent(e.target.checked ? consentKey : "")
                    }
                    disabled={busy}
                  />
                  <span>
                    I approve up to{" "}
                    {formatUnits(BigInt(request.permit.amount), 6)} USDC in
                    execution fees, including fees if execution fails.
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {execution.stage !== "ready" &&
                    approvals.data?.paths
                      .filter((p) => !p.approved)
                      .map((p) => (
                        <button
                          key={p.path.join(":")}
                          className="workspace-button workspace-button-primary"
                          disabled={busy || blocked || !reviewed || !address}
                          onClick={() =>
                            void run(async () => {
                              const signature = await (
                                await import("@/lib/services/circleApproval")
                              ).signCircleApproval(
                                request!,
                                execution.stage as "fee" | "operation",
                                p.path,
                                address!,
                              );
                              await approve({
                                ...identity!,
                                stage: execution.stage as "fee" | "operation",
                                revision: execution.revision,
                                path: p.path,
                                signature,
                              });
                            }, "Your approval is saved.")
                          }
                        >
                          {busy
                            ? "Saving approval…"
                            : p.path.length > 1 ||
                                approvals.data.paths.length > 1
                              ? `Approve through ${memberName(p.path[p.path.length - 1])}`
                              : execution.stage === "fee"
                                ? "Approve fee limit"
                                : "Approve execution"}
                        </button>
                      ))}
                  {execution.stage !== "ready" &&
                    approvals.data &&
                    approvals.data.approved >= approvals.data.threshold && (
                      <button
                        className="workspace-button"
                        disabled={busy || blocked}
                        onClick={() => void run(() => advance(identity!))}
                      >
                        Continue with saved approvals
                      </button>
                    )}
                  {execution.stage === "ready" && (
                    <button
                      className="workspace-button workspace-button-primary"
                      disabled={busy || blocked || !reviewed}
                      onClick={() =>
                        void run(
                          () => submit(identity!),
                          source.paymentScheduleId
                            ? "The payment is scheduled. You can close this window."
                            : "Execution submitted. We will verify its receipt.",
                        )
                      }
                    >
                      {busy ? "Submitting…" : submitLabel}
                    </button>
                  )}
                </div>
                {approvals.data && !approvals.data.paths.length && (
                  <p className="text-sm text-[var(--ws-muted)]">
                    A current account owner needs to approve this step.
                  </p>
                )}
              </>
            )}
          {expired && execution.open && (
            <Notice tone="info">
              The approval window has ended. Check the original request to
              confirm that it did not execute.
            </Notice>
          )}
        </>
      )}
      {execution?.open && identity && (
        <button
          className="workspace-button"
          disabled={busy}
          onClick={() => void run(() => recheck(identity))}
        >
          {busy ? "Checking…" : "Check execution status"}
        </button>
      )}
      {execution !== undefined && !execution?.open && ready && (
        <button
          className="workspace-button workspace-button-primary"
          disabled={busy || blocked || !sessionToken}
          onClick={() =>
            void run(() => prepare({ ...source, sessionToken: sessionToken! }))
          }
        >
          {busy ? "Getting fee…" : "Review execution fee"}
        </button>
      )}
      {!execution && !ready && (
        <p className="text-sm text-[var(--ws-muted)]">
          Complete the {subject} approvals to review its execution fee.
        </p>
      )}
    </section>
  );
}
