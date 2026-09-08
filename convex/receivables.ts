import { ORG_READER_ROLES, RECORD_EDITOR_ROLES } from '../shared/roles';
import { environmentValidator } from "./lib/activityEnvironment";
import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { appendAudit } from "./audit";
import { CHAIN_TOKENS, type SupportedChainId } from "../shared/chains";
import { amountToBaseUnits, formatBaseUnits } from "./lib/validation";
import { receivableAmounts, receivableStatus } from "../shared/receivables";
import { internal } from "./_generated/api";
import { assertSameSettlement, validateSettlementBlock } from './lib/settlementBlock';
import { supportsCircleFees } from '../shared/circleExecution';
import { withReceivableRefunds } from './lib/receivableAdjustments';


const scope = { orgId: v.id("orgs"), sessionToken: v.string() };
const identity = { invoiceId: v.id("receivables"), sessionToken: v.string() };
export const configuration = query({
  args: scope,
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    const safes = await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return [
      ...new Set(
        safes
          .filter((s) => s.isActive !== false && s.chainId)
          .map((s) => s.chainId!),
      ),
    ].map((chainId) => {
      const testnet = [11155111, 84532, 421614].includes(chainId);
      return {
        chainId,
        canIssue:
          supportsCircleFees(chainId) && (testnet || process.env.AR_MAINNET_ENABLED === "true"),
        collectionFeeMode: "stablecoin" as const,
      };
    });
  },
});
export const create = mutation({
  args: {
    ...scope,
    invoiceId: v.optional(v.id("receivables")),
    safeId: v.id("safes"),
    number: v.string(),
    customerName: v.string(),
    customerEmail: v.optional(v.string()),
    description: v.string(),
    token: v.string(),
    dueDate: v.number(),
    items: v.array(
      v.object({
        description: v.string(),
        quantity: v.number(),
        unitPrice: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      [...RECORD_EDITOR_ROLES],
    );
    const editing = args.invoiceId ? await ctx.db.get(args.invoiceId) : null;
    if (
      args.invoiceId &&
      (!editing || editing.orgId !== args.orgId || editing.state !== "draft")
    )
      throw new Error("Only drafts in this workspace can be edited.");
    const safe = await ctx.db.get(args.safeId);
    if (
      !safe ||
      safe.orgId !== args.orgId ||
      safe.isActive === false ||
      !safe.chainId
    )
      throw new Error("Choose an active receiving account in this workspace.");
    const token = Object.entries(
      CHAIN_TOKENS[safe.chainId as SupportedChainId] ?? {},
    ).find(([symbol]) => symbol === args.token)?.[1];
    if (!token)
      throw new Error("Choose a supported currency for this account.");
    const number = args.number.trim(),
      name = args.customerName.trim();
    if (
      !number ||
      number.length > 100 ||
      !name ||
      name.length > 200 ||
      args.description.length > 2000
    )
      throw new Error(
        "Enter a customer and invoice number; keep descriptions under 2,000 characters.",
      );
    const email = args.customerEmail?.trim();
    if (
      email &&
      (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
      throw new Error("Enter a valid customer email.");
    if (
      !Number.isSafeInteger(args.dueDate) ||
      args.dueDate < 1 ||
      args.dueDate > 8640000000000000
    )
      throw new Error("Choose a valid due date.");
    if (!args.items.length || args.items.length > 50)
      throw new Error("Use between 1 and 50 invoice lines.");
    let total = 0n;
    const items = args.items.map((item) => {
      if (
        !item.description.trim() ||
        item.description.length > 500 ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 1000000
      )
        throw new Error(
          "Each line needs a description and a positive whole-number quantity.",
        );
      const price = amountToBaseUnits(item.unitPrice, args.token);
      total += price * BigInt(item.quantity);
      return {
        ...item,
        description: item.description.trim(),
        unitPrice: formatBaseUnits(price, args.token),
      };
    });
    if (total >= 2n ** 256n) throw new Error("Invoice total is too large.");
    const existing = await ctx.db
      .query("receivables")
      .withIndex("by_org_number", (q) =>
        q.eq("orgId", args.orgId).eq("normalizedNumber", number.toLowerCase()),
      )
      .first();
    if (existing && existing._id !== editing?._id)
      throw new Error(
        "This workspace already has an invoice with that number.",
      );
    const now = Date.now();
    const fields = {
      orgId: args.orgId,
      safeId: safe._id,
      createdBy: editing?.createdBy ?? user._id,
      number,
      normalizedNumber: number.toLowerCase(),
      customerName: name,
      customerEmail: email,
      description: args.description.trim(),
      items,
      token: args.token,
      tokenAddress: token.address.toLowerCase(),
      chainId: safe.chainId,
      treasury: safe.safeAddress.toLowerCase(),
      amount: formatBaseUnits(total, args.token),
      dueDate: args.dueDate,
      state: "draft" as const,
      received: "0",
      forwarded: "0",
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
      revision: (editing?.revision ?? 0) + 1,
    };
    const id = editing
      ? (await ctx.db.patch(editing._id, fields), editing._id)
      : await ctx.db.insert("receivables", fields);
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: editing ? "receivable.updated" : "receivable.created",
      objectType: "receivable",
      objectId: id,
      timestamp: now,
    });
    return id;
  },
});
export const list = query({
  args: { ...scope, environment: v.optional(environmentValidator) },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    const invoices = await ctx.db
      .query("receivables")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .filter(q => args.environment === "test" ? q.or(q.eq(q.field("chainId"), 11155111), q.eq(q.field("chainId"), 84532)) : args.environment === "production" ? q.or(...[1, 137, 8453, 42161].map(id => q.eq(q.field("chainId"), id))) : args.environment === "unclassified" ? q.and(...[1, 137, 8453, 42161, 11155111, 84532].map(id => q.neq(q.field("chainId"), id))) : true)
      .order("desc")
      .take(201);
    const visible=await Promise.all(invoices.slice(0,200).map(i=>withReceivableRefunds(ctx,i)));
    return {
      items: visible.map((i) => ({
        ...i,
        status: receivableStatus(i),
        amounts: receivableAmounts(i),
      })),
      limited: invoices.length > 200,
    };
  },
});
export const get = query({
  args: identity,
  handler: async (ctx, args) => {
    const i = await ctx.db.get(args.invoiceId);
    if (!i) throw new Error("Invoice not found.");
    await requireOrgAccess(ctx, i.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    return withReceivableRefunds(ctx,i);
  },
});
export const forOperation = query({
  args: identity,
  handler: async (ctx, args) => {
    const i = await ctx.db.get(args.invoiceId);
    if (!i) throw new Error("Invoice not found.");
    await requireOrgAccess(ctx, i.orgId, args.sessionToken, [...RECORD_EDITOR_ROLES]);
    return i;
  },
});
export const receipts = query({
  args: identity,
  handler: async (ctx, args) => {
    const i = await ctx.db.get(args.invoiceId);
    if (!i) throw new Error("Invoice not found.");
    await requireOrgAccess(ctx, i.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    return ctx.db
      .query("receivableEvents")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", i._id))
      .order("desc")
      .take(100);
  },
});
export const publicInvoice = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.token)) return null;
    const i = await ctx.db
      .query("receivables")
      .withIndex("by_public", (q) => q.eq("publicToken", args.token))
      .unique();
    if (!i || i.state === "draft") return null;
    const org = await ctx.db.get(i.orgId);
    const adjusted=await withReceivableRefunds(ctx,i);
    const credits=await ctx.db.query("receivableCreditNotes").withIndex("by_invoice",q=>q.eq("invoiceId",i._id)).order("desc").take(100);
    const files = await ctx.db.query("invoiceFiles").withIndex("by_receivable", q=>q.eq("receivableId", i._id)).take(5);
    // Explicit shareable projection: no customer email, private notes, org IDs or sessions.
    return {
      number: i.number,
      issuer: org?.name ?? "Business",
      customerName: i.customerName,
      description: i.description,
      items: i.items,
      dueDate: i.dueDate,
      token: i.token,
      tokenAddress: i.tokenAddress,
      chainId: i.chainId,
      amount: i.amount,
      receivingAddress: i.receivingAddress,
      status: receivableStatus(adjusted),
      amounts: receivableAmounts(adjusted),
      credits: credits.map(c=>({number:c.number,amount:formatBaseUnits(BigInt(c.amountRaw),i.token),reason:c.reason,issuedAt:c.issuedAt})),
      voided: i.state === "void",
      lastCheckedAt: i.lastCheckedAt,
      syncDelayed: !!i.syncError,
      documents: files.filter(f=>f.sharedWithCustomer && !f.invoiceId && f.orgId === i.orgId).map(f=>({id:f._id, name:f.name, size:f.size})),
    };
  },
});
export const voidInvoice = mutation({
  args: identity,
  handler: async (ctx, args) => {
    const i = await ctx.db.get(args.invoiceId);
    if (!i) throw new Error("Invoice not found.");
    const { user } = await requireOrgAccess(ctx, i.orgId, args.sessionToken, [
      ...RECORD_EDITOR_ROLES,
    ]);
    if (BigInt(i.received) > 0n)
      throw new Error(
        "This invoice has payments. Resolve the payment before voiding; refunds are separate.",
      );
    if(BigInt(i.credited ?? "0") > 0n)throw new Error("This invoice has issued credit notes. Keep those records together and credit any remaining amount instead of voiding it.");
    await ctx.db.patch(i._id, {
      state: "void",
      voidedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: i.orgId,
      actorUserId: user._id,
      action: "receivable.voided",
      objectType: "receivable",
      objectId: i._id,
      timestamp: Date.now(),
    });
  },
});
export const getInternal = internalQuery({
  args: { invoiceId: v.id("receivables") },
  handler: (ctx, args) => ctx.db.get(args.invoiceId),
});
export const publish = internalMutation({
  args: {
    ...identity,
    expectedUpdatedAt: v.number(),
    expectedRevision: v.number(),
    factory: v.string(),
    salt: v.string(),
    receivingAddress: v.string(),
    publicToken: v.string(),
    startBlock: v.string(),
  },
  handler: async (ctx, args) => {
    const i = await ctx.db.get(args.invoiceId);
    if (!i) throw new Error("Invoice not found.");
    const { user } = await requireOrgAccess(ctx, i.orgId, args.sessionToken, [
      ...RECORD_EDITOR_ROLES,
    ]);
    if (i.state === "issued") return i.publicToken!;
    if (
      i.state !== "draft" ||
      i.updatedAt !== args.expectedUpdatedAt ||
      (i.revision ?? 0) !== args.expectedRevision
    )
      throw new Error("Invoice changed. Review it again.");
    const safe = await ctx.db.get(i.safeId);
    if (
      !safe ||
      safe.isActive === false ||
      safe.orgId !== i.orgId ||
      safe.safeAddress.toLowerCase() !== i.treasury ||
      safe.chainId !== i.chainId
    )
      throw new Error("Receiving account changed. Create a new invoice.");
    await ctx.db.patch(i._id, {
      state: "issued",
      factory: args.factory,
      salt: args.salt,
      receivingAddress: args.receivingAddress,
      publicToken: args.publicToken,
      scanFromBlock: args.startBlock,
      issuedAt: Date.now(),
      lastCheckedAt: 0,
      nextScanAt: 0,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: i.orgId,
      actorUserId: user._id,
      action: "receivable.issued",
      objectType: "receivable",
      objectId: i._id,
      timestamp: Date.now(),
    });
    return args.publicToken;
  },
});
const event = v.object({
  key: v.string(),
  kind: v.union(v.literal("received"), v.literal("forwarded")),
  amount: v.string(),
  txHash: v.string(),
  logIndex: v.number(),
  blockNumber: v.string(),
  blockHash: v.string(),
  settledAt: v.optional(v.number()),
  fromAddress: v.optional(v.string()),
  toAddress: v.optional(v.string()),
});
export const recordScan = internalMutation({
  args: {
    invoiceId: v.id("receivables"),
    fromBlock: v.string(),
    nextBlock: v.string(),
    events: v.array(event),
  },
  handler: async (ctx, args) => {
    const i = await ctx.db.get(args.invoiceId);
    if (!i || i.scanFromBlock !== args.fromBlock || !i.receivingAddress)
      return false;
    let received = BigInt(i.received),
      forwarded = BigInt(i.forwarded);
    for (const e of args.events) {
      if (e.settledAt !== undefined) validateSettlementBlock({ blockNumber: e.blockNumber, blockHash: e.blockHash, timestamp: e.settledAt });
      if (e.toAddress !== undefined && (e.toAddress.toLowerCase() !== (e.kind === 'received' ? i.receivingAddress : i.treasury).toLowerCase()
        || !e.fromAddress || !/^0x[\da-f]{40}$/i.test(e.fromAddress)
        || (e.kind === 'forwarded' && e.fromAddress.toLowerCase() !== i.receivingAddress.toLowerCase())))
        throw new Error('Invoice transfer does not match its receiving and treasury addresses');
      const existing = await ctx.db
        .query("receivableEvents")
        .withIndex("by_invoice_key", (q) =>
          q.eq("invoiceId", i._id).eq("key", e.key),
        )
        .first();
      if (existing) {
        if (existing.kind !== e.kind || existing.amount !== e.amount || existing.txHash.toLowerCase() !== e.txHash.toLowerCase()
          || existing.logIndex !== e.logIndex || existing.blockNumber !== e.blockNumber || existing.blockHash.toLowerCase() !== e.blockHash.toLowerCase())
          throw new Error('Invoice transfer conflicts with previously confirmed evidence');
        if (e.settledAt !== undefined) {
          assertSameSettlement(existing.settledAt === undefined ? undefined : { blockNumber: existing.blockNumber, blockHash: existing.blockHash, timestamp: existing.settledAt },
            { blockNumber: e.blockNumber, blockHash: e.blockHash, timestamp: e.settledAt });
          if (existing.settledAt === undefined) await ctx.db.patch(existing._id, { settledAt: e.settledAt, fromAddress: e.fromAddress, toAddress: e.toAddress });
        }
        continue;
      }
      if (!/^\d+$/.test(e.amount)) throw new Error("Invalid received amount");
      await ctx.db.insert("receivableEvents", {
        ...e,
        invoiceId: i._id,
        orgId: i.orgId,
        recordedAt: Date.now(),
      });
      if (e.kind === "received") received += BigInt(e.amount);
      else forwarded += BigInt(e.amount);
    }
    await ctx.db.patch(i._id, {
      received: String(received),
      forwarded: String(forwarded),
      scanFromBlock: args.nextBlock,
      lastCheckedAt: Date.now(),
      syncError: undefined,
    });
    return true;
  },
});
export const noteError = internalMutation({
  args: { invoiceId: v.id("receivables"), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.invoiceId))
      await ctx.db.patch(args.invoiceId, {
        syncError: args.error,
        lastCheckedAt: Date.now(),
      });
  },
});
export const monitor = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows: Doc<"receivables">[] = [];
    for (const state of ["issued", "void"] as const)
      rows.push(
        ...(await ctx.db
          .query("receivables")
          .withIndex("by_issued_scan", (q) =>
            q
              .eq("state", state)
              .gte("nextScanAt", 0)
              .lte("nextScanAt", Date.now()),
          )
          .take(10)),
      );
    for (const i of rows) {
      if (!i.receivingAddress) continue;
      await ctx.db.patch(i._id, { nextScanAt: Date.now() + 60_000 });
      await ctx.scheduler.runAfter(0, internal.receivableActions.scan, {
        invoiceId: i._id,
      });
    }
  },
});
