import { assertValidTxHash } from "./validation";

type Submission = {
  txHash?: string;
  providerId?: string;
  searchFromBlock: string;
  checks: number;
};
type Checkpoint = {
  txHash?: string;
  providerId?: string;
  searchFromBlock?: string;
};

/** Policies and cancellations share submission identity and monotonic recovery,
 * while retaining their different authorization and settlement side effects. */
export function accountChangeProgress(
  previous: Submission,
  update: Checkpoint,
) {
  if (
    (previous.txHash &&
      update.txHash &&
      previous.txHash.toLowerCase() !== update.txHash.toLowerCase()) ||
    (previous.providerId &&
      update.providerId &&
      previous.providerId !== update.providerId)
  )
    throw new Error("The original submission cannot be replaced");
  if (update.txHash) assertValidTxHash(update.txHash);
  return {
    txHash: previous.txHash ?? update.txHash,
    providerId: previous.providerId ?? update.providerId,
    searchFromBlock:
      update.searchFromBlock &&
      BigInt(update.searchFromBlock) > BigInt(previous.searchFromBlock)
        ? update.searchFromBlock
        : previous.searchFromBlock,
    checks: previous.checks + 1,
  };
}
