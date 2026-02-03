"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

const GELATO_TASK_STATUS_URL = "https://api.gelato.digital/tasks/status";
const SAFE_TX_SERVICE_URL_BY_CHAIN: Record<number, string> = {
  1: "https://safe-transaction-mainnet.safe.global/api",
  137: "https://safe-transaction-polygon.safe.global/api",
  8453: "https://safe-transaction-base.safe.global/api",
  42161: "https://safe-transaction-arbitrum.safe.global/api",
  11155111: "https://safe-transaction-sepolia.safe.global/api",
  84532: "https://safe-transaction-base-sepolia.safe.global/api",
};

function getSafeTxServiceUrl(chainId: number): string {
  const url = SAFE_TX_SERVICE_URL_BY_CHAIN[chainId];
  if (!url) {
    throw new Error(`Unsupported chain for Safe: ${chainId}`);
  }
  return url;
}

export const getTaskStatus = action({
  args: {
    taskId: v.string(),
  },
  handler: async (_ctx, args) => {
    console.info("[Relay] Fetching task status", { taskId: args.taskId });
    const response = await fetch(`${GELATO_TASK_STATUS_URL}/${args.taskId}`);
    if (!response.ok) {
      console.error("[Relay] Failed to fetch task status", {
        taskId: args.taskId,
        status: response.status,
      });
      throw new Error("Failed to fetch relay task status.");
    }

    const data = await response.json();
    const task = data?.task ?? data;

    console.info("[Relay] Task status response", {
      taskId: args.taskId,
      taskState: task?.taskState ?? task?.state ?? task?.status ?? null,
      transactionHash:
        task?.transactionHash ?? task?.txHash ?? task?.transaction_hash ?? null,
    });

    return {
      taskId: args.taskId,
      taskState: task?.taskState ?? task?.state ?? task?.status ?? null,
      transactionHash:
        task?.transactionHash ?? task?.txHash ?? task?.transaction_hash ?? null,
    };
  },
});

export const retryDisbursement = action({
  args: {
    disbursementId: v.id("disbursements"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const disbursement = await ctx.runQuery(api.disbursements.get, {
      disbursementId: args.disbursementId,
      walletAddress: args.walletAddress,
    });

    if (!disbursement) {
      throw new Error("Disbursement not found");
    }

    if (!disbursement.safeTxHash || !disbursement.chainId) {
      throw new Error("Missing Safe transaction data for retry");
    }

    const txServiceUrl = getSafeTxServiceUrl(disbursement.chainId);
    const response = await fetch(
      `${txServiceUrl}/v1/transactions/${disbursement.safeTxHash}`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch Safe transaction status");
    }

    const safeTx = await response.json();
    const confirmations = safeTx?.confirmations?.length ?? 0;
    const confirmationsRequired = safeTx?.confirmationsRequired ?? 0;

    if (safeTx?.isExecuted && safeTx?.transactionHash) {
      await ctx.runMutation(api.disbursements.updateStatus, {
        disbursementId: args.disbursementId,
        walletAddress: args.walletAddress,
        status: "executed",
        txHash: safeTx.transactionHash,
        relayStatus: "executed",
      });

      return {
        status: "executed",
        txHash: safeTx.transactionHash as string,
      };
    }

    if (confirmations < confirmationsRequired) {
      await ctx.runMutation(api.disbursements.updateStatus, {
        disbursementId: args.disbursementId,
        walletAddress: args.walletAddress,
        status: "proposed",
        relayStatus: "needs_confirmations",
      });

      return {
        status: "needs_confirmations",
        confirmations,
        confirmationsRequired,
      };
    }

    await ctx.runMutation(api.disbursements.updateStatus, {
      disbursementId: args.disbursementId,
      walletAddress: args.walletAddress,
      status: "proposed",
      relayStatus: "ready_for_relay",
    });

    return {
      status: "ready",
    };
  },
});
