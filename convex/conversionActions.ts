import { v } from "convex/values";
import { keccak256, toHex, type Address } from "viem";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { servicePreparationArgs } from "./treasuryServices";
import {
  quoteConversion,
  readConversionSnapshot,
} from "./lib/conversionProvider";
import type { ConversionSnapshot } from "../shared/conversion";
import { getChainClient } from "./lib/safeVerification";
import { assertSafeIdentity } from "./lib/safeIdentity";
import { assertCustomerPaidAccount } from "./lib/customerPaidAccount";

export const balances = action({
  args: { safeId: v.id("safes"), sessionToken: v.string() },
  handler: async (ctx, args): Promise<ConversionSnapshot> => {
    const safe = await ctx.runQuery(internal.treasuryServices.account, args);
    return readConversionSnapshot(safe.chainId, safe.safeAddress as Address);
  },
});
export const prepare = action({
  args: servicePreparationArgs,
  handler: async (ctx, args): Promise<Id<"treasuryServices">> => {
    if (
      args.kind !== "conversion" ||
      !args.tokenIn ||
      args.slippageBps === undefined
    )
      throw new Error("Choose the currencies and receiving amount.");
    const { safe, existing } = await ctx.runQuery(
      internal.treasuryServices.preparation,
      args,
    );
    if (existing) return existing._id;
    const snapshot = await readConversionSnapshot(
      safe.chainId,
      safe.safeAddress as Address,
    );
    const client = getChainClient(safe.chainId),
      block = BigInt(snapshot.blockNumber);
    await assertSafeIdentity(
      client,
      safe.safeAddress as Address,
      safe.chainId,
      block,
    );
    await assertCustomerPaidAccount(
      client,
      safe.safeAddress as Address,
      safe.chainId,
      block,
    );
    const quote = await quoteConversion(
      snapshot,
      args.tokenIn as Address,
      args.amount,
      args.slippageBps,
      keccak256(toHex(`${args.orgId}:${args.requestId}`)),
    );
    return ctx.runMutation(internal.treasuryServices.save, {
      ...args,
      quote: JSON.stringify(quote),
    });
  },
});
