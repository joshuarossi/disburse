"use node";
import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashSessionToken } from "./lib/rbac";
import { invitationConfig, escapeEmailHtml as escape, sealEmail, openEmail } from "./lib/email";
import { teamRoleValidator } from "./lib/teamSeats";
import { teamRoles } from "../shared/teamRoles";

export const create = action({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    requestId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    role: teamRoleValidator,
    expectedWallet: v.optional(v.string()),
    replaces: v.optional(v.id("teamInvitations")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ invitationId: Id<"teamInvitations">; url: string }> => {
    const org = await ctx.runQuery(internal.teamInvitations.authorize, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
    });
    const { origin } = invitationConfig(),
      token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 7 * 86400_000,
      url = `${origin}/invite#${token}`;
    const role = teamRoles[args.role];
    const text = `You have been invited to ${org.name} on Disburse as ${role[0]}.\n\n${role[1]}\n\nAccept the invitation: ${url}\n\nThis link expires in seven days. Sign in and confirm the wallet you will use. Workspace membership does not grant ownership of a funding account.\n\nIf you did not expect this invitation, ignore it. Do not share this private link.`;
    const sealedPayload = sealEmail(
      {
        from: 'Disburse',
        invitationUrl: url,
        to: [args.email.trim().toLowerCase()],
        subject: `Invitation to ${org.name.replace(/[\r\n]/g, " ").slice(0, 120)} on Disburse`,
        text,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:32px;color:#172033"><p>Disburse</p><h1>Join ${escape(org.name)}</h1><p>You have been invited as <strong>${escape(role[0])}</strong>.</p><p>${escape(role[1])}</p><p style="margin:32px 0"><a href="${escape(url)}" style="background:#345dd9;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">Review invitation</a></p><p>This private link expires in seven days. Sign in and confirm the wallet you will use.</p><p>Workspace membership does not grant ownership of a funding account.</p><p>If you did not expect this invitation, ignore it. Do not share this link.</p></div>`,
      },
      `team-invite:${args.orgId}:${args.requestId}`,
    );
    const { invitationId } = await ctx.runMutation(internal.teamInvitations.register, {
      ...args,
      tokenHash: await hashSessionToken(token),
      sealedPayload,
      expiresAt,
    });
    // A repeated request must return the original private link, never a newly
    // generated token whose hash was not saved by the idempotent mutation.
    const saved = await ctx.runQuery(internal.teamInvitations.forSharing, { invitationId, sessionToken: args.sessionToken });
    const original = openEmail(saved.sealedPayload, saved.context).invitationUrl;
    if (!original || !original.startsWith(`${origin}/invite#`)) throw new Error('The original invitation link is unavailable. Create a replacement from Invitations.');
    return { invitationId, url: original };
  },
});

export const get = action({
  args: { invitationId: v.id('teamInvitations'), sessionToken: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const saved = await ctx.runQuery(internal.teamInvitations.forSharing, args);
    const url = openEmail(saved.sealedPayload, saved.context).invitationUrl;
    if (!url || !url.startsWith(`${invitationConfig().origin}/invite#`)) throw new Error('This invitation needs a new private link. Create a replacement.');
    return { url };
  },
});
