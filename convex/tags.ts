import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";
import { normalizeTagName } from "./lib/tags";

// List tags for an org (optionally filtered by search term)
export const list = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    await requireOrgAccess(ctx, args.orgId, walletAddress, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);

    let tags = await ctx.db
      .query("tags")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    const search = args.search?.trim();
    if (search) {
      const normalized = normalizeTagName(search);
      tags = tags.filter((tag) => tag.normalizedName.includes(normalized));
    }

    tags.sort((a, b) => a.name.localeCompare(b.name));

    return tags.map((tag) => ({
      _id: tag._id,
      name: tag.name,
      normalizedName: tag.normalizedName,
    }));
  },
});
