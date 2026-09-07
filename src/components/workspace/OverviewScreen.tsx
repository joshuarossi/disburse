import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Circle,
  FileCheck2,
  Plus,
  Receipt,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import {
  EmptyState,
  Metric,
  PageHeader,
  StatusBadge,
} from "./WorkspacePrimitives";
import { formatDate, formatMoney } from "@/lib/formatMoney";

export type OverviewPayment = {
  _id: string;
  displayName: string;
  token: string;
  amount?: string;
  totalAmount?: string;
  status: string;
  scheduledAt?: number;
  createdAt: number;
  purpose?: string;
};
export type OverviewModel = {
  needsReview: number;
  exceptionCount: number;
  draftCount: number;
  reviewedRecipients: number;
  recipientsNeedReview: number;
  exceptions: Array<OverviewPayment & { exceptionReason: string }>;
  drafts: OverviewPayment[];
  plannedDebits: Array<{ safeId: string; token: string; amount: string }>;
  plansIncomplete: boolean;
  unquotedFees: boolean;
  scheduledCount: number;
  overdueBills: number;
  incompleteRecipients: number;
  recipientCount: number;
  accountCount: number;
  review: OverviewPayment[];
  upcoming: OverviewPayment[];
  recent: OverviewPayment[];
  bills: Array<{
    _id: string;
    invoiceNumber: string;
    vendorName: string;
    dueDate: number;
    amount: string;
    token: string;
  }>;
  limitedHistory: boolean;
};
export function OverviewScreen({
  model,
  prefix,
  orgName,
  balances,
}: {
  model: OverviewModel;
  prefix: string;
  orgName: string;
  balances: Array<{
    label: string;
    amount: string | null;
    token: string;
    planned: string;
    remaining: string | null;
    ready: boolean;
    checkedAt?: number;
    loading: boolean;
  }>;
}) {
  const needSetup = !model.accountCount || !model.recipientCount;
  return (
    <>
      <PageHeader
        title="Overview"
        description={`Here's what's happening with ${orgName}'s payments.`}
        actions={
          <>
            <Link
              className="workspace-button"
              to={`${prefix}/beneficiaries?import=1`}
            >
              <Upload size={14} />
              Import recipients
            </Link>
            <Link className="workspace-button" to={`${prefix}/reports`}>
              <ArrowUpRight size={14} />
              View reports
            </Link>
            <Link
              className="workspace-button workspace-button-primary"
              to={`${prefix}/disbursements?new=1`}
            >
              <Plus size={14} />
              New payment
            </Link>
          </>
        }
      />
      {needSetup && (
        <section className="workspace-setup">
          <h2>Get your workspace ready for its first payment</h2>
          <div className="workspace-setup-steps">
            <Link to={`${prefix}/treasury`}>
              {model.accountCount ? (
                <CheckCircle2 size={15} />
              ) : (
                <Circle size={15} />
              )}
              Connect a funding account
            </Link>
            <Link to={`${prefix}/beneficiaries?import=1`}>
              {model.recipientCount ? (
                <CheckCircle2 size={15} />
              ) : (
                <Circle size={15} />
              )}
              Add your recipients
            </Link>
            <Link to={`${prefix}/disbursements?new=1`}>
              <Circle size={15} />
              Prepare a payment
            </Link>
          </div>
        </section>
      )}
      <div className="workspace-metrics">
        <Metric
          label="Awaiting approval"
          value={model.needsReview}
          detail="Payments prepared for team approval"
          href={`${prefix}/disbursements?view=approvals`}
        />
        <Metric
          label="Upcoming payments"
          value={model.scheduledCount}
          detail="Prepared for a future pay date"
          href={`${prefix}/disbursements?view=upcoming`}
        />
        <Metric
          label="Payment exceptions"
          value={model.exceptionCount}
          detail="Failed, delayed or past the approval deadline"
          tone={model.exceptionCount ? "warning" : undefined}
          href={`${prefix}/disbursements?view=attention`}
        />
        <Metric
          label="Reviewed recipients"
          value={model.reviewedRecipients}
          detail={
            model.recipientsNeedReview
              ? `${model.recipientsNeedReview} need details or review`
              : "Payout details approved; funding checked per payment"
          }
          href={`${prefix}/beneficiaries`}
        />
      </div>
      <div className="workspace-two-column">
        <div className="workspace-stack">
          {model.exceptions.length > 0 && (
            <section
              className="workspace-panel"
              aria-label="Payment exceptions"
            >
              <div className="workspace-panel-heading">
                <div>
                  <h2>Resolve payment exceptions</h2>
                  <p>Check the original payment before trying again.</p>
                </div>
                <Link to={`${prefix}/disbursements?view=attention`}>
                  View all <ArrowRight size={13} />
                </Link>
              </div>
              {model.exceptions.map((payment) => (
                <Link
                  key={payment._id}
                  className="workspace-list-row"
                  to={`${prefix}/disbursements?focus=${payment._id}`}
                >
                  <div>
                    <strong>{payment.displayName}</strong>
                    <p className="workspace-funding-warning">
                      {payment.exceptionReason}
                    </p>
                  </div>
                  <span className="text-right tabular-nums">
                    {formatMoney(
                      payment.totalAmount ?? payment.amount ?? "0",
                      payment.token,
                      true,
                    )}{" "}
                    {payment.token}
                  </span>
                </Link>
              ))}
            </section>
          )}
          <section className="workspace-panel">
            <div className="workspace-panel-heading">
              <div>
                <h2>
                  Awaiting approval{" "}
                  <span className="workspace-count">{model.needsReview}</span>
                </h2>
                <p>Review the details before payments move.</p>
              </div>
              <Link to={`${prefix}/disbursements?view=approvals`}>
                View all
                <ArrowRight size={13} />
              </Link>
            </div>
            {model.review.length ? (
              <>
                <div
                  className="divide-y divide-white/10 md:hidden"
                  data-testid="overview-payment-cards"
                >
                  {model.review.map((payment) => (
                    <Link
                      key={payment._id}
                      className="block space-y-3 p-4"
                      to={`${prefix}/disbursements?focus=${payment._id}`}
                      aria-label={`Review ${payment.displayName}`}
                    >
                      <strong className="block break-words text-sm">
                        {payment.displayName}
                      </strong>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-semibold tabular-nums">
                          {formatMoney(
                            payment.totalAmount ?? payment.amount ?? "0",
                            payment.token,
                            true,
                          )}{" "}
                          <span className="text-xs font-normal text-slate-400">
                            {payment.token}
                          </span>
                        </span>
                        <StatusBadge status={payment.status} />
                      </div>
                      <span className="block text-xs text-slate-400">
                        {payment.scheduledAt
                          ? `Pay ${formatDate(payment.scheduledAt)}`
                          : "As soon as approved"}
                      </span>
                    </Link>
                  ))}
                </div>
                <div className="workspace-table-wrap hidden md:block">
                  <table className="workspace-table">
                    <thead>
                      <tr>
                        <th>Payment</th>
                        <th>Pay date</th>
                        <th className="numeric">Amount</th>
                        <th>Status</th>
                        <th>
                          <span className="sr-only">Review</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.review.map((payment) => (
                        <tr key={payment._id}>
                          <td>
                            <div className="workspace-person">
                              <span className="workspace-avatar">
                                {payment.purpose === "invoice" ? (
                                  <Receipt size={16} />
                                ) : (
                                  <Users size={16} />
                                )}
                              </span>
                              <span>
                                <Link
                                  className="workspace-table-primary"
                                  to={`${prefix}/disbursements?focus=${payment._id}`}
                                >
                                  {payment.displayName}
                                </Link>
                                <span className="workspace-table-secondary">
                                  {payment.purpose === "payroll"
                                    ? "Payroll"
                                    : payment.purpose === "invoice"
                                      ? "Vendor payment"
                                      : "Team payment"}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td>
                            {formatDate(payment.scheduledAt, {
                              month: "short",
                              day: "numeric",
                              timeZone: "UTC",
                            })}
                          </td>
                          <td className="numeric">
                            <strong>
                              {formatMoney(
                                payment.totalAmount ?? payment.amount ?? "0",
                                payment.token,
                                true,
                              )}
                            </strong>
                            <span className="workspace-table-secondary">
                              {payment.token}
                            </span>
                          </td>
                          <td>
                            <StatusBadge status={payment.status} />
                          </td>
                          <td>
                            <Link
                              aria-label={`Review ${payment.displayName}`}
                              className="workspace-action-link"
                              to={`${prefix}/disbursements?focus=${payment._id}`}
                            >
                              <ArrowUpRight size={16} />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState
                icon={FileCheck2}
                title="No payments awaiting approval"
                description="Prepare a draft to send it to your team's approval queue."
              />
            )}
          </section>
          {model.drafts.length > 0 && (
            <section className="workspace-panel" aria-label="Payment drafts">
              <div className="workspace-panel-heading">
                <div>
                  <h2>
                    Drafts to prepare{" "}
                    <span className="workspace-count">{model.draftCount}</span>
                  </h2>
                  <p>
                    Check amounts and recipients before requesting approval.
                  </p>
                </div>
                <Link to={`${prefix}/disbursements?view=drafts`}>
                  View drafts <ArrowRight size={13} />
                </Link>
              </div>
              {model.drafts.map((payment) => (
                <Link
                  key={payment._id}
                  className="workspace-list-row"
                  to={`${prefix}/disbursements?focus=${payment._id}`}
                >
                  <div>
                    <strong>{payment.displayName}</strong>
                    <p>
                      {payment.scheduledAt
                        ? `Pay ${formatDate(payment.scheduledAt)}`
                        : "As soon as approved"}
                    </p>
                  </div>
                  <span className="text-right tabular-nums">
                    {formatMoney(
                      payment.totalAmount ?? payment.amount ?? "0",
                      payment.token,
                      true,
                    )}{" "}
                    {payment.token}
                  </span>
                </Link>
              ))}
            </section>
          )}
          <section className="workspace-panel">
            <div className="workspace-panel-heading">
              <div>
                <h2>Recent activity</h2>
                <p>A record of your team's payments.</p>
              </div>
              <Link to={`${prefix}/disbursements`}>
                All payments
                <ArrowRight size={13} />
              </Link>
            </div>
            {model.recent.length ? (
              model.recent.map((payment) => (
                <Link
                  key={payment._id}
                  className="workspace-list-row"
                  to={`${prefix}/disbursements?focus=${payment._id}`}
                >
                  <span className="workspace-avatar">
                    <ArrowUpRight size={15} />
                  </span>
                  <div>
                    <strong>{payment.displayName}</strong>
                    <p>
                      {formatDate(payment.createdAt)} · {payment.token}
                    </p>
                  </div>
                  <span className="text-right">
                    <strong>
                      {formatMoney(
                        payment.totalAmount ?? payment.amount ?? "0",
                        payment.token,
                        true,
                      )}
                    </strong>
                    <span className="mt-1 inline-block">
                      <StatusBadge status={payment.status} />
                    </span>
                  </span>
                </Link>
              ))
            ) : (
              <EmptyState
                icon={Receipt}
                title="Your payment history starts here"
                description="Completed and in-progress payments stay together with their approval and payment records."
              />
            )}
          </section>
        </div>
        <div className="workspace-stack">
          <section className="workspace-panel">
            <div className="workspace-panel-heading">
              <h2>Funds & planned payments</h2>
              <Link
                to={`${prefix}/treasury`}
                aria-label="View funding accounts"
              >
                <ArrowUpRight size={15} />
              </Link>
            </div>
            {balances.length ? (
              balances.map((balance, i) => (
                <div
                  className="border-b border-white/10 p-5 last:border-0"
                  key={`${balance.label}-${balance.token}-${i}`}
                >
                  <div className="mb-3 flex items-center gap-2">
                    <Wallet size={15} />
                    <strong>
                      {balance.label} · {balance.token}
                    </strong>
                  </div>
                  <dl className="space-y-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt>Current balance</dt>
                      <dd className="tabular-nums">
                        {balance.amount === null
                          ? balance.loading
                            ? "Checking…"
                            : "Unavailable"
                          : formatMoney(balance.amount, balance.token, true)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Planned payments</dt>
                      <dd className="tabular-nums">
                        {model.plansIncomplete
                          ? "Incomplete history"
                          : formatMoney(balance.planned, balance.token, true)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 font-semibold">
                      <dt>Remaining after plan</dt>
                      <dd className="tabular-nums">
                        {balance.remaining === null
                          ? "Unavailable"
                          : formatMoney(balance.remaining, balance.token, true)}
                      </dd>
                    </div>
                  </dl>
                  {balance.checkedAt && (
                    <p className="mt-3 text-xs text-slate-400">
                      Checked{" "}
                      {new Date(balance.checkedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                  {!balance.ready && (
                    <Link
                      className="workspace-action-link mt-3"
                      to={`${prefix}/treasury`}
                    >
                      Check payment availability <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              ))
            ) : (
              <div className="p-5">
                <p className="workspace-description">
                  Connect an account to see the funds available for payments.
                </p>
                <Link
                  to={`${prefix}/treasury`}
                  className="workspace-action-link mt-4"
                >
                  Set up funding
                  <ArrowRight size={13} />
                </Link>
              </div>
            )}
            <div className="workspace-table-footer">
              <span>
                Plan includes unpaid drafts and confirmed fees.
                {model.unquotedFees ? " Some fees are not quoted yet." : ""}{" "}
                Funds are not reserved.
              </span>
              <Link className="workspace-action-link" to={`${prefix}/treasury`}>
                Manage
              </Link>
            </div>
          </section>
          <section className="workspace-panel">
            <div className="workspace-panel-heading">
              <h2>Coming up</h2>
              <CalendarDays size={16} className="text-slate-400" />
            </div>
            {model.upcoming.length ? (
              model.upcoming.map((payment) => (
                <Link
                  className="workspace-list-row"
                  key={payment._id}
                  to={`${prefix}/disbursements?focus=${payment._id}`}
                >
                  <span className="workspace-date-tile">
                    <small>
                      {new Date(payment.scheduledAt!).toLocaleDateString(
                        undefined,
                        { month: "short", timeZone: "UTC" },
                      )}
                    </small>
                    {new Date(payment.scheduledAt!).getUTCDate()}
                  </span>
                  <div>
                    <strong>{payment.displayName}</strong>
                    <p>
                      {formatMoney(
                        payment.totalAmount ?? payment.amount ?? "0",
                        payment.token,
                        true,
                      )}{" "}
                      ·{" "}
                      {payment.status === "scheduled"
                        ? "Scheduled"
                        : "Approval needed"}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <p className="workspace-description p-5">
                No upcoming payments. Choose a pay date when you create your
                next batch.
              </p>
            )}
          </section>
          {model.bills.length > 0 && (
            <section className="workspace-panel">
              <div className="workspace-panel-heading">
                <h2>
                  Bills due next
                  {model.overdueBills ? ` · ${model.overdueBills} overdue` : ""}
                </h2>
                <Link to={`${prefix}/invoices`}>
                  View bills
                  <ArrowRight size={13} />
                </Link>
              </div>
              {model.bills.map((bill) => (
                <Link
                  key={bill._id}
                  className="workspace-list-row"
                  to={`${prefix}/invoices?focus=${bill._id}`}
                >
                  <div>
                    <strong>{bill.vendorName}</strong>
                    <p>
                      {bill.invoiceNumber} · Due{" "}
                      {formatDate(bill.dueDate, {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })}
                    </p>
                  </div>
                  <strong>{formatMoney(bill.amount, bill.token, true)}</strong>
                </Link>
              ))}
            </section>
          )}
        </div>
      </div>
      {model.limitedHistory && (
        <p className="workspace-description mt-5">
          Payment summaries cover the latest 5,000 records. Use Reports for the
          full history.
        </p>
      )}
    </>
  );
}
