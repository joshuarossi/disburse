"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ─── Fuzzy matching utility ────────────────────────────────────────────────────

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Threshold for fuzzy matching (0.85 = 85% similar)
const FUZZY_THRESHOLD = 0.85;

// SDN XML import is handled by scripts/import-sdn.ts (local script)

// ─── Screen a single name against SDN list ──────────────────────────────────────

export const screenName = internalAction({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedInput = normalize(args.name);

    // Build search terms: full name + individual words
    const words = args.name.trim().split(/\s+/).filter((w) => w.length > 1);
    const searchTerms = [args.name.trim(), ...words];
    // Deduplicate
    const uniqueTerms = [...new Set(searchTerms)];

    // Search for candidates using the full-text search index
    const candidates = await ctx.runQuery(
      internal.screeningQueries.searchSdnByName,
      { searchTerms: uniqueTerms }
    );

    const matches: Array<{
      sdnId: number;
      matchedName: string;
      matchScore: number;
      entityType: "individual" | "entity";
      programs: string[];
    }> = [];

    for (const entry of candidates) {
      // Check primary name
      const normalizedPrimary = normalize(entry.primaryName);
      if (normalizedPrimary === normalizedInput) {
        matches.push({
          sdnId: entry.sdnId,
          matchedName: entry.primaryName,
          matchScore: 1.0,
          entityType: entry.entityType,
          programs: entry.programs,
        });
        continue;
      }

      const primarySim = similarity(normalizedInput, normalizedPrimary);
      if (primarySim >= FUZZY_THRESHOLD) {
        matches.push({
          sdnId: entry.sdnId,
          matchedName: entry.primaryName,
          matchScore: primarySim,
          entityType: entry.entityType,
          programs: entry.programs,
        });
        continue;
      }

      // Check aliases
      let aliasMatch = false;
      for (const alias of entry.aliases) {
        const normalizedAlias = normalize(alias);
        if (normalizedAlias === normalizedInput) {
          matches.push({
            sdnId: entry.sdnId,
            matchedName: alias,
            matchScore: 1.0,
            entityType: entry.entityType,
            programs: entry.programs,
          });
          aliasMatch = true;
          break;
        }
        const aliasSim = similarity(normalizedInput, normalizedAlias);
        if (aliasSim >= FUZZY_THRESHOLD) {
          matches.push({
            sdnId: entry.sdnId,
            matchedName: alias,
            matchScore: aliasSim,
            entityType: entry.entityType,
            programs: entry.programs,
          });
          aliasMatch = true;
          break;
        }
      }
      if (aliasMatch) continue;

      // Also check first+last name combo for individuals
      if (entry.firstName && entry.lastName) {
        const fullCombo = normalize(`${entry.firstName} ${entry.lastName}`);
        const comboSim = similarity(normalizedInput, fullCombo);
        if (comboSim >= FUZZY_THRESHOLD) {
          matches.push({
            sdnId: entry.sdnId,
            matchedName: `${entry.firstName} ${entry.lastName}`,
            matchScore: comboSim,
            entityType: entry.entityType,
            programs: entry.programs,
          });
        }
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.matchScore - a.matchScore);

    return matches;
  },
});

// ─── Screen a beneficiary and store results ─────────────────────────────────────

export const screenBeneficiary = internalAction({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    orgId: v.id("orgs"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string; matchCount: number }> => {
    // Get beneficiary
    const beneficiary = await ctx.runQuery(internal.screeningQueries.getBeneficiary, {
      beneficiaryId: args.beneficiaryId,
    });
    if (!beneficiary) throw new Error("Beneficiary not found");

    // Screen name
    const matches: Array<{
      sdnId: number;
      matchedName: string;
      matchScore: number;
      entityType: "individual" | "entity";
      programs: string[];
    }> = await ctx.runAction(internal.screening.screenName, {
      name: beneficiary.name,
    });

    const status: "potential_match" | "clear" = matches.length > 0 ? "potential_match" : "clear";

    // Store result
    await ctx.runMutation(internal.screeningMutations.upsertScreeningResult, {
      orgId: args.orgId,
      beneficiaryId: args.beneficiaryId,
      status,
      matches: matches.map((m: { sdnId: number; matchScore: number; matchedName: string }) => ({
        sdnId: m.sdnId,
        matchScore: m.matchScore,
        matchedName: m.matchedName,
      })),
    });

    return { status, matchCount: matches.length };
  },
});

// ─── Screen all beneficiaries for an org ─────────────────────────────────────────

export const screenAllBeneficiaries = action({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const beneficiaries = await ctx.runQuery(
      internal.screeningQueries.getActiveBeneficiariesForOrg,
      { orgId: args.orgId }
    );

    let screened = 0;
    let flagged = 0;

    for (const beneficiary of beneficiaries) {
      const result = await ctx.runAction(internal.screening.screenBeneficiary, {
        beneficiaryId: beneficiary._id,
        orgId: args.orgId,
        walletAddress: args.walletAddress,
      });
      screened++;
      if (result.status === "potential_match") flagged++;
    }

    return { screened, flagged };
  },
});

// ─── Rerun screening for a single beneficiary ────────────────────────────────────

export const rerunScreening = action({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string; matchCount: number }> => {
    // Verify access (admin, approver, initiator, or clerk can rerun)
    const { orgId } = await ctx.runQuery(internal.screeningQueries.verifyBeneficiaryAccess, {
      beneficiaryId: args.beneficiaryId,
      walletAddress: args.walletAddress,
      allowedRoles: ["admin", "approver", "initiator", "clerk"],
    });

    // Rerun the screening
    const result: { status: string; matchCount: number } = await ctx.runAction(internal.screening.screenBeneficiary, {
      beneficiaryId: args.beneficiaryId,
      orgId,
      walletAddress: args.walletAddress,
    });

    return result;
  },
});
