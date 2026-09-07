import { ORG_READER_ROLES } from '../shared/roles';
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { hashSessionToken, requireOrgAccess, requireUser } from "./lib/rbac";
import { teamRoleValidator, teamSeats } from "./lib/teamSeats";
import { getOrgLimits } from "./billing";
import { appendAudit } from "./audit";
import { assertValidAddress } from "./lib/validation";
import { fingerprint } from "../shared/fingerprint";


export async function invitationAvailable(
  ctx: QueryCtx,
  invitation: Doc<"teamInvitations"> | null,
) {
  if (
    !invitation ||
    invitation.status !== "pending" ||
    invitation.expiresAt <= Date.now()
  )
    return false;
  const [org, author] = await Promise.all([
    ctx.db.get(invitation.orgId),
    ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", invitation.orgId).eq("userId", invitation.createdBy),
      )
      .unique(),
  ]);
  return !!org && author?.status === "active" && author.role === "admin";
}
async function findToken(ctx: QueryCtx, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = await hashSessionToken(token);
  return ctx.db
    .query("teamInvitations")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
    .unique();
}
export const authorize = internalQuery({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin"]);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Workspace not found.");
    return { name: org.name };
  },
});
export const register = internalMutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    requestId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    role: teamRoleValidator,
    expectedWallet: v.optional(v.string()),
    replaces: v.optional(v.id("teamInvitations")),
    tokenHash: v.string(),
    sealedPayload: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    const now = Date.now(),
      email = args.email.trim().toLowerCase(),
      name = args.name?.trim() || undefined;
    const expectedWallet =
      args.expectedWallet?.trim().toLowerCase() || undefined;
      if (expectedWallet) {
        assertValidAddress(expectedWallet, "sign-in wallet");
        if (/^0x0{40}$/i.test(expectedWallet)) throw new Error("Enter a nonzero sign-in wallet.");
      }
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      (name?.length ?? 0) > 200 ||
      !/^[a-zA-Z0-9_-]{16,80}$/.test(args.requestId)
    )
      throw new Error("Enter a valid name and work email.");
    if (
      !/^[a-f0-9]{64}$/.test(args.tokenHash) ||
      !args.sealedPayload.startsWith("v1:") ||
      args.sealedPayload.length > 30_000 ||
      args.expiresAt <= now ||
      args.expiresAt > now + 8 * 86400_000
    )
      throw new Error("Invalid invitation delivery details.");
    const requestHash = fingerprint({
      email,
      name,
      role: args.role,
      expectedWallet,
      replaces: args.replaces,
    });
    const existing = await ctx.db
      .query("teamInvitations")
      .withIndex("by_org_request", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new Error(
          "This invitation request changed. Start a new invitation.",
        );
      return { invitationId: existing._id };
    }
    const previous = args.replaces ? await ctx.db.get(args.replaces) : null;
    if (
      args.replaces &&
      (!previous ||
        previous.orgId !== args.orgId ||
        previous.email !== email ||
        previous.status === "accepted")
    )
      throw new Error("This invitation can no longer be replaced.");
    const recent = await ctx.db
      .query("teamInvitations")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(101);
    if (
      recent.filter((i) => i.createdAt > now - 3600_000).length >= 50 ||
      recent.filter((i) => i.email === email && i.createdAt > now - 3600_000)
        .length >= 5
    )
      throw new Error(
        "Invitation delivery limit reached. Try again in an hour.",
      );
    const { members, reserved } = await teamSeats(
      ctx,
      args.orgId,
      args.replaces,
    );
    if (
      members.some(
        (m) =>
          ["active", "invited"].includes(m.status) &&
          m.email?.trim().toLowerCase() === email,
      )
    )
      throw new Error(
        "This email already belongs to a team member or wallet invitation. Review that member first.",
      );
    if (reserved >= (await getOrgLimits(ctx, args.orgId)).maxUsers)
      throw new Error("No team seat is available on the current plan.");
    const sameEmail = await ctx.db
      .query("teamInvitations")
      .withIndex("by_org_email", (q) =>
        q.eq("orgId", args.orgId).eq("email", email),
      )
      .order("desc")
      .take(101);
    if (
      sameEmail.some(
        (i) =>
          i._id !== args.replaces &&
          i.status === "pending" &&
          i.expiresAt > now,
      )
    )
      throw new Error(
        "An invitation is already pending for this email. Use Resend in the invitation list.",
      );
    if (previous) {
      await ctx.db.patch(previous._id, { status: "revoked", revokedAt: now });
      if (previous.deliveryId)
        await ctx.db.patch(previous.deliveryId, {
          status: "cancelled",
          sealedPayload: undefined,
          nextAttemptAt: undefined,
          leaseUntil: undefined,
          updatedAt: now,
        });
    }
    const invitationId = await ctx.db.insert("teamInvitations", {
      orgId: args.orgId,
      email,
      name,
      role: args.role,
      expectedWallet,
      tokenHash: args.tokenHash,
      requestId: args.requestId,
      requestHash,
      createdBy: user._id,
      createdAt: now,
      expiresAt: args.expiresAt,
      status: "pending",
    });
    const deliveryId = await ctx.db.insert("emailDeliveries", {
      orgId: args.orgId,
      invitationId,
      context: `team-invite:${args.orgId}:${args.requestId}`,
      sealedPayload: args.sealedPayload,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
    });
    await ctx.db.patch(invitationId, { deliveryId });
    await ctx.scheduler.runAfter(0, internal.emailDelivery.deliver, {
      deliveryId,
    });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "team.invitationCreated",
      objectType: "teamInvitation",
      objectId: invitationId,
      metadata: {
        email,
        role: args.role,
        replaces: args.replaces,
        expectedWallet,
      },
      timestamp: now,
    });
    return { invitationId };
  },
});
export const list = query({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    const rows = await ctx.db
      .query("teamInvitations")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(100);
    return Promise.all(
      rows.map(async (row) => {
        const delivery = row.deliveryId
          ? await ctx.db.get(row.deliveryId)
          : null;
        return {
          id: row._id,
          name: row.name,
          email: row.email,
          role: row.role,
          expectedWallet: row.expectedWallet,
          status:
            row.status === "pending" && row.expiresAt <= Date.now()
              ? "expired"
              : row.status === "pending" && !await invitationAvailable(ctx, row) ? "unavailable" : row.status,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          acceptedAt: row.acceptedAt,
          deliveryStatus: delivery?.status ?? "unknown",
          deliveryError: delivery?.error,
        };
      }),
    );
  },
});
export const get = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invitation = await findToken(ctx, args.token);
    if (!invitation) return null;
    if (invitation.status === "accepted")
      return { status: "accepted" as const };
    if (!(await invitationAvailable(ctx, invitation))) return null;
    const org = await ctx.db.get(invitation.orgId);
    const [local, domain] = invitation.email.split("@");
    return {
      status: "pending" as const,
      organizationName: org!.name,
      role: invitation.role,
      maskedEmail: `${local.slice(0, 1)}…@${domain}`,
      expiresAt: invitation.expiresAt,
      expectedWallet: invitation.expectedWallet,
    };
  },
});
export const accept = mutation({
  args: {
    token: v.string(),
    sessionToken: v.string(),
    confirmWallet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    const invitation = await findToken(ctx, args.token);
    if (!invitation) throw new Error("This invitation is unavailable.");
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", invitation.orgId).eq("userId", user._id),
      )
      .unique();
    if (
      invitation.status === "accepted" &&
      invitation.acceptedBy === user._id &&
      membership?.status === "active"
    )
      return { orgId: invitation.orgId };
    if (!(await invitationAvailable(ctx, invitation)))
      throw new Error(
        "This invitation is unavailable. Ask an administrator for a new invitation.",
      );
    if (!args.confirmWallet)
      throw new Error("Confirm your sign-in wallet before joining.");
    if (
      invitation.expectedWallet &&
      invitation.expectedWallet !== user.walletAddress.toLowerCase()
    )
      throw new Error("Sign in with the wallet named in this invitation.");
    const { members, active } = await teamSeats(ctx, invitation.orgId);
    if (membership?.status === "active")
      throw new Error(
        "You already belong to this workspace. Ask an administrator to review your role.",
      );
    if (
      members.some(
        (m) =>
          m.userId !== user._id &&
          m.status === "active" &&
          m.email?.trim().toLowerCase() === invitation.email,
      )
    )
      throw new Error(
        "This email is already bound to another workspace member.",
      );
    if (active >= (await getOrgLimits(ctx, invitation.orgId)).maxUsers)
      throw new Error(
        "No team seat is available. Ask an administrator to review the plan.",
      );
    const now = Date.now(),
      fields = {
        name: invitation.name,
        email: invitation.email,
        emailVerifiedAt: now,
        emailVerificationInviteId: invitation._id,
        role: invitation.role,
        status: "active" as const,
        invitedBy: invitation.createdBy,
        invitedAt: invitation.createdAt,
        invitationExpiresAt: undefined,
      };
    const membershipId =
      membership?._id ??
      (await ctx.db.insert("orgMemberships", {
        orgId: invitation.orgId,
        userId: user._id,
        ...fields,
        createdAt: now,
      }));
    if (membership) await ctx.db.patch(membership._id, fields);
    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedBy: user._id,
      acceptedAt: now,
    });
    if (invitation.deliveryId)
      await ctx.db.patch(invitation.deliveryId, {
        sealedPayload: undefined,
        nextAttemptAt: undefined,
        leaseUntil: undefined,
      });
    await appendAudit(ctx, {
      orgId: invitation.orgId,
      actorUserId: user._id,
      action: "team.invitationAccepted",
      objectType: "orgMembership",
      objectId: membershipId,
      metadata: {
        invitationId: invitation._id,
        email: invitation.email,
        walletAddress: user.walletAddress,
        role: invitation.role,
      },
      timestamp: now,
    });
    return { orgId: invitation.orgId };
  },
});
export const revoke = mutation({
  args: {
    invitationId: v.id("teamInvitations"),
    orgId: v.id("orgs"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.orgId !== args.orgId)
      throw new Error("Invitation not found in this workspace.");
    if (invitation.status === "accepted")
      throw new Error(
        "This invitation was accepted. Manage the member's access instead.",
      );
    if (invitation.status === "revoked") return;
    await ctx.db.patch(invitation._id, {
      status: "revoked",
      revokedAt: Date.now(),
    });
    if (invitation.deliveryId)
      await ctx.db.patch(invitation.deliveryId, {
        status: "cancelled",
        sealedPayload: undefined,
        nextAttemptAt: undefined,
        leaseUntil: undefined,
        updatedAt: Date.now(),
      });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "team.invitationRevoked",
      objectType: "teamInvitation",
      objectId: invitation._id,
      timestamp: Date.now(),
    });
  },
});
