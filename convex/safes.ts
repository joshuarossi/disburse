import { appendAudit } from "./audit";
import { v } from "convex/values";
import {
  mutation,
  query,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifySafeOwnership } from "./lib/safeVerification";
import { assertValidAddress } from "./lib/validation";
import { requireOrgAccess } from "./lib/rbac";
import { recurringFundingId } from "./lib/fundingAccount";

const linkArgs = {
  orgId: v.id("orgs"),
  sessionToken: v.string(),
  safeAddress: v.string(),
  chainId: v.number(),
  name: v.optional(v.string()),
};

export const getLinkIdentity = internalQuery({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    return user.walletAddress;
  },
});

export const link = action({
  args: linkArgs,
  handler: async (ctx, args): Promise<{ safeId: Id<"safes"> }> => {
    const walletAddress = await ctx.runQuery(internal.safes.getLinkIdentity, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
    });
    const verified = await verifySafeOwnership(
      args.safeAddress,
      args.chainId,
      walletAddress,
    );
    return ctx.runMutation(internal.safes.storeVerified, {
      ...args,
      ...verified,
    });
  },
});

export const storeVerified = internalMutation({
  args: { ...linkArgs, owners: v.array(v.string()), threshold: v.number() },
  handler: async (ctx, args) => {
    assertValidAddress(args.safeAddress, "Safe address");
    if (
      args.name !== undefined &&
      (!args.name.trim() || args.name.trim().length > 80)
    )
      throw new Error("Use an account name between 1 and 80 characters");
    const safeAddressLower = args.safeAddress.toLowerCase();
    const now = Date.now();

    // Only admin can link safes
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );

    const existing = await ctx.db
      .query("safes")
      .withIndex("by_org_chain_address", (q) =>
        q.eq("orgId", args.orgId).eq("chainId", args.chainId).eq("safeAddress", safeAddressLower),
      )
      .first();

    if (existing && existing.isActive !== false) {
      throw new Error("This account is already linked for this chain");
    }

    const fields = {
      orgId: args.orgId,
      name: args.name?.trim() ?? existing?.name,
      chainId: args.chainId,
      safeAddress: safeAddressLower,
      isActive: true,
      owners: args.owners,
      threshold: args.threshold,
      verifiedAt: now,
    };
    // Reconnecting restores the original identity, history and grants.
    const safeId = existing ? existing._id : await ctx.db.insert("safes", { ...fields, createdAt: now });
    if (existing) await ctx.db.patch(existing._id, fields);

    // Audit log
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "safe.linked",
      objectType: "safe",
      objectId: safeId,
      metadata: { safeAddress: args.safeAddress, chainId: args.chainId, name: fields.name, reconnected: !!existing },
      timestamp: now,
    });

    return { safeId };
  },
});

export const rename = mutation({
  args: { safeId: v.id("safes"), sessionToken: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const safe = await ctx.db.get(args.safeId);
    if (!safe || safe.isActive === false)
      throw new Error("This account is no longer active");
    const { user } = await requireOrgAccess(
      ctx,
      safe.orgId,
      args.sessionToken,
      ["admin"],
    );
    const name = args.name.trim();
    if (!name || name.length > 80)
      throw new Error("Use an account name between 1 and 80 characters");
    await ctx.db.patch(safe._id, { name });
    await appendAudit(ctx, {
      orgId: safe.orgId,
      actorUserId: user._id,
      action: "safe.renamed",
      objectType: "safe",
      objectId: safe._id,
      metadata: { previousName: safe.name ?? null, name },
      timestamp: Date.now(),
    });
    return { name };
  },
});

// Get active funding accounts for the organization.
export const getForOrg = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    const accounts = await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return accounts.filter(account => args.includeArchived || account.isActive !== false);
  },
});

// Legacy single-account lookup refuses an ambiguous network.
export const getForOrgAndChain = query({
  args: {
    orgId: v.id("orgs"),
    chainId: v.number(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    const accounts = await ctx.db
      .query("safes")
      .withIndex("by_org_chain", (q) =>
        q.eq("orgId", args.orgId).eq("chainId", args.chainId),
      )
      .filter((q) => q.neq(q.field("isActive"), false))
      .take(2);
    if (accounts.length > 1) throw new Error("Choose a funding account. More than one account is connected on this network.");
    return accounts[0] ?? null;
  },
});

// Unlink a Safe from an org
export const unlink = mutation({
  args: {
    safeId: v.id("safes"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const safe = await ctx.db.get(args.safeId);
    if (!safe) {
      throw new Error("Safe not found");
    }

    // Only admin can unlink safes
    const { user } = await requireOrgAccess(
      ctx,
      safe.orgId,
      args.sessionToken,
      ["admin"],
    );

    const payments = await ctx.db
      .query("disbursements")
      .withIndex("by_safe", (q) => q.eq("safeId", safe._id))
      .collect();
    if (
      payments.some(
        (payment) =>
          payment.status !== "executed" && payment.status !== "cancelled",
      )
    ) {
      throw new Error(
        "Complete or cancel this account's outstanding payments before unlinking it",
      );
    }
    const recurring = await ctx.db
      .query("recurringPayments")
      .withIndex("by_org", (q) => q.eq("orgId", safe.orgId))
      .collect();
    for (const series of recurring) {
      if (series.status !== 'active' || series.chainId !== safe.chainId) continue;
      const fundingId = await recurringFundingId(ctx, series);
      if (!fundingId || fundingId === safe._id)
        throw new Error("Pause recurring payments using this account before unlinking it");
    }
    await ctx.db.patch(args.safeId, { isActive: false });

    // Audit log
    await appendAudit(ctx, {
      orgId: safe.orgId,
      actorUserId: user._id,
      action: "safe.unlinked",
      objectType: "safe",
      objectId: args.safeId,
      metadata: { safeAddress: safe.safeAddress },
      timestamp: now,
    });

    return { success: true };
  },
});
