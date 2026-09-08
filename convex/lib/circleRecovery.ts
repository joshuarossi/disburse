import type { CircleRequest } from "../../shared/circleRequest";
import { circleRpc } from "../../shared/circleTransport";
import { circleOperationHash } from "../../shared/circleExecution";
import { readCircleSettlement } from "../../shared/circleSettlement";
import { readSettlementBlock } from "./settlementBlock";
import type { getChainClient } from "./safeVerification";
import type { Hex } from "viem";

/** A public bundler receipt is only a search hint. The RPC receipt and canonical
 * block must prove the exact operation, fee transfers and confirmation depth. */
export async function circleReceiptHint(
  client: ReturnType<typeof getChainClient>,
  request: CircleRequest,
  confirmed: bigint,
) {
  try {
    const hint = await circleRpc(
      request.chainId,
      "eth_getUserOperationReceipt",
      [circleOperationHash(request.chainId, request.operation)],
    );
    const candidate =
      hint && typeof hint === "object" && "receipt" in hint
        ? hint.receipt
        : null;
    const hash =
      candidate &&
      typeof candidate === "object" &&
      "transactionHash" in candidate
        ? candidate.transactionHash
        : null;
    if (typeof hash !== "string" || !/^0x[\da-f]{64}$/i.test(hash)) return null;
    const receipt = await client.getTransactionReceipt({ hash: hash as Hex });
    if (
      receipt.blockNumber > confirmed ||
      receipt.blockNumber < BigInt(request.startBlock)
    )
      return null;
    const settlement = await readSettlementBlock(
      client,
      request.chainId,
      receipt,
    );
    if (
      settlement.timestamp < request.validAfter * 1000 ||
      settlement.timestamp > request.validUntil * 1000
    )
      return null;
    readCircleSettlement(request.chainId, request.operation, receipt);
    return receipt;
  } catch {
    return null;
  }
}

/** The account contract rejects execution before validAfter. Start immediately
 * before that time, rather than scanning weeks when execution was impossible. */
export async function scheduledScanStart(
  client: Pick<ReturnType<typeof getChainClient>, "getBlock">,
  start: bigint,
  confirmed: bigint,
  validAfter: number,
) {
  if (!validAfter || start >= confirmed) return start;
  let low = start,
    high = confirmed;
  const first = await client.getBlock({ blockNumber: start });
  if (first.number !== start || !first.hash)
    throw new Error("The network supplied inconsistent block evidence.");
  if (Number(first.timestamp) >= validAfter) return start;
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: middle });
    if (block.number !== middle || !block.hash)
      throw new Error("The network supplied inconsistent block evidence.");
    if (Number(block.timestamp) < validAfter) low = middle;
    else high = middle;
  }
  return low;
}
