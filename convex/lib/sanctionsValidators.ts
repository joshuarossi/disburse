import { v } from "convex/values";

export const sdnEntryFields = {
  sdnId: v.number(),
  entityType: v.union(v.literal("individual"), v.literal("entity")),
  sourceType: v.string(),
  primaryName: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  aliases: v.array(v.string()),
  weakAliases: v.array(v.string()),
  programs: v.array(v.string()),
  addresses: v.array(v.object({ currency: v.string(), address: v.string() })),
};
export const screeningMatchValidator = v.object({
  sdnId: v.number(),
  matchedName: v.string(),
  matchScore: v.number(),
  kind: v.optional(v.union(v.literal("name"), v.literal("address"))),
  alias: v.optional(
    v.union(v.literal("primary"), v.literal("strong"), v.literal("weak")),
  ),
  programs: v.optional(v.array(v.string())),
  matchedAddress: v.optional(v.string()),
  listedCurrency: v.optional(v.string()),
  listedChainId: v.optional(v.number()),
  networkMatch: v.optional(
    v.union(
      v.literal("listed_network"),
      v.literal("other_network"),
      v.literal("unspecified_network"),
    ),
  ),
});
export const screeningInputValidator = v.object({
  name: v.string(),
  walletAddress: v.string(),
  type: v.optional(v.string()),
  email: v.optional(v.string()),
  preferredToken: v.optional(v.string()),
  preferredChainId: v.optional(v.number()),
  payoutVersion: v.optional(v.number()),
});
