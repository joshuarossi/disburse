import { v } from "convex/values";
const movement = v.object({ logIndex: v.number(), amountRaw: v.string() });
export const circleFeeProofValidator = v.object({
  prefund: movement,
  refund: v.optional(movement),
});
