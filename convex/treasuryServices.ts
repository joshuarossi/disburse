import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { keccak256, toHex } from "viem";
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
import { readTreasuryService } from "./lib/treasuryService";
import { ORG_READER_ROLES, TREASURY_OPERATOR_ROLES } from "../shared/roles";
import {
  decodeLendingQuote,
  lendingMarket,
  lendingQuoteHash,
} from "../shared/lending";
import { chainEnvironment } from "../shared/assets";
import { appendAudit } from "./audit";

export const servicePreparationArgs = {
  orgId: v.id("orgs"),
  safeId: v.id("safes"),
  kind: v.union(v.literal("supply"), v.literal("withdraw")),
  amount: v.string(),
  requestId: v.string(),
  sessionToken: v.string(),
  withdrawAll: v.optional(v.boolean()),
};
const identity = {
  treasuryServiceId: v.id("treasuryServices"),
  sessionToken: v.string(),
};

async function preparationData(
  ctx: QueryCtx,
  args: {
    orgId: Id<"orgs">;
    safeId: Id<"safes">;
    kind: "supply" | "withdraw";
    amount: string;
    requestId: string;
    sessionToken: string;
    withdrawAll?: boolean;
  },
) {
  const { user } = await requireOrgAccess(
    ctx,
    args.orgId,
    args.sessionToken,
    TREASURY_OPERATOR_ROLES,
  );
  if (
    !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId) ||
    !/^[1-9]\d{0,13}$/.test(args.amount) ||
    BigInt(args.amount) > 10_000_000_000_000n
  )
    throw new Error("Enter a positive amount and a valid treasury request.");
  const existing = await ctx.db
    .query("treasuryServices")
    .withIndex("by_request", (q) =>
      q.eq("orgId", args.orgId).eq("requestId", args.requestId),
    )
    .unique();
  if (
    args.withdrawAll !== undefined &&
    (args.withdrawAll !== true || args.kind !== "withdraw")
  )
    throw new Error("Choose a full withdrawal or enter a fixed amount.");
  if (
    existing &&
    (existing.safeId !== args.safeId ||
      existing.kind !== args.kind ||
      (!args.withdrawAll &&
        decodeLendingQuote(existing.quote).amount !== args.amount) ||
      !!decodeLendingQuote(existing.quote).withdrawAll !== !!args.withdrawAll)
  )
    throw new Error(
      "This request already has different instructions. Resume its saved review.",
    );
  const safe = await ctx.db.get(args.safeId);
  if (!safe || safe.orgId !== args.orgId || safe.isActive === false)
    throw new Error("Choose an active company account in this workspace.");
  lendingMarket(safe.chainId);
  if (
    !existing &&
    (await ctx.db
      .query("treasuryServices")
      .withIndex("by_safe_open", (q) =>
        q.eq("safeId", safe._id).eq("open", true),
      )
      .first())
  )
    throw new Error(
      "This account already has a treasury request. Complete or stop it before reviewing another.",
    );
  return { user, safe, existing };
}
export const preparation = internalQuery({
  args: servicePreparationArgs,
  handler: preparationData,
});
export const account = internalQuery({
  args: { safeId: v.id("safes"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const safe = await ctx.db.get(args.safeId);
    if (!safe) throw new Error("Company account not found.");
    await requireOrgAccess(
      ctx,
      safe.orgId,
      args.sessionToken,
      ORG_READER_ROLES,
    );
    return safe;
  },
});
export const list = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    environment: v.union(v.literal("production"), v.literal("test")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ORG_READER_ROLES,
    );
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Load up to 100 treasury requests at a time.");
    return ctx.db
      .query("treasuryServices")
      .withIndex("by_org_environment", (q) =>
        q.eq("orgId", args.orgId).eq("environment", args.environment),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
export const get = query({
  args: identity,
  handler: async (ctx, args) =>
    (await readTreasuryService(ctx, args.treasuryServiceId, args.sessionToken))
      .transfer,
});
export const context = internalQuery({
  args: identity,
  handler: async (ctx, args) =>
    readTreasuryService(ctx, args.treasuryServiceId, args.sessionToken, true),
});
export const save = internalMutation({
  args: { ...servicePreparationArgs, quote: v.string() },
  handler: async (ctx, args) => {
    const { user, safe, existing } = await preparationData(ctx, args);
    if (existing) return existing._id;
    const quote = decodeLendingQuote(args.quote);
    if (
      quote.chainId !== safe.chainId ||
      quote.account.toLowerCase() !== safe.safeAddress.toLowerCase() ||
      (!args.withdrawAll && quote.amount !== args.amount) ||
      quote.kind !== args.kind ||
      !!quote.withdrawAll !== !!args.withdrawAll ||
      quote.reference !== keccak256(toHex(`${args.orgId}:${args.requestId}`)) ||
      quote.expiresAt <= Date.now() ||
      quote.createdAt > Date.now() + 5000
    )
      throw new Error(
        "The lending review or company account changed. Review the amount again.",
      );
    const id = await ctx.db.insert("treasuryServices", {
      orgId: args.orgId,
      safeId: safe._id,
      chainId: safe.chainId,
      environment: chainEnvironment(safe.chainId) as "production" | "test",
      provider: quote.provider,
      kind: quote.kind,
      createdBy: user._id,
      requestId: args.requestId,
      quote: args.quote,
      hash: lendingQuoteHash(quote),
      status: "quoted",
      open: true,
      recoveryAt: quote.expiresAt + 5000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "treasury_service.quoted",
      objectType: "treasury_service",
      objectId: id,
      metadata: {
        provider: quote.provider,
        kind: quote.kind,
        amount: quote.amount,
        account: safe._id,
      },
    });
    return id;
  },
});
export const stop = mutation({
  args: identity,
  handler: async (ctx, args) => {
    const { transfer, user } = await readTreasuryService(
      ctx,
      args.treasuryServiceId,
      args.sessionToken,
    );
    await requireOrgAccess(
      ctx,
      transfer.orgId,
      args.sessionToken,
      TREASURY_OPERATOR_ROLES,
    );
    if (
      transfer.sourceTxHash ||
      ["processing", "completed"].includes(transfer.status)
    )
      throw new Error(
        "This request may already be submitted. Check its original receipt before taking another action.",
      );
    if (!transfer.open)
      return {
        cancelled: transfer.status === "cancelled",
        executionId: undefined,
      };
    const execution = transfer.circleExecutionId
      ? await ctx.db.get(transfer.circleExecutionId)
      : null;
    const signed = execution
      ? await ctx.db
          .query("circleSignatures")
          .withIndex("by_execution_stage", (q) =>
            q.eq("executionId", execution._id).eq("stage", "operation"),
          )
          .first()
      : null;
    if (
      execution &&
      (execution.operationApprovalStartedAt ||
        signed ||
        ["ready", "submitting", "confirmed"].includes(execution.stage))
    ) {
      if (
        !execution.open ||
        ["submitting", "confirmed"].includes(execution.stage)
      )
        throw new Error(
          "Check the original submission before cancelling its approval.",
        );
      await ctx.db.patch(transfer._id, {
        cancellationRequestedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { cancelled: false, executionId: execution._id };
    }
    if (execution?.open)
      await ctx.db.patch(execution._id, {
        open: false,
        stage: "cancelled",
        recoveryAt: undefined,
        updatedAt: Date.now(),
      });
    await ctx.db.patch(transfer._id, {
      open: false,
      status: "cancelled",
      recoveryAt: undefined,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: transfer.orgId,
      actorUserId: user._id,
      action: "treasury_service.discarded",
      objectType: "treasury_service",
      objectId: transfer._id,
    });
    return { cancelled: true, executionId: undefined };
  },
});
export const internalGet = internalQuery({
  args: { treasuryServiceId: v.id("treasuryServices") },
  handler: async (ctx, args) => ctx.db.get(args.treasuryServiceId),
});
export const checkpoint = internalMutation({
  args: { treasuryServiceId: v.id("treasuryServices") },
  handler: async (ctx, args) => {
    const transfer = await ctx.db.get(args.treasuryServiceId);
    if (!transfer?.open) return;
    const execution = transfer.circleExecutionId
      ? await ctx.db.get(transfer.circleExecutionId)
      : null;
    if (
      !execution &&
      decodeLendingQuote(transfer.quote).expiresAt <= Date.now()
    ) {
      await ctx.db.patch(transfer._id, {
        open: false,
        status: "expired",
        recoveryAt: undefined,
        updatedAt: Date.now(),
      });
    } else if (
      execution &&
      ["failed", "expired", "cancelled"].includes(execution.stage)
    ) {
      await ctx.db.patch(transfer._id, {
        open: false,
        status: execution.stage as "failed" | "expired" | "cancelled",
        recoveryAt: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(transfer._id, { recoveryAt: Date.now() + 60_000 });
      if (execution?.open)
        await ctx.scheduler.runAfter(0, internal.circlePayments.reconcile, {
          executionId: execution._id,
        });
    }
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("treasuryServices")
      .withIndex("by_due", (q) =>
        q.gt("recoveryAt", 0).lte("recoveryAt", Date.now()),
      )
      .take(20);
    for (const row of rows) {
      await ctx.db.patch(row._id, { recoveryAt: Date.now() + 60_000 });
      await ctx.scheduler.runAfter(0, internal.treasuryServices.checkpoint, {
        treasuryServiceId: row._id,
      });
    }
  },
});
