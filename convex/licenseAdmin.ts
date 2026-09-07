import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./lib/rbac";
import {
  isLicenseOperator,
  requireLicenseOperator,
  resolveLicenseTier,
} from "./lib/licenseManagement";
import {
  billingAccess,
  LICENSE_TIERS,
  type LicenseGrant,
} from "../shared/billing";
import { appendAudit } from "./audit";

const command = {
  sessionToken: v.string(),
  requestId: v.string(),
  reason: v.string(),
};
function validateCommand(requestId: string, reason: string) {
  if (!/^[\w-]{16,100}$/.test(requestId))
    throw new Error("A valid request reference is required.");
  if (reason.trim().length < 5 || reason.trim().length > 1000)
    throw new Error("Give a reason between 5 and 1,000 characters.");
}
async function replay(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  requestId: string,
  fingerprint: string,
) {
  const event = await ctx.db
    .query("licenseEvents")
    .withIndex("by_request", (q) =>
      q.eq("actorUserId", actorUserId).eq("requestId", requestId),
    )
    .unique();
  if (event && event.fingerprint !== fingerprint)
    throw new Error(
      "This request reference was already used for another change.",
    );
  return event;
}

export const access = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => ({
    allowed: isLicenseOperator(
      (await requireUser(ctx, args.sessionToken)).user.walletAddress,
    ),
  }),
});
export const catalog = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireLicenseOperator(ctx, args.sessionToken);
    const custom = await ctx.db.query("licenseTiers").take(201);
    if (custom.length > 200)
      throw new Error("The tier catalog exceeds the supported size.");
    const program = await ctx.db
      .query("licensePrograms")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    return {
      tiers: [
        ...Object.values(LICENSE_TIERS),
        ...custom.map((t) => ({
          key: t._id,
          name: t.name,
          maxUsers: t.maxUsers,
          maxBeneficiaries: t.maxBeneficiaries,
        })),
      ],
      program: program ?? {
        trialDays: 30,
        trialTier: LICENSE_TIERS.trial,
        fallbackTier: LICENSE_TIERS.free,
        revision: 0,
      },
    };
  },
});
export const companies = query({
  args: {
    sessionToken: v.string(),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireLicenseOperator(ctx, args.sessionToken);
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 50 ||
      (args.search?.length ?? 0) > 100
    )
      throw new Error("Use a shorter search or a page of 1 to 50 companies.");
    const search = args.search?.trim();
    const page = search
      ? await ctx.db
          .query("orgs")
          .withSearchIndex("search_name", (q) => q.search("name", search))
          .paginate(args.paginationOpts)
      : await ctx.db.query("orgs").order("desc").paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((org) => ({
        id: org._id,
        name: org.name,
        createdAt: org.createdAt,
      })),
    };
  },
});
export const company = query({
  args: { sessionToken: v.string(), orgId: v.id("orgs") },
  handler: async (ctx, args) => {
    await requireLicenseOperator(ctx, args.sessionToken);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Company not found.");
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .unique();
    if (!billing) throw new Error("Company has no billing record.");
    return {
      org: { id: org._id, name: org.name },
      billing,
      access: billingAccess(billing),
      changes: await ctx.db
        .query("licenseEvents")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .order("desc")
        .take(20),
    };
  },
});

export const createTier = mutation({
  args: {
    ...command,
    name: v.string(),
    maxUsers: v.union(v.number(), v.null()),
    maxBeneficiaries: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const user = await requireLicenseOperator(ctx, args.sessionToken);
    validateCommand(args.requestId, args.reason);
    const { sessionToken: _session, ...input } = args;
    void _session;
    const fingerprint = JSON.stringify({ action: "tier.created", ...input });
    const previous = await replay(ctx, user._id, args.requestId, fingerprint);
    if (previous) return previous.result;
    const name = args.name.trim();
    if (!name || name.length > 60)
      throw new Error("Enter a tier name of at most 60 characters.");
    for (const count of [args.maxUsers, args.maxBeneficiaries])
      if (
        count !== null &&
        (!Number.isSafeInteger(count) || count < 1 || count > 100_000)
      )
        throw new Error("Limits must be positive whole numbers, or unlimited.");
    const catalog = await ctx.db.query("licenseTiers").take(201);
    if (catalog.length >= 200) throw new Error("The tier catalog is full.");
    if (
      [...Object.values(LICENSE_TIERS), ...catalog].some(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error("That tier name already exists.");
    const now = Date.now(),
      id = await ctx.db.insert("licenseTiers", {
        name,
        maxUsers: args.maxUsers,
        maxBeneficiaries: args.maxBeneficiaries,
        createdBy: user._id,
        createdAt: now,
      });
    await ctx.db.insert("licenseEvents", {
      actorUserId: user._id,
      requestId: args.requestId,
      fingerprint,
      action: "tier.created",
      reason: args.reason.trim(),
      before: "null",
      after: JSON.stringify({
        key: id,
        name,
        maxUsers: args.maxUsers,
        maxBeneficiaries: args.maxBeneficiaries,
      }),
      result: id,
      createdAt: now,
    });
    return String(id);
  },
});

export const changeCompany = mutation({
  args: {
    ...command,
    orgId: v.id("orgs"),
    expectedRevision: v.number(),
    mode: v.union(
      v.literal("trial"),
      v.literal("complimentary"),
      v.literal("standard"),
    ),
    tierKey: v.string(),
    expiresAt: v.optional(v.number()),
    fallbackTierKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireLicenseOperator(ctx, args.sessionToken);
    validateCommand(args.requestId, args.reason);
    const { sessionToken: _session, ...input } = args;
    void _session;
    const fingerprint = JSON.stringify({ action: "company.changed", ...input });
    const previous = await replay(ctx, user._id, args.requestId, fingerprint);
    if (previous) return Number(previous.result);
    if (!(await ctx.db.get(args.orgId))) throw new Error("Company not found.");
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
    if (!billing || (billing.licenseRevision ?? 0) !== args.expectedRevision)
      throw new Error(
        "Company access changed. Reload and review the current license.",
      );
    const checkout = await ctx.db
      .query("billingCheckouts")
      .withIndex("by_org_active", (q) =>
        q.eq("orgId", args.orgId).eq("active", true),
      )
      .unique();
    if (checkout)
      throw new Error(
        "Resolve the company's saved checkout before changing its license.",
      );
    const now = Date.now();
    if (args.mode === "trial" && args.expiresAt === undefined)
      throw new Error("A trial needs an end date.");
    if (
      args.expiresAt !== undefined &&
      (!Number.isSafeInteger(args.expiresAt) ||
        args.expiresAt < now - 86_400_000 ||
        args.expiresAt > now + 3650 * 86_400_000)
    )
      throw new Error(
        "Choose an end date between yesterday and ten years from now.",
      );
    const tier =
      args.mode === "standard"
        ? undefined
        : await resolveLicenseTier(ctx, args.tierKey);
    const fallbackTier = await resolveLicenseTier(ctx, args.fallbackTierKey);
    const licenseGrant: LicenseGrant | undefined = tier
      ? {
          kind: args.mode as "trial" | "complimentary",
          tier,
          expiresAt: args.expiresAt,
          grantedAt: now,
        }
      : undefined;
    const revision = (billing.licenseRevision ?? 0) + 1;
    const patch = {
      licenseGrant,
      fallbackTier,
      licenseRevision: revision,
      updatedAt: now,
      ...(args.mode === "trial" ? { trialEndsAt: args.expiresAt } : {}),
    };
    await ctx.db.patch(billing._id, patch);
    await ctx.db.insert("licenseEvents", {
      orgId: args.orgId,
      actorUserId: user._id,
      requestId: args.requestId,
      fingerprint,
      action: "company.changed",
      reason: args.reason.trim(),
      before: JSON.stringify({
        licenseGrant: billing.licenseGrant,
        fallbackTier: billing.fallbackTier,
        trialEndsAt: billing.trialEndsAt,
      }),
      after: JSON.stringify(patch),
      result: String(revision),
      createdAt: now,
    });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "billing.license_changed",
      objectType: "billing",
      objectId: billing._id,
      metadata: {
        mode: args.mode,
        tier: tier?.name,
        expiresAt: args.expiresAt,
        fallbackTier: fallbackTier?.name,
        licenseRevision: revision,
      },
      timestamp: now,
    });
    return revision;
  },
});

export const setProgram = mutation({
  args: {
    ...command,
    expectedRevision: v.number(),
    trialDays: v.number(),
    trialTierKey: v.string(),
    fallbackTierKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireLicenseOperator(ctx, args.sessionToken);
    validateCommand(args.requestId, args.reason);
    const { sessionToken: _session, ...input } = args;
    void _session;
    const fingerprint = JSON.stringify({ action: "program.changed", ...input });
    const previous = await replay(ctx, user._id, args.requestId, fingerprint);
    if (previous) return Number(previous.result);
    if (
      !Number.isSafeInteger(args.trialDays) ||
      args.trialDays < 0 ||
      args.trialDays > 3650
    )
      throw new Error("Trial length must be from 0 to 3,650 days.");
    const program = await ctx.db
      .query("licensePrograms")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if ((program?.revision ?? 0) !== args.expectedRevision)
      throw new Error("The signup program changed. Reload before saving.");
    const trialTier = await resolveLicenseTier(ctx, args.trialTierKey),
      fallbackTier = await resolveLicenseTier(ctx, args.fallbackTierKey);
    const now = Date.now(),
      revision = (program?.revision ?? 0) + 1;
    const record = {
      key: "default" as const,
      trialDays: args.trialDays,
      trialTier,
      fallbackTier,
      revision,
      updatedBy: user._id,
      updatedAt: now,
    };
    if (program) await ctx.db.patch(program._id, record);
    else await ctx.db.insert("licensePrograms", record);
    await ctx.db.insert("licenseEvents", {
      actorUserId: user._id,
      requestId: args.requestId,
      fingerprint,
      action: "program.changed",
      reason: args.reason.trim(),
      before: JSON.stringify(program),
      after: JSON.stringify(record),
      result: String(revision),
      createdAt: now,
    });
    return revision;
  },
});
