import { encodeFunctionData, erc20Abi } from "viem";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export function billingCheckoutCall(
  checkout: Pick<
    Doc<"billingCheckouts">,
    "treasury" | "tokenAddress" | "amountRaw"
  >,
) {
  return {
    to: checkout.tokenAddress,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [checkout.treasury as `0x${string}`, BigInt(checkout.amountRaw)],
    }),
    value: "0",
  };
}

export async function finishBillingCheckout(
  ctx: MutationCtx,
  payment: Doc<"billingPayments">,
) {
  if (!payment.checkoutId) return;
  const checkout = await ctx.db.get(payment.checkoutId);
  if (
    !checkout ||
    checkout.orgId !== payment.orgId ||
    checkout.plan !== payment.plan ||
    checkout.chainId !== payment.chainId ||
    checkout.tokenAddress.toLowerCase() !==
      payment.tokenAddress.toLowerCase() ||
    checkout.txHash?.toLowerCase() !== payment.txHash.toLowerCase()
  )
    throw new Error(
      "Subscription checkout does not match its verified payment",
    );
  await ctx.db.patch(checkout._id, {
    status: "applied",
    active: false,
    error: undefined,
    recoveryAt: undefined,
    updatedAt: Date.now(),
  });
}
