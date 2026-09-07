import { v } from "convex/values";

export const delegatedIntentValidator = v.object({
  chainId: v.number(),
  safeAddress: v.string(),
  module: v.string(),
  delegate: v.string(),
  nonce: v.number(),
  hash: v.string(),
  signature: v.string(),
  additionalTransfers: v.optional(
    v.array(
      v.object({
        recipientAddress: v.string(),
        amount: v.string(),
        nonce: v.number(),
        hash: v.string(),
        signature: v.string(),
      }),
    ),
  ),
  feeAuthorization: v.optional(
    v.object({
      token: v.string(),
      tokenAddress: v.string(),
      collector: v.string(),
      amount: v.string(),
      nonce: v.number(),
      hash: v.string(),
      signature: v.string(),
    }),
  ),
  tokenAddress: v.string(),
  recipientAddress: v.string(),
  amount: v.string(),
});
