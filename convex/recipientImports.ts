import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { getOrgLimits } from "./billing";
import { appendAudit } from "./audit";
import { requestPayoutReview, payoutDetails } from "./lib/recipientReview";
import {
  importFingerprint,
  planRecipientImport,
} from "../shared/recipientImport";

const recipient = v.object({
  name: v.string(),
  type: v.optional(v.union(v.literal("individual"), v.literal("business"))),
  email: v.optional(v.string()),
  walletAddress: v.optional(v.string()),
  notes: v.optional(v.string()),
  preferredToken: v.optional(v.string()),
  preferredChainId: v.optional(v.number()),
  sourceSystem: v.optional(v.string()),
  sourceId: v.optional(v.string()),
});
export const status = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    requestId: v.string(),
    requestHash: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "initiator",
      "clerk",
      "approver",
      "viewer",
    ]);
    const saved = await ctx.db
      .query("recipientImportBatches")
      .withIndex("by_org_request", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (!saved || saved.requestHash !== args.requestHash) return null;
    return {
      created: saved.created,
      updated: saved.updated,
      reviewRequested: saved.reviewRequested,
    };
  },
});
export const commit = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    requestId: v.string(),
    rows: v.array(
      v.object({
        recipient,
        operation: v.union(v.literal("create"), v.literal("update")),
        existingId: v.optional(v.id("beneficiaries")),
        expectedFingerprint: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin", "initiator", "clerk"],
    );
    if (!args.rows.length || args.rows.length > 500)
      throw new Error("Import between 1 and 500 recipients at a time");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId))
      throw new Error("Invalid import request. Preview the file again.");
    const requestHash = importFingerprint(args.rows);
    const previous = await ctx.db
      .query("recipientImportBatches")
      .withIndex("by_org_request", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new Error(
          "This import request already saved different rows. Preview the new changes again.",
        );
      return {
        created: previous.created,
        updated: previous.updated,
        reviewRequested: previous.reviewRequested,
        recipientIds: previous.recipientIds,
      };
    }
    const directory = await ctx.db
      .query("beneficiaries")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .take(10001);
    if (directory.length > 10000)
      throw new Error(
        "This directory needs a paginated import review before changes can be applied. No rows were imported.",
      );
    const plans = planRecipientImport(
      args.rows.map((r) => r.recipient),
      directory,
    );
    for (const [index, plan] of plans.entries()) {
      if (plan.errors.length)
        throw new Error(`Row ${index + 1}: ${plan.errors.join(" ")}`);
      const expected = args.rows[index];
      if (
        plan.recommendation !== expected.operation ||
        plan.existingId !== expected.existingId ||
        plan.expectedFingerprint !== expected.expectedFingerprint
      )
        throw new Error(
          `Row ${index + 1}: recipient details changed after the preview. Refresh the file preview before importing.`,
        );
    }
    const created = plans.filter((p) => p.recommendation === "create").length;
    const limits = await getOrgLimits(ctx, args.orgId);
    if (directory.length + created > limits.maxBeneficiaries)
      throw new Error(
        `Your current plan supports ${limits.maxBeneficiaries} recipients. This import adds ${created}. Review your plan before continuing.`,
      );
    let updated = 0,
      reviewRequested = 0;
    const recipientIds: Id<"beneficiaries">[] = [];
    for (const plan of plans) {
      const values = plan.proposed;
      let id: Id<"beneficiaries">;
      if (plan.existingId) {
        id = plan.existingId as Id<"beneficiaries">;
        const current = (await ctx.db.get(id))!;
        if (plan.payoutChanged) {
          await requestPayoutReview(
            ctx,
            current,
            {
              walletAddress: values.walletAddress ?? "",
              preferredToken: values.preferredToken,
              preferredChainId: values.preferredChainId,
            },
            user._id,
          );
          reviewRequested++;
        }
        await ctx.db.patch(id, {
          name: values.name,
          type: values.type,
          email: values.email,
          notes: values.notes,
          sourceId: values.sourceId,
          sourceSystem: values.sourceSystem,
          updatedAt: Date.now(),
        });
        updated++;
      } else {
        id = await ctx.db.insert("beneficiaries", {
          ...values,
          walletAddress: values.walletAddress ?? "",
          orgId: args.orgId,
          isActive: true,
          payoutVersion: 0,
          payoutReviewStatus: "unreviewed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const current = (await ctx.db.get(id))!;
        if (current.walletAddress) {
          await requestPayoutReview(
            ctx,
            current,
            payoutDetails(current),
            user._id,
          );
          reviewRequested++;
        }
      }
      recipientIds.push(id);
      await appendAudit(ctx, {
        orgId: args.orgId,
        actorUserId: user._id,
        action: plan.existingId
          ? "beneficiary.import_updated"
          : "beneficiary.import_created",
        objectType: "beneficiary",
        objectId: id,
        metadata: {
          importRequest: args.requestId,
          sourceSystem: values.sourceSystem ?? null,
          sourceId: values.sourceId ?? null,
          changedFields: plan.differences.map((d) => d.field).join(","),
          payoutReviewRequested:
            plan.payoutChanged || (!plan.existingId && !!values.walletAddress),
        },
        timestamp: Date.now(),
      });
      if (!plan.existingId || plan.differences.some((d) => d.field === "name"))
        await ctx.scheduler.runAfter(0, internal.screening.screenBeneficiary, {
          orgId: args.orgId,
          beneficiaryId: id,
          sessionToken: args.sessionToken,
        });
    }
    const result = { created, updated, reviewRequested, recipientIds };
    await ctx.db.insert("recipientImportBatches", {
      ...result,
      orgId: args.orgId,
      requestId: args.requestId,
      requestHash,
      createdBy: user._id,
      createdAt: Date.now(),
    });
    return result;
  },
});
