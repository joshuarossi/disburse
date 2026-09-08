import { userErrorMessage } from "@/lib/userErrors";
import { scheduleDateTime } from "@/lib/formatMoney";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { chainEnvironment } from "../../shared/assets";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { Plus, Repeat2, ArrowRight, Pause, Play } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { PaymentBatchForm } from "@/components/payments/PaymentBatchForm";
import { RecurringEditor } from "@/features/payments/RecurringEditor";
import { ScheduleDetails } from "@/features/payments/ScheduleDetails";
import { Dialog } from "@/components/ui/Dialog";
import { formatDate, formatMoney } from "@/lib/formatMoney";
import {
  EmptyState,
  LoadingRows,
  Metric,
  Notice,
  PageHeader,
  SearchField,
  StatusBadge,
} from "@/components/workspace/WorkspacePrimitives";
const frequency = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
};
export default function PaymentBatches() {
  const { environment } = useActivityEnvironment();
  const { orgId } = useParams();
  const [params, setParams] = useSearchParams();
  const sessionToken = useSessionToken();
  const args =
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip";
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Doc<"recurringPayments"> | null>(null);
  const [confirm, setConfirm] = useState<Doc<"recurringPayments"> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const allRecurring = useQuery(api.paymentRuns.listRecurring, args);
  const recurring = allRecurring?.filter(
    (p) => chainEnvironment(p.chainId) === environment,
  );
  const members = useQuery(api.orgs.listMembers, args);
  const session = useQuery(
    api.auth.validateSession,
    sessionToken ? { token: sessionToken } : "skip",
  );
  const role = members?.find(
    (m) => m?.userId === session?.userId && m?.status === "active",
  )?.role;
  const canCreate = !!role && ["admin", "approver", "initiator"].includes(role);
  const changeStatus = useMutation(api.paymentRuns.setRecurringStatus);
  const series = recurring?.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = recurring?.find((r) => r._id === params.get("focus"));
  const closeDetails = () =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("focus");
        return next;
      },
      { replace: true },
    );
  const change = async () => {
    if (!sessionToken || !confirm || busy) return;
    setBusy(true);
    setError("");
    try {
      await changeStatus({
        recurringPaymentId: confirm._id,
        sessionToken,
        status: confirm.status === "active" ? "paused" : "active",
      });
      setConfirm(null);
    } catch (e) {
      setError(userErrorMessage(e, "Could not update schedule"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Schedules"
        description="Plan recurring payments, track the next draft, and keep each payday on course."
        actions={
          canCreate &&
          !!recurring?.length && (
            <button
              className="workspace-button workspace-button-primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={14} />
              New schedule
            </button>
          )
        }
      />
      <div className="workspace-metrics">
        <Metric
          label="Active schedules"
          value={recurring?.filter((r) => r.status === "active").length ?? "…"}
          detail="Drafts prepared automatically"
        />
        <Metric
          label="Paused schedules"
          value={recurring?.filter((r) => r.status === "paused").length ?? "…"}
          detail="No new drafts while paused"
        />
        <Metric
          label="Review window"
          value="3 days"
          detail="Drafts prepared before each pay date"
        />
        <Metric
          label="Payment approval"
          value="Required"
          detail="Owners or an authorized spending delegate"
        />
      </div>
      {error && <Notice>{error}</Notice>}
      {params.has("focus") && recurring && !selected && (
        <Notice>
          This schedule is not available in the selected activity.{" "}
          <button className="workspace-action-link" onClick={closeDetails}>
            Dismiss
          </button>
        </Notice>
      )}
      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div>
            <h2 className="font-semibold">Recurring schedules</h2>
            <p className="workspace-description">
              Review generated drafts and payment history in Payments.
            </p>
          </div>
          <SearchField
            placeholder="Search schedules"
            value={search}
            onChange={setSearch}
          />
        </div>
        {series === undefined ? (
          <LoadingRows />
        ) : !series.length ? (
          <EmptyState
            icon={Repeat2}
            title="Prepare for every payday"
            description="Choose your recipients, amounts, and frequency. Each future payment is prepared for your team to review."
            action={
              canCreate && (
                <button
                  className="workspace-button workspace-button-primary"
                  onClick={() => setCreating(true)}
                >
                  Create a schedule
                  <Plus size={14} />
                </button>
              )
            }
          />
        ) : (
          <div className="workspace-table-wrap">
            <table
              className="workspace-table workspace-table-responsive"
              role="table"
            >
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    Schedule
                  </th>
                  <th role="columnheader" scope="col">
                    Frequency
                  </th>
                  <th role="columnheader" scope="col">
                    Next draft & pay date
                  </th>
                  <th role="columnheader" scope="col" className="numeric">
                    Per payment
                  </th>
                  <th role="columnheader" scope="col">
                    Status
                  </th>
                  <th role="columnheader" scope="col">
                    Latest payment & actions
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {series.map((r) => (
                  <tr role="row" key={r._id}>
                    <td role="cell" data-primary>
                      <button
                        className="workspace-action-link font-semibold text-left"
                        aria-label={`Review schedule ${r.name}`}
                        onClick={() => setParams({ focus: r._id })}
                      >
                        {r.name}
                      </button>
                      <span className="workspace-table-secondary">
                        {r.recipients.length} recipient
                        {r.recipients.length === 1 ? "" : "s"} · {r.ownerName}
                      </span>
                      {r.pauseReason && (
                        <p className="mt-2 max-w-xs text-xs workspace-funding-warning">
                          {r.pauseReason}
                        </p>
                      )}
                    </td>
                    <td role="cell" data-label="Frequency">
                      {frequency[r.cadence]}
                    </td>
                    <td role="cell" data-label="Next draft & pay date">
                      <strong>{formatDate(r.nextDraftAt)}</strong>
                      <span className="workspace-table-secondary">
                        {r.status === "paused" ? "Paused · " : ""}Pay{" "}
                        {formatDate(r.nextPayDate)}
                      </span>
                      <span className="workspace-table-secondary">
                        Approve by {scheduleDateTime(r.nextPayDate)}
                      </span>
                    </td>
                    <td
                      role="cell"
                      data-label="Per payment"
                      className="numeric"
                    >
                      <strong>
                        {formatMoney(r.totalAmount, r.token, true)}
                      </strong>
                      <span className="workspace-table-secondary">
                        {r.token}
                      </span>
                    </td>
                    <td role="cell" data-label="Status">
                      <StatusBadge status={r.status} />
                    </td>
                    <td role="cell" data-actions>
                      {r.latestPayment && (
                        <div className="mb-3">
                          <Link
                            className="workspace-action-link"
                            to={`/org/${orgId}/disbursements?focus=${r.latestPayment._id}`}
                          >
                            Review latest payment <ArrowRight size={13} />
                          </Link>
                          <span className="ml-2">
                            <StatusBadge status={r.latestPayment.status} />
                          </span>
                          {r.latestPayment.scheduledAt && (
                            <p className="workspace-table-secondary">
                              Pay {formatDate(r.latestPayment.scheduledAt)}
                            </p>
                          )}
                        </div>
                      )}
                      <Link
                        className="workspace-action-link mb-3"
                        to={`/org/${orgId}/disbursements?schedule=${r._id}`}
                      >
                        Payment history <ArrowRight size={13} />
                      </Link>
                      {canCreate && (
                        <div className="flex items-center gap-3">
                          <button
                            className="workspace-action-link"
                            onClick={() => setEditing(r)}
                          >
                            Edit
                          </button>
                          <button
                            className="workspace-button"
                            onClick={() => setConfirm(r)}
                          >
                            {r.status === "active" ? (
                              <Pause size={12} />
                            ) : (
                              <Play size={12} />
                            )}
                            {r.status === "active" ? "Pause" : "Resume"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="workspace-table-footer">
          <span>
            {series?.length ?? 0} schedule{series?.length === 1 ? "" : "s"}
          </span>
          <span>
            Changes affect future drafts. Already prepared payments remain in
            Payments.
          </span>
        </div>
      </section>
      {creating && (
        <PaymentBatchForm
          orgId={orgId as Id<"orgs">}
          initialCadence="monthly"
          onClose={() => setCreating(false)}
        />
      )}
      {selected && <ScheduleDetails series={selected} onClose={closeDetails} />}
      {editing && (
        <RecurringEditor series={editing} onClose={() => setEditing(null)} />
      )}
      {confirm && (
        <Dialog
          title={
            confirm.status === "active"
              ? "Pause this schedule?"
              : "Resume this schedule?"
          }
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <div className="space-y-5 p-6">
            <p className="workspace-description">
              {confirm.status === "active"
                ? "Future batches will stop being prepared. Existing drafts and scheduled payments remain in Payments and can be cancelled separately."
                : "The next future occurrence will be prepared for review. Missed periods will not create catch-up payments."}
            </p>
            {error && <Notice>{error}</Notice>}
            <button
              className="workspace-button workspace-button-primary"
              disabled={busy}
              onClick={() => void change()}
            >
              {busy
                ? "Saving…"
                : confirm.status === "active"
                  ? "Pause schedule"
                  : "Resume schedule"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
