import { getAbiItem, type Hex } from "viem";
import {
  assertCctpDelivery,
  cctpAbi,
  cctpConfiguration,
  type CctpQuote,
} from "../../shared/cctp";
import type { getChainClient } from "./safeVerification";
import { readSettlementBlock } from "./settlementBlock";

type DeliveryClient = Pick<
  ReturnType<typeof getChainClient>,
  "getBlock" | "getBlockNumber" | "getLogs"
>;

export async function readCctpDeliveryReceipt(
  client: Pick<
    ReturnType<typeof getChainClient>,
    "getTransactionReceipt" | "getBlockNumber" | "getBlock" | "getChainId"
  >,
  quote: CctpQuote,
  hash: Hex,
) {
  // RPC failures must propagate. A scan must never advance past a receipt it
  // could not read, even if getLogs had already returned the corresponding mint.
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") return null;
  if ((await client.getBlockNumber()) < receipt.blockNumber + 2n)
    throw new Error("The receiving receipt is still confirming.");
  let proof;
  try {
    proof = assertCctpDelivery(quote, receipt.logs);
  } catch {
    return null;
  } // A different mint in this company account.
  const settlement = await readSettlementBlock(
    client,
    quote.destinationChainId,
    receipt,
  );
  return { proof, settlement };
}

/** A provider may omit its receipt hash, or another relayer may finish the mint.
 * Read bounded, overlapping ranges of the company's canonical mint events.
 * Candidates still need full receipt verification before changing any balance. */
export async function scanCctpDelivery(
  client: DeliveryClient,
  quote: CctpQuote,
  cursor?: string,
) {
  const head = await client.getBlockNumber();
  if (head < 2n) throw new Error("The receiving network is not ready.");
  const confirmed = head - 2n;
  let from: bigint;
  if (cursor) {
    if (!/^\d{1,30}$/.test(cursor))
      throw new Error("The delivery checkpoint is invalid.");
    from = BigInt(cursor) > 2n ? BigInt(cursor) - 2n : 0n;
  } else {
    // Bootstrap old/in-flight records once. New quotes save a destination block.
    const cutoff = BigInt(
      Math.max(0, Math.floor(quote.createdAt / 1000) - 300),
    );
    let lo = 0n,
      hi = confirmed;
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      const block = await client.getBlock({ blockNumber: mid });
      if (block.timestamp <= cutoff) lo = mid;
      else hi = mid - 1n;
    }
    from = lo;
  }
  if (from > confirmed)
    return { hashes: [] as Hex[], nextBlock: String(from), more: false };
  const end = from + 999n < confirmed ? from + 999n : confirmed;
  const logs = await client.getLogs({
    address: cctpConfiguration(quote.destinationChainId).messenger,
    event: getAbiItem({ abi: cctpAbi, name: "MintAndWithdraw" }),
    args: { mintRecipient: quote.destination },
    fromBlock: from,
    toBlock: end,
    strict: true,
  });
  const hashes = [
    ...new Set(
      logs.filter((log) => !log.removed).map((log) => log.transactionHash),
    ),
  ];
  if (hashes.length > 20)
    throw new Error(
      "This account has more receiving activity than can be checked at once. Add the receiving transaction hash to verify this transfer.",
    );
  return { hashes, nextBlock: String(end + 1n), more: end < confirmed };
}
