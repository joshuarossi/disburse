import { v } from "convex/values";

export const policyIntentValidator = v.object({
  kind: v.union(v.literal("grant"), v.literal("revoke")),
  module: v.string(),
  delegate: v.string(),
  tokenAddress: v.string(),
  token: v.optional(v.string()),
  amount: v.optional(v.string()),
  resetMinutes: v.optional(v.number()),
  moduleEnabled: v.boolean(),
  delegateExists: v.boolean(),
  previousAmount: v.string(),
  previousResetMinutes: v.number(),
});
export const policyFeeValidator = v.object({
  token: v.string(),
  tokenAddress: v.string(),
  collector: v.string(),
  amount: v.string(),
});
export const policyExecutionValidator = v.object({
  service: v.optional(v.literal('circle')),
  attemptId: v.string(),
  actorUserId: v.id("users"),
  startedAt: v.number(),
  searchFromBlock: v.string(),
  checks: v.number(),
  to: v.string(),
  data: v.string(),
  phase: v.union(
    v.literal("prepared"),
    v.literal("submitting"),
    v.literal("submitted"),
  ),
  providerId: v.optional(v.string()),
  txHash: v.optional(v.string()),
  walletRejectedAt: v.optional(v.number()),
});
