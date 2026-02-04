"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAddress, formatUnits } from "viem";
import { api } from "./_generated/api";

const SAFE_TX_SERVICE_URL_BY_CHAIN: Record<number, string> = {
  1: "https://safe-transaction-mainnet.safe.global/api",
  137: "https://safe-transaction-polygon.safe.global/api",
  8453: "https://safe-transaction-base.safe.global/api",
  42161: "https://safe-transaction-arbitrum.safe.global/api",
  11155111: "https://safe-transaction-sepolia.safe.global/api",
  84532: "https://safe-transaction-base-sepolia.safe.global/api",
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function getSafeTxServiceUrl(chainId: number): string {
  const url = SAFE_TX_SERVICE_URL_BY_CHAIN[chainId];
  if (!url) {
    throw new Error(`Unsupported chain for Safe: ${chainId}`);
  }
  return url;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

type IncomingTransfer = {
  executionDate?: string;
  timestamp?: number;
  date?: string;
  transactionHash?: string;
  txHash?: string;
  from?: string;
  to?: string;
  value?: string | number;
  amount?: string | number;
  tokenAddress?: string | null;
  tokenInfo?: {
    address?: string;
    symbol?: string;
    decimals?: number;
  };
  blockNumber?: number;
};

export const syncForOrg = action({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const safes = await ctx.runQuery(api.safes.getForOrg, {
      orgId: args.orgId,
      walletAddress: args.walletAddress,
    });

    const apiKey = process.env.SAFE_TX_SERVICE_API_KEY;

    let inserted = 0;

    for (const safe of safes) {
      const safeAddress = getAddress(safe.safeAddress);
      const baseUrl = getSafeTxServiceUrl(safe.chainId);
      const latestTimestamp = await ctx.runQuery(api.depositsData.getLatestForSafe, {
        orgId: args.orgId,
        walletAddress: args.walletAddress,
        safeId: safe._id,
      });

      const sinceTimestamp = Math.max(safe.createdAt ?? 0, latestTimestamp ?? 0);

      let nextUrl: string | null = `${baseUrl}/v1/safes/${safeAddress}/incoming-transfers/`;

      while (nextUrl) {
        const response = await fetch(nextUrl, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          console.error("[Deposits] Failed to fetch incoming transfers", {
            safeAddress,
            chainId: safe.chainId,
            status: response.status,
            body: errorBody,
          });
          break;
        }

        const payload = await response.json();
        const results: IncomingTransfer[] = payload?.results ?? [];
        nextUrl = payload?.next ?? null;

        if (!Array.isArray(results) || results.length === 0) {
          break;
        }

        for (const transfer of results) {
          const eventTimestamp =
            normalizeTimestamp(transfer.executionDate) ??
            normalizeTimestamp(transfer.timestamp) ??
            normalizeTimestamp(transfer.date);

          if (!eventTimestamp) {
            continue;
          }

          if (eventTimestamp <= sinceTimestamp) {
            nextUrl = null;
            break;
          }

          const rawValue = transfer.value ?? transfer.amount ?? "0";
          const amountRaw = String(rawValue);

          const tokenAddress =
            transfer.tokenAddress ??
            transfer.tokenInfo?.address ??
            ZERO_ADDRESS;

          const decimals = transfer.tokenInfo?.decimals ?? 18;
          let amount = amountRaw;

          try {
            amount = formatUnits(BigInt(amountRaw), decimals);
          } catch {
            amount = amountRaw;
          }

          const txHash = transfer.transactionHash ?? transfer.txHash ?? "";
          if (!txHash) continue;

          const toAddress = transfer.to ?? safe.safeAddress;
          const result = await ctx.runMutation(api.depositsData.upsertDeposit, {
            orgId: safe.orgId,
            safeId: safe._id,
            chainId: safe.chainId,
            safeAddress: safe.safeAddress,
            tokenAddress,
            tokenSymbol: transfer.tokenInfo?.symbol ?? "ETH",
            decimals,
            amountRaw,
            amount,
            txHash,
            blockNumber: transfer.blockNumber,
            timestamp: eventTimestamp,
            fromAddress: transfer.from,
            toAddress,
            source: "safe_tx_service",
            walletAddress: args.walletAddress,
          });
          if (result.inserted) {
            inserted += 1;
          }
        }
      }
    }

    return { inserted };
  },
});
