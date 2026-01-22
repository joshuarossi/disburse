import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Users - wallet address is the primary identity
  users: defineTable({
    walletAddress: v.string(),
    email: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_wallet", ["walletAddress"]),

  // Sessions for auth
  sessions: defineTable({
    userId: v.id("users"),
    walletAddress: v.string(),
    nonce: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_wallet", ["walletAddress"])
    .index("by_nonce", ["nonce"]),

  // Organizations
  orgs: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }),

  // Organization memberships with roles
  orgMemberships: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    role: v.union(
      v.literal("admin"),
      v.literal("approver"),
      v.literal("initiator"),
      v.literal("clerk"),
      v.literal("viewer")
    ),
    status: v.union(
      v.literal("active"),
      v.literal("invited"),
      v.literal("removed")
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_and_user", ["orgId", "userId"]),

  // Safes linked to orgs
  safes: defineTable({
    orgId: v.id("orgs"),
    chainId: v.number(),
    safeAddress: v.string(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_address", ["safeAddress"]),

  // Beneficiaries (payment recipients)
  beneficiaries: defineTable({
    orgId: v.id("orgs"),
    // Optional for backwards compatibility with existing records (defaults to "individual")
    type: v.optional(v.union(v.literal("individual"), v.literal("business"))),
    name: v.string(),
    walletAddress: v.string(),
    notes: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_active", ["orgId", "isActive"]),

  // Disbursements (payment intents)
  disbursements: defineTable({
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    beneficiaryId: v.id("beneficiaries"),
    token: v.string(), // "USDC" or "USDT"
    amount: v.string(), // stored as string to preserve precision
    memo: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("proposed"),
      v.literal("executed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    safeTxHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_safe", ["safeId"]),

  // Billing records
  billing: defineTable({
    orgId: v.id("orgs"),
    plan: v.union(
      v.literal("trial"),
      v.literal("starter"),
      v.literal("team"),
      v.literal("pro")
    ),
    trialEndsAt: v.optional(v.number()),
    paidThroughAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("trial"),
      v.literal("expired"),
      v.literal("cancelled")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"]),

  // Audit log for compliance
  auditLog: defineTable({
    orgId: v.id("orgs"),
    actorUserId: v.id("users"),
    action: v.string(),
    objectType: v.string(),
    objectId: v.string(),
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_timestamp", ["orgId", "timestamp"]),
});
