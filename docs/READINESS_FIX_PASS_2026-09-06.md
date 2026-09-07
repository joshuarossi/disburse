# Readiness fix pass, September 6, 2026

This pass closes five findings from the [readiness review](READINESS_REVIEW_2026-09-06.md) and adds verified native-payment recovery. It does not establish public launch readiness. The [active TODO](../TODOS.md) retains unfinished product work and acceptance gaps.

## User stories and observed results

| Story | Result | Evidence and limits |
| --- | --- | --- |
| Review business finances without test money affecting totals | Business activity is the default across account balances, Overview queues, payment history, schedules, receivables and reports. The header switches to Test activity or Unclassified records. Exports state environment, network and contract. | Backend regressions, browser scope/reload/export checks, and the signed-in built app. A fresh real Sepolia payment appears in test accounting and is absent from business accounting. Recipients, bills and team settings remain shared. |
| Distinguish a legitimate currency from an unrelated token using its name | Asset identity uses chain and contract. Registered token metadata determines ticker and decimals. Unverified deposits remain visible but do not enter canonical totals. Spending remains separate by asset and network. | Same-symbol impostor and separate-network fixtures, raw base-unit precision and archived-recipient tests. Historical app payments without a saved contract use the prior configured chain/symbol mapping; no historical chain migration was performed. |
| Open all Team sections and recover a failed page | Members, Payment limits and Delegated spending load in development and the normal production build. A policy queue error caused by a lowercase Safe address is fixed by checksum normalization. A page failure retains navigation and offers reload. | Real signed-in browser visits to all three sections. Forced Team module-download failure, navigation to another route and reload recovery have browser coverage. The earlier download failure did not recur; its original cause is not claimed as proven. |
| Resume payment preparation after a lost provider response | The backend validates and atomically saves the signed owner payload and hash before the browser posts it to the transaction service. Resume preparation reuses that exact payload, fee and hash. | Persistence failure, accepted POST with lost response, full-payload comparison, same-hash retries, unauthorized access and concurrent detail-change tests. The Sepolia recovery story also used this persistence path before its successful POST. |
| Recover a native payment when the wallet's broadcast hash never reaches the app | The server saves a block checkpoint before broadcast. A bounded background queue looks up the original Safe hash through the service or account execution logs, then verifies network confirmations and recipient transfers. Check settlement restarts reconciliation without broadcasting. | Real Sepolia proof below. Automated tests cover an unavailable service with network-log fallback, wrong or removed events, insufficient transfers, confirmation depth, queue rotation and access controls. No automatic replacement payment is created. |
| Review reports and recover payments on a phone in either theme | Mobile header controls fit at 320 and 390 pixels. New payment uses a named icon button on narrow screens. Recovery text, action and exact recipient amounts remain readable. | Inspected desktop built-app reports, 390-pixel light reports and both mobile recovery themes. A screenshot exposed a clipped header action that a document-overflow assertion missed; tests now check the full control bounds. |

## Real native recovery proof

The isolated QA Safe paid **0.000001 test USDC** on Sepolia. The runner kept the network transaction hash in its private local journal and deliberately did not submit it through `updateStatus` or `confirm`. The backend recovered that hash and marked the payment executed only after receipt verification. The linked bill became paid and reports retained the exact six-decimal amount. A rerun checked the same settlement without another broadcast.

- [Sepolia transaction](https://sepolia.etherscan.io/tx/0x7754db8a62227955b745241cee3a18c48ad51a63f9e1e45b3c7c679c75e88fd8).
- Safe: `0x17Fc8c99f7e823eB73b5325a0A7699f7e9c729c7`.
- Gas used: 84,446. Actual test ETH fee: 0.000173424517447760.
- The now-retired `qa-native-recovery.mjs` runner checked the development deployment, Sepolia chain, isolated owner, Safe and exact recipient, and refuses a second broadcast after an uncertain attempt.
- Local evidence: `.local/qa/native-recovery-report.json`, restricted to the local QA directory. It contains the signed test proposal and is not a public artifact.

This proves SDK-signed native execution and backend recovery. It does not prove a browser extension's rejection/retry flow or managed stablecoin-fee settlement. The offline-service fallback was tested with injected failures, not by taking the live external service offline.

## Accounting and database boundaries

Recipient payout changes now have an append-only decision history in `recipientChanges`. New and imported addresses require review; changed instructions remain proposals until approval. An active admin or approver must record an independent verification channel and a reason. When another eligible reviewer exists, the requester cannot decide their own request. A sole approver can proceed with the same explicit verification evidence; this is a customer attestation, not cryptographic proof of address ownership.

Each payable recipient has a `payoutVersion`; new payment snapshots bind that version and destination. Pending review suspends app authorization. Approving a replacement advances the version, making older drafts and approvals unusable through Disburse. Owner confirmation checks again after wallet signing, and the managed worker checks before claiming submission. Settlement reconciliation remains available for an already-broadcast transaction. Full old/new addresses, lookalike warnings, review history and reasons appear in the recipient review dialog, verified in light desktop and dark mobile layouts.

Migration is explicit: historical recipient records without a review are unreviewed. They require a first review before a new payment. Existing signed proposals are not rewritten or represented as revoked on-chain. Affected payments must be cancelled/replaced through the appropriate account-owner process; the app continues to preserve their original destination and history.

`shared/assets.ts` defines asset identity and activity environment. Reports use integer base units and retain account, network, contract and environment in rows and exports. Canonical deposit amounts derive from raw units and configured decimals. Unknown assets are disclosed separately and excluded from canonical totals.

New payment preparation pins `disbursements.tokenAddress`. Proposal validation rejects a changed configured contract before signing or execution. `ownerProposals` stores the signed payload under its payment ID. Preparation rechecks the complete payment, account and recipient snapshot in the same mutation that saves the payload; equal timestamps cannot hide a concurrent edit.

Deposit insertion and sync-state writes are internal mutations. They validate organization, account, network and destination. Authenticated members can request the server's external sync, but cannot insert arbitrary deposit records directly. HTTP failures remain visible and do not advance the successful-sync timestamp.

Deposit synchronization now commits each page with its next cursor. A leased worker processes four pages per invocation and schedules continuation; it does not abandon history at a page cap. First/full scans include history before the account was linked. Later scans overlap the completed time window, with a weekly full rescan for late-indexed history. Transfer identity uses the service's event/trace ID, scoped to the linked account. The first matching legacy row is adopted with its prior values retained; additional collapsed events become separate rows and duplicate legacy rows are superseded without deletion. Malformed historical raw amounts are excluded from canonical totals. This reconciles the provider's indexed history; it is not an independent proof of the provider's chain coverage.

Live verification exposed the former Safe service URLs returning HTTP 308. The shared endpoints now use [Safe's current API](https://docs.safe.global/core-api/transaction-service-reference/mainnet), with an exact allowlist rewrite for persisted legacy cursors. The worker refuses arbitrary redirects. Two live accounts initially returned HTTP 429; background retries subsequently completed all four business-account scans, and the visible errors cleared. Provider retry headers and exponential backoff are retained; archiving an account pauses its scan without discarding continuation.

Native execution stores its start time, block cursor and check count. An indexed due queue processes at most 20 payments per cron run. Each scan covers at most 2,000 blocks with overlap and advances only through confirmed blocks. After 120 unsuccessful checks, the payment needs investigation and retains the original identity. A user can request another check. Rejected or never-broadcast wallet submissions still need a dedicated, verified resume flow; no absence-of-receipt result authorizes a replacement.

## Verification

| Check | Result |
| --- | --- |
| Unit and integration suite | 456 passed across 56 files; final deposit suite passed 8 tests after adding a backoff/archive regression |
| Full Chromium suite | 157 passed |
| Final recovery-theme checks after visual corrections | Both mobile themes passed, including accessibility scans |
| TypeScript and ESLint | Passed |
| Normal production build | Passed, with existing large wallet/Safe chunk warnings |
| Development backend | Schema/functions synchronized successfully |
| Real signed-in built browser | Team's three sections, Accounts, business/test reports and spending report verified |
| Test funds | One new isolated 0.000001 USDC native recovery payment, exact delta and receipt verified |

Contract sources were not changed or retested in this pass. Earlier receiving-contract test evidence remains in [QA_V2.md](QA_V2.md).

Screenshots are local QA artifacts. `v2-activity-mobile-light.png` shows the compact header and mobile report. `v2-native-recovery-light.png` and `v2-native-recovery-dark.png` show the recovery section and its feedback. These use actual app components with isolated fixtures. The signed-in desktop checks used the real development backend and a normal production build at port 5173.

## Remaining work

Account readiness (R05), recipient assurance (R08) and deposit continuation (R09) are implemented and verified as described in this report. Their tests do not substitute for the remaining live signing/provider acceptance or external security review.

Managed-provider settlement and interruptions, browser-wallet rejection/resume, unattended scheduling, subscription checkout and a complete finance cycle with a second approver remain acceptance work. Repeated recipient imports are now implemented below. Invoice attachments, accounting mappings, broader screening, yield and conversion integrations remain in the program. Large histories and remaining wallet bundles need further work. No pricing or new service fee was activated by this pass.


## Account checks and recipient-first payments

The composer now starts with recipients and exact amounts, then timing, then review. Saved payout currency/network instructions cannot be disabled. Defaults remain collapsed and apply only to absent preferences. The final action saves a draft and explains that different funding groups need separate approval. Mobile review is compact, the primary action stays visible while scrolling, and desktop review now exposes full payout addresses.

The shared account check verifies proxy and singleton identity, reads balances/owners/threshold at one block, resolves workspace approvers and shows payment-service availability. It sums every selected batch's principal and fee by currency against the same account balance. It preserves unknown balances, provides refresh, flags checks older than one minute and explicitly describes native test ETH when that build uses native execution. Balances are current holdings, not a reservation guarantee; outstanding obligations still need the Overview work.

Accounts uses the same checks. Administrators can name accounts (for example Payroll), with an audit entry and org-bound authorization. Deposit instructions retain the network and full address. No name change alters signing authority.

Live browser evidence: the built signed-in app loaded the new composer and verified Base, Ethereum, Polygon and Arbitrum accounts, each with current one-owner approval and Josh Rossi identified. These business accounts returned zero canonical stablecoin balances. The payment-service configuration was unavailable and the UI reported it before draft creation. No customer recipients were approved and no funds moved.

Base's default RPC returned `over rate limit` during identity verification. The default client now batches reads and falls back to the [PublicNode Base endpoint](https://base.publicnode.com/); explicitly configured RPCs remain authoritative. A direct read and the signed-in browser both verified the Base account after this change. Public RPCs are best-effort infrastructure; see [Base's provider guidance](https://blog.base.org/base-mainnet-is-open-for-builders). This does not establish live relay availability.

Verification: full typecheck/lint plus 463 unit/integration tests passed; 161 browser tests passed; normal production build succeeded. The browser pass caught and corrected missing currency labels, warning contrast and list semantics. Visual artifacts: `.local/qa/payment-recipients-light.png`, `payment-recipients-dark.png`, `payment-timing-light.png`, `payment-timing-dark.png`, `payment-review-light.png`, `payment-review-dark.png`.


## Overview and schedules

Overview separates approval requests, ordinary drafts and exceptions. Failed payments, unresolved relay settlement and missed approval deadlines have their own action queue. It now counts reviewed recipient records. Account balances use the same verification/cache as Accounts and payment creation. The funds panel subtracts prepared, unpaid plans by exact account/currency, including confirmed fees; it labels unquoted fees and states that money is not reserved. Incomplete or unrecognized history prevents a complete-plan remaining amount.

Schedules replaces the second batch-history screen. It displays the next draft date, payday, schedule creator and latest generated payment. Its history link filters Payments by the exact schedule, with an organization check. Pause/resume/edit controls remain. Approval reminders and escalation are still U10.

Verification: full typecheck/lint and 463 tests passed, then the added schedule-history authorization test and updated queue tests passed (27 targeted tests). The 62 relevant browser stories passed, including desktop light and mobile dark accessibility and screenshots (`.local/qa/overview-queues-light.png`, `overview-queues-dark.png`). Normal build and development backend sync succeeded. This is not evidence of a full finance-cycle or managed-provider launch acceptance.

## Repeat employee and vendor imports

Imports match stable source IDs, emails and exact addresses against the directory. Gusto-style employee IDs retain leading zeros and survive an email change. The preview offers create, update or skip with full saved/imported values. Blank cells preserve existing data. Conflicting identities, archived matches, duplicate rows and stale previews prevent writes. Source-system choices describe file provenance; they do not imply a live Gusto or accounting integration.

Payout replacements enter the existing independent-review workflow. Previously approved instructions remain unchanged, and the recipient is held from new app-authorized payments while review is pending. New records can arrive without a payout address. Directory exports include source IDs and payout preferences for repeat use.

Each committed import has an organization-bound request ID, input digest and receipt. Identical retries return the first result; a changed payload cannot reuse that request ID. A minimal browser receipt reference recovers a lost response after reload without retaining the CSV or personal details in browser storage. The backend validates the whole selected set before writing and journals it atomically. Limits are 500 rows and a 10,000-record directory; larger imports require the scale work in S01.

Verification: typecheck/lint and 470 tests passed; the full browser suite passed 168 tests. After a visual correction to make expanded address differences span the table width and stack on phones, all four import browser stories passed again with accessibility checks. Screenshots: `.local/qa/recipient-import-light.png` and `recipient-import-dark.png`. No customer directory records were imported or approved during these checks.

## Recipient detail collection

A finance team can create a private form from an existing recipient. Requests last seven days and are restricted to networks with an active account in the chosen business/test environment. The recipient chooses a currency and network, enters an address, reviews the full instructions and submits. The form requires no wallet connection. The directory tracks outstanding requests; the recipient editor shows submission/review status and recent request history.

The backend generates a 256-bit token, persists its digest and returns the link once. The URL keeps it in the fragment, and the app now uses a no-referrer policy. Replacement revokes the earlier link. Recipient changes, archived records, expired requests and removed requester access invalidate an outstanding request. Invalid/inactive links do not expose saved payment details, email, internal notes or the organization directory. Link creation is limited to ten requests per recipient per day.

Submitting details creates a sourced payout-review record and preserves the approved address/version. The link conveys submission authority only; the reviewer still records independent verification. A second submission can only replay the identical payload. Completion is recoverable through the original link after a lost response or page reload. Request creation/cancellation is audited. The UI says to share the link through an established contact channel and does not claim to have sent an email.

Verification: typecheck/lint and 476 unit/integration tests passed; all 172 browser tests passed. The four collection stories cover full instruction review, retained values on edit, failure retry, persisted receipts, inactive links, request controls and accessibility. Desktop/light and mobile/dark screenshots are `.local/qa/recipient-collection-light.png` and `recipient-collection-dark.png`.

The normal production build and development backend were synchronized. The signed-in Chrome session opened the public form for a newly created recipient in the isolated Sepolia QA organization, submitted the QA wallet's USDC instructions and reloaded the saved receipt. `scripts/qa-recipient-collection.mjs --verify` independently checked the resulting review and unchanged empty directory address. The form submission was not approved, and no funds moved. The private request journal is under `.local/qa/recipient-collection.json` and is not a public deliverable.

## Screening sources, evidence and policy — K03–K07

The official OFAC SDN download now compiles into a versioned dataset with atomic activation and resumable import chunks. The previous active snapshot stays available during refresh. Search candidate retrieval includes unrelated aliases and Unicode names; digital-currency identifiers compare exact addresses with explicit network provenance. Full names, programs, weak aliases, source checksum and the details checked are visible to reviewers. Broad or incomplete searches cannot save a no-match result.

Review decisions require the current evidence key, a reason and a seven/thirty-day expiry. Recipient or match changes reopen review. A stale background success or failure cannot replace a newer attempt. Block mode checks source and recipient freshness, unresolved matches, missing evidence, changed inputs, expired decisions and failures through the shared payment gate. Warn acknowledgement changes with the evidence. No workspace's existing enforcement mode was changed during live QA.

The six-hour source refresh and twenty-recipient-per-minute due queue run on the backend. Version activation queues active recipients. Retired/failed search contents and import journals are removed after seven days in bounded batches, while publication metadata, immutable checks and decisions remain. Settings shows source coverage/freshness, refresh errors and progress. Recipient editing now puts contact/payment details first and evidence panels below; names stack on narrow screens.

Verification:

- `bun run check`: 494 tests across 62 files, typecheck and lint passed after the policy, race and retention fixes. Logs: `/tmp/disburse-screening-check3.log`.
- Full browser suite: 177 passed. Nine focused screening/recipient-collection stories passed after rearranging the editor. Light desktop and dark mobile screenshots were inspected; evidence forms passed WCAG A/AA automated checks. Logs: `/tmp/disburse-screening-e2e-all.log`, `/tmp/disburse-screening-polish.log`.
- Backend deployed to `fortunate-cat-122`, then the scheduled importer activated the September 4 official publication at September 6 16:26:53 UTC. It contains 19,329 records, 24,543 aliases, 1,007 currency identifiers and 55,046 search posting parts. Download checksum: `a6fe1073e4cc3a9ea9b827f63f5ab56b80933603a8af791b21d7cacbf99da598`. Initial import took about 253 seconds after snapshot staging began. Settings showed the actual completed source metadata.
- `bun scripts/qa-ofac.mjs` passed read-only live tests for a published exact ETH identifier, identical bytes on Base labelled as other-network evidence, Sepolia separation, and an unrelated listed alias. CLI-inclusive durations were 1.1–2.6 seconds; these are not isolated server latency benchmarks. Evidence: `.local/qa/ofac-live-evidence.json`.
- The built browser displayed Josh Rossi's automatically completed 16:27:32 UTC check with the active publication and matching checksum. No manual recipient or sanctions decision was approved and no funds moved in this pass.

The [screening review](SCREENING_REVIEW.md) now compares actual provider products, public pricing where available, monitoring behavior and embedded-service terms. No paid provider was enabled or sent recipient data. OFAC list matching remains narrower than ownership verification, beneficial-ownership analysis or transaction-exposure screening; this pass does not claim otherwise.

## U07 — email invitations and acceptance

Team invitations now begin with a work email. A private seven-day link requires explicit acceptance by the wallet verified at sign-in; optional required-wallet invitations remain available. Invitations reserve seats without granting access. Resend invalidates the old link, and revocation, expiry or loss of the inviter's admin access prevents acceptance. Changing a verified membership email clears its verification marker.

Encrypted delivery jobs retry an identical email with a stable provider idempotency key. Expired and exhausted jobs stop; signed webhooks distinguish provider submission, mail-server delivery, bounce and membership acceptance. The [invitation guide](TEAM_INVITATIONS.md) records configuration and precise delivery semantics.

Verification: 505 code tests, typecheck and lint passed; 183 browser checks passed. Eleven focused backend stories and six invitation browser stories cover replay, seat limits, recipient/wallet binding, expiry, provider retry, signatures and failures. Desktop/light and mobile/dark screenshots were visually inspected with automated WCAG A/AA checks. The built app's Team, Invitations and email-first form loaded against the development backend in Chrome. No invitation was sent to a real customer and no access was granted during this review. Mail-provider acceptance is distinct from the mocked transport coverage.

## U08 and R10 — member authority and the Safe module upgrade

Every member now has a View access action. It shows preparation/signing/sending rights, per-payment and monthly currency limits, and account-by-account ownership, threshold and spending grants. App roles and contract authority remain explicit: inactive members may still have grants, and an owner with a Payment preparer role can sign under the current backend policy. Amounts include actual contract allowance remaining, reset periods, dormant grants and exhausted transfer counters. Failed/stale ownership checks cannot present permission as verified. The account default follows the selected business/test environment.

The implementation found an additional security issue: the configured allowance releases were older than Safe's fix for transfer replay and false-return token transfers. Disburse now pins version 1.0.0 and its full bytecode hash for Ethereum, Polygon, Base, Arbitrum and Sepolia. Legacy grants remain visible and revocable; new legacy grants, their policy approvals and prepared relay submissions are refused. Existing submissions still reconcile. Source compilation matches the deployed executable; Solidity metadata differences are documented. See the [upgrade evidence and boundaries](SAFE_ALLOWANCE_UPGRADE.md).

Verification:

- Full code checks: 511 tests across 63 files, typecheck and lint passed. Full browser suite: 191 passed.
- Eight new browser stories cover limits, owner thresholds, inactive/viewer access, disabled grants, legacy migration warnings and network failures. Light/desktop and dark/mobile screenshots were visually assessed, with automated WCAG A/AA checks.
- Live verification initially found public RPC rate-limit failures. Shared read-only clients now batch requests and use Base fallback while respecting explicitly configured endpoints. Fifteen focused allowance tests, eight access browser stories and a checked production build passed after that fix.
- Read-only Base and Sepolia checks loaded current and legacy versions against the connected Safe. The built Chrome session verified Josh Rossi's Base account at block 50964104, its 1-of-1 approval requirement and the absence of grants for that member in all three configured versions. Earlier Sepolia ownership was verified at block 11648806. The release script verified matching 1.0.0 code on all five configured networks and no deployment on Base Sepolia.

Logs: `/tmp/disburse-access-check1.log`, `/tmp/disburse-access-e2e-all.log`, `/tmp/disburse-access-e2e3.log`, `/tmp/disburse-access-live-rpc.log`, `/tmp/disburse-allowance-release-proof2.log`. Evidence: `.local/qa/safe-allowance-release/evidence.json`. No funds moved, no on-chain grants were changed and no real member access was modified.

## U10 — payment reminders and responsibility

Implemented and verified the [payment reminder workflow](PAYMENT_REMINDERS.md): exact schedule deadlines, current approvers, background in-app reminders, missed-payment handling and daily escalation. Reminders never authorize or duplicate a payment. Failed account checks remain visible and retry; stale workers cannot publish changed payment or account information. Read acknowledgements apply to one member and reminder revision.

Ten new backend tests and seven browser stories pass. `bun run check` passed 521 tests across 64 files, lint and typecheck. The full browser pass completed 197 of 198 stories successfully and caught a 320-pixel header overflow introduced by the bell. Fixed the header spacing, expanded that assertion to include the bell, and reran all 16 affected reminder/activity/recovery stories successfully. Inspected light desktop, dark mobile and the real built-browser reminder list; corrected dark-mode alert colors. Development backend deployed at 12:31:12 local; rebuilt frontend includes the mobile correction. Actual background processing surfaced the existing failed February 3 scheduled payment without changing that payment or marking it read.

Evidence: `/tmp/disburse-reminders-check.log`, `/tmp/disburse-reminders-e2e-all.log`, `/tmp/disburse-reminders-e2e2.log`, `/tmp/disburse-reminders-build2.log`, `/tmp/disburse-reminders-deploy.log`; screenshots under `.local/qa/payment-reminders-*` and `.local/qa/schedule-*`. External mail/push delivery, live managed execution and second-owner acceptance remain separate items.

## F01 — source invoices and reviewed extraction

Completed the [invoice source workflow](INVOICE_SOURCES.md): private uploads/downloads, local digital-PDF/text reading, conservative field suggestions and explicit source review. Uploaded document addresses cannot become payment destinations. Backend source linking is atomic with the reviewed bill; upload and bill request receipts recover lost responses. Changed retries and stale edits fail, and attached evidence survives settlement or voiding. Images/scans may be attached but use manual entry; this reader does not claim OCR.

Eight backend and four parser tests pass, plus five browser stories using an actual PDF. `bun run check` passed 533 tests in 66 files with typecheck and lint. The complete 207-story browser suite passed, including the expanded six-width header checks. Visually inspected the PDF source in both themes; moved the add-recipient link out of the recipient picker label. Build/typecheck passed. The development backend deployed at 12:55:38 local.

The actual private-storage acceptance script uploaded/recovered one source, blocked anonymous download, saved and recovered one reviewed bill, and downloaded byte-identical content. The isolated QA bill was voided without preparing or sending a payment. Evidence: `.local/qa/invoice-source-evidence.json`, `/tmp/disburse-invoice-source-live.log`, `/tmp/disburse-invoice-source-check.log`, `/tmp/disburse-invoice-source-e2e-all.log`, `/tmp/disburse-invoice-source-build.log` and `.local/qa/invoice-source-{light,dark}.png`.

## F02 — observed assets and deposit refresh

Currency filters now come from the supported asset registry for the selected environment and network. An unrelated token claiming the same symbol cannot enter those results. Other received assets have their own exact contract/network selector, retain full addresses and remain excluded from canonical totals. Sync errors show the last completed refresh and scheduled automatic retry; saved history stays visible during retry. Archived recipient labels remain available.

Full code checks passed 534 tests across 66 files with lint/typecheck. Fifteen focused backend tests and four affected browser stories pass. The live built Reports screen and both theme screenshots were inspected. The visual pass fixed active-filter contrast and removed the dollar sign from unrecognized token amounts. Screenshots: `.local/qa/observed-assets-{light,dark}.png`; logs: `/tmp/disburse-observed-assets-check.log`, `/tmp/disburse-observed-assets-e2e6.log`. Backend deployed at 13:16:47 local. This does not claim the remaining report-scale and accounting work is complete.

## S01 — indexed finance activity and complete exports

Implemented the [bounded report pipeline](FINANCE_REPORTS.md): durable source jobs, resumable historical backfill, atomic aggregate replacement, exact asset/environment scopes, cursor pages and revision-bound exports. Report quantities are independent of functional-currency book values. Completed totals wait for history processing; recorded entries remain available on failure.

Seven backend index and three export tests pass, including a 200-person pay run, same-time pages, large exact quantities, retries, superseded entries and UTC month/day boundaries. Full checks passed 544 tests across 68 files with lint/typecheck; the full 213-story browser suite passed. Both report themes were visually inspected. The checked build passed and development backend deployed at 14:06:19 local.

The actual QA database acceptance verified complete indexing, unique cursor-paged reconciliation IDs, the prior 0.000001 Sepolia USDC settlement's exact hash and recipient aggregates. No funds moved. Logs: `/tmp/disburse-report-index-check5.log`, `/tmp/disburse-report-index-browser-all.log`, `/tmp/disburse-report-index-build.log`, `/tmp/disburse-report-index-deploy.log`, `/tmp/disburse-report-index-live.log`; evidence: `.local/qa/report-index-evidence.json`. The signed-in Chrome session closed and its supported launcher failed an OS permission check, so the final live visual recheck remains Q06.

The product owner added an explicit U.S. GAAP/reconciliation requirement during this work. [Accounting and reconciliation](ACCOUNTING_RECONCILIATION.md) and F03 now require reviewed book values, balanced journals, payable/receivable settlement references, internal-transfer treatment, immutable postings/reversals and period controls. The operational index is not represented as a GAAP journal or complete books.

## F03 — chain evidence and account-history matching

The product owner clarified that the underlying Safe/blockchain already records the financial movements. The implementation now retrieves both incoming and outgoing Safe transfers, including activity initiated outside Disburse. It attaches payment/fee context through exact one-to-one matching and retains the first reconciliation ID when evidence arrives in a different order. Equal batch legs, unrelated assets and excess outflows remain distinct. Unmatched legacy intent records are flagged and excluded from totals once the transaction's transfer evidence is available, preventing duplicate amounts.

Confirmed payments now preserve chain-verified block number, hash and settlement time separately from app observation time. Retry/backfill cannot change established evidence or repeat execution. Invoice receiving/forwarding scans also retain verified timestamps and sender/destination evidence for new events. Reports and CSVs expose UTC dates, exact raw quantities, transfer IDs and matching status; history coverage distinguishes completed account scans from unfinished/legacy scans.

Full code checks passed 559 tests in 70 files, lint and typecheck. The full browser suite passed 215 stories, followed by five affected stories after the final mismatch flag; both themes and the mismatch screen were visually inspected. The checked build passed and final backend functions deployed at 15:12:34 local. Existing large wallet/Safe bundle warnings remain S04.

The actual QA Safe's incoming/outgoing history completed. The previous 0.000001 Sepolia USDC payment reverified against its original block and matched one transfer. Total recorded USDC inflows minus outflows matched its independently queried on-chain balance exactly. No funds moved. Evidence and reproduction instructions are in the [finance report guide](FINANCE_REPORTS.md).

F03 remains open for external book references, account mappings, reviewed functional-currency values, general opening/closing reconciliation and journal exports where needed. The customer's general ledger remains their book of record. The signed-in user-browser recheck and other launch acceptance items remain explicit; this pass does not claim launch readiness or full GAAP compliance.

## Named accounts and F03 implementation update

The subsequent account and accounting pass implements the book-reference, mapping, valuation, journal, correction and historical balance work described above. Operations, Payroll and Reserves can share a network while retaining distinct funding identities. Payments, bills, draft edits and recurrence use the selected account; the account never changes because another Safe happens to be first in a list. At that milestone nested Safe ownership was researched; the later nested-payment pass below implements and verifies it.

Reports → Reconciliation supports chart imports, existing-book matches, payable/receivable settlement, customer liabilities including overpayments, internal transfers, explicit valuation differences, durable journal exports, import acknowledgments, closed periods and linked corrections. Balance checks compare historical opening/closing network balances to exact indexed flows. Six hosted QA checks passed, including seven real Sepolia movements over September 1–5 with zero difference. The synthetic QA books do not establish external QuickBooks import or accounting-policy acceptance.

Current validation: 585 automated tests across 73 files, typecheck/lint, 229 browser stories, inspected desktop/light and mobile/dark accounting screens, successful build and development deployment. The real receipt review exposed missing older settlement evidence; verifying the original transaction now enriches that evidence without recounting or forwarding. Historical reads exposed pruned data and intermittent provider failures; the final archive-backed period check passed. Details and evidence are in [accounting reconciliation](ACCOUNTING_RECONCILIATION.md) and [company accounts](FUNDING_ACCOUNTS.md).

The product owner clarified that POC compatibility is not required. V2 targets a fresh setup; migration of unused POC records is not a launch gate. The unfinished provider, signing, billing, external-book and launch acceptance items remain in the [active program](../TODOS.md).


## Nested approvals, native wallet recovery and billing cleanup

New payments now use one server-prepared and persisted approval path for direct and nested Safe owners. The browser transfer builder, proposal-posting endpoint, redundant onboarding ownership checks and old execution-claim endpoints were removed. The original signed-evidence table remains read-only. Safe and SafeL2 execution events use different encodings; receipt and lost-response recovery now recognize both while retaining exact principal and fee checks.

Two real Sepolia nested payments passed. The second used the built app with two isolated browser wallets, signature rejection, reload, a second approver, native-send rejection and exact-transaction retry. It settled one unit of test USDC once; original hash and approvals survived. The account guide records both receipts and the limits of the acceptance method. Five new visual stories cover nested progress, authority failure and recovery in both themes/mobile. A declined send now appears as Ready to retry and joins the review queue rather than appearing as ordinary processing.

Billing now reports active members plus reserved invitation seats, saved recipients including archived records, and connected business/test accounts. Old one-account-per-network limits, inconsistent positional feature translations and unsupported plan-exclusive core-feature claims were removed. Trial terms no longer imply paid credit. Scheduled sends require active access; already submitted payments still reconcile. English, Spanish and Portuguese prices describe the same USD amount and 30-day period. No price or enforced plan limit was changed.

At the billing milestone, 592 tests passed across 75 files, along with typechecking/lint, the previous full 234-story browser run and five focused billing stories. Additional startup-loading and queue checks are recorded in the active program as they complete. Spending-policy administration still needs the shared approval/nonce model; this report does not claim that nested grant administration, live managed settlement, provider yield/conversion or external-ledger acceptance are finished.


## Startup loading and final checks for this milestone

Public routes no longer initialize wallet connectors. Account-access routes load the wallet provider on demand; theme and language preferences use the session and remain available without it. Payment signing does not load the Safe SDK. A fresh-context built comparison measured compressed local JavaScript responses of 836,770 → 224,097 bytes on the homepage, 838,454 → 225,781 on Docs, and 840,956 → 228,284 on recipient details. Login measured 838,917 → 852,747 bytes because it loads the connectors it needs. These are local transfer measurements, not a claim about production latency. `scripts/qa-route-loading.mjs` rejects page error boundaries before recording results.

The updated milestone passes 593 tests across 75 files, typechecking/lint, 239 browser stories and a built-app recheck with two signed-in wallets and the original settled receipt. Both light and mobile/dark screenshots were inspected. The read-only built recheck sent no additional transaction. The newest backend functions are synchronized to the isolated development deployment; no production deployment or ownership change was performed.

## Persisted spending policies and removal of the old queue

Completed U13 with direct and nested account approvals, exact managed/native fee review, shared payment/policy nonce reservations and durable submission recovery. A member who owns one share of a multisig can receive an independent allowance. A unilateral account owner cannot be presented as restricted by that allowance. Archived accounts retain grant inspection/revocation; new grants remain disabled. Revocation survives membership removal and subscription expiry.

The actual built browser completed grant, two parent approvals, signature rejection/reload, wallet send rejection/reload/retry, confirmed Sepolia execution and two-owner revocation. No stablecoins moved and the test allowance is zero. Public receipts, method and limits are in [policy acceptance](SPENDING_POLICY_APPROVALS.md).

The old frontend Safe service submission/execution queue and related dead helpers are removed. Shared allowance inspection now uses one implementation on the server and in the browser. API Kit moved to development dependencies; Protocol Kit is loaded only for account creation. Current checks passed 599 tests across 73 files, 244 full browser stories, and additional focused visual/keyboard/archive stories. Built-wallet sessions also rechecked the prior confirmed payment without another transfer.

The next transaction-control gap is U14: cancelling a signed request must invalidate its original account nonce on chain so later payments cannot become stranded. Historical signed evidence must remain available during that work.


## Signed cancellation and cleanup

Signed payments and reserved policy requests now cancel through current direct/nested approvals in Disburse. Original approvals and budget reservations survive until receipt verification; an original transaction that wins the race is reconciled correctly. Unsigned payment drafts retain free cancellation. Policy creation reserves a nonce and therefore requires an account cancellation.

Removed the old local-only signed cancellation behavior and its Safe-UI handoff. Shared policy/cancellation wallet controls, canonical transaction verification and bounded settlement lookup replace separate implementations. Safe API Kit and the four old QA runners that used its replaced submission path have been removed. Historical receipts and private evidence reports remain intact.

Type/lint/unit checks passed with 614 tests in 73 files. All 250 browser stories passed. The built app also completed a two-wallet nested Sepolia cancellation after signature and send declines/reloads, with zero recipient transfers and unchanged allowances. [Receipt and implementation details](ACCOUNT_CANCELLATIONS.md). Later changes are recorded by their own checks.


## Delegated native fees and recovery

Members can explicitly choose native network fees for allowance payments; managed stablecoin fees remain the default. The server builds and verifies one canonical single/batch call, preserving full recipient amounts and rejecting an unreviewed fee. Current recipient review, subscription, grants, balances and member limits are checked again before execution. Native recovery now handles allowance receipts as well as owner transactions. Confirmed reverts and wallet declines have distinct state and retry wording.

The built app completed a real 0.000001 USDC allowance payment after signature and send declines, reloads and an intentionally unknown wallet response. With the browser closed, background reconciliation found the module receipt and marked the payment Paid. The fixture allowance was then revoked, and account/recipient principal balances reconciled. [Evidence and receipt](DELEGATED_PAYMENTS.md).

The full type/lint/unit check passed 622 tests in 73 files. The full browser suite passed 251 stories, followed by 18 targeted stories after recovery wording changes. The recovery and paid screenshots were inspected. The managed provider and extension/mobile connector acceptance remain open.

Removed the relay-only allowance builder and duplicate native single-transfer encoder. The schema/backend now share the saved allowance intent validator; account-call runtime verification is shared with policy and cancellation execution. Removed four obsolete Safe-service QA runners and the unused API Kit dependency. The current runner guide points to built-app acceptance. Historical receipts and existing signed recovery evidence remain available.

A dependency trace from the production entry identified three unused recipient components: the old screening badge, screening modal wrapper and tag picker. All three were removed after confirming that the current recipient editor and screening evidence flow use their replacements.


## Remaining POC endpoints and billing recovery

Removed ten unreferenced endpoints after tracing the current import, member, billing and recovery flows. This includes the old Pro-upgrade alias, separate member-name/email mutations, unused profile email updates, duplicate-address scan, tags lookup, unused screening helper, obsolete Safe-service retry action and unused relay-exception query. Recipient tags and signed transaction evidence remain in their current data stores. The live screening evidence view, reviewed imports, unified member editor and per-payment recovery are the active paths.

Billing checkout moved from the general Settings controller into `useBillingCheckout`. It now records a wallet request before sending, keeps unknown responses blocked after reload, and uses a browser lock to prevent overlapping checkouts in tabs with the same browser storage. A reported wallet decline releases the request. A confirmed reverted receipt releases only its matching saved hash; an unrelated reverted receipt cannot release an unknown request. Storage errors stop checkout before funds are requested. Checkout labels now use sentence case and identify the subscription payment address.

The local recovery implementation was then extended with a database-backed checkout journal. It fixes the reviewed terms, coordinates administrators and browsers, reserves the original wallet nonce before opening the wallet and recovers a missing hash from confirmed transfers. An exact revert or confirmed nonce replacement can release the attempt. Session/trial expiry and later configuration changes do not lose the original payment. Verification, license redemption and checkout completion are idempotent. The old receipt flow now shares the same network/receipt verifier. Local storage remains a recovery hint rather than the authority for payment status.

Eight backend checkout tests and eight frontend tests passed. Thirteen billing browser stories passed, including empty local history, a second administrator, unknown responses, mobile/dark layouts and accessibility. The full check passed 638 tests in 75 files, typechecking and lint; all 257 browser stories passed. The normal build and development backend synchronization passed. The actual signed-in build loaded usage and correctly disabled payment when the destination was unconfigured; its screenshot was inspected. No live billing payment was attempted. Live activation, renewal and upgrade remain Q04. See [checkout recovery](BILLING_CHECKOUT.md).

## Operator licensing and customer-paid fees

Added operator-only company grants, dated trials, permanent complimentary tiers, custom free-tier capacity and future-only signup programs. Paid receipts remain separate from grants; all mutations carry an audit reason, request identity and revision. Current core payments, approvals, scheduling, delegated execution and collection no longer depend on trial or paid-plan expiry. Existing records remain after downgrades. Free covers the former Starter limits, so new checkout offers Team and Pro while preserving historical receipts and already prepared checkouts.

Removed the sponsored invoice-collection adapter and its obsolete forward/claim/result endpoints. The current collection flow discloses customer-paid wallet gas. Managed collection with an explicitly authorized stablecoin fee remains unfinished. Free software usage covers no network or provider fees.

Full validation passed 644 tests in 76 files and 267 browser stories, plus typecheck, lint and build. Subsequent helper extraction passed typecheck and lint without warnings. Desktop/light and mobile/dark licensing and collection screenshots were inspected. The actual built app granted complimentary Pro to the isolated QA company, displayed its unchanged paid history after reload, and restored its previous access. Temporary operator authorization and QA sessions were removed. The initial real-backend check caught missing deployed routes; a proper development sync fixed that before acceptance passed. `convex codegen` alone was insufficient to publish the routes.

These changes complete the current licensing controls, not the wider launch program. Paid subscription settlement, managed-provider acceptance, customer-funded managed invoice collection, external accounting acceptance, and the unbuilt yield/conversion integrations remain in the active TODO.
