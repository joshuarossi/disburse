import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { hashSessionToken, requireOrgAccess } from "./lib/rbac";
import { appendAudit } from "./audit";
import { requestPayoutReview } from "./lib/recipientReview";
import { assertValidAddress } from "./lib/validation";
import { validateSavedPayoutInstructions } from "../shared/payoutInstructions";
import {
  importFingerprint,
  recipientFingerprint,
} from "../shared/recipientImport";
import { chainEnvironment } from "../shared/assets";
import {
  CHAIN_NAMES,
  CHAIN_TOKENS,
  type SupportedChainId,
} from "../shared/chains";

const writers = ["admin", "initiator", "clerk"] as const;
const readers = ["admin", "approver", "initiator", "clerk", "viewer"] as const;
const identity = {
  beneficiaryId: v.id("beneficiaries"),
  sessionToken: v.string(),
};
const duration = 7 * 86400_000;
type ReadCtx = Pick<QueryCtx, "db">;

async function availableChains(ctx: ReadCtx, orgId: Doc<"orgs">["_id"]) {
  const safes = await ctx.db
    .query("safes")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(101);
  if (safes.length > 100)
    throw new Error(
      "Contact your administrator to select the accounts available for payment detail requests.",
    );
  return [
    ...new Set(safes.filter((s) => s.isActive !== false).map((s) => s.chainId)),
  ];
}

async function lookup(ctx: ReadCtx, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await hashSessionToken(token);
  return ctx.db
    .query("recipientCollections")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
}

async function state(
  ctx: ReadCtx,
  request: Doc<"recipientCollections">,
  recipient: Doc<"beneficiaries"> | null,
) {
  if (request.status === "revoked") return "revoked" as const;
  if (!recipient?.isActive || recipient.orgId !== request.orgId)
    return "unavailable" as const;
  if (request.status === "submitted") {
    const change = request.changeId ? await ctx.db.get(request.changeId) : null;
    if (
      !change ||
      change.beneficiaryId !== recipient._id ||
      change.orgId !== request.orgId
    )
      return "unavailable" as const;
    return change.status === "pending" ? ("submitted" as const) : change.status;
  }
  if (Date.now() >= request.expiresAt) return "expired" as const;
  if (
    recipientFingerprint(recipient) !== request.recipientFingerprint ||
    recipient.detailRequestId !== request._id
  )
    return "changed" as const;
  const member = await ctx.db
    .query("orgMemberships")
    .withIndex("by_org_and_user", (q) =>
      q.eq("orgId", request.orgId).eq("userId", request.createdBy),
    )
    .first();
  if (
    !member ||
    member.status !== "active" ||
    !writers.some((role) => role === member.role)
  )
    return "unavailable" as const;
  return "requested" as const;
}

export const register = internalMutation({
  args: {
    ...identity,
    token: v.string(),
    environment: v.union(v.literal("production"), v.literal("test")),
  },
  handler: async (ctx, args) => {
    const recipient = await ctx.db.get(args.beneficiaryId);
    if (!recipient?.isActive) throw new Error("Use an active recipient.");
    const { user } = await requireOrgAccess(
      ctx,
      recipient.orgId,
      args.sessionToken,
      [...writers],
    );
    if (recipient.pendingPayoutChangeId)
      throw new Error(
        "Review or withdraw the pending payout details before requesting new details.",
      );
    if (!/^[a-f0-9]{64}$/.test(args.token))
      throw new Error("Invalid payment detail link.");
    const tokenHash = await hashSessionToken(args.token);
    if (
      await ctx.db
        .query("recipientCollections")
        .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
        .first()
    )
      throw new Error("Create another payment detail link.");
    const chainIds = (await availableChains(ctx, recipient.orgId)).filter(
      (id) => chainEnvironment(id) === args.environment,
    );
    if (!chainIds.length)
      throw new Error(
        `Add an active ${args.environment === "test" ? "test" : "business"} funding account before requesting payment details.`,
      );
    const recent = await ctx.db
      .query("recipientCollections")
      .withIndex("by_recipient", (q) => q.eq("beneficiaryId", recipient._id))
      .order("desc")
      .take(10);
    if (recent.length === 10 && recent[9].createdAt > Date.now() - 86400_000)
      throw new Error(
        "Ten links have been created for this recipient today. Try again tomorrow.",
      );
    if (recipient.detailRequestId) {
      const old = await ctx.db.get(recipient.detailRequestId);
      if (
        old?.orgId === recipient.orgId &&
        old.beneficiaryId === recipient._id &&
        old.status === "requested"
      )
        await ctx.db.patch(old._id, {
          status: "revoked",
          revokedAt: Date.now(),
        });
    }
    const expiresAt = Date.now() + duration;
    const requestId = await ctx.db.insert("recipientCollections", {
      orgId: recipient.orgId,
      beneficiaryId: recipient._id,
      tokenHash,
      createdBy: user._id,
      createdAt: Date.now(),
      expiresAt,
      chainIds,
      recipientFingerprint: recipientFingerprint(recipient),
      status: "requested",
    });
    // Collection metadata does not change the recipient's approved instructions or their version.
    await ctx.db.patch(recipient._id, {
      detailRequestId: requestId,
      detailRequestExpiresAt: expiresAt,
    });
    await appendAudit(ctx, {
      orgId: recipient.orgId,
      actorUserId: user._id,
      action: "beneficiary.details_requested",
      objectType: "beneficiary",
      objectId: recipient._id,
      metadata: { requestId, expiresAt, environment: args.environment },
    });
    return { expiresAt, requestId };
  },
});

export const history = query({
  args: identity,
  handler: async (ctx, args) => {
    const recipient = await ctx.db.get(args.beneficiaryId);
    if (!recipient) throw new Error("Recipient not found.");
    const { membership } = await requireOrgAccess(
      ctx,
      recipient.orgId,
      args.sessionToken,
      [...readers],
    );
    const requests = await ctx.db
      .query("recipientCollections")
      .withIndex("by_recipient", (q) => q.eq("beneficiaryId", recipient._id))
      .order("desc")
      .take(10);
    return {
      canCreate:
        recipient.isActive &&
        !recipient.pendingPayoutChangeId &&
        writers.some((role) => role === membership.role),
      canManage: writers.some((role) => role === membership.role),
      requests: await Promise.all(
        requests.map(async (r) => ({
          id: r._id,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          submittedAt: r.submittedAt,
          state: await state(ctx, r, recipient),
        })),
      ),
    };
  },
});

export const revoke = mutation({
  args: { requestId: v.id("recipientCollections"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Payment detail request not found.");
    const { user } = await requireOrgAccess(
      ctx,
      request.orgId,
      args.sessionToken,
      [...writers],
    );
    if (request.status === "revoked") return;
    if (request.status !== "requested")
      throw new Error(
        "These details have already been submitted. Review or withdraw them in the payout review.",
      );
    await ctx.db.patch(request._id, {
      status: "revoked",
      revokedAt: Date.now(),
    });
    const recipient = await ctx.db.get(request.beneficiaryId);
    if (
      recipient?.orgId === request.orgId &&
      recipient.detailRequestId === request._id
    )
      await ctx.db.patch(recipient._id, {
        detailRequestId: undefined,
        detailRequestExpiresAt: undefined,
      });
    await appendAudit(ctx, {
      orgId: request.orgId,
      actorUserId: user._id,
      action: "beneficiary.details_request_revoked",
      objectType: "beneficiary",
      objectId: request.beneficiaryId,
      metadata: { requestId: request._id },
    });
  },
});

export const publicRequest = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const request = await lookup(ctx, args.token);
    if (!request) return null;
    const recipient = await ctx.db.get(request.beneficiaryId);
    const status = await state(ctx, request, recipient);
    // Expired/replaced/revoked links reveal no recipient or organization details.
    if (
      !["requested", "submitted", "approved", "rejected", "withdrawn"].includes(
        status,
      )
    )
      return { state: status };
    const org = await ctx.db.get(request.orgId);
    if (!org || !recipient) return null;
    const activeChains = await availableChains(ctx, org._id);
    const options = request.chainIds
      .filter((id) => activeChains.includes(id))
      .map((id) => ({
        chainId: id,
        name: CHAIN_NAMES[id as SupportedChainId],
        tokens: Object.values(CHAIN_TOKENS[id as SupportedChainId] ?? {}).map(
          (t) => ({ symbol: t.symbol, address: t.address }),
        ),
      }));
    if (status === "requested" && !options.length)
      return { state: "unavailable" as const };
    return {
      state: status,
      issuer: org.name,
      recipientName: recipient.name,
      expiresAt: request.expiresAt,
      options,
    };
  },
});

export const submit = mutation({
  args: {
    token: v.string(),
    walletAddress: v.string(),
    preferredChainId: v.number(),
    preferredToken: v.string(),
    confirmed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const request = await lookup(ctx, args.token);
    if (!request)
      throw new Error(
        "This link is unavailable. Ask the business for a new link.",
      );
    const proposed = {
      walletAddress: args.walletAddress.trim().toLowerCase(),
      preferredToken: args.preferredToken.trim().toUpperCase(),
      preferredChainId: args.preferredChainId,
    };
    assertValidAddress(args.walletAddress.trim());
    if (/^0x0{40}$/i.test(proposed.walletAddress))
      throw new Error("Use a receiving address, not the zero address.");
    validateSavedPayoutInstructions(proposed);
    if (!proposed.preferredToken)
      throw new Error("Choose the currency you want to receive.");
    if (!args.confirmed)
      throw new Error(
        "Confirm that these details can receive the selected currency on this network.",
      );
    const submissionHash = importFingerprint(proposed);
    // An interrupted success may be retried, but can never replace the recorded payload.
    if (request.status === "submitted") {
      if (request.submissionHash === submissionHash) return { received: true };
      throw new Error(
        "Details were already submitted using this link. Ask the business for a new request to make a change.",
      );
    }
    const recipient = await ctx.db.get(request.beneficiaryId);
    if (!recipient || (await state(ctx, request, recipient)) !== "requested")
      throw new Error(
        "This link is no longer available. Ask the business for a new link.",
      );
    if (
      !request.chainIds.includes(proposed.preferredChainId) ||
      !(await availableChains(ctx, request.orgId)).includes(
        proposed.preferredChainId,
      )
    )
      throw new Error(
        "This network is no longer available for this request. Ask the business for a new link.",
      );
    const changeId = await requestPayoutReview(
      ctx,
      recipient,
      proposed,
      request.createdBy,
      request._id,
    );
    await ctx.db.patch(request._id, {
      status: "submitted",
      submittedAt: Date.now(),
      submissionHash,
      changeId,
    });
    await ctx.db.patch(recipient._id, {
      detailRequestId: undefined,
      detailRequestExpiresAt: undefined,
    });
    return { received: true };
  },
});
