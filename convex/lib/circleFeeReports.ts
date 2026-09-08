import { formatUnits } from "viem";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { circleConfiguration } from "../../shared/circleExecution";
import { circleFeeTransferId } from "../../shared/circleSettlement";
import { identifyAsset } from "../../shared/assets";
import type { ReportRow } from "./reportRows";

export function hasCircleFeeProof(e: Doc<"circleExecutions">) {
  const p = e.feeProof;
  return (
    ["confirmed", "failed"].includes(e.stage) &&
    !e.open &&
    !!e.txHash &&
    !!e.settlement &&
    !!p &&
    /^\d{1,100}$/.test(e.fee ?? "") &&
    /^\d{1,100}$/.test(p.prefund.amountRaw) &&
    (!p.refund || /^\d{1,100}$/.test(p.refund.amountRaw)) &&
    [p.prefund, ...(p.refund ? [p.refund] : [])].every(
      (m) => Number.isSafeInteger(m.logIndex) && m.logIndex >= 0,
    ) &&
    (!p.refund || p.refund.logIndex > p.prefund.logIndex) &&
    BigInt(p.prefund.amountRaw) - BigInt(p.refund?.amountRaw ?? "0") ===
      BigInt(e.fee!)
  );
}

/** Once either gross transfer has entered the books, retain that basis for
 * both legs. Changing it to a new net movement would permit a second journal
 * and orphan the original export/correction evidence. */
export async function circleFeeUsesGrossAccounting(
  ctx: QueryCtx,
  e: Doc<"circleExecutions">,
) {
  if (!hasCircleFeeProof(e)) return false;
  const account = await ctx.db.get(e.safeId);
  if (!account || account.orgId !== e.orgId)
    throw new Error("The fee account could not be verified");
  for (const leg of [e.feeProof!.prefund, e.feeProof!.refund]) {
    if (!leg) continue;
    const key = `${account.chainId}:e${e.txHash!.slice(2).toLowerCase()}${leg.logIndex}`;
    if (
      await ctx.db
        .query("accountingMovements")
        .withIndex("by_movement", (q) => q.eq("orgId", e.orgId).eq("key", key))
        .unique()
    )
      return true;
  }
  return false;
}

export async function circleFeeReportRows(
  ctx: QueryCtx,
  id: Id<"circleExecutions">,
): Promise<ReportRow[]> {
  const e = await ctx.db.get(id);
  if (
    !e ||
    !hasCircleFeeProof(e) ||
    (await circleFeeUsesGrossAccounting(ctx, e))
  )
    return [];
  const account = await ctx.db.get(e.safeId);
  if (!account || account.orgId !== e.orgId)
    throw new Error("The fee account could not be verified");
  const config = circleConfiguration(account.chainId),
    asset = identifyAsset(account.chainId, config.token, "USDC");
  return [
    {
      ...asset,
      sourceId: e._id,
      rowId: `${e._id}:fee`,
      kind: "fee",
      direction: "outflow",
      amount: formatUnits(BigInt(e.fee!), 6),
      amountRaw: e.fee!,
      status: "executed",
      createdAt: e.settlement!.timestamp,
      observedAt: e.updatedAt,
      dateSource: "settlement",
      blockNumber: e.settlement!.blockNumber,
      blockHash: e.settlement!.blockHash,
      txHash: e.txHash,
      transferId: circleFeeTransferId(e.txHash!, e.feeProof!),
      transferMatch: "matched",
      safeId: e.safeId,
      accountAddress: account.safeAddress,
      beneficiaryName: "Execution fee",
      beneficiaryWallet: config.paymaster,
      memo:
        e.stage === "failed"
          ? "Fee charged for an unsuccessful execution"
          : "Fee after refund of the unused estimate",
      includedInTotals:
        asset.recognized && asset.environment !== "unclassified",
    },
  ];
}

/** Match complete chain identity and quantity. A transfer to the same provider
 * in the same transaction can be a separate payment and must remain visible. */
export async function isCircleFeeMovement(
  ctx: QueryCtx,
  t: Doc<"deposits"> | Doc<"outgoingTransfers">,
  direction: "prefund" | "refund",
) {
  const executions = await ctx.db
    .query("circleExecutions")
    .withIndex("by_safe_tx", (q) =>
      q.eq("safeId", t.safeId).eq("txHash", t.txHash.toLowerCase()),
    )
    .take(101);
  if (executions.length > 100)
    throw new Error("This bundle exceeds the fee matching review limit");
  for (const e of executions) {
    if (
      e.orgId !== t.orgId ||
      !hasCircleFeeProof(e) ||
      (await circleFeeUsesGrossAccounting(ctx, e))
    )
      continue;
    const config = circleConfiguration(t.chainId),
      movement = e.feeProof![direction];
    const provider = direction === "prefund" ? t.toAddress : t.fromAddress;
    if (
      !!movement &&
      t.tokenAddress.toLowerCase() === config.token.toLowerCase() &&
      provider?.toLowerCase() === config.paymaster.toLowerCase() &&
      (direction === "prefund" ? t.fromAddress : t.toAddress)?.toLowerCase() ===
        t.safeAddress.toLowerCase() &&
      t.transferId?.toLowerCase() ===
        `e${t.txHash.slice(2).toLowerCase()}${movement.logIndex}` &&
      t.amountRaw === movement.amountRaw &&
      String(t.blockNumber) === e.settlement!.blockNumber
    )
      return true;
  }
  return false;
}
