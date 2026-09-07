import { v } from "convex/values";
import { parseAbi, type Address } from "viem";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getChainClient } from "./lib/safeVerification";
import { assertSafeIdentity } from "./lib/safeIdentity";

export const process = internalAction({
  args: { disbursementId: v.id("disbursements"), attempt: v.number() },
  handler: async (ctx, args) => {
    const source = await ctx.runQuery(internal.paymentFollowups.context, args);
    if (!source) return;
    let owners: string[] = [],
      ownershipBlock: string | undefined,
      ownershipError: string | undefined;
    if (source.decision.phase) {
      try {
        if (
          !source.safe ||
          source.safe.isActive === false ||
          source.safe.chainId !== source.payment.chainId
        )
          throw new Error("Account unavailable");
        const client = getChainClient(source.safe.chainId);
        const blockNumber = await client.getBlockNumber();
        const address = source.safe.safeAddress as Address;
        await assertSafeIdentity(
          client,
          address,
          source.safe.chainId,
          blockNumber,
        );
        owners = [
          ...(await client.readContract({
            address,
            abi: parseAbi(["function getOwners() view returns (address[])"]),
            functionName: "getOwners",
            blockNumber,
          })),
        ];
        if (!owners.length) throw new Error("Account approvers unavailable");
        ownershipBlock = String(blockNumber);
      } catch {
        ownershipError =
          "Account approvers could not be verified. Workspace administrators can review this reminder; approver checks will retry.";
      }
    }
    await ctx.runMutation(internal.paymentFollowups.record, {
      ...args,
      inputKey: source.inputKey,
      phase: source.decision.phase,
      owners,
      ownershipBlock,
      ownershipError,
    });
  },
});
