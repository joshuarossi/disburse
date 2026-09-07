import { v } from "convex/values";
export const licenseTierValidator = v.object({
  key: v.string(),
  name: v.string(),
  maxUsers: v.union(v.number(), v.null()),
  maxBeneficiaries: v.union(v.number(), v.null()),
});
export const licenseGrantValidator = v.object({
  kind: v.union(v.literal("trial"), v.literal("complimentary")),
  tier: licenseTierValidator,
  expiresAt: v.optional(v.number()),
  grantedAt: v.number(),
});
