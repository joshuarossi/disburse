import { appendAudit } from "./audit";
import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import {
  screeningInputValidator,
  screeningMatchValidator,
} from "./lib/sanctionsValidators";
import { sourceRecord } from "./ofacData";
import { fingerprint } from "../shared/fingerprint";
import {
  screeningEvidenceKey,
  screeningInputFingerprint,
  screeningIssue,
} from "../shared/screeningEvidence";
import { SCREENING_ENGINE } from "../shared/sanctions";

export const beginScreening = internalMutation({
  args: { orgId: v.id("orgs"), beneficiaryId: v.id("beneficiaries") },
  handler: async (ctx, args) => {
    const recipient = await ctx.db.get(args.beneficiaryId);
    if (!recipient || recipient.orgId !== args.orgId)
      throw new Error("Recipient does not belong to this workspace.");
    if (!recipient.isActive) return null;
    const attempt = (recipient.screeningAttempt ?? 0) + 1;
    await ctx.db.patch(recipient._id, {
      screeningAttempt: attempt,
      nextScreeningAt: Date.now() + 15 * 60_000,
    });
    return { recipient, attempt };
  },
});

export const upsertScreeningResult = internalMutation({
  args: {
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    status: v.union(
      v.literal("clear"),
      v.literal("potential_match"),
      v.literal("unavailable"),
    ),
    matches: v.array(screeningMatchValidator),
    datasetId: v.optional(v.id("ofacDatasets")),
    input: v.optional(screeningInputValidator),
    expectedFingerprint: v.optional(v.string()),
    attempt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now(),
      recipient = await ctx.db.get(args.beneficiaryId);
    if (!recipient || recipient.orgId !== args.orgId)
      throw new Error("Recipient does not belong to this workspace.");
    if (
      !args.input ||
      !args.expectedFingerprint ||
      !Number.isSafeInteger(args.attempt) ||
      (args.attempt ?? 0) < 1 ||
      args.expectedFingerprint !== screeningInputFingerprint(args.input)
    )
      throw new Error("Versioned screening evidence is required.");
    if (!recipient.isActive || recipient.screeningAttempt !== args.attempt)
      throw new Error(
        "This screening attempt was superseded. View the current result.",
      );
    if (screeningInputFingerprint(recipient) !== args.expectedFingerprint)
      throw new Error(
        "Recipient details changed during screening. Run the check again.",
      );
    const source = await sourceRecord(ctx),
      org = await ctx.db.get(args.orgId);
    if (args.status !== "unavailable") {
      const dataset = args.datasetId ? await ctx.db.get(args.datasetId) : null;
      if (
        !dataset ||
        dataset.state !== "active" ||
        dataset.engine !== SCREENING_ENGINE ||
        source?.activeDatasetId !== dataset._id
      )
        throw new Error(
          "The OFAC list changed during screening. Run the check again.",
        );
      if ((args.status === "clear") !== (args.matches.length === 0))
        throw new Error("Screening status does not match its evidence.");
    }
    const matches = args.matches
      .map((m) => ({ ...m, programs: m.programs?.slice().sort() }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const matchFingerprint = fingerprint(matches);
    const existing = await ctx.db
      .query("screeningResults")
      .withIndex("by_beneficiary", (q) => q.eq("beneficiaryId", recipient._id))
      .unique();
    const error =
      args.status === "unavailable"
        ? args.error?.slice(0, 500) || "The screening check did not complete."
        : undefined;
    if (
      existing?.engine === SCREENING_ENGINE &&
      existing.inputFingerprint === args.expectedFingerprint &&
      existing.matchFingerprint === matchFingerprint &&
      existing.datasetId === args.datasetId &&
      existing.lastError === error &&
      existing.screenedAt > now - 60_000
    )
      return existing._id;
    const runId = await ctx.db.insert("screeningRuns", {
      orgId: args.orgId,
      beneficiaryId: recipient._id,
      datasetId: args.datasetId,
      engine: SCREENING_ENGINE,
      input: args.input,
      inputFingerprint: args.expectedFingerprint,
      matchFingerprint,
      status: args.status,
      matches,
      screenedAt: now,
      error,
    });
    const carryDecision =
      args.status !== "unavailable" &&
      existing?.engine === SCREENING_ENGINE &&
      existing.inputFingerprint === args.expectedFingerprint &&
      existing.matchFingerprint === matchFingerprint &&
      (existing.reviewExpiresAt ?? 0) > now &&
      ["false_positive", "confirmed_match"].includes(existing.status);
    const fields = {
      runId,
      datasetId: args.datasetId,
      engine: SCREENING_ENGINE,
      inputFingerprint: args.expectedFingerprint,
      matchFingerprint,
      status: carryDecision ? existing!.status : args.status,
      matches,
      screenedAt: now,
      lastError: error,
      decisionId: carryDecision ? existing!.decisionId : undefined,
      reviewedBy: carryDecision ? existing!.reviewedBy : undefined,
      reviewedAt: carryDecision ? existing!.reviewedAt : undefined,
      reviewExpiresAt: carryDecision ? existing!.reviewExpiresAt : undefined,
    };
    const resultId = existing
      ? existing._id
      : await ctx.db.insert("screeningResults", {
          orgId: args.orgId,
          beneficiaryId: recipient._id,
          ...fields,
        });
    if (existing) await ctx.db.patch(existing._id, fields);
    await ctx.db.patch(recipient._id, {
      nextScreeningAt:
        now +
        (error
          ? 3600_000
          : Math.min(12, (org?.screeningMaxAgeHours ?? 24) / 2) * 3600_000),
    });
    return resultId;
  },
});

export const reviewScreeningResult = mutation({
  args: {
    screeningResultId: v.id("screeningResults"),
    sessionToken: v.string(),
    status: v.union(v.literal("confirmed_match"), v.literal("false_positive")),
    reason: v.string(),
    expectedEvidenceKey: v.string(),
    validDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.get(args.screeningResultId);
    if (!result) throw new Error("Screening result not found.");
    const { user } = await requireOrgAccess(
      ctx,
      result.orgId,
      args.sessionToken,
      ["admin", "approver"],
    );
    const recipient = await ctx.db.get(result.beneficiaryId),
      org = await ctx.db.get(result.orgId),
      source = await sourceRecord(ctx);
    if (
      !recipient ||
      recipient.orgId !== result.orgId ||
      !result.runId ||
      !result.matches.length ||
      args.expectedEvidenceKey !== screeningEvidenceKey(result)
    )
      throw new Error(
        "Screening evidence changed. Reload and review the current result.",
      );
    // Confirmed matches still need a current source and identity before a new decision.
    const issue = screeningIssue(
      recipient,
      { ...result, status: "clear" },
      source,
      org?.screeningMaxAgeHours,
    );
    if (issue) throw new Error(issue.reason);
    if (
      args.status === "false_positive" &&
      result.matches.some(
        (m) => m.kind === "address" && m.networkMatch === "listed_network",
      )
    )
      throw new Error(
        "An exact address listed for this network cannot be dismissed as a name false positive.",
      );
    const reason = args.reason.trim(),
      days = args.validDays ?? 30;
    if (reason.length < 10 || reason.length > 2000)
      throw new Error("Record a review reason of 10 to 2,000 characters.");
    if (![7, 30].includes(days))
      throw new Error("Choose a 7-day or 30-day review period.");
    const reviewedAt = Date.now(),
      expiresAt = reviewedAt + days * 86400_000;
    const decisionId = await ctx.db.insert("screeningDecisions", {
      orgId: result.orgId,
      beneficiaryId: recipient._id,
      runId: result.runId,
      inputFingerprint: result.inputFingerprint!,
      matchFingerprint: result.matchFingerprint!,
      status: args.status,
      reason,
      reviewedBy: user._id,
      reviewedAt,
      expiresAt,
    });
    await ctx.db.patch(result._id, {
      status: args.status,
      reviewedBy: user._id,
      reviewedAt,
      reviewExpiresAt: expiresAt,
      decisionId,
    });
    await appendAudit(ctx, {
      orgId: result.orgId,
      actorUserId: user._id,
      action: "screening.reviewed",
      objectType: "screeningResult",
      objectId: result._id,
      metadata: {
        beneficiaryId: recipient._id,
        runId: result.runId,
        decisionId,
        previousStatus: result.status,
        newStatus: args.status,
        reason,
        expiresAt,
      },
      timestamp: reviewedAt,
    });
    return { success: true };
  },
});

export const updateScreeningEnforcement = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    enforcement: v.union(
      v.literal("block"),
      v.literal("warn"),
      v.literal("off"),
    ),
    maximumAgeHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (
      args.maximumAgeHours !== undefined &&
      ![24, 72, 168].includes(args.maximumAgeHours)
    )
      throw new Error(
        "Choose a freshness limit of 24 hours, 3 days or 7 days.",
      );
    await ctx.db.patch(args.orgId, {
      screeningEnforcement: args.enforcement,
      ...(args.maximumAgeHours !== undefined
        ? { screeningMaxAgeHours: args.maximumAgeHours }
        : {}),
    });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "org.screeningEnforcementUpdated",
      objectType: "org",
      objectId: args.orgId,
      metadata: {
        enforcement: args.enforcement,
        ...(args.maximumAgeHours !== undefined
          ? { maximumAgeHours: args.maximumAgeHours }
          : {}),
      },
      timestamp: Date.now(),
    });
    return { success: true };
  },
});
