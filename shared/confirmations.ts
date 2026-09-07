/** Minimum mined confirmation depth; this is not a guarantee against a chain reorg. */
export function assertReceiptConfirmations(receiptBlock: bigint, latestBlock: bigint) {
  if (latestBlock < receiptBlock + 1n)
    throw new Error("Waiting for two network confirmations before marking this payment paid.");
}
