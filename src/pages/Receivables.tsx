import { useReceivingService } from "@/features/receivables/useReceivingService";
import { userErrorMessage } from "@/lib/userErrors";
import { ReceivableDocuments } from "@/features/receivables/ReceivableDocuments";
import { ReceivableFollowUp } from "@/features/receivables/ReceivableFollowUp";
import { ReceivableCredits } from "@/features/receivables/ReceivableCredits";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { chainEnvironment } from "../../shared/assets";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAccount } from "wagmi";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Dialog } from "@/components/ui/Dialog";
import { InvoiceItems } from "@/components/invoices/InvoiceItems";
import { InvoiceCollection } from "@/features/receivables/InvoiceCollection";
import { ReceivingSetup } from "@/features/receivables/ReceivingSetup";
import {
  PageHeader,
  Notice,
  LoadingRows,
  EmptyState,
} from "@/components/workspace/WorkspacePrimitives";
import { Receipt, Plus } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/formatMoney";
import {
  getChainName,
  getTokensForChain,
  getBlockExplorerTxUrl,
} from "@/lib/chains";
import {
  invoiceTotal,
  receivableAmounts,
  receivableStatus,
} from "../../shared/receivables";
import { exportToCsv, generateFilename } from "@/lib/csv";
import { formatBaseUnits } from "../../shared/validation";

function InvoiceEditor({
  orgId,
  safes,
  draft,
  onClose,
}: {
  orgId: Id<"orgs">;
  safes: Doc<"safes">[];
  draft?: Doc<"receivables">;
  onClose: () => void;
}) {
  const token = useSessionToken();
  const save = useMutation(api.receivables.create);
  const [safeId, setSafe] = useState(draft?.safeId ?? safes[0]?._id ?? "");
  const [currency, setCurrency] = useState(draft?.token ?? "USDC");
  const [number, setNumber] = useState(draft?.number ?? "");
  const [customerName, setCustomer] = useState(draft?.customerName ?? "");
  const [email, setEmail] = useState(draft?.customerEmail ?? "");
  const [date, setDate] = useState(
    new Date(draft?.dueDate ?? Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const [description, setDescription] = useState(draft?.description ?? "");
  const [items, setItems] = useState(
    draft?.items ?? [{ description: "", quantity: 1, unitPrice: "" }],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const safe = safes.find((s) => s._id === safeId);
  const supportedCurrencies = Object.values(
    getTokensForChain(safe?.chainId ?? 0),
  );
  const currencyAvailable = supportedCurrencies.some(
    (t) => t.symbol === currency,
  );
  const configurations = useQuery(
    api.receivables.configuration,
    token ? { orgId, sessionToken: token } : "skip",
  );
  const configuration = configurations?.find(
    (c) => c.chainId === safe?.chainId,
  );
  let total: string | undefined;
  try {
    total = invoiceTotal(items, currency);
  } catch {
    /* Incomplete lines do not have a payable total yet. */
  }
  return (
    <Dialog
      title={draft ? "Edit invoice draft" : "Create invoice"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!token || busy || !safeId) return;
          if (!safe) {
            setError(
              "Choose an active receiving account before saving this draft.",
            );
            return;
          }
          if (!currencyAvailable) {
            setError(
              "Choose an account that supports the invoice currency, or explicitly update the currency agreed with your customer.",
            );
            return;
          }
          setBusy(true);
          setError("");
          try {
            await save({
              orgId,
              sessionToken: token,
              invoiceId: draft?._id,
              safeId: safeId as Id<"safes">,
              number,
              customerName,
              customerEmail: email || undefined,
              token: currency,
              dueDate: new Date(`${date}T23:59:59Z`).getTime(),
              description,
              items,
            });
            onClose();
          } catch (e) {
            setError(userErrorMessage(e, "Could not save invoice."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="workspace-description">
          Create a customer invoice. Review it before generating its payment
          link.
        </p>
        {error && <Notice>{error}</Notice>}
        {safeId && !safe && (
          <Notice tone="info">
            The saved receiving account is archived or unavailable. Choose an
            active account to continue. Your invoice details are kept.
          </Notice>
        )}
        {!safes.length && (
          <Notice tone="info">
            Connect a business account before creating an invoice.{" "}
            <Link className="underline" to={`/org/${orgId}/settings?tab=safe`}>
              Connect an account
            </Link>
          </Notice>
        )}
        <fieldset disabled={busy} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="finance-label">Customer name</span>
              <input
                className="finance-field"
                required
                maxLength={200}
                value={customerName}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </label>
            <label>
              <span className="finance-label">Customer email (optional)</span>
              <input
                className="finance-field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              <span className="finance-label">Invoice number</span>
              <input
                className="finance-field"
                required
                maxLength={100}
                placeholder="INV-1001"
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
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              <span className="finance-label">Receive into</span>
              <select
                className="finance-field"
                required
                value={safeId}
                onChange={(e) => {
                  setSafe(e.target.value as Id<"safes">);
                }}
              >
                {!safe && (
                  <option value={safeId} disabled>
                    {safeId
                      ? "Saved account unavailable. Choose an account"
                      : "Choose a receiving account"}
                  </option>
                )}
                {safes.map((s) => (
                  <option key={s._id} value={s._id}>
                    {getChainName(s.chainId!)} · {s.safeAddress.slice(-6)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="finance-label">Invoice currency</span>
              <select
                className="finance-field"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {!currencyAvailable && (
                  <option value={currency} disabled>
                    {currency} · choose a compatible account or currency
                  </option>
                )}
                {supportedCurrencies.map((t) => (
                  <option key={t.symbol}>{t.symbol}</option>
                ))}
              </select>
            </label>
          </div>
          {configuration && !configuration.canIssue && (
            <Notice tone="info">
              You can save a draft for this account. Receiving payments on this
              network is not available yet.
            </Notice>
          )}
          <h3 className="font-semibold">Invoice items</h3>
          {items.map((item, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-lg border border-slate-400/20 p-3 sm:grid-cols-[1fr_90px_130px_auto]"
            >
              <label>
                <span className="finance-label">Item {index + 1}</span>
                <input
                  className="finance-field"
                  required
                  value={item.description}
                  onChange={(e) =>
                    setItems(
                      items.map((v, n) =>
                        n === index ? { ...v, description: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                <span className="finance-label">Quantity {index + 1}</span>
                <input
                  className="finance-field"
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={item.quantity}
                  onChange={(e) =>
                    setItems(
                      items.map((v, n) =>
                        n === index
                          ? { ...v, quantity: Number(e.target.value) }
                          : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                <span className="finance-label">Unit price {index + 1}</span>
                <input
                  className="finance-field"
                  required
                  inputMode="decimal"
                  value={item.unitPrice}
                  onChange={(e) =>
                    setItems(
                      items.map((v, n) =>
                        n === index ? { ...v, unitPrice: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="workspace-button self-end"
                aria-label={`Remove item ${index + 1}`}
                disabled={items.length === 1}
                onClick={() => setItems(items.filter((_, n) => n !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="workspace-button"
            disabled={items.length >= 50}
            onClick={() =>
              setItems([
                ...items,
                { description: "", quantity: 1, unitPrice: "" },
              ])
            }
          >
            Add item
          </button>
          <p className="flex justify-between gap-3 text-lg font-semibold">
            <span>Invoice total</span>
            <span>
              {total
                ? `${formatMoney(total, currency, true)} ${currency}`
                : "Complete the item amounts"}
            </span>
          </p>
          <label className="block">
            <span className="finance-label">
              Invoice note (visible to customer)
            </span>
            <textarea
              className="finance-field"
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </fieldset>
        <div className="flex justify-end gap-3">
          <button
            className="workspace-button"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="workspace-button workspace-button-primary"
            disabled={busy || !safe || !currencyAvailable}
          >
            {busy ? "Saving…" : "Save draft"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function InvoiceDetails({
  invoice,
  canManage,
  onClose,
  onEdit,
}: {
  invoice: Doc<"receivables">;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const sessionToken = useSessionToken();
  const issue = useAction(api.receivableActions.issue),
    refresh = useAction(api.receivableActions.refresh);
  const voidInvoice = useMutation(api.receivables.voidInvoice);
  const args = sessionToken ? { invoiceId: invoice._id, sessionToken } : null;
  const events = useQuery(api.receivables.receipts, args ?? "skip");
  const configurations = useQuery(
    api.receivables.configuration,
    sessionToken ? { orgId: invoice.orgId, sessionToken } : "skip",
  );
  const configuration = configurations?.find(
    (c) => c.chainId === invoice.chainId,
  );
  const receivingService = useReceivingService(
    invoice.safeId,
    invoice.state === "draft" && !!configuration?.canIssue,
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [messageTone, setMessageTone] = useState<"error" | "success" | "info">(
      "success",
    ),
    [voiding, setVoiding] = useState(false);
  const run = async (work: () => Promise<unknown>, success: string) => {
    if (busy || !args) return;
    setBusy(true);
    setMessage("");
    setMessageTone("success");
    try {
      const result = await work();
      if (
        result &&
        typeof result === "object" &&
        "tone" in result &&
        result.tone === "info"
      )
        setMessageTone("info");
      setMessage(
        result &&
          typeof result === "object" &&
          "message" in result &&
          typeof result.message === "string"
          ? userErrorMessage({ message: result.message }, success)
          : success,
      );
    } catch (e) {
      setMessageTone("error");
      setMessage(userErrorMessage(e, "Could not complete the action."));
    } finally {
      setBusy(false);
    }
  };
  const amounts = receivableAmounts(invoice);
  return (
    <Dialog
      title={`Invoice ${invoice.number}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">{invoice.customerName}</h3>
            <p className="workspace-description">
              Due {formatDate(invoice.dueDate)}
            </p>
          </div>
          <span className="workspace-status">{receivableStatus(invoice)}</span>
        </div>
        <p className="text-3xl font-semibold break-words">
          {formatMoney(invoice.amount, invoice.token, true)}{" "}
          <span className="text-base">{invoice.token}</span>
        </p>
        {BigInt(invoice.credited ?? "0") > 0n && (
          <p className="workspace-description">
            Original total shown above · credits {amounts.credited}{" "}
            {invoice.token} · adjusted total {amounts.adjustedTotal}{" "}
            {invoice.token}.
          </p>
        )}
        <p className="workspace-description">
          Receiving account: {getChainName(invoice.chainId)} ·{" "}
          {invoice.treasury.slice(0, 8)}…{invoice.treasury.slice(-6)}
        </p>
        <InvoiceItems items={invoice.items} token={invoice.token} />
        <ReceivableDocuments invoice={invoice} canManage={canManage} />
        {invoice.description && (
          <p className="whitespace-pre-wrap text-sm">{invoice.description}</p>
        )}
        {invoice.state === "draft" ? (
          <>
            <Notice tone="info">
              Generating a payment link fixes the receiving account, currency
              and amount for this invoice. Share the link yourself; no email is
              sent automatically.
            </Notice>
            <div className="rounded-lg border border-slate-400/20 p-4 text-sm space-y-2">
              <p className="font-semibold">Collection costs</p>
              <p>
                Creating this link needs no network transaction. A network fee
                applies when payments move to your account; the first collection
                also activates this invoice's receiving address.
              </p>
              <p>
                Your company account pays collection fees in USDC. Its owners
                review the complete fee before confirming. The invoice's full
                balance moves into that account.
              </p>
            </div>
            {configuration && !configuration.canIssue && (
              <Notice>
                Payment links are not available for this network yet. You can
                keep editing this draft.
              </Notice>
            )}
            {configuration?.canIssue && (
              <ReceivingSetup
                safeId={invoice.safeId}
                state={receivingService}
                canManage={canManage}
                busy={busy}
                onBusyChange={setBusy}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <>
                  <button
                    className="workspace-button"
                    disabled={busy}
                    onClick={onEdit}
                  >
                    Edit draft
                  </button>
                  <button
                    className="workspace-button workspace-button-primary"
                    disabled={
                      busy ||
                      !configuration?.canIssue ||
                      !receivingService.data?.ready
                    }
                    onClick={() =>
                      run(() => issue(args!), "Payment link created.")
                    }
                  >
                    Generate payment link
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["Received", amounts.received],
                ["Remaining", amounts.remaining],
                ["Awaiting collection", amounts.awaitingForwarding],
              ].map(([label, amount]) => (
                <div key={label}>
                  <p className="finance-label">{label}</p>
                  <strong>
                    {formatMoney(amount, invoice.token, true)} {invoice.token}
                  </strong>
                </div>
              ))}
            </div>
            <p className="workspace-description">
              Confirmed payments count toward the invoice. Collection moves
              those funds into your account.
            </p>
            <div className="rounded-lg border border-slate-400/20 p-4">
              <span className="finance-label">
                Unique receiving address · {getChainName(invoice.chainId)}
              </span>
              <code className="block break-all text-sm">
                {invoice.receivingAddress}
              </code>
            </div>
            {invoice.publicToken && (
              <div className="flex flex-wrap gap-2">
                <Link
                  className="workspace-button"
                  to={`/pay/${invoice.publicToken}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open customer invoice
                </Link>
                <button
                  className="workspace-button"
                  onClick={() =>
                    run(
                      () =>
                        navigator.clipboard.writeText(
                          `${window.location.origin}/pay/${invoice.publicToken}`,
                        ),
                      "Invoice link copied.",
                    )
                  }
                >
                  Copy payment link
                </button>
              </div>
            )}
            {invoice.syncError && <Notice>{invoice.syncError}</Notice>}
            <p className="workspace-description">
              {invoice.lastCheckedAt
                ? `Last checked ${new Date(invoice.lastCheckedAt).toLocaleString()}`
                : "Waiting for the first receipt check."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="workspace-button"
                disabled={busy}
                onClick={() =>
                  run(
                    () => refresh(args!),
                    "Payment check completed. Review the confirmed amounts above.",
                  )
                }
              >
                Check payments
              </button>
            </div>
            <InvoiceCollection
              invoice={invoice}
              canManage={canManage}
              busy={busy}
              onBusyChange={setBusy}
            />
            {!!events?.length && (
              <section>
                <h3 className="font-semibold mb-3">Confirmed activity</h3>
                <ul className="space-y-3">
                  {events.map((e) => (
                    <li
                      key={e._id}
                      className="flex justify-between gap-3 text-sm"
                    >
                      <span>
                        {e.kind === "received"
                          ? "Payment received"
                          : "Collected into account"}
                        <span className="workspace-table-secondary">
                          {formatMoney(
                            formatBaseUnits(BigInt(e.amount), invoice.token),
                            invoice.token,
                            true,
                          )}{" "}
                          {invoice.token} ·{" "}
                          {e.settledAt ? "Settled" : "Recorded"}{" "}
                          {formatDate(e.settledAt ?? e.recordedAt)}
                        </span>
                      </span>
                      <a
                        className="workspace-action-link"
                        href={getBlockExplorerTxUrl(invoice.chainId, e.txHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View transaction
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <ReceivableFollowUp
          key={`${invoice._id}:${invoice.followUpAt ?? ""}`}
          invoice={invoice}
          canManage={canManage}
        />
        <ReceivableCredits invoice={invoice} />
        {canManage &&
          invoice.state !== "void" &&
          invoice.received === "0" &&
          !invoice.credited && (
            <div className="border-t border-slate-400/20 pt-4">
              {voiding ? (
                <>
                  <p className="workspace-description">
                    {invoice.receivingAddress
                      ? "The invoice will stay in your records. Its address cannot be revoked; late payments will still be tracked and can be collected."
                      : "This draft will stay in your records as voided. No payment address has been issued."}
                  </p>
                  <button
                    className="workspace-button"
                    disabled={busy}
                    onClick={() =>
                      run(() => voidInvoice(args!), "Invoice voided.")
                    }
                  >
                    Confirm void
                  </button>
                </>
              ) : (
                <button
                  className="workspace-button"
                  disabled={busy}
                  onClick={() => setVoiding(true)}
                >
                  Void invoice
                </button>
              )}
            </div>
          )}
        {busy && <p role="status">Working…</p>}
        {message && <Notice tone={messageTone}>{message}</Notice>}
      </div>
    </Dialog>
  );
}
export default function Receivables() {
  const { environment } = useActivityEnvironment();
  const { orgId } = useParams();
  const sessionToken = useSessionToken();
  const { address } = useAccount();
  const args =
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip";
  const result = useQuery(
      api.receivables.list,
      args === "skip" ? args : { ...args, environment },
    ),
    allSafes = useQuery(api.safes.getForOrg, args),
    members = useQuery(api.orgs.listMembers, args);
  const safes = allSafes?.filter(
    (safe) => chainEnvironment(safe.chainId) === environment,
  );
  const role = members?.find(
    (m) =>
      m?.walletAddress.toLowerCase() === address?.toLowerCase() &&
      m?.status === "active",
  )?.role;
  const canManage =
    !!role && ["admin", "approver", "initiator", "clerk"].includes(role);
  const [editor, setEditor] = useState<Doc<"receivables"> | "new" | null>(null),
    [focus, setFocus] = useState<string | null>(null),
    [search, setSearch] = useState("");
  const [followUpsOnly, setFollowUpsOnly] = useState(false);
  const selected = result?.items.find((i) => i._id === focus),
    visible = result?.items.filter(
      (i) =>
        `${i.number} ${i.customerName}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!followUpsOnly ||
          (i.state === "issued" &&
            i.amounts.remaining !== "0" &&
            !!i.followUpAt &&
            i.followUpAt <= Date.now())),
    );
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Bill customers, track incoming payments, and collect funds into your account."
        actions={
          <>
            {!!result?.items.length && (
              <button
                className="workspace-button"
                onClick={() =>
                  exportToCsv(
                    generateFilename(`receivables_${environment}`),
                    result.items.map((i) => ({
                      number: i.number,
                      environment,
                      token_contract: i.tokenAddress,
                      customer: i.customerName,
                      network: getChainName(i.chainId),
                      currency: i.token,
                      amount: i.amount,
                      credited: i.amounts.credited,
                      adjusted_total: i.amounts.adjustedTotal,
                      received: i.amounts.received,
                      refunded: i.amounts.refunded,
                      remaining: i.amounts.remaining,
                      awaiting_forwarding: i.amounts.awaitingForwarding,
                      status: i.status,
                      address: i.receivingAddress ?? "",
                    })),
                    [
                      "number",
                      "environment",
                      "token_contract",
                      "customer",
                      "network",
                      "currency",
                      "amount",
                      "credited",
                      "adjusted_total",
                      "refunded",
                      "received",
                      "remaining",
                      "awaiting_forwarding",
                      "status",
                      "address",
                    ].map((key) => ({ key, label: key })),
                  )
                }
              >
                Export invoices
              </button>
            )}
            {canManage && (
              <button
                className="workspace-button workspace-button-primary"
                onClick={() => setEditor("new")}
              >
                <Plus size={16} />
                Create invoice
              </button>
            )}
          </>
        }
      />
      <div className="workspace-panel">
        <div className="p-5">
          <label>
            <span className="sr-only">Search customer or invoice</span>
            <input
              className="finance-field"
              placeholder="Search customer or invoice"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={followUpsOnly}
              onChange={(e) => setFollowUpsOnly(e.target.checked)}
            />
            Follow-ups due
          </label>
        </div>
        {!result ? (
          <LoadingRows />
        ) : !visible?.length ? (
          <EmptyState
            icon={Receipt}
            title={
              search ? "No invoices match your search" : "No customer invoices"
            }
            description={
              search
                ? "Try another customer or invoice number."
                : "Create an invoice and share its payment link. Each invoice has its own receiving address."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table
              className="workspace-table workspace-table-responsive"
              role="table"
            >
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    Invoice & customer
                  </th>
                  <th role="columnheader" scope="col">
                    Due
                  </th>
                  <th role="columnheader" scope="col">
                    Amount
                  </th>
                  <th role="columnheader" scope="col">
                    Status
                  </th>
                  <th role="columnheader" scope="col">
                    Collection
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {visible.map((i) => (
                  <tr role="row" key={i._id}>
                    <td role="cell" data-primary>
                      <button
                        className="workspace-action-link"
                        onClick={() => setFocus(i._id)}
                      >
                        {i.number}
                      </button>
                      <span className="workspace-table-secondary">
                        {i.customerName}
                      </span>
                    </td>
                    <td role="cell" data-label="Due date">
                      {formatDate(i.dueDate)}
                      {i.followUpAt &&
                        i.state === "issued" &&
                        i.amounts.remaining !== "0" && (
                          <span className="workspace-table-secondary">
                            {i.followUpAt <= Date.now()
                              ? "Follow-up due"
                              : "Follow up"}{" "}
                            {formatDate(i.followUpAt)}
                          </span>
                        )}
                    </td>
                    <td role="cell" data-label="Amount">
                      <strong>{formatMoney(i.amount, i.token, true)}</strong>
                      <span className="workspace-table-secondary">
                        {i.token} · {getChainName(i.chainId)}
                      </span>
                    </td>
                    <td role="cell" data-label="Status">
                      <span className="workspace-status">{i.status}</span>
                    </td>
                    <td role="cell" data-label="Collection">
                      {i.state === "draft"
                        ? "Not issued"
                        : BigInt(i.received) > BigInt(i.forwarded)
                          ? "Awaiting collection"
                          : BigInt(i.received) > 0n
                            ? "In account"
                            : i.state === "void"
                              ? "No collection due"
                              : "Awaiting payment"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result?.limited && (
          <p className="p-4 text-sm">Showing the latest 200 invoices.</p>
        )}
      </div>
      {editor && safes && (
        <InvoiceEditor
          orgId={orgId as Id<"orgs">}
          safes={safes.filter((s) => s.isActive !== false)}
          draft={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
      {selected && !editor && (
        <InvoiceDetails
          invoice={selected}
          canManage={canManage}
          onClose={() => setFocus(null)}
          onEdit={() => setEditor(selected)}
        />
      )}
    </>
  );
}
