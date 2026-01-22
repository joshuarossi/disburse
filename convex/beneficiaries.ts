import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import { getOrgLimits } from "./billing";

// List beneficiaries for an org
export const list = query({
  args: { 
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Verify access (any role can view)
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    if (args.activeOnly) {
      return await ctx.db
        .query("beneficiaries")
        .withIndex("by_org_active", (q) => 
          q.eq("orgId", args.orgId).eq("isActive", true)
        )
        .collect();
    }

    return await ctx.db
      .query("beneficiaries")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

// Create a new beneficiary
export const create = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    type: v.union(v.literal("individual"), v.literal("business")),
    name: v.string(),
    beneficiaryAddress: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Verify access (admin, initiator, or clerk can create)
    const { user } = await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "initiator", "clerk"]);

    // Check tier limits for beneficiaries
    const limits = await getOrgLimits(ctx, args.orgId);
    const beneficiaryCount = await ctx.db
      .query("beneficiaries")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    if (beneficiaryCount.length >= limits.maxBeneficiaries) {
      throw new Error(`Your plan allows a maximum of ${limits.maxBeneficiaries} beneficiaries. Please upgrade to add more.`);
    }

    const beneficiaryId = await ctx.db.insert("beneficiaries", {
      orgId: args.orgId,
      type: args.type,
      name: args.name,
      walletAddress: args.beneficiaryAddress.toLowerCase(),
      notes: args.notes,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "beneficiary.created",
      objectType: "beneficiary",
      objectId: beneficiaryId,
      metadata: { type: args.type, name: args.name, walletAddress: args.beneficiaryAddress },
      timestamp: now,
    });

    return { beneficiaryId };
  },
});

// Update a beneficiary
export const update = mutation({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    walletAddress: v.string(),
    type: v.optional(v.union(v.literal("individual"), v.literal("business"))),
    name: v.optional(v.string()),
    beneficiaryAddress: v.optional(v.string()),
    notes: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    const beneficiary = await ctx.db.get(args.beneficiaryId);
    if (!beneficiary) {
      throw new Error("Beneficiary not found");
    }

    // Verify access
    const { user } = await requireOrgAccess(ctx, beneficiary.orgId, walletAddress, ["admin", "initiator", "clerk"]);

    const updates: Record<string, unknown> = { updatedAt: now };
    if (args.type !== undefined) updates.type = args.type;
    if (args.name !== undefined) updates.name = args.name;
    if (args.beneficiaryAddress !== undefined) updates.walletAddress = args.beneficiaryAddress.toLowerCase();
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.isActive !== undefined) updates.isActive = args.isActive;

    await ctx.db.patch(args.beneficiaryId, updates);

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: beneficiary.orgId,
      actorUserId: user._id,
      action: "beneficiary.updated",
      objectType: "beneficiary",
      objectId: args.beneficiaryId,
      metadata: updates,
      timestamp: now,
    });

    return { success: true };
  },
});

// Get single beneficiary
export const get = query({
  args: { 
    beneficiaryId: v.id("beneficiaries"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const beneficiary = await ctx.db.get(args.beneficiaryId);
    if (!beneficiary) {
      return null;
    }

    // Verify access
    await requireOrgAccess(ctx, beneficiary.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    return beneficiary;
  },
});
