import { appendAudit, type AuditValue } from "./audit";
import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import { getOrgLimits } from "./billing";
import { dedupeTagNames } from "./lib/tags";
import { assertValidAddress } from "./lib/validation";
import { Id } from "./_generated/dataModel";
import { requestPayoutReview, payoutDetails } from './lib/recipientReview';
import { payoutDetailsEqual } from '../shared/recipientAssurance';

const buildTagsForOrg = async (ctx: QueryCtx, orgId: Id<"orgs">) => {
  const assignments = await ctx.db
    .query("beneficiaryTags")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();

  const tagIds = Array.from(
    new Set(assignments.map((assignment) => assignment.tagId)),
  );
  const tagDocs = await Promise.all(tagIds.map((tagId) => ctx.db.get(tagId)));
  const tagsById = new Map(
    tagDocs.filter(Boolean).map((tag) => [tag!._id, tag]),
  );

  const tagsByBeneficiary = new Map<Id<"beneficiaries">, string[]>();
  for (const assignment of assignments) {
    const tag = tagsById.get(assignment.tagId);
    if (!tag) continue;
    const list = tagsByBeneficiary.get(assignment.beneficiaryId) ?? [];
    list.push(tag.name);
    tagsByBeneficiary.set(assignment.beneficiaryId, list);
  }

  for (const [beneficiaryId, tags] of tagsByBeneficiary.entries()) {
    tags.sort((a, b) => a.localeCompare(b));
    tagsByBeneficiary.set(beneficiaryId, tags);
  }

  return tagsByBeneficiary;
};

const upsertTags = async (
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
  tagNames: string[],
): Promise<Array<Id<"tags">>> => {
  const now = Date.now();
  const deduped = dedupeTagNames(tagNames);
  const tagIds: Array<Id<"tags">> = [];

  for (const tag of deduped) {
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_org_normalized", (q) =>
        q.eq("orgId", orgId).eq("normalizedName", tag.normalized),
      )
      .first();

    if (existing) {
      tagIds.push(existing._id);
      continue;
    }

    const tagId = await ctx.db.insert("tags", {
      orgId,
      name: tag.name,
      normalizedName: tag.normalized,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    tagIds.push(tagId);
  }

  return tagIds;
};

const setBeneficiaryTags = async (
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  beneficiaryId: Id<"beneficiaries">,
  userId: Id<"users">,
  tagNames: string[],
) => {
  const now = Date.now();
  const tagIds = await upsertTags(ctx, orgId, userId, tagNames);
  const desiredIds = new Set(tagIds);

  const existing = await ctx.db
    .query("beneficiaryTags")
    .withIndex("by_beneficiary", (q) => q.eq("beneficiaryId", beneficiaryId))
    .collect();

  const existingIds = new Set(existing.map((assignment) => assignment.tagId));

  for (const assignment of existing) {
    if (!desiredIds.has(assignment.tagId)) {
      await ctx.db.delete(assignment._id);
    }
  }

  for (const tagId of desiredIds) {
    if (!existingIds.has(tagId)) {
      await ctx.db.insert("beneficiaryTags", {
        orgId,
        beneficiaryId,
        tagId,
        createdAt: now,
      });
    }
  }
};

// List beneficiaries for an org
export const list = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    activeOnly: v.optional(v.boolean()),
    includeTags: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Verify access (any role can view)
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    const includeTags = args.includeTags ?? false;
    const tagsByBeneficiary = includeTags
      ? await buildTagsForOrg(ctx, args.orgId)
      : new Map();

    if (args.activeOnly) {
      const beneficiaries = await ctx.db
        .query("beneficiaries")
        .withIndex("by_org_active", (q) =>
          q.eq("orgId", args.orgId).eq("isActive", true),
        )
        .collect();

      return beneficiaries.map((beneficiary) => ({
        ...beneficiary,
        tags: includeTags ? (tagsByBeneficiary.get(beneficiary._id) ?? []) : [],
      }));
    }

    const beneficiaries = await ctx.db
      .query("beneficiaries")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    return beneficiaries.map((beneficiary) => ({
      ...beneficiary,
      tags: includeTags ? (tagsByBeneficiary.get(beneficiary._id) ?? []) : [],
    }));
  },
});

// Create a new beneficiary
export const create = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    type: v.union(v.literal("individual"), v.literal("business")),
    name: v.string(),
    email: v.optional(v.string()),
    allowMissingPaymentDetails: v.optional(v.boolean()),
    beneficiaryAddress: v.string(),
    notes: v.optional(v.string()),
    preferredToken: v.optional(v.string()),
    preferredChainId: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify access (admin, initiator, or clerk can create)
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin", "initiator", "clerk"],
    );

    // Check tier limits for beneficiaries
    const limits = await getOrgLimits(ctx, args.orgId);
    const beneficiaryCount = await ctx.db
      .query("beneficiaries")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    if (beneficiaryCount.length >= limits.maxBeneficiaries) {
      throw new Error(
        `Your plan allows a maximum of ${limits.maxBeneficiaries} beneficiaries. Please upgrade to add more.`,
      );
    }

    validateSavedPayoutInstructions(args);
    // H-03: validate destination address server-side before persisting
    if (!args.name.trim() || args.name.trim().length > 200)
      throw new Error("Enter a recipient name of 1 to 200 characters");
    const email = args.email?.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Enter a valid email address");
    if (args.beneficiaryAddress || !args.allowMissingPaymentDetails)
      assertValidAddress(args.beneficiaryAddress, "beneficiary wallet address");
    else if (!email)
      throw new Error("An email is required when payment details are missing");
    if (
      beneficiaryCount.some(
        (b) =>
          (args.beneficiaryAddress &&
            b.walletAddress.toLowerCase() ===
              args.beneficiaryAddress.toLowerCase()) ||
          (email && b.email?.toLowerCase() === email),
      )
    )
      throw new Error("A recipient with these details already exists");
    const beneficiaryId = await ctx.db.insert("beneficiaries", {
      orgId: args.orgId,
      type: args.type,
      name: args.name.trim(),
      email,
      walletAddress: args.beneficiaryAddress.toLowerCase(),
      payoutVersion: 0,
      payoutReviewStatus: 'unreviewed',
      notes: args.notes,
      preferredToken: args.preferredToken,
      preferredChainId: args.preferredChainId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    if (args.beneficiaryAddress) {
      const recipient = (await ctx.db.get(beneficiaryId))!;
      await requestPayoutReview(ctx, recipient, payoutDetails(recipient), user._id);
    }
    if (args.tags && args.tags.length > 0) {
      await setBeneficiaryTags(
        ctx,
        args.orgId,
        beneficiaryId,
        user._id,
        args.tags,
      );
    }

    // Audit log
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "beneficiary.created",
      objectType: "beneficiary",
      objectId: beneficiaryId,
      metadata: {
        type: args.type,
        name: args.name,
        walletAddress: args.beneficiaryAddress,
        tags: args.tags ?? [],
      },
      timestamp: now,
    });

    // Schedule async SDN screening
    await ctx.scheduler.runAfter(0, internal.screening.screenBeneficiary, {
      beneficiaryId,
      orgId: args.orgId,
      sessionToken: args.sessionToken,
    });

    return { beneficiaryId };
  },
});

// Update a beneficiary
export const update = mutation({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    sessionToken: v.string(),
    type: v.optional(v.union(v.literal("individual"), v.literal("business"))),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    beneficiaryAddress: v.optional(v.string()),
    notes: v.optional(v.string()),
    preferredToken: v.optional(v.union(v.string(), v.null())),
    preferredChainId: v.optional(v.union(v.number(), v.null())),
    isActive: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const beneficiary = await ctx.db.get(args.beneficiaryId);
    if (!beneficiary) {
      throw new Error("Beneficiary not found");
    }

    // Verify access
    const { user } = await requireOrgAccess(
      ctx,
      beneficiary.orgId,
      args.sessionToken,
      ["admin", "initiator", "clerk"],
    );

    const updates: Record<string, unknown> = { updatedAt: now };
    validateSavedPayoutInstructions({
      preferredToken:
        args.preferredToken === undefined
          ? beneficiary.preferredToken
          : args.preferredToken,
      preferredChainId:
        args.preferredChainId === undefined
          ? beneficiary.preferredChainId
          : args.preferredChainId,
    });
    if (args.type !== undefined) updates.type = args.type;
    if (args.name !== undefined) {
      if (!args.name.trim() || args.name.trim().length > 200)
        throw new Error("Enter a recipient name of 1 to 200 characters");
      updates.name = args.name.trim();
    }
    if (args.email !== undefined) {
      const email = args.email.trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Enter a valid email address");
      if (!email && !beneficiary.walletAddress && !args.beneficiaryAddress)
        throw new Error("Keep an email until payment details are supplied");
      updates.email = email || undefined;
    }
    if (args.beneficiaryAddress !== undefined) {
      assertValidAddress(args.beneficiaryAddress, "beneficiary wallet address");
      updates.walletAddress = args.beneficiaryAddress.toLowerCase();
    }
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.preferredToken !== undefined)
      updates.preferredToken = args.preferredToken ?? undefined;
    if (args.preferredChainId !== undefined)
      updates.preferredChainId = args.preferredChainId ?? undefined;
    if (args.isActive !== undefined) updates.isActive = args.isActive;

    if (args.beneficiaryAddress || args.email) {
      const others = await ctx.db
        .query("beneficiaries")
        .withIndex("by_org", (q) => q.eq("orgId", beneficiary.orgId))
        .collect();
      if (
        others.some(
          (b) =>
            b._id !== beneficiary._id &&
            ((args.beneficiaryAddress &&
              b.walletAddress.toLowerCase() ===
                args.beneficiaryAddress.toLowerCase()) ||
              (args.email &&
                b.email?.toLowerCase() === args.email.trim().toLowerCase())),
        )
      )
        throw new Error("Another recipient already uses these details");
    }
    const proposed = {
      walletAddress: args.beneficiaryAddress?.toLowerCase() ?? beneficiary.walletAddress,
      preferredToken: args.preferredToken === undefined ? beneficiary.preferredToken : args.preferredToken ?? undefined,
      preferredChainId: args.preferredChainId === undefined ? beneficiary.preferredChainId : args.preferredChainId ?? undefined,
    };
    if (!payoutDetailsEqual(beneficiary, proposed)) {
      if (!proposed.walletAddress) throw new Error('Add a payout address before requesting review of payment instructions');
      await requestPayoutReview(ctx, beneficiary, proposed, user._id);
      delete updates.walletAddress;
      delete updates.preferredToken;
      delete updates.preferredChainId;
    }
    await ctx.db.patch(args.beneficiaryId, updates);
    if (
      (args.name && args.name.trim() !== beneficiary.name) ||
      (args.beneficiaryAddress &&
        args.beneficiaryAddress.toLowerCase() !== beneficiary.walletAddress)
    ) {
      await ctx.scheduler.runAfter(0, internal.screening.screenBeneficiary, {
        beneficiaryId: beneficiary._id,
        orgId: beneficiary.orgId,
        sessionToken: args.sessionToken,
      });
    }

    if (args.tags !== undefined) {
      await setBeneficiaryTags(
        ctx,
        beneficiary.orgId,
        args.beneficiaryId,
        user._id,
        args.tags,
      );
    }

    const auditMetadata: Record<string, AuditValue | string[]> = {
      ...updates,
    } as Record<string, AuditValue | string[]>;
    if (args.tags !== undefined) {
      auditMetadata.tags = args.tags;
    }

    // Audit log
    await appendAudit(ctx, {
      orgId: beneficiary.orgId,
      actorUserId: user._id,
      action: "beneficiary.updated",
      objectType: "beneficiary",
      objectId: args.beneficiaryId,
      metadata: auditMetadata,
      timestamp: now,
    });

    return { success: true };
  },
});

// Get single beneficiary
export const get = query({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const beneficiary = await ctx.db.get(args.beneficiaryId);
    if (!beneficiary) {
      return null;
    }

    // Verify access
    await requireOrgAccess(ctx, beneficiary.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    return beneficiary;
  },
});

// Bulk create beneficiaries
export const createBulk = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    allowMissingPaymentDetails: v.optional(v.boolean()),
    beneficiaries: v.array(
      v.object({
        type: v.union(v.literal("individual"), v.literal("business")),
        name: v.string(),
        email: v.optional(v.string()),
        beneficiaryAddress: v.string(),
        notes: v.optional(v.string()),
        preferredToken: v.optional(v.string()),
        preferredChainId: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify access (admin, initiator, or clerk can create)
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin", "initiator", "clerk"],
    );

    if (args.beneficiaries.length === 0) {
      throw new Error("No beneficiaries provided");
    }

    // Check tier limits for beneficiaries
    const limits = await getOrgLimits(ctx, args.orgId);
    const existingBeneficiaries = await ctx.db
      .query("beneficiaries")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    const currentCount = existingBeneficiaries.length;
    const newCount = args.beneficiaries.length;
    const totalCount = currentCount + newCount;

    if (
      limits.maxBeneficiaries !== Infinity &&
      totalCount > limits.maxBeneficiaries
    ) {
      throw new Error(
        `Your plan allows a maximum of ${limits.maxBeneficiaries} beneficiaries. ` +
          `You currently have ${currentCount} and are trying to add ${newCount}. ` +
          `Please upgrade to add more.`,
      );
    }

    // Check for duplicates within the batch
    const batchAddresses = new Set<string>();
    for (const beneficiary of args.beneficiaries) {
      const lowerAddress = beneficiary.beneficiaryAddress.trim().toLowerCase();
      if (!lowerAddress) continue;
      if (batchAddresses.has(lowerAddress)) {
        throw new Error(
          `Duplicate wallet address in batch: ${beneficiary.beneficiaryAddress}`,
        );
      }
      batchAddresses.add(lowerAddress);
    }

    // Check for duplicates against existing beneficiaries
    const existingAddresses = new Set(
      existingBeneficiaries.map((b) => b.walletAddress.toLowerCase()),
    );
    for (const beneficiary of args.beneficiaries) {
      const lowerAddress = beneficiary.beneficiaryAddress.trim().toLowerCase();
      if (!lowerAddress) continue;
      if (existingAddresses.has(lowerAddress)) {
        throw new Error(
          `Wallet address already exists: ${beneficiary.beneficiaryAddress}`,
        );
      }
    }

    const emails = new Set(
      existingBeneficiaries.map((b) => b.email?.toLowerCase()).filter(Boolean),
    );
    for (const beneficiary of args.beneficiaries) {
      const email = beneficiary.email?.trim().toLowerCase();
      if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw new Error("Invalid recipient email");
        if (emails.has(email))
          throw new Error(`Recipient email already exists: ${email}`);
        emails.add(email);
      }
    }

    // Validate all beneficiaries before creating
    for (const beneficiary of args.beneficiaries) {
      validateSavedPayoutInstructions(beneficiary);
      if (!beneficiary.name || !beneficiary.name.trim()) {
        throw new Error("Beneficiary name is required");
      }
      if (
        !beneficiary.beneficiaryAddress ||
        !beneficiary.beneficiaryAddress.trim()
      ) {
        if (args.allowMissingPaymentDetails && beneficiary.email?.trim())
          continue;
        throw new Error("Wallet address is required");
      }
      const address = beneficiary.beneficiaryAddress.trim();
      // H-03: full hex validation (0x + 40 hex chars)
      assertValidAddress(address, "beneficiary wallet address");
    }

    // Create all beneficiaries
    const createdIds: Id<"beneficiaries">[] = [];
    for (const beneficiary of args.beneficiaries) {
      const beneficiaryId = await ctx.db.insert("beneficiaries", {
        orgId: args.orgId,
        type: beneficiary.type,
        name: beneficiary.name.trim(),
        email: beneficiary.email?.trim().toLowerCase() || undefined,
        walletAddress: beneficiary.beneficiaryAddress.toLowerCase().trim(),
        payoutVersion: 0,
        payoutReviewStatus: 'unreviewed',
        notes: beneficiary.notes?.trim() || undefined,
        preferredToken: beneficiary.preferredToken,
        preferredChainId: beneficiary.preferredChainId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      if (beneficiary.beneficiaryAddress.trim()) {
        const recipient = (await ctx.db.get(beneficiaryId))!;
        await requestPayoutReview(ctx, recipient, payoutDetails(recipient), user._id);
      }
      createdIds.push(beneficiaryId);

      // Audit log for each beneficiary
      await appendAudit(ctx, {
        orgId: args.orgId,
        actorUserId: user._id,
        action: "beneficiary.created",
        objectType: "beneficiary",
        objectId: beneficiaryId,
        metadata: {
          type: beneficiary.type,
          name: beneficiary.name.trim(),
          walletAddress: beneficiary.beneficiaryAddress.toLowerCase().trim(),
          bulkImport: true,
        },
        timestamp: now,
      });
    }

    // Schedule async SDN screening for all created beneficiaries
    for (const id of createdIds) {
      await ctx.scheduler.runAfter(0, internal.screening.screenBeneficiary, {
        beneficiaryId: id,
        orgId: args.orgId,
        sessionToken: args.sessionToken,
      });
    }

    return {
      success: true,
      count: createdIds.length,
      beneficiaryIds: createdIds,
    };
  },
});
import { validateSavedPayoutInstructions } from "../shared/payoutInstructions";
