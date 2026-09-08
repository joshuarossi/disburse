import { v } from "convex/values";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { action, internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { servicePreparationArgs } from "./treasuryServices";
import {
  assertLendingAvailable,
  LENDING_QUOTE_LIFETIME,
  lendingCall,
  type LendingQuote,
  type LendingSnapshot,
} from "../shared/lending";
import {
  readLendingPosition,
  verifyLendingFunding,
} from "./lib/lendingProvider";
import { getChainClient } from "./lib/safeVerification";
import { assertSafeIdentity } from "./lib/safeIdentity";
import { assertCustomerPaidAccount } from "./lib/customerPaidAccount";

export const position = action({
  args: { safeId: v.id("safes"), sessionToken: v.string() },
  handler: async (ctx, args): Promise<LendingSnapshot> => {
    const safe = await ctx.runQuery(internal.treasuryServices.account, args);
    return readLendingPosition(safe.chainId, safe.safeAddress as Address);
  },
});
export const prepare = action({
  args: servicePreparationArgs,
  handler: async (ctx, args): Promise<Id<"treasuryServices">> => {
    const { safe, existing } = await ctx.runQuery(
      internal.treasuryServices.preparation,
      args,
    );
    if (existing) return existing._id;
    const snapshot = await readLendingPosition(
      safe.chainId,
      safe.safeAddress as Address,
    );
    assertLendingAvailable(
      args.kind,
      args.withdrawAll ? snapshot.supplied : args.amount,
      snapshot,
      Date.now(),
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
    const now = Date.now();
    const quote: LendingQuote = {
      version: 1,
      provider: "aave_v3",
      kind: args.kind,
      chainId: safe.chainId,
      account: safe.safeAddress as Address,
      reference: keccak256(toHex(`${args.orgId}:${args.requestId}`)),
      amount: args.withdrawAll ? snapshot.supplied : args.amount,
      rateRay: snapshot.rateRay,
      price: snapshot.price,
      priceUnit: snapshot.priceUnit,
      createdAt: now,
      expiresAt: now + LENDING_QUOTE_LIFETIME,
    };
    if (args.withdrawAll) quote.withdrawAll = true;
    return ctx.runMutation(internal.treasuryServices.save, {
      ...args,
      quote: JSON.stringify(quote),
    });
  },
});
export const verify = internalAction({
  args: {
    treasuryServiceId: v.id("treasuryServices"),
    sessionToken: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ to: Address; data: Hex; operation: 1 }> => {
    const { quote } = await ctx.runQuery(
      internal.treasuryServices.context,
      args,
    );
    await verifyLendingFunding(quote);
    return lendingCall(quote);
  },
});
