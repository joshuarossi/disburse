import { settleCircleCancellation } from "./lib/circleCancellation";
import { settleDelegatedCircle } from "./lib/circleDelegation";
import { assertDelegatedCircleReceipt } from "../shared/delegatedSettlement";
import { v } from "convex/values";
import { assertCctpBurn, decodeCctpQuote } from "../shared/cctp";
import { assertTreasuryServiceSettlement, decodeTreasuryServiceQuote } from "../shared/treasuryService";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { verifyCircleSubmission } from "./lib/circleSubmission";
import { claimNative } from "./disbursements";
import { requireOrgAccess } from "./lib/rbac";
import { approvalPaths, readAccountAuthority } from "./lib/accountAuthority";
import {
  assembleDataApprovals,
  verifyDataSignature,
} from "./lib/accountApproval";
import {
  finishCircleFeeApproval,
  prepareCircleRequest,
} from "./lib/circleAccountService";
import {
  circleRootSigningData,
  decodeCircleRequest,
  encodeCircleRequest,
} from "../shared/circleRequest";
import {
  CIRCLE_ENTRY_POINT,
  circleOperationHash,
  circleSignature,
} from "../shared/circleExecution";
import { circleRpc } from "../shared/circleTransport";
import {
  circleUserOperationEvent,
  readCircleSettlement,
} from "../shared/circleSettlement";
import { packSafeSignatures } from "../shared/safeSignatures";
import { getChainClient } from "./lib/safeVerification";
import {
  readSettlementBlock,
  settlementBlockValidator,
} from "./lib/settlementBlock";
import { amountToBaseUnits } from "./lib/validation";
import { appendAudit } from "./audit";
import type { Id } from "./_generated/dataModel";
import { parseAbi, type Hex } from "viem";
import type { ApprovalGroup } from "../shared/accountApprovalView";
import { PAYMENT_OPERATOR_ROLES } from "../shared/roles";
import {
  assertCircleReservation,
  circleSourceArgs,
  circleSourceIdentity,
  readCircleSource,
  verifyCircleSource,
  openCircleRequests,
} from "./lib/circleSource";
import {
  assertCircleQueueCompatible,
  circleNonceKey,
  circleQueueLimit,
} from "../shared/circleQueue";
import { reservePolicyExecution } from "./spendingPolicyData";
import { reserveCancellationExecution } from "./accountCancellationData";
import { circleFeeProofValidator } from "./lib/circleFeeProof";
import { queueReportSource } from "./lib/reportIndex";
import { hasCircleFeeProof } from "./lib/circleFeeReports";
import { circleReceiptHint, scheduledScanStart } from "./lib/circleRecovery";
import { settleSchedule } from "./paymentSchedules";
import { assertScheduledTransfers } from "../shared/scheduledSettlement";

const identity = { ...circleSourceArgs, sessionToken: v.string() };
const executionIdentity = {
  executionId: v.id("circleExecutions"),
  sessionToken: v.string(),
};
const stage = v.union(v.literal("fee"), v.literal("operation"));
const writers = PAYMENT_OPERATOR_ROLES;

export const get = query({
  args: identity,
  handler: async (ctx, args) => {
    const { identity: source } = await readCircleSource(
      ctx,
      args,
      args.sessionToken,
    );
    if (source.treasuryServiceId)
      return ctx.db.query("circleExecutions").withIndex("by_treasury_service", q => q.eq("treasuryServiceId", source.treasuryServiceId)).order("desc").first();
    if (source.treasuryTransferId)
      return ctx.db.query("circleExecutions").withIndex("by_treasury_transfer", q => q.eq("treasuryTransferId", source.treasuryTransferId)).order("desc").first();
    if (source.paymentScheduleId || source.scheduleCancellationId) {
      const schedule = await ctx.db.get(
        (source.paymentScheduleId ?? source.scheduleCancellationId)!,
      );
      const id = source.paymentScheduleId
        ? schedule?.executionId
        : schedule?.cancellationExecutionId;
      return id ? ctx.db.get(id) : null;
    }
    if (source.cancelExecutionId)
      return ctx.db
        .query("circleExecutions")
        .withIndex("by_cancel_execution", (q) =>
          q.eq("cancelExecutionId", source.cancelExecutionId),
        )
        .order("desc")
        .first();
    if (source.delegatedDisbursementId)
      return ctx.db
        .query("circleExecutions")
        .withIndex("by_delegated_payment", (q) =>
          q.eq("delegatedDisbursementId", source.delegatedDisbursementId),
        )
        .order("desc")
        .first();
    if (source.accountSetupId)
      return ctx.db
        .query("circleExecutions")
        .withIndex("by_account_setup", (q) =>
          q.eq("accountSetupId", source.accountSetupId),
        )
        .order("desc")
        .first();
    if (source.billingCheckoutId)
      return ctx.db
        .query("circleExecutions")
        .withIndex("by_checkout", (q) =>
          q.eq("billingCheckoutId", source.billingCheckoutId),
        )
        .order("desc")
        .first();
    if (source.receivableId)
      return ctx.db
        .query("circleExecutions")
        .withIndex("by_invoice", (q) =>
          q.eq("receivableId", source.receivableId),
        )
        .order("desc")
        .first();
    if (source.receivingSetupSafeId)
      return ctx.db
        .query("circleExecutions")
        .withIndex("by_receiving_setup", (q) =>
          q.eq("receivingSetupSafeId", source.receivingSetupSafeId),
        )
        .order("desc")
        .first();
    if (source.disbursementId)
      return ctx.db
        .query("circleExecutions")
        .withIndex("by_payment", (q) =>
          q.eq("disbursementId", source.disbursementId),
        )
        .order("desc")
        .first();
    if (source.policyChangeId)
      return ctx.db
        .query("circleExecutions")
        .withIndex("by_policy", (q) =>
          q.eq("policyChangeId", source.policyChangeId),
        )
        .order("desc")
        .first();
    return ctx.db
      .query("circleExecutions")
      .withIndex("by_cancellation", (q) =>
        q.eq("cancellationId", source.cancellationId),
      )
      .order("desc")
      .first();
  },
});
export const context = internalQuery({
  args: executionIdentity,
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) throw new Error("Fee request not found");
    const { user } = await requireOrgAccess(
      ctx,
      execution.orgId,
      args.sessionToken,
      execution.disbursementId ||
        execution.receivableId ||
        execution.cancelExecutionId ||
        execution.delegatedDisbursementId ||
        execution.paymentScheduleId ||
        execution.scheduleCancellationId
        ? writers
        : ["admin", "approver"],
    );
    const signatures = await ctx.db
      .query("circleSignatures")
      .withIndex("by_execution_stage", (q) =>
        q.eq("executionId", execution._id),
      )
      .take(1001);
    if (signatures.length > 1000)
      throw new Error("This request exceeds the approval evidence limit");
    return { execution, signatures, wallet: user.walletAddress };
  },
});
export const previous = internalQuery({
  args: identity,
  handler: async (ctx, args) => {
    const source = await readCircleSource(ctx, args, args.sessionToken, true);
    const accountKey = `${source.safe.chainId}:${source.safe.safeAddress.toLowerCase()}`;
    const queue = await openCircleRequests(ctx, accountKey);
    if (queue.some((e) => e.orgId !== source.target.orgId))
      throw new Error(
        "Another workspace has an open fee authorization for this account. Complete or check that original request first.",
      );
    const open =
      queue.find(
        (e) =>
          JSON.stringify(circleSourceIdentity(e)) ===
          JSON.stringify(source.identity),
      ) ?? null;
    const queueFeeLimit = open
      ? undefined
      : circleQueueLimit(
          queue
            .filter(
              (e) =>
                !("originalExecutionId" in source) ||
                e._id !== source.originalExecutionId,
            )
            .map((e) => ({
              concurrentFees: e.concurrentFees,
              request: decodeCircleRequest(e.record),
            })),
        );
    const previous = await ctx.db
      .query("circleExecutions")
      .withIndex("by_account_created", (q) => q.eq("accountKey", accountKey))
      .order("desc")
      .first();
    return { open, previous, source, queueFeeLimit: queueFeeLimit?.toString() };
  },
});
export const prepare = action({
  args: identity,
  handler: async (ctx, args): Promise<Id<"circleExecutions">> => {
    const { open, previous, source, queueFeeLimit } = await ctx.runQuery(
      internal.circlePayments.previous,
      args,
    );
    if (open) return open._id;
    const transaction = await verifyCircleSource(
      ctx,
      source.identity,
      args.sessionToken,
    );
    const payment = source.identity.disbursementId
      ? (source.target as import("./_generated/dataModel").Doc<"disbursements">)
      : null;
    const original =
      "originalRecord" in source && source.originalRecord
        ? decodeCircleRequest(source.originalRecord)
        : undefined;
    const record = await prepareCircleRequest({
      chainId: source.safe.chainId,
      safe: source.safe.safeAddress,
      transaction,
      originalHash: source.target.safeTxHash!,
      directCall: source.directCall,
      window: "window" in source ? source.window : undefined,
      nonceKey: original
        ? original.operation.nonce >> 64n
        : circleNonceKey(source.target.safeTxHash! as Hex, crypto.randomUUID()),
      queueFeeLimit: original
        ? BigInt(original.permit.amount)
        : queueFeeLimit === undefined
          ? undefined
          : BigInt(queueFeeLimit),
      principalUSDC:
        "principalUSDC" in source
          ? BigInt(source.principalUSDC)
          : source.identity.billingCheckoutId && "checkout" in source
            ? BigInt(source.checkout.amountRaw)
            : payment?.token === "USDC"
              ? amountToBaseUnits(
                  payment.totalAmount ?? payment.amount ?? "0",
                  "USDC",
                )
              : 0n,
      previousPermit: previous
        ? decodeCircleRequest(previous.record).permit
        : undefined,
    });
    if (original && record.operation.nonce !== original.operation.nonce)
      throw new Error(
        "The original payment authorization already used its sequence. Check its status before cancelling.",
      );
    return ctx.runMutation(internal.circlePayments.persist, {
      ...args,
      record: encodeCircleRequest(record),
      snapshot: source.snapshot,
    });
  },
});
export const persist = internalMutation({
  args: { ...identity, record: v.string(), snapshot: v.string() },
  handler: async (ctx, args) => {
    const source = await readCircleSource(ctx, args, args.sessionToken, true);
    if (source.snapshot !== args.snapshot)
      throw new Error("The original instructions changed. Review them again.");
    const request = decodeCircleRequest(args.record),
      accountKey = `${source.safe.chainId}:${source.safe.safeAddress.toLowerCase()}`;
    if (
      request.originalHash !== source.target.safeTxHash ||
      request.safe.toLowerCase() !== source.safe.safeAddress.toLowerCase() ||
      request.chainId !== source.safe.chainId
    )
      throw new Error(
        "The fee request does not match these account instructions",
      );
    if (
      !!request.directCall !== source.directCall ||
      (source.directCall &&
        (request.transaction.to.toLowerCase() !==
          source.call.to.toLowerCase() ||
          request.transaction.data.toLowerCase() !==
            source.call.data.toLowerCase() ||
          (request.transaction.operation ?? 0) !==
            ("operation" in source.call ? source.call.operation : 0)))
    )
      throw new Error(
        "The execution does not match the reviewed account instruction",
      );
    const queue = await openCircleRequests(ctx, accountKey);
    if (queue.some((e) => e.orgId !== source.target.orgId))
      throw new Error(
        "Another workspace has an open fee authorization for this account. Complete or check that original request first.",
      );
    const open = queue.find(
      (e) =>
        JSON.stringify(circleSourceIdentity(e)) ===
        JSON.stringify(source.identity),
    );
    const original =
      "originalRecord" in source && source.originalRecord
        ? decodeCircleRequest(source.originalRecord)
        : undefined;
    if (
      "window" in source &&
      source.window &&
      (request.validAfter !== source.window.validAfter ||
        request.validUntil !== source.window.validUntil)
    )
      throw new Error("The signed payment window changed.");
    if (
      original &&
      (request.operation.nonce !== original.operation.nonce ||
        request.permit.amount !== original.permit.amount ||
        request.validAfter !== 0)
    )
      throw new Error(
        "Cancellation must invalidate the original sequence within its approved fee limit.",
      );
    if (open) return open._id;
    assertCircleQueueCompatible(
      request,
      queue
        .filter(
          (e) =>
            !("originalExecutionId" in source) ||
            e._id !== source.originalExecutionId,
        )
        .map((e) => ({
          concurrentFees: e.concurrentFees,
          request: decodeCircleRequest(e.record),
        })),
    );
    const previous = await ctx.db
      .query("circleExecutions")
      .withIndex("by_account_created", (q) => q.eq("accountKey", accountKey))
      .order("desc")
      .first();
    if (previous) {
      const old = decodeCircleRequest(previous.record);
      if (
        old.permit.nonce === request.permit.nonce &&
        old.permit.amount !== request.permit.amount
      )
        throw new Error(
          "The existing fee authorization must keep its original limit until its nonce advances",
        );
    }
    const id = await ctx.db.insert("circleExecutions", {
      orgId: source.target.orgId,
      safeId: source.safe._id,
      accountKey,
      ...source.identity,
      createdBy: source.user._id,
      record: args.record,
      revision: 0,
      open: true,
      concurrentFees: true,
      stage: "fee",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scanFrom: request.startBlock,
      recoveryAt: request.validUntil * 1000 + 5000,
    });
    if (
      source.identity.paymentScheduleId ||
      source.identity.scheduleCancellationId
    )
      await ctx.db.patch(
        (source.identity.paymentScheduleId ??
          source.identity.scheduleCancellationId)!,
        source.identity.paymentScheduleId
          ? { executionId: id }
          : { cancellationExecutionId: id },
      );
    if (source.identity.delegatedDisbursementId)
      await ctx.db.patch(source.identity.delegatedDisbursementId, {
        allowanceCircleExecutionId: id,
      });
    if (source.identity.treasuryServiceId)
      await ctx.db.patch(source.identity.treasuryServiceId, {circleExecutionId: id, status: "approving", recoveryAt: request.validUntil * 1000 + 5000, updatedAt: Date.now()});
    if (source.identity.treasuryTransferId)
      await ctx.db.patch(source.identity.treasuryTransferId, { circleExecutionId: id, status: "approving", recoveryAt: request.validUntil * 1000 + 5000, updatedAt: Date.now() });
    await appendAudit(ctx, {
      orgId: source.target.orgId,
      actorUserId: source.user._id,
      action: `${source.kind}.fee_review_created`,
      objectType: source.kind,
      objectId: source.sourceId,
      metadata: {
        executionId: id,
        maximumFee: request.permit.amount,
        token: "USDC",
      },
    });
    return id;
  },
});

export const approvals = action({
  args: executionIdentity,
  handler: async (
    ctx,
    args,
  ): Promise<{
    groups: ApprovalGroup[];
    threshold: number;
    approved: number;
    paths: { path: string[]; approved: boolean }[];
  }> => {
    const { execution, signatures, wallet } = await ctx.runQuery(
      internal.circlePayments.context,
      args,
    );
    const request = decodeCircleRequest(execution.record),
      authority = await readAccountAuthority(request.chainId, request.safe);
    const currentStage =
      execution.stage === "fee" ? ("fee" as const) : ("operation" as const);
    const collected = await assembleDataApprovals(
      request.chainId,
      authority,
      circleRootSigningData(request, currentStage),
      signatures.filter((s) => s.stage === currentStage),
    );
    return {
      groups: collected.groups,
      threshold: authority.nodes[0].threshold,
      approved: collected.confirmations.length,
      paths: approvalPaths(authority, wallet).map((path) => ({
        path,
        approved: signatures.some(
          (s) =>
            s.stage === currentStage &&
            s.owner === wallet.toLowerCase() &&
            s.pathKey === path.join(":"),
        ),
      })),
    };
  },
});
// Persist before opening the wallet. A lost signature-save response must not
// make a potentially signed instruction eligible for free local cancellation.
export const beginApproval = mutation({
  args: { ...executionIdentity, revision: v.number() },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (
      !execution ||
      !execution.open ||
      execution.stage !== "operation" ||
      execution.revision !== args.revision
    )
      throw new Error(
        "The fee request changed. Review its current approval step.",
      );
    await readCircleSource(ctx, execution, args.sessionToken, true);
    await ctx.db.patch(execution._id, {
      operationApprovalStartedAt:
        execution.operationApprovalStartedAt ?? Date.now(),
    });
  },
});
export const approve = action({
  args: {
    ...executionIdentity,
    stage,
    path: v.array(v.string()),
    signature: v.string(),
    revision: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const { execution, wallet } = await ctx.runQuery(
      internal.circlePayments.context,
      { executionId: args.executionId, sessionToken: args.sessionToken },
    );
    if (execution.stage !== args.stage || execution.revision !== args.revision)
      throw new Error(
        "The fee request changed. Review its current approval step.",
      );
    const request = decodeCircleRequest(execution.record);
    await verifyCircleSource(ctx, execution, args.sessionToken);
    const authority = await readAccountAuthority(request.chainId, request.safe);
    const digest = await verifyDataSignature(
      request.chainId,
      authority,
      circleRootSigningData(request, args.stage),
      { path: args.path, owner: wallet, signature: args.signature },
    );
    await ctx.runMutation(internal.circlePayments.saveSignature, {
      ...args,
      digest,
    });
    await ctx.runAction(api.circlePayments.advance, {
      executionId: execution._id,
      sessionToken: args.sessionToken,
    });
  },
});
export const saveSignature = internalMutation({
  args: {
    ...executionIdentity,
    stage,
    path: v.array(v.string()),
    signature: v.string(),
    revision: v.number(),
    digest: v.string(),
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (
      !execution ||
      execution.stage !== args.stage ||
      execution.revision !== args.revision
    )
      throw new Error("The fee request changed while your wallet was open");
    const source = await readCircleSource(
        ctx,
        execution,
        args.sessionToken,
        true,
      ),
      user = source.user;
    const request = decodeCircleRequest(execution.record);
    if (request.validUntil * 1000 <= Date.now() + 30_000)
      throw new Error(
        "This fee request expired. Check its status before preparing a new request.",
      );
    const path = args.path.map((p) => p.toLowerCase()),
      pathKey = path.join(":"),
      owner = user.walletAddress.toLowerCase();
    const existing = await ctx.db
      .query("circleSignatures")
      .withIndex("by_signer", (q) =>
        q
          .eq("executionId", execution._id)
          .eq("stage", args.stage)
          .eq("pathKey", pathKey)
          .eq("owner", owner),
      )
      .unique();
    if (existing) {
      if (existing.digest === args.digest) return;
      throw new Error("Your original approval cannot be replaced");
    }
    if (
      (
        await ctx.db
          .query("circleSignatures")
          .withIndex("by_execution_stage", (q) =>
            q.eq("executionId", execution._id).eq("stage", args.stage),
          )
          .take(501)
      ).length >= 500
    )
      throw new Error("This request exceeds the approval evidence limit");
    await ctx.db.insert("circleSignatures", {
      executionId: execution._id,
      stage: args.stage,
      path,
      pathKey,
      owner,
      signature: args.signature,
      digest: args.digest,
      createdBy: user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(execution._id, { updatedAt: Date.now() });
    await appendAudit(ctx, {
      orgId: execution.orgId,
      actorUserId: user._id,
      action: `${source.kind}.fee_approval`,
      objectType: source.kind,
      objectId: source.sourceId,
      metadata: {
        executionId: execution._id,
        stage: args.stage,
        path,
        digest: args.digest,
      },
    });
  },
});
export const advance = action({
  args: executionIdentity,
  handler: async (ctx, args): Promise<void> => {
    const { execution, signatures } = await ctx.runQuery(
      internal.circlePayments.context,
      args,
    );
    if (!["fee", "operation"].includes(execution.stage)) return;
    const request = decodeCircleRequest(execution.record),
      authority = await readAccountAuthority(request.chainId, request.safe);
    if (execution.stage === "fee") {
      const next = await finishCircleFeeApproval(
        request,
        authority,
        signatures.filter((s) => s.stage === "fee"),
      );
      if (next)
        await ctx.runMutation(internal.circlePayments.advanceSaved, {
          executionId: execution._id,
          revision: execution.revision,
          record: encodeCircleRequest(next),
          stage: "operation",
        });
    } else {
      const collected = await assembleDataApprovals(
        request.chainId,
        authority,
        circleRootSigningData(request, "operation"),
        signatures.filter((s) => s.stage === "operation"),
      );
      if (collected.confirmations.length >= authority.nodes[0].threshold) {
        request.operation.signature = circleSignature(
          request.validAfter,
          request.validUntil,
          packSafeSignatures(
            collected.confirmations.slice(0, authority.nodes[0].threshold),
          ),
        );
        await ctx.runMutation(internal.circlePayments.advanceSaved, {
          executionId: execution._id,
          revision: execution.revision,
          record: encodeCircleRequest(request),
          stage: "ready",
        });
      }
    }
  },
});
export const advanceSaved = internalMutation({
  args: {
    executionId: v.id("circleExecutions"),
    revision: v.number(),
    record: v.string(),
    stage: v.union(v.literal("operation"), v.literal("ready")),
  },
  handler: async (ctx, args) => {
    const current = await ctx.db.get(args.executionId);
    if (!current || current.revision !== args.revision || !current.open) return;
    if (current.stage !== (args.stage === "operation" ? "fee" : "operation"))
      throw new Error("Finish the current approval step first");
    const old = decodeCircleRequest(current.record),
      next = decodeCircleRequest(args.record);
    if (
      old.originalHash !== next.originalHash ||
      old.transaction.data !== next.transaction.data ||
      old.transaction.to !== next.transaction.to ||
      old.transaction.operation !== next.transaction.operation ||
      old.directCall !== next.directCall ||
      old.chainId !== next.chainId ||
      old.safe !== next.safe ||
      old.validAfter !== next.validAfter ||
      old.validUntil !== next.validUntil ||
      old.operation.nonce !== next.operation.nonce ||
      old.operation.callData !== next.operation.callData ||
      old.permit.amount !== next.permit.amount ||
      old.permit.nonce !== next.permit.nonce
    )
      throw new Error("The approved fee request cannot be replaced");
    if (
      args.stage === "ready" &&
      JSON.stringify({ ...old.operation, signature: undefined }, (_, value) =>
        typeof value === "bigint" ? String(value) : value,
      ) !==
        JSON.stringify(
          { ...next.operation, signature: undefined },
          (_, value) => (typeof value === "bigint" ? String(value) : value),
        )
    )
      throw new Error("The signed operation cannot change after approval.");
    await ctx.db.patch(current._id, {
      record: args.record,
      stage: args.stage,
      scanFrom: next.startBlock,
      revision: current.revision + 1,
      updatedAt: Date.now(),
    });
  },
});

export const submit = action({
  args: executionIdentity,
  handler: async (ctx, args): Promise<void> => {
    const { execution, signatures } = await ctx.runQuery(
      internal.circlePayments.context,
      args,
    );
    if (execution.stage !== "ready")
      throw new Error("Complete the account and fee approvals before sending");
    if (execution.paymentScheduleId) {
      await ctx.runAction(api.paymentSchedules.arm, args);
      return;
    }
    const transaction = await verifyCircleSource(
      ctx,
      execution,
      args.sessionToken,
    );
    const request = await verifyCircleSubmission(
      execution,
      signatures.filter((s) => s.stage === "operation"),
      transaction,
    );
    const hash = circleOperationHash(request.chainId, request.operation);
    await ctx.runMutation(internal.circlePayments.claim, {
      ...args,
      revision: execution.revision,
      userOpHash: hash,
    });
    try {
      const response = await circleRpc(
        request.chainId,
        "eth_sendUserOperation",
        [request.operation, CIRCLE_ENTRY_POINT],
      );
      if (response !== hash)
        throw new Error(
          "The submission response did not identify the saved request",
        );
    } catch {
      throw new Error(
        "Your original execution request is saved. Check its status before trying another payment.",
      );
    }
  },
});
export const claim = internalMutation({
  args: { ...executionIdentity, revision: v.number(), userOpHash: v.string() },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (
      !execution ||
      execution.stage !== "ready" ||
      execution.revision !== args.revision
    )
      throw new Error(
        "This execution was already submitted or changed. Check the original request.",
      );
    const request = decodeCircleRequest(execution.record);
    if (
      circleOperationHash(request.chainId, request.operation) !==
        args.userOpHash ||
      request.validUntil * 1000 <= Date.now() ||
      request.validAfter * 1000 > Date.now()
    )
      throw new Error("The signed execution changed or expired");
    await readCircleSource(ctx, execution, args.sessionToken, true);
    await assertCircleReservation(ctx, execution.safeId, execution._id);
    if (execution.paymentScheduleId)
      throw new Error(
        "Use the scheduled instruction to dispatch this payment.",
      );
    if (execution.scheduleCancellationId) {
      const schedule = (await ctx.db.get(execution.scheduleCancellationId))!;
      await ctx.db.patch(schedule._id, {
        status: "paused",
        dispatchAt: undefined,
        updatedAt: Date.now(),
      });
    }
    const claim = {
      sessionToken: args.sessionToken,
      safeTxHash: request.originalHash,
      searchFromBlock: request.startBlock,
      attemptId: execution._id,
      circleExecutionId: execution._id,
    };
    if (execution.disbursementId)
      await claimNative(ctx, {
        ...claim,
        disbursementId: execution.disbursementId,
      });
    else if (execution.policyChangeId)
      await reservePolicyExecution(ctx, {
        ...claim,
        policyChangeId: execution.policyChangeId,
        ...request.transaction,
      });
    else if (execution.cancellationId)
      await reserveCancellationExecution(ctx, {
        ...claim,
        cancellationId: execution.cancellationId,
        ...request.transaction,
      });
    if (execution.billingCheckoutId)
      await ctx.db.patch(execution.billingCheckoutId, {
        status: "requested",
        circleExecutionId: execution._id,
        recoveryAt: Date.now() + 60_000,
        checks: 0,
        updatedAt: Date.now(),
      });
    if (execution.treasuryServiceId)
      await ctx.db.patch(execution.treasuryServiceId, {status: "processing", recoveryAt: Date.now(), updatedAt: Date.now()});
    if (execution.treasuryTransferId)
      await ctx.db.patch(execution.treasuryTransferId, { status: "processing", recoveryAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.patch(execution._id, {
      stage: "submitting",
      userOpHash: args.userOpHash,
      recoveryAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(5000, internal.circlePayments.reconcile, {
      executionId: execution._id,
    });
  },
});

export const recheck = action({
  args: executionIdentity,
  handler: async (ctx, args): Promise<void> => {
    await ctx.runQuery(internal.circlePayments.context, args);
    await ctx.runAction(internal.circlePayments.reconcile, {
      executionId: args.executionId,
    });
  },
});
export const internalGet = internalQuery({
  args: { executionId: v.id("circleExecutions") },
  handler: (ctx, args) => ctx.db.get(args.executionId),
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("circleExecutions")
      .withIndex("by_due", (q) =>
        q.gt("recoveryAt", 0).lte("recoveryAt", Date.now()),
      )
      .take(20);
    for (const request of due) {
      await ctx.db.patch(request._id, { recoveryAt: Date.now() + 60_000 });
      await ctx.scheduler.runAfter(0, internal.circlePayments.reconcile, {
        executionId: request._id,
      });
    }
  },
});
export const reconcile = internalAction({
  args: { executionId: v.id("circleExecutions") },
  handler: async (ctx, args): Promise<void> => {
    const execution = await ctx.runQuery(
      internal.circlePayments.internalGet,
      args,
    );
    if (!execution || execution.stage === "cancelled") return;
    if (
      !execution.open &&
      (execution.feeProof || execution.stage === "expired")
    ) {
      if (execution.stage === "confirmed" && execution.accountSetupId)
        await ctx.runAction(internal.accountSetups.complete, {
          accountSetupId: execution.accountSetupId,
        });
      return;
    }
    let receiptFound = false;
    try {
      const request = decodeCircleRequest(execution.record),
        client = getChainClient(request.chainId);
      const head = await client.getBlockNumber();
      if (head < 2n || (await client.getChainId()) !== request.chainId)
        throw new Error("Network not available");
      const confirmed = head - 2n;
      let fromBlock = BigInt(
        !execution.open ? request.startBlock : execution.scanFrom,
      );
      if (
        execution.open &&
        execution.scanHash &&
        fromBlock > 0n &&
        (
          await client.getBlock({ blockNumber: fromBlock - 1n })
        ).hash?.toLowerCase() !== execution.scanHash.toLowerCase()
      ) {
        await ctx.runMutation(internal.circlePayments.checkpoint, {
          executionId: execution._id,
          revision: execution.revision,
          scanFrom: execution.scanFrom,
          nextBlock: request.startBlock,
          error:
            "The network reorganized recent blocks. The original payment is being checked again.",
        });
        return;
      }
      const hint = await circleReceiptHint(client, request, confirmed);
      if (
        execution.paymentScheduleId &&
        fromBlock === BigInt(request.startBlock) &&
        !hint
      )
        fromBlock = await scheduledScanStart(
          client,
          fromBlock,
          confirmed,
          request.validAfter,
        );
      const toBlock =
        hint?.blockNumber ??
        (confirmed < fromBlock + 1999n ? confirmed : fromBlock + 1999n);
      if (fromBlock > toBlock) return;
      const hash =
        execution.userOpHash ??
        circleOperationHash(request.chainId, request.operation);
      const checkpoint = await client.getBlock({ blockNumber: toBlock });
      const logs = hint
        ? []
        : await client.getLogs({
            address: CIRCLE_ENTRY_POINT,
            event: circleUserOperationEvent,
            args: { userOpHash: hash as Hex, sender: request.safe },
            fromBlock,
            toBlock,
            strict: true,
          });
      if (
        logs.some((l) => l.removed) ||
        logs.length > 1 ||
        !checkpoint.hash ||
        checkpoint.number !== toBlock ||
        (await client.getBlock({ blockNumber: toBlock })).hash !==
          checkpoint.hash
      )
        throw new Error("Inconsistent chain evidence");
      if (hint || logs.length) {
        const receipt =
          hint ??
          (await client.getTransactionReceipt({
            hash: logs[0].transactionHash,
          }));
        if (receipt.blockNumber > confirmed) return;
        receiptFound = true;
        const settlement = await readSettlementBlock(
          client,
          request.chainId,
          receipt,
        );
        const result = readCircleSettlement(
          request.chainId,
          request.operation,
          receipt,
        );
        if (execution.paymentScheduleId && result.status === "confirmed")
          assertScheduledTransfers(request, receipt.logs, result);
        let treasuryDebitIndex: number | undefined;
        let serviceTransferIndex: number | undefined;
        let serviceAmount: string | undefined;
        let serviceOutputIndex: number | undefined;
        if (execution.treasuryServiceId && result.status === "confirmed") {
          const service = await ctx.runQuery(internal.treasuryServices.internalGet, {treasuryServiceId: execution.treasuryServiceId});
          if (!service || service.circleExecutionId !== execution._id || service.hash !== request.originalHash)
            throw new Error("The original treasury request changed.");
          const proof = assertTreasuryServiceSettlement(decodeTreasuryServiceQuote(service.quote), receipt.logs, result);
          serviceTransferIndex = proof.logIndex ?? undefined;
          serviceAmount = proof.amount;
          serviceOutputIndex = proof.outputLogIndex ?? undefined;
        }
        if (execution.treasuryTransferId && result.status === "confirmed") {
          const data = await ctx.runQuery(internal.treasury.internalGet, { treasuryTransferId: execution.treasuryTransferId });
          if (!data || data.transfer.circleExecutionId !== execution._id || data.transfer.hash !== request.originalHash)
            throw new Error("The original account transfer changed.");
          treasuryDebitIndex = assertCctpBurn(decodeCctpQuote(data.transfer.quote), receipt.logs, result).logIndex;
        }
        if (
          execution.delegatedDisbursementId &&
          result.status === "confirmed"
        ) {
          const { payment } = await ctx.runQuery(
            internal.delegatedPayments.context,
            { disbursementId: execution.delegatedDisbursementId },
          );
          if (
            !payment.allowanceExecution ||
            payment.allowanceFeeSafeId !== execution.safeId
          )
            throw new Error("The original allowance execution changed.");
          assertDelegatedCircleReceipt(
            payment.allowanceExecution,
            payment.token,
            receipt.logs,
            result,
          );
        }
        const nonce = await client.readContract({
          address: request.safe,
          abi: parseAbi(["function nonce() view returns(uint256)"]),
          functionName: "nonce",
          blockNumber: receipt.blockNumber,
        });
        await ctx.runMutation(internal.circlePayments.checkpoint, {
          executionId: execution._id,
          revision: execution.revision,
          scanFrom: execution.scanFrom,
          nextBlock: String(toBlock + 1n),
          scanHash: checkpoint.hash,
          state: result.status,
          txHash: receipt.transactionHash,
          fee: String(result.fee),
          feeProof: result.feeProof,
          settlement,
          originalNonceAvailable: nonce === BigInt(request.safeNonce),
          principalVerified:
            (execution.paymentScheduleId ||
              execution.treasuryServiceId ||
              execution.treasuryTransferId ||
              execution.delegatedDisbursementId) &&
            result.status === "confirmed"
              ? true
              : undefined,
          treasuryDebitIndex,
          serviceTransferIndex,
          serviceAmount,
          serviceOutputIndex,
        });
        if (execution.stage === "submitting") {
          if (execution.disbursementId)
            await ctx.runAction(internal.nativePayments.reconcile, {
              disbursementId: execution.disbursementId,
            });
          else if (execution.policyChangeId)
            await ctx.runAction(internal.spendingPolicyRecovery.reconcile, {
              policyChangeId: execution.policyChangeId,
            });
          else if (execution.cancellationId)
            await ctx.runAction(
              internal.accountCancellationRecovery.reconcile,
              { cancellationId: execution.cancellationId },
            );
          else if (execution.accountSetupId)
            await ctx.runAction(internal.accountSetups.complete, {
              accountSetupId: execution.accountSetupId,
            });
          else if (execution.billingCheckoutId)
            await ctx.runAction(internal.circleBilling.settle, {
              checkoutId: execution.billingCheckoutId,
            });
          else if (execution.receivableId)
            await ctx.runAction(internal.receivableActions.scan, {
              invoiceId: execution.receivableId,
            });
        }
        return;
      }
      const expired = Number(checkpoint.timestamp) > request.validUntil;
      const nonce = expired
        ? await client.readContract({
            address: request.safe,
            abi: parseAbi(["function nonce() view returns(uint256)"]),
            functionName: "nonce",
            blockNumber: toBlock,
          })
        : undefined;
      await ctx.runMutation(internal.circlePayments.checkpoint, {
        executionId: execution._id,
        revision: execution.revision,
        scanFrom: execution.scanFrom,
        nextBlock: String(toBlock + 1n),
        scanHash: checkpoint.hash,
        ...(expired
          ? {
              state: "expired" as const,
              originalNonceAvailable: nonce === BigInt(request.safeNonce),
            }
          : {}),
      });
    } catch {
      await ctx.runMutation(internal.circlePayments.checkpoint, {
        executionId: execution._id,
        revision: execution.revision,
        scanFrom: execution.scanFrom,
        nextBlock: execution.scanFrom,
        error: receiptFound
          ? "A transaction receipt was found, but its details still need verification. Your original request is saved; do not repeat this operation."
          : "The network has not supplied confirmed execution evidence yet. Check this original request again shortly.",
      });
    }
  },
});
export const checkpoint = internalMutation({
  args: {
    serviceTransferIndex: v.optional(v.number()),
    serviceAmount: v.optional(v.string()),
    serviceOutputIndex: v.optional(v.number()),
    treasuryDebitIndex: v.optional(v.number()),
    executionId: v.id("circleExecutions"),
    revision: v.number(),
    scanFrom: v.string(),
    nextBlock: v.string(),
    scanHash: v.optional(v.string()),
    state: v.optional(
      v.union(
        v.literal("confirmed"),
        v.literal("failed"),
        v.literal("expired"),
      ),
    ),
    txHash: v.optional(v.string()),
    fee: v.optional(v.string()),
    feeProof: v.optional(circleFeeProofValidator),
    settlement: v.optional(settlementBlockValidator),
    error: v.optional(v.string()),
    originalNonceAvailable: v.optional(v.boolean()),
    principalVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (
      !execution ||
      execution.revision !== args.revision ||
      execution.scanFrom !== args.scanFrom
    )
      return;
    if (
      !execution.open &&
      (execution.feeProof ||
        args.state !== execution.stage ||
        args.txHash !== execution.txHash ||
        args.fee !== execution.fee)
    )
      return;
    if (
      args.state &&
      args.state !== "expired" &&
      (!args.txHash ||
        !args.settlement ||
        args.fee === undefined ||
        !args.feeProof)
    )
      throw new Error("Settlement evidence is incomplete");
    if (
      args.feeProof &&
      !hasCircleFeeProof({
        ...execution,
        stage: args.state ?? execution.stage,
        open: false,
        fee: args.fee,
        feeProof: args.feeProof,
        txHash: args.txHash,
        settlement: args.settlement,
      })
    )
      throw new Error("Fee transfer evidence is inconsistent");
    if (
      args.state === "confirmed" &&
      (execution.paymentScheduleId || execution.delegatedDisbursementId || execution.treasuryTransferId || execution.treasuryServiceId) &&
      !args.principalVerified
    )
      throw new Error("The principal transfers have not been verified.");
    if (execution.treasuryTransferId && args.state === "confirmed" &&
      (!Number.isSafeInteger(args.treasuryDebitIndex) || args.treasuryDebitIndex! < 0))
      throw new Error("The transfer's account debit has not been verified.");
    if (execution.treasuryServiceId && args.state === "confirmed" && (!Number.isSafeInteger(args.serviceTransferIndex) || args.serviceTransferIndex! < 0))
      throw new Error("The treasury request's asset transfer has not been verified.");
    await ctx.db.patch(execution._id, {
      stage: args.state ?? execution.stage,
      open: !args.state,
      scanFrom: args.nextBlock,
      scanHash:
        args.nextBlock === execution.scanFrom
          ? execution.scanHash
          : args.scanHash,
      txHash: args.txHash,
      fee: args.fee,
      settlement: args.settlement,
      feeProof: args.feeProof,
      error: args.error,
      recoveryAt: args.state ? undefined : Date.now() + 60_000,
      updatedAt: Date.now(),
    });
    if (args.feeProof)
      await queueReportSource(ctx, execution.orgId, "fee", execution._id);
    if (execution.treasuryServiceId && args.state) {
      const service = await ctx.db.get(execution.treasuryServiceId);
      if (!service || service.circleExecutionId !== execution._id || service.hash !== decodeCircleRequest(execution.record).originalHash)
        throw new Error("The original treasury fee request changed.");
      const quote = decodeTreasuryServiceQuote(service.quote);
      if (args.state === "confirmed") {
        if (!/^[1-9]\d{0,99}$/.test(args.serviceAmount ?? "")) throw new Error("The treasury debit has not been verified.");
        if (quote.provider === "aave_v3" ? !quote.withdrawAll && args.serviceAmount !== quote.amount
          : BigInt(args.serviceAmount!) > BigInt(quote.maximumInput) || !Number.isSafeInteger(args.serviceOutputIndex) || args.serviceOutputIndex! < 0 || args.serviceOutputIndex === args.serviceTransferIndex)
          throw new Error("The settled treasury amounts do not match the authorized request.");
      }
      await ctx.db.patch(service._id, args.state === "confirmed" ? {
        open: false, status: "completed", sourceTxHash: args.txHash, sourceSettlement: args.settlement,
        sourceTransferId: `e${args.txHash!.slice(2)}${args.serviceTransferIndex}`, recoveryAt: undefined, error: undefined, updatedAt: Date.now(),
        settledAmount: args.serviceAmount,
        outputTransferId: quote.provider === "uniswap_v3" ? `e${args.txHash!.slice(2)}${args.serviceOutputIndex}` : undefined,
      } : {open: false, status: args.state, recoveryAt: undefined, error: undefined, updatedAt: Date.now()});
      if (args.state === "confirmed") await queueReportSource(ctx, service.orgId, "service", service._id);
      await appendAudit(ctx, {orgId: service.orgId, actorUserId: execution.createdBy, action: `treasury_service.${args.state}`, objectType: "treasury_service", objectId: service._id, metadata: {executionId: execution._id, txHash: args.txHash, fee: args.fee}});
    }
    if (execution.treasuryTransferId && args.state) {
      const transfer = await ctx.db.get(execution.treasuryTransferId);
      if (!transfer || transfer.circleExecutionId !== execution._id || transfer.hash !== decodeCircleRequest(execution.record).originalHash)
        throw new Error("The original transfer fee request changed.");
      await ctx.db.patch(transfer._id, args.state === "confirmed" ? {
        open: false, status: "delivering", sourceTxHash: args.txHash, sourceSettlement: args.settlement,
        sourceTransferId: `e${args.txHash!.slice(2)}${args.treasuryDebitIndex}`, recoveryAt: Date.now(), checks: 0, error: undefined, updatedAt: Date.now(),
      } : { open: false, status: args.state, recoveryAt: undefined, error: undefined, updatedAt: Date.now() });
      if (args.state === "confirmed") await queueReportSource(ctx, transfer.orgId, "treasury", transfer._id);
    }
    if (args.state && execution.delegatedDisbursementId)
      await settleDelegatedCircle(ctx, (await ctx.db.get(execution._id))!);
    if (args.state && execution.cancelExecutionId)
      await settleCircleCancellation(ctx, (await ctx.db.get(execution._id))!);
    if (
      args.state &&
      (execution.paymentScheduleId || execution.scheduleCancellationId)
    )
      await settleSchedule(ctx, (await ctx.db.get(execution._id))!);
    if (args.state === "confirmed" && execution.accountSetupId) {
      await ctx.db.patch(execution.accountSetupId, { recoveryAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.accountSetups.complete, {
        accountSetupId: execution.accountSetupId,
      });
    }
    if (
      (args.state === "failed" || args.state === "expired") &&
      execution.billingCheckoutId
    ) {
      const checkout = await ctx.db.get(execution.billingCheckoutId);
      if (
        checkout?.circleExecutionId === execution._id &&
        checkout.status === "requested" &&
        !checkout.txHash
      )
        await ctx.db.patch(checkout._id, {
          status: "prepared",
          circleExecutionId: undefined,
          recoveryAt: undefined,
          error: undefined,
          updatedAt: Date.now(),
        });
    }
    if (args.state === "failed" || args.state === "expired") {
      const payment = execution.disbursementId
        ? await ctx.db.get(execution.disbursementId)
        : null;
      if (
        args.originalNonceAvailable &&
        payment?.status === "relaying" &&
        payment.nativeExecution?.attemptId === execution._id &&
        !payment.txHash
      ) {
        // The SafeTx inside a failed/expired UserOp may still be valid. Return the
        // original approval for a new reviewed fee attempt, never a new payment.
        await ctx.db.patch(payment._id, {
          status: "proposed",
          nativeRecoveryAt: undefined,
          nativeExecution: undefined,
          relayStatus: undefined,
          relayError: undefined,
          updatedAt: Date.now(),
        });
      }
    }
    if (
      args.originalNonceAvailable &&
      (args.state === "failed" || args.state === "expired") &&
      (execution.policyChangeId || execution.cancellationId)
    ) {
      const target = execution.policyChangeId
        ? await ctx.db.get(execution.policyChangeId)
        : await ctx.db.get(execution.cancellationId!);
      if (
        target?.status === "processing" &&
        target.execution?.attemptId === execution._id &&
        !target.execution.txHash
      )
        await ctx.db.patch(target._id, {
          status: "pending",
          execution: undefined,
          recoveryAt: undefined,
          error: undefined,
          updatedAt: Date.now(),
        });
    }
    if (args.state)
      await appendAudit(ctx, {
        orgId: execution.orgId,
        actorUserId: execution.createdBy,
        action: `account.fee_execution_${args.state}`,
        objectType: "account_execution",
        objectId: execution._id,
        metadata: {
          executionId: execution._id,
          userOpHash: execution.userOpHash,
          txHash: args.txHash,
          fee: args.fee,
          settlement: args.settlement,
        },
      });
  },
});
