import { encodeAbiParameters, keccak256, type Address } from "viem";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireOrgAccess } from "./rbac";
import { ORG_READER_ROLES, PAYMENT_OPERATOR_ROLES } from "../../shared/roles";
import {
  receivingFactoryCall,
  sweepCall,
} from "../../shared/receivableAddress";
import type { CircleSource } from "./circleSource";

export type ReceivingSource = {
  receivableId?: Id<"receivables">;
  receivingSetupSafeId?: Id<"safes">;
};
export async function readReceivingSource(
  ctx: QueryCtx,
  source: ReceivingSource,
  sessionToken: string,
  write = false,
) {
  const invoice = source.receivableId
    ? await ctx.db.get(source.receivableId)
    : null;
  if (source.receivableId && !invoice) throw new Error("Invoice not found");
  const safeId = invoice?.safeId ?? source.receivingSetupSafeId;
  const safe = safeId ? await ctx.db.get(safeId) : null;
  if (
    !safe ||
    (invoice &&
      (safe.orgId !== invoice.orgId ||
        safe.chainId !== invoice.chainId ||
        safe.safeAddress.toLowerCase() !== invoice.treasury.toLowerCase()))
  )
    throw new Error("The invoice receiving account changed");
  const { user } = await requireOrgAccess(
    ctx,
    safe.orgId,
    sessionToken,
    write
      ? source.receivableId
        ? PAYMENT_OPERATOR_ROLES
        : ["admin", "approver"]
      : ORG_READER_ROLES,
  );
  if (
    invoice &&
    (!invoice.factory ||
      !invoice.salt ||
      !invoice.receivingAddress ||
      invoice.state === "draft")
  )
    throw new Error("Issue this invoice before collecting its payments");
  if (write && invoice?.sweepState)
    throw new Error(
      "The earlier collection service request is unresolved. Check it before creating another.",
    );
  if (write && !invoice && safe.isActive === false)
    throw new Error("Choose an active company account for receiving setup");
  const call = invoice
    ? sweepCall({
        factory: invoice.factory!,
        treasury: invoice.treasury,
        salt: invoice.salt!,
        tokenAddress: invoice.tokenAddress,
      })
    : receivingFactoryCall();
  const hash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes" },
      ],
      [BigInt(safe.chainId), safe.safeAddress as Address, call.to, call.data],
    ),
  );
  const identity: CircleSource = source.receivableId
    ? { receivableId: source.receivableId }
    : { receivingSetupSafeId: safe._id };
  const target = {
    _id: invoice?._id ?? safe._id,
    orgId: safe.orgId,
    safeId: safe._id,
    chainId: safe.chainId,
    safeTxHash: hash,
    status: invoice?.state ?? "pending",
    executionFee: undefined,
  };
  return {
    identity,
    target,
    safe,
    user,
    snapshot: JSON.stringify({
      identity,
      hash,
      receivingAddress: invoice?.receivingAddress,
    }),
    kind: invoice ? "invoice_collection" : "invoice_receiving_setup",
    sourceId: target._id,
    directCall: true as const,
    call,
  };
}
