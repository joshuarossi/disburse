"use node";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  matchListedAddress,
  matchSdnName,
  SCREENING_ENGINE,
} from "../shared/sanctions";
import {
  screeningInput,
  screeningInputFingerprint,
} from "../shared/screeningEvidence";

type Match = Doc<"screeningResults">["matches"][number];
type NameResult = { datasetId: Id<"ofacDatasets">; matches: Match[] };
export const screenName = internalAction({
  args: {
    name: v.string(),
    walletAddress: v.optional(v.string()),
    chainId: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<NameResult> => {
    const { dataset } = await ctx.runQuery(internal.ofacData.current, {});
    if (
      !dataset ||
      dataset.state !== "active" ||
      dataset.engine !== SCREENING_ENGINE
    )
      throw new Error(
        "The OFAC list is unavailable. No clear result was recorded.",
      );
    const candidates = await ctx.runQuery(internal.ofacData.candidates, {
      datasetId: dataset._id,
      ...args,
    });
    const matches: Match[] = [];
    for (const entry of candidates) {
      const name = matchSdnName(args.name, entry);
      if (name)
        matches.push({
          sdnId: entry.sdnId,
          ...name,
          programs: entry.programs,
          kind: "name",
        });
      if (args.walletAddress)
        for (const address of entry.addresses) {
          const match = matchListedAddress(
            args.walletAddress,
            args.chainId,
            address,
          );
          if (match)
            matches.push({
              sdnId: entry.sdnId,
              matchedName: entry.primaryName,
              matchScore: 1,
              programs: entry.programs,
              kind: "address",
              matchedAddress: match.address,
              listedCurrency: match.listedCurrency,
              listedChainId: match.listedChainId,
              networkMatch: match.networkMatch,
            });
        }
      if (matches.length > 100)
        throw new Error(
          "This name is too broad for an automatic screening result. Review a more complete recipient name.",
        );
    }
    return { datasetId: dataset._id, matches };
  },
});

export const screenBeneficiary = internalAction({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    orgId: v.id("orgs"),
    sessionToken: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: string; matchCount: number }> => {
    const started = await ctx.runMutation(
      internal.screeningMutations.beginScreening,
      { beneficiaryId: args.beneficiaryId, orgId: args.orgId },
    );
    if (!started) return { status: "skipped", matchCount: 0 };
    const { recipient, attempt } = started;
    const input = screeningInput(recipient),
      expectedFingerprint = screeningInputFingerprint(recipient);
    try {
      const evidence = await ctx.runAction(internal.screening.screenName, {
        name: recipient.name,
        walletAddress: recipient.walletAddress,
        chainId: recipient.preferredChainId,
      });
      const status = evidence.matches.length
        ? ("potential_match" as const)
        : ("clear" as const);
      await ctx.runMutation(internal.screeningMutations.upsertScreeningResult, {
        orgId: args.orgId,
        beneficiaryId: recipient._id,
        input,
        expectedFingerprint,
        attempt,
        ...evidence,
        status,
      });
      return { status, matchCount: evidence.matches.length };
    } catch (e) {
      const error =
        e instanceof Error ? e.message : "Screening did not complete.";
      // A result for a concurrently edited recipient cannot replace newer evidence.
      await ctx.runMutation(internal.screeningMutations.upsertScreeningResult, {
        orgId: args.orgId,
        beneficiaryId: recipient._id,
        input,
        expectedFingerprint,
        attempt,
        status: "unavailable",
        matches: [],
        error,
      });
      throw new Error(error);
    }
  },
});
export const screenAllBeneficiaries = action({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args): Promise<{ queued: boolean }> =>
    ctx.runMutation(internal.screeningQueue.queueOrg, args),
});
export const rerunScreening = action({
  args: { beneficiaryId: v.id("beneficiaries"), sessionToken: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: string; matchCount: number }> => {
    const { orgId } = await ctx.runQuery(
      internal.screeningQueries.verifyBeneficiaryAccess,
      { ...args, allowedRoles: ["admin", "approver", "initiator", "clerk"] },
    );
    return ctx.runAction(internal.screening.screenBeneficiary, {
      ...args,
      orgId,
    });
  },
});
