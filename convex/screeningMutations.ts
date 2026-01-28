import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";

// ─── Internal: batch insert SDN entries ─────────────────────────────────────────

export const batchInsertSdnEntries = internalMutation({
  args: {
    entries: v.array(
      v.object({
        sdnId: v.number(),
        entityType: v.union(v.literal("individual"), v.literal("entity")),
        primaryName: v.string(),
        firstName: v.string(),
        lastName: v.string(),
        aliases: v.array(v.string()),
        programs: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const entry of args.entries) {
      await ctx.db.insert("sdnEntries", {
        sdnId: entry.sdnId,
        entityType: entry.entityType,
        primaryName: entry.primaryName,
        firstName: entry.firstName,
        lastName: entry.lastName,
        aliases: entry.aliases,
        programs: entry.programs,
      });
    }
  },
});

// ─── Internal: clear all SDN entries (for re-import) ────────────────────────────

export const clearSdnEntries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("sdnEntries").collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
    return { deleted: entries.length };
  },
});

// ─── Internal: upsert screening result ──────────────────────────────────────────

export const upsertScreeningResult = internalMutation({
  args: {
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    status: v.union(
      v.literal("clear"),
      v.literal("potential_match"),
      v.literal("confirmed_match"),
      v.literal("false_positive")
    ),
    matches: v.array(
      v.object({
        sdnId: v.number(),
        matchScore: v.number(),
        matchedName: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check for existing result
    const existing = await ctx.db
      .query("screeningResults")
      .filter((q) => q.eq(q.field("beneficiaryId"), args.beneficiaryId))
      .first();

    if (existing) {
      // Don't overwrite a manual review (false_positive or confirmed_match)
      if (
        existing.status === "false_positive" ||
        existing.status === "confirmed_match"
      ) {
        return existing._id;
      }

      await ctx.db.patch(existing._id, {
        status: args.status,
        matches: args.matches,
        screenedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("screeningResults", {
      orgId: args.orgId,
      beneficiaryId: args.beneficiaryId,
      status: args.status,
      matches: args.matches,
      screenedAt: now,
    });
  },
});

// ─── Public: update screening result (admin review) ─────────────────────────────

export const reviewScreeningResult = mutation({
  args: {
    screeningResultId: v.id("screeningResults"),
    walletAddress: v.string(),
    status: v.union(
      v.literal("confirmed_match"),
      v.literal("false_positive")
    ),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    const result = await ctx.db.get(args.screeningResultId);
    if (!result) throw new Error("Screening result not found");

    const { user } = await requireOrgAccess(ctx, result.orgId, walletAddress, ["admin"]);

    await ctx.db.patch(args.screeningResultId, {
      status: args.status,
      reviewedBy: user._id,
      reviewedAt: now,
    });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: result.orgId,
      actorUserId: user._id,
      action: "screening.reviewed",
      objectType: "screeningResult",
      objectId: args.screeningResultId,
      metadata: {
        beneficiaryId: result.beneficiaryId,
        previousStatus: result.status,
        newStatus: args.status,
      },
      timestamp: now,
    });

    return { success: true };
  },
});

// ─── Public: update org screening enforcement ───────────────────────────────────

export const updateScreeningEnforcement = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    enforcement: v.union(
      v.literal("block"),
      v.literal("warn"),
      v.literal("off")
    ),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const { user } = await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin"]);

    await ctx.db.patch(args.orgId, {
      screeningEnforcement: args.enforcement,
    });

    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "org.screeningEnforcementUpdated",
      objectType: "org",
      objectId: args.orgId,
      metadata: { enforcement: args.enforcement },
      timestamp: Date.now(),
    });

    return { success: true };
  },
});
