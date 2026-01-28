import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";

// ─── Internal queries (used by screening actions) ───────────────────────────────

// Search SDN entries by name using full-text search index.
// Returns candidate matches (up to 256) for the given search terms.
export const searchSdnByName = internalQuery({
  args: {
    searchTerms: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const allCandidates = [];

    for (const term of args.searchTerms) {
      if (!term.trim()) continue;
      const results = await ctx.db
        .query("sdnEntries")
        .withSearchIndex("search_primaryName", (q) => q.search("primaryName", term))
        .take(64);
      allCandidates.push(...results);
    }

    // Deduplicate by sdnId
    const seen = new Set<number>();
    return allCandidates.filter((entry) => {
      if (seen.has(entry.sdnId)) return false;
      seen.add(entry.sdnId);
      return true;
    });
  },
});

export const getBeneficiary = internalQuery({
  args: {
    beneficiaryId: v.id("beneficiaries"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.beneficiaryId);
  },
});

export const getActiveBeneficiariesForOrg = internalQuery({
  args: {
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("beneficiaries")
      .withIndex("by_org_active", (q) =>
        q.eq("orgId", args.orgId).eq("isActive", true)
      )
      .collect();
  },
});

// Internal query to verify access to a beneficiary's org
export const verifyBeneficiaryAccess = internalQuery({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    walletAddress: v.string(),
    allowedRoles: v.array(
      v.union(
        v.literal("admin"),
        v.literal("approver"),
        v.literal("initiator"),
        v.literal("clerk"),
        v.literal("viewer")
      )
    ),
  },
  handler: async (ctx, args): Promise<{ orgId: any }> => {
    const walletAddress = args.walletAddress.toLowerCase();
    const beneficiary = await ctx.db.get(args.beneficiaryId);
    if (!beneficiary) throw new Error("Beneficiary not found");

    await requireOrgAccess(ctx, beneficiary.orgId, walletAddress, args.allowedRoles);
    return { orgId: beneficiary.orgId };
  },
});

// ─── Public queries ─────────────────────────────────────────────────────────────

// Get screening result for a single beneficiary
export const getScreeningResult = query({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const beneficiary = await ctx.db.get(args.beneficiaryId);
    if (!beneficiary) return null;

    await requireOrgAccess(ctx, beneficiary.orgId, walletAddress, [
      "admin", "approver", "initiator", "clerk", "viewer",
    ]);

    return await ctx.db
      .query("screeningResults")
      .filter((q) => q.eq(q.field("beneficiaryId"), args.beneficiaryId))
      .first();
  },
});

// Get screening results for all beneficiaries in an org
export const listScreeningResults = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    statusFilter: v.optional(
      v.union(
        v.literal("clear"),
        v.literal("potential_match"),
        v.literal("confirmed_match"),
        v.literal("false_positive"),
        v.literal("pending")
      )
    ),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    await requireOrgAccess(ctx, args.orgId, walletAddress, [
      "admin", "approver", "initiator", "clerk", "viewer",
    ]);

    const results = await ctx.db
      .query("screeningResults")
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .collect();

    if (args.statusFilter && args.statusFilter !== "pending") {
      return results.filter((r) => r.status === args.statusFilter);
    }

    return results;
  },
});

// Get screening enforcement setting for an org
export const getScreeningEnforcement = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    await requireOrgAccess(ctx, args.orgId, walletAddress, [
      "admin", "approver", "initiator", "clerk", "viewer",
    ]);

    const org = await ctx.db.get(args.orgId);
    return org?.screeningEnforcement ?? "off";
  },
});

// Check if any recipients of a disbursement are flagged
export const checkDisbursementRecipients = internalQuery({
  args: {
    disbursementId: v.id("disbursements"),
  },
  handler: async (ctx, args) => {
    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) return { clear: true, flagged: [] };

    // Get org enforcement setting
    const org = await ctx.db.get(disbursement.orgId);
    const enforcement = org?.screeningEnforcement ?? "off";

    if (enforcement === "off") return { clear: true, flagged: [], enforcement };

    // Collect beneficiary IDs
    const beneficiaryIds: string[] = [];

    if (disbursement.type === "batch") {
      const recipients = await ctx.db
        .query("disbursementRecipients")
        .withIndex("by_disbursement", (q) =>
          q.eq("disbursementId", args.disbursementId)
        )
        .collect();
      for (const r of recipients) {
        beneficiaryIds.push(r.beneficiaryId);
      }
    } else if (disbursement.beneficiaryId) {
      beneficiaryIds.push(disbursement.beneficiaryId);
    }

    // Check screening results for each
    const flagged: Array<{
      beneficiaryId: string;
      beneficiaryName: string;
      status: string;
    }> = [];

    for (const beneficiaryId of beneficiaryIds) {
      const result = await ctx.db
        .query("screeningResults")
        .filter((q) => q.eq(q.field("beneficiaryId"), beneficiaryId))
        .first();

      if (
        result &&
        (result.status === "potential_match" || result.status === "confirmed_match")
      ) {
        const beneficiary = await ctx.db.get(result.beneficiaryId);
        flagged.push({
          beneficiaryId,
          beneficiaryName: beneficiary?.name ?? "Unknown",
          status: result.status,
        });
      }
    }

    return {
      clear: flagged.length === 0,
      flagged,
      enforcement,
    };
  },
});
