import { ConvexError, v } from "convex/values";
import { parseAbiItem } from "viem";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { billingCheckoutCall } from "./lib/billingCheckout";
import { billingClient, verifyBillingReceipt } from "./lib/billingReceipt";
import { isValidTxHash } from "../shared/validation";

export const begin = action({
  args: { checkoutId: v.id("billingCheckouts"), sessionToken: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    to: string;
    data: string;
    value: string;
    chainId: number;
    payer: string;
    nonce: number;
    attemptId: string;
  }> => {
    const checkout = await ctx.runQuery(internal.billingCheckoutData.context, {
      ...args,
      sender: true,
    });
    if (checkout.status !== "prepared" || !checkout.active)
      throw new Error(
        "Check the original wallet request before sending another payment",
      );
    const client = billingClient(checkout.chainId);
    if ((await client.getChainId()) !== checkout.chainId)
      throw new Error("Billing RPC network mismatch");
    const call = billingCheckoutCall(checkout);
    await client.estimateGas({
      account: checkout.payer as `0x${string}`,
      to: call.to as `0x${string}`,
      data: call.data,
      value: 0n,
    });
    const [block, nonce] = await Promise.all([
      client.getBlockNumber(),
      client.getTransactionCount({
        address: checkout.payer as `0x${string}`,
        blockTag: "pending",
      }),
    ]);
    return ctx.runMutation(internal.billingCheckoutData.claim, {
      ...args,
      nonce,
      fromBlock: String(block > 12n ? block - 12n : 0n),
      attemptId: crypto.randomUUID(),
    });
  },
});

async function settle(
  ctx: ActionCtx,
  checkout: Doc<"billingCheckouts">,
  hash: string,
): Promise<"applied" | "reverted"> {
  if (!isValidTxHash(hash)) throw new Error("Invalid transaction hash");
  if (checkout.nonce === undefined)
    throw new Error("This checkout has not requested a wallet payment");
  const call = billingCheckoutCall(checkout);
  try {
    const verified = await verifyBillingReceipt({
      ...checkout,
      txHash: hash,
      allowedPayers: [checkout.payer],
      call: { ...call, payer: checkout.payer, nonce: checkout.nonce },
    });
    await ctx.runMutation(internal.billing.recordVerifiedPayment, {
      checkoutId: checkout._id,
      orgId: checkout.orgId,
      txHash: hash.toLowerCase(),
      chainId: checkout.chainId,
      plan: checkout.plan,
      tokenAddress: checkout.tokenAddress,
      amountRaw: verified.amountRaw,
    });
    await ctx.runMutation(internal.billing.redeemCheckout, {
      checkoutId: checkout._id,
    });
    return "applied";
  } catch (error) {
    if (
      error instanceof ConvexError &&
      error.data?.code === "BILLING_PAYMENT_REVERTED"
    ) {
      await ctx.runMutation(internal.billingCheckoutData.checkpoint, {
        checkoutId: checkout._id,
        outcome: "reverted",
        txHash: hash.toLowerCase(),
        error:
          "The original transaction reverted. No subscription payment was collected.",
      });
      return "reverted";
    }
    throw error;
  }
}

async function check(
  ctx: ActionCtx,
  checkout: Doc<"billingCheckouts">,
): Promise<string> {
  if (!checkout.active || checkout.status === "prepared")
    return checkout.status;
  if (checkout.txHash) return settle(ctx, checkout, checkout.txHash);
  if (checkout.fromBlock === undefined || checkout.nonce === undefined)
    throw new Error("Checkout is missing its recovery checkpoint");
  const client = billingClient(checkout.chainId);
  if ((await client.getChainId()) !== checkout.chainId)
    throw new Error("Billing RPC network mismatch");
  const latest = await client.getBlockNumber(),
    from = BigInt(checkout.fromBlock);
  if (latest <= from) {
    await ctx.runMutation(internal.billingCheckoutData.checkpoint, {
      checkoutId: checkout._id,
    });
    return "requested";
  }
  const to = latest - 1n < from + 1999n ? latest - 1n : from + 1999n;
  const logs = await client.getLogs({
    address: checkout.tokenAddress as `0x${string}`,
    event: parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)",
    ),
    args: {
      from: checkout.payer as `0x${string}`,
      to: checkout.treasury as `0x${string}`,
    },
    fromBlock: from,
    toBlock: to,
  });
  const hashes = new Set(
    logs
      .filter((log) => log.args.value === BigInt(checkout.amountRaw))
      .map((log) => log.transactionHash),
  );
  for (const hash of hashes) {
    try {
      return await settle(ctx, checkout, hash);
    } catch (error) {
      // Other payments by this wallet cannot settle this request's nonce.
      if (
        !(error instanceof Error) ||
        !error.message.includes(
          "does not match the original subscription request",
        )
      )
        throw error;
    }
  }
  await ctx.runMutation(internal.billingCheckoutData.checkpoint, {
    checkoutId: checkout._id,
    fromBlock: String(to > 12n && to - 12n > from ? to - 12n : from),
    error:
      checkout.checks >= 119
        ? "The original request still needs verification. Check its receipt or a confirmed replacement from your wallet activity."
        : undefined,
  });
  return "requested";
}

export const verify = action({
  args: {
    checkoutId: v.id("billingCheckouts"),
    sessionToken: v.string(),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const checkout = await ctx.runQuery(internal.billingCheckoutData.context, {
      checkoutId: args.checkoutId,
      sessionToken: args.sessionToken,
    });
    if (!checkout.active) {
      if (args.txHash && checkout.txHash !== args.txHash.toLowerCase())
        throw new Error("This checkout settled with a different receipt");
      return { status: checkout.status };
    }
    await ctx.runMutation(internal.billingCheckoutData.checkpoint, {
      checkoutId: checkout._id,
      reset: true,
    });
    return {
      status: args.txHash
        ? await settle(ctx, checkout, args.txHash)
        : await check(ctx, checkout),
    };
  },
});

export const verifyReplacement = action({
  args: {
    checkoutId: v.id("billingCheckouts"),
    sessionToken: v.string(),
    txHash: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const checkout = await ctx.runQuery(internal.billingCheckoutData.context, {
      checkoutId: args.checkoutId,
      sessionToken: args.sessionToken,
    });
    if (!checkout.active || checkout.nonce === undefined)
      throw new Error("There is no unresolved wallet request");
    if (!isValidTxHash(args.txHash))
      throw new Error("Invalid transaction hash");
    const client = billingClient(checkout.chainId);
    if ((await client.getChainId()) !== checkout.chainId)
      throw new Error("Billing RPC network mismatch");
    const hash = args.txHash as `0x${string}`;
    const [transaction, receipt, latest] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
      client.getBlockNumber(),
    ]);
    if (
      transaction.from.toLowerCase() !== checkout.payer ||
      transaction.nonce !== checkout.nonce ||
      latest < receipt.blockNumber + 1n
    )
      throw new Error(
        "The replacement must consume the original wallet transaction number and have two confirmations",
      );
    const call = billingCheckoutCall(checkout);
    if (
      transaction.to?.toLowerCase() === call.to.toLowerCase() &&
      transaction.input.toLowerCase() === call.data.toLowerCase() &&
      transaction.value === 0n
    )
      return { status: await settle(ctx, checkout, hash) };
    await ctx.runMutation(internal.billingCheckoutData.checkpoint, {
      checkoutId: checkout._id,
      outcome: "cancelled",
      txHash: hash.toLowerCase(),
      error:
        "A confirmed replacement consumed the original wallet transaction number.",
    });
    return { status: "cancelled" };
  },
});

export const reconcile = internalAction({
  args: { checkoutId: v.id("billingCheckouts") },
  handler: async (ctx, args): Promise<void> => {
    const checkout = await ctx.runQuery(
      internal.billingCheckoutData.context,
      args,
    );
    try {
      await check(ctx, checkout);
    } catch (error) {
      await ctx.runMutation(internal.billingCheckoutData.checkpoint, {
        checkoutId: checkout._id,
        error:
          error instanceof Error
            ? error.message
            : "Could not verify the original subscription payment",
      });
    }
  },
});
