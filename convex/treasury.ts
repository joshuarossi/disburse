import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import { ORG_READER_ROLES, TREASURY_OPERATOR_ROLES } from "../shared/roles";
import {
  assertCctpRoute,
  cctpQuoteHash,
  decodeCctpQuote,
} from "../shared/cctp";
import { decodeCircleRequest } from "../shared/circleRequest";
import { readTreasuryTransfer } from "./lib/treasuryTransfer";
import { appendAudit } from "./audit";
import {
  assertSameSettlement,
  settlementBlockValidator,
} from "./lib/settlementBlock";
import { chainEnvironment } from "../shared/assets";
import { queueReportSource } from "./lib/reportIndex";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function hasPendingSource(
  ctx: Pick<QueryCtx, "db">,
  safeId: Id<"safes">,
) {
  for (const status of ["quoted", "approving", "processing"] as const) {
    if (
      await ctx.db
        .query("treasuryTransfers")
        .withIndex("by_safe_status", (q) =>
          q.eq("safeId", safeId).eq("status", status),
        )
        .first()
    )
      return true;
  }
  return false;
}

export const treasuryPreparationArgs = {
  orgId: v.id("orgs"),
  safeId: v.id("safes"),
  destinationSafeId: v.id("safes"),
  amount: v.string(),
  requestId: v.string(),
  sessionToken: v.string(),
};
const identity = {
  treasuryTransferId: v.id("treasuryTransfers"),
  sessionToken: v.string(),
};
export const list = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    environment: v.union(v.literal("production"), v.literal("test")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Load up to 100 transfers at a time.");
    await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ORG_READER_ROLES,
    );
    return ctx.db
      .query("treasuryTransfers")
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
    (
      await readTreasuryTransfer(
        ctx,
        args.treasuryTransferId,
        args.sessionToken,
      )
    ).transfer,
});
export const context = internalQuery({
  args: identity,
  handler: async (ctx, args) =>
    readTreasuryTransfer(ctx, args.treasuryTransferId, args.sessionToken, true),
});
export const preparation = internalQuery({
  args: treasuryPreparationArgs,
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      TREASURY_OPERATOR_ROLES,
    );
    if (
      !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId) ||
      !/^[1-9]\d{0,13}$/.test(args.amount)
    )
      throw new Error("Enter a positive amount and a valid transfer request.");
    const existing = await ctx.db
      .query("treasuryTransfers")
      .withIndex("by_request", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (
      existing &&
      (existing.safeId !== args.safeId ||
        existing.destinationSafeId !== args.destinationSafeId ||
        decodeCctpQuote(existing.quote).amount !== args.amount)
    )
      throw new Error(
        "This request already has different transfer instructions. Resume the saved transfer.",
      );
    const safe = await ctx.db.get(args.safeId),
      destination = await ctx.db.get(args.destinationSafeId);
    if (
      !safe ||
      !destination ||
      safe.orgId !== args.orgId ||
      destination.orgId !== args.orgId ||
      safe.isActive === false ||
      destination.isActive === false
    )
      throw new Error("Choose active company accounts in this workspace.");
    assertCctpRoute(safe.chainId, destination.chainId);
    if (!existing && (await hasPendingSource(ctx, safe._id)))
      throw new Error(
        "This account already has a transfer awaiting approval. Complete or stop that request first.",
      );
    return { safe, destination, userId: user._id, existing };
  },
});
export const save = internalMutation({
  args: {
    ...treasuryPreparationArgs,
    quote: v.string(),
    destinationStartBlock: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      TREASURY_OPERATOR_ROLES,
    );
    const existing = await ctx.db
      .query("treasuryTransfers")
      .withIndex("by_request", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (
        existing.safeId !== args.safeId ||
        existing.destinationSafeId !== args.destinationSafeId ||
        decodeCctpQuote(existing.quote).amount !== args.amount
      )
        throw new Error(
          "This transfer request already has different instructions.",
        );
      return existing._id;
    }
    const safe = await ctx.db.get(args.safeId),
      destination = await ctx.db.get(args.destinationSafeId),
      quote = decodeCctpQuote(args.quote);
    if (
      !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId) ||
      !safe ||
      !destination ||
      safe.orgId !== args.orgId ||
      destination.orgId !== args.orgId ||
      safe.isActive === false ||
      destination.isActive === false ||
      safe.chainId !== quote.chainId ||
      destination.chainId !== quote.destinationChainId ||
      safe.safeAddress.toLowerCase() !== quote.account.toLowerCase() ||
      destination.safeAddress.toLowerCase() !==
        quote.destination.toLowerCase() ||
      quote.amount !== args.amount ||
      quote.version !== 2 ||
      quote.expiresAt <= Date.now() ||
      quote.createdAt > Date.now() + 5000
    )
      throw new Error(
        "The company accounts or transfer quote changed. Review them again.",
      );
    if (
      args.destinationStartBlock !== undefined &&
      !/^\d{1,30}$/.test(args.destinationStartBlock)
    )
      throw new Error("The receiving network checkpoint is invalid.");
    if (await hasPendingSource(ctx, safe._id))
      throw new Error(
        "Resume the account's saved transfer before starting another.",
      );
    const id = await ctx.db.insert("treasuryTransfers", {
      orgId: args.orgId,
      safeId: safe._id,
      destinationSafeId: destination._id,
      chainId: safe.chainId,
      destinationChainId: destination.chainId,
      environment: chainEnvironment(safe.chainId) as "production" | "test",
      createdBy: user._id,
      requestId: args.requestId,
      quote: args.quote,
      destinationScanBlock: args.destinationStartBlock,
      hash: cctpQuoteHash(quote),
      status: "quoted",
      open: true,
      checks: 0,
      recoveryAt: quote.expiresAt + 5000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "treasury_transfer.quoted",
      objectType: "treasury_transfer",
      objectId: id,
      metadata: {
        source: safe._id,
        destination: destination._id,
        minimumReceived: quote.amount,
        maximumDeliveryFee: quote.feeLimit,
        provider: quote.provider,
      },
    });
    return id;
  },
});
export const stop = mutation({
  args: identity,
  handler: async (ctx, args) => {
    const { transfer } = await readTreasuryTransfer(
      ctx,
      args.treasuryTransferId,
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
      ["processing", "delivering", "completed"].includes(transfer.status)
    )
      throw new Error(
        "This transfer may already be on its way. Check delivery of the original transfer before taking another action.",
      );
    if (!transfer.open)
      return {
        cancelled: transfer.status === "cancelled",
        executionId: undefined,
      };
    const execution = transfer.circleExecutionId
      ? await ctx.db.get(transfer.circleExecutionId)
      : null;
    const operationSignature = execution
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
        operationSignature ||
        ["ready", "submitting", "confirmed"].includes(execution.stage))
    ) {
      if (execution.stage === "submitting" || execution.stage === "confirmed")
        throw new Error("Check the original submission before cancelling.");
      if (!execution.open)
        throw new Error(
          "Check the original authorization status before cancelling.",
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
      actorUserId: (
        await requireOrgAccess(
          ctx,
          transfer.orgId,
          args.sessionToken,
          TREASURY_OPERATOR_ROLES,
        )
      ).user._id,
      action: "treasury_transfer.discarded",
      objectType: "treasury_transfer",
      objectId: transfer._id,
    });
    return { cancelled: true, executionId: undefined };
  },
});
export const internalGet = internalQuery({
  args: { treasuryTransferId: v.id("treasuryTransfers") },
  handler: async (ctx, args) => {
    const transfer = await ctx.db.get(args.treasuryTransferId);
    return transfer
      ? {
          transfer,
          execution: transfer.circleExecutionId
            ? await ctx.db.get(transfer.circleExecutionId)
            : null,
        }
      : null;
  },
});
export const queue = mutation({
  args: identity,
  handler: async (ctx, args) => {
    const { transfer } = await readTreasuryTransfer(
      ctx,
      args.treasuryTransferId,
      args.sessionToken,
    );
    await requireOrgAccess(
      ctx,
      transfer.orgId,
      args.sessionToken,
      TREASURY_OPERATOR_ROLES,
    );
    if (transfer.updatedAt > Date.now() - 10_000) return;
    if (transfer.sourceTxHash)
      await queueReportSource(ctx, transfer.orgId, "treasury", transfer._id);
    if (transfer.status === "completed" || transfer.status === "cancelled")
      return;
    await ctx.db.patch(transfer._id, {
      recoveryAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.treasuryActions.reconcile, {
      treasuryTransferId: transfer._id,
    });
  },
});
export const reportDelivery = mutation({
  args: { ...identity, txHash: v.string() },
  handler: async (ctx, args) => {
    const { transfer, user } = await readTreasuryTransfer(
      ctx,
      args.treasuryTransferId,
      args.sessionToken,
    );
    await requireOrgAccess(
      ctx,
      transfer.orgId,
      args.sessionToken,
      TREASURY_OPERATOR_ROLES,
    );
    if (!/^0x[\da-f]{64}$/i.test(args.txHash))
      throw new Error(
        "Enter the full receiving transaction hash, starting with 0x.",
      );
    if (transfer.status !== "delivering" || !transfer.sourceTxHash)
      throw new Error(
        "Check the original transfer's status before adding a receiving receipt.",
      );
    if (transfer.deliveryHint && transfer.updatedAt > Date.now() - 10_000)
      throw new Error(
        "The last receipt is still being checked. Try again shortly.",
      );
    await ctx.db.patch(transfer._id, {
      deliveryHint: args.txHash.toLowerCase(),
      recoveryAt: Date.now(),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: transfer.orgId,
      actorUserId: user._id,
      action: "treasury_transfer.receipt_requested",
      objectType: "treasury_transfer",
      objectId: transfer._id,
      metadata: { txHash: args.txHash.toLowerCase() },
    });
    await ctx.scheduler.runAfter(0, internal.treasuryActions.reconcile, {
      treasuryTransferId: transfer._id,
    });
  },
});
export const settled = internalMutation({
  args: {
    treasuryTransferId: v.id("treasuryTransfers"),
    txHash: v.string(),
    amount: v.string(),
    fee: v.string(),
    nonce: v.string(),
    logIndex: v.number(),
    settlement: settlementBlockValidator,
  },
  handler: async (ctx, args) => {
    const transfer = await ctx.db.get(args.treasuryTransferId);
    if (
      !transfer ||
      !transfer.sourceTxHash ||
      !transfer.sourceSettlement ||
      !["delivering", "completed"].includes(transfer.status)
    )
      throw new Error("The transfer's original debit has not been verified.");
    const quote = decodeCctpQuote(transfer.quote);
    if (
      !/^0x[\da-f]{64}$/i.test(args.txHash) ||
      !/^0x[\da-f]{64}$/i.test(args.nonce) ||
      !/^\d+$/.test(args.amount) ||
      !/^\d+$/.test(args.fee) ||
      !Number.isSafeInteger(args.logIndex) ||
      args.logIndex < 0 ||
      BigInt(args.amount) < BigInt(quote.amount) ||
      BigInt(args.fee) > BigInt(quote.feeLimit) ||
      BigInt(args.amount) + BigInt(args.fee) !== BigInt(quote.total)
    )
      throw new Error(
        "The delivered amount or fee does not match the original transfer.",
      );
    assertSameSettlement(transfer.destinationSettlement, args.settlement);
    if (transfer.status === "completed") {
      if (
        transfer.destinationTxHash !== args.txHash ||
        transfer.deliveredAmount !== args.amount ||
        transfer.deliveryFee !== args.fee ||
        transfer.deliveryNonce !== args.nonce
      )
        throw new Error(
          "This transfer already has different delivery evidence.",
        );
      return;
    }
    await ctx.db.patch(transfer._id, {
      open: false,
      status: "completed",
      destinationTxHash: args.txHash,
      destinationTransferId: `e${args.txHash.slice(2)}${args.logIndex}`,
      destinationSettlement: args.settlement,
      deliveredAmount: args.amount,
      deliveryFee: args.fee,
      deliveryNonce: args.nonce,
      recoveryAt: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });
    await queueReportSource(ctx, transfer.orgId, "treasury", transfer._id);
    await appendAudit(ctx, {
      orgId: transfer.orgId,
      actorUserId: transfer.createdBy,
      action: "treasury_transfer.received",
      objectType: "treasury_transfer",
      objectId: transfer._id,
      metadata: {
        sourceTxHash: transfer.sourceTxHash,
        destinationTxHash: args.txHash,
        received: args.amount,
        deliveryFee: args.fee,
      },
    });
  },
});
export const checkpoint = internalMutation({
  args: {
    treasuryTransferId: v.id("treasuryTransfers"),
    error: v.optional(v.string()),
    destinationScanBlock: v.optional(v.string()),
    moreDeliveryHistory: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const transfer = await ctx.db.get(args.treasuryTransferId);
    if (
      !transfer ||
      ["completed", "cancelled", "failed", "expired"].includes(transfer.status)
    )
      return;
    const execution = transfer.circleExecutionId
      ? await ctx.db.get(transfer.circleExecutionId)
      : null;
    if (
      execution &&
      ["failed", "expired", "cancelled"].includes(execution.stage)
    ) {
      await ctx.db.patch(transfer._id, {
        status: execution.stage as "failed" | "expired" | "cancelled",
        open: false,
        recoveryAt: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
    } else if (
      !execution &&
      decodeCctpQuote(transfer.quote).expiresAt <= Date.now()
    ) {
      await ctx.db.patch(transfer._id, {
        status: "expired",
        open: false,
        recoveryAt: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
    } else {
      const quote = decodeCctpQuote(transfer.quote);
      const next = execution?.open
        ? Math.min(
            Date.now() + 60_000,
            Math.max(
              Date.now() + 5000,
              decodeCircleRequest(execution.record).validUntil * 1000 + 5000,
            ),
          )
        : transfer.status === "delivering"
          ? Date.now() +
            (args.moreDeliveryHistory
              ? 30_000
              : Math.min(
                  15 * 60_000,
                  60_000 * 2 ** Math.min(transfer.checks, 4),
                ))
          : quote.expiresAt + 5000;
      await ctx.db.patch(transfer._id, {
        ...(args.destinationScanBlock &&
        /^\d{1,30}$/.test(args.destinationScanBlock) &&
        (!transfer.destinationScanBlock ||
          BigInt(args.destinationScanBlock) >=
            BigInt(transfer.destinationScanBlock))
          ? { destinationScanBlock: args.destinationScanBlock }
          : {}),
        checks: transfer.checks + 1,
        recoveryAt: next,
        error: args.error,
        updatedAt: Date.now(),
      });
    }
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("treasuryTransfers")
      .withIndex("by_due", (q) =>
        q.gt("recoveryAt", 0).lte("recoveryAt", Date.now()),
      )
      .take(20);
    for (const transfer of rows) {
      await ctx.db.patch(transfer._id, { recoveryAt: Date.now() + 60_000 });
      await ctx.scheduler.runAfter(0, internal.treasuryActions.reconcile, {
        treasuryTransferId: transfer._id,
      });
    }
  },
});
