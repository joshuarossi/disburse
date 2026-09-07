import { chainEnvironment, configuredTokenAddress } from "../shared/assets";
import { environmentValidator } from "./lib/activityEnvironment";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import { isUpcomingPayment, paymentException } from "../shared/paymentQueue";
import { recipientPayoutIssue } from "../shared/recipientAssurance";
import { paymentDebits } from "../shared/executionFee";
import { amountToBaseUnits, formatBaseUnits } from "../shared/validation";

export const overview = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    environment: v.optional(environmentValidator),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);
    const [payments, recipients, bills, safes] = await Promise.all([
      ctx.db
        .query("disbursements")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .order("desc")
        .take(5001),
      ctx.db
        .query("beneficiaries")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect(),
      ctx.db
        .query("invoices")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect(),
      ctx.db
        .query("safes")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect(),
    ]);
    const environment = args.environment ?? "production";
    const scoped = payments
      .slice(0, 5000)
      .filter((p) => chainEnvironment(p.chainId) === environment);
    const now = Date.now();
    const unpaid = [];
    for (const bill of bills) {
      if (bill.voidedAt) continue;
      const payment = bill.disbursementId
        ? await ctx.db.get(bill.disbursementId)
        : null;
      if (!payment || payment.status === "cancelled") {
        const vendor = await ctx.db.get(bill.beneficiaryId);
        unpaid.push({
          ...bill,
          vendorName: vendor?.name ?? "Archived recipient",
        });
      }
    }
    const decorate = async (payment: (typeof scoped)[number]) => ({
      ...payment,
      displayName:
        payment.name ||
        payment.memo ||
        payment.recipientName ||
        (payment.beneficiaryId
          ? (await ctx.db.get(payment.beneficiaryId))?.name
          : null) ||
        "Payment batch",
    });
    const exceptions = scoped.filter((p) => paymentException(p, now));
    const review = scoped.filter(
      (p) =>
        ["pending", "proposed"].includes(p.status) && !paymentException(p, now),
    );
    const drafts = scoped.filter(
      (p) => p.status === "draft" && !paymentException(p, now),
    );
    const totals = new Map<
      string,
      { safeId: string; token: string; units: bigint }
    >();
    let plansIncomplete = payments.length > 5000;
    let unquotedFees = false;
    for (const payment of scoped) {
      if (["executed", "cancelled"].includes(payment.status)) continue;
      const canonical = configuredTokenAddress(payment.chainId, payment.token);
      if (
        !payment.safeId ||
        !canonical ||
        (payment.tokenAddress &&
          payment.tokenAddress.toLowerCase() !== canonical.toLowerCase())
      ) {
        plansIncomplete = true;
        continue;
      }
      try {
        if (!payment.executionFee) unquotedFees = true;
        for (const debit of paymentDebits(
          payment.token,
          payment.totalAmount ?? payment.amount ?? "0",
          payment.executionFee,
        )) {
          const key = `${payment.safeId}:${debit.token}`;
          const previous = totals.get(key);
          totals.set(key, {
            safeId: payment.safeId,
            token: debit.token,
            units:
              (previous?.units ?? 0n) +
              amountToBaseUnits(debit.amount, debit.token),
          });
        }
      } catch {
        plansIncomplete = true;
      }
    }
    const scheduled = scoped
      .filter((p) => isUpcomingPayment(p, now))
      .sort((a, b) => a.scheduledAt! - b.scheduledAt!);
    return {
      needsReview: review.length,
      exceptionCount: exceptions.length,
      draftCount: drafts.length,
      reviewedRecipients: recipients.filter(
        (r) => r.isActive && !recipientPayoutIssue(r),
      ).length,
      recipientsNeedReview: recipients.filter(
        (r) => r.isActive && recipientPayoutIssue(r),
      ).length,
      exceptions: await Promise.all(
        exceptions
          .slice(0, 5)
          .map(async (p) => ({
            ...(await decorate(p)),
            exceptionReason: paymentException(p, now)!,
          })),
      ),
      drafts: await Promise.all(drafts.slice(0, 4).map(decorate)),
      plannedDebits: [...totals.values()].map((d) => ({
        safeId: d.safeId,
        token: d.token,
        amount: formatBaseUnits(d.units, d.token),
      })),
      plansIncomplete,
      unquotedFees,
      scheduledCount: scheduled.length,
      overdueBills: unpaid.filter((b) => isBillOverdue(b.dueDate, now)).length,
      incompleteRecipients: recipients.filter(
        (r) => r.isActive && !r.walletAddress,
      ).length,
      recipientCount: recipients.filter((r) => r.isActive).length,
      accountCount: safes.filter(
        (s) =>
          s.isActive !== false && chainEnvironment(s.chainId) === environment,
      ).length,
      review: await Promise.all(review.slice(0, 5).map(decorate)),
      upcoming: await Promise.all(scheduled.slice(0, 4).map(decorate)),
      recent: await Promise.all(scoped.slice(0, 6).map(decorate)),
      bills: unpaid.sort((a, b) => a.dueDate - b.dueDate).slice(0, 4),
      limitedHistory: payments.length > 5000,
    };
  },
});
import { isBillOverdue } from "../shared/dueDate";
