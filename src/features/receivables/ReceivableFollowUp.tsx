import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
  invoiceReminder,
  receivableAmounts,
} from "../../../shared/receivables";
import { useSessionToken } from "@/lib/session";
import { userErrorMessage } from "@/lib/userErrors";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { formatDate } from "@/lib/formatMoney";

export function ReceivableFollowUp({
  invoice,
  canManage,
}: {
  invoice: Doc<"receivables">;
  canManage: boolean;
}) {
  useWorkspaceLanguage();
  const sessionToken = useSessionToken(),
    schedule = useMutation(api.receivableWorkflows.setFollowUp),
    prepared = useMutation(api.receivableWorkflows.reminderPrepared);
  const [date, setDate] = useState(
    invoice.followUpAt
      ? new Date(invoice.followUpAt).toISOString().slice(0, 10)
      : "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  if (
    !canManage ||
    invoice.state !== "issued" ||
    receivableAmounts(invoice).remaining === "0"
  )
    return null;
  const run = async (work: () => Promise<void>) => {
    if (busy || !sessionToken) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(
        userErrorMessage(
          e,
          "The reminder could not be prepared. Your invoice is unchanged.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const draft = invoiceReminder(invoice, window.location.origin);
  return (
    <section
      aria-label={tx("Payment reminders")}
      className="space-y-3 rounded-xl border border-slate-400/20 p-4"
    >
      <h3 className="font-semibold">{tx("Follow up on payment")}</h3>
      <p className="workspace-description">
        {tx(
          "Prepare a reminder for your own email app, or copy it to share. Disburse does not send an email.",
        )}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer">{tx("Preview reminder")}</summary>
        <p className="mt-3 font-semibold">{tx(draft.subject)}</p>
        <p className="mt-2 whitespace-pre-wrap break-words">{tx(draft.body)}</p>
      </details>
      <div className="flex flex-wrap gap-2">
        <button
          className="workspace-button"
          disabled={busy || !sessionToken}
          onClick={() =>
            run(async () => {
              await navigator.clipboard.writeText(
                `${tx(draft.subject)}\n\n${tx(draft.body)}`,
              );
              await prepared({
                invoiceId: invoice._id,
                sessionToken: sessionToken!,
                requestId,
              });
              setRequestId(crypto.randomUUID());
              setMessage(
                "Reminder copied. Share it through your preferred channel.",
              );
            })
          }
        >
          {tx("Copy reminder")}
        </button>
        {invoice.customerEmail && (
          <a
            className="workspace-button"
            href={`mailto:${encodeURIComponent(invoice.customerEmail)}?subject=${encodeURIComponent(tx(draft.subject))}&body=${encodeURIComponent(tx(draft.body))}`}
          >
            {tx("Open email draft")}
          </a>
        )}
      </div>
      <p className="workspace-description">
        {invoice.lastReminderPreparedAt
          ? tx("Last copied {{value1}}. Delivery is not tracked.", {
              value1: formatDate(invoice.lastReminderPreparedAt),
            })
          : tx("No reminder has been copied yet.")}
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await schedule({
              invoiceId: invoice._id,
              sessionToken: sessionToken!,
              at: date ? Date.parse(`${date}T00:00:00Z`) : undefined,
            });
            setMessage(
              date
                ? "Follow-up date saved. It will appear in your invoice list."
                : "Follow-up cleared.",
            );
          });
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="finance-label">{tx("Next follow-up")}</span>
          <input
            type="date"
            className="finance-field"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
          />
        </label>
        <button className="workspace-button" disabled={busy || !sessionToken}>
          {tx("Save follow-up")}
        </button>
      </form>
      {invoice.followUpAt && (
        <p className="text-sm">
          {invoice.followUpAt <= Date.now()
            ? tx("Follow-up due")
            : tx("Follow up")}{" "}
          · {formatDate(invoice.followUpAt)}
        </p>
      )}
      {error && <Notice>{tx(error)}</Notice>}
      {message && <Notice tone="success">{tx(message)}</Notice>}
    </section>
  );
}
