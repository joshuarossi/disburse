import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Users - wallet address is the primary identity
  users: defineTable({
    walletAddress: v.string(),
    email: v.optional(v.string()),
    preferredLanguage: v.optional(v.union(
      v.literal("en"),
      v.literal("es"),
      v.literal("pt-BR")
    )),
    preferredTheme: v.optional(v.union(
      v.literal("dark"),
      v.literal("light")
    )),
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
    screeningEnforcement: v.optional(v.union(
      v.literal("block"),
      v.literal("warn"),
      v.literal("off")
    )),
    createdAt: v.number(),
  }),

  // Organization memberships with roles
  orgMemberships: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    name: v.optional(v.string()), // Optional display name for the member
    email: v.optional(v.string()), // Optional email for the member
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

  // Safes linked to orgs (one row per org per chain; same safeAddress across chains for one org)
  safes: defineTable({
    orgId: v.id("orgs"),
    chainId: v.number(),
    safeAddress: v.string(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_chain", ["orgId", "chainId"])
    .index("by_address", ["safeAddress"]),

  // Beneficiaries (payment recipients)
  beneficiaries: defineTable({
    orgId: v.id("orgs"),
    // Optional for backwards compatibility with existing records (defaults to "individual")
    type: v.optional(v.union(v.literal("individual"), v.literal("business"))),
    name: v.string(),
    walletAddress: v.string(),
    notes: v.optional(v.string()),
    preferredToken: v.optional(v.string()),
    preferredChainId: v.optional(v.number()),
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
    chainId: v.optional(v.number()), // Required for new records; backfilled for existing
    beneficiaryId: v.optional(v.id("beneficiaries")), // Optional for batch disbursements
    token: v.string(), // "USDC", "USDT", "PYUSD", etc.
    amount: v.optional(v.string()), // Optional for batch disbursements (stored as string to preserve precision)
    totalAmount: v.optional(v.string()), // For batch disbursements, sum of all recipient amounts
    type: v.optional(v.union(v.literal("single"), v.literal("batch"))), // Defaults to "single" for backward compatibility
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
    .index("by_org_chain", ["orgId", "chainId"])
    .index("by_safe", ["safeId"]),

  // Disbursement recipients (for batch disbursements)
  disbursementRecipients: defineTable({
    disbursementId: v.id("disbursements"),
    beneficiaryId: v.id("beneficiaries"),
    recipientAddress: v.string(), // Denormalized for performance
    amount: v.string(), // Human-readable amount
    createdAt: v.number(),
  })
    .index("by_disbursement", ["disbursementId"])
    .index("by_beneficiary", ["beneficiaryId"]),

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

  // SDN (Specially Designated Nationals) entries for OFAC screening
  sdnEntries: defineTable({
    sdnId: v.number(),
    entityType: v.union(v.literal("individual"), v.literal("entity")),
    primaryName: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    aliases: v.array(v.string()),
    programs: v.array(v.string()),
  })
    .index("by_sdnId", ["sdnId"])
    .searchIndex("search_primaryName", {
      searchField: "primaryName",
    }),

  // Screening results for beneficiaries
  screeningResults: defineTable({
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
    screenedAt: v.number(),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_beneficiary", ["beneficiaryId"]),
});
