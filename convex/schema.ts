import { delegatedIntentValidator } from "./lib/delegatedIntent";
import {
  policyIntentValidator,
  policyFeeValidator,
  policyExecutionValidator,
} from "./lib/spendingPolicyValidators";
import { ownerProposalValidator } from "./lib/ownerProposalValidator";
import { defineSchema, defineTable } from "convex/server";
import {
  accountingFact,
  accountingTreatment,
  accountKind,
  bookCurrency,
  journalLine,
} from "./lib/accountingValidators";
import { v } from "convex/values";
import {
  payoutDetailsValidator,
  verificationMethodValidator,
} from "./lib/recipientValidators";
import {
  sdnEntryFields,
  screeningInputValidator,
  screeningMatchValidator,
} from "./lib/sanctionsValidators";
import { reportAssetFields, reportRowFields } from "./lib/reportValidators";
import { settlementBlockValidator } from "./lib/settlementBlock";
import { balanceProof } from "./lib/balanceProof";
import {
  licenseTierValidator,
  licenseGrantValidator,
} from "./lib/licenseValidators";
import { circleFeeProofValidator } from "./lib/circleFeeProof";

export default defineSchema({
  paymentSchedules: defineTable({
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    disbursementId: v.id("disbursements"),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    validAfter: v.number(),
    validUntil: v.number(),
    intentHash: v.string(),
    call: v.object({
      to: v.string(),
      data: v.string(),
      operation: v.union(v.literal(0), v.literal(1)),
    }),
    executionId: v.optional(v.id("circleExecutions")),
    cancellationExecutionId: v.optional(v.id("circleExecutions")),
    armedBy: v.optional(v.id("users")),
    dispatchAt: v.optional(v.number()),
    checks: v.number(),
    cancellationRequestedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    status: v.union(
      v.literal("review"),
      v.literal("armed"),
      v.literal("paused"),
      v.literal("processing"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
  })
    .index("by_payment", ["disbursementId"])
    .index("by_dispatch", ["dispatchAt"]),
  accountFeeSetups: defineTable({
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    accountKey: v.string(),
    chainId: v.number(),
    safeAddress: v.string(),
    createdBy: v.id("users"),
    requestId: v.string(),
    handler: v.string(),
    enabled: v.boolean(),
    proposal: ownerProposalValidator,
    signatures: v.array(
      v.object({
        path: v.array(v.string()),
        owner: v.string(),
        signature: v.string(),
        digest: v.string(),
      }),
    ),
    stage: v.union(
      v.literal("approval"),
      v.literal("requested"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    open: v.boolean(),
    attempt: v.number(),
    batchId: v.string(),
    claimId: v.optional(v.string()),
    payer: v.optional(v.string()),
    callData: v.optional(v.string()),
    startBlock: v.string(),
    scanFrom: v.optional(v.string()),
    scanHash: v.optional(v.string()),
    recoveryAt: v.optional(v.number()),
    txHash: v.optional(v.string()),
    failedHashes: v.array(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_safe", ["safeId"])
    .index("by_account_open", ["accountKey", "open"])
    .index("by_request", ["orgId", "requestId"])
    .index("by_due", ["recoveryAt"]),
  walletSetups: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    chainId: v.number(),
    payer: v.string(),
    owners: v.array(v.string()),
    threshold: v.number(),
    salt: v.string(),
    address: v.string(),
    deposit: v.string(),
    requestId: v.string(),
    attempt: v.number(),
    batchId: v.string(),
    claimId: v.optional(v.string()),
    stage: v.union(
      v.literal("prepared"),
      v.literal("requested"),
      v.literal("complete"),
      v.literal("cancelled"),
    ),
    open: v.boolean(),
    startBlock: v.string(),
    scanFrom: v.optional(v.string()),
    scanHash: v.optional(v.string()),
    recoveryAt: v.optional(v.number()),
    safeId: v.optional(v.id("safes")),
    txHash: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_open", ["orgId", "open"])
    .index("by_org_stage", ["orgId", "stage"])
    .index("by_request", ["orgId", "requestId"])
    .index("by_payer_open", ["payer", "chainId", "open"])
    .index("by_recovery", ["stage", "recoveryAt"]),
  walletSetupFailures: defineTable({
    setupId: v.id("walletSetups"),
    batchId: v.string(),
    txHash: v.string(),
    createdAt: v.number(),
  }).index("by_setup_hash", ["setupId", "txHash"]),
  accountSetups: defineTable({
    memberUserId: v.optional(v.id("users")),
    memberAddress: v.optional(v.string()),
    initialFunding: v.optional(v.string()),
    orgId: v.id("orgs"),
    parentSafeId: v.id("safes"),
    createdBy: v.id("users"),
    requestId: v.string(),
    name: v.string(),
    chainId: v.number(),
    parentAddress: v.string(),
    address: v.string(),
    salt: v.string(),
    open: v.boolean(),
    status: v.union(
      v.literal("prepared"),
      v.literal("complete"),
      v.literal("cancelled"),
    ),
    safeId: v.optional(v.id("safes")),
    txHash: v.optional(v.string()),
    recoveryAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_open", ["orgId", "open"])
    .index("by_request", ["orgId", "requestId"])
    .index("by_due", ["recoveryAt"]),
  treasuryServices: defineTable({
    settledAmount: v.optional(v.string()),
    orgId: v.id("orgs"),
    environment: v.union(v.literal("production"), v.literal("test")),
    safeId: v.id("safes"),
    chainId: v.number(),
    provider: v.literal("aave_v3"),
    kind: v.union(v.literal("supply"), v.literal("withdraw")),
    createdBy: v.id("users"),
    requestId: v.string(),
    quote: v.string(),
    hash: v.string(),
    status: v.union(v.literal("quoted"), v.literal("approving"), v.literal("processing"), v.literal("completed"), v.literal("cancelled"), v.literal("failed"), v.literal("expired")),
    open: v.boolean(),
    circleExecutionId: v.optional(v.id("circleExecutions")),
    cancellationRequestedAt: v.optional(v.number()),
    sourceTxHash: v.optional(v.string()),
    sourceTransferId: v.optional(v.string()),
    sourceSettlement: v.optional(settlementBlockValidator),
    error: v.optional(v.string()),
    recoveryAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_request", ["orgId", "requestId"])
    .index("by_safe_open", ["safeId", "open"])
    .index("by_org_environment", ["orgId", "environment"])
    .index("by_source_receipt", ["chainId", "sourceTxHash"])
    .index("by_due", ["recoveryAt"]),
  treasuryTransfers: defineTable({
    orgId: v.id("orgs"),
    environment: v.union(v.literal("production"), v.literal("test")),
    safeId: v.id("safes"),
    destinationSafeId: v.id("safes"),
    chainId: v.number(),
    destinationChainId: v.number(),
    createdBy: v.id("users"),
    requestId: v.string(),
    quote: v.string(),
    hash: v.string(),
    status: v.union(v.literal("quoted"), v.literal("approving"), v.literal("processing"), v.literal("delivering"), v.literal("completed"), v.literal("cancelled"), v.literal("failed"), v.literal("expired")),
    open: v.boolean(),
    circleExecutionId: v.optional(v.id("circleExecutions")),
    cancellationRequestedAt: v.optional(v.number()),
    sourceTxHash: v.optional(v.string()),
    sourceTransferId: v.optional(v.string()),
    sourceSettlement: v.optional(settlementBlockValidator),
    destinationTxHash: v.optional(v.string()),
    destinationTransferId: v.optional(v.string()),
    destinationScanBlock: v.optional(v.string()),
    deliveryHint: v.optional(v.string()),
    destinationSettlement: v.optional(settlementBlockValidator),
    deliveredAmount: v.optional(v.string()),
    deliveryFee: v.optional(v.string()),
    deliveryNonce: v.optional(v.string()),
    error: v.optional(v.string()),
    recoveryAt: v.optional(v.number()),
    checks: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_request", ["orgId", "requestId"])
    .index("by_safe_status", ["safeId", "status"])
    .index("by_org_environment", ["orgId", "environment"])
    .index("by_source_receipt", ["chainId", "sourceTxHash"])
    .index("by_destination_receipt", ["destinationChainId", "destinationTxHash"])
    .index("by_hash", ["hash"])
    .index("by_due", ["recoveryAt"]),
  circleExecutions: defineTable({
    treasuryServiceId: v.optional(v.id("treasuryServices")),
    treasuryTransferId: v.optional(v.id("treasuryTransfers")),
    cancelExecutionId: v.optional(v.id("circleExecutions")),
    delegatedDisbursementId: v.optional(v.id("disbursements")),
    paymentScheduleId: v.optional(v.id("paymentSchedules")),
    scheduleCancellationId: v.optional(v.id("paymentSchedules")),
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    accountKey: v.string(),
    disbursementId: v.optional(v.id("disbursements")),
    policyChangeId: v.optional(v.id("spendingPolicyChanges")),
    cancellationId: v.optional(v.id("accountCancellations")),
    receivableId: v.optional(v.id("receivables")),
    receivingSetupSafeId: v.optional(v.id("safes")),
    billingCheckoutId: v.optional(v.id("billingCheckouts")),
    accountSetupId: v.optional(v.id("accountSetups")),
    createdBy: v.id("users"),
    record: v.string(),
    revision: v.number(),
    operationApprovalStartedAt: v.optional(v.number()),
    open: v.boolean(),
    concurrentFees: v.optional(v.boolean()),
    stage: v.union(
      v.literal("fee"),
      v.literal("operation"),
      v.literal("ready"),
      v.literal("submitting"),
      v.literal("confirmed"),
      v.literal("failed"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    scanFrom: v.string(),
    scanHash: v.optional(v.string()),
    recoveryAt: v.optional(v.number()),
    userOpHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
    fee: v.optional(v.string()),
    settlement: v.optional(settlementBlockValidator),
    feeProof: v.optional(circleFeeProofValidator),
    error: v.optional(v.string()),
  })
    .index("by_treasury_service", ["treasuryServiceId"])
    .index("by_treasury_transfer", ["treasuryTransferId"])
    .index("by_payment", ["disbursementId"])
    .index("by_delegated_payment", ["delegatedDisbursementId"])
    .index("by_cancel_execution", ["cancelExecutionId"])
    .index("by_policy", ["policyChangeId"])
    .index("by_cancellation", ["cancellationId"])
    .index("by_invoice", ["receivableId"])
    .index("by_receiving_setup", ["receivingSetupSafeId"])
    .index("by_checkout", ["billingCheckoutId"])
    .index("by_account_setup", ["accountSetupId"])
    .index("by_org", ["orgId"])
    .index("by_safe_tx", ["safeId", "txHash"])
    .index("by_account_open", ["accountKey", "open"])
    .index("by_account_created", ["accountKey", "createdAt"])
    .index("by_due", ["recoveryAt"]),
  circleSignatures: defineTable({
    executionId: v.id("circleExecutions"),
    stage: v.union(v.literal("fee"), v.literal("operation")),
    pathKey: v.string(),
    path: v.array(v.string()),
    owner: v.string(),
    signature: v.string(),
    digest: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_execution_stage", ["executionId", "stage"])
    .index("by_signer", ["executionId", "stage", "pathKey", "owner"]),
  customerOperations: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    walletAddress: v.string(),
    record: v.string(),
    hash: v.string(),
    chainId: v.number(),
    safeId: v.optional(v.id("safes")),
    state: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("failed"),
      v.literal("expired"),
    ),
    open: v.boolean(),
    fee: v.string(),
    feePaid: v.boolean(),
    feeTxHash: v.optional(v.string()),
    workTxHash: v.optional(v.string()),
    workSuccess: v.optional(v.boolean()),
    createdAt: v.number(),
    checkedAt: v.optional(v.number()),
    expiresAt: v.number(),
    scanFrom: v.string(),
  })
    .index("by_owner_open", ["orgId", "userId", "open"])
    .index("by_payer_state", ["walletAddress", "chainId", "state"])
    .index("by_hash", ["hash"]),
  accountBalanceChecks: defineTable({
    orgId: v.id("orgs"),
    ...balanceProof,
    checkedBy: v.id("users"),
    checkedAt: v.number(),
  }).index("by_org_environment", ["orgId", "environment"]),
  accountingProfiles: defineTable({
    orgId: v.id("orgs"),
    currency: bookCurrency,
    bookName: v.string(),
    closedThrough: v.optional(v.string()),
    version: v.number(),
    nextJournal: v.number(),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),
  accountingAccounts: defineTable({
    orgId: v.id("orgs"),
    externalId: v.string(),
    name: v.string(),
    kind: accountKind,
    active: v.boolean(),
    version: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_external", ["orgId", "externalId"]),
  accountingMappings: defineTable({
    orgId: v.id("orgs"),
    location: v.string(),
    accountId: v.id("accountingAccounts"),
    updatedAt: v.number(),
  }).index("by_location", ["orgId", "location"]),
  accountingMovements: defineTable({
    orgId: v.id("orgs"),
    key: v.string(),
    entryId: v.id("accountingEntries"),
  }).index("by_movement", ["orgId", "key"]),
  accountingEntries: defineTable({
    orgId: v.id("orgs"),
    journalNumber: v.string(),
    fact: accountingFact,
    currency: bookCurrency,
    treatment: accountingTreatment,
    postingDate: v.string(),
    assetBookValue: v.string(),
    obligationBookValue: v.optional(v.string()),
    advanceBookValue: v.optional(v.string()),
    deliveryFeeBookValue: v.optional(v.string()),
    bookReference: v.string(),
    externalName: v.optional(v.string()),
    valuationEvidence: v.string(),
    memo: v.string(),
    lines: v.array(journalLine),
    reviewedBy: v.id("users"),
    reviewedAt: v.number(),
    profileVersion: v.number(),
    state: v.union(
      v.literal("ready"),
      v.literal("exported"),
      v.literal("reconciled"),
      v.literal("void"),
    ),
    reversalOf: v.optional(v.id("accountingEntries")),
    replaces: v.optional(v.id("accountingEntries")),
    supersededBy: v.optional(v.id("accountingEntries")),
    correctionReason: v.optional(v.string()),
    pairedEntryId: v.optional(v.id("accountingEntries")),
    exportId: v.optional(v.id("accountingExports")),
    importedReference: v.optional(v.string()),
    reconciledAt: v.optional(v.number()),
  })
    .index("by_org_date", ["orgId", "postingDate"])
    .index("by_org_state", ["orgId", "state"])
    .index("by_org_state_date", ["orgId", "state", "postingDate"])
    .index("by_movement", ["orgId", "fact.key"]),
  accountingExports: defineTable({
    orgId: v.id("orgs"),
    requestId: v.string(),
    entryIds: v.array(v.id("accountingEntries")),
    currency: bookCurrency,
    environment: v.union(v.literal("production"), v.literal("test")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    importedAt: v.optional(v.number()),
    importedReference: v.optional(v.string()),
  })
    .index("by_request", ["orgId", "requestId"])
    .index("by_org", ["orgId"]),
  reportEntries: defineTable({
    orgId: v.id("orgs"),
    sourceKey: v.string(),
    unclassified: v.boolean(),
    ...reportRowFields,
  })
    .index("by_account_asset_time", ["orgId", "safeId", "assetId", "createdAt"])
    .index("by_org_row", ["orgId", "rowId"])
    .index("by_source", ["sourceKey"])
    .index("by_org_environment_time", ["orgId", "environment", "createdAt"])
    .index("by_org_asset_time", ["orgId", "assetId", "createdAt"])
    .index("by_org_environment_token_time", [
      "orgId",
      "environment",
      "token",
      "createdAt",
    ])
    .index("by_org_environment_chain_time", [
      "orgId",
      "environment",
      "chainId",
      "createdAt",
    ])
    .index("by_org_unclassified_time", ["orgId", "unclassified", "createdAt"])
    .index("by_org_environment_recipient_time", [
      "orgId",
      "environment",
      "beneficiaryId",
      "createdAt",
    ]),
  reportTotals: defineTable({
    orgId: v.id("orgs"),
    dimension: v.string(),
    period: v.string(),
    ...reportAssetFields,
    inflowRaw: v.string(),
    outflowRaw: v.string(),
    count: v.number(),
  }).index("by_bucket", [
    "orgId",
    "environment",
    "dimension",
    "period",
    "assetId",
  ]),
  reportAssets: defineTable({
    orgId: v.id("orgs"),
    unclassified: v.boolean(),
    ...reportAssetFields,
    firstAt: v.number(),
    lastAt: v.number(),
    count: v.number(),
  })
    .index("by_asset", ["orgId", "assetId"])
    .index("by_org_environment", ["orgId", "environment"])
    .index("by_org_unclassified", ["orgId", "unclassified"])
    .index("by_org_unclassified_address", [
      "orgId",
      "unclassified",
      "tokenAddress",
    ])
    .index("by_org_environment_address", [
      "orgId",
      "environment",
      "tokenAddress",
    ]),
  reportRecipientAssets: defineTable({
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    ...reportAssetFields,
    count: v.number(),
  })
    .index("by_recipient_asset", ["orgId", "beneficiaryId", "assetId"])
    .index("by_org_environment", ["orgId", "environment"]),
  reportIndexStates: defineTable({
    orgId: v.id("orgs"),
    stage: v.union(
      v.literal("payments"),
      v.literal("deposits"),
      v.literal("outgoing"),
      v.literal("fees"),
      v.literal("treasury"),
      v.literal("services"),
      v.literal("done"),
    ),
    cursor: v.optional(v.string()),
    pending: v.number(),
    revision: v.number(),
    firstAt: v.optional(v.number()),
    completeAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),
  reportIndexJobs: defineTable({
    orgId: v.id("orgs"),
    sourceKey: v.string(),
    sourceId: v.union(
      v.id("disbursements"),
      v.id("deposits"),
      v.id("outgoingTransfers"),
      v.id("circleExecutions"),
      v.id("treasuryTransfers"),
      v.id("treasuryServices"),
    ),
    kind: v.union(
      v.literal("payment"),
      v.literal("deposit"),
      v.literal("outgoing"),
      v.literal("fee"),
      v.literal("treasury"),
      v.literal("service"),
    ),
    nextAt: v.number(),
    attempts: v.number(),
    error: v.optional(v.string()),
    hasError: v.boolean(),
  })
    .index("by_source", ["sourceKey"])
    .index("by_due", ["nextAt"])
    .index("by_org_error", ["orgId", "hasError"]),
  reportMaintenance: defineTable({
    key: v.string(),
    cursor: v.optional(v.string()),
  }).index("by_key", ["key"]),
  ownerProposals: defineTable({
    disbursementId: v.id("disbursements"),
    proposal: ownerProposalValidator,
    createdAt: v.number(),
  }).index("by_payment", ["disbursementId"]),
  accountCancellations: defineTable({
    checks: v.optional(v.number()),
    settlement: v.optional(settlementBlockValidator),
    originalProposalId: v.id("accountProposals"),
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    chainId: v.number(),
    safeAddress: v.string(),
    originalHash: v.string(),
    nonce: v.number(),
    safeTxHash: v.string(),
    createdBy: v.id("users"),
    searchFromBlock: v.string(),
    executionFee: v.optional(policyFeeValidator),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("applied"),
      v.literal("failed"),
    ),
    execution: v.optional(policyExecutionValidator),
    recoveryAt: v.optional(v.number()),
    error: v.optional(v.string()),
    txHash: v.optional(v.string()),
    appliedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_original", ["originalProposalId"])
    .index("by_safe_status", ["safeId", "status"])
    .index("by_recovery", ["recoveryAt"]),
  spendingPolicyChanges: defineTable({
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    chainId: v.number(),
    safeAddress: v.string(),
    cancellationId: v.optional(v.id("accountCancellations")),
    cancellationConfirmedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    requestId: v.string(),
    intent: policyIntentValidator,
    executionFee: v.optional(policyFeeValidator),
    safeTxHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("applied"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    execution: v.optional(policyExecutionValidator),
    recoveryAt: v.optional(v.number()),
    error: v.optional(v.string()),
    txHash: v.optional(v.string()),
    appliedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_safe_status", ["safeId", "status"])
    .index("by_org", ["orgId"])
    .index("by_request", ["orgId", "requestId"])
    .index("by_recovery", ["recoveryAt"]),
  accountProposals: defineTable({
    accountFeeSetupId: v.optional(v.id("accountFeeSetups")),
    disbursementId: v.optional(v.id("disbursements")),
    policyChangeId: v.optional(v.id("spendingPolicyChanges")),
    cancellationId: v.optional(v.id("accountCancellations")),
    accountKey: v.string(),
    nonce: v.number(),
    proposal: ownerProposalValidator,
    createdAt: v.number(),
  })
    .index("by_fee_setup", ["accountFeeSetupId"])
    .index("by_payment", ["disbursementId"])
    .index("by_account_nonce", ["accountKey", "nonce"])
    .index("by_policy", ["policyChangeId"])
    .index("by_cancellation", ["cancellationId"]),
  accountSignatures: defineTable({
    disbursementId: v.optional(v.id("disbursements")),
    policyChangeId: v.optional(v.id("spendingPolicyChanges")),
    cancellationId: v.optional(v.id("accountCancellations")),
    pathKey: v.string(),
    path: v.array(v.string()),
    owner: v.string(),
    signature: v.string(),
    digest: v.string(),
    actorUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_payment", ["disbursementId"])
    .index("by_payment_signer", ["disbursementId", "pathKey", "owner"])
    .index("by_policy", ["policyChangeId"])
    .index("by_policy_signer", ["policyChangeId", "pathKey", "owner"])
    .index("by_cancellation", ["cancellationId"])
    .index("by_cancellation_signer", ["cancellationId", "pathKey", "owner"]),
  receivables: defineTable({
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    createdBy: v.id("users"),
    number: v.string(),
    normalizedNumber: v.string(),
    customerName: v.string(),
    customerEmail: v.optional(v.string()),
    description: v.string(),
    items: v.array(
      v.object({
        description: v.string(),
        quantity: v.number(),
        unitPrice: v.string(),
      }),
    ),
    token: v.string(),
    tokenAddress: v.string(),
    chainId: v.number(),
    treasury: v.string(),
    amount: v.string(),
    dueDate: v.number(),
    state: v.union(v.literal("draft"), v.literal("issued"), v.literal("void")),
    publicToken: v.optional(v.string()),
    factory: v.optional(v.string()),
    salt: v.optional(v.string()),
    receivingAddress: v.optional(v.string()),
    scanFromBlock: v.optional(v.string()),
    issuedAt: v.optional(v.number()),
    voidedAt: v.optional(v.number()),
    received: v.string(),
    forwarded: v.string(),
    revision: v.optional(v.number()),
    lastCheckedAt: v.optional(v.number()),
    nextScanAt: v.optional(v.number()),
    syncError: v.optional(v.string()),
    sweepState: v.optional(
      v.union(
        v.literal("submitting"),
        v.literal("submitted"),
        v.literal("attention"),
      ),
    ),
    sweepProviderId: v.optional(v.string()),
    sweepAttemptAt: v.optional(v.number()),
    sweepError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_number", ["orgId", "normalizedNumber"])
    .index("by_public", ["publicToken"])
    .index("by_issued_scan", ["state", "nextScanAt"])
    .index("by_receiving_address", ["orgId", "chainId", "receivingAddress"]),
  receivableEvents: defineTable({
    invoiceId: v.id("receivables"),
    orgId: v.id("orgs"),
    key: v.string(),
    kind: v.union(v.literal("received"), v.literal("forwarded")),
    amount: v.string(),
    txHash: v.string(),
    logIndex: v.number(),
    blockNumber: v.string(),
    blockHash: v.string(),
    recordedAt: v.number(),
    settledAt: v.optional(v.number()),
    fromAddress: v.optional(v.string()),
    toAddress: v.optional(v.string()),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_invoice_key", ["invoiceId", "key"])
    .index("by_org_time", ["orgId", "recordedAt"]),
  // Users - wallet address is the primary identity
  users: defineTable({
    walletAddress: v.string(),
    email: v.optional(v.string()),
    preferredLanguage: v.optional(
      v.union(v.literal("en"), v.literal("es"), v.literal("pt-BR")),
    ),
    preferredTheme: v.optional(v.union(v.literal("dark"), v.literal("light"))),
    createdAt: v.number(),
  }).index("by_wallet", ["walletAddress"]),

  // Sessions for auth.
  // Lifecycle: generateNonce inserts a PENDING row (nonce set, tokenHash unset,
  // short expiry). verifySignature consumes the nonce server-side (signature is
  // cryptographically verified) and inserts an AUTHENTICATED row (tokenHash set,
  // raw token returned to client exactly once). All privileged functions resolve
  // the caller's identity exclusively from sessionToken -> tokenHash lookup.
  sessions: defineTable({
    userId: v.id("users"),
    walletAddress: v.string(),
    nonce: v.optional(v.string()), // set on pending rows only
    tokenHash: v.optional(v.string()), // SHA-256 hex of the opaque session token; never store raw tokens
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_wallet", ["walletAddress"])
    .index("by_nonce", ["nonce"])
    .index("by_tokenHash", ["tokenHash"]),

  // Organizations
  orgs: defineTable({
    screeningMaxAgeHours: v.optional(v.number()),
    name: v.string(),
    createdBy: v.id("users"),
    screeningEnforcement: v.optional(
      v.union(v.literal("block"), v.literal("warn"), v.literal("off")),
    ),
    relayFeeTokenSymbol: v.optional(v.string()),
    relayFeeMode: v.optional(
      v.union(v.literal("stablecoin_preferred"), v.literal("stablecoin_only")),
    ),
    createdAt: v.number(),
  }).searchIndex("search_name", { searchField: "name" }),

  // Organization memberships with roles
  orgMemberships: defineTable({
    emailVerifiedAt: v.optional(v.number()),
    emailVerificationInviteId: v.optional(v.id("teamInvitations")),
    invitedBy: v.optional(v.id("users")),
    invitedAt: v.optional(v.number()),
    invitationExpiresAt: v.optional(v.number()),
    paymentPolicy: v.optional(
      v.object({
        token: v.string(),
        perPayment: v.optional(v.string()),
        perMonth: v.optional(v.string()),
      }),
    ),
    orgId: v.id("orgs"),
    userId: v.id("users"),
    name: v.optional(v.string()), // Optional display name for the member
    email: v.optional(v.string()), // Optional email for the member
    role: v.union(
      v.literal("admin"),
      v.literal("approver"),
      v.literal("initiator"),
      v.literal("clerk"),
      v.literal("viewer"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("invited"),
      v.literal("removed"),
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_and_user", ["orgId", "userId"]),

  // Funding accounts: at most one active Safe per org and chain. Archived rows preserve payment history.
  teamInvitations: defineTable({
    orgId: v.id("orgs"),
    email: v.string(),
    name: v.optional(v.string()),
    role: v.union(
      v.literal("admin"),
      v.literal("approver"),
      v.literal("initiator"),
      v.literal("clerk"),
      v.literal("viewer"),
    ),
    expectedWallet: v.optional(v.string()),
    tokenHash: v.string(),
    requestId: v.string(),
    requestHash: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
    ),
    deliveryId: v.optional(v.id("emailDeliveries")),
    acceptedBy: v.optional(v.id("users")),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_org", ["orgId"])
    .index("by_org_email", ["orgId", "email"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_request", ["orgId", "requestId"]),
  emailDeliveries: defineTable({
    orgId: v.id("orgs"),
    invitationId: v.id("teamInvitations"),
    context: v.string(),
    sealedPayload: v.optional(v.string()),
    status: v.union(
      v.literal("ready_to_share"),
      v.literal("queued"),
      v.literal("sending"),
      v.literal("submitted"),
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("failed"),
      v.literal("unknown"),
      v.literal("cancelled"),
    ),
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    firstAttemptAt: v.optional(v.number()),
    leaseUntil: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    providerId: v.optional(v.string()),
    error: v.optional(v.string()),
    providerEventAt: v.optional(v.number()),
    providerEventId: v.optional(v.string()),
  })
    .index("by_next_attempt", ["nextAttemptAt"])
    .index("by_provider", ["providerId"]),

  safes: defineTable({
    assignedUserId: v.optional(v.id("users")),
    name: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    owners: v.optional(v.array(v.string())),
    threshold: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    orgId: v.id("orgs"),
    chainId: v.number(),
    safeAddress: v.string(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_chain", ["orgId", "chainId"])
    .index("by_org_chain_address", ["orgId", "chainId", "safeAddress"])
    .index("by_address", ["safeAddress"]),

  // Beneficiaries (payment recipients)
  beneficiaries: defineTable({
    nextScreeningAt: v.optional(v.number()),
    screeningAttempt: v.optional(v.number()),
    sourceSystem: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    payoutVersion: v.optional(v.number()),
    payoutReviewStatus: v.optional(
      v.union(v.literal("unreviewed"), v.literal("approved")),
    ),
    payoutReviewedAt: v.optional(v.number()),
    payoutReviewedBy: v.optional(v.id("users")),
    pendingPayoutChangeId: v.optional(v.id("recipientChanges")),
    detailRequestId: v.optional(v.id("recipientCollections")),
    detailRequestExpiresAt: v.optional(v.number()),
    email: v.optional(v.string()),
    orgId: v.id("orgs"),
    // Optional for backwards compatibility with existing records (defaults to "individual")
    type: v.optional(v.union(v.literal("individual"), v.literal("business"))),
    name: v.string(),
    walletAddress: v.string(),
    notes: v.optional(v.string()),
    preferredToken: v.optional(v.string()),
    preferredChainId: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_active", ["orgId", "isActive"])
    .index("by_active_screening_due", ["isActive", "nextScreeningAt"])
    .index("by_org_source", ["orgId", "sourceSystem", "sourceId"]),

  recipientImportBatches: defineTable({
    orgId: v.id("orgs"),
    requestId: v.string(),
    requestHash: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    created: v.number(),
    updated: v.number(),
    reviewRequested: v.number(),
    recipientIds: v.array(v.id("beneficiaries")),
  }).index("by_org_request", ["orgId", "requestId"]),

  recipientCollections: defineTable({
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    tokenHash: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
    recipientFingerprint: v.string(),
    chainIds: v.array(v.number()),
    status: v.union(
      v.literal("requested"),
      v.literal("submitted"),
      v.literal("revoked"),
    ),
    revokedAt: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
    submissionHash: v.optional(v.string()),
    changeId: v.optional(v.id("recipientChanges")),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_recipient", ["beneficiaryId"]),

  recipientChanges: defineTable({
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    before: payoutDetailsValidator,
    proposed: payoutDetailsValidator,
    baseVersion: v.number(),
    requestedBy: v.id("users"),
    requestedAt: v.number(),
    collectionId: v.optional(v.id("recipientCollections")),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("withdrawn"),
    ),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    verificationMethod: v.optional(verificationMethodValidator),
    reason: v.optional(v.string()),
  })
    .index("by_org_status", ["orgId", "status"])
    .index("by_recipient", ["beneficiaryId"]),

  // Beneficiary tags (org-wide labels)
  tags: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    normalizedName: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_normalized", ["orgId", "normalizedName"]),

  // Beneficiary tag assignments
  beneficiaryTags: defineTable({
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    tagId: v.id("tags"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_beneficiary", ["beneficiaryId"])
    .index("by_tag", ["tagId"])
    .index("by_org_beneficiary", ["orgId", "beneficiaryId"])
    .index("by_org_tag", ["orgId", "tagId"]),

  invoiceFiles: defineTable({
    orgId: v.id("orgs"),
    storageId: v.id("_storage"),
    invoiceId: v.optional(v.id("invoices")),
    requestId: v.string(),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    sha256: v.string(),
    uploadedBy: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_request", ["orgId", "requestId"])
    .index("by_expiry", ["expiresAt"])
    .index("by_user_unattached", ["uploadedBy", "invoiceId"]),

  invoices: defineTable({
    sourceReviewedBy: v.optional(v.id("users")),
    sourceReviewedAt: v.optional(v.number()),
    requestId: v.optional(v.string()),
    requestHash: v.optional(v.string()),
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    invoiceNumber: v.string(),
    normalizedNumber: v.string(),
    amount: v.string(),
    token: v.string(),
    dueDate: v.number(),
    description: v.optional(v.string()),
    disbursementId: v.optional(v.id("disbursements")),
    voidedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_payment", ["disbursementId"])
    .index("by_org_request", ["orgId", "requestId"])
    .index("by_org_vendor_number", [
      "orgId",
      "beneficiaryId",
      "normalizedNumber",
    ]),

  // Recurring pay runs prepare drafts; each run still needs Safe approval.
  recurringPayments: defineTable({
    orgId: v.id("orgs"),
    safeId: v.optional(v.id("safes")),
    name: v.string(),
    purpose: v.union(
      v.literal("payroll"),
      v.literal("invoice"),
      v.literal("other"),
    ),
    chainId: v.number(),
    token: v.string(),
    recipients: v.array(
      v.object({ beneficiaryId: v.id("beneficiaries"), amount: v.string() }),
    ),
    cadence: v.union(
      v.literal("weekly"),
      v.literal("biweekly"),
      v.literal("monthly"),
    ),
    anchorDay: v.number(),
    nextPayDate: v.number(),
    status: v.union(v.literal("active"), v.literal("paused")),
    version: v.number(),
    createdBy: v.id("users"),
    lastDisbursementId: v.optional(v.id("disbursements")),
    pauseReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Disbursements (payment intents)
  paymentNotifications: defineTable({
    orgId: v.id("orgs"),
    disbursementId: v.optional(v.id("disbursements")),
    recurringPaymentId: v.optional(v.id("recurringPayments")),
    environment: v.union(
      v.literal("production"),
      v.literal("test"),
      v.literal("unclassified"),
    ),
    phase: v.string(),
    revisionKey: v.string(),
    revision: v.number(),
    isOpen: v.boolean(),
    coordinatorUserId: v.id("users"),
    assignedUserIds: v.array(v.id("users")),
    owners: v.array(v.string()),
    ownershipCheckedAt: v.optional(v.number()),
    ownershipBlock: v.optional(v.string()),
    ownershipError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_payment", ["disbursementId"])
    .index("by_series", ["recurringPaymentId"])
    .index("by_org_open", ["orgId", "environment", "isOpen", "updatedAt"]),
  paymentNotificationReads: defineTable({
    notificationId: v.id("paymentNotifications"),
    userId: v.id("users"),
    revision: v.number(),
    readAt: v.number(),
  }).index("by_notification_user", ["notificationId", "userId"]),

  disbursements: defineTable({
    allowanceFeeSafeId: v.optional(v.id("safes")),
    allowanceCircleExecutionId: v.optional(v.id("circleExecutions")),
    allowanceCancellationRequestedAt: v.optional(v.number()),
    paymentScheduleId: v.optional(v.id("paymentSchedules")),
    cancellationId: v.optional(v.id("accountCancellations")),
    cancellationConfirmedAt: v.optional(v.number()),
    settlement: v.optional(settlementBlockValidator),
    executionFailure: v.optional(
      v.object({
        safeTxHash: v.string(),
        txHash: v.string(),
        block: settlementBlockValidator,
      }),
    ),
    followupAt: v.optional(v.number()),
    followupAttempt: v.optional(v.number()),
    payoutVersion: v.optional(v.number()),
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    name: v.optional(v.string()),
    recipientAddress: v.optional(v.string()),
    recipientName: v.optional(v.string()),
    purpose: v.optional(
      v.union(v.literal("payroll"), v.literal("invoice"), v.literal("other")),
    ),
    recurringPaymentId: v.optional(v.id("recurringPayments")),
    chainId: v.optional(v.number()), // Required for new records; backfilled for existing
    beneficiaryId: v.optional(v.id("beneficiaries")), // Optional for batch disbursements
    token: v.string(), // "USDC", "USDT", "PYUSD", etc.
    tokenAddress: v.optional(v.string()), // Contract pinned when the payment is prepared
    preparedProposalAt: v.optional(v.number()),
    approvalMethod: v.optional(v.literal("workspace")),
    nativeExecution: v.optional(
      v.object({
        service: v.optional(v.literal("circle")),
        attemptId: v.optional(v.string()),
        actorUserId: v.optional(v.id("users")),
        walletRejectedAt: v.optional(v.number()),
        revertedAt: v.optional(v.number()),
        revertedTxHash: v.optional(v.string()),
        startedAt: v.number(),
        searchFromBlock: v.optional(v.string()),
        checkedAt: v.optional(v.number()),
        checks: v.number(),
      }),
    ),
    nativeRecoveryAt: v.optional(v.number()),
    amount: v.optional(v.string()), // Optional for batch disbursements (stored as string to preserve precision)
    totalAmount: v.optional(v.string()), // For batch disbursements, sum of all recipient amounts
    type: v.optional(v.union(v.literal("single"), v.literal("batch"))), // Defaults to "single" for backward compatibility
    memo: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("proposed"),
      v.literal("scheduled"),
      v.literal("relaying"),
      v.literal("executed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    delegatedBy: v.optional(v.id("users")),
    delegationKey: v.optional(v.string()),
    allowanceExecution: v.optional(delegatedIntentValidator),
    safeTxHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
    relayTaskId: v.optional(v.string()),
    executionFee: v.optional(
      v.object({
        token: v.string(),
        tokenAddress: v.string(),
        collector: v.string(),
        amount: v.string(),
      }),
    ),
    relayStatus: v.optional(v.string()),
    relayFeeToken: v.optional(v.string()),
    relayFeeTokenSymbol: v.optional(v.string()),
    relayFeeMode: v.optional(
      v.union(v.literal("stablecoin_preferred"), v.literal("stablecoin_only")),
    ),
    relayError: v.optional(v.string()),
    scheduledAt: v.optional(v.number()), // epoch ms when relay should fire
    scheduledJobId: v.optional(v.string()), // "sched_{disbursementId}_{version}" - audit trail only
    scheduledVersion: v.optional(v.number()), // increments on reschedule/cancel for idempotency
    executedAt: v.optional(v.number()), // epoch ms when disbursement executed
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_native_recovery", ["nativeRecoveryAt"])
    .index("by_followup", ["followupAt"])
    .index("by_org_chain", ["orgId", "chainId"])
    .index("by_safe", ["safeId"])
    .index("by_org_creator", ["orgId", "createdBy"])
    .index("by_org_created", ["orgId", "createdAt"])
    .index("by_creator_created", ["orgId", "createdBy", "createdAt"])
    .index("by_creator_scheduled", ["orgId", "createdBy", "scheduledAt"])
    .index("by_delegate_created", ["orgId", "delegatedBy", "createdAt"])
    .index("by_delegate_scheduled", ["orgId", "delegatedBy", "scheduledAt"])
    .index("by_safe_tx", ["safeId", "txHash"])
    .index("by_org_delegate", ["orgId", "delegatedBy"])
    .index("by_org_scheduledAt", ["orgId", "scheduledAt"])
    .index("by_recurring_pay_date", ["recurringPaymentId", "scheduledAt"])
    .index("by_delegation_key", ["delegationKey"]),

  delegationReservations: defineTable({
    key: v.string(),
    disbursementId: v.id("disbursements"),
  }).index("by_key", ["key"]),
  relayJobs: defineTable({
    disbursementId: v.id("disbursements"),
    orgId: v.id("orgs"),
    chainId: v.number(),
    safeTxHash: v.string(),
    to: v.string(),
    data: v.string(),
    searchFromBlock: v.optional(v.string()),
    provider: v.literal("gelato_turbo"),
    providerId: v.optional(v.string()),
    txHash: v.optional(v.string()),
    status: v.union(
      v.literal("prepared"),
      v.literal("submitting"),
      v.literal("submitted"),
      v.literal("confirmed"),
      v.literal("failed"),
      v.literal("exception"),
    ),
    neverSubmitted: v.optional(v.boolean()),
    error: v.optional(v.string()),
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_payment", ["disbursementId"])
    .index("by_status", ["status"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_org_status", ["orgId", "status"]),

  deposits: defineTable({
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    chainId: v.number(),
    safeAddress: v.string(),
    tokenAddress: v.string(),
    tokenSymbol: v.string(),
    decimals: v.number(),
    amountRaw: v.string(),
    amount: v.string(),
    txHash: v.string(),
    transferId: v.optional(v.string()),
    supersededBy: v.optional(v.id("deposits")),
    legacyRecord: v.optional(
      v.object({
        amount: v.string(),
        amountRaw: v.string(),
        tokenSymbol: v.string(),
        decimals: v.number(),
        reconciledAt: v.number(),
      }),
    ),
    blockNumber: v.optional(v.number()),
    timestamp: v.number(), // epoch ms when transfer was recorded
    fromAddress: v.optional(v.string()),
    toAddress: v.string(),
    source: v.literal("safe_tx_service"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_time", ["orgId", "timestamp"])
    .index("by_safe", ["safeId"])
    .index("by_safe_time", ["safeId", "timestamp"])
    .index("by_safe_transfer", ["safeId", "transferId"])
    .index("by_safe_tx", ["safeId", "txHash"])
    .index("by_tx", ["chainId", "txHash", "tokenAddress", "toAddress"]),

  // Outgoing chain evidence, including payments made outside Disburse. Incoming
  // evidence retains its existing deposits IDs for export/migration compatibility.
  outgoingTransfers: defineTable({
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    chainId: v.number(),
    safeAddress: v.string(),
    tokenAddress: v.string(),
    tokenSymbol: v.string(),
    decimals: v.number(),
    amountRaw: v.string(),
    amount: v.string(),
    txHash: v.string(),
    transferId: v.string(),
    blockNumber: v.optional(v.number()),
    timestamp: v.number(),
    fromAddress: v.string(),
    toAddress: v.string(),
    source: v.literal("safe_tx_service"),
    createdAt: v.number(),
    paymentRowId: v.optional(v.string()),
    paymentId: v.optional(v.id("disbursements")),
    reconciliationId: v.optional(v.string()),
    matchError: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_safe_transfer", ["safeId", "transferId"])
    .index("by_safe_tx", ["safeId", "txHash"])
    .index("by_payment_row", ["paymentRowId"]),

  // Account-transfer sync checkpoints (per Safe); legacy cursors finish before upgrading.
  depositSyncs: defineTable({
    orgId: v.id("orgs"),
    safeId: v.id("safes"),
    chainId: v.number(),
    lastSyncedAt: v.number(),
    completedThrough: v.optional(v.number()),
    lastFullScanAt: v.optional(v.number()),
    historyScope: v.optional(v.literal("all")),
    generation: v.optional(v.number()),
    scan: v.optional(
      v.object({
        from: v.number(),
        through: v.number(),
        cursor: v.string(),
        page: v.number(),
        full: v.boolean(),
        scope: v.optional(v.literal("all")),
      }),
    ),
    leaseUntil: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    error: v.optional(v.string()),
    failures: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_safe", ["safeId"])
    .index("by_next_attempt", ["nextAttemptAt"]),

  // Disbursement recipients (for batch disbursements)
  disbursementRecipients: defineTable({
    payoutVersion: v.optional(v.number()),
    disbursementId: v.id("disbursements"),
    beneficiaryId: v.id("beneficiaries"),
    recipientAddress: v.string(), // Immutable payout destination for this payment
    recipientName: v.optional(v.string()),
    amount: v.string(), // Human-readable amount
    createdAt: v.number(),
  })
    .index("by_disbursement", ["disbursementId"])
    .index("by_beneficiary", ["beneficiaryId"]),

  billingCheckouts: defineTable({
    orgId: v.id("orgs"),
    createdBy: v.id("users"),
    requestId: v.string(),
    safeId: v.optional(v.id("safes")),
    circleExecutionId: v.optional(v.id("circleExecutions")),
    plan: v.union(v.literal("starter"), v.literal("team"), v.literal("pro")),
    chainId: v.number(),
    payer: v.string(),
    treasury: v.string(),
    tokenAddress: v.string(),
    amountRaw: v.string(),
    status: v.union(
      v.literal("prepared"),
      v.literal("requested"),
      v.literal("submitted"),
      v.literal("applied"),
      v.literal("declined"),
      v.literal("reverted"),
      v.literal("cancelled"),
    ),
    active: v.boolean(),
    attemptId: v.optional(v.string()),
    nonce: v.optional(v.number()),
    fromBlock: v.optional(v.string()),
    txHash: v.optional(v.string()),
    replacementHash: v.optional(v.string()),
    checks: v.number(),
    error: v.optional(v.string()),
    recoveryAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_active", ["orgId", "active"])
    .index("by_payer_active", ["chainId", "payer", "active"])
    .index("by_request", ["orgId", "requestId"])
    .index("by_recovery", ["recoveryAt"]),

  // Verified subscription payments (server-verified on-chain before plan activation)
  billingPayments: defineTable({
    checkoutId: v.optional(v.id("billingCheckouts")),
    transferId: v.optional(v.string()),
    orgId: v.id("orgs"),
    txHash: v.string(),
    chainId: v.number(),
    plan: v.union(v.literal("starter"), v.literal("team"), v.literal("pro")),
    tokenAddress: v.string(),
    amountRaw: v.string(),
    paidThroughAt: v.number(),
    verifiedAt: v.number(),
    redeemedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_checkout", ["checkoutId"])
    .index("by_transfer", ["chainId", "transferId"])
    .index("by_tx", ["txHash"]),

  // Billing records
  billing: defineTable({
    orgId: v.id("orgs"),
    trialTier: v.optional(licenseTierValidator),
    fallbackTier: v.optional(licenseTierValidator),
    licenseGrant: v.optional(licenseGrantValidator),
    licenseRevision: v.optional(v.number()),
    plan: v.union(
      v.literal("trial"),
      v.literal("starter"),
      v.literal("team"),
      v.literal("pro"),
    ),
    trialEndsAt: v.optional(v.number()),
    paidThroughAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("trial"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  licenseTiers: defineTable({
    name: v.string(),
    maxUsers: v.union(v.number(), v.null()),
    maxBeneficiaries: v.union(v.number(), v.null()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }),
  licensePrograms: defineTable({
    key: v.literal("default"),
    trialDays: v.number(),
    trialTier: licenseTierValidator,
    fallbackTier: v.optional(licenseTierValidator),
    revision: v.number(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  licenseEvents: defineTable({
    orgId: v.optional(v.id("orgs")),
    actorUserId: v.id("users"),
    requestId: v.string(),
    fingerprint: v.string(),
    action: v.string(),
    reason: v.string(),
    before: v.string(),
    after: v.string(),
    result: v.string(),
    createdAt: v.number(),
  })
    .index("by_request", ["actorUserId", "requestId"])
    .index("by_org", ["orgId"]),

  // Audit log for compliance.
  // APPEND-ONLY by convention: writers MUST go through appendAudit() in
  // convex/audit.ts; patching/deleting entries is a compliance violation.
  // Metadata is constrained to flat primitive maps — complex values are
  // serialized by the helper before persisting.
  auditLog: defineTable({
    orgId: v.id("orgs"),
    actorUserId: v.id("users"),
    action: v.string(),
    objectType: v.string(),
    objectId: v.string(),
    metadata: v.optional(
      v.record(
        v.string(),
        // Legacy POC events stored arrays and objects directly. Retain them;
        // appendAudit normalizes every new event to primitive values.
        v.union(
          v.string(),
          v.number(),
          v.boolean(),
          v.null(),
          v.array(v.any()),
          v.record(v.string(), v.any()),
        ),
      ),
    ),
    timestamp: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_timestamp", ["orgId", "timestamp"]),

  // SDN (Specially Designated Nationals) entries for OFAC screening
  ofacSources: defineTable({
    name: v.literal("ofac_sdn"),
    activeDatasetId: v.optional(v.id("ofacDatasets")),
    stagingDatasetId: v.optional(v.id("ofacDatasets")),
    refreshId: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    lastCheckedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_name", ["name"]),
  ofacDatasets: defineTable({
    cleanupAt: v.optional(v.number()),
    contentsDeletedAt: v.optional(v.number()),
    checksum: v.string(),
    engine: v.string(),
    sourceUrl: v.string(),
    publishedAt: v.number(),
    fetchedAt: v.number(),
    activatedAt: v.optional(v.number()),
    retiredAt: v.optional(v.number()),
    state: v.union(
      v.literal("staging"),
      v.literal("active"),
      v.literal("retired"),
      v.literal("failed"),
    ),
    expectedEntries: v.number(),
    expectedPostings: v.number(),
    entryCount: v.number(),
    postingCount: v.number(),
    aliasCount: v.number(),
    addressCount: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_state_cleanup", ["state", "cleanupAt"]),
  ofacEntries: defineTable({
    datasetId: v.id("ofacDatasets"),
    ...sdnEntryFields,
  }).index("by_dataset_sdn", ["datasetId", "sdnId"]),
  ofacSearchPostings: defineTable({
    datasetId: v.id("ofacDatasets"),
    term: v.string(),
    part: v.number(),
    sdnIds: v.array(v.number()),
  }).index("by_dataset_term", ["datasetId", "term", "part"]),
  ofacImportChunks: defineTable({
    datasetId: v.id("ofacDatasets"),
    kind: v.union(v.literal("entries"), v.literal("postings")),
    offset: v.number(),
    count: v.number(),
    checksum: v.string(),
  }).index("by_dataset_kind_offset", ["datasetId", "kind", "offset"]),

  sdnEntries: defineTable({
    sdnId: v.number(),
    entityType: v.union(v.literal("individual"), v.literal("entity")),
    primaryName: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    aliases: v.array(v.string()),
    programs: v.array(v.string()),
  })
    .index("by_sdnId", ["sdnId"])
    .searchIndex("search_primaryName", {
      searchField: "primaryName",
    }),

  // Screening results for beneficiaries
  screeningRuns: defineTable({
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    datasetId: v.optional(v.id("ofacDatasets")),
    engine: v.string(),
    input: screeningInputValidator,
    inputFingerprint: v.string(),
    matchFingerprint: v.string(),
    status: v.union(
      v.literal("clear"),
      v.literal("potential_match"),
      v.literal("unavailable"),
    ),
    matches: v.array(screeningMatchValidator),
    screenedAt: v.number(),
    error: v.optional(v.string()),
  }).index("by_recipient", ["beneficiaryId"]),
  screeningDecisions: defineTable({
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    runId: v.id("screeningRuns"),
    inputFingerprint: v.string(),
    matchFingerprint: v.string(),
    status: v.union(v.literal("confirmed_match"), v.literal("false_positive")),
    reason: v.string(),
    reviewedBy: v.id("users"),
    reviewedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_recipient", ["beneficiaryId"]),
  screeningResults: defineTable({
    runId: v.optional(v.id("screeningRuns")),
    datasetId: v.optional(v.id("ofacDatasets")),
    engine: v.optional(v.string()),
    inputFingerprint: v.optional(v.string()),
    matchFingerprint: v.optional(v.string()),
    decisionId: v.optional(v.id("screeningDecisions")),
    reviewExpiresAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    orgId: v.id("orgs"),
    beneficiaryId: v.id("beneficiaries"),
    status: v.union(
      v.literal("clear"),
      v.literal("potential_match"),
      v.literal("confirmed_match"),
      v.literal("false_positive"),
      v.literal("unavailable"),
    ),
    matches: v.array(screeningMatchValidator),
    screenedAt: v.number(),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_beneficiary", ["beneficiaryId"]),
});
