import { formatUnits, getAddress } from "viem";
import { identifyAsset } from "../../shared/assets";
import {
  getSafeTxServiceUrl,
  normalizeSafeServiceUrl,
} from "../../shared/safe";

export const DEPOSIT_REFRESH_MS = 10 * 60_000;
export const DEPOSIT_FULL_SCAN_MS = 7 * 86400_000;
export const DEPOSIT_OVERLAP_MS = 86400_000;
export const DEPOSIT_LEASE_MS = 60_000;
export const DEPOSIT_PAGE_SIZE = 100;
const zero = "0x0000000000000000000000000000000000000000";
const addressPattern = /^0x[\da-f]{40}$/i;
const hashPattern = /^0x[\da-f]{64}$/i;

export function depositScanUrl(
  chainId: number,
  safeAddress: string,
  from: number,
  through: number,
  scope: 'incoming' | 'all' = 'incoming',
) {
  const url = new URL(
    `${getSafeTxServiceUrl(chainId)}/v1/safes/${getAddress(safeAddress)}/${scope === 'all' ? 'transfers' : 'incoming-transfers'}/`,
  );
  url.searchParams.set("limit", String(DEPOSIT_PAGE_SIZE));
  url.searchParams.set("ordering", "-timestamp");
  url.searchParams.set("execution_date__gte", new Date(from).toISOString());
  url.searchParams.set("execution_date__lte", new Date(through).toISOString());
  return url.toString();
}

export function validateDepositCursor(
  candidate: string,
  base: string,
  previous?: string,
) {
  const expected = new URL(normalizeSafeServiceUrl(base)),
    url = new URL(normalizeSafeServiceUrl(new URL(candidate, base).toString()));
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Invalid deposit history continuation");
  const allowed = new Set(['limit', 'ordering', 'execution_date__gte', 'execution_date__lte', 'offset']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1)
      throw new Error('Deposit history continuation changed its filters');
  }
  for (const key of [
    "limit",
    "ordering",
    "execution_date__gte",
    "execution_date__lte",
  ])
    if (url.searchParams.get(key) !== expected.searchParams.get(key))
      throw new Error("Deposit history continuation changed its scan window");
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (previous &&
      offset <= Number(new URL(previous).searchParams.get("offset") ?? 0))
  )
    throw new Error("Deposit history continuation did not advance");
  return url.toString();
}

type Transfer = {
  type?: string;
  transferId?: string;
  executionDate?: string;
  timestamp?: number;
  transactionHash?: string;
  to?: string;
  from?: string;
  value?: string | null;
  tokenId?: string | null;
  blockNumber?: number;
  tokenAddress?: string | null;
  tokenInfo?: {
    address?: string;
    type?: string;
    symbol?: string;
    decimals?: number;
  } | null;
};
export function parseDeposit(
  transfer: Transfer,
  chainId: number,
  safeAddress: string,
  from: number,
  through: number,
) {
  const result = parseAccountTransfer(transfer, chainId, safeAddress, from, through);
  if (result && result.toAddress !== safeAddress.toLowerCase()) throw new Error('Deposit history supplied invalid payment details');
  return result;
}

/** A transfer may be incoming, outgoing or a self-transfer; identity is per log/trace. */
export function parseAccountTransfer(
  transfer: Transfer, chainId: number, safeAddress: string, from: number, through: number,
) {
  if (
    transfer.type === "ERC721_TRANSFER" ||
    transfer.tokenInfo?.type === "ERC721" ||
    transfer.tokenId != null
  )
    return null;
  const timestamp = transfer.executionDate
    ? Date.parse(transfer.executionDate)
    : typeof transfer.timestamp === "number"
      ? transfer.timestamp < 1e12
        ? transfer.timestamp * 1000
        : transfer.timestamp
      : NaN;
  const txHash = transfer.transactionHash?.toLowerCase();
  const tokenAddress = (
    transfer.tokenAddress ??
    transfer.tokenInfo?.address ??
    zero
  ).toLowerCase();
  const transferId = transfer.transferId?.toLowerCase();
  if (
    !Number.isFinite(timestamp) ||
    timestamp < from ||
    timestamp > through ||
    !txHash ||
    !hashPattern.test(txHash) ||
    !transferId ||
    transferId.length > 512 ||
    !/^[ei][\da-f_,]+$/.test(transferId) ||
    !transferId.startsWith(
      `${tokenAddress === zero ? "i" : "e"}${txHash.slice(2)}`,
    )
  )
    throw new Error(
      "Deposit history supplied an invalid transfer identity or date",
    );
  if (
    !addressPattern.test(tokenAddress) ||
    !transfer.to ||
    !addressPattern.test(transfer.to) ||
    !transfer.from ||
    !addressPattern.test(transfer.from) ||
    (transfer.to.toLowerCase() !== safeAddress.toLowerCase() && transfer.from.toLowerCase() !== safeAddress.toLowerCase()) ||
    typeof transfer.value !== "string" ||
    !/^\d{1,100}$/.test(transfer.value)
  )
    throw new Error("Deposit history supplied invalid payment details");
  const asset = identifyAsset(
    chainId,
    tokenAddress,
    transfer.tokenInfo?.symbol ?? "UNKNOWN",
  );
  const decimals = asset.decimals ?? transfer.tokenInfo?.decimals ?? 18;
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    !Number.isSafeInteger(transfer.blockNumber) ||
    transfer.blockNumber! < 0
  )
    throw new Error("Deposit history supplied invalid units or block");
  return {
    transferId,
    txHash,
    tokenAddress,
    tokenSymbol: asset.recognized
      ? asset.token
      : (transfer.tokenInfo?.symbol ?? "UNKNOWN").slice(0, 32),
    decimals,
    amountRaw: transfer.value,
    amount: formatUnits(BigInt(transfer.value), decimals),
    timestamp,
    blockNumber: transfer.blockNumber,
    fromAddress: transfer.from.toLowerCase(),
    toAddress: transfer.to.toLowerCase(),
    source: "safe_tx_service" as const,
  };
}
