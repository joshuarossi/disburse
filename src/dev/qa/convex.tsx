/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/no-explicit-any -- isolated development fixtures, never bundled in production */
export * from "convex/react";
import { ConvexError } from "convex/values";
import { useSyncExternalStore } from "react";
import { getFunctionName } from "convex/server";
import {
  bills,
  customerInvoices,
  members,
  org,
  overview,
  payments,
  recipients,
  recurring,
  safes,
  wallet,
} from "./fixtures";
import { identifyAsset, configuredTokenAddress, chainEnvironment, inReportEnvironment } from "../../../shared/assets";
import { receivableAmounts, receivableStatus } from '../../../shared/receivables';
import { accountingFixture } from './accounting';
import { licenseQueryFixture, licenseBillingFixture, licenseMutationFixture } from './licenses';
import { billingAccess } from '../../../shared/billing';
const cache = new Map<string, any>();
let fixtureRevision = 0;
const fixtureListeners = new Set<() => void>();
const subscribeToFixtures = (listener: () => void) => { fixtureListeners.add(listener); return () => { fixtureListeners.delete(listener); }; };
export function readQueryFixture(reference: any, args: any) {
  if (args === "skip") return undefined;
  const name = getFunctionName(reference);
  const scenario = sessionStorage.getItem("qa:scenario");
  if (name.startsWith('licenseAdmin:')) return licenseQueryFixture(name, args, scenario);
  if (name.startsWith('accounting:') || name.startsWith('accountBalances:') || scenario?.startsWith('accounting') && name === 'reports:getTransactionReport')
    return accountingFixture(name, args, scenario);
  const key = scenario + name + JSON.stringify(args);
  if (cache.has(key)) return cache.get(key);
  let value: any;
  switch (name) {
    case 'accountCancellationData:get': {
      const active = scenario?.startsWith('cancel-') && scenario !== 'cancel-request';
      const confirmed = scenario === 'cancel-confirmed', declined = scenario === 'cancel-declined';
      value = { canRequest: true, canApprove: true, safeName: 'Payroll', safeId: safes[0]._id, chainId: 8453, originalStatus: confirmed ? 'cancelled' : 'pending', originalAvailable: true,
        cancellation: active ? { _id: 'cancellation1', status: confirmed ? 'applied' : declined ? 'processing' : 'pending', chainId: 8453, updatedAt: Date.now(), executionFee: declined ? undefined : { token: 'USDC', tokenAddress: configuredTokenAddress(8453, 'USDC'), collector: wallet, amount: '0.05' }, execution: declined ? { attemptId: 'cancel-attempt', phase: 'submitted', walletRejectedAt: Date.now()-30_000 } : undefined, txHash: confirmed ? `0x${'cd'.repeat(32)}` : undefined } : null };
      break;
    }
    case 'spendingPolicyData:fee':
      value = ['policy-fee-outage', 'cancel-fee-outage'].includes(scenario ?? '') ? { fee: null, error: 'Managed fees are unavailable for this account and currency.' } : { fee: { token: args.token, tokenAddress: configuredTokenAddress(8453, args.token), collector: wallet, amount: '0.05' }, error: null }; break;
    case 'spendingPolicyData:list':
      value = { canApprove: true, proposals: [{ _id: 'policy1', safeId: args.safeId, orgId: 'demo', chainId: 8453, safeAddress: safes[0].safeAddress, safeTxHash: `0x${'ab'.repeat(32)}`, createdAt: Date.now(), updatedAt: Date.now(), cancellationId: scenario?.startsWith('cancel-') && scenario !== 'cancel-request' ? 'cancellation1' : undefined, status: scenario === 'policy-declined' ? 'processing' : scenario === 'policy-applied' ? 'applied' : 'pending', execution: scenario === 'policy-declined' ? { attemptId: 'wallet-attempt', startedAt: Date.now()-60_000, walletRejectedAt: Date.now()-30_000, phase: 'submitted' } : undefined,
        executionFee: scenario === 'policy-declined' ? undefined : { token: 'USDC', tokenAddress: configuredTokenAddress(8453, 'USDC'), collector: wallet, amount: '0.05' },
        intent: { kind: 'grant', module: '0x691f59471Bfd2B7d639DCF74671a2d648ED1E331', delegate: members[1].walletAddress, tokenAddress: configuredTokenAddress(8453, 'USDC'), token: 'USDC', amount: '1500', resetMinutes: 43200, moduleEnabled: true, delegateExists: true, previousAmount: '0', previousResetMinutes: 0 } }] }; break;

    case 'invoiceFiles:list':
      value = scenario === 'bill-source-saved' ? [{ id: 'file1', name: 'supplier-invoice.pdf', size: 9248, contentType: 'application/pdf', sha256: 'a'.repeat(64), createdAt: Date.now()-86400_000 }] : []; break;
    case "teamInvitations:list":
      value = [{ id: "qa-invitation", name: "Jordan Patel", email: "jordan@northstar.co", role: "initiator", status: "pending", createdAt: Date.now() - 3600_000, expiresAt: Date.now() + 6 * 86400_000, deliveryStatus: "delivered" }, { id: "qa-bounced-invitation", name: "Taylor Reed", email: "taylor@northstar.co", role: "viewer", status: "pending", createdAt: Date.now() - 86400_000, expiresAt: Date.now() + 6 * 86400_000, deliveryStatus: "bounced", deliveryError: "The recipient's mail server rejected this invitation. Verify their email before resending." }]; break;
    case "teamInvitations:get":
      value = scenario === "invite-expired" ? null : scenario === "invite-accepted" ? { status: "accepted" } : { status: "pending", organizationName: org.name, role: "initiator", maskedEmail: "j…@northstar.co", expiresAt: Date.now() + 6 * 86400_000, expectedWallet: scenario === "invite-wrong-wallet" ? "0x2222222222222222222222222222222222222222" : undefined }; break;
    case "receivables:list":
      value = { items: (scenario === 'empty' ? [] : customerInvoices).map(row => { const i = scenario === 'ar-void' ? { ...row, state: 'void' } : scenario === 'ar-archived-account' ? { ...row, safeId: 'archived-safe', token: 'USDT', tokenAddress: configuredTokenAddress(8453, 'USDT') } : row; return { ...i, status: receivableStatus(i), amounts: receivableAmounts(i) }; }), limited: false }; break;
    case "receivables:configuration":
      value = [{ chainId: 8453, canIssue: true, collectionFeeMode: "wallet" }]; break;
    case "receivables:receipts":
      value = []; break;
    case "receivables:publicInvoice": {
      const row = customerInvoices.find(i => i.publicToken === args.token);
      const i = row ? { ...row, ...(scenario === 'ar-paid' ? { received: '1500000000', forwarded: '1500000000' } : {}), ...(scenario === 'ar-void' ? { state: 'void' } : {}) } : null;
      value = i ? { ...i, issuer: org.name, status: receivableStatus(i), amounts: receivableAmounts(i), voided: i.state === 'void', syncDelayed: false } : null;
      break;
    }
    case "relayJobs:paymentStatus":
      value = scenario === 'relay-failed' ? { canResume: false, status: 'failed', error: 'This payment failed. No money was sent to the recipients. Create a new payment to try again.', updatedAt: Date.now() } : scenario === 'preparation' ? { canResume: true, status: 'exception', error: 'No submission was attempted.', updatedAt: Date.now() } : scenario === 'recovery' ? { status: 'exception', error: 'Confirmation is delayed.', updatedAt: Date.now() } : null;
      break;
    case "relayQuotes:preview":
      value = { fee: { token: "USDC", tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", collector: "0x1111111111111111111111111111111111111111", amount: "0.05" }, identity: "sample-fee", error: null };
      break;
    case "auth:validateSession":
      value = { userId: "user1", walletAddress: wallet };
      break;
    case "orgs:get":
      value = org;
      break;
    case "orgs:listMembers":
      value = scenario === 'ar-viewer' ? members.map(m => ({ ...m, role: 'viewer' })) : scenario === 'access-viewer' ? members.map((m, i) => i ? { ...m, role: 'viewer' } : m) : scenario === 'access-invited' ? members.map((m, i) => i ? { ...m, status: 'invited' } : m) : members;
      break;
    case "orgs:listForUser":
      value = [{ ...org, membershipStatus: "active", role: "admin" }];
      break;
    case "safes:getForOrg":
      value = scenario === 'multiple-accounts' ? [...safes.map((s, i) => i === 0 ? { ...s, name: 'Operations' } : s), { ...safes[0], _id: 'payroll-safe', name: 'Payroll', safeAddress: '0x9999999999999999999999999999999999999999' }] : safes;
      if (scenario === 'policy-archived') value = safes.map(s => ({ ...s, name: 'Former payroll', isActive: false }));
      if (scenario?.startsWith('nested-')) value = [{ ...safes[0], name: 'Payroll', owners: ['0x9999999999999999999999999999999999999999'], threshold: 1 }];
      break;
    case "beneficiaries:list":
      value = scenario === "changed-directory" ? recipients.map((r, i) => i === 0 ? { ...r, walletAddress: "0x9999999999999999999999999999999999999999" } : r) : scenario?.startsWith('payout-review') ? recipients.map((r, i) => i === 0 ? { ...r, pendingPayoutChangeId: 'change1' } : r) : recipients;
      if (scenario === 'draft-archived-recipient') value = recipients.slice(1);
      break;
    case 'recipientReviews:get': {
      const recipient = recipients.find(r => r._id === args.beneficiaryId)!;
      const pending = scenario?.startsWith('payout-review') ? { _id: 'change1', orgId: 'demo', beneficiaryId: recipient._id, before: recipient, proposed: { walletAddress: '0x5555ffffffffffffffffffffffffffffffff5555', preferredToken: 'USDC', preferredChainId: 8453 }, baseVersion: 1, requestedBy: scenario === 'payout-review-self' ? 'user1' : 'user2', requestedAt: Date.now(), status: 'pending' } : null;
      value = { recipient, pending, changes: [], lookalikes: pending ? ['Maya Chen'] : [], canReview: true, canRequest: true, canWithdraw: true, independentRequired: true, isRequester: scenario === 'payout-review-self', canDecide: scenario !== 'payout-review-self', reviewerCount: 2 };
      break;
    }
    case "invoices:list":
      value = bills;
      break;
    case "recipientImports:status":
      value = scenario === "import-recovered" ? {created:2,updated:1,reviewRequested:1} : null; break;
    case "recipientCollections:history":
      value = { canCreate: true, canManage: true, requests: scenario === 'collection-requested' ? [{ id: 'collection1', createdAt: Date.now() - 86400000, expiresAt: Date.now() + 6 * 86400000, state: 'requested' }] : [] }; break;
    case "recipientCollections:publicRequest":
      value = args.token !== 'ab'.repeat(32) ? null : scenario === 'collection-expired' ? { state: 'expired' } : { state: scenario === 'collection-received' ? 'submitted' : scenario === 'collection-approved' ? 'approved' : 'requested', issuer: org.name, recipientName: 'Maya Chen', expiresAt: Date.now() + 6 * 86400000, options: [{ chainId: 8453, name: 'Base', tokens: ['USDC','USDT'].map(symbol => ({symbol, address:configuredTokenAddress(8453,symbol)})) }] }; break;
    case "paymentFollowups:list":
      if (scenario === 'reminders-outage') throw new Error('Reminder service unavailable');
      value = scenario?.startsWith('reminders') ? { items: args.cursor ? [] : [
        { id: 'notice1', revision: 1, phase: 'approval_late', title: 'Approval deadline missed', description: 'This payment was not scheduled before its pay date. Review the original payment and choose when to send it; no catch-up payment is sent automatically.', urgent: true, disbursementId: 'p1', paymentName: 'September contractor payroll', payAt: Date.now()-86400000, chainId: 8453, assigned: true, unread: true, updatedAt: Date.now() },
        { id: 'notice2', revision: 1, phase: 'schedule_paused', title: 'Schedule needs attention', description: 'Draft preparation was paused. Resolve the issue and resume for the next future pay date; missed periods are not paid automatically.', urgent: true, recurringPaymentId: 'rec1', paymentName: 'Contractor payroll', payAt: Date.now()-86400000, chainId: 8453, assigned: true, unread: true, pauseReason: 'The schedule owner no longer has permission to create payments.', updatedAt: Date.now() },
        { id: 'notice3', revision: 1, phase: 'review', title: 'Payment ready for review', description: 'Review the prepared payment and collect account approvals before its pay date.', urgent: false, disbursementId: 'p2', paymentName: 'Vendor retainer', payAt: Date.now()+2*86400000, chainId: 8453, assigned: false, unread: false, updatedAt: Date.now() },
      ], cursor: 'older', isDone: scenario !== 'reminders-paged' || !!args.cursor } : { items: [], cursor: '', isDone: true }; break;
    case "paymentRuns:listRecurring":
      value = recurring.map(r => ({...r, ...(scenario?.startsWith('reminders') ? {status: 'paused', pauseReason: 'The schedule owner no longer has permission to create payments.'} : {}), nextDraftAt:r.nextPayDate - 3*86400000, ownerName:"Alex Morgan", coordinatorActive: !scenario?.startsWith('reminders'), latestPayment:{_id:"p1",safeId:"safe1",status:"draft",name:"September contractor payroll",scheduledAt:Date.now()+(scenario?.startsWith('reminders') ? -1 : 1)*86400000}}));
      break;
    case "workspace:overview":
      value = overview;
      break;
    case "disbursements:list": {
      const rows = payments.map(p => scenario === "recovery" && p._id === "p1" ? { ...p, status: "relaying", relayStatus: "Needs investigation" } : { ...p, relayStatus: undefined }).filter(
        (p) =>
          (!args.status || args.status.includes(p.status) || (args.includeRelayExceptions && p.relayStatus === "Needs investigation")) &&
          (!args.search ||
            p.name.toLowerCase().includes(args.search.toLowerCase())) &&
          (!args.token || p.token === args.token) && (!args.recurringPaymentId || p.recurringPaymentId === args.recurringPaymentId),
      );
      value = {
        items: rows,
        totalCount: rows.length,
        nextCursor: null,
        hasMore: false,
      };
      break;
    }
    case "disbursements:getWithRecipients":
    case "disbursements:get": {
      const p = payments.find((p) => p._id === args.disbursementId);
      value = p
        ? {
            ...p,
            ...(scenario?.startsWith('cancel-') ? { status: scenario === 'cancel-confirmed' ? 'cancelled' : 'proposed', cancellationId: scenario !== 'cancel-request' ? 'cancellation1' : undefined, cancellationConfirmedAt: scenario === 'cancel-confirmed' ? Date.now() : undefined, safeTxHash: `0x${'ab'.repeat(32)}`, approvalMethod: 'workspace', scheduledAt: undefined } : {}),
            ...(scenario?.startsWith('nested-') ? { status: 'proposed', approvalMethod: 'workspace', safeTxHash: `0x${'ab'.repeat(32)}`, scheduledAt: undefined } : {}),
            ...(scenario === 'payout-review-payment' ? { payoutReviewError: 'Maya Chen: payout details were reviewed or changed after this payment was prepared. Its prior approvals cannot be used in Disburse. Cancel this payment and prepare a new one with the reviewed details.' } : {}),
            ...(scenario === "proposal-recovery" ? { status: "pending", safeTxHash: `0x${"ab".repeat(32)}`, preparedProposalAt: Date.now(), executionFee: { token: "USDC", amount: "0.05" } } : {}),
            ...(scenario === "native-recovery" ? { status: "relaying", safeTxHash: `0x${"ab".repeat(32)}`, nativeExecution: { startedAt: Date.now() - 60_000, searchFromBlock: "100", checks: 1 }, relayStatus: "Checking settlement" } : {}),
            ...(scenario === 'native-declined' ? { status: 'relaying', approvalMethod: 'workspace', safeTxHash: `0x${'ab'.repeat(32)}`, nativeExecution: { startedAt: Date.now() - 60_000, searchFromBlock: '100', checks: 1, attemptId: 'declined-attempt', walletRejectedAt: Date.now() - 30_000 }, relayStatus: 'Wallet approval declined' } : {}),
            ...(['native-failed', 'relay-failed'].includes(scenario ?? '') ? { status: 'failed', executionFailure: { safeTxHash: `0x${'ab'.repeat(32)}`, txHash: `0x${'cd'.repeat(32)}`, block: { blockNumber: '490', blockHash: `0x${'ef'.repeat(32)}`, timestamp: Date.now() - 60_000 } }, approvalMethod: 'workspace', safeTxHash: `0x${'ab'.repeat(32)}`, ...(scenario === 'native-failed' ? { nativeExecution: { startedAt: Date.now() - 60_000, searchFromBlock: '100', checks: 1 } } : {}), relayStatus: 'Execution failed', relayError: 'This payment failed. No money was sent to the recipients. Create a new payment to try again.' } : {}),
            ...(scenario === "delegated-batch" ? { scheduledAt: undefined } : {}),            ...(["recovery", "preparation"].includes(scenario ?? "") ? { status: "relaying", executionFee: { token: "USDC", amount: "0.05" } } : {}),
            ...(scenario === "delegated"
              ? {
                  status: "draft",
                  safeTxHash: undefined,
                  scheduledAt: undefined,
                  totalAmount: "14225",
                }
              : {}),
            recipients: recipients
              .slice(0, scenario === "delegated" ? 1 : 2)
              .map((r, i) => ({
                _id: `pr${i}`,
                beneficiaryId: r._id,
                recipientName: r.name,
                recipientAddress: r.walletAddress,
                amount: (Number(p.totalAmount) / 2).toString(),
                beneficiary: r,
              })),
          }
        : null;
      break;
    }
    case "screeningQueries:getScreeningEnforcement":
      value = org.screeningEnforcement;
      break;
    case "screeningQueries:checkDisbursementRecipients":
      value = { clear: true, flagged: [], enforcement: "off" };
      break;
    case "screeningQueries:listScreeningResults":
      value = [];
      break;
    case "screeningQueries:getScreeningResult":
      value = { _id:'screening1',runId:'run1',status:scenario === 'screening-stale' ? 'clear' : 'potential_match',screenedAt:Date.now()-3600000,canReview:true,canRerun:true,evidenceKey:'sample-evidence',input:{name:'Maya Chen',walletAddress:recipients[0].walletAddress,preferredChainId:8453,preferredToken:'USDC'},dataset:{checksum:'a'.repeat(64),publishedAt:Date.UTC(2026,8,4),entryCount:19329,sourceUrl:'https://sanctionslistservice.ofac.treas.gov/api/download/sdn.xml',engine:'ofac-sdn-v2.1'},issue:scenario === 'screening-stale' ? {status:'stale',reason:'The OFAC list changed after this check. Run screening again.'} : {status:'potential_match',reason:'An OFAC list match needs a reviewer’s decision.'},matches:scenario === 'screening-stale' ? [] : [{sdnId:123,matchedName:'Maya Chen',matchScore:1,kind:'name',alias:'weak',programs:['QA SAMPLE']},{sdnId:124,matchedName:'Example listed entity',matchScore:1,kind:'address',matchedAddress:recipients[0].walletAddress,listedCurrency:'ETH',listedChainId:1,networkMatch:scenario === 'screening-exact' ? 'listed_network' : 'other_network'}],decisions:[],checks:[]};
      break;
    case "ofacData:status":
      value = {dataset:{publishedAt:Date.UTC(2026,8,4),entryCount:19329,aliasCount:24543,addressCount:1007},lastCheckedAt:Date.now()-3600000,lastError:scenario === 'screening-stale' ? 'Source refresh was interrupted. The previous list remains active.' : null,refreshing:false,sourceUrl:'https://sanctionslistservice.ofac.treas.gov/api/download/sdn.xml',engine:'ofac-sdn-v2.1',threshold:0.85};break;
    case "reports:getTransactionReport":
      value = {
        items: payments
          .filter((p) => p.status === "executed")
          .map((p) => ({
            ...p,
            ...identifyAsset(p.chainId, configuredTokenAddress(p.chainId, p.token), p.token),
            includedInTotals: true, accountAddress: safes[0].safeAddress,
            rowId: p._id,
            kind: "payment",
            amount: p.totalAmount,
            direction: "outflow",
            beneficiaryName: p.name,
            beneficiaryWallet: recipients[0].walletAddress,
          })),
        totals: [{ ...identifyAsset(8453, configuredTokenAddress(8453, "USDC"), "USDC"), amount: "35700", inflow: "0", outflow: "35700", net: "-35700" }],
      };
      break;
    case "reports:getSpendingByBeneficiary":
      value = recipients.slice(0, 3).map((r) => ({
        beneficiaryId: r._id,
        beneficiaryName: r.name,
        beneficiaryType: r.type,
        beneficiaryWallet: r.walletAddress,
        transactionCount: 2,
        totalPaid: "11900",
        ...identifyAsset(8453, configuredTokenAddress(8453, "USDC"), "USDC"),
      }));
      break;
    case "audit:list":
      value = [];
      break;
    case "billingCheckoutData:current":
    case "billingCheckoutData:get":
      value = scenario?.startsWith('billing-server-') ? { _id: 'checkout-demo', orgId: 'demo', createdBy: 'u1', requestId: 'qa-checkout', plan: 'team', chainId: 11155111, payer: scenario === 'billing-server-other-payer' ? members[1].walletAddress.toLowerCase() : wallet.toLowerCase(), treasury: wallet, tokenAddress: configuredTokenAddress(11155111, 'USDC'), amountRaw: '50000000', status: scenario === 'billing-server-other-payer' ? 'prepared' : 'requested', active: true, nonce: 7, attemptId: 'qa-attempt', fromBlock: '100', checks: 1, createdAt: Date.now() - 100000, updatedAt: Date.now() - 1000 } : null;
      break;
    case "billing:get":
      value = {
        plan: "team",
        status: "active",
        isActive: true,
        daysRemaining: 30,
        trialEndsAt: undefined,
        paidThroughAt: Date.now() + 30 * 86400000,
        expiresAt: Date.now() + 30 * 86400000,
        limits: { maxUsers: 5, maxBeneficiaries: 100 },
        usage: { activeMembers: 2, reservedSeats: 4, pendingInvitations: 2, recipients: 12, archivedRecipients: 3, activeAccounts: 2 },
        paymentConfig: ["billing-reverted", "billing-checkout"].includes(scenario ?? "") ? { treasury: wallet, chainId: 11155111, network: "Sepolia", testnet: true, tokenAddress: configuredTokenAddress(11155111, "USDC"), decimals: 6, explorer: "https://sepolia.etherscan.io" } : null,
        payments: [],
      };
      break;
    case "depositsData:listRecent":
      value = [];
      break;
    case "depositsData:statusForOrg":
      value = scenario?.startsWith('deposit-') ? [{ safeId: 'safe_demo', chainId: 1, lastSyncedAt: 1788609600000, completedThrough: 1788609540000, historyReconciled: true, syncing: scenario === 'deposit-progress', error: scenario === 'deposit-error' ? 'The deposit history service is unavailable (HTTP 503). Your saved history is unchanged.' : null, pages: 27, nextAttemptAt: scenario === 'deposit-error' ? Date.now()+300_000 : null }] : [];
      break;
    default:
      value = undefined;
  }
  if (scenario === "expired" && name === "billing:get") {
    value = {
      ...value,
      status: "expired",
      isActive: false,
      daysRemaining: 0,
      paidThroughAt: Date.now() - 86400000,
      expiresAt: Date.now() - 86400000,
    };
  }
  if (scenario === 'billing-trial' && name === 'billing:get') value = { ...value, plan: 'trial', status: 'trial', trialEndsAt: Date.now()+7*86400000, paidThroughAt: undefined, expiresAt: Date.now()+7*86400000, daysRemaining: 7 };
  if (scenario === 'billing-usage-unavailable' && name === 'billing:get') value = { ...value, usage: null };
  if (name === 'billing:get') { value = { ...value, ...licenseBillingFixture(scenario) }; value = { ...value, ...billingAccess(value) }; }
  if (scenario === "precision" && name === "reports:getSpendingByBeneficiary") {
    value = [{ ...value[0], totalPaid: "9007199254.740993" }];
  }
  if (scenario === "empty") {
    if (
      [
        "beneficiaries:list",
        "invoices:list",
        "paymentRuns:listRecurring",
        "reports:getSpendingByBeneficiary",
        "audit:list",
      ].includes(name)
    )
      value = [];
    if (name === "disbursements:list")
      value = { items: [], totalCount: 0, nextCursor: null, hasMore: false };
    if (name === "reports:getTransactionReport")
      value = { items: [], totals: [] };
  }
  if (['report-environments', 'report-observed'].includes(scenario ?? '') && name === 'reports:getTransactionReport') {
    const rows = [
      { ...identifyAsset(8453, configuredTokenAddress(8453, 'USDC'), 'USDC'), amount: '1250.000001', beneficiaryName: 'Business deposit' },
      { ...identifyAsset(11155111, configuredTokenAddress(11155111, 'USDC'), 'USDC'), amount: '900000', beneficiaryName: 'Test deposit' },
      { ...identifyAsset(8453, wallet, 'USDC'), amount: '60000', beneficiaryName: 'Unrecognized deposit' },
    ].map((asset, i) => ({ ...asset, _id: `deposit${i}`, rowId: `deposit${i}`, createdAt: Date.now(), kind: 'deposit', status: 'received', direction: 'inflow', accountAddress: safes[0].safeAddress, beneficiaryWallet: wallet, includedInTotals: asset.recognized }));
    const items = rows.filter(i => inReportEnvironment(i, args.environment));
    value = { items, totals: items.filter(i => i.includedInTotals).map(i => ({ ...i, inflow: i.amount, outflow: '0', net: i.amount })), excludedCount: items.filter(i => !i.includedInTotals).length };
  }
  if (name === 'reports:getTransactionReport') {
    const inScope = (i: any) => inReportEnvironment(i, args.environment) && (args.chainId === undefined || i.chainId === args.chainId);
    const matchesAsset = (i: any) => (!args.token?.length || (i.recognized && args.token.includes(i.token))) && (!args.assetIds?.length || args.assetIds.includes(i.assetId));
    const scoped = value.items.filter(inScope);
    value = { ...value, assets: [...new Map(scoped.map((i: any) => [i.assetId, i])).values()], items: scoped.filter(matchesAsset), totals: value.totals.filter((i: any) => inScope(i) && matchesAsset(i)), excludedCount: scoped.filter((i: any) => matchesAsset(i) && !i.includedInTotals).length };
  }
  if (name === 'reports:getSpendingByBeneficiary') value = { items: value.filter((i: any) => inReportEnvironment(i, args.environment)) };
  if (name.startsWith('reports:')) value = { ...value, isDone: true, continueCursor: '', indexVersion: 1, indexing: false, indexErrors: [], rangeError: '' };
  if (['report-paged', 'report-export-failure', 'report-index-busy'].includes(scenario ?? '') && name === 'reports:getTransactionReport') {
    const asset = identifyAsset(8453, configuredTokenAddress(8453, 'USDC'), 'USDC');
    const all = Array.from({ length: 151 }, (_, i) => ({ ...asset, sourceId: `source-${i}`, _id: `source-${i}`, rowId: `entry-${i}`, createdAt: Date.UTC(2026, 8, 6), amount: '1.000001', status: 'executed', kind: 'payment', direction: 'outflow', safeId: safes[0]._id, accountAddress: safes[0].safeAddress, beneficiaryName: `Vendor ${String(i + 1).padStart(3, '0')}`, beneficiaryWallet: wallet, includedInTotals: true }));
    const offset = args.cursor ? Number(String(args.cursor).split(':')[1]) : 0;
    const current = all.slice(offset, offset + 100);
    const matches = !args.token?.length || args.token.includes('USDC');
    value = { ...value, items: matches ? current : [], assets: [asset], totals: matches ? [{ ...asset, amount: '151.000151', inflow: '0', outflow: '151.000151', net: '-151.000151' }] : [], excludedCount: 0, isDone: !matches || offset + 100 >= all.length, continueCursor: `page:${offset + 100}`, scanned: current.length, indexing: scenario === 'report-index-busy', indexErrors: scenario === 'report-index-busy' ? ['A recorded transaction has an invalid date'] : [] };
  }
  if (scenario?.startsWith('report-account-history') && name === 'depositsData:statusForOrg') value = [{ safeId: 'safe_demo', chainId: 8453,
    lastSyncedAt: Date.UTC(2026, 8, 6, 12), completedThrough: Date.UTC(2026, 8, 6, 11, 59), includesOutgoing: true, historyReconciled: true, syncing: false, error: null, pages: 0 }];
  if (scenario?.startsWith('report-account-history') && name === 'reports:getTransactionReport') {
    const asset = identifyAsset(8453, configuredTokenAddress(8453, 'USDC'), 'USDC');
    const items = [
      { rowId: 'saved-transfer-1', sourceId: 'saved-payment-1', amount: '1250.000001', amountRaw: '1250000001', kind: 'payment', beneficiaryName: 'Maya Chan', dateSource: 'settlement', memo: 'INV-1042 · existing payable', transferId: `e${'ab'.repeat(32)}1` },
      { rowId: 'saved-transfer-2', sourceId: 'outside-payment-1', amount: '45.25', amountRaw: '45250000', kind: 'account_transfer', beneficiaryName: 'Unmatched outflow', dateSource: 'provider', memo: 'No matching Disburse payment · review against your books', transferId: `e${'cd'.repeat(32)}2` },
    ].map(row => ({ ...asset, ...row, _id: row.sourceId, createdAt: Date.UTC(2026, 7, 31, 23, 59, 59), observedAt: Date.UTC(2026, 8, 2),
      status: 'executed', direction: 'outflow', safeId: safes[0]._id, accountAddress: safes[0].safeAddress, beneficiaryWallet: wallet,
      blockNumber: '123', txHash: `0x${'ab'.repeat(32)}`, includedInTotals: true, transferMatch: row.kind === 'payment' ? 'matched' : '' }));
    if (scenario === 'report-account-history-pending') items.push({ ...items[1], rowId: 'legacy-payment', sourceId: 'legacy-payment',
      kind: 'payment', beneficiaryName: 'Legacy payment record', transferMatch: 'pending', transferId: '', amountRaw: '',
      includedInTotals: false, memo: 'Original payment details need review' });
    value = { ...value, items, assets: [asset], totals: [{ ...asset, amount: '1295.250001', inflow: '0', outflow: '1295.250001', net: '-1295.250001' }], excludedCount: items.filter(i => !i.includedInTotals).length };
  }

  if (name === 'customerOperations:current') value = JSON.parse(sessionStorage.getItem('qa:customerOperation') ?? 'null');
  if (name === 'customerOperations:conflict') value = null;
  if (name === 'receivables:list' && args.environment) value = { ...value, items: value.items.filter((i: any) => chainEnvironment(i.chainId) === args.environment) };
  if (name === 'disbursements:list' && args.environment) {
    const items = value.items.filter((i: any) => chainEnvironment(i.chainId) === args.environment);
    value = { ...value, items, totalCount: items.length };
  }
  if (name === 'workspace:overview' && args.environment && args.environment !== 'production') value = { ...value, accountCount: 0, needsReview: 0, scheduledCount: 0, review: [], upcoming: [], recent: [], exceptions: [], exceptionCount: 0, drafts: [], draftCount: 0, plannedDebits: [] };
  cache.set(key, value);
  return value;
}
const disabled = async () => {
  throw new Error(
    "Visual QA mode is read-only. No payment or database action was performed.",
  );
};
export function useMutation(reference?: any) {
  if (getFunctionName(reference) === 'customerOperations:begin' && sessionStorage.getItem('qa:scenario')?.startsWith('customer-setup-')) return async (args: any) => {
    if (sessionStorage.getItem('qa:scenario')?.endsWith('save-failed')) throw new Error('Database connection interrupted');
    const record = JSON.parse(args.record);
    const operation = { _id: 'setup1', record: args.record, hash: record.quote.hash, chainId: record.intent.chainId, fee: '25000', feePaid: false, state: 'pending', open: true };
    sessionStorage.setItem('qa:customerOperation', JSON.stringify(operation)); cache.clear(); fixtureRevision++; fixtureListeners.forEach(listener => listener()); return 'setup1';
  };

  if (sessionStorage.getItem('qa:scenario')?.startsWith('customer-setup-')) {
    if (getFunctionName(reference) === 'orgs:create') return async () => ({ orgId: 'demo' });
    if (getFunctionName(reference) === 'orgs:updateOwnProfile') return async () => null;
    if (getFunctionName(reference) === 'orgs:inviteMember') return async () => null;
  }
  if (reference && getFunctionName(reference).startsWith('licenseAdmin:') && sessionStorage.getItem('qa:scenario') === 'license-operator') return async (args: any) => { const result = await licenseMutationFixture(getFunctionName(reference), args); cache.clear(); fixtureRevision++; fixtureListeners.forEach(listener => listener()); return result; };
  if (reference && (sessionStorage.getItem('qa:scenario') === 'multiple-accounts' || sessionStorage.getItem('qa:scenario')?.startsWith('accounting'))) return async (args: any) => {
    sessionStorage.setItem('qa:lastMutation', JSON.stringify({ name: getFunctionName(reference), args }));
    return disabled();
  };
  if (reference && getFunctionName(reference) === 'reportIndex:refresh') return async () => ({ retrying: 0, indexing: false });
  return disabled;
}
export function useConvex() {
  return { query: async (reference: any, args: any) => {
    if (sessionStorage.getItem('qa:scenario') === 'report-export-failure' && args.cursor) throw new Error('Report activity changed during export. Refresh the report and try again.');
    return readQueryFixture(reference, args);
  } };
}
export function useAction(reference: any) {
  if (getFunctionName(reference) === 'teamInvitationLinks:create' && sessionStorage.getItem('qa:scenario') === 'invite-share') return async () => ({ invitationId: 'qa-invitation', url: `${location.origin}/invite#${'e'.repeat(64)}` });
  if (sessionStorage.getItem('qa:scenario')?.startsWith('customer-setup-')) {
    if (getFunctionName(reference) === 'customerExecution:refresh') return async () => {
      const scenario = sessionStorage.getItem('qa:scenario') ?? '';
      if (scenario.endsWith('check-outage')) throw new Error('RPC HTTP 503 https://rpc.example/private-key');
      const state = scenario.endsWith('success') || scenario.endsWith('link-failed') ? 'confirmed' : scenario.endsWith('reverted') ? 'failed' : scenario.endsWith('expired-request') ? 'expired' : 'pending';
      if (state === 'failed' || state === 'expired') { sessionStorage.removeItem('qa:customerOperation'); cache.clear(); fixtureRevision++; fixtureListeners.forEach(listener => listener()); }
      return { state, feePaid: state === 'failed' };
    };
    if (getFunctionName(reference) === 'customerExecution:completeSetup') return async () => {
      if (sessionStorage.getItem('qa:scenario')?.endsWith('link-failed')) throw new Error('Database write interrupted https://rpc.invalid/private');
      sessionStorage.removeItem('qa:customerOperation'); cache.clear(); fixtureRevision++; fixtureListeners.forEach(listener => listener()); return { safeId: 'safe1' };
    };
  }

  if (['spendingPolicies:approvals', 'accountCancellations:approvals'].includes(getFunctionName(reference))) return async () => {
    const scenario = sessionStorage.getItem('qa:scenario');
    if (scenario === 'policy-approval-outage') throw new Error('Policy reader unavailable');
    const root = safes[0].safeAddress.toLowerCase(), parent = '0x9999999999999999999999999999999999999999';
    const nested = ['policy-nested', 'cancel-nested'].includes(scenario ?? ''), ready = ['policy-declined', 'cancel-declined'].includes(scenario ?? '');
    const path = nested ? [root, parent] : [root];
    const group = { address: nested ? parent : root, path, owners: [wallet.toLowerCase(), members[1].walletAddress.toLowerCase()], confirmedOwners: ready ? [wallet.toLowerCase(), members[1].walletAddress.toLowerCase()] : [members[1].walletAddress.toLowerCase()], threshold: 2 };
    return { ready, blockedReason: scenario === 'policy-changed' ? 'The account spending policy changed after this request. Review its original intent before applying it.' : null, currentNonce: 3,
      proposal: { safeAddress: root, safeTxHash: `0x${'ab'.repeat(32)}`, senderAddress: wallet, senderSignature: '0x', safeTransactionData: { to: root, value: '0', data: '0x', operation: 0, safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: '0x'+'00'.repeat(20), refundReceiver: '0x'+'00'.repeat(20), nonce: 3 } },
      groups: nested ? [{ address: root, path: [root], owners: [parent], confirmedOwners: [], threshold: 1 }, group] : [group],
      names: [{ address: root, name: nested ? 'Payroll' : 'Operations' }, { address: parent, name: 'Treasury' }], paths: [{ path, labels: nested ? ['Payroll', 'Treasury'] : ['Operations'], approved: ready }] };
  };
  if (getFunctionName(reference) === 'receiptEvidence:verify') return async (args: any) => {
    sessionStorage.setItem('qa:lastMutation', JSON.stringify({ name: getFunctionName(reference), args }));
    return disabled();
  };
  if (getFunctionName(reference) === 'accountBalances:check') return async (args: any) => {
    sessionStorage.setItem('qa:lastMutation', JSON.stringify({ name: getFunctionName(reference), args }));
    throw new Error('Historical account data is unavailable. Refresh account history and try this check again.');
  };
  if (getFunctionName(reference) === 'accountReadiness:get') return async (args: any) => {
    const scenario = sessionStorage.getItem('qa:scenario');
    if (scenario === 'funding-outage') throw new Error('QA account service outage');
    return { safeId: args.safeId, safeAddress: args.safeId === 'payroll-safe' ? '0x9999999999999999999999999999999999999999' : safes[0].safeAddress, name: args.safeId === 'payroll-safe' ? 'Payroll' : scenario === 'multiple-accounts' ? 'Operations' : 'Operating account', chainId: 8453, network: 'Base', environment: 'production', checkedAt: Date.now(), blockNumber: '100000', error: null, assets: ['USDC', 'USDT'].map(token => ({ token, address: configuredTokenAddress(8453, token), balance: scenario === 'funding-shortfall' ? token === 'USDC' ? '0' : '100' : '148250.5' })), owners: safes[0].owners.map((address, i) => ({ address, name: i ? 'Jordan Lee' : 'Alex Morgan', canApproveInApp: true })), threshold: 2, canPrepare: true, isOwner: true, native: { symbol: 'ETH', payerAddress: wallet, balance: '0.01' }, managed: { fee: { token: 'USDC', tokenAddress: configuredTokenAddress(8453, 'USDC'), collector: wallet, amount: '0.05' }, error: null } };
  };
  if (getFunctionName(reference) === "deposits:syncForOrg") return async () => ({ inserted: 0, errors: [] });
  if (getFunctionName(reference) === "billing:verifySubscriptionPayment" && sessionStorage.getItem("qa:scenario") === "billing-reverted")
    return async (args: any) => { throw new ConvexError({ code: "BILLING_PAYMENT_REVERTED", txHash: args.txHash.toLowerCase(), message: "Payment transaction reverted. No subscription payment was collected. You can try again." }); };
  if (getFunctionName(reference) === "delegatedPayments:quote")
    return async (args: any) => ({
      hash: `0x${"ab".repeat(32)}`,
      available: sessionStorage.getItem("qa:scenario") === "delegated-batch" ? "50000000000" : "25000000000",
      additionalTransfers: sessionStorage.getItem("qa:scenario") === "delegated-batch" ? [{ hash: `0x${"ef".repeat(32)}`, amount: "14225", nonce: 8, recipientAddress: recipients[1].walletAddress }] : [],
      fee: args.feeMode === "wallet" ? undefined : { amount: "0.05", token: "USDC" },
      feeHash: args.feeMode === "wallet" ? undefined : `0x${"cd".repeat(32)}`,
      delegate: wallet,
      chainId: 8453,
    });
  if (getFunctionName(reference) === "paymentExecution:approvalStatus")
    return async () => {
      const scenario = sessionStorage.getItem('qa:scenario');
      if (scenario === 'nested-outage') throw new Error('Current approving accounts could not be verified');
      if (scenario?.startsWith('nested-')) {
        const root = safes[0].safeAddress.toLowerCase(), parent = '0x9999999999999999999999999999999999999999';
        const ready = scenario === 'nested-ready';
        const confirmedOwners = ready ? [parent] : [];
        return { owners: [parent], confirmedOwners, threshold: 1, currentNonce: 3, proposalNonce: 3, ready,
          workspace: { names: [{ address: root, name: 'Payroll' }, { address: parent, name: 'Treasury' }], paths: [{ path: [root, parent], labels: ['Payroll', 'Treasury'], approved: ready }],
            groups: [{ address: root, path: [root], owners: [parent], confirmedOwners, threshold: 1 }, { address: parent, path: [root, parent], owners: [wallet, members[1].walletAddress], confirmedOwners: ready ? [wallet, members[1].walletAddress] : [members[1].walletAddress], threshold: 2 }] } };
      }
      return {
      owners: [wallet.toLowerCase(), safes[0].owners[1].toLowerCase()],
      confirmedOwners: [safes[0].owners[1].toLowerCase()],
      threshold: 2,
      currentNonce: 3,
      proposalNonce: 3,
      ready: false,
      };
    };
  return disabled;
}

export function useQuery(reference: any, args: any) {
  useSyncExternalStore(subscribeToFixtures, () => fixtureRevision);
  return readQueryFixture(reference, args);
}
