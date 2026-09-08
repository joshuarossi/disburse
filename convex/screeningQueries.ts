import { ORG_READER_ROLES, SCREENING_REVIEWER_ROLES } from '../shared/roles';
import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { sourceRecord } from "./ofacData";
import {
  screeningEvidenceKey,
  screeningIssue,
} from "../shared/screeningEvidence";
import { checkRecipientScreening } from "./lib/screeningPolicy";

export const verifyBeneficiaryAccess = internalQuery({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    sessionToken: v.string(),
    allowedRoles: v.array(
      v.union(
        v.literal("admin"),
        v.literal("approver"),
        v.literal("initiator"),
        v.literal("clerk"),
        v.literal("viewer"),
      ),
    ),
  },
  handler: async (ctx, args): Promise<{ orgId: Id<"orgs"> }> => {
    const recipient = await ctx.db.get(args.beneficiaryId);
    if (!recipient) throw new Error("Recipient not found.");
    await requireOrgAccess(
      ctx,
      recipient.orgId,
      args.sessionToken,
      args.allowedRoles,
    );
    return { orgId: recipient.orgId };
  },
});
export const getScreeningResult = query({
  args: { beneficiaryId: v.id("beneficiaries"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const recipient = await ctx.db.get(args.beneficiaryId);
    if (!recipient) return null;
    const { membership } = await requireOrgAccess(
      ctx,
      recipient.orgId,
      args.sessionToken,
      [...ORG_READER_ROLES],
    );
    const result = await ctx.db
      .query("screeningResults")
      .withIndex("by_beneficiary", (q) => q.eq("beneficiaryId", recipient._id))
      .unique();
    const source = await sourceRecord(ctx),
      org = await ctx.db.get(recipient.orgId);
    if (!result)
      return {
        _id: undefined,
        runId: undefined,
        datasetId: undefined,
        status: "pending" as const,
        matches: [],
        screenedAt: undefined,
        reviewedAt: undefined,
        reviewExpiresAt: undefined,
        issue: screeningIssue(
          recipient,
          null,
          source,
          org?.screeningMaxAgeHours,
        ),
        evidenceKey: undefined,
        input: undefined,
        dataset: null,
        canReview: false,
        canRerun: membership.role !== "viewer",
        decisions: [],
        checks: [],
      };
    const run = result.runId ? await ctx.db.get(result.runId) : null;
    const dataset = result.datasetId
      ? await ctx.db.get(result.datasetId)
      : null;
    const issue = screeningIssue(
      recipient,
      result,
      source,
      org?.screeningMaxAgeHours,
    );
    const decisions = await ctx.db
      .query("screeningDecisions")
      .withIndex("by_recipient", (q) => q.eq("beneficiaryId", recipient._id))
      .order("desc")
      .take(10);
    const checks = await ctx.db
      .query("screeningRuns")
      .withIndex("by_recipient", (q) => q.eq("beneficiaryId", recipient._id))
      .order("desc")
      .take(5);
    return {
      ...result,
      issue,
      evidenceKey: screeningEvidenceKey(result),
      input: run?.input,
      dataset,
      canReview:
        SCREENING_REVIEWER_ROLES.includes(membership.role) &&
        !screeningIssue(
          recipient,
          { ...result, status: "clear" },
          source,
          org?.screeningMaxAgeHours,
        ),
      canRerun: membership.role !== "viewer",
      decisions,
      checks: checks.map((c) => ({
        id: c._id,
        screenedAt: c.screenedAt,
        status: c.status,
        datasetId: c.datasetId,
        matchCount: c.matches.length,
        error: c.error,
      })),
    };
  },
});
export const listScreeningResults = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    statusFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    const results = await ctx.db
      .query("screeningResults")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .take(1001);
    if (results.length > 1000)
      throw new Error(
        "Open recipient records to review a directory larger than 1,000 screening results.",
      );
    return args.statusFilter && args.statusFilter !== "pending"
      ? results.filter((r) => r.status === args.statusFilter)
      : results;
  },
});
export const getScreeningEnforcement = query({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    return (await ctx.db.get(args.orgId))?.screeningEnforcement ?? "warn";
  },
});
export const checkBeneficiaries = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    beneficiaryIds: v.array(v.id("beneficiaries")),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    return checkRecipientScreening(ctx, args.orgId, args.beneficiaryIds);
  },
});
export const checkDisbursementRecipients = query({
  args: { disbursementId: v.id("disbursements"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found.");
    await requireOrgAccess(ctx, payment.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    const recipients =
      payment.type === "batch"
        ? await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) =>
              q.eq("disbursementId", payment._id),
            )
            .take(1001)
        : payment.beneficiaryId
          ? [{ beneficiaryId: payment.beneficiaryId }]
          : [];
    return checkRecipientScreening(
      ctx,
      payment.orgId,
      recipients.map((r) => r.beneficiaryId),
    );
  },
});
