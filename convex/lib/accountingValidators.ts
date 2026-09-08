import { v } from 'convex/values';
export const bookCurrency = v.union(v.literal('USD'), v.literal('EUR'), v.literal('GBP'), v.literal('CAD'), v.literal('AUD'), v.literal('JPY'));
export const accountKind = v.union(v.literal('asset'), v.literal('payable'), v.literal('receivable'), v.literal('liability'), v.literal('equity'), v.literal('income'), v.literal('expense'));
export const accountingTreatment = v.union(v.literal('existing_payable'), v.literal('existing_receivable'), v.literal('expense'), v.literal('customer_advance'), v.literal('customer_refund'), v.literal('credit_note'), v.literal('internal_transfer'), v.literal('investment_deposit'), v.literal('investment_withdrawal'), v.literal('currency_conversion'), v.literal('fee'), v.literal('already_recorded'));
export const accountingSource = v.object({ kind: v.union(v.literal('activity'), v.literal('receipt'), v.literal('credit_note')), id: v.string() });
export const bookAccount = v.object({ id: v.string(), externalId: v.string(), name: v.string(), kind: accountKind, version: v.number() });
export const journalLine = v.object({ account: bookAccount, debit: v.string(), credit: v.string(), name: v.optional(v.string()) });
export const accountingFact = v.object({
  key: v.string(), source: accountingSource, fingerprint: v.string(), label: v.string(),
  chainId: v.number(), token: v.string(), tokenAddress: v.string(), amount: v.string(), amountRaw: v.string(), decimals: v.number(),
  transferId: v.optional(v.string()), txHash: v.optional(v.string()), blockNumber: v.optional(v.string()), blockHash: v.optional(v.string()), settledAt: v.number(),
  dateSource: v.union(v.literal('settlement'), v.literal('provider'), v.literal('document')), environment: v.union(v.literal('production'), v.literal('test')),
  safeId: v.id('safes'), accountAddress: v.string(), accountName: v.string(), counterpartyAddress: v.string(),
  direction: v.union(v.literal('inflow'), v.literal('outflow'), v.literal('noncash')), companyTransfer: v.boolean(), companyAccountName: v.optional(v.string()),
  nonCash: v.optional(v.literal('credit_note')), customerRefund: v.optional(v.boolean()),
  invoiceAppliedRaw: v.optional(v.string()), invoiceExcessRaw: v.optional(v.string()),
  treasuryTransferId: v.optional(v.id('treasuryTransfers')), deliveryFeeRaw: v.optional(v.string()),
  treasuryServiceId: v.optional(v.id('treasuryServices')), conversionMovement: v.optional(v.union(v.literal('inflow'), v.literal('outflow'))), lendingMovement: v.optional(v.union(v.literal('supply'), v.literal('withdraw'))),
  references: v.array(v.object({ kind: v.union(v.literal('bill'), v.literal('invoice'), v.literal('credit_note')), id: v.string(), number: v.string() })),
});
export const reviewInput = {
  source: accountingSource, expectedFingerprint: v.string(), postingDate: v.string(), treatment: accountingTreatment,
  assetAccountId: v.optional(v.id('accountingAccounts')), counterAccountId: v.optional(v.id('accountingAccounts')),
  differenceAccountId: v.optional(v.id('accountingAccounts')),
  advanceAccountId: v.optional(v.id('accountingAccounts')), advanceBookValue: v.optional(v.string()),
  deliveryFeeAccountId: v.optional(v.id('accountingAccounts')), deliveryFeeBookValue: v.optional(v.string()),
  assetBookValue: v.string(), obligationBookValue: v.optional(v.string()), bookReference: v.string(),
  externalName: v.optional(v.string()), valuationEvidence: v.string(), memo: v.string(),
};
