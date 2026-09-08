import { formatUnits } from "viem";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ReportRow } from "./reportRows";
import { identifyAsset } from "../../shared/assets";
import { lendingMarket } from "../../shared/lending";
import { conversionAssets } from "../../shared/conversion";
import { decodeTreasuryServiceQuote } from "../../shared/treasuryService";

export async function treasuryServiceReportRows(
  ctx: QueryCtx,
  id: Id<"treasuryServices">,
): Promise<ReportRow[]> {
  const service = await ctx.db.get(id);
  if (
    !service ||
    service.status !== "completed" ||
    !service.sourceTxHash ||
    !service.sourceTransferId ||
    !service.sourceSettlement
  )
    return [];
  const safe = await ctx.db.get(service.safeId),
    quote = decodeTreasuryServiceQuote(service.quote);
  if (
    safe?.orgId !== service.orgId ||
    safe.safeAddress.toLowerCase() !== quote.account.toLowerCase()
  )
    throw new Error("The lending account could not be verified for reporting.");
  if (quote.provider === "uniswap_v3") {
    if (!service.outputTransferId || !service.settledAmount || !/^[1-9]\d{0,99}$/.test(service.settledAmount) || BigInt(service.settledAmount) > BigInt(quote.maximumInput))
      throw new Error("The actual conversion debit and receipt have not been verified.");
    const {input,output} = conversionAssets(quote.chainId,quote.tokenIn);
    return (["outflow","inflow"] as const).map(direction => {
      const token = direction === "outflow" ? input : output, amount = direction === "outflow" ? service.settledAmount! : quote.amount;
      const asset = identifyAsset(quote.chainId,token.address,token.symbol);
      const isTest = quote.chainId === 84532;
      return {...asset, ...(isTest ? {recognized:true,decimals:6,token:token.symbol}:{}),
        sourceId: service._id, treasuryServiceId:service._id, serviceKind:"conversion",rowId:`${service._id}:${direction}`,
        kind:"conversion",direction,amountRaw:amount,amount:formatUnits(BigInt(amount),6),
        createdAt:service.sourceSettlement!.timestamp,observedAt:service.updatedAt,dateSource:"settlement",
        blockNumber:service.sourceSettlement!.blockNumber,blockHash:service.sourceSettlement!.blockHash,
        transferId:direction==="outflow"?service.sourceTransferId:service.outputTransferId,txHash:service.sourceTxHash,transferMatch:"matched",status:"executed",safeId:safe._id,accountAddress:safe.safeAddress,
        beneficiaryName:direction==="outflow"?"Currency conversion · paid":"Currency conversion · received",beneficiaryWallet:quote.pool,
        memo:`Uniswap · ${input.symbol} to ${output.symbol}. Reconcile both movements through the same conversion clearing account.`,
        includedInTotals:asset.recognized||isTest};
    });
  }
  const market = lendingMarket(quote.chainId);
  const asset = identifyAsset(quote.chainId, market.asset, market.assetLabel);
  const amount =
    service.settledAmount ?? (quote.withdrawAll ? undefined : quote.amount);
  if (!amount || !/^[1-9]\d{0,99}$/.test(amount))
    throw new Error(
      "The actual lending settlement quantity has not been verified.",
    );
  // Aave's published test asset is only recognized in this service. It is never
  // added to the payment token list or confused with Circle's fee USDC.
  const isTest = quote.chainId === 84532;
  return [
    {
      ...asset,
      ...(isTest
        ? { recognized: true, decimals: 6, token: market.assetLabel }
        : {}),
      sourceId: service._id,
      treasuryServiceId: service._id,
      serviceKind: quote.kind,
      rowId: `${service._id}:principal`,
      kind: "investment",
      direction: quote.kind === "supply" ? "outflow" : "inflow",
      amountRaw: amount,
      amount: formatUnits(BigInt(amount), 6),
      createdAt: service.sourceSettlement.timestamp,
      observedAt: service.updatedAt,
      dateSource: "settlement",
      blockNumber: service.sourceSettlement.blockNumber,
      blockHash: service.sourceSettlement.blockHash,
      transferId: service.sourceTransferId,
      txHash: service.sourceTxHash,
      transferMatch: "matched",
      status: "executed",
      safeId: safe._id,
      accountAddress: safe.safeAddress,
      beneficiaryName:
        quote.kind === "supply" ? "Aave lending deposit" : "Aave withdrawal",
      beneficiaryWallet: market.aToken,
      memo:
        quote.kind === "supply"
          ? "Move the reviewed carrying value from cash to the Aave lending asset account."
          : "Reconcile the cash received against the lending asset carrying value. Review any unrecorded income separately.",
      includedInTotals: asset.recognized || isTest,
    },
  ];
}
export async function isTreasuryServiceMovement(
  ctx: QueryCtx,
  movement: Doc<"deposits"> | Doc<"outgoingTransfers">,
  direction: "inflow" | "outflow",
) {
  const services = await ctx.db
    .query("treasuryServices")
    .withIndex("by_source_receipt", (q) =>
      q
        .eq("chainId", movement.chainId)
        .eq("sourceTxHash", movement.txHash.toLowerCase()),
    )
    .take(101);
  if (services.length > 100)
    throw new Error(
      "This transaction needs a larger treasury matching review.",
    );
  for (const service of services) {
    if (service.orgId !== movement.orgId) continue;
    const rows = await treasuryServiceReportRows(ctx, service._id);
    if (rows.some(row =>
      row.direction === direction &&
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
    ))
      return true;
  }
  return false;
}
