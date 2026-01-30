import { internalMutation } from "../_generated/server";

/**
 * One-time migration to backfill the `chainId` field for existing disbursements.
 * Sets chainId from the linked safe for each disbursement that doesn't have it.
 * Run via Convex dashboard or CLI:
 *   npx convex run migrations/backfillDisbursementChainId:run
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const disbursements = await ctx.db.query("disbursements").collect();
    let updated = 0;
    for (const d of disbursements) {
      if (d.chainId === undefined) {
        const safe = await ctx.db.get(d.safeId);
        if (safe) {
          await ctx.db.patch(d._id, { chainId: safe.chainId });
          updated++;
        }
      }
    }
    return { updated, total: disbursements.length };
  },
});
