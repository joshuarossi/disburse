import { v } from 'convex/values';
import { query, MutationCtx } from './_generated/server';
import { requireOrgAccess } from './lib/rbac';
import { Id } from './_generated/dataModel';

// ─── Append-only audit writer (M-06) ──────────────────────────────────────────
//
// All audit entries MUST be written through appendAudit(). It:
//   - normalizes new metadata to a flat primitive map (legacy structured events remain readable)
//     (arrays/objects are JSON.stringify-ed, undefined values dropped)
//   - stamps the server-side time when the caller doesn't provide one
//   - is the single choke point for future hardening (signing, export, etc.)

export type AuditValue = string | number | boolean | null;

interface AuditEntry {
  orgId: Id<'orgs'>;
  actorUserId: Id<'users'>;
  action: string;
  objectType: string;
  objectId: string;
  metadata?: Record<
    string,
    AuditValue | AuditValue[] | Record<string, AuditValue> | undefined
  >;
  timestamp?: number;
}

export async function appendAudit(
  ctx: MutationCtx,
  entry: AuditEntry,
): Promise<void> {
  let metadata: Record<string, AuditValue> | undefined;
  if (entry.metadata) {
    metadata = {};
    for (const [key, value] of Object.entries(entry.metadata)) {
      if (value === undefined) continue;
      if (value !== null && typeof value === 'object') {
        metadata[key] = JSON.stringify(value);
      } else {
        metadata[key] = value;
      }
    }
  }

  await ctx.db.insert('auditLog', {
    orgId: entry.orgId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId,
    metadata,
    timestamp: entry.timestamp ?? Date.now(),
  });
}

// List audit logs for an org
export const list = query({
  args: {
    orgId: v.id('orgs'),
    sessionToken: v.string(),
    limit: v.optional(v.number()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    userId: v.optional(v.id('users')),
    actionType: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Any member can view audit logs
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      'admin',
      'approver',
      'initiator',
      'clerk',
      'viewer',
    ]);

    const auditQuery = ctx.db
      .query('auditLog')
      .withIndex('by_org_timestamp', (q) => q.eq('orgId', args.orgId))
      .order('desc');

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
      filtered = filtered.filter((log) =>
        args.actionType!.includes(log.action),
      );
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
      }),
    );

    return enriched;
  },
});
