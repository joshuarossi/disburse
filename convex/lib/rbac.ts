import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

import type { OrgRole as Role } from '../../shared/roles';

const SESSION_MIN_TOKEN_LENGTH = 32;

/**
 * SHA-256 hex digest of a session token. Only the digest is persisted;
 * the raw token is returned to the client exactly once at sign-in.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Resolve the caller's identity from an opaque session token.
 * Identity is NEVER taken from client-supplied wallet addresses.
 * Throws if the token is invalid, unknown, or expired.
 */
export async function requireUser(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string
) {
  if (
    typeof sessionToken !== "string" ||
    sessionToken.length < SESSION_MIN_TOKEN_LENGTH
  ) {
    throw new Error("Unauthorized: missing or malformed session token");
  }

  const tokenHash = await hashSessionToken(sessionToken);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .first();

  if (!session || !session.tokenHash) {
    throw new Error("Unauthorized: invalid session");
  }

  if (session.expiresAt < Date.now()) {
    // Read-only contexts cannot delete; expired sessions are simply rejected
    // here and garbage-collected by logout/generateNonce/validateSession flows.
    throw new Error("Session expired. Please sign in again.");
  }

  const user = await ctx.db.get(session.userId);
  if (!user) {
    throw new Error("Unauthorized: user not found");
  }

  return { user, session };
}

/**
 * Require that the authenticated user has access to an org with one of the
 * specified roles. Throws an error if access is denied.
 */
export async function requireOrgAccess(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  sessionToken: string,
  allowedRoles: readonly Role[]
) {
  const { user } = await requireUser(ctx, sessionToken);

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
