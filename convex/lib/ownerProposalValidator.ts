import { v } from "convex/values";
export const ownerProposalValidator = v.object({
  safeAddress: v.string(),
  safeTxHash: v.string(),
  senderAddress: v.string(),
  senderSignature: v.string(),
  safeTransactionData: v.object({
    to: v.string(),
    value: v.string(),
    data: v.string(),
    operation: v.union(v.literal(0), v.literal(1)),
    safeTxGas: v.string(),
    baseGas: v.string(),
    gasPrice: v.string(),
    gasToken: v.string(),
    refundReceiver: v.string(),
    nonce: v.number(),
  }),
});
