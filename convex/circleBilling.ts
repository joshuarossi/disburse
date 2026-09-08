import { v } from "convex/values";
import { parseAbiItem, parseEventLogs, type Hex } from "viem";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { readBillingSource } from "./lib/circleBilling";
import { decodeCircleRequest } from "../shared/circleRequest";
import { readCircleSettlement } from "../shared/circleSettlement";
import { getChainClient } from "./lib/safeVerification";
import { readSettlementBlock } from "./lib/settlementBlock";
import { billingCheckoutCall } from "./lib/billingCheckout";

export const context = internalQuery({
  args: {
    billingCheckoutId: v.id("billingCheckouts"),
    sessionToken: v.string(),
  },
  handler: (ctx, args) =>
    readBillingSource(ctx, args.billingCheckoutId, args.sessionToken, true),
});

/** The subscription transfer must belong to the exact signed UserOp, not
 * another successful operation bundled into the same transaction. */
export const settle = internalAction({
  args: { checkoutId: v.id("billingCheckouts") },
  handler: async (ctx, args): Promise<string> => {
    const checkout = await ctx.runQuery(
      internal.billingCheckoutData.context,
      args,
    );
    if (checkout.status === "applied") return "applied";
    if (
      !checkout.safeId ||
      !checkout.circleExecutionId ||
      !["requested", "submitted"].includes(checkout.status)
    )
      return checkout.status;
    const execution = await ctx.runQuery(internal.circlePayments.internalGet, {
      executionId: checkout.circleExecutionId,
    });
    if (
      !execution ||
      execution.billingCheckoutId !== checkout._id ||
      execution.safeId !== checkout.safeId ||
      execution.orgId !== checkout.orgId
    )
      throw new Error(
        "The subscription execution does not match this checkout.",
      );
    if (
      execution.stage !== "confirmed" ||
      !execution.txHash ||
      !execution.settlement
    )
      return checkout.status;
    const request = decodeCircleRequest(execution.record),
      call = billingCheckoutCall(checkout);
    if (
      !request.directCall ||
      request.chainId !== checkout.chainId ||
      request.safe.toLowerCase() !== checkout.payer ||
      request.transaction.to.toLowerCase() !== call.to.toLowerCase() ||
      request.transaction.data !== call.data
    )
      throw new Error("The subscription instructions changed.");
    const client = getChainClient(checkout.chainId);
    if ((await client.getChainId()) !== checkout.chainId)
      throw new Error("Billing network mismatch.");
    const receipt = await client.getTransactionReceipt({
      hash: execution.txHash as Hex,
    });
    if ((await client.getBlockNumber()) < receipt.blockNumber + 2n)
      throw new Error("The subscription payment needs more confirmations.");
    const block = await readSettlementBlock(client, checkout.chainId, receipt);
    if (block.blockHash !== execution.settlement.blockHash)
      throw new Error(
        "The subscription receipt changed. Check its original execution.",
      );
    const result = readCircleSettlement(
      checkout.chainId,
      request.operation,
      receipt,
    );
    if (result.status !== "confirmed")
      throw new Error("The subscription operation did not complete.");
    const transfers = parseEventLogs({
      abi: [
        parseAbiItem(
          "event Transfer(address indexed from,address indexed to,uint256 value)",
        ),
      ],
      logs: receipt.logs,
      strict: true,
    }).filter(
      (log) =>
        !log.removed &&
        log.address.toLowerCase() === checkout.tokenAddress.toLowerCase() &&
        log.args.from.toLowerCase() === checkout.payer &&
        log.args.to.toLowerCase() === checkout.treasury &&
        log.logIndex! > result.executionStart &&
        log.logIndex! < result.executionEnd,
    );
    if (
      transfers.length !== 1 ||
      transfers[0].args.value !== BigInt(checkout.amountRaw)
    )
      throw new Error(
        "The account receipt does not contain the exact subscription payment.",
      );
    await ctx.runMutation(internal.billing.recordVerifiedPayment, {
      checkoutId: checkout._id,
      orgId: checkout.orgId,
      chainId: checkout.chainId,
      plan: checkout.plan,
      tokenAddress: checkout.tokenAddress,
      amountRaw: checkout.amountRaw,
      txHash: execution.txHash,
      transferId: `${execution.txHash}:${transfers[0].logIndex}`,
    });
    await ctx.runMutation(internal.billing.redeemCheckout, {
      checkoutId: checkout._id,
    });
    return "applied";
  },
});
