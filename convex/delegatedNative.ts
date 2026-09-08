import { assertBatchContract } from "./lib/accountChange";
import { v } from "convex/values";
import { action, internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import { assertPaymentMayProceed } from "./lib/disbursementPolicy";
import { assertMemberPaymentPolicy } from "./lib/paymentLimits";
import { assertFundingBalance } from "./lib/fundingBalance";
import { getChainClient } from "./lib/safeVerification";
import {
  assertAllowanceRuntime,
  assertCurrentAllowance,
} from "../shared/allowanceDeployments";
import { delegatedAccountCall } from "../shared/delegatedAccountCall";
import {
  allowanceTransferAbi,
  assertDelegatedReceipt,
} from "../shared/allowanceTransfer";
import { assertReceiptConfirmations } from "../shared/confirmations";
import { readSettlementBlock } from "./lib/settlementBlock";
import { appendAudit } from "./audit";
import { assertValidTxHash } from "./lib/validation";
import { amountToBaseUnits } from "../shared/validation";
import { decodeEventLog, type Address, type Hex } from "viem";

const identity = {
  disbursementId: v.id("disbursements"),
  sessionToken: v.string(),
};
export const start = action({
  args: identity,
  handler: async (
    ctx,
    args,
  ): Promise<{ to: string; data: string; attemptId: string }> => {
    const expected = await ctx.runQuery(
      internal.delegatedPayments.context,
      args,
    );
    const p = expected.payment,
      intent = p.allowanceExecution;
    if (
      !intent ||
      p.allowanceFeeSafeId ||
      intent.feeAuthorization ||
      p.executionFee ||
      p.status !== "relaying" ||
      p.txHash ||
      intent.delegate.toLowerCase() !== expected.delegate.toLowerCase()
    )
      throw new Error(
        "Resume the original wallet-paid allowance authorization",
      );
    if (
      p.nativeExecution?.attemptId &&
      !p.nativeExecution.walletRejectedAt &&
      !p.nativeExecution.revertedAt
    )
      throw new Error(
        "Check the original wallet submission before trying again",
      );
    assertCurrentAllowance(intent.chainId, intent.module);
    const client = getChainClient(intent.chainId),
      block = await client.getBlockNumber();
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
      p.token,
      p.totalAmount ?? p.amount ?? intent.amount,
    );
    const call = delegatedAccountCall(intent, p.token);
    if (call.to.toLowerCase() !== intent.module.toLowerCase())
      await assertBatchContract(intent.chainId, call.to, block);
    // The module checks the saved nonce, signature, enabled state and remaining
    // grant. Simulate the complete batch again before reserving a send attempt.
    await client.call({ ...call, account: intent.delegate as Address });
    const attemptId = crypto.randomUUID();
    await ctx.runMutation(internal.delegatedNative.reserve, {
      ...args,
      hash: intent.hash,
      attemptId,
      searchFromBlock: String(block > 12n ? block - 12n : 0n),
    });
    return { ...call, attemptId };
  },
});
export const reserve = internalMutation({
  args: {
    ...identity,
    hash: v.string(),
    attemptId: v.string(),
    searchFromBlock: v.string(),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.disbursementId);
    if (
      !p?.allowanceExecution ||
      p.allowanceFeeSafeId ||
      p.allowanceExecution.feeAuthorization ||
      p.executionFee ||
      p.status !== "relaying" ||
      p.txHash ||
      p.allowanceExecution.hash !== args.hash ||
      (p.nativeExecution?.attemptId &&
        !p.nativeExecution.walletRejectedAt &&
        !p.nativeExecution.revertedAt)
    )
      throw new Error(
        "Check the original wallet submission before trying again",
      );
    const { user } = await requireOrgAccess(ctx, p.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
    ]);
    if (
      user._id !== p.delegatedBy ||
      user.walletAddress.toLowerCase() !==
        p.allowanceExecution.delegate.toLowerCase()
    )
      throw new Error(
        "Only the original delegate can submit this authorization",
      );
    if (!/^\d+$/.test(args.searchFromBlock))
      throw new Error("Invalid recovery checkpoint");
    const safe = await ctx.db.get(p.safeId);
    if (
      !safe ||
      safe.isActive === false ||
      safe.safeAddress.toLowerCase() !==
        p.allowanceExecution.safeAddress.toLowerCase()
    )
      throw new Error("The funding account is no longer available");
    await assertPaymentMayProceed(ctx, p);
    for (const userId of new Set([p.createdBy, user._id]))
      await assertMemberPaymentPolicy(
        ctx,
        p.orgId,
        userId,
        p.token,
        p.totalAmount ?? p.amount ?? "0",
        Date.now(),
        p._id,
      );
    await ctx.db.patch(p._id, {
      nativeExecution: {
        startedAt: Date.now(),
        actorUserId: user._id,
        attemptId: args.attemptId,
        checks: 0,
        searchFromBlock:
          p.nativeExecution?.searchFromBlock ?? args.searchFromBlock,
      },
      nativeRecoveryAt: Date.now() + 60_000,
      relayError: undefined,
      relayStatus: "Checking settlement",
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: p.orgId,
      actorUserId: user._id,
      action: "disbursement.delegated_wallet_attempt",
      objectType: "disbursement",
      objectId: p._id,
      metadata: {
        hash: args.hash,
        attemptId: args.attemptId,
        previousAttemptId: p.nativeExecution?.attemptId,
      },
    });
  },
});
export const reconcile = internalAction({
  args: { disbursementId: v.id("disbursements") },
  handler: async (ctx, args): Promise<void> => {
    const source = await ctx.runQuery(internal.delegatedPayments.context, args);
    const p = source.payment,
      intent = p.allowanceExecution;
    if (
      !intent ||
      p.allowanceFeeSafeId ||
      intent.feeAuthorization ||
      !p.nativeExecution ||
      p.status !== "relaying"
    )
      return;
    const identity = { ...args, safeTxHash: intent.hash };
    const client = getChainClient(intent.chainId);
    let txHash = p.txHash,
      searchFromBlock = p.nativeExecution.searchFromBlock;
    try {
      if (!txHash && searchFromBlock) {
        const head = await client.getBlockNumber(),
          confirmed = head > 1n ? head - 1n : 0n,
          fromBlock = BigInt(searchFromBlock);
        const toBlock =
          confirmed < fromBlock + 1999n ? confirmed : fromBlock + 1999n;
        if (fromBlock <= toBlock) {
          const logs = await client.getLogs({
            address: intent.module as Address,
            event: allowanceTransferAbi.find(
              (x) =>
                x.type === "event" && x.name === "ExecuteAllowanceTransfer",
            )!,
            args: { safe: intent.safeAddress as Address },
            fromBlock,
            toBlock,
          });
          txHash =
            logs.find((log) => {
              if (log.removed) return false;
              try {
                const event = decodeEventLog({
                  abi: allowanceTransferAbi,
                  eventName: "ExecuteAllowanceTransfer",
                  data: log.data,
                  topics: log.topics,
                });
                const e = event.args;
                return (
                  e.safe.toLowerCase() === intent.safeAddress.toLowerCase() &&
                  e.delegate.toLowerCase() === intent.delegate.toLowerCase() &&
                  e.token.toLowerCase() === intent.tokenAddress.toLowerCase() &&
                  e.to.toLowerCase() ===
                    intent.recipientAddress.toLowerCase() &&
                  e.nonce === intent.nonce &&
                  e.value === amountToBaseUnits(intent.amount, p.token)
                );
              } catch {
                return false;
              }
            })?.transactionHash ?? undefined;
          if (!txHash)
            searchFromBlock = String(toBlock > 12n ? toBlock - 12n : 0n);
        }
      }
      if (!txHash) {
        await ctx.runMutation(internal.nativePayments.checkpoint, {
          ...identity,
          searchFromBlock,
        });
        return;
      }
      assertValidTxHash(txHash);
      const receipt = await client.getTransactionReceipt({
        hash: txHash as Hex,
      });
      assertReceiptConfirmations(
        receipt.blockNumber,
        await client.getBlockNumber(),
      );
      if (receipt.status !== "success") {
        const tx = await client.getTransaction({ hash: txHash as Hex }),
          call = delegatedAccountCall(intent, p.token);
        if (
          tx.to?.toLowerCase() !== call.to.toLowerCase() ||
          tx.input.toLowerCase() !== call.data.toLowerCase() ||
          tx.value !== 0n
        )
          throw new Error("Receipt belongs to another authorization");
        // A verified revert is safe to retry with the same module nonce and
        // signatures. Store its identity first; never release the reservation.
        await ctx.runMutation(internal.nativePayments.checkpoint, {
          ...identity,
          txHash,
        });
        await ctx.runMutation(internal.delegatedPayments.markReverted, {
          ...args,
          txHash,
        });
        return;
      }
      assertDelegatedReceipt(receipt, intent.safeAddress, p.token, intent);
      const settlement = await readSettlementBlock(
        client,
        intent.chainId,
        receipt,
      );
      await ctx.runMutation(internal.nativePayments.checkpoint, {
        ...identity,
        txHash,
      });
      await ctx.runMutation(internal.delegatedPayments.confirm, {
        ...args,
        txHash,
        hash: intent.hash,
        settlement,
      });
    } catch {
      await ctx.runMutation(internal.nativePayments.checkpoint, {
        ...identity,
        searchFromBlock,
        error:
          "A confirmed receipt for the original allowance payment is not available yet. We will keep checking.",
      });
    }
  },
});
