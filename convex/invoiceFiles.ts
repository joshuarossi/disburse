import { ORG_READER_ROLES, RECORD_EDITOR_ROLES } from '../shared/roles';
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { appendAudit } from "./audit";
import {
  INVOICE_FILE_TYPES,
  MAX_INVOICE_FILES,
  MAX_INVOICE_FILE_BYTES,
  invoiceFileName,
} from "../shared/invoiceSource";



export const uploadAccess = internalQuery({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...RECORD_EDITOR_ROLES]);
  },
});
export const record = internalMutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    requestId: v.string(),
    storageId: v.id("_storage"),
    name: v.string(),
    size: v.number(),
    contentType: v.string(),
    sha256: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      [...RECORD_EDITOR_ROLES],
    );
    if (
      !/^[a-f0-9-]{32,64}$/i.test(args.requestId) ||
      !/^[a-f0-9]{64}$/.test(args.sha256)
    )
      throw new Error("Invalid upload identity");
    const name = invoiceFileName(args.name);
    if (
      !INVOICE_FILE_TYPES.some((t) => t === args.contentType) ||
      !Number.isSafeInteger(args.size) ||
      args.size <= 0 ||
      args.size > MAX_INVOICE_FILE_BYTES
    )
      throw new Error("Invalid invoice file");
    const old = await ctx.db
      .query("invoiceFiles")
      .withIndex("by_request", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (old) {
      if (
        old.uploadedBy !== user._id ||
        old.sha256 !== args.sha256 ||
        old.name !== name ||
        old.size !== args.size ||
        old.contentType !== args.contentType
      )
        throw new Error("This upload request changed. Choose the file again.");
      return { fileId: old._id, reused: true };
    }
    const staged = await ctx.db
      .query("invoiceFiles")
      .withIndex("by_user_unattached", (q) =>
        q.eq("uploadedBy", user._id).eq("invoiceId", undefined),
      )
      .take(21);
    if (staged.length >= 20)
      throw new Error(
        "Finish saving your earlier uploaded bills before adding more documents.",
      );
    const fileId = await ctx.db.insert("invoiceFiles", {
      orgId: args.orgId,
      storageId: args.storageId,
      requestId: args.requestId,
      name,
      size: args.size,
      contentType: args.contentType,
      sha256: args.sha256,
      uploadedBy: user._id,
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400_000,
    });
    return { fileId, reused: false };
  },
});

export async function attachInvoiceFiles(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  userId: Id<"users">,
  fileIds: Id<"invoiceFiles">[],
  reviewed: boolean | undefined,
) {
  const invoice = await ctx.db.get(invoiceId);
  if (!invoice) throw new Error("Bill not found");
  const previous = await ctx.db
    .query("invoiceFiles")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .take(MAX_INVOICE_FILES + 1);
  if (
    fileIds.length > MAX_INVOICE_FILES ||
    new Set(fileIds).size !== fileIds.length
  )
    throw new Error("Attach up to five different source documents.");
  const all = new Map(previous.map((f) => [f._id, f]));
  for (const id of fileIds) {
    const file = await ctx.db.get(id);
    if (
      !file ||
      file.orgId !== invoice.orgId ||
      (file.invoiceId && file.invoiceId !== invoiceId) ||
      (!file.invoiceId &&
        (file.uploadedBy !== userId || (file.expiresAt ?? 0) <= Date.now()))
    )
      throw new Error(
        "The source document is unavailable for this bill. Choose the file again.",
      );
    all.set(id, file);
  }
  if (all.size > MAX_INVOICE_FILES)
    throw new Error("A bill can have up to five source documents.");
  if (!all.size) return;
  if (!reviewed)
    throw new Error(
      "Review the source document and confirm the bill details before saving.",
    );
  for (const f of all.values())
    if (!f.invoiceId)
      await ctx.db.patch(f._id, { invoiceId, expiresAt: undefined });
  await ctx.db.patch(invoiceId, {
    sourceReviewedBy: userId,
    sourceReviewedAt: Date.now(),
  });
  await appendAudit(ctx, {
    orgId: invoice.orgId,
    actorUserId: userId,
    action: "invoice.source_reviewed",
    objectType: "invoice",
    objectId: invoiceId,
    metadata: {
      fileIds: [...all.keys()],
      sha256: [...all.values()].map((f) => f.sha256),
      amount: invoice.amount,
      token: invoice.token,
      dueDate: invoice.dueDate,
      invoiceNumber: invoice.invoiceNumber,
    },
    timestamp: Date.now(),
  });
}

export const list = query({
  args: { invoiceId: v.id("invoices"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return [];
    await requireOrgAccess(ctx, invoice.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    const rows = await ctx.db
      .query("invoiceFiles")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
      .take(MAX_INVOICE_FILES + 1);
    return rows.map((f) => ({
      id: f._id,
      name: f.name,
      size: f.size,
      contentType: f.contentType,
      sha256: f.sha256,
      createdAt: f.createdAt,
    }));
  },
});
export const downloadAccess = internalQuery({
  args: { fileId: v.id("invoiceFiles"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("Source document unavailable");
    const { user } = await requireOrgAccess(
      ctx,
      file.orgId,
      args.sessionToken,
      [...ORG_READER_ROLES],
    );
    if (
      !file.invoiceId &&
      (file.uploadedBy !== user._id || (file.expiresAt ?? 0) <= Date.now())
    )
      throw new Error("Source document unavailable");
    return file;
  },
});
export const discard = internalMutation({
  args: { fileId: v.id("invoiceFiles"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) return;
    const { user } = await requireOrgAccess(
      ctx,
      file.orgId,
      args.sessionToken,
      [...RECORD_EDITOR_ROLES],
    );
    if (file.uploadedBy !== user._id || file.invoiceId)
      throw new Error("Saved source documents are retained with the bill.");
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(file._id);
  },
});
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("invoiceFiles")
      .withIndex("by_expiry", (q) =>
        q.gt("expiresAt", 0).lte("expiresAt", Date.now()),
      )
      .take(20);
    for (const f of expired)
      if (!f.invoiceId) {
        await ctx.storage.delete(f.storageId);
        await ctx.db.delete(f._id);
      }
    return expired.length;
  },
});
