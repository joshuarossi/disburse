/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as __tests___factories from "../__tests__/factories.js";
import type * as __tests___reportHelpers from "../__tests__/reportHelpers.js";
import type * as accountApprovals from "../accountApprovals.js";
import type * as accountBalances from "../accountBalances.js";
import type * as accountCancellationData from "../accountCancellationData.js";
import type * as accountCancellationRecovery from "../accountCancellationRecovery.js";
import type * as accountCancellationRelay from "../accountCancellationRelay.js";
import type * as accountCancellations from "../accountCancellations.js";
import type * as accountFeeSetups from "../accountFeeSetups.js";
import type * as accountReadiness from "../accountReadiness.js";
import type * as accountSetups from "../accountSetups.js";
import type * as accounting from "../accounting.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as beneficiaries from "../beneficiaries.js";
import type * as billing from "../billing.js";
import type * as billingCheckoutActions from "../billingCheckoutActions.js";
import type * as billingCheckoutData from "../billingCheckoutData.js";
import type * as circleBilling from "../circleBilling.js";
import type * as circlePayments from "../circlePayments.js";
import type * as conversionActions from "../conversionActions.js";
import type * as crons from "../crons.js";
import type * as customerExecution from "../customerExecution.js";
import type * as customerOperations from "../customerOperations.js";
import type * as delegatedCircle from "../delegatedCircle.js";
import type * as delegatedNative from "../delegatedNative.js";
import type * as delegatedPayments from "../delegatedPayments.js";
import type * as deposits from "../deposits.js";
import type * as depositsData from "../depositsData.js";
import type * as disbursements from "../disbursements.js";
import type * as emailDelivery from "../emailDelivery.js";
import type * as emailDeliveryData from "../emailDeliveryData.js";
import type * as http from "../http.js";
import type * as invoiceFileHttp from "../invoiceFileHttp.js";
import type * as invoiceFiles from "../invoiceFiles.js";
import type * as invoices from "../invoices.js";
import type * as lib_accountApproval from "../lib/accountApproval.js";
import type * as lib_accountAuthority from "../lib/accountAuthority.js";
import type * as lib_accountChange from "../lib/accountChange.js";
import type * as lib_accountChangeLifecycle from "../lib/accountChangeLifecycle.js";
import type * as lib_accountChangeSettlement from "../lib/accountChangeSettlement.js";
import type * as lib_accountFeeSetup from "../lib/accountFeeSetup.js";
import type * as lib_accountSetupMember from "../lib/accountSetupMember.js";
import type * as lib_accountingSource from "../lib/accountingSource.js";
import type * as lib_accountingValidators from "../lib/accountingValidators.js";
import type * as lib_activityEnvironment from "../lib/activityEnvironment.js";
import type * as lib_balanceProof from "../lib/balanceProof.js";
import type * as lib_billingCheckout from "../lib/billingCheckout.js";
import type * as lib_billingConfiguration from "../lib/billingConfiguration.js";
import type * as lib_billingReceipt from "../lib/billingReceipt.js";
import type * as lib_cctpDelivery from "../lib/cctpDelivery.js";
import type * as lib_cctpProvider from "../lib/cctpProvider.js";
import type * as lib_circleAccountService from "../lib/circleAccountService.js";
import type * as lib_circleAccountSetup from "../lib/circleAccountSetup.js";
import type * as lib_circleBatch from "../lib/circleBatch.js";
import type * as lib_circleBilling from "../lib/circleBilling.js";
import type * as lib_circleCancellation from "../lib/circleCancellation.js";
import type * as lib_circleDelegation from "../lib/circleDelegation.js";
import type * as lib_circleFeeProof from "../lib/circleFeeProof.js";
import type * as lib_circleFeeReports from "../lib/circleFeeReports.js";
import type * as lib_circleReceivables from "../lib/circleReceivables.js";
import type * as lib_circleRecovery from "../lib/circleRecovery.js";
import type * as lib_circleSource from "../lib/circleSource.js";
import type * as lib_circleSubmission from "../lib/circleSubmission.js";
import type * as lib_conversionProvider from "../lib/conversionProvider.js";
import type * as lib_customerPaidAccount from "../lib/customerPaidAccount.js";
import type * as lib_delegatedIntent from "../lib/delegatedIntent.js";
import type * as lib_delegationReservations from "../lib/delegationReservations.js";
import type * as lib_depositSync from "../lib/depositSync.js";
import type * as lib_disbursementPolicy from "../lib/disbursementPolicy.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_encodeSafeExecution from "../lib/encodeSafeExecution.js";
import type * as lib_executionReceipt from "../lib/executionReceipt.js";
import type * as lib_fundingAccount from "../lib/fundingAccount.js";
import type * as lib_fundingBalance from "../lib/fundingBalance.js";
import type * as lib_lendingProvider from "../lib/lendingProvider.js";
import type * as lib_licenseManagement from "../lib/licenseManagement.js";
import type * as lib_licenseValidators from "../lib/licenseValidators.js";
import type * as lib_managedRelay from "../lib/managedRelay.js";
import type * as lib_ofacXml from "../lib/ofacXml.js";
import type * as lib_outgoingTransfers from "../lib/outgoingTransfers.js";
import type * as lib_ownerProposalValidator from "../lib/ownerProposalValidator.js";
import type * as lib_paymentLimits from "../lib/paymentLimits.js";
import type * as lib_paymentProposal from "../lib/paymentProposal.js";
import type * as lib_paymentSettlement from "../lib/paymentSettlement.js";
import type * as lib_pinnedContract from "../lib/pinnedContract.js";
import type * as lib_rbac from "../lib/rbac.js";
import type * as lib_receivableAdjustments from "../lib/receivableAdjustments.js";
import type * as lib_receivableVerification from "../lib/receivableVerification.js";
import type * as lib_recipientReview from "../lib/recipientReview.js";
import type * as lib_recipientValidators from "../lib/recipientValidators.js";
import type * as lib_relayConfiguration from "../lib/relayConfiguration.js";
import type * as lib_reportIndex from "../lib/reportIndex.js";
import type * as lib_reportPagination from "../lib/reportPagination.js";
import type * as lib_reportRows from "../lib/reportRows.js";
import type * as lib_reportValidators from "../lib/reportValidators.js";
import type * as lib_safeIdentity from "../lib/safeIdentity.js";
import type * as lib_safeProposal from "../lib/safeProposal.js";
import type * as lib_safeReadService from "../lib/safeReadService.js";
import type * as lib_safeVerification from "../lib/safeVerification.js";
import type * as lib_sanctionsValidators from "../lib/sanctionsValidators.js";
import type * as lib_scheduleNotifications from "../lib/scheduleNotifications.js";
import type * as lib_scheduledPayment from "../lib/scheduledPayment.js";
import type * as lib_screeningPolicy from "../lib/screeningPolicy.js";
import type * as lib_settlementBlock from "../lib/settlementBlock.js";
import type * as lib_signatures from "../lib/signatures.js";
import type * as lib_spendingPolicy from "../lib/spendingPolicy.js";
import type * as lib_spendingPolicyValidators from "../lib/spendingPolicyValidators.js";
import type * as lib_tags from "../lib/tags.js";
import type * as lib_teamSeats from "../lib/teamSeats.js";
import type * as lib_treasuryReports from "../lib/treasuryReports.js";
import type * as lib_treasuryService from "../lib/treasuryService.js";
import type * as lib_treasuryServiceReports from "../lib/treasuryServiceReports.js";
import type * as lib_treasuryTransfer from "../lib/treasuryTransfer.js";
import type * as lib_users from "../lib/users.js";
import type * as lib_validation from "../lib/validation.js";
import type * as licenseAdmin from "../licenseAdmin.js";
import type * as memberPolicies from "../memberPolicies.js";
import type * as migrations_backfillBeneficiaryType from "../migrations/backfillBeneficiaryType.js";
import type * as migrations_backfillDisbursementChainId from "../migrations/backfillDisbursementChainId.js";
import type * as nativePayments from "../nativePayments.js";
import type * as ofac from "../ofac.js";
import type * as ofacData from "../ofacData.js";
import type * as ofacRetention from "../ofacRetention.js";
import type * as operationsHealth from "../operationsHealth.js";
import type * as orgs from "../orgs.js";
import type * as paymentExecution from "../paymentExecution.js";
import type * as paymentFollowupChecks from "../paymentFollowupChecks.js";
import type * as paymentFollowups from "../paymentFollowups.js";
import type * as paymentRuns from "../paymentRuns.js";
import type * as paymentSchedules from "../paymentSchedules.js";
import type * as receiptEvidence from "../receiptEvidence.js";
import type * as receivableActions from "../receivableActions.js";
import type * as receivableServices from "../receivableServices.js";
import type * as receivableWorkflows from "../receivableWorkflows.js";
import type * as receivables from "../receivables.js";
import type * as recipientCollectionActions from "../recipientCollectionActions.js";
import type * as recipientCollections from "../recipientCollections.js";
import type * as recipientImports from "../recipientImports.js";
import type * as recipientReviews from "../recipientReviews.js";
import type * as relay from "../relay.js";
import type * as relayExecutor from "../relayExecutor.js";
import type * as relayJobs from "../relayJobs.js";
import type * as relayQuotes from "../relayQuotes.js";
import type * as reportIndex from "../reportIndex.js";
import type * as reports from "../reports.js";
import type * as safes from "../safes.js";
import type * as screening from "../screening.js";
import type * as screeningMutations from "../screeningMutations.js";
import type * as screeningQueries from "../screeningQueries.js";
import type * as screeningQueue from "../screeningQueue.js";
import type * as spendingPolicies from "../spendingPolicies.js";
import type * as spendingPolicyData from "../spendingPolicyData.js";
import type * as spendingPolicyRecovery from "../spendingPolicyRecovery.js";
import type * as spendingPolicyRelay from "../spendingPolicyRelay.js";
import type * as teamInvitationLinks from "../teamInvitationLinks.js";
import type * as teamInvitations from "../teamInvitations.js";
import type * as treasury from "../treasury.js";
import type * as treasuryActions from "../treasuryActions.js";
import type * as treasuryServiceActions from "../treasuryServiceActions.js";
import type * as treasuryServices from "../treasuryServices.js";
import type * as users from "../users.js";
import type * as walletSetups from "../walletSetups.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "__tests__/factories": typeof __tests___factories;
  "__tests__/reportHelpers": typeof __tests___reportHelpers;
  accountApprovals: typeof accountApprovals;
  accountBalances: typeof accountBalances;
  accountCancellationData: typeof accountCancellationData;
  accountCancellationRecovery: typeof accountCancellationRecovery;
  accountCancellationRelay: typeof accountCancellationRelay;
  accountCancellations: typeof accountCancellations;
  accountFeeSetups: typeof accountFeeSetups;
  accountReadiness: typeof accountReadiness;
  accountSetups: typeof accountSetups;
  accounting: typeof accounting;
  audit: typeof audit;
  auth: typeof auth;
  beneficiaries: typeof beneficiaries;
  billing: typeof billing;
  billingCheckoutActions: typeof billingCheckoutActions;
  billingCheckoutData: typeof billingCheckoutData;
  circleBilling: typeof circleBilling;
  circlePayments: typeof circlePayments;
  conversionActions: typeof conversionActions;
  crons: typeof crons;
  customerExecution: typeof customerExecution;
  customerOperations: typeof customerOperations;
  delegatedCircle: typeof delegatedCircle;
  delegatedNative: typeof delegatedNative;
  delegatedPayments: typeof delegatedPayments;
  deposits: typeof deposits;
  depositsData: typeof depositsData;
  disbursements: typeof disbursements;
  emailDelivery: typeof emailDelivery;
  emailDeliveryData: typeof emailDeliveryData;
  http: typeof http;
  invoiceFileHttp: typeof invoiceFileHttp;
  invoiceFiles: typeof invoiceFiles;
  invoices: typeof invoices;
  "lib/accountApproval": typeof lib_accountApproval;
  "lib/accountAuthority": typeof lib_accountAuthority;
  "lib/accountChange": typeof lib_accountChange;
  "lib/accountChangeLifecycle": typeof lib_accountChangeLifecycle;
  "lib/accountChangeSettlement": typeof lib_accountChangeSettlement;
  "lib/accountFeeSetup": typeof lib_accountFeeSetup;
  "lib/accountSetupMember": typeof lib_accountSetupMember;
  "lib/accountingSource": typeof lib_accountingSource;
  "lib/accountingValidators": typeof lib_accountingValidators;
  "lib/activityEnvironment": typeof lib_activityEnvironment;
  "lib/balanceProof": typeof lib_balanceProof;
  "lib/billingCheckout": typeof lib_billingCheckout;
  "lib/billingConfiguration": typeof lib_billingConfiguration;
  "lib/billingReceipt": typeof lib_billingReceipt;
  "lib/cctpDelivery": typeof lib_cctpDelivery;
  "lib/cctpProvider": typeof lib_cctpProvider;
  "lib/circleAccountService": typeof lib_circleAccountService;
  "lib/circleAccountSetup": typeof lib_circleAccountSetup;
  "lib/circleBatch": typeof lib_circleBatch;
  "lib/circleBilling": typeof lib_circleBilling;
  "lib/circleCancellation": typeof lib_circleCancellation;
  "lib/circleDelegation": typeof lib_circleDelegation;
  "lib/circleFeeProof": typeof lib_circleFeeProof;
  "lib/circleFeeReports": typeof lib_circleFeeReports;
  "lib/circleReceivables": typeof lib_circleReceivables;
  "lib/circleRecovery": typeof lib_circleRecovery;
  "lib/circleSource": typeof lib_circleSource;
  "lib/circleSubmission": typeof lib_circleSubmission;
  "lib/conversionProvider": typeof lib_conversionProvider;
  "lib/customerPaidAccount": typeof lib_customerPaidAccount;
  "lib/delegatedIntent": typeof lib_delegatedIntent;
  "lib/delegationReservations": typeof lib_delegationReservations;
  "lib/depositSync": typeof lib_depositSync;
  "lib/disbursementPolicy": typeof lib_disbursementPolicy;
  "lib/email": typeof lib_email;
  "lib/encodeSafeExecution": typeof lib_encodeSafeExecution;
  "lib/executionReceipt": typeof lib_executionReceipt;
  "lib/fundingAccount": typeof lib_fundingAccount;
  "lib/fundingBalance": typeof lib_fundingBalance;
  "lib/lendingProvider": typeof lib_lendingProvider;
  "lib/licenseManagement": typeof lib_licenseManagement;
  "lib/licenseValidators": typeof lib_licenseValidators;
  "lib/managedRelay": typeof lib_managedRelay;
  "lib/ofacXml": typeof lib_ofacXml;
  "lib/outgoingTransfers": typeof lib_outgoingTransfers;
  "lib/ownerProposalValidator": typeof lib_ownerProposalValidator;
  "lib/paymentLimits": typeof lib_paymentLimits;
  "lib/paymentProposal": typeof lib_paymentProposal;
  "lib/paymentSettlement": typeof lib_paymentSettlement;
  "lib/pinnedContract": typeof lib_pinnedContract;
  "lib/rbac": typeof lib_rbac;
  "lib/receivableAdjustments": typeof lib_receivableAdjustments;
  "lib/receivableVerification": typeof lib_receivableVerification;
  "lib/recipientReview": typeof lib_recipientReview;
  "lib/recipientValidators": typeof lib_recipientValidators;
  "lib/relayConfiguration": typeof lib_relayConfiguration;
  "lib/reportIndex": typeof lib_reportIndex;
  "lib/reportPagination": typeof lib_reportPagination;
  "lib/reportRows": typeof lib_reportRows;
  "lib/reportValidators": typeof lib_reportValidators;
  "lib/safeIdentity": typeof lib_safeIdentity;
  "lib/safeProposal": typeof lib_safeProposal;
  "lib/safeReadService": typeof lib_safeReadService;
  "lib/safeVerification": typeof lib_safeVerification;
  "lib/sanctionsValidators": typeof lib_sanctionsValidators;
  "lib/scheduleNotifications": typeof lib_scheduleNotifications;
  "lib/scheduledPayment": typeof lib_scheduledPayment;
  "lib/screeningPolicy": typeof lib_screeningPolicy;
  "lib/settlementBlock": typeof lib_settlementBlock;
  "lib/signatures": typeof lib_signatures;
  "lib/spendingPolicy": typeof lib_spendingPolicy;
  "lib/spendingPolicyValidators": typeof lib_spendingPolicyValidators;
  "lib/tags": typeof lib_tags;
  "lib/teamSeats": typeof lib_teamSeats;
  "lib/treasuryReports": typeof lib_treasuryReports;
  "lib/treasuryService": typeof lib_treasuryService;
  "lib/treasuryServiceReports": typeof lib_treasuryServiceReports;
  "lib/treasuryTransfer": typeof lib_treasuryTransfer;
  "lib/users": typeof lib_users;
  "lib/validation": typeof lib_validation;
  licenseAdmin: typeof licenseAdmin;
  memberPolicies: typeof memberPolicies;
  "migrations/backfillBeneficiaryType": typeof migrations_backfillBeneficiaryType;
  "migrations/backfillDisbursementChainId": typeof migrations_backfillDisbursementChainId;
  nativePayments: typeof nativePayments;
  ofac: typeof ofac;
  ofacData: typeof ofacData;
  ofacRetention: typeof ofacRetention;
  operationsHealth: typeof operationsHealth;
  orgs: typeof orgs;
  paymentExecution: typeof paymentExecution;
  paymentFollowupChecks: typeof paymentFollowupChecks;
  paymentFollowups: typeof paymentFollowups;
  paymentRuns: typeof paymentRuns;
  paymentSchedules: typeof paymentSchedules;
  receiptEvidence: typeof receiptEvidence;
  receivableActions: typeof receivableActions;
  receivableServices: typeof receivableServices;
  receivableWorkflows: typeof receivableWorkflows;
  receivables: typeof receivables;
  recipientCollectionActions: typeof recipientCollectionActions;
  recipientCollections: typeof recipientCollections;
  recipientImports: typeof recipientImports;
  recipientReviews: typeof recipientReviews;
  relay: typeof relay;
  relayExecutor: typeof relayExecutor;
  relayJobs: typeof relayJobs;
  relayQuotes: typeof relayQuotes;
  reportIndex: typeof reportIndex;
  reports: typeof reports;
  safes: typeof safes;
  screening: typeof screening;
  screeningMutations: typeof screeningMutations;
  screeningQueries: typeof screeningQueries;
  screeningQueue: typeof screeningQueue;
  spendingPolicies: typeof spendingPolicies;
  spendingPolicyData: typeof spendingPolicyData;
  spendingPolicyRecovery: typeof spendingPolicyRecovery;
  spendingPolicyRelay: typeof spendingPolicyRelay;
  teamInvitationLinks: typeof teamInvitationLinks;
  teamInvitations: typeof teamInvitations;
  treasury: typeof treasury;
  treasuryActions: typeof treasuryActions;
  treasuryServiceActions: typeof treasuryServiceActions;
  treasuryServices: typeof treasuryServices;
  users: typeof users;
  walletSetups: typeof walletSetups;
  workspace: typeof workspace;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
