import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

type Role = "admin" | "approver" | "initiator" | "clerk" | "viewer";

/**
 * Require that a user has access to an org with one of the specified roles.
 * Throws an error if access is denied.
 */
export async function requireOrgAccess(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  walletAddress: string,
  allowedRoles: Role[]
) {
  const normalizedWallet = walletAddress.toLowerCase();

  // Get user
  const user = await ctx.db
    .query("users")
    .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedWallet))
    .first();

  if (!user) {
    throw new Error("User not found");
  }

  // Get membership
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_org_and_user", (q) =>
      q.eq("orgId", orgId).eq("userId", user._id)
    )
    .first();

  if (!membership) {
    throw new Error("Not a member of this organization");
  }

  if (membership.status !== "active") {
    throw new Error("Membership is not active");
  }

  if (!allowedRoles.includes(membership.role)) {
    throw new Error(`Insufficient permissions. Required: ${allowedRoles.join(" or ")}`);
  }

  return { user, membership };
}

/**
 * Check if user has a specific role or higher.
 * Role hierarchy: admin > approver > initiator > clerk > viewer
 */
export function hasRoleOrHigher(userRole: Role, requiredRole: Role): boolean {
  const roleHierarchy: Role[] = ["viewer", "clerk", "initiator", "approver", "admin"];
  const userLevel = roleHierarchy.indexOf(userRole);
  const requiredLevel = roleHierarchy.indexOf(requiredRole);
  return userLevel >= requiredLevel;
}
