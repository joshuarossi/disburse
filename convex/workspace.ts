import { chainEnvironment, configuredTokenAddress } from "../shared/assets";
import { CHAIN_NAMES } from "../shared/chains";
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
    const environment = args.environment ?? "production";
    const chains = Object.keys(CHAIN_NAMES)
      .map(Number)
      .filter((id) => chainEnvironment(id) === environment);
    const statuses = [
      "draft",
      "pending",
      "proposed",
      "scheduled",
      "relaying",
      "failed",
    ] as const;
    const bucketLimit = 200;
    // Closed history must never push an old unpaid item out of the overview.
    // Each status/network bucket is independently bounded and reports truncation.
    const [paymentBuckets, recentBuckets, recipientPage, billPage, safePage] =
      await Promise.all([
        Promise.all(
          statuses.flatMap((status) =>
            chains.length
              ? chains.map((chainId) =>
                  ctx.db
                    .query("disbursements")
                    .withIndex("by_org_status_chain", (q) =>
                      q
                        .eq("orgId", args.orgId)
                        .eq("status", status)
                        .eq("chainId", chainId),
                    )
                    .order("desc")
                    .take(bucketLimit + 1),
                )
              : [
                  ctx.db
                    .query("disbursements")
                    .withIndex("by_org_status", (q) =>
                      q.eq("orgId", args.orgId).eq("status", status),
                    )
                    .order("desc")
                    .take(bucketLimit + 1),
                ],
          ),
        ),
        Promise.all(
          chains.length
            ? chains.map((chainId) =>
                ctx.db
                  .query("disbursements")
                  .withIndex("by_org_chain", (q) =>
                    q.eq("orgId", args.orgId).eq("chainId", chainId),
                  )
                  .order("desc")
                  .take(6),
              )
            : [
                ctx.db
                  .query("disbursements")
                  .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
                  .order("desc")
                  .take(100),
              ],
        ),
        ctx.db
          .query("beneficiaries")
          .withIndex("by_org_active", (q) =>
            q.eq("orgId", args.orgId).eq("isActive", true),
          )
          .take(1001),
        ctx.db
          .query("invoices")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .take(1001),
        ctx.db
          .query("safes")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .take(101),
      ]);
    const recipients = recipientPage.slice(0, 1000),
      bills = billPage.slice(0, 1000),
      safes = safePage.slice(0, 100);
    const limitedHistory =
      paymentBuckets.some((rows) => rows.length > bucketLimit) ||
      recipientPage.length > 1000 ||
      billPage.length > 1000 ||
      safePage.length > 100 ||
      (environment === "unclassified" && recentBuckets[0]?.length === 100);
    const scoped = paymentBuckets
      .flatMap((rows) => rows.slice(0, bucketLimit))
      .filter((p) => chainEnvironment(p.chainId) === environment)
      .sort(
        (a, b) =>
          b._creationTime - a._creationTime || b._id.localeCompare(a._id),
      );
    const recent = recentBuckets
      .flat()
      .filter((p) => chainEnvironment(p.chainId) === environment)
      .sort(
        (a, b) =>
          b._creationTime - a._creationTime || b._id.localeCompare(a._id),
      )
      .slice(0, 6);
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
    let plansIncomplete = limitedHistory;
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
        exceptions.slice(0, 5).map(async (p) => ({
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
      recent: await Promise.all(recent.map(decorate)),
      bills: unpaid.sort((a, b) => a.dueDate - b.dueDate).slice(0, 4),
      limitedHistory,
    };
  },
});
import { isBillOverdue } from "../shared/dueDate";
