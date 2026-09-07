import { v } from 'convex/values';
import { environmentValidator } from './activityEnvironment';

export const reportAssetFields = {
  assetId: v.string(), chainId: v.optional(v.number()), tokenAddress: v.optional(v.string()),
  token: v.string(), decimals: v.optional(v.number()), recognized: v.boolean(),
  environment: environmentValidator, network: v.string(),
};
export const reportRowFields = {
  ...reportAssetFields,
  sourceId: v.union(v.id('disbursements'), v.id('deposits'), v.id('outgoingTransfers')),
  rowId: v.string(), createdAt: v.number(), amount: v.string(), status: v.string(),
  observedAt: v.optional(v.number()), dateSource: v.optional(v.union(v.literal('settlement'), v.literal('provider'), v.literal('recorded'))),
  blockNumber: v.optional(v.string()), blockHash: v.optional(v.string()),
  transferId: v.optional(v.string()), amountRaw: v.optional(v.string()),
  transferMatch: v.optional(v.union(v.literal('matched'), v.literal('pending'))),
  memo: v.optional(v.string()), txHash: v.optional(v.string()),
  beneficiaryId: v.optional(v.id('beneficiaries')), beneficiaryName: v.string(), beneficiaryWallet: v.string(),
  safeId: v.id('safes'), accountAddress: v.string(),
  kind: v.union(v.literal('payment'), v.literal('fee'), v.literal('deposit'), v.literal('account_transfer')),
  direction: v.union(v.literal('inflow'), v.literal('outflow')), includedInTotals: v.boolean(),
};
