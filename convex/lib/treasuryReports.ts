import { formatUnits, zeroAddress } from "viem";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ReportRow } from "./reportRows";
import { identifyAsset } from "../../shared/assets";
import { cctpConfiguration, decodeCctpQuote } from "../../shared/cctp";

/** Preserve the gross debit while funds are in transit. Delivery is a separate
 * net receipt on its own settlement date; its retained fee belongs in the
 * clearing-account journal, not a second debit from the receiving Safe. */
export async function treasuryReportRows(
  ctx: QueryCtx,
  id: Id<"treasuryTransfers">,
): Promise<ReportRow[]> {
  const transfer = await ctx.db.get(id);
  if (
    !transfer?.sourceTxHash ||
    !transfer.sourceTransferId ||
    !transfer.sourceSettlement
  )
    return [];
  const quote = decodeCctpQuote(transfer.quote),
    source = await ctx.db.get(transfer.safeId),
    destination = await ctx.db.get(transfer.destinationSafeId);
  if (source?.orgId !== transfer.orgId || destination?.orgId !== transfer.orgId)
    throw new Error(
      "The transfer accounts could not be verified for reporting.",
    );
  const rows: ReportRow[] = [
    {
      ...identifyAsset(
        quote.chainId,
        cctpConfiguration(quote.chainId).token,
        "USDC",
      ),
      sourceId: transfer._id,
      treasuryTransferId: transfer._id,
      rowId: `${transfer._id}:sent`,
      kind: "account_transfer",
      direction: "outflow",
      amountRaw: quote.total,
      amount: formatUnits(BigInt(quote.total), 6),
      createdAt: transfer.sourceSettlement.timestamp,
      observedAt: transfer.createdAt,
      dateSource: "settlement",
      blockNumber: transfer.sourceSettlement.blockNumber,
      blockHash: transfer.sourceSettlement.blockHash,
      transferId: transfer.sourceTransferId,
      txHash: transfer.sourceTxHash,
      transferMatch: "matched",
      status: "executed",
      safeId: source._id,
      accountAddress: source.safeAddress,
      beneficiaryName: `Transfer to ${destination.name ?? "company account"}`,
      beneficiaryWallet: cctpConfiguration(quote.chainId).minter,
      memo: "Company transfer through Circle. Reconcile the gross debit to a transfer clearing account.",
      includedInTotals: true,
    },
  ];
  if (
    transfer.status === "completed" &&
    transfer.destinationTxHash &&
    transfer.destinationTransferId &&
    transfer.destinationSettlement &&
    transfer.deliveredAmount &&
    transfer.deliveryFee
  ) {
    if (
      BigInt(transfer.deliveredAmount) + BigInt(transfer.deliveryFee) !==
      BigInt(quote.total)
    )
      throw new Error("The transfer's delivery evidence does not balance.");
    rows.push({
      ...identifyAsset(
        quote.destinationChainId,
        cctpConfiguration(quote.destinationChainId).token,
        "USDC",
      ),
      sourceId: transfer._id,
      treasuryTransferId: transfer._id,
      rowId: `${transfer._id}:received`,
      kind: "deposit",
      direction: "inflow",
      amountRaw: transfer.deliveredAmount,
      amount: formatUnits(BigInt(transfer.deliveredAmount), 6),
      createdAt: transfer.destinationSettlement.timestamp,
      observedAt: transfer.updatedAt,
      dateSource: "settlement",
      blockNumber: transfer.destinationSettlement.blockNumber,
      blockHash: transfer.destinationSettlement.blockHash,
      transferId: transfer.destinationTransferId,
      txHash: transfer.destinationTxHash,
      transferMatch: "matched",
      status: "received",
      safeId: destination._id,
      accountAddress: destination.safeAddress,
      beneficiaryName: `Transfer from ${source.name ?? "company account"}`,
      beneficiaryWallet: zeroAddress,
      memo: `Company transfer received. Circle retained ${formatUnits(BigInt(transfer.deliveryFee), 6)} USDC for delivery; reconcile it with the transfer clearing account.`,
      includedInTotals: true,
    });
  }
  return rows;
}

/** A Safe indexer can discover these same transfers before or after our direct
 * receipts. Only identical canonical movements are replaced by the richer row. */
export async function isTreasuryMovement(
  ctx: QueryCtx,
  movement: Doc<"deposits"> | Doc<"outgoingTransfers">,
  direction: "inflow" | "outflow",
) {
  const rows =
    direction === "outflow"
      ? await ctx.db
          .query("treasuryTransfers")
          .withIndex("by_source_receipt", (q) =>
            q
              .eq("chainId", movement.chainId)
              .eq("sourceTxHash", movement.txHash.toLowerCase()),
          )
          .take(101)
      : await ctx.db
          .query("treasuryTransfers")
          .withIndex("by_destination_receipt", (q) =>
            q
              .eq("destinationChainId", movement.chainId)
              .eq("destinationTxHash", movement.txHash.toLowerCase()),
          )
          .take(101);
  if (rows.length > 100)
    throw new Error(
      "This transaction needs a larger transfer-matching review.",
    );
  for (const transfer of rows) {
    if (transfer.orgId !== movement.orgId) continue;
    const row = (await treasuryReportRows(ctx, transfer._id)).find(
      (row) => row.direction === direction,
    );
    if (
      row &&
      row.safeId === movement.safeId &&
      row.transferId?.toLowerCase() === movement.transferId?.toLowerCase() &&
      row.amountRaw === movement.amountRaw &&
      row.tokenAddress?.toLowerCase() === movement.tokenAddress.toLowerCase() &&
      row.blockNumber === String(movement.blockNumber) &&
      (direction === "inflow"
        ? movement.fromAddress
        : movement.toAddress
      )?.toLowerCase() === row.beneficiaryWallet.toLowerCase() &&
      (direction === "inflow"
        ? movement.toAddress
        : movement.fromAddress
      )?.toLowerCase() === row.accountAddress.toLowerCase()
    )
      return true;
  }
  return false;
}
