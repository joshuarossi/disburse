import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { appendAudit } from "./audit";
import { ownerProposalValidator } from "./lib/ownerProposalValidator";
import {
  policyFeeValidator,
  policyIntentValidator,
} from "./lib/spendingPolicyValidators";
import { feeIdentity } from "../shared/executionFee";
import { relayConfiguration } from "./lib/relayConfiguration";
import { assertValidTxHash } from "./lib/validation";

export const policyIdentity = {
  policyChangeId: v.id("spendingPolicyChanges"),
  sessionToken: v.string(),
};
const readRoles = [
  "admin",
  "approver",
  "initiator",
  "clerk",
  "viewer",
] as const;
async function account(
  ctx: QueryCtx,
  safeId: Id<"safes">,
  sessionToken?: string,
  manage = false,
) {
  const safe = await ctx.db.get(safeId);
  if (!safe) throw new Error("Funding account not found");
  const access = sessionToken
    ? await requireOrgAccess(
        ctx,
        safe.orgId,
        sessionToken,
        manage ? ["admin"] : [...readRoles],
      )
    : undefined;
  return { safe, access };
}
async function grantAccess(
  ctx: QueryCtx,
  safeId: Id<"safes">,
  delegate: string,
  createdBy: Id<"users">,
) {
  const safe = (await ctx.db.get(safeId))!;
  if (!safe || safe.isActive === false)
    throw new Error("The funding account is no longer active");
  const creator = await ctx.db
    .query("orgMemberships")
    .withIndex("by_org_and_user", (q) =>
      q.eq("orgId", safe.orgId).eq("userId", createdBy),
    )
    .first();
  if (creator?.status !== "active" || creator.role !== "admin")
    throw new Error(
      "The administrator who requested this allowance no longer has permission",
    );
  const member = await ctx.db
    .query("users")
    .withIndex("by_wallet", (q) =>
      q.eq("walletAddress", delegate.toLowerCase()),
    )
    .first();
  const membership =
    member &&
    (await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", safe.orgId).eq("userId", member._id),
      )
      .first());
  if (
    membership?.status !== "active" ||
    !["admin", "approver", "initiator"].includes(membership.role)
  )
    throw new Error(
      "Choose an active team member with permission to make payments",
    );
}
export const creationContext = internalQuery({
  args: {
    safeId: v.id("safes"),
    sessionToken: v.string(),
    kind: v.union(v.literal("grant"), v.literal("revoke")),
    delegate: v.string(),
  },
  handler: async (ctx, args) => {
    const { safe, access } = await account(
      ctx,
      args.safeId,
      args.sessionToken,
      true,
    );
    if (args.kind === "grant")
      await grantAccess(ctx, safe._id, args.delegate, access!.user._id);
    const accountKey = `${safe.chainId}:${safe.safeAddress.toLowerCase()}`;
    const latest = await ctx.db
      .query("accountProposals")
      .withIndex("by_account_nonce", (q) => q.eq("accountKey", accountKey))
      .order("desc")
      .first();
    return {
      safe,
      actorWallet: access!.user.walletAddress,
      userId: access!.user._id,
      accountKey,
      latestNonce: latest?.nonce ?? -1,
    };
  },
});
export const fee = query({
  args: { safeId: v.id("safes"), sessionToken: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const { safe } = await account(ctx, args.safeId, args.sessionToken);
    try {
      return {
        fee: relayConfiguration(safe.chainId, args.token).fee,
        error: null,
      };
    } catch {
      return {
        fee: null,
        error: "Managed fees are unavailable for this account and currency.",
      };
    }
  },
});
export const list = query({
  args: { safeId: v.id("safes"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { access } = await account(ctx, args.safeId, args.sessionToken);
    const rows = await Promise.all(
      (["pending", "processing", "applied", "failed", "cancelled"] as const).map((status) =>
        ctx.db
          .query("spendingPolicyChanges")
          .withIndex("by_safe_status", (q) =>
            q.eq("safeId", args.safeId).eq("status", status),
          )
          .order("desc")
          .take(status === "pending" || status === "processing" ? 51 : 10),
      ),
    );
    return {
      proposals: rows
        .flat()
        .map(({ execution, ...p }) => ({
          ...p,
          execution: execution
            ? {
                attemptId: execution.attemptId,
                startedAt: execution.startedAt,
                walletRejectedAt: execution.walletRejectedAt,
                txHash: execution.txHash,
                phase: execution.phase,
              }
            : undefined,
        })),
      canApprove: ["admin", "approver"].includes(access!.membership.role),
    };
  },
});
export const context = internalQuery({
  args: {
    policyChangeId: v.id("spendingPolicyChanges"),
    sessionToken: v.optional(v.string()),
    write: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyChangeId);
    if (!policy) throw new Error("Policy request not found");
    const { safe, access } = await account(
      ctx,
      policy.safeId,
      args.sessionToken,
    );
    if (
      safe.orgId !== policy.orgId ||
      safe.chainId !== policy.chainId ||
      safe.safeAddress.toLowerCase() !== policy.safeAddress.toLowerCase()
    )
      throw new Error("The policy funding account changed");
    if (args.write) {
      if (policy.cancellationId) throw new Error("Complete or reconcile this policy cancellation");
      if (access && !["admin", "approver"].includes(access.membership.role))
        throw new Error("An account approver must authorize this change");
      if (policy.intent.kind === "grant")
        await grantAccess(
          ctx,
          safe._id,
          policy.intent.delegate,
          policy.createdBy,
        );
    }
    const saved = await ctx.db
      .query("accountProposals")
      .withIndex("by_policy", (q) => q.eq("policyChangeId", policy._id))
      .unique();
    if (!saved) throw new Error("The original policy approval is missing");
    const signatures = await ctx.db
      .query("accountSignatures")
      .withIndex("by_policy", (q) => q.eq("policyChangeId", policy._id))
      .take(501);
    const accounts = await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", policy.orgId))
      .collect();
    return {
      policy,
      saved,
      signatures,
      actorWallet: access?.user.walletAddress,
      accountNames: accounts
        .filter((a) => a.chainId === policy.chainId)
        .map((a) => ({
          address: a.safeAddress.toLowerCase(),
          name: a.name ?? "Company account",
        })),
    };
  },
});
export const create = internalMutation({
  args: {
    safeId: v.id("safes"),
    sessionToken: v.string(),
    requestId: v.string(),
    intent: policyIntentValidator,
    proposal: ownerProposalValidator,
    executionFee: v.optional(policyFeeValidator),
    latestNonce: v.number(),
  },
  handler: async (ctx, args) => {
    const { safe, access } = await account(
      ctx,
      args.safeId,
      args.sessionToken,
      true,
    );
    if (!/^[0-9a-f-]{36}$/i.test(args.requestId))
      throw new Error("Invalid policy request identifier");
    const original = await ctx.db
      .query("spendingPolicyChanges")
      .withIndex("by_request", (q) =>
        q.eq("orgId", safe.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (original) {
      if (
        original.safeId !== safe._id ||
        original.createdBy !== access!.user._id ||
        JSON.stringify(original.intent) !== JSON.stringify(args.intent) ||
        JSON.stringify(original.executionFee) !==
          JSON.stringify(args.executionFee)
      )
        throw new Error(
          "This request identifier already belongs to another policy change",
        );
      return original._id;
    }
    if (args.intent.kind === "grant")
      await grantAccess(ctx, safe._id, args.intent.delegate, access!.user._id);
    if (
      args.executionFee &&
      feeIdentity(
        relayConfiguration(safe.chainId, args.executionFee.token).fee,
      ) !== feeIdentity(args.executionFee)
    )
      throw new Error("The execution fee changed. Review the policy again.");
    if (
      args.proposal.safeAddress.toLowerCase() !== safe.safeAddress.toLowerCase()
    )
      throw new Error("Policy belongs to another funding account");
    const active = await Promise.all(
      (["pending", "processing"] as const).map((status) =>
        ctx.db
          .query("spendingPolicyChanges")
          .withIndex("by_safe_status", (q) =>
            q.eq("safeId", safe._id).eq("status", status),
          )
          .take(51),
      ),
    );
    if (active.flat().length >= 50)
      throw new Error("Complete pending policy changes before requesting more");
    const accountKey = `${safe.chainId}:${safe.safeAddress.toLowerCase()}`;
    const latest = await ctx.db
      .query("accountProposals")
      .withIndex("by_account_nonce", (q) => q.eq("accountKey", accountKey))
      .order("desc")
      .first();
    if (
      (latest?.nonce ?? -1) !== args.latestNonce ||
      args.proposal.safeTransactionData.nonce <= (latest?.nonce ?? -1)
    )
      throw new Error(
        "Another payment or policy reserved this account transaction number. Review again.",
      );
    const now = Date.now();
    const policyChangeId = await ctx.db.insert("spendingPolicyChanges", {
      orgId: safe.orgId,
      safeId: safe._id,
      chainId: safe.chainId,
      safeAddress: safe.safeAddress,
      createdBy: access!.user._id,
      requestId: args.requestId,
      intent: args.intent,
      executionFee: args.executionFee,
      safeTxHash: args.proposal.safeTxHash,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("accountProposals", {
      policyChangeId,
      accountKey,
      nonce: args.proposal.safeTransactionData.nonce,
      proposal: args.proposal,
      createdAt: now,
    });
    await appendAudit(ctx, {
      orgId: safe.orgId,
      actorUserId: access!.user._id,
      action: "spending_policy.requested",
      objectType: "spending_policy",
      objectId: policyChangeId,
      metadata: { safeTxHash: args.proposal.safeTxHash, ...args.intent },
    });
    return policyChangeId;
  },
});
export const saveSignature = internalMutation({
  args: {
    ...policyIdentity,
    safeTxHash: v.string(),
    path: v.array(v.string()),
    signature: v.string(),
    digest: v.string(),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.policyChangeId);
    if (!p || p.cancellationId || p.status !== "pending" || p.safeTxHash !== args.safeTxHash)
      throw new Error("This policy no longer accepts approvals");
    const { user } = await requireOrgAccess(ctx, p.orgId, args.sessionToken, [
      "admin",
      "approver",
    ]);
    if (p.intent.kind === "grant")
      await grantAccess(ctx, p.safeId, p.intent.delegate, p.createdBy);
    const owner = user.walletAddress.toLowerCase(),
      path = args.path.map((a) => a.toLowerCase()),
      pathKey = path.join(":");
    const existing = await ctx.db
      .query("accountSignatures")
      .withIndex("by_policy_signer", (q) =>
        q.eq("policyChangeId", p._id).eq("pathKey", pathKey).eq("owner", owner),
      )
      .unique();
    if (existing) {
      if (existing.digest !== args.digest)
        throw new Error("The original approval cannot be replaced");
      return;
    }
    if (
      (
        await ctx.db
          .query("accountSignatures")
          .withIndex("by_policy", (q) => q.eq("policyChangeId", p._id))
          .take(501)
      ).length >= 500
    )
      throw new Error("This policy has reached its approval evidence limit");
    await ctx.db.insert("accountSignatures", {
      policyChangeId: p._id,
      path,
      pathKey,
      owner,
      signature: args.signature,
      digest: args.digest,
      actorUserId: user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(p._id, { updatedAt: Date.now() });
    await appendAudit(ctx, {
      orgId: p.orgId,
      actorUserId: user._id,
      action: "spending_policy.approved",
      objectType: "spending_policy",
      objectId: p._id,
      metadata: { safeTxHash: p.safeTxHash, path, digest: args.digest },
    });
  },
});
export const reserve = internalMutation({
  args: {
    ...policyIdentity,
    safeTxHash: v.string(),
    to: v.string(),
    data: v.string(),
    searchFromBlock: v.string(),
    attemptId: v.string(),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.policyChangeId);
    if (p?.cancellationId) throw new Error("Complete or reconcile this policy cancellation");
    if (
      !p ||
      p.safeTxHash !== args.safeTxHash ||
      (p.status !== "pending" &&
        !(
          p.status === "processing" &&
          !p.executionFee &&
          p.execution?.walletRejectedAt &&
          !p.execution.txHash
        ))
    )
      throw new Error(
        "Check the original policy submission before trying again",
      );
    const { user } = await requireOrgAccess(ctx, p.orgId, args.sessionToken, [
      "admin",
      "approver",
    ]);
    if (p.intent.kind === "grant")
      await grantAccess(ctx, p.safeId, p.intent.delegate, p.createdBy);
    if (args.to.toLowerCase() !== p.safeAddress.toLowerCase())
      throw new Error("Policy belongs to another funding account");
    const searchFromBlock =
      p.execution &&
      BigInt(p.execution.searchFromBlock) < BigInt(args.searchFromBlock)
        ? p.execution.searchFromBlock
        : args.searchFromBlock;
    await appendAudit(ctx, {
      orgId: p.orgId,
      actorUserId: user._id,
      action: "spending_policy.execution_requested",
      objectType: "spending_policy",
      objectId: p._id,
      metadata: {
        safeTxHash: p.safeTxHash,
        attemptId: args.attemptId,
        previousAttemptId: p.execution?.attemptId,
      },
    });
    await ctx.db.patch(p._id, {
      status: "processing",
      execution: {
        attemptId: args.attemptId,
        actorUserId: user._id,
        startedAt: Date.now(),
        searchFromBlock,
        checks: 0,
        to: args.to,
        data: args.data,
        phase: p.executionFee ? "prepared" : "submitted",
      },
      recoveryAt: Date.now() + 60_000,
      error: undefined,
      updatedAt: Date.now(),
    });
    if (p.executionFee)
      await ctx.scheduler.runAfter(0, internal.spendingPolicyRelay.process, {
        policyChangeId: p._id,
      });
    return args.attemptId;
  },
});
export const recordBroadcast = mutation({
  args: { ...policyIdentity, attemptId: v.string(), txHash: v.string() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.policyChangeId);
    if (!p) throw new Error("Policy request not found");
    const { user } = await requireOrgAccess(ctx, p.orgId, args.sessionToken, [
      "admin",
      "approver",
    ]);
    assertValidTxHash(args.txHash);
    if (
      p.status !== "processing" ||
      p.executionFee ||
      p.execution?.attemptId !== args.attemptId ||
      p.execution.actorUserId !== user._id
    )
      throw new Error("This policy wallet attempt is no longer current");
    if (
      p.execution.txHash &&
      p.execution.txHash.toLowerCase() !== args.txHash.toLowerCase()
    )
      throw new Error("The original broadcast cannot be replaced");
    await ctx.db.patch(p._id, {
      execution: {
        ...p.execution,
        txHash: args.txHash,
        walletRejectedAt: undefined,
      },
      recoveryAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.spendingPolicyRecovery.reconcile, {
      policyChangeId: p._id,
    });
  },
});
export const walletRejected = mutation({
  args: { ...policyIdentity, attemptId: v.string() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.policyChangeId);
    if (!p) throw new Error("Policy request not found");
    const { user } = await requireOrgAccess(ctx, p.orgId, args.sessionToken, [
      "admin",
      "approver",
    ]);
    if (
      p.status !== "processing" ||
      p.executionFee ||
      p.execution?.attemptId !== args.attemptId ||
      p.execution.actorUserId !== user._id ||
      p.execution.txHash
    )
      throw new Error("This policy wallet attempt is no longer current");
    if (p.execution.walletRejectedAt) return;
    await ctx.db.patch(p._id, {
      execution: { ...p.execution, walletRejectedAt: Date.now() },
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: p.orgId,
      actorUserId: user._id,
      action: "spending_policy.wallet_declined",
      objectType: "spending_policy",
      objectId: p._id,
      metadata: { attemptId: args.attemptId, safeTxHash: p.safeTxHash },
    });
  },
});
export const beginRelay = internalMutation({
  args: {
    policyChangeId: v.id("spendingPolicyChanges"),
    attemptId: v.string(),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.policyChangeId);
    if (p?.cancellationId) throw new Error("Complete or reconcile this policy cancellation");
    if (
      !p ||
      p.status !== "processing" ||
      !p.executionFee ||
      p.execution?.phase !== "prepared" ||
      p.execution.attemptId !== args.attemptId
    )
      return false;
    if (p.intent.kind === "grant")
      await grantAccess(ctx, p.safeId, p.intent.delegate, p.createdBy);
    await ctx.db.patch(p._id, {
      execution: { ...p.execution, phase: "submitting" },
      updatedAt: Date.now(),
      recoveryAt: Date.now() + 60_000,
    });
    return true;
  },
});
export const checkpoint = internalMutation({
  args: {
    policyChangeId: v.id("spendingPolicyChanges"),
    attemptId: v.string(),
    providerId: v.optional(v.string()),
    txHash: v.optional(v.string()),
    searchFromBlock: v.optional(v.string()),
    error: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal("applied"), v.literal("failed"))),
    appliedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.policyChangeId);
    if (
      !p ||
      p.status !== "processing" ||
      p.execution?.attemptId !== args.attemptId
    )
      return;
    const e = p.execution;
    if (
      (e.txHash &&
        args.txHash &&
        e.txHash.toLowerCase() !== args.txHash.toLowerCase()) ||
      (e.providerId && args.providerId && e.providerId !== args.providerId)
    )
      throw new Error("The original submission cannot be replaced");
    if (args.txHash) assertValidTxHash(args.txHash);
    const checks = e.checks + 1;
    const searchFromBlock =
      args.searchFromBlock &&
      BigInt(args.searchFromBlock) > BigInt(e.searchFromBlock)
        ? args.searchFromBlock
        : e.searchFromBlock;
    await ctx.db.patch(p._id, {
      status: args.outcome ?? p.status,
      execution: {
        ...e,
        phase: e.phase === "prepared" ? "prepared" : "submitted",
        providerId: e.providerId ?? args.providerId,
        txHash: e.txHash ?? args.txHash,
        searchFromBlock,
        checks,
      },
      txHash: args.outcome ? (args.txHash ?? e.txHash) : p.txHash,
      appliedAt: args.outcome === "applied" ? args.appliedAt : undefined,
      error:
        args.error ??
        (checks >= 120 && !args.outcome
          ? "Confirmation needs investigation. Check the original policy submission before making another request."
          : undefined),
      recoveryAt:
        args.outcome || checks >= 120 ? undefined : Date.now() + 60_000,
      updatedAt: Date.now(),
    });
    if (args.outcome)
      await appendAudit(ctx, {
        orgId: p.orgId,
        actorUserId: e.actorUserId,
        action: `spending_policy.${args.outcome}`,
        objectType: "spending_policy",
        objectId: p._id,
        metadata: { safeTxHash: p.safeTxHash, txHash: args.txHash ?? e.txHash },
      });
  },
});
export const recheck = mutation({
  args: policyIdentity,
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.policyChangeId);
    if (!p) throw new Error("Policy request not found");
    await requireOrgAccess(ctx, p.orgId, args.sessionToken, [
      "admin",
      "approver",
    ]);
    if (p.status !== "processing" || !p.execution) return;
    await ctx.db.patch(p._id, {
      execution: { ...p.execution, checks: 0 },
      recoveryAt: Date.now(),
      error: undefined,
    });
    await ctx.scheduler.runAfter(
      0,
      p.executionFee
        ? internal.spendingPolicyRelay.process
        : internal.spendingPolicyRecovery.reconcile,
      { policyChangeId: p._id },
    );
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("spendingPolicyChanges")
      .withIndex("by_recovery", (q) =>
        q.gt("recoveryAt", 0).lte("recoveryAt", Date.now()),
      )
      .take(20);
    for (const p of due) {
      await ctx.db.patch(p._id, {
        recoveryAt: p.status === "processing" ? Date.now() + 60_000 : undefined,
      });
      if (p.status === "processing")
        await ctx.scheduler.runAfter(
          0,
          p.executionFee
            ? internal.spendingPolicyRelay.process
            : internal.spendingPolicyRecovery.reconcile,
          { policyChangeId: p._id },
        );
    }
  },
});
