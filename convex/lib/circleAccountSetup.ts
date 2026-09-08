import { keccak256, toHex, type Address, type Hex } from "viem";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireOrgAccess } from "./rbac";
import { ORG_READER_ROLES } from "../../shared/roles";
import { companyAccountDeployment } from "../../shared/companyAccountSetup";
import type { CircleSource } from "./circleSource";

export async function readAccountSetupSource(
  ctx: QueryCtx,
  accountSetupId: Id<"accountSetups">,
  sessionToken: string,
  write = false,
) {
  const setup = await ctx.db.get(accountSetupId);
  if (!setup) throw new Error("Company account setup not found.");
  const { user } = await requireOrgAccess(
    ctx,
    setup.orgId,
    sessionToken,
    write ? ["admin", "approver"] : ORG_READER_ROLES,
  );
  const safe = await ctx.db.get(setup.parentSafeId);
  if (
    !safe ||
    safe.orgId !== setup.orgId ||
    safe.chainId !== setup.chainId ||
    safe.safeAddress.toLowerCase() !== setup.parentAddress
  )
    throw new Error("The parent company account changed.");
  if (
    write &&
    (safe.isActive === false || !setup.open || setup.status !== "prepared")
  )
    throw new Error(
      "Check the original company account setup before continuing.",
    );
  const call = companyAccountDeployment(
    setup.chainId,
    setup.parentAddress as Address,
    setup.salt as Hex,
  );
  const snapshot = JSON.stringify({
    id: setup._id,
    parent: setup.parentAddress,
    address: setup.address,
    chainId: setup.chainId,
    salt: setup.salt,
    name: setup.name,
    to: call.to,
    data: call.data,
  });
  const identity: CircleSource = { accountSetupId };
  return {
    identity,
    target: {
      _id: setup._id,
      orgId: setup.orgId,
      safeId: safe._id,
      chainId: setup.chainId,
      status: setup.status,
      safeTxHash: keccak256(toHex(snapshot)),
      executionFee: undefined,
    },
    safe,
    user,
    snapshot,
    sourceId: setup._id,
    kind: "company_account_setup",
    directCall: true as const,
    call,
  };
}
