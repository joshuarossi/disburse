import { v } from "convex/values";
import { erc20Abi, isAddress, keccak256, type Address, type Hex } from "viem";
import { action, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { readReceivingSource } from "./lib/circleReceivables";
import { readCircleSource } from "./lib/circleSource";
import { getChainClient } from "./lib/safeVerification";
import {
  invoiceAddress,
  forwarderFactory,
  RECEIVING_DEPLOYER,
  RECEIVING_FACTORY_ADDRESS,
} from "../shared/receivableAddress";
import { verifyInvoiceFactory } from "./lib/receivableVerification";
import { supportsCircleFees } from "../shared/circleExecution";

const source = {
  receivableId: v.optional(v.id("receivables")),
  receivingSetupSafeId: v.optional(v.id("safes")),
  sessionToken: v.string(),
};
export const context = internalQuery({
  args: { ...source, readOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const data = await readCircleSource(
      ctx,
      args,
      args.sessionToken,
      !args.readOnly,
    );
    const invoice = args.receivableId
      ? await ctx.db.get(args.receivableId)
      : null;
    return {
      ...data,
      invoice,
      call: (
        await readReceivingSource(ctx, args, args.sessionToken, !args.readOnly)
      ).call,
    };
  },
});
export const verify = internalAction({
  args: source,
  handler: async (ctx, args): Promise<{ to: string; data: string }> => {
    const data = await ctx.runQuery(internal.receivableServices.context, args),
      chainId = data.safe.chainId;
    if (!supportsCircleFees(chainId))
      throw new Error(
        "Receiving with USDC execution fees is not available on this network",
      );
    if (data.invoice) {
      const i = data.invoice;
      const client = await verifyInvoiceFactory(chainId, i.factory!);
      if (
        invoiceAddress(
          i.factory as Address,
          i.treasury as Address,
          i.salt as Hex,
        ).toLowerCase() !== i.receivingAddress?.toLowerCase()
      )
        throw new Error("The invoice receiving address could not be verified");
      if (
        (await client.readContract({
          address: i.tokenAddress as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [i.receivingAddress as Address],
        })) === 0n
      )
        throw new Error(
          "There are no funds waiting at this invoice address. Refresh its payments.",
        );
    } else {
      const configured = process.env[`AR_FACTORY_${chainId}`];
      if (
        configured &&
        configured.toLowerCase() !== RECEIVING_FACTORY_ADDRESS.toLowerCase()
      )
        throw new Error(
          "This network uses a separately configured receiving service. Its setup must be verified before issuing invoices.",
        );
      const client = getChainClient(chainId);
      if ((await client.getChainId()) !== chainId)
        throw new Error("The receiving network could not be verified");
      const code = await client.getCode({ address: RECEIVING_FACTORY_ADDRESS });
      if (code && code !== "0x") {
        if (keccak256(code) !== keccak256(forwarderFactory.deployedBytecode))
          throw new Error(
            "The receiving service contract could not be verified",
          );
        throw new Error(
          "Receiving setup is already complete. Refresh the invoice to continue.",
        );
      }
      const deployer = await client.getCode({ address: RECEIVING_DEPLOYER });
      // Arachnid's immutable deterministic deployment proxy, published by Safe
      // and used by its own released deployments. No configurable call target.
      if (
        deployer !==
        "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3"
      )
        throw new Error("The network deployment service could not be verified");
    }
    return data.call;
  },
});
export const status = action({
  args: { safeId: v.id("safes"), sessionToken: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ready: boolean; supported: boolean; factory: string }> => {
    const data = await ctx.runQuery(internal.receivableServices.context, {
      receivingSetupSafeId: args.safeId,
      sessionToken: args.sessionToken,
      readOnly: true,
    });
    const factory =
      process.env[`AR_FACTORY_${data.safe.chainId}`] ??
      RECEIVING_FACTORY_ADDRESS;
    if (!supportsCircleFees(data.safe.chainId))
      return { supported: false, ready: false, factory };
    if (!isAddress(factory))
      throw new Error("The receiving service is not configured correctly");
    const client = getChainClient(data.safe.chainId);
    if ((await client.getChainId()) !== data.safe.chainId)
      throw new Error("The receiving network could not be verified");
    const code = await client.getCode({ address: factory });
    if (
      (!code || code === "0x") &&
      factory.toLowerCase() !== RECEIVING_FACTORY_ADDRESS.toLowerCase()
    )
      throw new Error(
        "The configured receiving service is not deployed on this network. Check its configuration before issuing invoices.",
      );
    if (
      code &&
      code !== "0x" &&
      keccak256(code) !== keccak256(forwarderFactory.deployedBytecode)
    )
      throw new Error("The receiving service contract could not be verified");
    return { ready: !!code && code !== "0x", supported: true, factory };
  },
});
