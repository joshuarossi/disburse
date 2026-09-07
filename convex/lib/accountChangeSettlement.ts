import type { ExecutionFee } from "../../shared/executionFee";
import { matchesAccountExecution } from "../../shared/accountExecution";
import { assertReceiptConfirmations } from "../../shared/confirmations";
import { accountChangeReceiptOutcome } from "./accountChange";
import { readSettlementBlock } from "./settlementBlock";
import { getChainClient } from "./safeVerification";

/** Shared bounded settlement reader. Neither a provider outage nor a missing
 * response creates a second submission. Callers own their domain state changes. */
export async function readAccountChangeSettlement(input: {
  chainId: number;
  safeAddress: string;
  safeTxHash: string;
  executionFee?: ExecutionFee;
  searchFromBlock: string;
  txHash?: string;
  data?: string;
  originalHash?: string;
}) {
  const client = getChainClient(input.chainId);
  let txHash = input.txHash,
    searchFromBlock = input.searchFromBlock;
  if (!txHash || input.originalHash) {
    const head = await client.getBlockNumber(),
      confirmed = head > 1n ? head - 1n : 0n;
    const fromBlock = BigInt(searchFromBlock),
      toBlock = confirmed < fromBlock + 1999n ? confirmed : fromBlock + 1999n;
    if (fromBlock <= toBlock) {
      const logs = await client.getLogs({
        address: input.safeAddress as `0x${string}`,
        fromBlock,
        toBlock,
      });
      txHash ??=
        logs.find((log) => matchesAccountExecution(log, input.safeTxHash))
          ?.transactionHash ?? undefined;
      const original = input.originalHash
        ? logs.find((log) => matchesAccountExecution(log, input.originalHash!))
        : undefined;
      if (original?.transactionHash)
        return { searchFromBlock, originalTxHash: original.transactionHash };
      if (!txHash) searchFromBlock = String(toBlock > 12n ? toBlock - 12n : 0n);
    }
  }
  if (!txHash) return { searchFromBlock };
  const receipt = await client.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  });
  assertReceiptConfirmations(
    receipt.blockNumber,
    await client.getBlockNumber(),
  );
  if (receipt.status !== "success") {
    const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
    if (
      !input.data ||
      tx.to?.toLowerCase() !== input.safeAddress.toLowerCase() ||
      tx.input.toLowerCase() !== input.data.toLowerCase() ||
      tx.value !== 0n
    )
      throw new Error("Receipt belongs to another account transaction");
  }
  const outcome = accountChangeReceiptOutcome(receipt, input);
  const settlement = await readSettlementBlock(client, input.chainId, receipt);
  return { searchFromBlock, txHash, outcome, settlement };
}
