import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { ownerProposalValidator } from "./lib/ownerProposalValidator";
import { policyFeeValidator } from "./lib/spendingPolicyValidators";
import { appendAudit } from "./audit";
import { assertValidTxHash } from "./lib/validation";
import { feeIdentity } from "../shared/executionFee";
import { relayConfiguration } from "./lib/relayConfiguration";
import {
  settlementBlockValidator,
  validateSettlementBlock,
} from "./lib/settlementBlock";

export const cancellationSourceArgs = {
  disbursementId: v.optional(v.id("disbursements")),
  policyChangeId: v.optional(v.id("spendingPolicyChanges")),
  sessionToken: v.string(),
};
export const cancellationIdentity = {
  cancellationId: v.id("accountCancellations"),
  sessionToken: v.string(),
};
type Source = {
  disbursementId?: Id<"disbursements">;
  policyChangeId?: Id<"spendingPolicyChanges">;
};
const readRoles = [
  "admin",
  "approver",
  "initiator",
  "clerk",
  "viewer",
] as const;
async function readOriginal(ctx: QueryCtx, args: Source) {
  if (Number(!!args.disbursementId) + Number(!!args.policyChangeId) !== 1)
    throw new Error("Choose one original account transaction");
  const target = args.disbursementId
    ? await ctx.db.get(args.disbursementId)
    : await ctx.db.get(args.policyChangeId!);
  if (!target) throw new Error("Original request not found");
  const original = args.disbursementId
    ? await ctx.db
        .query("accountProposals")
        .withIndex("by_payment", (q) =>
          q.eq("disbursementId", args.disbursementId),
        )
        .unique()
    : await ctx.db
        .query("accountProposals")
        .withIndex("by_policy", (q) =>
          q.eq("policyChangeId", args.policyChangeId),
        )
        .unique();
  const safe = await ctx.db.get(target.safeId);
  if (!safe || safe.orgId !== target.orgId || safe.chainId !== target.chainId)
    throw new Error("Original funding account is unavailable");
  if (
    original &&
    (original.proposal.safeTxHash !== target.safeTxHash ||
      original.accountKey !==
        `${safe.chainId}:${safe.safeAddress.toLowerCase()}`)
  )
    throw new Error("Original approval no longer matches its account");
  return { target, original, safe };
}
function canCancel(
  target: Doc<"disbursements"> | Doc<"spendingPolicyChanges">,
) {
  if (["executed", "applied"].includes(target.status))
    throw new Error("The original transaction already completed");
  if (
    ["relaying", "processing"].includes(target.status) ||
    ("allowanceExecution" in target && target.allowanceExecution)
  )
    throw new Error(
      "Check the original submission before requesting a cancellation",
    );
}
async function assertCurrent(ctx: QueryCtx, c: Doc<"accountCancellations">) {
  const original = await ctx.db.get(c.originalProposalId);
  if (!original) throw new Error("Original signed evidence is missing");
  const { target } = await readOriginal(ctx, original);
  canCancel(target);
  if (target.cancellationId !== c._id)
    throw new Error("This cancellation is no longer current");
}
export const source = internalQuery({
  args: cancellationSourceArgs,
  handler: async (ctx, args) => {
    const original = await readOriginal(ctx, args);
    const { user, membership } = await requireOrgAccess(
      ctx,
      original.safe.orgId,
      args.sessionToken,
      [...readRoles],
    );
    const existing = original.original
      ? await ctx.db
          .query("accountCancellations")
          .withIndex("by_original", (q) =>
            q.eq("originalProposalId", original.original!._id),
          )
          .order("desc")
          .first()
      : null;
    return {
      ...original,
      existing,
      user,
      canRequest: args.disbursementId
        ? ["admin", "approver", "initiator"].includes(membership.role)
        : ["admin", "approver"].includes(membership.role),
      canApprove: ["admin", "approver"].includes(membership.role),
    };
  },
});
export const get = query({
  args: cancellationSourceArgs,
  handler: async (ctx, args) => {
    const { target, original, safe } = await readOriginal(ctx, args);
    const { membership } = await requireOrgAccess(
      ctx,
      safe.orgId,
      args.sessionToken,
      [...readRoles],
    );
    const record = original
      ? await ctx.db
          .query("accountCancellations")
          .withIndex("by_original", (q) =>
            q.eq("originalProposalId", original._id),
          )
          .order("desc")
          .first()
      : null;
    return {
      cancellation: record
        ? {
            ...record,
            execution: record.execution
              ? {
                  attemptId: record.execution.attemptId,
                  phase: record.execution.phase,
                  walletRejectedAt: record.execution.walletRejectedAt,
                  txHash: record.execution.txHash,
                }
              : undefined,
          }
        : null,
      originalAvailable: !!original,
      canRequest: args.disbursementId
        ? ["admin", "approver", "initiator"].includes(membership.role)
        : ["admin", "approver"].includes(membership.role),
      canApprove: ["admin", "approver"].includes(membership.role),
      safeName: safe.name ?? "Company account",
      safeId: safe._id,
      chainId: safe.chainId,
      originalStatus: target.status,
    };
  },
});
export const context = internalQuery({
  args: {
    cancellationId: v.id("accountCancellations"),
    sessionToken: v.optional(v.string()),
    write: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const cancellation = await ctx.db.get(args.cancellationId);
    if (!cancellation) throw new Error("Cancellation not found");
    const access = args.sessionToken
      ? await requireOrgAccess(
          ctx,
          cancellation.orgId,
          args.sessionToken,
          args.write ? ["admin", "approver"] : [...readRoles],
        )
      : undefined;
    const originalProposal = await ctx.db.get(cancellation.originalProposalId);
    if (!originalProposal)
      throw new Error("Original signed evidence is missing");
    const { target, safe } = await readOriginal(ctx, {
      disbursementId: originalProposal.disbursementId,
      policyChangeId: originalProposal.policyChangeId,
    });
    if (
      safe.orgId !== cancellation.orgId ||
      safe.chainId !== cancellation.chainId ||
      safe.safeAddress.toLowerCase() !== cancellation.safeAddress.toLowerCase()
    )
      throw new Error("Cancellation belongs to another account");
    if (args.write) {
      canCancel(target);
      if (
        target.cancellationId !== cancellation._id ||
        ["applied", "failed"].includes(cancellation.status)
      )
        throw new Error("This cancellation is no longer current");
    }
    const saved = await ctx.db
      .query("accountProposals")
      .withIndex("by_cancellation", (q) =>
        q.eq("cancellationId", cancellation._id),
      )
      .unique();
    if (!saved) throw new Error("Cancellation approval is missing");
    const signatures = await ctx.db
      .query("accountSignatures")
      .withIndex("by_cancellation", (q) =>
        q.eq("cancellationId", cancellation._id),
      )
      .take(501);
    const accounts = await ctx.db
      .query("safes")
      .withIndex("by_org", (q) => q.eq("orgId", cancellation.orgId))
      .collect();
    return {
      cancellation,
      saved,
      signatures,
      originalProposal,
      target,
      actorWallet: access?.user.walletAddress,
      names: accounts
        .filter((a) => a.chainId === cancellation.chainId)
        .map((a) => ({
          address: a.safeAddress.toLowerCase(),
          name: a.name ?? "Company account",
        })),
    };
  },
});
export const create = internalMutation({
  args: {
    ...cancellationSourceArgs,
    originalProposalId: v.id("accountProposals"),
    proposal: ownerProposalValidator,
    executionFee: v.optional(policyFeeValidator),
    searchFromBlock: v.string(),
  },
  handler: async (ctx, args) => {
    const { original, target, safe } = await readOriginal(ctx, args);
    const { user } = await requireOrgAccess(
      ctx,
      safe.orgId,
      args.sessionToken,
      args.disbursementId
        ? ["admin", "approver", "initiator"]
        : ["admin", "approver"],
    );
    if (!original || original._id !== args.originalProposalId)
      throw new Error("The original approval changed");
    const existing = await ctx.db
      .query("accountCancellations")
      .withIndex("by_original", (q) => q.eq("originalProposalId", original._id))
      .order("desc")
      .first();
    if (existing && existing.status !== "failed") {
      if (
        (existing.executionFee ? feeIdentity(existing.executionFee) : "") !==
        (args.executionFee ? feeIdentity(args.executionFee) : "")
      )
        throw new Error(
          "Continue the cancellation with its original approved fee",
        );
      return existing._id;
    }
    canCancel(target);
    if (
      args.proposal.safeTransactionData.nonce !== original.nonce ||
      args.proposal.safeAddress.toLowerCase() !== safe.safeAddress.toLowerCase()
    )
      throw new Error(
        "Cancellation must use the original account and transaction number",
      );
    if (
      args.executionFee &&
      feeIdentity(
        relayConfiguration(safe.chainId, args.executionFee.token).fee,
      ) !== feeIdentity(args.executionFee)
    )
      throw new Error("The cancellation fee changed. Review again.");
    const now = Date.now();
    const cancellationId = await ctx.db.insert("accountCancellations", {
      originalProposalId: original._id,
      orgId: safe.orgId,
      safeId: safe._id,
      chainId: safe.chainId,
      safeAddress: safe.safeAddress,
      originalHash: original.proposal.safeTxHash,
      nonce: original.nonce,
      safeTxHash: args.proposal.safeTxHash,
      executionFee: args.executionFee,
      createdBy: user._id,
      status: "pending",
      checks: 0,
      recoveryAt: now + 60_000,
      searchFromBlock: args.searchFromBlock,
      createdAt: now,
      updatedAt: now,
    });
    // The cancellation deliberately conflicts with its original. Ordinary
    // payments/policies still cannot reuse this reserved account nonce.
    await ctx.db.insert("accountProposals", {
      cancellationId,
      accountKey: original.accountKey,
      nonce: original.nonce,
      proposal: args.proposal,
      createdAt: now,
    });
    if (args.disbursementId)
      await ctx.db.patch(args.disbursementId, {
        cancellationId,
        scheduledVersion:
          ((target as Doc<"disbursements">).scheduledVersion ?? 0) + 1,
        followupAt: now,
        updatedAt: now,
      });
    else
      await ctx.db.patch(args.policyChangeId!, {
        cancellationId,
        updatedAt: now,
      });
    await appendAudit(ctx, {
      orgId: safe.orgId,
      actorUserId: user._id,
      action: "account.cancellation_requested",
      objectType: "account_cancellation",
      objectId: cancellationId,
      metadata: {
        originalHash: original.proposal.safeTxHash,
        cancellationHash: args.proposal.safeTxHash,
        nonce: original.nonce,
      },
    });
    return cancellationId;
  },
});
export const sign = internalMutation({
  args: {
    ...cancellationIdentity,
    safeTxHash: v.string(),
    path: v.array(v.string()),
    signature: v.string(),
    digest: v.string(),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.cancellationId);
    if (!c || c.status !== "pending" || c.safeTxHash !== args.safeTxHash)
      throw new Error("This cancellation no longer accepts approvals");
    const { user } = await requireOrgAccess(ctx, c.orgId, args.sessionToken, [
      "admin",
      "approver",
    ]);
    await assertCurrent(ctx, c);
    const owner = user.walletAddress.toLowerCase(),
      path = args.path.map((p) => p.toLowerCase()),
      pathKey = path.join(":");
    const existing = await ctx.db
      .query("accountSignatures")
      .withIndex("by_cancellation_signer", (q) =>
        q.eq("cancellationId", c._id).eq("pathKey", pathKey).eq("owner", owner),
      )
      .unique();
    if (existing) {
      if (existing.digest !== args.digest)
        throw new Error("The original signature cannot be replaced");
      return;
    }
    if (
      (
        await ctx.db
          .query("accountSignatures")
          .withIndex("by_cancellation", (q) => q.eq("cancellationId", c._id))
          .take(501)
      ).length >= 500
    )
      throw new Error(
        "The cancellation has reached its approval evidence limit",
      );
    await ctx.db.insert("accountSignatures", {
      cancellationId: c._id,
      path,
      pathKey,
      owner,
      signature: args.signature,
      digest: args.digest,
      actorUserId: user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(c._id, { updatedAt: Date.now() });
    await appendAudit(ctx, {
      orgId: c.orgId,
      actorUserId: user._id,
      action: "account.cancellation_approved",
      objectType: "account_cancellation",
      objectId: c._id,
      metadata: { path, digest: args.digest },
    });
  },
});
export const reserve = internalMutation({
  args: {
    ...cancellationIdentity,
    safeTxHash: v.string(),
    to: v.string(),
    data: v.string(),
    attemptId: v.string(),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.cancellationId);
    if (
      !c ||
      c.safeTxHash !== args.safeTxHash ||
      (c.status !== "pending" &&
        !(
          c.status === "processing" &&
          !c.executionFee &&
          c.execution?.walletRejectedAt &&
          !c.execution.txHash
        ))
    )
      throw new Error(
        "Check the original cancellation submission before trying again",
      );
    const { user } = await requireOrgAccess(ctx, c.orgId, args.sessionToken, [
      "admin",
      "approver",
    ]);
    const original = await ctx.db.get(c.originalProposalId);
    const { target } = await readOriginal(ctx, {
      disbursementId: original?.disbursementId,
      policyChangeId: original?.policyChangeId,
    });
    canCancel(target);
    if (
      target.cancellationId !== c._id ||
      args.to.toLowerCase() !== c.safeAddress.toLowerCase()
    )
      throw new Error(
        "Cancellation no longer matches its original account transaction",
      );
    await ctx.db.patch(c._id, {
      status: "processing",
      checks: 0,
      execution: {
        attemptId: args.attemptId,
        actorUserId: user._id,
        startedAt: Date.now(),
        searchFromBlock: c.searchFromBlock,
        checks: 0,
        to: args.to,
        data: args.data,
        phase: c.executionFee ? "prepared" : "submitted",
      },
      recoveryAt: Date.now() + 60_000,
      error: undefined,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: c.orgId,
      actorUserId: user._id,
      action: "account.cancellation_execution",
      objectType: "account_cancellation",
      objectId: c._id,
      metadata: {
        attemptId: args.attemptId,
        previousAttemptId: c.execution?.attemptId,
        safeTxHash: c.safeTxHash,
      },
    });
    if (c.executionFee)
      await ctx.scheduler.runAfter(
        0,
        internal.accountCancellationRelay.process,
        { cancellationId: c._id },
      );
    return args.attemptId;
  },
});
export const walletResult = mutation({
  args: {
    ...cancellationIdentity,
    attemptId: v.string(),
    txHash: v.optional(v.string()),
    rejected: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.cancellationId);
    if (!c) throw new Error("Cancellation not found");
    const { user } = await requireOrgAccess(ctx, c.orgId, args.sessionToken, [
      "admin",
      "approver",
    ]);
    if (
      c.status !== "processing" ||
      c.executionFee ||
      c.execution?.attemptId !== args.attemptId ||
      c.execution.actorUserId !== user._id
    )
      throw new Error("This wallet attempt is no longer current");
    if (!!args.txHash === !!args.rejected)
      throw new Error("Report a broadcast or wallet rejection");
    if (args.txHash) assertValidTxHash(args.txHash);
    if (
      c.execution.txHash &&
      (args.rejected ||
        c.execution.txHash.toLowerCase() !== args.txHash?.toLowerCase())
    )
      throw new Error("The original broadcast cannot be replaced");
    await ctx.db.patch(c._id, {
      execution: {
        ...c.execution,
        txHash: args.txHash ?? c.execution.txHash,
        walletRejectedAt: args.rejected ? Date.now() : undefined,
      },
      recoveryAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (args.rejected)
      await appendAudit(ctx, {
        orgId: c.orgId,
        actorUserId: user._id,
        action: "account.cancellation_wallet_declined",
        objectType: "account_cancellation",
        objectId: c._id,
        metadata: { attemptId: args.attemptId },
      });
    await ctx.scheduler.runAfter(
      0,
      internal.accountCancellationRecovery.reconcile,
      { cancellationId: c._id },
    );
  },
});
export const begin = internalMutation({
  args: { cancellationId: v.id("accountCancellations"), attemptId: v.string() },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.cancellationId);
    if (
      !c ||
      c.status !== "processing" ||
      !c.executionFee ||
      c.execution?.attemptId !== args.attemptId ||
      c.execution.phase !== "prepared"
    )
      return false;
    await assertCurrent(ctx, c);
    const member = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", c.orgId).eq("userId", c.execution!.actorUserId),
      )
      .first();
    if (
      member?.status !== "active" ||
      !["admin", "approver"].includes(member.role)
    )
      throw new Error("The cancellation submitter no longer has permission");
    await ctx.db.patch(c._id, {
      execution: { ...c.execution, phase: "submitting" },
      recoveryAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const checkpoint = internalMutation({
  args: {
    cancellationId: v.id("accountCancellations"),
    attemptId: v.optional(v.string()),
    searchFromBlock: v.optional(v.string()),
    txHash: v.optional(v.string()),
    providerId: v.optional(v.string()),
    error: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal("applied"), v.literal("failed"))),
    appliedAt: v.optional(v.number()),
    settlement: v.optional(settlementBlockValidator),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.cancellationId);
    if (
      !c ||
      !["pending", "processing"].includes(c.status) ||
      (args.attemptId && c.execution?.attemptId !== args.attemptId)
    )
      return;
    if (args.outcome && !args.settlement)
      throw new Error("Cancellation settlement evidence is required");
    if (args.settlement) validateSettlementBlock(args.settlement);
    const e = c.execution;
    if (
      (e?.txHash &&
        args.txHash &&
        e.txHash.toLowerCase() !== args.txHash.toLowerCase()) ||
      (e?.providerId && args.providerId && e.providerId !== args.providerId)
    )
      throw new Error(
        "The original cancellation submission cannot be replaced",
      );
    if (args.txHash) assertValidTxHash(args.txHash);
    const searchFromBlock =
      args.searchFromBlock &&
      BigInt(args.searchFromBlock) > BigInt(c.searchFromBlock)
        ? args.searchFromBlock
        : c.searchFromBlock;
    const checks = (c.checks ?? 0) + 1;
    await ctx.db.patch(c._id, {
      status: args.outcome ?? c.status,
      checks,
      settlement: args.settlement ?? c.settlement,
      searchFromBlock,
      execution: e
        ? {
            ...e,
            txHash: e.txHash ?? args.txHash,
            providerId: e.providerId ?? args.providerId,
            phase: e.phase === "prepared" ? "prepared" : "submitted",
            searchFromBlock,
            checks,
          }
        : undefined,
      txHash: args.outcome ? args.txHash : c.txHash,
      appliedAt: args.outcome === "applied" ? args.appliedAt : undefined,
      error:
        args.error ??
        (checks >= 120 && !args.outcome
          ? "Automatic confirmation checks have paused. Check cancellation confirmation to continue checking the original transaction."
          : undefined),
      recoveryAt:
        args.outcome || checks >= 120
          ? undefined
          : Date.now() + (c.status === "processing" ? 60_000 : 300_000),
      updatedAt: Date.now(),
    });
    if (args.outcome === "applied") {
      const original = await ctx.db.get(c.originalProposalId);
      if (original?.disbursementId) {
        const p = await ctx.db.get(original.disbursementId);
        if (!p || p.safeTxHash !== c.originalHash || p.status === "executed")
          throw new Error(
            "The original payment settlement conflicts with this cancellation",
          );
        await ctx.db.patch(p._id, {
          status: "cancelled",
          cancellationConfirmedAt: args.appliedAt ?? Date.now(),
          scheduledVersion: (p.scheduledVersion ?? 0) + 1,
          nativeRecoveryAt: undefined,
          followupAt: Date.now(),
          updatedAt: Date.now(),
        });
      } else if (original?.policyChangeId) {
        const p = await ctx.db.get(original.policyChangeId);
        if (!p || p.safeTxHash !== c.originalHash || p.status === "applied")
          throw new Error(
            "The original policy settlement conflicts with this cancellation",
          );
        await ctx.db.patch(p._id, {
          status: "cancelled",
          cancellationConfirmedAt: args.appliedAt ?? Date.now(),
          recoveryAt: undefined,
          updatedAt: Date.now(),
        });
      }
    }
    if (args.outcome)
      await appendAudit(ctx, {
        orgId: c.orgId,
        actorUserId: e?.actorUserId ?? c.createdBy,
        action: `account.cancellation_${args.outcome}`,
        objectType: "account_cancellation",
        objectId: c._id,
        metadata: {
          originalHash: c.originalHash,
          cancellationHash: c.safeTxHash,
          txHash: args.txHash,
        },
      });
  },
});
export const recheck = mutation({
  args: cancellationIdentity,
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.cancellationId);
    if (!c) throw new Error("Cancellation not found");
    await requireOrgAccess(ctx, c.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
    ]);
    if (!["pending", "processing"].includes(c.status)) return;
    await ctx.db.patch(c._id, {
      checks: 0,
      execution: c.execution ? { ...c.execution, checks: 0 } : undefined,
      error: undefined,
      recoveryAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      c.executionFee && c.execution
        ? internal.accountCancellationRelay.process
        : internal.accountCancellationRecovery.reconcile,
      { cancellationId: c._id },
    );
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("accountCancellations")
      .withIndex("by_recovery", (q) =>
        q.gt("recoveryAt", 0).lte("recoveryAt", Date.now()),
      )
      .take(20);
    for (const c of due) {
      await ctx.db.patch(c._id, {
        recoveryAt: ["pending", "processing"].includes(c.status)
          ? Date.now() + 60_000
          : undefined,
      });
      if (["pending", "processing"].includes(c.status))
        await ctx.scheduler.runAfter(
          0,
          c.executionFee && c.execution
            ? internal.accountCancellationRelay.process
            : internal.accountCancellationRecovery.reconcile,
          { cancellationId: c._id },
        );
    }
  },
});

export const originalSettled = internalMutation({
  args: {
    cancellationId: v.id("accountCancellations"),
    txHash: v.string(),
    outcome: v.union(v.literal("success"), v.literal("failure")),
    settlement: settlementBlockValidator,
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.cancellationId);
    if (!c || c.status === "applied")
      throw new Error(
        "Original settlement conflicts with the confirmed cancellation",
      );
    if (c.status === "failed") return;
    assertValidTxHash(args.txHash);
    validateSettlementBlock(args.settlement);
    const original = await ctx.db.get(c.originalProposalId);
    const { target } = await readOriginal(ctx, original!);
    if (original?.disbursementId) {
      if (
        args.outcome === "success" &&
        (target.status !== "executed" ||
          target.txHash?.toLowerCase() !== args.txHash.toLowerCase())
      )
        throw new Error("Verify the original payment transfers first");
      if (args.outcome === "failure") {
        if (target.status === "executed")
          throw new Error("The original payment is already paid");
        await ctx.db.patch(original.disbursementId, {
          status: "failed",
          txHash: args.txHash,
          relayError:
            "The original account transaction failed on chain and used its transaction number.",
          nativeRecoveryAt: undefined,
          followupAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    } else if (original?.policyChangeId) {
      await ctx.db.patch(original.policyChangeId, {
        status: args.outcome === "success" ? "applied" : "failed",
        txHash: args.txHash,
        appliedAt:
          args.outcome === "success" ? args.settlement.timestamp : undefined,
        recoveryAt: undefined,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(c._id, {
      status: "failed",
      recoveryAt: undefined,
      error:
        args.outcome === "success"
          ? "The original transaction completed before this cancellation. Its receipt has been reconciled."
          : "The original transaction failed on chain and used this transaction number. No cancellation was applied.",
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: c.orgId,
      actorUserId: c.createdBy,
      action: "account.cancellation_superseded",
      objectType: "account_cancellation",
      objectId: c._id,
      metadata: {
        originalHash: c.originalHash,
        txHash: args.txHash,
        outcome: args.outcome,
        settlement: args.settlement,
      },
    });
  },
});
