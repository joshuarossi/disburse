import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function assertAllowanceReservationsAvailable(
  ctx: Pick<QueryCtx, "db">,
  orgId: Id<"orgs">,
  keys: string[],
) {
  for (const key of keys) {
    const reservation = await ctx.db
      .query("delegationReservations")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    const original = reservation
      ? await ctx.db.get(reservation.disbursementId)
      : await ctx.db
          .query("disbursements")
          .withIndex("by_delegation_key", (q) => q.eq("delegationKey", key))
          .first();
    if (reservation || original) {
      throw new ConvexError({
        code: "ALLOWANCE_AUTHORIZATION_RESERVED",
        message:
          "Another payment already reserved this allowance authorization. Resume the original payment before preparing another allowance payment.",
        ...(original?.orgId === orgId ? { disbursementId: original._id } : {}),
      });
    }
  }
}
