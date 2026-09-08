import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { PAYMENT_OPERATOR_ROLES } from "../../shared/roles";
export function validateAssignedBalance(args: {
  memberUserId?: string;
  initialFunding?: string;
  memberControlAcknowledged?: boolean;
}) {
  if (!args.memberUserId) {
    if (args.initialFunding !== undefined && args.initialFunding !== "0")
      throw new Error("Choose a member before assigning an execution balance.");
    return;
  }
  if (!args.memberControlAcknowledged)
    throw new Error(
      "Review and acknowledge the member's control of the assigned balance.",
    );
  if (
    !args.initialFunding ||
    !/^\d{1,9}$/.test(args.initialFunding) ||
    BigInt(args.initialFunding) < 3_000_000n ||
    BigInt(args.initialFunding) > 100_000_000n
  )
    throw new Error(
      "Assign between 3 and 100 USDC for the member's initial execution balance.",
    );
}
export async function accountSetupMember(
  ctx: Pick<QueryCtx, "db">,
  orgId: Id<"orgs">,
  userId?: Id<"users">,
) {
  if (!userId) return undefined;
  const member = await ctx.db
    .query("orgMemberships")
    .withIndex("by_org_and_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .unique();
  const user = await ctx.db.get(userId);
  if (
    !member ||
    member.status !== "active" ||
    !PAYMENT_OPERATOR_ROLES.includes(
      member.role as (typeof PAYMENT_OPERATOR_ROLES)[number],
    ) ||
    !user
  )
    throw new Error(
      "Choose an active team member with payment access for this account.",
    );
  return user.walletAddress.toLowerCase();
}
