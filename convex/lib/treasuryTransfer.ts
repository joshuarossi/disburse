import { keccak256, toHex } from "viem";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ORG_READER_ROLES, TREASURY_OPERATOR_ROLES } from "../../shared/roles";
import { cctpCall, cctpQuoteHash, decodeCctpQuote } from "../../shared/cctp";
import { decodeCircleRequest } from "../../shared/circleRequest";
import { requireOrgAccess } from "./rbac";
import type { CircleSource } from "./circleSource";
import { appendAudit } from "../audit";

export async function readTreasuryTransfer(
  ctx: QueryCtx,
  treasuryTransferId: Id<"treasuryTransfers">,
  sessionToken: string,
  write = false,
) {
  const transfer = await ctx.db.get(treasuryTransferId);
  if (!transfer) throw new Error("Account transfer not found.");
  const { user } = await requireOrgAccess(
    ctx,
    transfer.orgId,
    sessionToken,
    write ? TREASURY_OPERATOR_ROLES : ORG_READER_ROLES,
  );
  const safe = await ctx.db.get(transfer.safeId),
    destination = await ctx.db.get(transfer.destinationSafeId);
  const quote = decodeCctpQuote(transfer.quote);
  if (
    !safe ||
    !destination ||
    safe.orgId !== transfer.orgId ||
    destination.orgId !== transfer.orgId ||
    safe.chainId !== quote.chainId ||
    destination.chainId !== quote.destinationChainId ||
    safe.safeAddress.toLowerCase() !== quote.account.toLowerCase() ||
    destination.safeAddress.toLowerCase() !== quote.destination.toLowerCase() ||
    transfer.hash !== cctpQuoteHash(quote)
  )
    throw new Error(
      "The saved account transfer changed. Check its original instructions.",
    );
  if (
    write &&
    (quote.version !== 2 ||
      safe.isActive === false ||
      destination.isActive === false ||
      !transfer.open ||
      !["quoted", "approving"].includes(transfer.status) ||
      transfer.cancellationRequestedAt ||
      quote.expiresAt <= Date.now())
  )
    throw new Error(
      "This transfer is no longer ready for approval. Check its saved status before requesting another quote.",
    );
  const identity: CircleSource = { treasuryTransferId };
  const target = {
    _id: transfer._id,
    orgId: transfer.orgId,
    safeId: safe._id,
    chainId: safe.chainId,
    status: transfer.status,
    safeTxHash: transfer.hash,
    executionFee: undefined,
  };
  return {
    identity,
    target,
    transfer,
    quote,
    safe,
    destination,
    user,
    snapshot: JSON.stringify({ id: transfer._id, hash: transfer.hash }),
    kind: "treasury_transfer",
    sourceId: transfer._id,
    directCall: true as const,
    call: cctpCall(quote),
    principalUSDC: quote.total,
    window: { validAfter: 0, validUntil: Math.floor(quote.expiresAt / 1000) },
  };
}

export async function readTreasuryCancellation(
  ctx: QueryCtx,
  original: Doc<"circleExecutions">,
  sessionToken: string,
  write = false,
) {
  const { transfer, safe, user } = await readTreasuryTransfer(
    ctx,
    original.treasuryTransferId!,
    sessionToken,
  );
  if (write)
    await requireOrgAccess(
      ctx,
      transfer.orgId,
      sessionToken,
      TREASURY_OPERATOR_ROLES,
    );
  if (
    transfer.circleExecutionId !== original._id ||
    original.safeId !== safe._id ||
    (write &&
      (!original.open ||
        original.stage === "submitting" ||
        transfer.sourceTxHash ||
        transfer.status !== "approving" ||
        !transfer.cancellationRequestedAt))
  )
    throw new Error(
      "Check the original transfer before cancelling its authorization.",
    );
  const request = decodeCircleRequest(original.record);
  if (
    !request.directCall ||
    request.safe.toLowerCase() !== safe.safeAddress.toLowerCase() ||
    request.originalHash !== transfer.hash
  )
    throw new Error("The original transfer authorization changed.");
  const snapshot = JSON.stringify({
    cancelExecutionId: original._id,
    transferId: transfer._id,
    nonce: String(request.operation.nonce),
    hash: transfer.hash,
    feeLimit: request.permit.amount,
  });
  const identity: CircleSource = { cancelExecutionId: original._id };
  return {
    identity,
    target: {
      _id: original._id,
      orgId: original.orgId,
      safeId: safe._id,
      chainId: safe.chainId,
      status: original.stage,
      safeTxHash: keccak256(toHex(snapshot)),
      executionFee: undefined,
    },
    safe,
    user,
    call: { to: request.safe, data: "0x" as const, operation: 0 as const },
    snapshot,
    sourceId: transfer._id,
    kind: "treasury_cancellation",
    directCall: true as const,
    principalUSDC: "0",
    originalRecord: original.record,
    originalExecutionId: original._id,
  };
}
export async function settleTreasuryCancellation(
  ctx: MutationCtx,
  original: Doc<"circleExecutions">,
  cancellation: Doc<"circleExecutions">,
) {
  const transfer = await ctx.db.get(original.treasuryTransferId!);
  if (
    !transfer ||
    transfer.circleExecutionId !== original._id ||
    transfer.sourceTxHash ||
    original.stage === "confirmed" ||
    !cancellation.settlement ||
    !cancellation.txHash ||
    decodeCircleRequest(original.record).operation.nonce !==
      decodeCircleRequest(cancellation.record).operation.nonce
  )
    throw new Error(
      "The cancellation does not match the original unsent transfer.",
    );
  if (transfer.status === "cancelled" && original.stage === "cancelled") return;
  await ctx.db.patch(original._id, {
    open: false,
    stage: "cancelled",
    recoveryAt: undefined,
    updatedAt: Date.now(),
  });
  await ctx.db.patch(transfer._id, {
    open: false,
    status: "cancelled",
    recoveryAt: undefined,
    error: undefined,
    updatedAt: Date.now(),
  });
  await appendAudit(ctx, {
    orgId: transfer.orgId,
    actorUserId: cancellation.createdBy,
    action: "treasury_transfer.cancelled",
    objectType: "treasury_transfer",
    objectId: transfer._id,
    metadata: {
      executionId: original._id,
      cancellationExecutionId: cancellation._id,
      txHash: cancellation.txHash,
    },
  });
}
