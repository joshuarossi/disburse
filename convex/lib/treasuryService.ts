import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireOrgAccess } from "./rbac";
import { ORG_READER_ROLES, TREASURY_OPERATOR_ROLES } from "../../shared/roles";
import { decodeTreasuryServiceQuote, treasuryServiceCall, treasuryServiceHash, treasuryServicePrincipalUSDC } from "../../shared/treasuryService";
import { chainEnvironment } from "../../shared/assets";
import type { CircleSource } from "./circleSource";

export async function readTreasuryService(
  ctx: QueryCtx,
  treasuryServiceId: Id<"treasuryServices">,
  sessionToken: string,
  write = false,
) {
  const transfer = await ctx.db.get(treasuryServiceId);
  if (!transfer) throw new Error("Treasury request not found.");
  const { user } = await requireOrgAccess(
    ctx,
    transfer.orgId,
    sessionToken,
    write ? TREASURY_OPERATOR_ROLES : ORG_READER_ROLES,
  );
  const safe = await ctx.db.get(transfer.safeId),
    quote = decodeTreasuryServiceQuote(transfer.quote);
  if (
    !safe ||
    safe.orgId !== transfer.orgId ||
    safe.chainId !== quote.chainId ||
    transfer.chainId !== quote.chainId ||
    transfer.environment !== chainEnvironment(quote.chainId) ||
    safe.safeAddress.toLowerCase() !== quote.account.toLowerCase() ||
    transfer.hash !== treasuryServiceHash(quote) ||
    transfer.kind !== quote.kind ||
    transfer.provider !== quote.provider
  )
    throw new Error(
      "The saved treasury instructions changed. Check the original request.",
    );
  if (
    write &&
    (safe.isActive === false ||
      !transfer.open ||
      !["quoted", "approving"].includes(transfer.status) ||
      transfer.cancellationRequestedAt ||
      quote.expiresAt <= Date.now())
  )
    throw new Error(
      "This request is no longer ready for approval. Check its saved status before starting another.",
    );
  const identity: CircleSource = { treasuryServiceId };
  return {
    identity,
    transfer,
    safe,
    quote,
    user,
    target: {
      _id: transfer._id,
      orgId: transfer.orgId,
      safeId: safe._id,
      chainId: safe.chainId,
      status: transfer.status,
      safeTxHash: transfer.hash,
      executionFee: undefined,
    },
    snapshot: JSON.stringify({ id: transfer._id, hash: transfer.hash }),
    kind: "treasury_service",
    sourceId: transfer._id,
    directCall: true as const,
    call: treasuryServiceCall(quote),
    principalUSDC: treasuryServicePrincipalUSDC(quote),
    window: { validAfter: 0, validUntil: Math.floor(quote.expiresAt / 1000) },
  };
}
