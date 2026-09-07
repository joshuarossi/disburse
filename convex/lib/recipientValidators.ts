import { v } from "convex/values";

export const payoutDetailsValidator = v.object({
  walletAddress: v.string(),
  preferredToken: v.optional(v.string()),
  preferredChainId: v.optional(v.number()),
});
export const verificationMethodValidator = v.union(
  v.literal("known_contact"),
  v.literal("in_person"),
  v.literal("verified_portal"),
);
