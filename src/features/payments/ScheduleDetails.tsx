import { Link } from "react-router-dom";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAccountReadiness } from "@/features/treasury/useAccountReadiness";
import { Dialog } from "@/components/ui/Dialog";
import {
  LoadingRows,
  Notice,
  StatusBadge,
} from "@/components/workspace/WorkspacePrimitives";
import {
  paymentFollowup,
  paymentFollowupCopy,
} from "../../../shared/paymentFollowup";

import { scheduleDateTime } from "@/lib/formatMoney";
type Schedule = FunctionReturnType<
  typeof api.paymentRuns.listRecurring
>[number];

export function ScheduleDetails({
  series,
  onClose,
}: {
  series: Schedule;
  onClose: () => void;
}) {
  const latest = series.latestPayment;
  const late = latest ? paymentFollowup(latest, Date.now()).phase : null;
  return (
    <Dialog title={series.name} onClose={onClose}>
      <div className="space-y-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="workspace-description">Recurring schedule</p>
          <StatusBadge status={series.status} />
        </div>
        {series.pauseReason && (
          <Notice>
            {series.pauseReason} Resume this schedule after resolving the issue.
            Missed periods will not be paid automatically.
          </Notice>
        )}
        <section aria-label="Next occurrence" className="space-y-3">
          <h3 className="font-semibold">Next occurrence</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-400">
                Draft preparation{series.status === "paused" ? " · paused" : ""}
              </dt>
              <dd className="mt-1">{scheduleDateTime(series.nextDraftAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Approve and schedule before</dt>
              <dd className="mt-1 font-medium">
                {scheduleDateTime(series.nextPayDate)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Payment coordinator</dt>
              <dd className="mt-1">
                {series.ownerName}
                {!series.coordinatorActive && (
                  <span className="block workspace-funding-warning">
                    Payment access needs attention
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <p className="text-xs leading-5 text-slate-400">
            A draft is prepared three days before the pay date. Each payment
            needs approval and scheduling. Updating this schedule does not
            change an existing payment.
          </p>
        </section>
        {latest && (
          <section
            aria-label="Latest prepared payment"
            className="space-y-3 rounded-xl border border-white/10 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">Latest prepared payment</h3>
              <StatusBadge status={latest.status} />
            </div>
            <p className="text-sm">{latest.name || series.name}</p>
            {latest.scheduledAt && (
              <p className="text-xs text-slate-400">
                Pay date: {scheduleDateTime(latest.scheduledAt)}
              </p>
            )}
            {late && paymentFollowupCopy[late].urgent && (
              <Notice>
                <strong>{paymentFollowupCopy[late].title}. </strong>
                {paymentFollowupCopy[late].description}
              </Notice>
            )}
            <Link
              onClick={onClose}
              className="workspace-action-link"
              to={`/org/${series.orgId}/disbursements?focus=${latest._id}`}
            >
              Review this payment
            </Link>
          </section>
        )}
        {latest?.safeId ? (
          <ScheduleApprovers safeId={latest.safeId} />
        ) : (
          <Notice>
            Account approvers will be verified when the first payment is
            prepared.
          </Notice>
        )}
        <section
          aria-label="Reminder plan"
          className="space-y-2 border-t border-white/10 pt-4"
        >
          <h3 className="font-semibold">Reminders and missed deadlines</h3>
          <p className="text-sm leading-6">
            The coordinator, current account approvers with payment access, and
            workspace admins receive in-app reminders when review opens, 24
            hours before payment, and if the deadline is missed.
          </p>
          <p className="text-sm leading-6">
            Late payments remain available for review and are flagged daily
            until resolved. Payment failures and delayed confirmations link to
            the original payment for recovery.
          </p>
        </section>
      </div>
    </Dialog>
  );
}

function ScheduleApprovers({ safeId }: { safeId: Id<"safes"> }) {
  const check = useAccountReadiness(safeId);
  const account = check.data;
  const unavailable =
    check.isError ||
    !!account?.error ||
    (!!account && Date.now() - account.checkedAt > 120_000);
  return (
    <section aria-label="Responsible approvers" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Responsible approvers</h3>
        <button
          className="workspace-button"
          disabled={check.isFetching}
          onClick={() => void check.refetch()}
        >
          {check.isFetching ? "Checking…" : "Refresh approvers"}
        </button>
      </div>
      {unavailable ? (
        <Notice>
          Current account approvers could not be verified. Refresh before
          relying on this approval list.
        </Notice>
      ) : !account ? (
        <LoadingRows />
      ) : (
        <>
          <p className="text-sm">
            {account.name} requires {account.threshold} of{" "}
            {account.owners.length} owner approvals for the latest prepared
            payment.
          </p>
          <ul className="space-y-3">
            {account.owners.map((owner) => (
              <li
                key={owner.address}
                className="space-y-1 rounded-lg border border-white/10 p-3 text-sm"
              >
                <p className="font-medium">{owner.name || "Account owner"}</p>
                <p className="break-all font-mono text-xs text-slate-400">
                  {owner.address}
                </p>
                <p>
                  {owner.canApproveInApp
                    ? "Can approve in this workspace"
                    : "Workspace payment access required"}
                </p>
              </li>
            ))}
          </ul>
          {account.owners.filter((owner) => owner.canApproveInApp).length <
            (account.threshold ?? Infinity) && (
            <Notice>
              There are not enough account owners with payment access here to
              collect every required approval. An admin can review team access.
            </Notice>
          )}
          <p className="text-xs leading-5 text-slate-400">
            Checked {scheduleDateTime(account.checkedAt)}. A spending delegate
            may pay within an active account grant; the grant is checked when
            the payment is prepared.
          </p>
        </>
      )}
    </section>
  );
}
