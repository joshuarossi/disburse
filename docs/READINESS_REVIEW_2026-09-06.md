# Product readiness review

September 6, 2026. Verdict: useful core, not ready for a public finance-team launch. Suitable for supervised testnet evaluation. This review evaluates the product experience, not merely whether its tests pass.

This document preserves the original assessment. Subsequent fixes and acceptance evidence are recorded in the [fix-pass report](READINESS_FIX_PASS_2026-09-06.md) and [active TODO](../TODOS.md), including business/test accounting separation, Team recovery, durable owner proposals and real native broadcast recovery. Unchanged findings below are historical observations, not a claim that those fixes are absent.

## Scope and evidence

Revisited the signed-in development app in Chrome: Overview, Accounts, Recipients, recipient import, payment creation, Bills, Recurring & batches, General settings, Payment fees, Plan & billing, and Reports including its filters. Visually inspected the overview, payment form and error screen. Team & approvals failed to load, including after reload. Inspected the corresponding implementation for reporting, imports, invitations, account summaries and payment recovery. Did not move funds or modify customer records during this review.

The earlier 400 unit/integration tests, 130 browser checks and native Sepolia settlement remain useful evidence. They were not rerun for this assessment and do not prove that every live route or wallet interaction works. The native transaction proved exact payment, receipt reconciliation, paid invoice and accounting entry through an isolated SDK-signed flow. Browser signing, managed relay settlement, unattended execution and live subscription checkout remain separate acceptance gaps.

## What is working well

- Saved recipient instructions survive mixed-currency preparation. One payment model supports one or many recipients.
- Invoice records, payment approval and settlement are connected. Cancelling an unexecuted invoice payment returned the bill to Unpaid in live acceptance.
- Exact payment amounts now survive review and reporting, including native-asset precision.
- Recurring instructions distinguish future draft preparation from authorization. The tested monthly schedule advanced correctly and could be paused.
- The visual foundation is coherent: a restrained palette, consistent navigation, readable forms and explicit status labels. Both themes exist.
- Backend authorization, receipt verification and duplicate-submission protections have meaningful coverage. These are foundations to preserve during further UX changes.

## Findings that should block a public launch

### 1. Reporting mixes test funds with real funds

Observed: the default report shows Ethereum, Sepolia and Base Sepolia records together, then totals them by token symbol. The displayed ETH total combines native deposits from all three. Code in `convex/reports.ts` groups by `row.token`; the default report has no environment filter. A manual chain filter exists but does not make the default total suitable for business accounting.

Required change: separate test and production environments in navigation, reports and exports. Default business reports to production. Keep unknown-network historical records explicitly unclassified. Aggregate by verified asset identity, with account/network breakdowns; do not identify arbitrary deposited tokens solely by a supplied symbol.

Acceptance: testnet deposits cannot increase a production total. Unknown-network records remain visible in a reconciliation queue. An unrelated token with the same symbol cannot increase a canonical stablecoin balance.

### 2. Team & approvals failed to load in the live browser

Observed twice: the route showed the full-page error boundary. Browser logs reported failure to fetch the dynamically imported Team module. A direct local server request returned HTTP 200. This establishes a live delivery failure, not a proven defect in the permissions logic or production bundle. Root cause remains unresolved.

Required change: reproduce and resolve the live module-loading failure. Verify the built app as well as the development server. Keep the workspace navigation available when an individual page fails, and distinguish module loading from payment submission errors.

Acceptance: a fresh signed-in session can open Members, Payment limits and Delegated spending; a failed page can be recovered without leaving the workspace.

### 3. Payment availability is discovered too late

Observed: fee settings offer USDC/USDT and a Save action but no account-by-account capability or availability result. Earlier live payment review blocked signing because managed fees were unconfigured. A finance user can prepare a payment without knowing that this funding account cannot currently execute it.

Required change: show account readiness before payment preparation: usable balance, supported recipient currency, approval access, and execution availability. Explain the next action at the point of failure. If native testnet execution is offered, expose it explicitly in the test environment; do not silently replace stablecoin-paid fees.

Acceptance: users know whether they can send before completing a draft. The reviewed fee and execution method match what is signed. Separately complete the managed relay acceptance story.

### 4. Owner proposal recovery still has a persistence gap

Code finding: `src/lib/safe.ts` posts the proposal before returning its hash. `usePaymentActions.ts` then saves the hash in Convex. If the provider accepts but its response is lost, the caller has not captured the hash. If the database save fails after the response, the user sees a message telling them to reconcile the proposal. The managed relay job recovery does not eliminate this earlier proposal gap.

Required change: persist a prepared proposal identity and attempt before the external write, reconcile by the original hash, and provide a resumable in-app state. Keep native transaction broadcast recovery similarly explicit.

Acceptance: interrupt after proposal acceptance and before the database update; reload resumes the same proposal and cannot create a second economic payment.

## Highest-value product improvements

| Area | Current friction | Recommended change |
| --- | --- | --- |
| Overview | The trial banner occupies substantial vertical space. Routine drafts and failed payments share “Needs your attention.” Four balance rows omit other funded accounts. | Compact billing notice while far from expiry; separate approvals, exceptions and upcoming commitments; summarize usable funds without mixing currencies or test money. |
| Payment creation | “New payment batch” starts with batch name, purpose, repeat, timing, funding network and currency. Recipients appear below those decisions. | Start with recipients and amounts, then date, then review. Call it “New payment.” Show saved instructions; reveal overrides only when needed and clearly explain their effect. |
| Navigation | Payments and Recurring & batches both offer batch creation/history. | Keep Payments as the transaction history and action queue. Give recurring instructions a clear Schedules destination, with links to their generated payments. |
| Recipient readiness | “Ready to pay” is based on an address being present. Several recipients still have no currency or network preference. | Say “Address saved” when that is all that is known. Show requested payout currency/network and identify missing instructions or incompatible funding separately. |
| Import | CSV mapping is useful, but duplicate addresses/emails are rejected. No update-existing workflow or source employee identifier is evident. | Add a reviewed create/update/skip diff and stable source IDs for repeat imports. Never overwrite payout instructions without explicit review. Add a recipient details collection flow so finance staff do not have to chase addresses manually. |
| Team onboarding | Invitation requires a sign-in wallet; optional work email is stored but the reviewed mutation does not send an invitation. | Explain delivery clearly, provide an acceptance link, and design email-led onboarding with wallet binding and appropriate authorization. |
| Delegation | Users must understand application roles, budgets, account ownership and on-chain allowances separately. | Present a member summary: what they can prepare, approve and send, which accounts, amount/period limits, and whether each restriction is enforced by Disburse or the account. Keep technical configuration in details. |
| Accounts | Names default to networks; the page says “Owner approvals managed in Safe” where no stored threshold is present. | Support business names such as Payroll or Vendor payments. Show verified current approval requirements in the app, freshness of balance data and usable funding guidance. |
| Bills | Manual amount/date/description entry works, but the editor has no source invoice attachment or extraction flow. | Add source documents and a reviewed extraction step; keep duplicate invoice detection and the settlement link. Treat this as accounts payable. Outgoing invoicing is a separate product scope. |
| Schedules | A schedule exists, but a finance team needs to know who must approve before payday and what happens if they do not. | Show the next draft, approval deadline and responsible people. Add reliable reminders, late-approval handling and failure escalation; do not market draft generation as unattended payroll. |
| Reports | The filter offers only USDC/USDT despite PYUSD and ETH records. Archived recipients appear as indistinguishable repeated names. Deposit-sync errors are swallowed. | Derive filter options from supported/observed assets, label archived records, surface sync status and retry, and add accounting export mappings. |
| Billing | “1 Safe per chain” is an implementation-oriented plan feature; unused-paid-time copy is shown on a trial. | Describe business account limits in finance language, tailor trial copy and show active usage against limits. Keep the already-clear manual-renewal explanation. |
| Error states | A module failure removes navigation and tells the user about payment submission even when they were opening Team. | Use page-level recovery and action-specific errors. Payment uncertainty must preserve the original submission and offer a direct reconciliation action. |

## Architecture and scale

`convex/reports.ts` collects complete payment/deposit histories and loads batch recipients separately. `workspace.ts` caps payment history at 5,000 records but still collects recipients, bills and accounts. These approaches may work for a small workspace, but there is no volume evidence here for a large finance team. Add indexed pagination for detailed reports, bounded exports and incremental aggregates. Test with representative histories, including archived recipients, partially migrated records, same-symbol assets and simultaneous approvals. Do not judge scale from the 67-row live report.

The account and payment logic should have shared definitions of readiness, asset identity, payable state and recovery state. The present “ready” label, fee availability screen and report totals show how independent views can disagree even when each renders successfully.

## Recommended order

1. Fix the concrete trust issues: environment/asset separation in reporting, Team loading, early execution availability, durable proposal recovery.
2. Simplify the main journey: recipient-first payment creation, a focused overview, clearer account names and schedule navigation.
3. Finish team operations: reviewed repeat imports, recipient detail collection, invitations, approval reminders and actionable payment exceptions.
4. Improve accounts payable and reconciliation: attachments, complete filters, sync feedback and accounting export mappings.
5. Complete real browser signing, managed-fee settlement, scheduled execution and subscription acceptance. Run a realistic whole-cycle pilot with a second person doing approvals.

Do not add yield, staking or cross-chain conversion before these steps. They introduce more choices and reconciliation work before the basic payment cycle is dependable.

## Release decision

There is a useful product here, but it still asks users to understand too much of its implementation and contains unresolved correctness and delivery issues. A finance team should be able to answer four questions immediately: what can we spend, what needs my approval, what will happen on payday, and what actually settled. The next pass should be judged against those questions, not the number of screens or tests.

This review does not claim new fixes or completion. It records observed issues, code-backed findings and recommended work. Deployment credentials are not the explanation for the UX and reporting issues above.
