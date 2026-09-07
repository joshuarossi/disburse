import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const teamRoleValidator = v.union(
  v.literal("admin"),
  v.literal("approver"),
  v.literal("initiator"),
  v.literal("clerk"),
  v.literal("viewer"),
);
export async function teamSeats(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  excluding?: Id<"teamInvitations">,
) {
  const members = await ctx.db
    .query("orgMemberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(1001);
  const invitations = await ctx.db
    .query("teamInvitations")
    .withIndex("by_org_status", (q) =>
      q.eq("orgId", orgId).eq("status", "pending"),
    )
    .take(1001);
  if (members.length > 1000 || invitations.length > 1000)
    throw new Error(
      "This workspace's team directory exceeds the supported size.",
    );
  const reserved =
    members.filter(
      (m) =>
        m.status === "active" ||
        (m.status === "invited" &&
          (m.invitationExpiresAt ?? Infinity) > Date.now()),
    ).length +
    invitations.filter((i) => i._id !== excluding && i.expiresAt > Date.now())
      .length;
  return {
    members,
    reserved,
    active: members.filter((m) => m.status === "active").length,
  };
}
