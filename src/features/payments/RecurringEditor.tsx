import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { payoutInstructionError } from "../../../shared/payoutInstructions";
import { getChainName } from "@/lib/chains";
export function RecurringEditor({
  series,
  onClose,
}: {
  series: Doc<"recurringPayments">;
  onClose: () => void;
}) {
  const sessionToken = useSessionToken();
  const beneficiaries = useQuery(
    api.beneficiaries.list,
    sessionToken
      ? { orgId: series.orgId, sessionToken, activeOnly: true }
      : "skip",
  );
  const update = useMutation(api.paymentRuns.updateRecurring);
  const [name, setName] = useState(series.name);
  const [cadence, setCadence] = useState(series.cadence);
  const [date, setDate] = useState(
    new Date(series.nextPayDate).toISOString().slice(0, 10),
  );
  const [recipients, setRecipients] = useState(series.recipients);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const instructionErrors = recipients.flatMap((row) => {
    const recipient = beneficiaries?.find((b) => b._id === row.beneficiaryId);
    const error = recipient && payoutInstructionError(recipient, series);
    return error ? [error] : [];
  });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionToken || busy || instructionErrors.length) return;
    setBusy(true);
    setError("");
    try {
      await update({
        recurringPaymentId: series._id,
        sessionToken,
        name,
        cadence,
        nextPayDate: new Date(`${date}T12:00:00Z`).getTime(),
        recipients,
      });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save recurring payment",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Edit recurring payment"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="space-y-5 p-6" onSubmit={save}>
        {error && <Notice>{error}</Notice>}
        {instructionErrors.map((message) => (
          <Notice key={message}>{message}</Notice>
        ))}
        <Notice tone="info">
          Changes apply to future batches. Existing drafts and scheduled
          payments keep their saved details.
        </Notice>
        <p className="text-sm text-slate-400">
          Payments use {series.token} on {getChainName(series.chainId)}.
          Recipients must have matching payout instructions.
        </p>
        <label className="block">
          <span className="finance-label">Schedule name</span>
          <input
            className="finance-field"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="finance-label">Frequency</span>
            <select
              className="finance-field"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as typeof cadence)}
            >
              <option value="weekly">Every week</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Every month</option>
            </select>
          </label>
          <label>
            <span className="finance-label">Next pay date · 12:00 UTC</span>
            <input
              className="finance-field"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Recipients and amounts</h3>
          <div className="max-h-64 overflow-auto">
            {recipients.map((r, i) => (
              <div
                className="flex items-center gap-3 border-b border-white/10 py-3"
                key={r.beneficiaryId}
              >
                <span className="flex-1 text-xs">
                  {beneficiaries?.find((b) => b._id === r.beneficiaryId)
                    ?.name ?? "Unavailable recipient"}
                </span>
                <input
                  className="finance-field !w-28 text-right"
                  aria-label={`Amount for recipient ${i + 1}`}
                  inputMode="decimal"
                  required
                  value={r.amount}
                  onChange={(e) =>
                    setRecipients((rows) =>
                      rows.map((row, j) =>
                        j === i ? { ...row, amount: e.target.value } : row,
                      ),
                    )
                  }
                />
                <span className="text-xs text-slate-400">
                  {beneficiaries?.find((b) => b._id === r.beneficiaryId)
                    ?.preferredToken ?? series.token}
                </span>
                <button
                  type="button"
                  aria-label={`Remove recipient ${i + 1}`}
                  onClick={() =>
                    setRecipients((rows) => rows.filter((_, j) => j !== i))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <select
              className="finance-field"
              aria-label="Add a recipient"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            >
              <option value="">Add a saved recipient</option>
              {beneficiaries
                ?.filter(
                  (b) =>
                    b.walletAddress &&
                    !recipients.some((r) => r.beneficiaryId === b._id),
                )
                .map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
            </select>
            <button
              className="workspace-button"
              type="button"
              disabled={!adding}
              onClick={() => {
                const b = beneficiaries?.find((b) => b._id === adding);
                if (b)
                  setRecipients((rows) => [
                    ...rows,
                    { beneficiaryId: b._id, amount: "" },
                  ]);
                setAdding("");
              }}
            >
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 pt-5">
          <button
            className="workspace-button"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="workspace-button workspace-button-primary"
            disabled={
              busy || !recipients.length || instructionErrors.length > 0
            }
          >
            {busy ? "Saving…" : "Save schedule"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
