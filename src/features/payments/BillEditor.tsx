import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import {
  InvoiceSource,
  InvoiceAttachments,
  type SelectedInvoiceSource,
} from "./InvoiceSource";
import { uploadInvoiceFile } from "@/lib/invoiceFileClient";

export function BillEditor({
  orgId,
  bill,
  onClose,
}: {
  orgId: Id<"orgs">;
  bill?: Doc<"invoices">;
  onClose: () => void;
}) {
  const sessionToken = useSessionToken();
  const recipients = useQuery(
    api.beneficiaries.list,
    sessionToken ? { orgId, sessionToken, activeOnly: true } : "skip",
  );
  const create = useMutation(api.invoices.create);
  const update = useMutation(api.invoices.update);
  const existingSources = useQuery(
    api.invoiceFiles.list,
    bill && sessionToken ? { invoiceId: bill._id, sessionToken } : "skip",
  );
  const [source, setSource] = useState<SelectedInvoiceSource | null>(null);
  const [readingSource, setReadingSource] = useState(false);
  const [sourceReviewed, setSourceReviewed] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [vendor, setVendor] = useState<string>(bill?.beneficiaryId ?? "");
  const [number, setNumber] = useState(bill?.invoiceNumber ?? "");
  const [amount, setAmount] = useState(bill?.amount ?? "");
  const [token, setToken] = useState(bill?.token ?? "USDC");
  const [dueDate, setDueDate] = useState(
    bill ? new Date(bill.dueDate).toISOString().slice(0, 10) : "",
  );
  const [description, setDescription] = useState(bill?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!sessionToken || busy || readingSource) return;
    setBusy(true);
    setError("");
    try {
      const hasSources = !!source || !!existingSources?.length;
      if (hasSources && !sourceReviewed)
        throw new Error(
          "Review the source document and confirm the bill details before saving.",
        );
      let sourceId = source?.uploadedId;
      if (source && !sourceId) {
        sourceId = await uploadInvoiceFile(
          source.file,
          orgId,
          sessionToken,
          source.requestId,
        );
        setSource({ ...source, uploadedId: sourceId });
      }
      const fields = {
        sessionToken,
        invoiceNumber: number,
        amount,
        token,
        dueDate: new Date(`${dueDate}T23:59:59Z`).getTime(),
        description,
        sourceFileIds: sourceId ? [sourceId] : [],
        sourceReviewed: hasSources ? sourceReviewed : undefined,
      };
      if (bill)
        await update({
          ...fields,
          invoiceId: bill._id,
          expectedUpdatedAt: bill.updatedAt,
        });
      else
        await create({
          ...fields,
          orgId,
          requestId,
          beneficiaryId: vendor as Id<"beneficiaries">,
        });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save bill");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={bill ? "Edit bill" : "Add a bill"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="space-y-5 p-6" onSubmit={save}>
        <p className="workspace-description !mt-0">
          Record an invoice you received. Your team reviews its payment
          separately.
        </p>
        {error && <Notice>{error}</Notice>}
        {bill && <InvoiceAttachments invoiceId={bill._id} />}
        <InvoiceSource
          source={source}
          disabled={busy}
          onReading={setReadingSource}
          onChange={(s) => {
            setSource(s);
            setSourceReviewed(false);
          }}
          onApply={(suggestions) => {
            if (suggestions.invoiceNumber) setNumber(suggestions.invoiceNumber);
            if (suggestions.amount) setAmount(suggestions.amount);
            if (suggestions.dueDate) setDueDate(suggestions.dueDate);
            if (suggestions.token) setToken(suggestions.token);
            setSourceReviewed(false);
          }}
        />
        <fieldset
          disabled={busy}
          className="space-y-5"
          onChange={() => setSourceReviewed(false)}
        >
          <div>
          <label className="block">
            <span className="finance-label">Vendor or contractor</span>
            <select
              className="finance-field"
              required
              disabled={!!bill}
              value={vendor}
              onChange={(e) => {
                setVendor(e.target.value);
                const chosen = recipients?.find(
                  (r) => r._id === e.target.value,
                );
                if (
                  chosen?.preferredToken &&
                  !source?.document?.suggestions.token
                )
                  setToken(chosen.preferredToken);
              }}
            >
              <option value="">Choose a saved recipient</option>
              {recipients?.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
            {!bill && (
              <Link
                className="workspace-action-link mt-2"
                to={`/org/${orgId}/beneficiaries`}
              >
                Add a recipient first
              </Link>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="finance-label">Invoice number</span>
              <input
                className="finance-field"
                required
                maxLength={100}
                placeholder="INV-1042"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </label>
            <label>
              <span className="finance-label">Due date</span>
              <input
                className="finance-field"
                required
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
            <label>
              <span className="finance-label">Amount due</span>
              <input
                className="finance-field"
                required
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              <span className="finance-label">Payment currency</span>
              <select
                className="finance-field"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              >
                {["USDC", "USDT", "PYUSD", "EURC"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="finance-label">Description</span>
            <textarea
              className="finance-field"
              rows={3}
              maxLength={2000}
              placeholder="What is this invoice for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </fieldset>
        {(source || !!existingSources?.length) && (
          <label className="flex items-start gap-3 rounded-lg border border-white/10 p-4 text-sm leading-6">
            <input
              type="checkbox"
              className="mt-1.5"
              checked={sourceReviewed}
              disabled={busy || readingSource}
              onChange={(e) => setSourceReviewed(e.target.checked)}
            />
            I checked the recipient, invoice number, amount, payment currency
            and due date against the source document.
          </label>
        )}
        <div className="flex justify-end gap-2 border-t border-white/10 pt-5">
          <button
            type="button"
            className="workspace-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="workspace-button workspace-button-primary"
            disabled={
              busy ||
              readingSource ||
              (!!bill && existingSources === undefined) ||
              ((!!source || !!existingSources?.length) && !sourceReviewed)
            }
          >
            {busy ? "Saving…" : bill ? "Save changes" : "Add bill"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
