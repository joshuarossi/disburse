import { encodeAbiParameters, keccak256, type Address } from "viem";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireOrgAccess } from "./rbac";
import { ORG_READER_ROLES } from "../../shared/roles";
import { billingCheckoutCall } from "./billingCheckout";
import { circleConfiguration } from "../../shared/circleExecution";
import type { CircleSource } from "./circleSource";

export async function readBillingSource(
  ctx: QueryCtx,
  billingCheckoutId: Id<"billingCheckouts">,
  sessionToken: string,
  write = false,
) {
  const checkout = await ctx.db.get(billingCheckoutId);
  if (!checkout?.safeId)
    throw new Error(
      "This subscription request uses the original wallet recovery flow.",
    );
  const { user } = await requireOrgAccess(
    ctx,
    checkout.orgId,
    sessionToken,
    write ? ["admin", "approver"] : ORG_READER_ROLES,
  );
  const safe = await ctx.db.get(checkout.safeId);
  if (
    !safe ||
    safe.orgId !== checkout.orgId ||
    safe.chainId !== checkout.chainId ||
    safe.safeAddress.toLowerCase() !== checkout.payer
  )
    throw new Error("The subscription funding account changed.");
  if (
    write &&
    (safe.isActive === false ||
      checkout.status !== "prepared" ||
      !checkout.active)
  )
    throw new Error(
      "Check the original subscription request before preparing another payment.",
    );
  if (
    checkout.tokenAddress.toLowerCase() !==
    circleConfiguration(safe.chainId).token.toLowerCase()
  )
    throw new Error(
      "The subscription currency does not match this account service.",
    );
  const call = billingCheckoutCall(checkout);
  const hash = keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes" },
      ],
      [
        checkout._id,
        BigInt(safe.chainId),
        safe.safeAddress as Address,
        call.to as Address,
        call.data,
      ],
    ),
  );
  const identity: CircleSource = { billingCheckoutId };
  const target = {
    _id: checkout._id,
    orgId: checkout.orgId,
    safeId: safe._id,
    chainId: safe.chainId,
    safeTxHash: hash,
    status: checkout.status,
    executionFee: undefined,
  };
  return {
    identity,
    target,
    safe,
    user,
    checkout,
    snapshot: JSON.stringify({ identity, hash }),
    kind: "subscription_payment",
    sourceId: checkout._id,
    directCall: true as const,
    call: { ...call, to: call.to as Address },
  };
}
