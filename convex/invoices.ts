import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrgAccess } from './lib/rbac';
import { amountToBaseUnits, formatBaseUnits } from './lib/validation';
import { assertFutureSchedule } from './lib/disbursementPolicy';
import { prepareRun } from './paymentRuns';
import { appendAudit } from './audit';
import type { Id } from './_generated/dataModel';
import { attachInvoiceFiles } from './invoiceFiles';
import { fingerprint } from '../shared/fingerprint';

export const create = mutation({
  args: {
    sourceFileIds: v.optional(v.array(v.id('invoiceFiles'))),
    sourceReviewed: v.optional(v.boolean()), requestId: v.optional(v.string()),
    orgId: v.id('orgs'),
    sessionToken: v.string(),
    beneficiaryId: v.id('beneficiaries'),
    invoiceNumber: v.string(),
    amount: v.string(),
    token: v.string(),
    dueDate: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ['admin', 'approver', 'initiator', 'clerk'],
    );
    const beneficiary = await ctx.db.get(args.beneficiaryId);
    if (
      !beneficiary ||
      beneficiary.orgId !== args.orgId ||
      !beneficiary.isActive
    )
      throw new Error('Choose an active recipient from this organization');
    if (args.requestId && !/^[a-f0-9-]{32,64}$/i.test(args.requestId)) throw new Error('Invalid bill request');
    const requestHash = fingerprint({ beneficiaryId: args.beneficiaryId, invoiceNumber: args.invoiceNumber.trim(), amount: args.amount, token: args.token, dueDate: args.dueDate, description: args.description, sourceFileIds: args.sourceFileIds ?? [], sourceReviewed: args.sourceReviewed });
    if (args.requestId) {
      const receipt = await ctx.db.query('invoices').withIndex('by_org_request', q => q.eq('orgId', args.orgId).eq('requestId', args.requestId)).unique();
      if (receipt) {
        if (receipt.createdBy !== user._id || receipt.requestHash !== requestHash) throw new Error('This bill request has already been saved with different details. Open the saved bill before making changes.');
        return receipt._id;
      }
    }
    const invoiceNumber = args.invoiceNumber.trim();
    if (!invoiceNumber || invoiceNumber.length > 100)
      throw new Error('Enter an invoice number of 1 to 100 characters');
    const normalizedNumber = invoiceNumber.toLowerCase();
    const existing = await ctx.db
      .query('invoices')
      .withIndex('by_org_vendor_number', (q) =>
        q
          .eq('orgId', args.orgId)
          .eq('beneficiaryId', args.beneficiaryId)
          .eq('normalizedNumber', normalizedNumber),
      )
      .first();
    if (existing)
      throw new Error('This vendor already has an invoice with that number');
    const amount = formatBaseUnits(
      amountToBaseUnits(args.amount, args.token),
      args.token,
    );
    if (
      !Number.isSafeInteger(args.dueDate) ||
      args.dueDate <= 0 ||
      args.dueDate > 8640000000000000
    )
      throw new Error('Enter a valid due date');
    if ((args.description?.length ?? 0) > 2000)
      throw new Error('Keep the description under 2000 characters');
    const now = Date.now();
    const invoiceId = await ctx.db.insert('invoices', {
      requestId: args.requestId, requestHash: args.requestId ? requestHash : undefined,
      orgId: args.orgId,
      beneficiaryId: args.beneficiaryId,
      invoiceNumber,
      normalizedNumber,
      amount,
      token: args.token.toUpperCase(),
      dueDate: args.dueDate,
      description: args.description?.trim(),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await attachInvoiceFiles(ctx, invoiceId, user._id, args.sourceFileIds ?? [], args.sourceReviewed);
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: 'invoice.created',
      objectType: 'invoice',
      objectId: invoiceId,
      metadata: { invoiceNumber, amount, token: args.token.toUpperCase() },
      timestamp: now,
    });
    return invoiceId;
  },
});

export const list = query({
  args: { orgId: v.id('orgs'), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      'admin',
      'approver',
      'initiator',
      'clerk',
      'viewer',
    ]);
    const invoices = await ctx.db
      .query('invoices')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect();
    return Promise.all(
      invoices
        .sort((a, b) => a.dueDate - b.dueDate)
        .map(async (invoice) => {
          const beneficiary = await ctx.db.get(invoice.beneficiaryId);
          const payment = invoice.disbursementId
            ? await ctx.db.get(invoice.disbursementId)
            : null;
          const status = invoice.voidedAt
            ? 'void'
            : payment?.status === 'executed'
              ? 'paid'
              : payment && payment.status !== 'cancelled'
                ? 'in_payment'
                : 'unpaid';
          return {
            ...invoice,
            vendorName: beneficiary?.name ?? 'Archived recipient',
            status,
            paymentStatus: payment?.status,
            txHash: payment?.txHash,
            chainId: payment?.chainId,
          };
        }),
    );
  },
});

export const preparePayment = mutation({
  args: {
    orgId: v.id('orgs'),
    sessionToken: v.string(),
    invoiceIds: v.array(v.id('invoices')),
    chainId: v.number(),
    safeId: v.optional(v.id("safes")),
    payDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ['admin', 'approver', 'initiator'],
    );
    if (args.payDate !== undefined)
      assertFutureSchedule(args.payDate, Date.now());
    if (
      !args.invoiceIds.length ||
      args.invoiceIds.length > 100 ||
      new Set(args.invoiceIds).size !== args.invoiceIds.length
    )
      throw new Error('Choose between 1 and 100 different invoices');
    const invoices = [];
    const totals = new Map<Id<'beneficiaries'>, bigint>();
    for (const id of args.invoiceIds) {
      const invoice = await ctx.db.get(id);
      if (!invoice || invoice.orgId !== args.orgId)
        throw new Error('Invoice not found in this organization');
      if (invoice.voidedAt) throw new Error('A voided bill cannot be paid');
      if (invoice.disbursementId) {
        const payment = await ctx.db.get(invoice.disbursementId);
        if (payment && payment.status !== 'cancelled')
          throw new Error(
            `Invoice ${invoice.invoiceNumber} already has a payment. Review that payment before trying again.`,
          );
      }
      if (invoices.length && invoices[0].token !== invoice.token)
        throw new Error(
          'Select invoices in the same currency for one payment batch',
        );
      invoices.push(invoice);
      totals.set(
        invoice.beneficiaryId,
        (totals.get(invoice.beneficiaryId) ?? 0n) +
          amountToBaseUnits(invoice.amount, invoice.token),
      );
    }
    const token = invoices[0].token;
    const name =
      invoices.length === 1
        ? `Invoice ${invoices[0].invoiceNumber}`
        : `${invoices.length} vendor invoices · ${new Date(args.payDate ?? Date.now()).toISOString().slice(0, 10)}`;
    const disbursementId = await prepareRun(
      ctx,
      {
        orgId: args.orgId,
        name,
        purpose: 'invoice',
        chainId: args.chainId,
        safeId: args.safeId,
        token,
        payDate: args.payDate,
        recipients: [...totals].map(([beneficiaryId, amount]) => ({
          beneficiaryId,
          amount: formatBaseUnits(amount, token),
        })),
      },
      user._id,
    );
    for (const invoice of invoices) {
      await ctx.db.patch(invoice._id, {
        disbursementId,
        updatedAt: Date.now(),
      });
      await appendAudit(ctx, {
        orgId: args.orgId,
        actorUserId: user._id,
        action: 'invoice.payment_prepared',
        objectType: 'invoice',
        objectId: invoice._id,
        metadata: { disbursementId },
        timestamp: Date.now(),
      });
    }
    return { disbursementId };
  },
});

export const update = mutation({
  args: {
    expectedUpdatedAt: v.optional(v.number()),
    sourceFileIds: v.optional(v.array(v.id('invoiceFiles'))),
    sourceReviewed: v.optional(v.boolean()),
    invoiceId: v.id('invoices'),
    sessionToken: v.string(),
    invoiceNumber: v.string(),
    amount: v.string(),
    token: v.string(),
    dueDate: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error('Bill not found');
    const { user } = await requireOrgAccess(
      ctx,
      invoice.orgId,
      args.sessionToken,
      ['admin', 'approver', 'initiator', 'clerk'],
    );
    if (args.expectedUpdatedAt !== undefined && args.expectedUpdatedAt !== invoice.updatedAt) throw new Error('This bill changed while you were reviewing it. Reopen the current bill before saving.');
    if (invoice.voidedAt) throw new Error('A voided bill cannot be edited');
    const payment = invoice.disbursementId
      ? await ctx.db.get(invoice.disbursementId)
      : null;
    if (payment && payment.status !== 'cancelled')
      throw new Error('Cancel the linked payment before changing this bill');
    const invoiceNumber = args.invoiceNumber.trim();
    if (!invoiceNumber || invoiceNumber.length > 100)
      throw new Error('Enter an invoice number of 1 to 100 characters');
    const normalizedNumber = invoiceNumber.toLowerCase();
    const duplicate = await ctx.db
      .query('invoices')
      .withIndex('by_org_vendor_number', (q) =>
        q
          .eq('orgId', invoice.orgId)
          .eq('beneficiaryId', invoice.beneficiaryId)
          .eq('normalizedNumber', normalizedNumber),
      )
      .first();
    if (duplicate && duplicate._id !== invoice._id)
      throw new Error('This vendor already has an invoice with that number');
    if (
      !Number.isSafeInteger(args.dueDate) ||
      args.dueDate <= 0 ||
      args.dueDate > 8640000000000000
    )
      throw new Error('Enter a valid due date');
    if ((args.description?.length ?? 0) > 2000)
      throw new Error('Keep the description under 2000 characters');
    const amount = formatBaseUnits(
      amountToBaseUnits(args.amount, args.token),
      args.token,
    );
    await ctx.db.patch(invoice._id, {
      invoiceNumber,
      normalizedNumber,
      amount,
      token: args.token.toUpperCase(),
      dueDate: args.dueDate,
      description: args.description?.trim(),
      updatedAt: Date.now(),
    });
    await attachInvoiceFiles(ctx, invoice._id, user._id, args.sourceFileIds ?? [], args.sourceReviewed);
    await appendAudit(ctx, {
      orgId: invoice.orgId,
      actorUserId: user._id,
      action: 'invoice.updated',
      objectType: 'invoice',
      objectId: invoice._id,
      metadata: { previousAmount: invoice.amount, amount, invoiceNumber },
      timestamp: Date.now(),
    });
    return invoice._id;
  },
});

export const voidBill = mutation({
  args: { invoiceId: v.id('invoices'), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error('Bill not found');
    const { user } = await requireOrgAccess(
      ctx,
      invoice.orgId,
      args.sessionToken,
      ['admin', 'approver', 'initiator', 'clerk'],
    );
    if (invoice.voidedAt) return;
    const payment = invoice.disbursementId
      ? await ctx.db.get(invoice.disbursementId)
      : null;
    if (payment && payment.status !== 'cancelled')
      throw new Error(
        'A bill with a pending or completed payment cannot be voided',
      );
    await ctx.db.patch(invoice._id, {
      voidedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: invoice.orgId,
      actorUserId: user._id,
      action: 'invoice.voided',
      objectType: 'invoice',
      objectId: invoice._id,
      timestamp: Date.now(),
    });
  },
});
