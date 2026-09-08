import { keccak256, stringToHex, type Hex } from "viem";
import type { CircleRequest } from "./circleRequest";

export const MAX_OPEN_CIRCLE_REQUESTS = 50;
export const DEFAULT_CIRCLE_FEE_LIMIT = 2_000_000n;

/** EntryPoint's upper 192 nonce bits identify an independent sequence. Each
 * reviewed execution gets its own sequence, so a future send cannot reserve
 * the nonce used by a subscription, invoice collection or another payment. */
export function circleNonceKey(originalHash: Hex, requestId: string): bigint {
  if (
    !/^0x[\da-f]{64}$/i.test(originalHash) ||
    !/^[\da-f-]{36}$/i.test(requestId)
  )
    throw new Error("The execution request identifier is invalid.");
  return (
    BigInt(
      keccak256(
        stringToHex(
          `disburse:execution:${originalHash.toLowerCase()}:${requestId.toLowerCase()}`,
        ),
      ),
    ) >> 64n
  );
}

export type QueuedCircleRequest = {
  concurrentFees?: boolean;
  request: CircleRequest;
};

/** Circle tolerates already-used permits. A later, larger allowance must not
 * increase the amount an earlier signed operation can spend. All open requests
 * therefore share the same ceiling. Each actual charge is still reconciled
 * separately, and every operation has its own signed gas limits. */
export function circleQueueLimit(
  open: QueuedCircleRequest[],
): bigint | undefined {
  if (
    new Set(open.map((e) => String(e.request.operation.nonce >> 64n))).size >=
      MAX_OPEN_CIRCLE_REQUESTS ||
    open.length > MAX_OPEN_CIRCLE_REQUESTS * 2
  )
    throw new Error(
      "This account has 50 open execution requests. Complete or check an earlier request before preparing another.",
    );
  if (!open.length) return undefined;
  if (
    open.some(
      (e) => !e.concurrentFees || e.request.operation.nonce >> 64n === 0n,
    )
  )
    throw new Error(
      "Complete or check the earlier fee request before preparing another execution for this account.",
    );
  const limit = BigInt(open[0].request.permit.amount);
  if (open.some((e) => BigInt(e.request.permit.amount) !== limit))
    throw new Error(
      "The saved execution fee limits disagree. Check the original requests before continuing.",
    );
  return limit;
}

export function assertCircleQueueCompatible(
  request: CircleRequest,
  open: QueuedCircleRequest[],
) {
  const limit = circleQueueLimit(open);
  if (limit !== undefined && BigInt(request.permit.amount) !== limit)
    throw new Error(
      "Another execution fixed this account’s fee limit. Refresh the fee review before approving.",
    );
  if (
    request.operation.nonce >> 64n === 0n ||
    open.some(
      (e) =>
        e.request.operation.nonce >> 64n === request.operation.nonce >> 64n,
    )
  )
    throw new Error(
      "This execution sequence is already reserved. Check the original request before continuing.",
    );
}
