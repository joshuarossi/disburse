import { ConvexError } from "convex/values";
import { createPublicClient, http } from "viem";
import { RPC_URL_BY_CHAIN } from "./billingConfiguration";

export function billingClient(chainId: number) {
  const url = process.env[`RPC_URL_${chainId}`] ?? RPC_URL_BY_CHAIN[chainId];
  if (!url) throw new Error("Unsupported billing network");
  return createPublicClient({
    transport: http(url, { timeout: 15_000, retryCount: 2 }),
  });
}

export async function verifyBillingReceipt(args: {
  chainId: number;
  tokenAddress: string;
  treasury: string;
  amountRaw: string;
  txHash: string;
  allowedPayers: string[];
  maxAgeDays?: number;
  call?: { to: string; data: string; payer: string; nonce: number };
}) {
  const client = billingClient(args.chainId);
  if ((await client.getChainId()) !== args.chainId)
    throw new Error("Billing RPC network mismatch");
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({
      hash: args.txHash as `0x${string}`,
    });
  } catch {
    throw new Error(
      "Transaction not found or not yet confirmed. Try again after it is mined.",
    );
  }
  if ((await client.getBlockNumber()) < receipt.blockNumber + 1n)
    throw new Error(
      "Wait for two network confirmations before verifying payment",
    );
  if (args.call) {
    const transaction = await client.getTransaction({
      hash: args.txHash as `0x${string}`,
    });
    if (
      transaction.from.toLowerCase() !== args.call.payer.toLowerCase() ||
      transaction.to?.toLowerCase() !== args.call.to.toLowerCase() ||
      transaction.input.toLowerCase() !== args.call.data.toLowerCase() ||
      transaction.nonce !== args.call.nonce ||
      transaction.value !== 0n
    )
      throw new Error(
        "Receipt does not match the original subscription request",
      );
  }
  if (receipt.status !== "success")
    throw new ConvexError({
      code: "BILLING_PAYMENT_REVERTED",
      txHash: args.txHash.toLowerCase(),
      message:
        "Payment transaction reverted. No subscription payment was collected. You can try again.",
    });
  if (args.maxAgeDays !== undefined) {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (Date.now() / 1000 - Number(block.timestamp) > args.maxAgeDays * 86400)
      throw new Error(
        `Payment transaction is older than ${args.maxAgeDays} days`,
      );
  }
  const allowed = new Set(args.allowedPayers.map((a) => a.toLowerCase()));
  const recipient = `0x${args.treasury.slice(2).toLowerCase().padStart(64, "0")}`;
  let amount = 0n;
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== args.tokenAddress.toLowerCase() ||
      log.topics[0] !==
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" ||
      log.topics[2]?.toLowerCase() !== recipient ||
      !allowed.has(`0x${(log.topics[1] ?? "").slice(-40).toLowerCase()}`)
    )
      continue;
    amount += BigInt(log.data);
  }
  if (
    amount < BigInt(args.amountRaw) ||
    (args.call && amount !== BigInt(args.amountRaw))
  )
    throw new Error(
      `Payment insufficient or unexpected: received ${amount} base units, required ${args.amountRaw}`,
    );
  return { amountRaw: amount.toString(), receipt };
}
