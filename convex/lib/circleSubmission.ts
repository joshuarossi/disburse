import { circleAccountState } from "./circleAccountService";
import { readAccountAuthority } from "./accountAuthority";
import {
  assembleDataApprovals,
  type SavedAccountSignature,
} from "./accountApproval";
import {
  circleRootSigningData,
  decodeCircleRequest,
} from "../../shared/circleRequest";
import { circleRpc, CircleServiceError } from "../../shared/circleTransport";
import { assertCircleBatch } from "./circleBatch";
import type { Doc } from "../_generated/dataModel";

export async function verifyCircleSubmission(
  execution: Doc<"circleExecutions">,
  signatures: SavedAccountSignature[],
  transaction: { to: string; data: string; operation?: 0 | 1 },
) {
  if (!execution.open || execution.stage !== "ready")
    throw new Error("Complete the account and fee approvals before sending.");
  const request = decodeCircleRequest(execution.record);
  if (
    request.directCall
      ? transaction.to.toLowerCase() !== request.transaction.to.toLowerCase() ||
        transaction.data.toLowerCase() !==
          request.transaction.data.toLowerCase() ||
        (transaction.operation ?? 0) !== (request.transaction.operation ?? 0)
      : transaction.to.toLowerCase() !== request.safe.toLowerCase()
  )
    throw new Error("The account instructions changed.");
  await assertCircleBatch(request.chainId, request.transaction);
  const authority = await readAccountAuthority(request.chainId, request.safe);
  const collected = await assembleDataApprovals(
    request.chainId,
    authority,
    circleRootSigningData(request, "operation"),
    signatures,
  );
  if (collected.confirmations.length < authority.nodes[0].threshold)
    throw new Error("The current account owners must approve this execution.");
  const state = await circleAccountState(
    request.chainId,
    request.safe,
    request.operation.nonce >> 64n,
  );
  if (Number(state.block.timestamp) < request.validAfter)
    throw new CircleServiceError(
      "not_due",
      "The network has not reached this payment’s approved time yet. We will check again shortly.",
    );
  if (
    state.nonce !== request.operation.nonce ||
    Number(state.block.timestamp) >= request.validUntil - 30 ||
    state.allowance > BigInt(request.permit.amount)
  )
    throw new Error(
      "The account or fee authorization changed. Check the original request before continuing.",
    );
  await circleRpc(request.chainId, "eth_estimateUserOperationGas", [
    request.operation,
    state.config.entryPoint,
  ]);
  return request;
}
