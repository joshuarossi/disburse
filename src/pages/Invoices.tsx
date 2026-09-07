import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { chainEnvironment } from "../../shared/assets";
import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Download, Plus, Receipt } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Dialog } from "@/components/ui/Dialog";
import { BillEditor } from "@/features/payments/BillEditor";
import { useSessionToken } from "@/lib/session";
import { getChainName, getTokenSymbolsForChain } from "@/lib/chains";
import { amountToBaseUnits, formatBaseUnits } from "../../shared/validation";
import { formatDate, formatMoney } from "@/lib/formatMoney";
import { exportToCsv, generateFilename } from "@/lib/csv";
import {
  EmptyState,
  LoadingRows,
  Metric,
  Notice,
  PageHeader,
  SearchField,
  StatusBadge,
} from "@/components/workspace/WorkspacePrimitives";
const tabs = {
  unpaid: "Unpaid",
  overdue: "Overdue",
  in_payment: "In payment",
  paid: "Paid",
  void: "Voided",
};
export default function Invoices() {
  const { orgId } = useParams();
  const sessionToken = useSessionToken();
  const args =
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip";
  const invoices = useQuery(api.invoices.list, args);
  const safes = useQuery(api.safes.getForOrg, args);
  const members = useQuery(api.orgs.listMembers, args);
  const session = useQuery(
    api.auth.validateSession,
    sessionToken ? { token: sessionToken } : "skip",
  );
  const role = members?.find(
    (m) => m?.userId === session?.userId && m?.status === "active",
  )?.role;
  const canRecord =
    !!role && ["admin", "approver", "initiator", "clerk"].includes(role);
  const canPay = !!role && ["admin", "approver", "initiator"].includes(role);
  const preparePayment = useMutation(api.invoices.preparePayment);
  const voidBill = useMutation(api.invoices.voidBill);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get("view");
  const tab = view && view in tabs ? (view as keyof typeof tabs) : "unpaid";
  const [editor, setEditor] = useState<Doc<"invoices"> | "new" | null>(null);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState<Doc<"invoices"> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const { environment } = useActivityEnvironment();
  const [accountId, setAccountId] = useState("");
  const [timing, setTiming] = useState<"now" | "scheduled">("now");
  const [payDate, setPayDate] = useState(
    new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedInvoices =
    invoices?.filter(
      (i) => selected.includes(i._id) && i.status === "unpaid",
    ) ?? [];
  const paymentToken = selectedInvoices[0]?.token;
  const availableSafes =
    safes?.filter(
      (s) =>
        chainEnvironment(s.chainId) === environment &&
        (!paymentToken || getTokenSymbolsForChain(s.chainId).includes(paymentToken)),
    ) ?? [];
  const fundingAccount = accountId
    ? availableSafes.find(s => s._id === accountId)
    : availableSafes.length === 1 ? availableSafes[0] : undefined;
  const chainId = fundingAccount?.chainId;
  const sameToken = selectedInvoices.every((i) => i.token === paymentToken);
  const total =
    paymentToken && sameToken
      ? formatBaseUnits(
          selectedInvoices.reduce(
            (sum, i) => sum + amountToBaseUnits(i.amount, i.token),
            0n,
          ),
          paymentToken,
        )
      : null;
  const visible = invoices?.filter(
    (i) =>
      (tab === "overdue"
        ? i.status === "unpaid" && isBillOverdue(i.dueDate)
        : i.status === tab) &&
      `${i.vendorName} ${i.invoiceNumber} ${i.description ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const unpaid = invoices?.filter((i) => i.status === "unpaid") ?? [];
  const totals = new Map<string, bigint>();
  for (const bill of unpaid)
    totals.set(
      bill.token,
      (totals.get(bill.token) ?? 0n) +
        amountToBaseUnits(bill.amount, bill.token),
    );
  const focus = invoices?.find((i) => i._id === params.get("focus"));
  const pay = async () => {
    if (args === "skip" || !chainId || busy) return;
    if (
      !selectedInvoices.length ||
      selectedInvoices.length !== selected.length
    ) {
      setError(
        "A selected bill changed. Close this review and select unpaid bills again.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await preparePayment({
        ...args,
        invoiceIds: selectedInvoices.map((i) => i._id),
        safeId: fundingAccount!._id,
        chainId,
        payDate:
          timing === "scheduled"
            ? new Date(`${payDate}T12:00:00Z`).getTime()
            : undefined,
      });
      navigate(`/org/${orgId}/disbursements?focus=${result.disbursementId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare payment");
    } finally {
      setBusy(false);
    }
  };
  const exportBills = () =>
    exportToCsv(
      generateFilename("bills"),
      (visible ?? []).map((i) => ({
        vendor: i.vendorName,
        invoice_number: i.invoiceNumber,
        amount: i.amount,
        currency: i.token,
        due_date: new Date(i.dueDate).toISOString().slice(0, 10),
        status: i.status,
      })),
      [
        "vendor",
        "invoice_number",
        "amount",
        "currency",
        "due_date",
        "status",
      ].map((key) => ({ key, label: key })),
    );
  return (
    <>
      <PageHeader
        title="Bills"
        description="Keep vendor invoices, due dates, and payments connected."
        actions={
          <>
            <button
              className="workspace-button"
              disabled={!visible?.length}
              onClick={exportBills}
            >
              <Download size={14} />
              Export
            </button>
            {canRecord && (
              <button
                className="workspace-button workspace-button-primary"
                onClick={() => setEditor("new")}
              >
                <Plus size={14} />
                Add bill
              </button>
            )}
          </>
        }
      />
      <div className="workspace-metrics">
        <Metric
          label="Outstanding"
          value={
            totals.size
              ? [...totals].map(([token, amount]) => (
                  <div key={token} className="text-lg">
                    {formatMoney(formatBaseUnits(amount, token), token, true)}{" "}
                    <span className="text-[10px] font-normal text-slate-400">
                      {token}
                    </span>
                  </div>
                ))
              : invoices
                ? "$0.00"
                : "…"
          }
          detail={`${unpaid.length} unpaid bill${unpaid.length === 1 ? '' : 's'}`}
        />
        <Metric
          label="Overdue"
          value={
            invoices
              ? unpaid.filter((i) => isBillOverdue(i.dueDate)).length
              : "…"
          }
          detail="Past their due date"
          tone="warning"
        />
        <Metric
          label="In payment"
          value={
            invoices?.filter((i) => i.status === "in_payment").length ?? "…"
          }
          detail="Prepared or awaiting settlement"
        />
        <Metric
          label="Paid"
          value={invoices?.filter((i) => i.status === "paid").length ?? "…"}
          detail="Verified payment records"
        />
      </div>
      {error && !paying && <Notice>{error}</Notice>}
      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div
            className="workspace-tabs"
            role="tablist"
            aria-label="Bill views"
          >
            {Object.entries(tabs).map(([key, label]) => (
              <button
                role="tab"
                key={key}
                aria-selected={tab === key}
                onClick={() => setParams({ view: key })}
              >
                {label}
              </button>
            ))}
          </div>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search vendor or invoice"
          />
        </div>
        {selectedInvoices.length > 0 && (
          <div className="workspace-toolbar !bg-accent-500/5">
            <p className="text-xs">
              {selectedInvoices.length} bills selected{" "}
              {total
                ? `· ${formatMoney(total, paymentToken, true)}`
                : "· Choose one currency per batch"}
            </p>
            <div className="flex gap-2">
              <button
                className="workspace-button"
                onClick={() => setSelected([])}
              >
                Clear
              </button>
              <button
                className="workspace-button workspace-button-primary"
                disabled={!sameToken || !canPay}
                onClick={() => {
                  setError("");
                  setPaying(true);
                }}
              >
                Review payment
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
        {visible === undefined ? (
          <LoadingRows />
        ) : !visible.length ? (
          <EmptyState
            icon={Receipt}
            title={
              search
                ? "No bills match your search"
                : tab === "unpaid"
                  ? "No bills waiting to be paid"
                  : `No ${tabs[tab].toLowerCase()} bills`
            }
            description="Add a vendor invoice, choose a pay date, and follow its progress through approval and settlement."
            action={
              canRecord && (
                <button
                  className="workspace-button"
                  onClick={() => setEditor("new")}
                >
                  <Plus size={14} />
                  Add a bill
                </button>
              )
            }
          />
        ) : (
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th>
                    {canPay && ["unpaid", "overdue"].includes(tab) && (
                      <input
                        type="checkbox"
                        aria-label="Select all visible bills"
                        checked={visible.every((i) => selected.includes(i._id))}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [
                                  ...new Set([
                                    ...ids,
                                    ...visible.map((i) => i._id),
                                  ]),
                                ]
                              : ids.filter(
                                  (id) => !visible.some((i) => i._id === id),
                                ),
                          )
                        }
                      />
                    )}
                  </th>
                  <th>Vendor & invoice</th>
                  <th>Due date</th>
                  <th className="numeric">Amount</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i._id}>
                    <td>
                      {canPay && i.status === "unpaid" && (
                        <input
                          type="checkbox"
                          aria-label={`Select invoice ${i.invoiceNumber}`}
                          checked={selected.includes(i._id)}
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, i._id]
                                : ids.filter((id) => id !== i._id),
                            )
                          }
                        />
                      )}
                    </td>
                    <td>
                      <div className="workspace-person">
                        <span className="workspace-avatar">
                          {i.vendorName.slice(0, 2).toUpperCase()}
                        </span>
                        <span>
                          <button
                            className="workspace-table-primary"
                            onClick={() =>
                              setParams({ view: tab, focus: i._id })
                            }
                          >
                            {i.vendorName}
                          </button>
                          <span className="workspace-table-secondary">
                            {i.invoiceNumber}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>{formatDate(i.dueDate)}</td>
                    <td className="numeric">
                      <strong>{formatMoney(i.amount, i.token, true)}</strong>
                      <span className="workspace-table-secondary">
                        {i.token}
                      </span>
                    </td>
                    <td>
                      <StatusBadge
                        status={
                          i.status === "unpaid" && isBillOverdue(i.dueDate)
                            ? "overdue"
                            : i.status
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="workspace-action-link"
                        onClick={() => setParams({ view: tab, focus: i._id })}
                      >
                        View details
                        <ArrowRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="workspace-table-footer">
          <span>{visible?.length ?? 0} bill{visible?.length === 1 ? '' : 's'} in this view</span>
          <span>Each paid bill links to a verified payment</span>
        </div>
      </section>
      {editor && (
        <BillEditor
          orgId={orgId as Id<"orgs">}
          bill={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
      {focus && !editor && !voiding && (
        <Dialog
          title={`Invoice ${focus.invoiceNumber}`}
          onClose={() => setParams({ view: tab })}
        >
          <div className="space-y-6 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">{focus.vendorName}</h2>
                <p className="workspace-description">
                  Due {formatDate(focus.dueDate)}
                </p>
              </div>
              <StatusBadge status={focus.status} />
            </div>
            <p className="text-3xl font-semibold tabular-nums">
              {formatMoney(focus.amount, focus.token, true)}{" "}
              <span className="text-sm font-normal text-slate-400">
                {focus.token}
              </span>
            </p>
            <p className="workspace-description">
              {focus.description || "No description added."}
            </p>
            <InvoiceAttachments invoiceId={focus._id} />
            {focus.sourceReviewedAt && <p className="text-xs text-slate-400">Bill details reviewed against the source {formatDate(focus.sourceReviewedAt)}.</p>}
            {focus.disbursementId && (
              <Link
                className="workspace-action-link"
                to={`/org/${orgId}/disbursements?focus=${focus.disbursementId}`}
              >
                View linked payment
                <ArrowRight size={14} />
              </Link>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-5">
              {focus.status === "unpaid" && canRecord && (
                <>
                  <button
                    className="workspace-button"
                    onClick={() => setVoiding(focus)}
                  >
                    Void bill
                  </button>
                  <button
                    className="workspace-button"
                    onClick={() => setEditor(focus)}
                  >
                    Edit bill
                  </button>
                </>
              )}
              {focus.status === "unpaid" && canPay && (
                <button
                  className="workspace-button workspace-button-primary"
                  onClick={() => {
                    setSelected([focus._id]);
                    setParams({ view: tab });
                    setPaying(true);
                  }}
                >
                  Prepare payment
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {voiding && (
        <Dialog
          title="Void this bill?"
          onClose={() => {
            if (!busy) setVoiding(null);
          }}
        >
          <div className="space-y-5 p-6">
            <p className="workspace-description">
              Invoice {voiding.invoiceNumber} will remain in your records as
              voided and cannot be paid. This action does not move funds.
            </p>
            <button
              className="workspace-button workspace-button-primary"
              disabled={busy}
              onClick={async () => {
                if (!sessionToken || busy) return;
                setBusy(true);
                try {
                  await voidBill({ invoiceId: voiding._id, sessionToken });
                  setVoiding(null);
                  setParams({ view: "void" });
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Could not void bill",
                  );
                  setVoiding(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Void bill
            </button>
          </div>
        </Dialog>
      )}
      {paying && (
        <Dialog
          title="Review bill payment"
          onClose={() => {
            if (!busy) setPaying(false);
          }}
        >
          <div className="space-y-5 p-6">
            {error && <Notice>{error}</Notice>}
            <p className="text-3xl font-semibold tabular-nums">
              {total ? formatMoney(total, paymentToken, true) : "Select one currency"}{" "}
              <span className="text-sm font-normal text-slate-400">
                {paymentToken}
              </span>
            </p>
            <p className="workspace-description">
              {selectedInvoices.length} bill{selectedInvoices.length === 1 ? '' : 's'}. Invoices for the same vendor are
              combined into one transfer.
            </p>
            <div className="max-h-48 overflow-auto">
              {selectedInvoices.map((i) => (
                <div className="workspace-list-row !px-0" key={i._id}>
                  <div>
                    <strong>{i.vendorName}</strong>
                    <p>{i.invoiceNumber}</p>
                  </div>
                  <strong>{formatMoney(i.amount, i.token, true)}</strong>
                </div>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="finance-label">Pay from</span>
                <select
                  className="finance-field"
                  value={fundingAccount?._id ?? ""}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="" disabled>
                    Choose an account
                  </option>
                  {availableSafes.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name ?? "Account"} · {getChainName(s.chainId)} · {s.safeAddress.slice(-6)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="finance-label">When to pay</span>
                <select
                  className="finance-field"
                  value={timing}
                  onChange={(e) => setTiming(e.target.value as typeof timing)}
                >
                  <option value="now">As soon as approved</option>
                  <option value="scheduled">Choose a pay date</option>
                </select>
              </label>
              {timing === "scheduled" && (
                <label>
                  <span className="finance-label">Pay date</span>
                  <input
                    className="finance-field"
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                  <span className="workspace-table-secondary">
                    12:00 UTC, after approval
                  </span>
                </label>
              )}
            </div>
            {!availableSafes.length && (
              <Notice tone="info">
                Connect an account that supports {paymentToken} before preparing
                this payment.
              </Notice>
            )}
            <Notice tone="info">
              This prepares a payment for review. Your team's required approvals
              are still needed before funds move.
            </Notice>
            <div className="flex justify-end gap-2">
              <button
                className="workspace-button"
                disabled={busy}
                onClick={() => setPaying(false)}
              >
                Back
              </button>
              <button
                className="workspace-button workspace-button-primary"
                disabled={busy || !chainId || !sameToken || !total}
                onClick={() => void pay()}
              >
                {busy ? "Preparing…" : "Prepare payment"}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
import { isBillOverdue } from "../../shared/dueDate";
import { InvoiceAttachments } from '@/features/payments/InvoiceSource';
