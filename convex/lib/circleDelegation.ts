import { releaseContractReservations } from "./circleCancellation";
import { keccak256, toHex, type Address } from "viem";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requireOrgAccess } from "./rbac";
import { ORG_READER_ROLES, PAYMENT_OPERATOR_ROLES } from "../../shared/roles";
import {
  circleConfiguration,
  circleAccountCall,
  CIRCLE_ENTRY_POINT,
} from "../../shared/circleExecution";
import { delegatedAccountCall } from "../../shared/delegatedAccountCall";
import { assertPaymentMayProceed } from "./disbursementPolicy";
import { assertMemberPaymentPolicy } from "./paymentLimits";
import { scheduledActor } from "./scheduledPayment";
import { amountToBaseUnits } from "../../shared/validation";
import {
  assertCurrentAllowance,
  assertAllowanceRuntime,
} from "../../shared/allowanceDeployments";
import { assertFundingBalance } from "./fundingBalance";
import { assertSafeIdentity } from "./safeIdentity";
import { assertBatchContract } from "./accountChange";
import { getChainClient } from "./safeVerification";
import { readAccountAuthority } from "./accountAuthority";
import { completePayment } from "./paymentSettlement";
import type { CircleSource } from "./circleSource";

export async function allowanceFeeAccount(
  ctx: Pick<QueryCtx, "db">,
  payment: Doc<"disbursements">,
  safeId: Id<"safes">,
  write = true,
) {
  const safe = await ctx.db.get(safeId);
  if (
    !safe ||
    safe.orgId !== payment.orgId ||
    safe.chainId !== payment.chainId ||
    (write && safe.isActive === false)
  )
    throw new Error(
      "Choose an active fee account in this workspace on the payment network.",
    );
  circleConfiguration(safe.chainId);
  return safe;
}

/** The allowance controls principal. The independently selected Safe controls
 * USDC gas, using its actual owners; app membership grants neither authority. */
export async function readDelegatedSource(
  ctx: QueryCtx,
  delegatedDisbursementId: Id<"disbursements">,
  sessionToken: string,
  write = false,
) {
  const payment = await ctx.db.get(delegatedDisbursementId);
  if (!payment?.allowanceExecution || !payment.allowanceFeeSafeId)
    throw new Error(
      "The original USDC-paid allowance instruction was not found.",
    );
  const { user } = await requireOrgAccess(
    ctx,
    payment.orgId,
    sessionToken,
    write ? PAYMENT_OPERATOR_ROLES : ORG_READER_ROLES,
  );
  const safe = await allowanceFeeAccount(
    ctx,
    payment,
    payment.allowanceFeeSafeId,
    write,
  );
  const intent = payment.allowanceExecution;
  const funding = await ctx.db.get(payment.safeId);
  if (
    !funding ||
    funding.orgId !== payment.orgId ||
    funding.chainId !== intent.chainId ||
    funding.safeAddress.toLowerCase() !== intent.safeAddress.toLowerCase()
  )
    throw new Error("The saved allowance funding account changed.");
  if (write) {
    if (
      payment.allowanceCancellationRequestedAt ||
      payment.status !== "relaying" ||
      payment.txHash ||
      payment.executionFee ||
      intent.feeAuthorization ||
      payment.nativeExecution ||
      funding.isActive === false
    )
      throw new Error(
        "Check the original allowance payment before preparing another execution.",
      );
    if (!payment.delegatedBy)
      throw new Error("The original delegate is unavailable.");
    const delegate = await scheduledActor(
      ctx,
      payment.orgId,
      payment.delegatedBy,
    );
    if (
      safe.assignedUserId !== delegate._id ||
      intent.signature !== "0x" ||
      intent.additionalTransfers?.some((t) => t.signature !== "0x") ||
      intent.delegate.toLowerCase() !== safe.safeAddress.toLowerCase()
    )
      throw new Error(
        "The delegated member’s wallet changed. Check the original allowance.",
      );
    await assertPaymentMayProceed(ctx, payment);
    for (const userId of new Set([payment.createdBy, payment.delegatedBy]))
      await assertMemberPaymentPolicy(
        ctx,
        payment.orgId,
        userId,
        payment.token,
        payment.totalAmount ?? payment.amount ?? "0",
        Date.now(),
        payment._id,
      );
  }
  const call = delegatedAccountCall(intent, payment.token);
  const snapshot = JSON.stringify({
    payment: payment._id,
    funding: funding._id,
    feeSafe: safe._id,
    intent,
    token: payment.token,
    to: call.to,
    data: call.data,
  });
  const identity: CircleSource = { delegatedDisbursementId };
  return {
    identity,
    target: {
      _id: payment._id,
      orgId: payment.orgId,
      safeId: safe._id,
      chainId: safe.chainId,
      status: payment.status,
      safeTxHash: keccak256(toHex(snapshot)),
      executionFee: undefined,
    },
    safe,
    user,
    payment,
    snapshot,
    call,
    sourceId: payment._id,
    kind: "delegated_payment",
    directCall: true as const,
    principalUSDC:
      safe.safeAddress.toLowerCase() === intent.safeAddress.toLowerCase() &&
      payment.token === "USDC"
        ? String(
            amountToBaseUnits(
              payment.totalAmount ?? payment.amount ?? "0",
              "USDC",
            ),
          )
        : "0",
  };
}

export async function verifyDelegatedCall(
  source: Awaited<ReturnType<typeof readDelegatedSource>>,
) {
  const { payment, call } = source,
    intent = payment.allowanceExecution!;
  assertCurrentAllowance(intent.chainId, intent.module);
  const authority = await readAccountAuthority(
    intent.chainId,
    source.safe.safeAddress,
  );
  const member = source.safe.assignedUserId;
  if (
    !member ||
    source.safe.owners?.length !== 1 ||
    authority.nodes[0].threshold !== 1 ||
    authority.nodes[0].owners.length !== 1 ||
    authority.nodes[0].owners[0].toLowerCase() !==
      source.safe.owners[0].toLowerCase()
  )
    throw new Error(
      "The assigned account’s ownership changed. Review it before using this allowance.",
    );
  const client = getChainClient(intent.chainId),
    block = await client.getBlockNumber();
  await assertSafeIdentity(
    client,
    intent.safeAddress as Address,
    intent.chainId,
    block,
  );
  assertAllowanceRuntime(
    intent.module,
    await client.getCode({
      address: intent.module as Address,
      blockNumber: block,
    }),
  );
  await assertFundingBalance(
    intent.chainId,
    intent.safeAddress,
    payment.token,
    payment.totalAmount ?? payment.amount ?? intent.amount,
  );
  if (call.to.toLowerCase() !== intent.module.toLowerCase())
    await assertBatchContract(intent.chainId, call.to, block);
  // The published allowance module rechecks the exact delegate signature,
  // current nonce, token limit, enabled module and all batch transfers.
  await client.call({
    to: source.safe.safeAddress as Address,
    data: circleAccountCall(call.to, call.data, call.operation),
    account: CIRCLE_ENTRY_POINT,
    blockNumber: block,
  });
  return call;
}

export async function settleDelegatedCircle(
  ctx: MutationCtx,
  execution: Doc<"circleExecutions">,
) {
  const payment = execution.delegatedDisbursementId
    ? await ctx.db.get(execution.delegatedDisbursementId)
    : null;
  if (
    !payment ||
    payment.allowanceFeeSafeId !== execution.safeId ||
    payment.orgId !== execution.orgId
  )
    throw new Error("The original allowance fee account changed.");
  if (execution.stage === "confirmed") {
    if (!execution.settlement || !execution.txHash)
      throw new Error("The allowance payment receipt is incomplete.");
    await completePayment(
      ctx,
      payment,
      payment.delegatedBy ?? execution.createdBy,
      {
        txHash: execution.txHash,
        settlement: execution.settlement,
        executionId: execution._id,
      },
    );
    await releaseContractReservations(ctx, payment);
  } else if (
    ["failed", "expired"].includes(execution.stage) &&
    payment.status === "relaying" &&
    !payment.txHash
  ) {
    // Keep the exact instructions and allowance sequence for a deliberate
    // retry. Discarding a closed request can release these unsigned instructions.
    await ctx.db.patch(payment._id, {
      relayStatus: "Review execution fee",
      relayError:
        "The execution did not complete. Review a new USDC fee request to retry the original allowance payment.",
      updatedAt: Date.now(),
    });
  }
}
