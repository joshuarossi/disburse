import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import { sourceRecord } from "./ofacData";

export const queueOrg = internalMutation({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
    ]);
    await ctx.scheduler.runAfter(0, internal.screeningQueue.orgPage, {
      orgId: args.orgId,
      cursor: null,
    });
    return { queued: true };
  },
});
export const orgPage = internalMutation({
  args: { orgId: v.id("orgs"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("beneficiaries")
      .withIndex("by_org_active", (q) =>
        q.eq("orgId", args.orgId).eq("isActive", true),
      )
      .paginate({ numItems: 100, cursor: args.cursor });
    for (const recipient of page.page)
      await ctx.db.patch(recipient._id, { nextScreeningAt: Date.now() });
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.screeningQueue.orgPage, {
        orgId: args.orgId,
        cursor: page.continueCursor,
      });
  },
});
export const allPage = internalMutation({
  args: {
    datasetId: v.id("ofacDatasets"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    if ((await sourceRecord(ctx))?.activeDatasetId !== args.datasetId) return;
    // Page on creation order; changing due dates cannot move records across this cursor.
    const page = await ctx.db
      .query("beneficiaries")
      .paginate({ numItems: 100, cursor: args.cursor });
    for (const recipient of page.page)
      if (recipient.isActive)
        await ctx.db.patch(recipient._id, { nextScreeningAt: Date.now() });
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.screeningQueue.allPage, {
        datasetId: args.datasetId,
        cursor: page.continueCursor,
      });
  },
});
export const due = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!(await sourceRecord(ctx))?.activeDatasetId) return;
    const recipients = await ctx.db
      .query("beneficiaries")
      .withIndex("by_active_screening_due", (q) => q.eq("isActive", true))
      .order("asc")
      .take(20);
    for (const recipient of recipients)
      if ((recipient.nextScreeningAt ?? 0) <= Date.now()) {
        await ctx.db.patch(recipient._id, {
          nextScreeningAt: Date.now() + 15 * 60_000,
        });
        await ctx.scheduler.runAfter(0, internal.screening.screenBeneficiary, {
          beneficiaryId: recipient._id,
          orgId: recipient.orgId,
        });
      }
  },
});
