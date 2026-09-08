import type { Log } from "viem";
import {
  assertLendingSettlement,
  decodeLendingQuote,
  lendingCall,
  lendingMarket,
  lendingQuoteHash,
  type LendingQuote,
} from "./lending";
import {
  assertConversionSettlement,
  conversionCall,
  conversionQuoteHash,
  decodeConversionQuote,
  type ConversionQuote,
} from "./conversion";
import { circleConfiguration } from "./circleExecution";
import type { CircleFeeProof } from "./circleSettlement";

export type TreasuryServiceQuote = LendingQuote | ConversionQuote;
export function decodeTreasuryServiceQuote(raw: string): TreasuryServiceQuote {
  if (raw.length > 12_000)
    throw new Error("The saved treasury review is too large.");
  return JSON.parse(raw)?.provider === "uniswap_v3"
    ? decodeConversionQuote(raw)
    : decodeLendingQuote(raw);
}
export const treasuryServiceCall = (q: TreasuryServiceQuote) =>
  q.provider === "aave_v3" ? lendingCall(q) : conversionCall(q);
export const treasuryServiceHash = (q: TreasuryServiceQuote) =>
  q.provider === "aave_v3" ? lendingQuoteHash(q) : conversionQuoteHash(q);
export function treasuryServicePrincipalUSDC(q: TreasuryServiceQuote) {
  const feeToken = circleConfiguration(q.chainId).token.toLowerCase();
  if (q.provider === "uniswap_v3")
    return q.tokenIn.toLowerCase() === feeToken ? q.maximumInput : "0";
  return q.kind === "supply" &&
    lendingMarket(q.chainId).asset.toLowerCase() === feeToken
    ? q.amount
    : "0";
}
export function assertTreasuryServiceSettlement(
  q: TreasuryServiceQuote,
  logs: Log[],
  boundary: {
    executionStart: number;
    executionEnd: number;
    feeProof?: CircleFeeProof;
  },
): { logIndex: number | null; amount: string; outputLogIndex?: number | null } {
  return q.provider === "aave_v3"
    ? assertLendingSettlement(q, logs, boundary)
    : assertConversionSettlement(q, logs, boundary);
}
