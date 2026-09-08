import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import {
  ORG_READER_ROLES,
  RECORD_EDITOR_ROLES,
  PAYMENT_OPERATOR_ROLES,
} from "../shared/roles";
import { appendAudit } from "./audit";
import { amountToBaseUnits, formatBaseUnits } from "../shared/validation";
import { receivableAmounts } from "../shared/receivables";
import { receivableRefunds } from "./lib/receivableAdjustments";
import { prepareRun } from "./paymentRuns";

const identity = { invoiceId: v.id("receivables"), sessionToken: v.string() };
const requestIdentity = (requestId: string) => {
  if (!/^[a-f0-9-]{32,64}$/i.test(requestId))
    throw new Error(
      "This request needs a valid reference. Reopen the invoice and retry.",
    );
};
export const details = query({
  args: identity,
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    const { membership } = await requireOrgAccess(
      ctx,
      invoice.orgId,
      args.sessionToken,
      [...ORG_READER_ROLES],
    );
    const credits = await ctx.db
      .query("receivableCreditNotes")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
      .order("desc")
      .take(101);
    if (credits.length > 100)
      throw new Error("This invoice exceeds the 100-credit-note review limit.");
    const refunds = await receivableRefunds(ctx, invoice);
    return {
      credits,
      refunds: refunds.payments.map((p) => ({
        id: p._id,
        name: p.name,
        amount: p.totalAmount ?? p.amount!,
        status: p.status,
      })),
      availableRefund: formatBaseUnits(
        BigInt(refunds.available),
        invoice.token,
      ),
      refunded: formatBaseUnits(BigInt(refunds.refunded), invoice.token),
      reserved: formatBaseUnits(BigInt(refunds.reserved), invoice.token),
      canCredit: membership.role === "admin" || membership.role === "approver",
      canRefund: PAYMENT_OPERATOR_ROLES.includes(membership.role),
    };
  },
});
export const issueCredit = mutation({
  args: {
    ...identity,
    requestId: v.string(),
    number: v.string(),
    amount: v.string(),
    reason: v.string(),
    reviewed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    const { user } = await requireOrgAccess(
      ctx,
      invoice.orgId,
      args.sessionToken,
      ["admin", "approver"],
    );
    requestIdentity(args.requestId);
    if (!args.reviewed)
      throw new Error(
        "Review the credit amount and reason before issuing the credit note.",
      );
    const amount = amountToBaseUnits(args.amount, invoice.token),
      number = args.number.trim(),
      reason = args.reason.trim();
    if (
      !number ||
      number.length > 100 ||
      reason.length < 5 ||
      reason.length > 1000 ||
      [...number].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error(
        "Enter a credit note number and a reason of 5 to 1,000 characters.",
      );
    const existing = await ctx.db
      .query("receivableCreditNotes")
      .withIndex("by_invoice_request", (q) =>
        q.eq("invoiceId", invoice._id).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (
        existing.amountRaw !== String(amount) ||
        existing.number !== number ||
        existing.reason !== reason
      )
        throw new Error(
          "This credit request changed. Open the saved credit note before preparing another.",
        );
      return existing._id;
    }
    if (invoice.state !== "issued")
      throw new Error("Credit notes can only adjust an issued invoice.");
    const credited = BigInt(invoice.credited ?? "0"),
      original = amountToBaseUnits(invoice.amount, invoice.token);
    if (amount <= 0n || credited + amount > original)
      throw new Error(
        "The credit cannot exceed the invoice amount that has not already been credited.",
      );
    const notes = await ctx.db
      .query("receivableCreditNotes")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
      .take(100);
    if (notes.length >= 100)
      throw new Error("An invoice can have up to 100 credit notes.");
    const duplicate = await ctx.db
      .query("receivableCreditNotes")
      .withIndex("by_org_number", (q) =>
        q
          .eq("orgId", invoice.orgId)
          .eq("normalizedNumber", number.toLowerCase()),
      )
      .first();
    if (duplicate)
      throw new Error(
        "This workspace already has a credit note with that number.",
      );
    const now = Date.now();
    const id = await ctx.db.insert("receivableCreditNotes", {
      orgId: invoice.orgId,
      invoiceId: invoice._id,
      number,
      normalizedNumber: number.toLowerCase(),
      requestId: args.requestId,
      amountRaw: String(amount),
      reason,
      issuedAt: now,
      createdBy: user._id,
    });
    await ctx.db.patch(invoice._id, {
      credited: String(credited + amount),
      updatedAt: now,
    });
    await appendAudit(ctx, {
      orgId: invoice.orgId,
      actorUserId: user._id,
      action: "receivable.credit_issued",
      objectType: "receivable",
      objectId: invoice._id,
      metadata: {
        creditNoteId: id,
        number,
        amount: formatBaseUnits(amount, invoice.token),
        reason,
      },
      timestamp: now,
    });
    return id;
  },
});
export const prepareRefund = mutation({
  args: {
    ...identity,
    requestId: v.string(),
    beneficiaryId: v.id("beneficiaries"),
    safeId: v.id("safes"),
    amount: v.string(),
    reviewed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    const { user } = await requireOrgAccess(
      ctx,
      invoice.orgId,
      args.sessionToken,
      [...PAYMENT_OPERATOR_ROLES],
    );
    requestIdentity(args.requestId);
    if (!args.reviewed)
      throw new Error(
        "Confirm the customer's reviewed refund recipient before preparing this payment.",
      );
    const amount = amountToBaseUnits(args.amount, invoice.token);
    const existing = await ctx.db
      .query("disbursements")
      .withIndex("by_refund_request", (q) =>
        q
          .eq("refundInvoiceId", invoice._id)
          .eq("refundRequestId", args.requestId),
      )
      .unique();
    if (existing) {
      const recipients = await ctx.db
        .query("disbursementRecipients")
        .withIndex("by_disbursement", (q) =>
          q.eq("disbursementId", existing._id),
        )
        .take(2);
      if (
        existing.orgId !== invoice.orgId ||
        existing.safeId !== args.safeId ||
        existing.totalAmount !== formatBaseUnits(amount, invoice.token) ||
        recipients.length !== 1 ||
        recipients[0].beneficiaryId !== args.beneficiaryId
      )
        throw new Error(
          "This refund request changed. Open its saved payment before preparing another.",
        );
      return existing._id;
    }
    if (invoice.state === "draft")
      throw new Error("An unissued invoice has no customer refund to prepare.");
    const summary = await receivableRefunds(ctx, invoice);
    if (amount <= 0n || amount > BigInt(summary.available))
      throw new Error(
        "The refund exceeds the confirmed credit or overpayment available after other refund requests.",
      );
    if (summary.payments.length >= 100)
      throw new Error("This invoice has reached the 100-refund review limit.");
    // The ordinary pay-run builder enforces active, approved recipients, saved
    // currency/network instructions, funding-account access and member limits.
    // Observed receipt senders are never passed into this payment path.
    const id = await prepareRun(
      ctx,
      {
        orgId: invoice.orgId,
        safeId: args.safeId,
        chainId: invoice.chainId,
        token: invoice.token,
        name: `Refund · ${invoice.number}`.slice(0, 120),
        purpose: "other",
        recipients: [
          {
            beneficiaryId: args.beneficiaryId,
            amount: formatBaseUnits(amount, invoice.token),
          },
        ],
      },
      user._id,
    );
    await ctx.db.patch(id, {
      refundInvoiceId: invoice._id,
      refundRequestId: args.requestId,
    });
    await appendAudit(ctx, {
      orgId: invoice.orgId,
      actorUserId: user._id,
      action: "receivable.refund_prepared",
      objectType: "receivable",
      objectId: invoice._id,
      metadata: {
        disbursementId: id,
        beneficiaryId: args.beneficiaryId,
        amount: formatBaseUnits(amount, invoice.token),
      },
      timestamp: Date.now(),
    });
    return id;
  },
});
export const setFollowUp = mutation({
  args: { ...identity, at: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    const { user } = await requireOrgAccess(
      ctx,
      invoice.orgId,
      args.sessionToken,
      [...RECORD_EDITOR_ROLES],
    );
    if (
      args.at !== undefined &&
      (!Number.isSafeInteger(args.at) ||
        args.at < 1 ||
        args.at > Date.now() + 366 * 86400000)
    )
      throw new Error("Choose a follow-up date within the next year.");
    if (
      args.at !== undefined &&
      (invoice.state !== "issued" ||
        receivableAmounts(invoice).remaining === "0")
    )
      throw new Error(
        "Only an issued invoice with an unpaid balance needs a follow-up.",
      );
    await ctx.db.patch(invoice._id, { followUpAt: args.at });
    await appendAudit(ctx, {
      orgId: invoice.orgId,
      actorUserId: user._id,
      action: "receivable.follow_up_updated",
      objectType: "receivable",
      objectId: invoice._id,
      metadata: { at: args.at },
      timestamp: Date.now(),
    });
  },
});
export const reminderPrepared = mutation({
  args: { ...identity, requestId: v.string() },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    const { user } = await requireOrgAccess(
      ctx,
      invoice.orgId,
      args.sessionToken,
      [...RECORD_EDITOR_ROLES],
    );
    requestIdentity(args.requestId);
    if (invoice.lastReminderRequestId === args.requestId) return;
    if (
      invoice.state !== "issued" ||
      receivableAmounts(invoice).remaining === "0"
    )
      throw new Error("This invoice no longer needs a payment reminder.");
    const now = Date.now();
    await ctx.db.patch(invoice._id, {
      lastReminderPreparedAt: now,
      lastReminderRequestId: args.requestId,
      followUpAt: undefined,
    });
    await appendAudit(ctx, {
      orgId: invoice.orgId,
      actorUserId: user._id,
      action: "receivable.reminder_prepared",
      objectType: "receivable",
      objectId: invoice._id,
      metadata: { delivery: "customer_email_application" },
      timestamp: now,
    });
  },
});
