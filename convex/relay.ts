"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { encodeFunctionData, getAddress } from "viem";

const GELATO_TASK_STATUS_URL = "https://api.gelato.digital/tasks/status";
const SAFE_TX_SERVICE_URL_BY_CHAIN: Record<number, string> = {
  1: "https://safe-transaction-mainnet.safe.global/api",
  137: "https://safe-transaction-polygon.safe.global/api",
  8453: "https://safe-transaction-base.safe.global/api",
  42161: "https://safe-transaction-arbitrum.safe.global/api",
  11155111: "https://safe-transaction-sepolia.safe.global/api",
  84532: "https://safe-transaction-base-sepolia.safe.global/api",
};

const GELATO_NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SAFE_EXEC_TX_ABI = [
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

function getSafeTxServiceUrl(chainId: number): string {
  const url = SAFE_TX_SERVICE_URL_BY_CHAIN[chainId];
  if (!url) {
    throw new Error(`Unsupported chain for Safe: ${chainId}`);
  }
  return url;
}

interface SafeConfirmation {
  owner: string;
  signature: string;
}

interface SafeTxPayload {
  to: string;
  value?: string | number;
  data?: string;
  operation?: string | number;
  safeTxGas?: string | number;
  baseGas?: string | number;
  gasPrice?: string | number;
  gasToken?: string;
  refundReceiver?: string;
  confirmations?: SafeConfirmation[];
}

function encodeExecTransaction(safeTx: SafeTxPayload): string {
  const confirmations = [...(safeTx.confirmations || [])];
  confirmations.sort((a: SafeConfirmation, b: SafeConfirmation) =>
    getAddress(a.owner).localeCompare(getAddress(b.owner))
  );
  const signaturesHex = "0x" + confirmations
    .map((c: SafeConfirmation) => c.signature.replace("0x", ""))
    .join("");

  const operation = typeof safeTx.operation === "string"
    ? Number(safeTx.operation)
    : safeTx.operation ?? 0;

  const dataHex = (safeTx.data || "0x") as `0x${string}`;
  const gasToken = (safeTx.gasToken || ZERO_ADDRESS) as `0x${string}`;
  const refundReceiver = (safeTx.refundReceiver || ZERO_ADDRESS) as `0x${string}`;
  return encodeFunctionData({
    abi: SAFE_EXEC_TX_ABI,
    functionName: "execTransaction",
    args: [
      safeTx.to as `0x${string}`,
      BigInt(safeTx.value ?? 0),
      dataHex,
      operation,
      BigInt(safeTx.safeTxGas ?? 0),
      BigInt(safeTx.baseGas ?? 0),
      BigInt(safeTx.gasPrice ?? 0),
      gasToken,
      refundReceiver,
      signaturesHex as `0x${string}`,
    ],
  });
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
      `${txServiceUrl}/v2/multisig-transactions/${disbursement.safeTxHash}/`
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error("[Relay] Failed to fetch Safe transaction status", {
        safeTxHash: disbursement.safeTxHash,
        chainId: disbursement.chainId,
        status: response.status,
        body: errorBody,
      });

      if (response.status === 404) {
        await ctx.runMutation(api.disbursements.updateStatus, {
          disbursementId: args.disbursementId,
          walletAddress: args.walletAddress,
          status: "failed",
          relayStatus: "safe_tx_not_found",
          relayError: "Safe transaction not found in service.",
        });
        return { status: "not_found" };
      }

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

export const fireScheduledRelay = internalAction({
  args: {
    disbursementId: v.id("disbursements"),
    scheduledVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const disbursement = await ctx.runQuery(internal.disbursements.getInternal, {
      disbursementId: args.disbursementId,
    });

    if (
      !disbursement ||
      disbursement.status !== "scheduled" ||
      disbursement.scheduledVersion !== args.scheduledVersion
    ) {
      console.info("[Relay] Scheduled job skipped", {
        disbursementId: args.disbursementId,
        status: disbursement?.status,
        scheduledVersion: disbursement?.scheduledVersion,
        jobVersion: args.scheduledVersion,
      });
      return { skipped: true };
    }

    if (!disbursement.safeTxHash || !disbursement.chainId || !disbursement.safeAddress) {
      await ctx.runMutation(internal.disbursements.updateStatusInternal, {
        disbursementId: args.disbursementId,
        status: "failed",
        relayError: "Missing safeTxHash, chainId, or safeAddress at relay time.",
      });
      return { error: "missing_data" };
    }

    try {
      const txServiceUrl = getSafeTxServiceUrl(disbursement.chainId);
      const txResponse = await fetch(
        `${txServiceUrl}/v2/multisig-transactions/${disbursement.safeTxHash}/`
      );
      if (!txResponse.ok) {
        throw new Error(`Safe TX service returned ${txResponse.status}`);
      }
      const safeTx = await txResponse.json();

      const encodedTransaction = encodeExecTransaction(safeTx);

      const gasToken = safeTx.gasToken ?? ZERO_ADDRESS;
      const feeToken = (!gasToken || gasToken === ZERO_ADDRESS)
        ? GELATO_NATIVE_TOKEN_ADDRESS
        : gasToken;

      const relayResponse = await fetch(
        "https://api.gelato.digital/relays/v2/call-with-sync-fee",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chainId: String(disbursement.chainId),
            target: disbursement.safeAddress,
            data: encodedTransaction,
            feeToken,
            isRelayContext: false,
          }),
        }
      );

      const responseBody = await relayResponse.text();
      console.info("[Relay] Gelato response (scheduled)", {
        status: relayResponse.status,
        body: responseBody,
      });

      if (!relayResponse.ok) {
        throw new Error(`Gelato relay failed: ${relayResponse.status} ${responseBody}`);
      }

      const parsed = JSON.parse(responseBody);
      if (!parsed?.taskId) {
        throw new Error("Relay did not return a taskId.");
      }

      await ctx.runMutation(internal.disbursements.updateStatusInternal, {
        disbursementId: args.disbursementId,
        status: "relaying",
        relayTaskId: parsed.taskId,
        relayStatus: "submitted",
      });

      return { taskId: parsed.taskId };
    } catch (err) {
      await ctx.runMutation(internal.disbursements.updateStatusInternal, {
        disbursementId: args.disbursementId,
        status: "failed",
        relayError: err instanceof Error ? err.message : "Unknown error",
      });
      console.error("[Relay] Scheduled relay failed", {
        disbursementId: args.disbursementId,
        error: err,
      });
      return { error: "relay_failed" };
    }
  },
});
