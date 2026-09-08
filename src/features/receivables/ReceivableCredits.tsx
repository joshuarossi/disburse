import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { userErrorMessage } from "@/lib/userErrors";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { formatBaseUnits, amountToBaseUnits } from "../../../shared/validation";
import { payoutInstructionError } from "../../../shared/payoutInstructions";
import { recipientPayoutIssue } from "../../../shared/recipientAssurance";
import { formatDate, formatMoney } from "@/lib/formatMoney";
import { getChainName } from "@/lib/chains";
import { AccountingReview } from "@/features/accounting/AccountingReview";

export function ReceivableCredits({
  invoice,
}: {
  invoice: Doc<"receivables">;
}) {
  const sessionToken = useSessionToken(),
    navigate = useNavigate();
  const identity = sessionToken
    ? { invoiceId: invoice._id, sessionToken }
    : null;
  const details = useQuery(api.receivableWorkflows.details, identity ?? "skip");
  const [form, setForm] = useState<"credit" | "refund">();
  const scope =
    sessionToken && form === "refund"
      ? { orgId: invoice.orgId, sessionToken }
      : null;
  const recipients = useQuery(
      api.beneficiaries.list,
      scope ? { ...scope, activeOnly: true } : "skip",
    ),
    safes = useQuery(api.safes.getForOrg, scope ?? "skip");
  const issueCredit = useMutation(api.receivableWorkflows.issueCredit),
    prepareRefund = useMutation(api.receivableWorkflows.prepareRefund);
  const [number, setNumber] = useState(""),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState("");
  const [recipientId, setRecipient] = useState(""),
    [safeId, setSafe] = useState<string>(invoice.safeId);
  const [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [accountingCredit, setAccountingCredit] = useState<string>();
  const availableCredit = formatBaseUnits(
    amountToBaseUnits(invoice.amount, invoice.token) -
      BigInt(invoice.credited ?? "0"),
    invoice.token,
  );
  const open = (next: "credit" | "refund") => {
    setForm(next);
    setNumber(
      `CN-${invoice.number}-${(details?.credits.length ?? 0) + 1}`.slice(
        0,
        100,
      ),
    );
    setAmount("");
    setReason("");
    setRecipient("");
    setReviewed(false);
    setError("");
    setRequestId(crypto.randomUUID());
  };
  const eligible = recipients?.filter(
    (r) => !recipientPayoutIssue(r) && !payoutInstructionError(r, invoice),
  );
  const recipient = eligible?.find((r) => r._id === recipientId);
  const accounts = safes?.filter(
    (s) => s.isActive !== false && s.chainId === invoice.chainId,
  );
  const account = accounts?.find((s) => s._id === safeId);
  if (invoice.state === "draft") return null;
  return (
    <>
      <section
        aria-label="Credits and refunds"
        className="space-y-4 rounded-xl border border-slate-400/20 p-4"
      >
        <h3 className="font-semibold">Credits and refunds</h3>
        {!details ? (
          <p role="status">Loading adjustments…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [
                  "Credits issued",
                  formatBaseUnits(
                    BigInt(invoice.credited ?? "0"),
                    invoice.token,
                  ),
                ],
                ["Refunded", details.refunded],
                ["Available to refund", details.availableRefund],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="finance-label">{label}</p>
                  <p className="font-semibold">
                    {formatMoney(value, invoice.token, true)} {invoice.token}
                  </p>
                </div>
              ))}
            </div>
            {details.reserved !== "0" && (
              <p className="workspace-description">
                {details.reserved} {invoice.token} is reserved by existing
                refund requests. Open a request to approve, recover or cancel
                it.
              </p>
            )}
            {!!details.credits.length && (
              <ul className="space-y-3">
                {details.credits.map((c) => (
                  <li
                    key={c._id}
                    className="rounded-lg border border-slate-400/20 p-3 text-sm"
                  >
                    <p className="font-semibold">
                      {c.number} ·{" "}
                      {formatBaseUnits(BigInt(c.amountRaw), invoice.token)}{" "}
                      {invoice.token}
                    </p>
                    <p className="workspace-description">
                      Issued {formatDate(c.issuedAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{c.reason}</p>
                    <button
                      className="workspace-action-link mt-2"
                      onClick={() => setAccountingCredit(c._id)}
                    >
                      Reconcile credit {c.number}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!!details.refunds.length && (
              <ul className="space-y-2">
                {details.refunds.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {r.amount} {invoice.token} ·{" "}
                      {r.status === "executed" ? "Paid" : r.status}
                    </span>
                    <Link
                      className="workspace-action-link"
                      to={`/org/${invoice.orgId}/disbursements?focus=${r.id}`}
                    >
                      Open refund payment
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {!form && (
              <div className="flex flex-wrap gap-2">
                {details.canCredit &&
                  invoice.state === "issued" &&
                  availableCredit !== "0" && (
                    <button
                      className="workspace-button"
                      onClick={() => open("credit")}
                    >
                      Issue credit note
                    </button>
                  )}
                {details.canRefund && details.availableRefund !== "0" && (
                  <button
                    className="workspace-button"
                    onClick={() => open("refund")}
                  >
                    Prepare refund
                  </button>
                )}
              </div>
            )}
            {form && (
              <form
                className="space-y-4 border-t border-slate-400/20 pt-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (busy || !identity || !reviewed) return;
                  setBusy(true);
                  setError("");
                  try {
                    if (form === "credit") {
                      await issueCredit({
                        ...identity,
                        requestId,
                        number,
                        amount,
                        reason,
                        reviewed,
                      });
                      setForm(undefined);
                    } else {
                      if (!recipient || !account)
                        throw new Error(
                          "Choose a reviewed recipient and an active account.",
                        );
                      const id = await prepareRefund({
                        ...identity,
                        requestId,
                        beneficiaryId: recipient._id,
                        safeId: account._id,
                        amount,
                        reviewed,
                      });
                      navigate(
                        `/org/${invoice.orgId}/disbursements?focus=${id}`,
                      );
                    }
                  } catch (e) {
                    setError(
                      userErrorMessage(
                        e,
                        "The adjustment could not be saved. Review its details and retry.",
                      ),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h4 className="font-semibold">
                  {form === "credit"
                    ? "Issue a credit note"
                    : "Prepare a customer refund"}
                </h4>
                <p className="workspace-description">
                  {form === "credit"
                    ? "A credit reduces the amount requested. It preserves the issued invoice and does not send money. Issued credits cannot be edited."
                    : "Refunds use the customer's reviewed recipient details and the usual payment approvals. Confirm the destination with the customer before proceeding."}
                </p>
                {form === "credit" ? (
                  <>
                    <label className="block">
                      <span className="finance-label">Credit note number</span>
                      <input
                        className="finance-field"
                        value={number}
                        onChange={(e) => {
                          setNumber(e.target.value);
                          setReviewed(false);
                        }}
                        maxLength={100}
                        required
                        disabled={busy}
                      />
                    </label>
                    <label className="block">
                      <span className="finance-label">
                        Reason shown to the customer
                      </span>
                      <textarea
                        className="finance-field"
                        value={reason}
                        onChange={(e) => {
                          setReason(e.target.value);
                          setReviewed(false);
                        }}
                        minLength={5}
                        maxLength={1000}
                        required
                        disabled={busy}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="block">
                      <span className="finance-label">Refund recipient</span>
                      <select
                        className="finance-field"
                        value={recipient?._id ?? ""}
                        onChange={(e) => {
                          setRecipient(e.target.value);
                          setReviewed(false);
                        }}
                        required
                        disabled={busy}
                      >
                        <option value="">Choose a reviewed recipient</option>
                        {eligible?.map((r) => (
                          <option key={r._id} value={r._id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!eligible?.length && (
                      <p className="workspace-description">
                        Add and review the customer in Recipients with{" "}
                        {invoice.token} on {getChainName(invoice.chainId)}.
                      </p>
                    )}
                    {recipient && (
                      <div className="rounded-lg border border-slate-400/20 p-3 text-sm">
                        <p>
                          {recipient.name} · {invoice.token} ·{" "}
                          {getChainName(invoice.chainId)}
                        </p>
                        <code className="mt-1 block break-all">
                          {recipient.walletAddress}
                        </code>
                      </div>
                    )}
                    <label className="block">
                      <span className="finance-label">Refund from account</span>
                      <select
                        className="finance-field"
                        value={account?._id ?? ""}
                        onChange={(e) => {
                          setSafe(e.target.value);
                          setReviewed(false);
                        }}
                        required
                        disabled={busy}
                      >
                        <option value="">Choose an account</option>
                        {accounts?.map((a) => (
                          <option key={a._id} value={a._id}>
                            {a.name ?? "Company account"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label className="block">
                  <span className="finance-label">
                    {form === "credit" ? "Credit amount" : "Refund amount"} ·{" "}
                    {invoice.token}
                  </span>
                  <input
                    className="finance-field"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setReviewed(false);
                    }}
                    required
                    disabled={busy}
                  />
                </label>
                <p className="workspace-description">
                  Maximum{" "}
                  {form === "credit"
                    ? availableCredit
                    : details.availableRefund}{" "}
                  {invoice.token}.{" "}
                  {form === "refund" &&
                    "Your company account pays the separate execution fee in USDC when this payment is approved."}
                </p>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                    disabled={busy}
                    className="mt-1"
                  />
                  <span>
                    {form === "credit"
                      ? "I reviewed the credit amount and reason, and understand this credit will appear on the customer invoice."
                      : "I confirmed this reviewed recipient is the customer's refund destination and checked the refund amount."}
                  </span>
                </label>
                {error && <Notice>{error}</Notice>}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="workspace-button workspace-button-primary"
                    disabled={
                      busy ||
                      !reviewed ||
                      (form === "refund" && (!recipient || !account))
                    }
                  >
                    {busy
                      ? "Saving…"
                      : form === "credit"
                        ? "Issue credit"
                        : "Save refund draft"}
                  </button>
                  <button
                    type="button"
                    className="workspace-button"
                    disabled={busy}
                    onClick={() => setForm(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </section>
      {accountingCredit && (
        <AccountingReview
          orgId={invoice.orgId}
          source={{ kind: "credit_note", id: accountingCredit }}
          onClose={() => setAccountingCredit(undefined)}
        />
      )}
    </>
  );
}
