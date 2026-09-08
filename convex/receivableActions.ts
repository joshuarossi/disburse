"use node";
import { readSettlementBlock } from './lib/settlementBlock';
import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import {
  parseAbiItem,
  type Address,
} from "viem";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertSafeIdentity } from "./lib/safeIdentity";
import { invoiceTestnet as testnet, verifyInvoiceFactory as verifyFactory } from "./lib/receivableVerification";
import {
  forwarderFactory,
  invoiceSalt,
  invoiceAddress,
  RECEIVING_FACTORY_ADDRESS,
} from "../shared/receivableAddress";
const transfer = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const identity = { invoiceId: v.id("receivables"), sessionToken: v.string() };
export const issue = action({
  args: identity,
  handler: async (ctx, args): Promise<string> => {
    const i = await ctx.runQuery(api.receivables.forOperation, {
      ...args,
    });
    if (i.state === "issued") return i.publicToken!;
    if (i.state !== "draft") throw new Error("Only a draft can be issued.");
    if (!testnet(i.chainId) && process.env.AR_MAINNET_ENABLED !== "true")
      throw new Error(
        "Receiving invoices on production networks is not enabled yet. Choose a test account.",
      );
    const factory = process.env[`AR_FACTORY_${i.chainId}`] ?? RECEIVING_FACTORY_ADDRESS;
    const client = await verifyFactory(i.chainId, factory);
    const block = await client.getBlockNumber();
    await assertSafeIdentity(client, i.treasury as Address, i.chainId, block);
    const salt = invoiceSalt(i.orgId, i._id, i.chainId);
    const address = invoiceAddress(
      factory as Address,
      i.treasury as Address,
      salt,
    );
    const predicted = await client.readContract({
      address: factory as Address,
      abi: forwarderFactory.abi,
      functionName: "predict",
      args: [i.treasury as Address, salt],
    });
    if (predicted.toLowerCase() !== address.toLowerCase())
      throw new Error("Invoice address verification failed.");
    const token = await ctx.runMutation(internal.receivables.publish, {
      ...args,
      expectedUpdatedAt: i.updatedAt,
      expectedRevision: i.revision ?? 0,
      factory: factory.toLowerCase(),
      salt,
      receivingAddress: address.toLowerCase(),
      publicToken: randomBytes(32).toString("hex"),
      startBlock: block.toString(),
    });
    await ctx.scheduler.runAfter(0, internal.receivableActions.scan, {
      invoiceId: i._id,
    });
    return token;
  },
});
export const refresh = action({
  args: identity,
  handler: async (ctx, args): Promise<void> => {
    await ctx.runQuery(api.receivables.get, args);
    await scanInvoice(ctx, args.invoiceId);
  },
});
async function scanInvoice(ctx: ActionCtx, invoiceId: Id<"receivables">) {
  const i = await ctx.runQuery(internal.receivables.getInternal, { invoiceId });
  if (!i?.receivingAddress || !i.factory || !i.scanFromBlock) return;
  try {
    const client = await verifyFactory(i.chainId, i.factory);
    // Production uses the chain's finalized block; Sepolia acceptance uses two confirmations.
    const head = testnet(i.chainId)
      ? (await client.getBlockNumber()) - 1n
      : (await client.getBlock({ blockTag: "finalized" })).number;
    const from = BigInt(i.scanFromBlock);
    if (head < from) {
      await ctx.runMutation(internal.receivables.noteError, { invoiceId });
      return;
    }
    const to = head < from + 1999n ? head : from + 1999n;
    const [incoming, outgoing] = await Promise.all([
      client.getLogs({
        address: i.tokenAddress as Address,
        event: transfer,
        args: { to: i.receivingAddress as Address },
        fromBlock: from,
        toBlock: to,
        strict: true,
      }),
      client.getLogs({
        address: i.tokenAddress as Address,
        event: transfer,
        args: {
          from: i.receivingAddress as Address,
          to: i.treasury as Address,
        },
        fromBlock: from,
        toBlock: to,
        strict: true,
      }),
    ]);
    const logs = [
      ...incoming.map((log) => ({ log, kind: "received" as const })),
      ...outgoing.map((log) => ({ log, kind: "forwarded" as const })),
    ]
      .filter(
        ({ log, kind }) =>
          !log.removed &&
          log.args.value > 0n &&
          log.address.toLowerCase() === i.tokenAddress &&
          log.blockNumber >= from &&
          log.blockNumber <= to &&
          (kind === "received"
            ? log.args.to.toLowerCase() === i.receivingAddress
            : log.args.from.toLowerCase() === i.receivingAddress &&
              log.args.to.toLowerCase() === i.treasury),
      );
    // Cache one verified timestamp per block, with bounded RPC concurrency.
    const blocks = new Map<string, { blockNumber: bigint; blockHash: `0x${string}` }>();
    for (const { log } of logs) blocks.set(`${log.blockNumber}:${log.blockHash}`, { blockNumber: log.blockNumber, blockHash: log.blockHash });
    const timestamps = new Map<string, number>();
    const pending = [...blocks.entries()];
    for (let offset = 0; offset < pending.length; offset += 4) {
      await Promise.all(pending.slice(offset, offset + 4).map(async ([key, block]) => {
        timestamps.set(key, (await readSettlementBlock(client, i.chainId, block)).timestamp);
      }));
    }
    const events = logs.map(({ log, kind }) => ({
        key: `${i.chainId}:${log.transactionHash}:${log.logIndex}`,
        kind,
        amount: log.args.value.toString(),
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: String(log.blockNumber),
        blockHash: log.blockHash,
        settledAt: timestamps.get(`${log.blockNumber}:${log.blockHash}`)!,
        fromAddress: log.args.from.toLowerCase(),
        toAddress: log.args.to.toLowerCase(),
      }));
    await ctx.runMutation(internal.receivables.recordScan, {
      invoiceId,
      fromBlock: String(from),
      nextBlock: String(to + 1n),
      events,
    });
    if (to < head)
      await ctx.scheduler.runAfter(1000, internal.receivableActions.scan, {
        invoiceId,
      });
  } catch {
    await ctx.runMutation(internal.receivables.noteError, {
      invoiceId,
      error:
        "Could not refresh payment receipts. The last confirmed amounts are shown; retry or check again shortly.",
    });
  }
}
export const scan = internalAction({
  args: { invoiceId: v.id("receivables") },
  handler: async (ctx, args): Promise<void> => scanInvoice(ctx, args.invoiceId),
});
