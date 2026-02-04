import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgAccess } from "./lib/rbac";

// List audit logs for an org
export const list = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    limit: v.optional(v.number()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    userId: v.optional(v.id("users")),
    actionType: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Any member can view audit logs
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    const auditQuery = ctx.db
      .query("auditLog")
      .withIndex("by_org_timestamp", (q) => q.eq("orgId", args.orgId))
      .order("desc");

    const logs = await auditQuery.collect();

    // Apply filters
    let filtered = logs;

    // Date range filter
    if (args.startDate) {
      filtered = filtered.filter((log) => log.timestamp >= args.startDate!);
    }
    if (args.endDate) {
      // Add one day to include the end date fully
      const endOfDay = args.endDate + 24 * 60 * 60 * 1000;
      filtered = filtered.filter((log) => log.timestamp <= endOfDay);
    }

    // User filter
    if (args.userId) {
      filtered = filtered.filter((log) => log.actorUserId === args.userId);
    }

    // Action type filter
    if (args.actionType && args.actionType.length > 0) {
      filtered = filtered.filter((log) => args.actionType!.includes(log.action));
    }

    // Apply limit
    const limited = args.limit ? filtered.slice(0, args.limit) : filtered;

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
