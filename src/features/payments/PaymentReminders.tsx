import { Component, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Bell, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { Dialog } from "@/components/ui/Dialog";
import {
  LoadingRows,
  Notice,
} from "@/components/workspace/WorkspacePrimitives";

/** Failure in an optional reminder query must not remove workspace navigation. */
export class ReminderBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <button
        className="workspace-button"
        title="Reminders could not be loaded. Retry."
        aria-label="Retry loading payment reminders"
        onClick={() => this.setState({ failed: false })}
      >
        <Bell size={17} />
        <span className="sr-only">Retry reminders</span>
      </button>
    ) : (
      this.props.children
    );
  }
}

export function PaymentReminders({ orgId }: { orgId: Id<"orgs"> }) {
  const sessionToken = useSessionToken();
  const { environment } = useActivityEnvironment();
  const recent = useQuery(
    api.paymentFollowups.list,
    sessionToken ? { orgId, sessionToken, environment } : "skip",
  );
  const count = recent?.items.filter((i) => i.unread).length ?? 0;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="workspace-button relative"
        title="Payment reminders"
        aria-label={`Payment reminders${count ? ` · ${count} unread on the latest page` : ""}`}
        onClick={() => setOpen(true)}
      >
        <Bell size={17} />
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 min-w-4 rounded-full bg-accent-600 px-1 text-center text-[10px] font-semibold text-white"
          >
            {count}
            {!recent?.isDone ? "+" : ""}
          </span>
        )}
      </button>
      {open && (
        <ReminderList
          key={environment}
          orgId={orgId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ReminderList({
  orgId,
  onClose,
}: {
  orgId: Id<"orgs">;
  onClose: () => void;
}) {
  const sessionToken = useSessionToken();
  const { environment } = useActivityEnvironment();
  const [cursor, setCursor] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const data = useQuery(
    api.paymentFollowups.list,
    sessionToken ? { orgId, sessionToken, environment, cursor } : "skip",
  );
  const markRead = useMutation(api.paymentFollowups.markRead);
  const items = data?.items.filter((i) => !onlyMine || i.assigned);
  return (
    <Dialog title="Payment reminders" onClose={onClose}>
      <div className="space-y-5 p-5 sm:p-6">
        <p className="workspace-description">
          Review approaching deadlines and payment exceptions. These reminders
          are checked in the background and delivered here in the app.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
            />
            Assigned to me
          </label>
          <span className="text-xs text-slate-400">
            {environment === "production"
              ? "Business activity"
              : environment === "test"
                ? "Test activity"
                : "Unclassified records"}
          </span>
        </div>
        {error && <Notice>{error}</Notice>}
        {!data ? (
          <LoadingRows />
        ) : !items?.length ? (
          <p className="rounded-xl border border-white/10 p-5 text-sm text-slate-400">
            {cursor || !data.isDone
              ? "No matching reminders on this page."
              : onlyMine
                ? "No current reminders assigned to you."
                : "No current payment reminders."}
          </p>
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              aria-label={item.title + " · " + item.paymentName}
              className="space-y-3 rounded-xl border border-white/10 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className={`text-xs font-medium ${item.urgent ? "workspace-funding-warning" : "text-slate-400"}`}
                  >
                    {item.title}
                  </p>
                  <h3 className="mt-1 font-semibold">{item.paymentName}</h3>
                </div>
                {item.unread && (
                  <span className="text-xs font-medium text-accent-400">
                    New
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Pay date:{" "}
                {new Date(item.payAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "UTC",
                })}{" "}
                UTC
              </p>
              <p className="text-sm leading-6">{item.description}</p>
              {item.pauseReason && (
                <p className="text-sm workspace-funding-warning">
                  {item.pauseReason}
                </p>
              )}
              {item.ownershipError && (
                <p className="text-xs text-slate-400">{item.ownershipError}</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  className="workspace-action-link"
                  onClick={onClose}
                  to={
                    item.disbursementId
                      ? `/org/${orgId}/disbursements?focus=${item.disbursementId}`
                      : `/org/${orgId}/payments?focus=${item.recurringPaymentId}`
                  }
                >
                  {item.disbursementId ? "Review payment" : "Review schedule"}
                  <ArrowRight size={14} />
                </Link>
                {item.unread && (
                  <button
                    className="workspace-button"
                    disabled={!!busy}
                    onClick={async () => {
                      if (!sessionToken || busy) return;
                      setError("");
                      setBusy(item.id);
                      try {
                        const acknowledged = await markRead({
                          sessionToken,
                          notificationId: item.id,
                          revision: item.revision,
                        });
                        if (!acknowledged)
                          setError(
                            "This reminder changed while you were reading it. Review the latest update before marking it as read.",
                          );
                      } catch {
                        setError(
                          "The reminder could not be marked as read. Your payment was not changed.",
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === item.id ? "Saving…" : "Mark read"}
                  </button>
                )}
              </div>
            </article>
          ))
        )}
        {data && (
          <div className="flex justify-between gap-3">
            {cursor ? (
              <button
                className="workspace-button"
                onClick={() => setCursor(null)}
              >
                Back to latest
              </button>
            ) : (
              <span />
            )}
            {!data.isDone && (
              <button
                className="workspace-button"
                onClick={() => setCursor(data.cursor)}
              >
                Older reminders
              </button>
            )}
          </div>
        )}
        <p className="border-t border-white/10 pt-4 text-xs leading-5 text-slate-400">
          Current account approvers, the payment coordinator and workspace
          admins receive these reminders. Unresolved late items repeat daily.
          Marking a reminder as read does not approve, cancel or send a payment.
        </p>
      </div>
    </Dialog>
  );
}
