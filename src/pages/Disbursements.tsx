import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { chainEnvironment } from "../../shared/assets";
import { paymentDebits } from "../../shared/executionFee";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowUpRight, Download, ListChecks, Plus } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { formatDate, formatMoney } from "@/lib/formatMoney";
import { exportToCsv, generateFilename } from "@/lib/csv";
import { getChainName } from "@/lib/chains";
import { PaymentBatchForm } from "@/components/payments/PaymentBatchForm";
import { PaymentReview } from "@/features/payments/PaymentReview";
import {
  EmptyState,
  LoadingRows,
  PageHeader,
  SearchField,
  StatusBadge,
} from "@/components/workspace/WorkspacePrimitives";
const views: Record<string, { label: string; status?: string[] }> = {
  all: { label: "All payments" },
  approvals: { label: "Awaiting approval", status: ["pending", "proposed"] },
  drafts: { label: "Drafts", status: ["draft"] },
  review: {
    label: "Needs review",
    status: ["draft", "pending", "proposed", "failed"],
  },
  attention: { label: "Needs attention", status: ["failed"] },
  upcoming: {
    label: "Upcoming",
    status: ["draft", "pending", "proposed", "scheduled"],
  },
  paid: { label: "Paid", status: ["executed"] },
  processing: { label: "Processing", status: ["relaying"] },
  cancelled: { label: "Cancelled", status: ["cancelled"] },
};
export default function Disbursements() {
  const { environment } = useActivityEnvironment();
  const { orgId } = useParams();
  const sessionToken = useSessionToken();
  const args =
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip";
  const [params, setParams] = useSearchParams();
  const view = views[params.get("view") ?? ""] ? params.get("view")! : "all";
  const [search, setSearch] = useState("");
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>(
    [undefined],
  );
  const [currency, setCurrency] = useState("");
  const result = useQuery(
    api.disbursements.list,
    args === "skip"
      ? args
      : {
          ...args,
          environment,
          recurringPaymentId: (params.get("schedule") || undefined) as
            Id<"recurringPayments"> | undefined,
          search: search || undefined,
          token: currency || undefined,
          status: views[view].status,
          includeRelayExceptions: view === "review" || view === "attention",
          includeOverdueScheduled: view === "review" || view === "attention",
          upcomingOnly: view === "upcoming",
          cursor: cursorHistory[cursorHistory.length - 1],
          limit: 20,
        },
  );
  const allSafes = useQuery(api.safes.getForOrg, args);
  const safes = allSafes?.filter(
    (safe) => chainEnvironment(safe.chainId) === environment,
  );
  const org = useQuery(api.orgs.get, args);
  const members = useQuery(api.orgs.listMembers, args);
  const session = useQuery(
    api.auth.validateSession,
    sessionToken ? { token: sessionToken } : "skip",
  );
  const role = members?.find(
    (m) => m?.userId === session?.userId && m?.status === "active",
  )?.role;
  const canManage = !!role && ["admin", "approver", "initiator"].includes(role);
  const title = (p: NonNullable<typeof result>["items"][number]) =>
    p.name ||
    p.memo ||
    p.recipientName ||
    p.beneficiary?.name ||
    "Payment batch";
  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const exportPage = () =>
    exportToCsv(
      generateFilename(`payments_page_${environment}`),
      (result?.items ?? []).map((p) => ({
        name: title(p),
        environment,
        network: getChainName(p.chainId ?? 0),
        chain_id: p.chainId ?? "",
        account_id: p.safeId,
        account_name: p.account?.name ?? "",
        account_address: p.account?.address ?? "",
        token_contract: p.tokenAddress ?? "",
        amount: p.totalAmount ?? p.amount,
        currency: p.token,
        fee_amount: p.executionFee?.amount ?? "",
        fee_currency: p.executionFee?.token ?? "",
        account_debits: paymentDebits(
          p.token,
          p.totalAmount ?? p.amount ?? "0",
          p.executionFee,
        )
          .map((v) => `${v.amount} ${v.token}`)
          .join(" + "),
        status: p.status,
        pay_date: p.scheduledAt ? new Date(p.scheduledAt).toISOString() : "",
        transaction_hash: p.txHash ?? "",
      })),
      [
        "name",
        "environment",
        "network",
        "chain_id",
        "account_id",
        "account_name",
        "account_address",
        "token_contract",
        "amount",
        "currency",
        "fee_amount",
        "fee_currency",
        "account_debits",
        "status",
        "pay_date",
        "transaction_hash",
      ].map((key) => ({ key, label: key })),
    );
  return (
    <>
      <PageHeader
        title="Payments"
        description="Prepare, approve, and track every payment in one place."
        actions={
          <>
            <button
              className="workspace-button"
              disabled={!result?.items.length}
              onClick={exportPage}
            >
              <Download size={14} />
              Export this page
            </button>
            {canManage && (
              <button
                className="workspace-button workspace-button-primary"
                onClick={() => setParam("new", "1")}
              >
                <Plus size={14} />
                New payment
              </button>
            )}
          </>
        }
      />
      {params.get("schedule") && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span>Showing payments generated by this schedule.</span>
          <button
            className="workspace-action-link"
            onClick={() => {
              setParam("schedule");
              setCursorHistory([undefined]);
            }}
          >
            Show all payments
          </button>
        </div>
      )}
      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div
            className="workspace-tabs"
            role="tablist"
            aria-label="Payment views"
          >
            {Object.entries(views).map(([key, item]) => (
              <button
                role="tab"
                key={key}
                aria-selected={key === view}
                onClick={() => {
                  setParam("view", key);
                  setCursorHistory([undefined]);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="workspace-toolbar">
          <SearchField
            placeholder="Search payment or recipient"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setCursorHistory([undefined]);
            }}
          />
          <select
            className="finance-field !w-auto"
            aria-label="Filter by currency"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setCursorHistory([undefined]);
            }}
          >
            <option value="">All currencies</option>
            {["USDC", "USDT", "PYUSD", "EURC"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        {result === undefined ? (
          <LoadingRows />
        ) : result.items.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={
              result.hasMore
                ? "No matching payments on this page"
                : search || view !== "all"
                  ? "No payments in this view"
                  : "Your first payment starts here"
            }
            description={
              result.hasMore
                ? "Continue to the next page to check more history, or narrow your filters."
                : search || view !== "all"
                  ? "Try another filter or search term."
                  : "Pay one person or a whole team using saved recipients. Review the amounts and choose when to pay."
            }
            action={
              canManage && (
                <button
                  className="workspace-button workspace-button-primary"
                  onClick={() => setParam("new", "1")}
                >
                  <Plus size={14} />
                  Prepare a payment
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
                    Payment
                  </th>
                  <th role="columnheader" scope="col">
                    Pay date
                  </th>
                  <th role="columnheader" scope="col">
                    Account
                  </th>
                  <th role="columnheader" scope="col" className="numeric">
                    Amount
                  </th>
                  <th role="columnheader" scope="col">
                    Status
                  </th>
                  <th role="columnheader" scope="col">
                    <span className="sr-only">Review payment</span>
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {result.items.map((p) => (
                  <tr role="row" key={p._id}>
                    <td role="cell" data-primary>
                      <button
                        className="workspace-table-primary text-left"
                        onClick={() => setParam("focus", p._id)}
                      >
                        {title(p)}
                      </button>
                      <span className="workspace-table-secondary">
                        {p.purpose === "payroll"
                          ? "Payroll"
                          : p.purpose === "invoice"
                            ? "Vendor bills"
                            : p.type === "batch"
                              ? "Payment batch"
                              : "Individual payment"}
                        {p.recurringPaymentId ? " · Recurring" : ""}
                      </span>
                    </td>
                    <td role="cell" data-label="Pay date">
                      {formatDate(p.scheduledAt, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </td>
                    <td role="cell" data-label="Account">
                      {p.account?.name ??
                        (p.chainId
                          ? getChainName(p.chainId) + " account"
                          : "Original account")}
                      <span className="workspace-table-secondary">
                        {getChainName(p.chainId ?? 0)}
                        {p.account?.archived ? " · Archived" : ""}
                      </span>
                    </td>
                    <td role="cell" data-label="Amount" className="numeric">
                      <strong>
                        {formatMoney(
                          p.totalAmount ?? p.amount ?? "0",
                          p.token,
                          true,
                        )}
                      </strong>
                      <span className="workspace-table-secondary">
                        {p.token}
                      </span>
                    </td>
                    <td role="cell" data-label="Status">
                      <StatusBadge {...paymentStatus(p)} />
                    </td>
                    <td role="cell" data-actions>
                      <button
                        className="workspace-action-link"
                        aria-label={`Review ${title(p)}`}
                        onClick={() => setParam("focus", p._id)}
                      >
                        Review
                        <ArrowUpRight size={14} />
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
            {result?.items.length ?? 0} payments on this page · Page{" "}
            {cursorHistory.length}
          </span>
          <div className="flex gap-2">
            <button
              className="workspace-button"
              disabled={cursorHistory.length < 2}
              onClick={() => setCursorHistory((h) => h.slice(0, -1))}
            >
              Previous
            </button>
            <button
              className="workspace-button"
              disabled={!result?.nextCursor}
              onClick={() => {
                if (result?.nextCursor)
                  setCursorHistory((h) => [...h, result.nextCursor!]);
              }}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {params.get("new") === "1" && canManage && (
        <PaymentBatchForm
          orgId={orgId as Id<"orgs">}
          initialPurpose="other"
          initialSafeId={params.get("account") as Id<"safes"> | undefined}
          initialChainId={
            params.has("chain") ? Number(params.get("chain")) : undefined
          }
          onClose={() => setParam("new")}
        />
      )}
      {params.get("focus") && (
        <PaymentReview
          key={params.get("focus")}
          id={params.get("focus") as Id<"disbursements">}
          orgId={orgId as Id<"orgs">}
          safes={safes}
          org={org}
          canManage={canManage}
          onClose={() => setParam("focus")}
        />
      )}
    </>
  );
}
import { paymentStatus } from "../../shared/paymentQueue";
