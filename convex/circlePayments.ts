import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { claimNative } from "./disbursements";
import { requireOrgAccess } from "./lib/rbac";
import { approvalPaths, readAccountAuthority } from "./lib/accountAuthority";
import {
  assembleDataApprovals,
  verifyDataSignature,
} from "./lib/accountApproval";
import {
  circleAccountState,
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
} from "./lib/circleSource";
import { reservePolicyExecution } from "./spendingPolicyData";
import { reserveCancellationExecution } from "./accountCancellationData";
import { circleFeeProofValidator } from "./lib/circleFeeProof";
import { queueReportSource } from "./lib/reportIndex";
import { hasCircleFeeProof } from "./lib/circleFeeReports";

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
      execution.disbursementId || execution.receivableId
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
    const open = await ctx.db
      .query("circleExecutions")
      .withIndex("by_account_open", (q) =>
        q.eq("accountKey", accountKey).eq("open", true),
      )
      .first();
    if (
      open &&
      JSON.stringify(circleSourceIdentity(open)) !==
        JSON.stringify(source.identity)
    )
      throw new Error(
        "Another request has an open fee authorization for this account. Complete or check that request first.",
      );
    const previous = await ctx.db
      .query("circleExecutions")
      .withIndex("by_account_created", (q) => q.eq("accountKey", accountKey))
      .order("desc")
      .first();
    return { open, previous, source };
  },
});
export const prepare = action({
  args: identity,
  handler: async (ctx, args): Promise<Id<"circleExecutions">> => {
    const { open, previous, source } = await ctx.runQuery(
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
    const record = await prepareCircleRequest({
      chainId: source.safe.chainId,
      safe: source.safe.safeAddress,
      transaction,
      originalHash: source.target.safeTxHash!,
      directCall: source.directCall,
      principalUSDC:
        source.identity.billingCheckoutId && "checkout" in source
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
            source.call.data.toLowerCase()))
    )
      throw new Error(
        "The execution does not match the reviewed account instruction",
      );
    const open = await ctx.db
      .query("circleExecutions")
      .withIndex("by_account_open", (q) =>
        q.eq("accountKey", accountKey).eq("open", true),
      )
      .first();
    if (open) {
      if (
        JSON.stringify(circleSourceIdentity(open)) ===
        JSON.stringify(source.identity)
      )
        return open._id;
      throw new Error(
        "Another request reserved this account fee authorization",
      );
    }
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
      stage: "fee",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scanFrom: request.startBlock,
      recoveryAt: request.validUntil * 1000 + 5000,
    });
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
      old.permit.amount !== next.permit.amount ||
      old.permit.nonce !== next.permit.nonce
    )
      throw new Error("The approved fee request cannot be replaced");
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
    const request = decodeCircleRequest(execution.record);
    const transaction = await verifyCircleSource(
      ctx,
      execution,
      args.sessionToken,
    );
    // Different valid signature encodings still execute the same immutable SafeTx;
    // verify the original signed wrapper, not a freshly assembled replacement.
    if (
      request.directCall
        ? transaction.to.toLowerCase() !==
            request.transaction.to.toLowerCase() ||
          transaction.data.toLowerCase() !==
            request.transaction.data.toLowerCase()
        : transaction.to.toLowerCase() !== request.safe.toLowerCase()
    )
      throw new Error("The account instructions changed");
    const authority = await readAccountAuthority(request.chainId, request.safe);
    const collected = await assembleDataApprovals(
      request.chainId,
      authority,
      circleRootSigningData(request, "operation"),
      signatures.filter((s) => s.stage === "operation"),
    );
    if (collected.confirmations.length < authority.nodes[0].threshold)
      throw new Error("The current account owners must approve this execution");
    const state = await circleAccountState(request.chainId, request.safe);
    if (
      state.nonce !== request.operation.nonce ||
      Number(state.block.timestamp) >= request.validUntil - 30 ||
      state.allowance > BigInt(request.permit.amount)
    )
      throw new Error(
        "The account or fee authorization changed. Check the original request before continuing.",
      );
    // Simulate the exact signed request. A provider rejection never falls back to
    // a native transaction and never causes an automatic second submission.
    await circleRpc(request.chainId, "eth_estimateUserOperationGas", [
      request.operation,
      state.config.entryPoint,
    ]);
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
        [request.operation, state.config.entryPoint],
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
      request.validUntil * 1000 <= Date.now()
    )
      throw new Error("The signed execution changed or expired");
    await readCircleSource(ctx, execution, args.sessionToken, true);
    await assertCircleReservation(ctx, execution.safeId, execution._id);
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
    if (!execution) return;
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
    try {
      const request = decodeCircleRequest(execution.record),
        client = getChainClient(request.chainId);
      const head = await client.getBlockNumber();
      if (head < 2n || (await client.getChainId()) !== request.chainId)
        throw new Error("Network not available");
      const confirmed = head - 2n,
        fromBlock = BigInt(
          !execution.open ? request.startBlock : execution.scanFrom,
        ),
        toBlock = confirmed < fromBlock + 1999n ? confirmed : fromBlock + 1999n;
      if (fromBlock > toBlock) return;
      const hash =
        execution.userOpHash ??
        circleOperationHash(request.chainId, request.operation);
      const checkpoint = await client.getBlock({ blockNumber: toBlock });
      const logs = await client.getLogs({
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
        (await client.getBlock({ blockNumber: toBlock })).hash !==
          checkpoint.hash
      )
        throw new Error("Inconsistent chain evidence");
      if (logs.length) {
        const receipt = await client.getTransactionReceipt({
          hash: logs[0].transactionHash,
        });
        if (receipt.blockNumber > confirmed) return;
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
          state: result.status,
          txHash: receipt.transactionHash,
          fee: String(result.fee),
          feeProof: result.feeProof,
          settlement,
          originalNonceAvailable: nonce === BigInt(request.safeNonce),
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
        error:
          "The network has not supplied confirmed execution evidence yet. Check this original request again shortly.",
      });
    }
  },
});
export const checkpoint = internalMutation({
  args: {
    executionId: v.id("circleExecutions"),
    revision: v.number(),
    scanFrom: v.string(),
    nextBlock: v.string(),
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
    await ctx.db.patch(execution._id, {
      stage: args.state ?? execution.stage,
      open: !args.state,
      scanFrom: args.nextBlock,
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
