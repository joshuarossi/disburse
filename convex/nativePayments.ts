import { readSettlementBlock } from "./lib/settlementBlock";
import { v } from "convex/values";
import { matchesAccountExecution } from "../shared/accountExecution";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getChainClient } from "./lib/safeVerification";
import { getSafeTxServiceUrl } from "../shared/safe";
import { configuredTokenAddress } from "../shared/assets";
import { assertPaymentReceipt } from "./lib/executionReceipt";
import { assertReceiptConfirmations } from "../shared/confirmations";
import { assertValidTxHash } from "./lib/validation";
import { requireOrgAccess } from "./lib/rbac";
import { appendAudit } from "./audit";

const identityArgs = {
  disbursementId: v.id("disbursements"),
  sessionToken: v.string(),
};

// Save a chain checkpoint and claim once before asking the wallet to broadcast.
export const start = action({
  args: { ...identityArgs, safeTxHash: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ success: boolean; attemptId: string }> => {
    const identity = {
      disbursementId: args.disbursementId,
      sessionToken: args.sessionToken,
    };
    const expected = await ctx.runQuery(
      internal.disbursements.getForVerification,
      identity,
    );
    if (expected.safeTxHash !== args.safeTxHash)
      throw new Error("Payment proposal changed");
    await ctx.runAction(api.paymentExecution.verifyProposal, {
      ...identity,
      requireSignatures: true,
    });
    const block = await getChainClient(expected.chainId).getBlockNumber();
    return ctx.runMutation(internal.disbursements.claimNativeExecution, {
      ...args,
      searchFromBlock: String(block > 12n ? block - 12n : 0n),
      attemptId: crypto.randomUUID(),
    });
  },
});

// A wallet-declined response belongs to one browser attempt. Keep the original
// payment, nonce, signatures and recovery queue: this is not proof of non-settlement.
export const walletRejected = mutation({
  args: { ...identityArgs, attemptId: v.string() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.disbursementId);
    if (!p) throw new Error("Payment not found");
    const { user } = await requireOrgAccess(ctx, p.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
    ]);
    if (
      p.status !== "relaying" ||
      p.txHash ||
      p.nativeExecution?.attemptId !== args.attemptId ||
      p.nativeExecution.actorUserId !== user._id
    )
      throw new Error(
        "This wallet attempt is no longer current. Check the original payment settlement.",
      );
    if (p.nativeExecution.walletRejectedAt) return;
    await ctx.db.patch(p._id, {
      nativeExecution: { ...p.nativeExecution, walletRejectedAt: Date.now() },
      relayStatus: "Wallet approval declined",
      relayError: undefined,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: p.orgId,
      actorUserId: user._id,
      action: "disbursement.wallet_declined",
      objectType: "disbursement",
      objectId: p._id,
      timestamp: Date.now(),
      metadata: { attemptId: args.attemptId, safeTxHash: p.safeTxHash },
    });
  },
});

// A bounded, persistent queue continues after the user closes their browser.
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("disbursements")
      .withIndex("by_native_recovery", (q) =>
        q.gt("nativeRecoveryAt", 0).lte("nativeRecoveryAt", Date.now()),
      )
      .take(20);
    for (const payment of due) {
      await ctx.db.patch(payment._id, {
        nativeRecoveryAt:
          payment.status === "relaying" ? Date.now() + 60_000 : undefined,
      });
      if (payment.status === "relaying")
        await ctx.scheduler.runAfter(0, internal.nativePayments.reconcile, {
          disbursementId: payment._id,
        });
    }
  },
});

export const checkpoint = internalMutation({
  args: {
    disbursementId: v.id("disbursements"),
    safeTxHash: v.string(),
    searchFromBlock: v.optional(v.string()),
    txHash: v.optional(v.string()),
    error: v.optional(v.string()),
    stop: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.disbursementId);
    if (
      !p ||
      p.status !== "relaying" ||
      !p.nativeExecution ||
      (p.allowanceExecution?.hash ?? p.safeTxHash) !== args.safeTxHash
    )
      return;
    if (
      p.txHash &&
      args.txHash &&
      p.txHash.toLowerCase() !== args.txHash.toLowerCase()
    )
      throw new Error("Original broadcast cannot be replaced");
    let searchFromBlock = p.nativeExecution.searchFromBlock;
    if (
      args.searchFromBlock &&
      (!searchFromBlock ||
        BigInt(args.searchFromBlock) > BigInt(searchFromBlock))
    )
      searchFromBlock = args.searchFromBlock;
    const checks = p.nativeExecution.checks + 1;
    const stop = args.stop || checks >= 120;
    await ctx.db.patch(p._id, {
      nativeExecution: {
        ...p.nativeExecution,
        searchFromBlock,
        checkedAt: Date.now(),
        checks,
      },
      nativeRecoveryAt: stop ? undefined : Date.now() + 60_000,
      txHash: p.txHash ?? args.txHash,
      relayStatus:
        p.nativeExecution.walletRejectedAt && !args.txHash
          ? "Wallet approval declined"
          : stop
            ? "Needs investigation"
            : "Checking settlement",
      relayError:
        args.error ??
        (stop
          ? "No confirmed receipt was found. Check settlement again before preparing any replacement."
          : undefined),
      updatedAt: Date.now(),
    });
  },
});

export const recheck = mutation({
  args: identityArgs,
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.disbursementId);
    if (!p) throw new Error("Payment not found");
    const { user } = await requireOrgAccess(ctx, p.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
    ]);
    if (p.status === "executed") return;
    if (
      p.status !== "relaying" ||
      !p.nativeExecution ||
      !(p.allowanceExecution?.hash ?? p.safeTxHash)
    )
      throw new Error("No native wallet submission is awaiting reconciliation");
    await ctx.db.patch(p._id, {
      nativeExecution: { ...p.nativeExecution, checks: 0 },
      nativeRecoveryAt: Date.now() + 60_000,
      relayStatus: "Checking settlement",
      relayError: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.nativePayments.reconcile, {
      disbursementId: p._id,
    });
    await appendAudit(ctx, {
      orgId: p.orgId,
      actorUserId: user._id,
      action: "disbursement.native_settlement_recheck",
      objectType: "disbursement",
      objectId: p._id,
      timestamp: Date.now(),
      metadata: { safeTxHash: p.safeTxHash },
    });
  },
});

export const reconcile = internalAction({
  args: { disbursementId: v.id("disbursements") },
  handler: async (ctx, args): Promise<void> => {
    const p = await ctx.runQuery(internal.disbursements.getInternal, args);
    if (p?.allowanceExecution && p.nativeExecution) {
      await ctx.runAction(internal.delegatedNative.reconcile, args);
      return;
    }
    if (
      !p ||
      p.status !== "relaying" ||
      !p.nativeExecution ||
      !p.safeTxHash ||
      p.allowanceExecution
    )
      return;
    const identity = { ...args, safeTxHash: p.safeTxHash };
    let txHash = p.txHash;
    let searchFromBlock = p.nativeExecution.searchFromBlock;
    try {
      const expected = await ctx.runQuery(
        internal.disbursements.getForVerification,
        args,
      );
      const client = getChainClient(expected.chainId);
      // The service provides a candidate only. A verified chain receipt determines settlement.
      if (!txHash) {
        try {
          const response = await fetch(
            `${getSafeTxServiceUrl(expected.chainId)}/v2/multisig-transactions/${p.safeTxHash}/`,
            { signal: AbortSignal.timeout(15_000) },
          );
          if (response.ok) {
            const proposal = await response.json();
            if (
              proposal.safeTxHash?.toLowerCase() ===
                p.safeTxHash.toLowerCase() &&
              typeof proposal.transactionHash === "string"
            ) {
              assertValidTxHash(proposal.transactionHash);
              txHash = proposal.transactionHash;
            }
          }
        } catch {
          /* Fall back to the network when the indexer is unavailable. */
        }
      }
      if (!txHash && p.nativeExecution.searchFromBlock) {
        const head = await client.getBlockNumber();
        const fromBlock = BigInt(p.nativeExecution.searchFromBlock);
        // Only advance past confirmed blocks. Overlap the boundary to tolerate reorgs.
        const confirmed = head > 1n ? head - 1n : 0n;
        const toBlock =
          confirmed < fromBlock + 1999n ? confirmed : fromBlock + 1999n;
        if (fromBlock <= toBlock) {
          const logs = await client.getLogs({
            address: expected.safeAddress as `0x${string}`,
            fromBlock,
            toBlock,
          });
          const match = logs.find((log) =>
            matchesAccountExecution(log, p.safeTxHash!),
          );
          txHash = match?.transactionHash ?? undefined;
          if (!txHash)
            searchFromBlock = String(toBlock > 12n ? toBlock - 12n : 0n);
        }
      }
      if (!txHash) {
        // No evidence of failure or success. Never create or broadcast a replacement.
        await ctx.runMutation(internal.nativePayments.checkpoint, {
          ...identity,
          searchFromBlock,
        });
        return;
      }
      assertValidTxHash(txHash);
      const receipt = await client.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      assertReceiptConfirmations(
        receipt.blockNumber,
        await client.getBlockNumber(),
      );
      const tokenAddress =
        expected.tokenAddress ??
        configuredTokenAddress(expected.chainId, expected.token);
      if (!tokenAddress) throw new Error("Unsupported payment currency");
      try {
        assertPaymentReceipt(receipt, { ...expected, tokenAddress });
      } catch {
        await ctx.runMutation(internal.nativePayments.checkpoint, {
          ...identity,
          txHash,
          stop: true,
          error:
            "A transaction was found, but its receipt does not confirm the approved payment. Review the original receipt before taking further action.",
        });
        return;
      }
      await ctx.runMutation(internal.disbursements.confirmExecution, {
        ...identity,
        txHash,
        settlement: await readSettlementBlock(
          client,
          expected.chainId,
          receipt,
        ),
      });
    } catch {
      // RPC errors can contain authenticated URLs; do not expose their details.
      await ctx.runMutation(internal.nativePayments.checkpoint, {
        ...identity,
        error:
          "The network has not supplied a confirmed receipt yet. We will keep checking the original payment.",
      });
    }
  },
});
