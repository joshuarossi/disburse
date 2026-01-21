import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";

// List audit logs for an org
export const list = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Any member can view audit logs
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    let query = ctx.db
      .query("auditLog")
      .withIndex("by_org_timestamp", (q) => q.eq("orgId", args.orgId))
      .order("desc");

    const logs = await query.collect();

    // Apply limit
    const limited = args.limit ? logs.slice(0, args.limit) : logs;

    // Enrich with user info
    const enriched = await Promise.all(
      limited.map(async (log) => {
        const user = await ctx.db.get(log.actorUserId);
        return {
          ...log,
          actor: user ? { walletAddress: user.walletAddress } : null,
        };
      })
    );

    return enriched;
  },
});
