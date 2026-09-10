import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { userErrorMessage } from "@/lib/userErrors";
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
  useWorkspaceLanguage();
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
        (!paymentToken ||
          getTokenSymbolsForChain(s.chainId).includes(paymentToken)),
    ) ?? [];
  const fundingAccount = accountId
    ? availableSafes.find((s) => s._id === accountId)
    : availableSafes.length === 1
      ? availableSafes[0]
      : undefined;
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
      setError(userErrorMessage(e, "Could not prepare payment"));
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
        title={tx("Bills")}
        description={tx(
          "Keep vendor invoices, due dates, and payments connected.",
        )}
        actions={
          <>
            <button
              className="workspace-button"
              disabled={!visible?.length}
              onClick={exportBills}
            >
              <Download size={14} />
              {tx("Export")}
            </button>
            {canRecord && (
              <button
                className="workspace-button workspace-button-primary"
                onClick={() => setEditor("new")}
              >
                <Plus size={14} />
                {tx("Add bill")}
              </button>
            )}
          </>
        }
      />
      <div className="workspace-metrics">
        <Metric
          label={tx("Outstanding")}
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
          detail={tx("{{count}} unpaid bills", { count: unpaid.length })}
        />
        <Metric
          label={tx("Overdue")}
          value={
            invoices
              ? unpaid.filter((i) => isBillOverdue(i.dueDate)).length
              : "…"
          }
          detail={tx("Past their due date")}
          tone="warning"
        />
        <Metric
          label={tx("In payment")}
          value={
            invoices?.filter((i) => i.status === "in_payment").length ?? "…"
          }
          detail={tx("Prepared or awaiting settlement")}
        />
        <Metric
          label={tx("Paid")}
          value={invoices?.filter((i) => i.status === "paid").length ?? "…"}
          detail={tx("Verified payment records")}
        />
      </div>
      {error && !paying && <Notice>{tx(error)}</Notice>}
      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div
            className="workspace-tabs"
            role="tablist"
            aria-label={tx("Bill views")}
          >
            {Object.entries(tabs).map(([key, label]) => (
              <button
                role="tab"
                key={key}
                aria-selected={tab === key}
                onClick={() => setParams({ view: key })}
              >
                {tx(label)}
              </button>
            ))}
          </div>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={tx("Search vendor or invoice")}
          />
        </div>
        {selectedInvoices.length > 0 && (
          <div className="workspace-toolbar !bg-accent-500/5">
            <p className="text-xs">
              {tx("{{count}} bills selected", {
                count: selectedInvoices.length,
              })}{" "}
              {total
                ? `· ${formatMoney(total, paymentToken, true)}`
                : tx("· Choose one currency per batch")}
            </p>
            <div className="flex gap-2">
              <button
                className="workspace-button"
                onClick={() => setSelected([])}
              >
                {tx("Clear")}
              </button>
              <button
                className="workspace-button workspace-button-primary"
                disabled={!sameToken || !canPay}
                onClick={() => {
                  setError("");
                  setPaying(true);
                }}
              >
                {tx("Review payment")}
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
                ? tx("No bills match your search")
                : tab === "unpaid"
                  ? tx("No bills waiting to be paid")
                  : tx("No bills in this view")
            }
            description={tx(
              "Add a vendor invoice, choose a pay date, and follow its progress through approval and settlement.",
            )}
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
                    <span className="md:sr-only">{tx("Select all bills")}</span>
                    {canPay && ["unpaid", "overdue"].includes(tab) && (
                      <input
                        type="checkbox"
                        aria-label={tx("Select all visible bills")}
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
                  <th role="columnheader" scope="col">
                    {tx("Vendor & invoice")}
                  </th>
                  <th role="columnheader" scope="col">
                    {tx("Due date")}
                  </th>
                  <th role="columnheader" scope="col" className="numeric">
                    {tx("Amount")}
                  </th>
                  <th role="columnheader" scope="col">
                    {tx("Status")}
                  </th>
                  <th role="columnheader" scope="col">
                    <span className="sr-only">{tx("Details")}</span>
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {visible.map((i) => (
                  <tr role="row" key={i._id}>
                    <td role="cell" data-selection>
                      {canPay && i.status === "unpaid" && (
                        <input
                          type="checkbox"
                          aria-label={tx("Select invoice {{value1}}", {
                            value1: i.invoiceNumber,
                          })}
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
                    <td role="cell" data-primary>
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
                    <td role="cell" data-label={tx("Due date")}>
                      {formatDate(i.dueDate)}
                    </td>
                    <td
                      role="cell"
                      data-label={tx("Amount")}
                      className="numeric"
                    >
                      <strong>{formatMoney(i.amount, i.token, true)}</strong>
                      <span className="workspace-table-secondary">
                        {i.token}
                      </span>
                    </td>
                    <td role="cell" data-label={tx("Status")}>
                      <StatusBadge
                        status={
                          i.status === "unpaid" && isBillOverdue(i.dueDate)
                            ? "overdue"
                            : i.status
                        }
                      />
                    </td>
                    <td role="cell" data-actions>
                      <button
                        className="workspace-action-link"
                        onClick={() => setParams({ view: tab, focus: i._id })}
                      >
                        {tx("View details")}
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
          <span>
            {tx("{{count}} bills in this view", {
              count: visible?.length ?? 0,
            })}
          </span>
          <span>{tx("Each paid bill links to a verified payment")}</span>
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
          title={tx("Invoice {{value1}}", { value1: focus.invoiceNumber })}
          onClose={() => setParams({ view: tab })}
        >
          <div className="space-y-6 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">{focus.vendorName}</h2>
                <p className="workspace-description">
                  {tx("Due")} {formatDate(focus.dueDate)}
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
              {focus.description || tx("No description added.")}
            </p>
            <InvoiceAttachments invoiceId={focus._id} />
            {focus.sourceReviewedAt && (
              <p className="text-xs text-slate-400">
                {tx("Bill details reviewed against the source")}{" "}
                {formatDate(focus.sourceReviewedAt)}.
              </p>
            )}
            {focus.disbursementId && (
              <Link
                className="workspace-action-link"
                to={`/org/${orgId}/disbursements?focus=${focus.disbursementId}`}
              >
                {tx("View linked payment")}
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
                    {tx("Void bill")}
                  </button>
                  <button
                    className="workspace-button"
                    onClick={() => setEditor(focus)}
                  >
                    {tx("Edit bill")}
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
                  {tx("Prepare payment")}
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {voiding && (
        <Dialog
          title={tx("Void this bill?")}
          onClose={() => {
            if (!busy) setVoiding(null);
          }}
        >
          <div className="space-y-5 p-6">
            <p className="workspace-description">
              {tx("Invoice")} {voiding.invoiceNumber}{" "}
              {tx(
                "will remain in your records as voided and cannot be paid. This action does not move funds.",
              )}
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
                  setError(userErrorMessage(e, "Could not void bill"));
                  setVoiding(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {tx("Void bill")}
            </button>
          </div>
        </Dialog>
      )}
      {paying && (
        <Dialog
          title={tx("Review bill payment")}
          onClose={() => {
            if (!busy) setPaying(false);
          }}
        >
          <div className="space-y-5 p-6">
            {error && <Notice>{tx(error)}</Notice>}
            <p className="text-3xl font-semibold tabular-nums">
              {total
                ? formatMoney(total, paymentToken, true)
                : tx("Select one currency")}{" "}
              <span className="text-sm font-normal text-slate-400">
                {paymentToken}
              </span>
            </p>
            <p className="workspace-description">
              {tx(
                "{{count}} bills. Invoices for the same vendor are combined into one transfer.",
                { count: selectedInvoices.length },
              )}
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
                <span className="finance-label">{tx("Pay from")}</span>
                <select
                  className="finance-field"
                  value={fundingAccount?._id ?? ""}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="" disabled>
                    {tx("Choose an account")}
                  </option>
                  {availableSafes.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name ?? tx("Account")} · {getChainName(s.chainId)} ·{" "}
                      {s.safeAddress.slice(-6)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="finance-label">{tx("When to pay")}</span>
                <select
                  className="finance-field"
                  value={timing}
                  onChange={(e) => setTiming(e.target.value as typeof timing)}
                >
                  <option value="now">{tx("As soon as approved")}</option>
                  <option value="scheduled">{tx("Choose a pay date")}</option>
                </select>
              </label>
              {timing === "scheduled" && (
                <label>
                  <span className="finance-label">{tx("Pay date")}</span>
                  <input
                    className="finance-field"
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                  <span className="workspace-table-secondary">
                    {tx("12:00 UTC, after approval")}
                  </span>
                </label>
              )}
            </div>
            {!availableSafes.length && (
              <Notice tone="info">
                {tx("Connect an account that supports")} {paymentToken}{" "}
                {tx("before preparing this payment.")}
              </Notice>
            )}
            <Notice tone="info">
              {tx(
                "This prepares a payment for review. Your team's required approvals are still needed before funds move.",
              )}
            </Notice>
            <div className="flex justify-end gap-2">
              <button
                className="workspace-button"
                disabled={busy}
                onClick={() => setPaying(false)}
              >
                {tx("Back")}
              </button>
              <button
                className="workspace-button workspace-button-primary"
                disabled={busy || !chainId || !sameToken || !total}
                onClick={() => void pay()}
              >
                {busy ? tx("Preparing…") : tx("Prepare payment")}
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
import { InvoiceAttachments } from "@/features/payments/InvoiceSource";
