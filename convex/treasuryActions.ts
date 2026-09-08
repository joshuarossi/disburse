import { v } from "convex/values";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { action, internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { treasuryPreparationArgs } from "./treasury";
import {
  assertCctpBurn,
  cctpCall,
  cctpConfiguration,
  decodeCctpQuote,
} from "../shared/cctp";
import {
  cctpForwardHints,
  cctpRequest,
  quoteCctp,
  verifyCctpFunding,
} from "./lib/cctpProvider";
import { getChainClient } from "./lib/safeVerification";
import { assertSafeIdentity } from "./lib/safeIdentity";
import { assertCustomerPaidAccount } from "./lib/customerPaidAccount";
import {
  readSettlementBlock,
  assertSameSettlement,
} from "./lib/settlementBlock";
import { decodeCircleRequest } from "../shared/circleRequest";
import { readCircleSettlement } from "../shared/circleSettlement";
import { readCctpDeliveryReceipt, scanCctpDelivery } from "./lib/cctpDelivery";

export const prepare = action({
  args: treasuryPreparationArgs,
  handler: async (ctx, args): Promise<Id<"treasuryTransfers">> => {
    const { existing, safe, destination } = await ctx.runQuery(
      internal.treasury.preparation,
      args,
    );
    if (existing) return existing._id;
    const quote = await quoteCctp({
      reference: keccak256(toHex(`${args.orgId}:${args.requestId}`)),
      chainId: safe.chainId,
      destinationChainId: destination.chainId,
      account: safe.safeAddress as Address,
      destination: destination.safeAddress as Address,
      amount: args.amount,
    });
    await verifyCctpFunding(quote);
    const blocks = await Promise.all(
      [safe, destination].map(async (account) => {
        const client = getChainClient(account.chainId),
          block = await client.getBlockNumber();
        await assertSafeIdentity(
          client,
          account.safeAddress as Address,
          account.chainId,
          block,
        );
        if (account._id === safe._id)
          await assertCustomerPaidAccount(
            client,
            account.safeAddress as Address,
            account.chainId,
            block,
          );
        return String(block);
      }),
    );
    return ctx.runMutation(internal.treasury.save, {
      ...args,
      quote: JSON.stringify(quote),
      destinationStartBlock: blocks[1],
    });
  },
});
export const verify = internalAction({
  args: {
    treasuryTransferId: v.id("treasuryTransfers"),
    sessionToken: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ to: Address; data: Hex; operation: 1 }> => {
    const { quote, destination } = await ctx.runQuery(
      internal.treasury.context,
      args,
    );
    await verifyCctpFunding(quote);
    const client = getChainClient(destination.chainId),
      block = await client.getBlockNumber();
    await assertSafeIdentity(
      client,
      quote.destination,
      destination.chainId,
      block,
    );
    return cctpCall(quote);
  },
});
export const reconcile = internalAction({
  args: { treasuryTransferId: v.id("treasuryTransfers") },
  handler: async (ctx, args): Promise<void> => {
    let context = await ctx.runQuery(internal.treasury.internalGet, args);
    if (
      !context ||
      ["completed", "cancelled", "failed", "expired"].includes(
        context.transfer.status,
      )
    )
      return;
    try {
      if (context.execution?.open) {
        await ctx.runAction(internal.circlePayments.reconcile, {
          executionId: context.execution._id,
        });
        context = await ctx.runQuery(internal.treasury.internalGet, args);
        if (!context) return;
      }
      const { transfer, execution } = context;
      if (
        !execution ||
        execution.stage !== "confirmed" ||
        !execution.txHash ||
        !execution.settlement ||
        !transfer.sourceTxHash
      ) {
        await ctx.runMutation(internal.treasury.checkpoint, args);
        return;
      }
      const quote = decodeCctpQuote(transfer.quote),
        request = decodeCircleRequest(execution.record);
      const source = cctpConfiguration(quote.chainId),
        client = getChainClient(quote.chainId);
      const receipt = await client.getTransactionReceipt({
        hash: execution.txHash as Hex,
      });
      const settlement = await readSettlementBlock(
        client,
        quote.chainId,
        receipt,
      );
      assertSameSettlement(execution.settlement, settlement);
      assertSameSettlement(transfer.sourceSettlement, settlement);
      if (
        (await client.getBlockNumber()) < receipt.blockNumber + 2n ||
        request.originalHash !== transfer.hash
      )
        throw new Error("The source receipt is not ready.");
      const result = readCircleSettlement(
        quote.chainId,
        request.operation,
        receipt,
      );
      if (result.status !== "confirmed")
        throw new Error("The original transfer did not execute.");
      assertCctpBurn(quote, receipt.logs, result);
      let hints: Hex[] = [],
        providerAvailable = true;
      try {
        hints = cctpForwardHints(
          await cctpRequest(
            quote.chainId,
            `/v2/messages/${source.domain}?transactionHash=${execution.txHash}`,
          ),
        );
      } catch {
        providerAvailable = false;
      }
      if (transfer.deliveryHint) hints.unshift(transfer.deliveryHint as Hex);
      const destinationClient = getChainClient(quote.destinationChainId);
      const verifyDelivery = async (hash: Hex, fromScan = false) => {
        let delivery;
        try {
          delivery = await readCctpDeliveryReceipt(
            destinationClient,
            quote,
            hash,
          );
        } catch (error) {
          if (fromScan) throw error;
          return false;
        }
        if (!delivery) return false;
        await ctx.runMutation(internal.treasury.settled, {
          ...args,
          ...delivery.proof,
          txHash: hash,
          settlement: delivery.settlement,
        });
        return true;
      };
      for (const hash of [...new Set(hints)].slice(0, 5))
        if (await verifyDelivery(hash)) return;
      // The receiving chain remains a source of truth even when the delivery API
      // is unavailable or a third-party relayer submitted the mint.
      const scan = await scanCctpDelivery(
        destinationClient,
        quote,
        transfer.destinationScanBlock,
      );
      for (const hash of scan.hashes)
        if (await verifyDelivery(hash, true)) return;
      await ctx.runMutation(internal.treasury.checkpoint, {
        ...args,
        destinationScanBlock: scan.nextBlock,
        moreDeliveryHistory: scan.more,
        error: transfer.deliveryHint
          ? "The supplied receipt has not confirmed this transfer. We will keep checking the original transfer."
          : hints.length
            ? "The transfer service reported delivery. We are waiting for the receiving account's confirmed receipt."
            : providerAvailable
              ? undefined
              : "The delivery service could not be reached. We are checking the receiving account directly. Do not send a replacement.",
      });
    } catch {
      await ctx.runMutation(internal.treasury.checkpoint, {
        ...args,
        error:
          "Delivery could not be verified yet. Your original transfer is saved and will be checked again. Do not send a replacement.",
      });
    }
  },
});
