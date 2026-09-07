# V2 user story acceptance review

Started 2026-09-05. This review replaces earlier broad readiness claims. A passing page-load or automated test is not a completed user story.

Each story requires an observed visual assessment, execution of its normal and failure paths, and evidence of the resulting state. Preview fixtures prove interface behavior only. Backend tests prove isolated rules. Testnet receipts prove only the transactions actually executed. Unverified steps remain open.

Latest progress: [September 6 fix-pass stories](READINESS_FIX_PASS_2026-09-06.md). S13 now includes verified business/test separation, contract-based asset totals and exact exports. S14 includes the signed-in built Team sections, page-download recovery and complete mobile header controls. S06/S10 include durable owner proposals and a real native payment recovered without a client-supplied broadcast hash. Full browser-wallet and managed-fee stories remain open. Current regression counts are 442 unit/integration tests and 150 browser checks; older counts below describe earlier checkpoints.

| ID | User story and expected outcome | Required visual assessment | Status |
| --- | --- | --- | --- |
| S01 | Finance staff import employee records, map fields, resolve duplicates and missing payout details, and save reusable recipients without changing currency or network instructions. | Mapping, row errors, review totals, empty states, recipient editor. | Walkthrough recorded below; end-to-end acceptance remains open. |
| S02 | Pay one saved recipient without copying an address. Saved currency and network remain authoritative. A conflicting account or currency cannot silently replace them. | One primary create action; readable recipient instructions; precise amounts and mismatch messages. | Fixed: saved instructions displayed and enforced in new, edited, recurring and legacy payment paths. Native review and backend regressions passed; browser signing remains open. |
| S03 | Pay several people with different payout instructions. Every recipient receives the requested asset on the requested network; unsupported combinations are explained before approval. | Per-recipient currency/network, totals by asset, review and funding clarity. | Implemented: select once, review totals by asset/network, atomically prepare compatible drafts and recurring series. Separate approval/execution is explicit. Native desktop/mobile review passed; mixed live settlement remains open. |
| S04 | Save, reopen and edit a draft without changing recipients' saved destinations or accidentally approving or paying it. | Draft/edit labels, cancel/save actions, review summary. | Walkthrough recorded below; end-to-end acceptance remains open. |
| S05 | Record a vendor bill, detect duplicates, prepare payment and reconcile its exact amount and transaction receipt. | Bill entry, due dates, payment linkage, paid status. | Walkthrough recorded below; end-to-end acceptance remains open. |
| S06 | An initiator prepares a payment; authorized owners review and sign in Disburse; insufficient signatures cannot execute it. | Role-specific actions, signature progress, understandable wallet prompts. | Walkthrough recorded below; end-to-end acceptance remains open. |
| S07 | Schedule a payment, approve before its due date, cancel safely and reconcile eventual execution without duplicate transfers. | Date/time zone, deadline and approval requirements, cancellation states. | Walkthrough recorded below; end-to-end acceptance remains open. |
| S08 | Configure recurring payments, prepare each occurrence, pause/resume and handle changed recipient instructions without silent substitution. | Upcoming occurrences, pause reason, draft versus approved states. | Walkthrough recorded below; end-to-end acceptance remains open. |
| S09 | Delegate a limited spending amount, enforce the contract allowance, reject excess spending and revoke access. | App permissions versus on-chain authority, asset/network/period clarity. | Walkthrough recorded below; end-to-end acceptance remains open. |
| S10 | Select a funding account, review balance and fees, pay gas using a supported stablecoin relay and recover from provider or network failure. | Funding insufficiency, fee quote, pending/retry/error states. | Open; testnet relay availability previously blocked. |
| S11 | Invite members, reserve seats, accept invitations and restrict unauthorized reads and writes. | Roles, pending invites, limits, disabled actions. | Walkthrough recorded below; end-to-end acceptance remains open. |
| S12 | Use a trial, fall back to Free with core payments available, manage a complimentary grant, then upgrade with a verified paid receipt. | Trial banner, expiry consequences, price/term/network, receipt history. | Free fallback and operator grant/reload/restoration pass; live paid receipt acceptance remains open. |
| S13 | Reconcile payments, filter reports and export the intended rows with exact amounts and receipts. | Filters, totals, export scope, empty results. | Walkthrough recorded below; end-to-end acceptance remains open. |
| S14 | Navigate at desktop/mobile widths, switch themes and use every settings tab without spinners or duplicate primary actions. | Contrast, spacing, overflow, focus, responsive dialogs and loading/error states. | Duplicate action fixed. Mobile selected-name truncation and amount clipping fixed and visually rechecked. Remaining settings and onboarding steps below. |
| S15 | Create an organization, connect its Safe and recover from sign-in, RPC and provider failures. | First-use guidance, loading timeouts, actionable errors. | Funded linking and invoice settlement passed after configuring a working Sepolia RPC. Native onboarding reached organization creation; preview prevents saving. |

## Defects and evidence

- D01: PaymentBatchForm displayed its batch-level token for every beneficiary. paymentRuns validation ignored preferredToken and preferredChainId. This allowed a USDT batch to overwrite the meaning of a recipient's USDC instruction. No conversion existed.
- D02: WorkspaceShell and the Payments page both displayed New payment. The same duplication requires checking on Overview and Recurring & batches.

No story is marked end-to-end complete yet in this review.


## Walkthrough log — 2026-09-05

Product acceptance: a finance team completes routine work inside Disburse. Safe provides account security; its interface is not a required step for routine payments, approvals or delegated spending. Wallet signatures remain necessary when the account requires them.

- **S01:** Pasted employee names/email with a duplicate. Inspected row errors, selection count and missing-address indicators. Fixed email shown under Notes and dropped currency/network import fields. Backend story covers import → incomplete recipient → address completion → exact draft creation. Common aliases and explicit field mapping work. The browser story maps unfamiliar Display/Contact/Coin/Route columns, preserves USDT/Base, and skips an unrelated field. The import preview was visually inspected after mapping. A real customer Gusto export remains unverified.
- **S02:** Selected Maya, entered 1.000001, changed currency. In explicit single-currency mode, USDT is rejected. In saved-instructions mode, changing the fallback leaves Maya in USDC. Saved destination is shown in review. Preview saving is deliberately blocked.
- **S03:** Selected Maya (USDC) and Arjun (USDT), entered 1.000001 and 2.000002. Native review shows two exact totals, each recipient's currency/network and Create 2 batches. Inspected at 1280×800 and 390×844. Mutation creates all compatible drafts atomically; a changed preference rolls back the entire save. Recurring series are prepared separately. Dedicated regressions now verify separate funding accounts across networks and prevent an aggregate payment-limit bypass. Mixed live settlement remains unverified.
- **S04:** Opened draft detail and editor. Fixed editor showing the directory's current address when the draft retained an older destination. Existing draft addresses remain snapshots. Editing a currency against saved instructions is rejected. A changed-directory browser fixture now verifies the saved payout address through draft editing and review.
- **S05:** Opened bills, selected a bill, inspected preparation and bill entry. Fixed a bill due today being counted overdue. Actual funded backend story linked a Safe, proposed and executed 1.000001 Sepolia USDC, verified its receipt and marked the linked invoice paid. Receipt: `0xe0dccb9c0a104161cd98d61dfff166f387ed607ec8c671a7925c09eb3c4757a1`. Signing was performed by the isolated QA script, not through the browser.
- **S06:** Opened payment approval details. Added in-app owner approval progress backed by verified signatures and current account state. Send remains disabled until approvals and transaction order permit execution. The approval progress screen was visually inspected: named owners, one-of-two status and blocked Send. Actual two-owner backend verification is being recorded separately; a real wallet browser flow remains open.
- **S07:** Scheduling validation, cancellation, claims and reconciliation have automated coverage. Execution while all user browsers are closed with a live relay has not been observed. This story remains open.
- **S08:** Opened recurring list, pause confirmation and edit form. Recurrence tests cover preparation, pause/resume and changed payout instructions. Native persisted pause/resume remains unverified because preview mutations are blocked.
- **S09:** Inspected grants, limits and revoke controls. Contract grant/spend/over-limit/revoke/post-revoke checks passed on Sepolia in the QA script. Policy approval/execution and single-recipient delegated payment now stay in Disburse. The actual app policy decoder verified both grant and revoke proposals on Sepolia. A signed delegated invoice paid exactly 0.010001 USDC, reconciled in the backend, rejected replay and was followed by allowance revocation. Policy and delegated-payment screens were visually inspected; the latter exposed an inconsistent preview total, now fixed. Delegated batches up to 200 recipients now use separate recipient and fee authorizations in one transaction. Live browser-wallet signing and managed fee settlement remain unverified.
- **S10:** Inspected accounts, deposit QR/address, account settings and fee preferences. Fixed account payment link ignoring its selected network, repeated token labels and misleading same-address-on-all-networks guidance. Stablecoin relay settlement remains unverified.
- **S11:** Inspected team list, invitation form, app payment limits and delegation form. Server tests reserve pending seats, enforce role restrictions and reject invitation acceptance after plan expiry. Actual recipient invitation acceptance in a second browser remains open.
- **S12:** Inspected billing and renewal. Missing billing configuration now disables sending and address copying. Expiry/renewal/receipt replay rules have server coverage. Production billing treasury and checkout network still require a business decision; live checkout is unverified.
- **S13:** Inspected transaction, spending and empty audit reports in dark mode and used export. Exact CSV precision has automated coverage. The full import-to-paid-to-export reconciliation story remains open.
- **S14:** Theme switching and responsive navigation have browser coverage. Native desktop/light/dark and mobile payment interactions exposed layout defects fixed during this pass. Settings error from Screening no longer leaks into Billing. A screenshot capture alone is not recorded as a visual pass.
- **S15:** Inspected profile and organization onboarding. Fixed unassociated labels and error announcements. Organization creation in preview is intentionally rejected; subsequent native onboarding steps have not been executed. Live backend Safe linking passed separately.

## Additional defects fixed

- D03: CSV import discarded requested currency/network and hid email under the Notes column.
- D04: Draft editor displayed a changed directory address while backend retained the saved draft address.
- D05: Account-specific Make a payment ignored the selected network.
- D06: Mobile selected recipient name collapsed beside an amount; mobile review clipped exact amounts.
- D07: UTC due-today bills could be marked overdue.
- D08: Screening errors persisted when switching settings tabs; unconfigured billing exposed a useless Copy button.
- D09: Onboarding labels did not identify their inputs.
- D10: Payment approvals showed a static threshold and required Safe to inspect progress. In-app verified approval progress is implemented; acceptance testing is ongoing.

Latest completed code check: 397 tests across 45 files, typecheck and lint passed. The ten targeted payout/import/approval stories passed. Full browser regression results are recorded in QA_V2.md. These counts describe regression coverage, not completion of the stories above.

- D11: Allowance values lacked currency formatting and exposed module/block details as primary content. Amounts now use exact money formatting; contract controls are under Advanced policy settings.
- D12: Single-recipient preview retained its two-recipient total. Corrected the fixture and rechecked the displayed summary against the recipient amount.

Two-owner live backend acceptance passed: one signature was rejected, two were verified, and [0.000001 USDC settled the bill](https://sepolia.etherscan.io/tx/0x382a4bf90b9095f30846b5eb3fe2f9f6ae8a0394b56c0d983e3fd9fe27cd3887). [The original single-owner policy was restored](https://sepolia.etherscan.io/tx/0xd3f10265a5138ba62447fa87755f1002a818013cf0801041b5414927995df3f4). The first QA-script attempt failed before broadcast due to an SDK construction argument; cleanup invalidated that proposal, and its isolated database record was marked failed with the restoration receipt. The corrected second attempt passed. These were SDK signatures, not browser wallet prompts.

The deprecated SyncFee submission path has been replaced with managed Gelato Turbo Relayer, durable submission records and explicit owner-approved stablecoin fees. Live provider acceptance remains open because the development Gelato project is not connected. See MANAGED_RELAY.md.

- D13: Mobile Overview attention rows pushed amounts and statuses off-screen. Narrow screens now use readable payment cards; desktop retains the table. The new browser story opens the correct payment from a card and checks amount/status visibility without horizontal overflow. Fresh light/dark mobile images were inspected after the fix.
- D14: Demo Overview overdue count and upcoming ordering disagreed with its bill/payment fixtures. Derived the count with the same UTC due-date helper and sorted upcoming dates.
- D15: Authentic signatures from removed Safe owners caused approval progress to fail. They now do not count toward the current threshold; false signature attribution still fails. Relay encoding filters to verified current owners. The real completed two-owner proposal passed current-identity verification after restoring its original owner policy.

All 22 newly captured route/theme screenshots were visually inspected during the final visual pass. This covers route layout, not every dialog state or authenticated mutation. The two mobile Overview captures were regenerated and reinspected after D13. No unobserved browser signing step is counted as complete.

- D16: Mobile payment totals split decimal amounts across lines and recipient amounts required horizontal scrolling. Payment summaries now use a single mobile column and recipients use cards with full amounts. Desktop light/mobile dark screenshots were inspected after the fix.

## September 5 follow-up: fees, recovery and delegated batches

- S08: A database regression advances through two successive monthly occurrences. Each date produces exactly one new draft with no inherited signature, transaction hash or fee authorization.
- S09: Delegated batches now reserve all recipient and fee nonces atomically and use one managed submission. The browser discloses one signature per recipient plus one for the fee. Receipt verification rejects missing recipient transfers and wrong nonces. The monthly app budget includes payments the member delegated even when another member created the draft.
- S10: Funding checks include the fee before requesting signatures. Payment details offers settlement reconciliation without resending. Exceptions appear in Needs review. Database tests preserve the original provider request during recovery.
- S12: A submitted subscription receipt survives reload and reopening checkout. The original plan is restored and checkout asks for verification before permitting another payment. A known reverted wallet payment clears the pending receipt.
- S13: Reports contain one fee row per executed payment, separate inflow/outflow/net totals per currency, unique batch row identifiers and exact decimal amounts. Payment exports include fees and account debits. Historical payments never acquire a fee from today's quote.
- Visual inspection: light desktop recovery and delegated batch screenshots were inspected. Removed the repeated processing notice when the recovery panel already explains the state.
- Validation: 397 tests across 45 files, typecheck and lint passed. 123 browser checks passed. Production build passed with wallet-bundle size warnings. The billing suite now controls background timers instead of relying on a 30 ms delay.

These browser checks use read-only fixtures. Database and receipt tests exercise persisted state in convex-test. They do not establish live managed-relay settlement or real browser-wallet signing.

## Recovery completion pass

- A 25-job regression verifies that the bounded recovery worker rotates through later jobs.
- Provider-status outages still permit independent settlement discovery without another submission.
- Failure before submission retains a retryable job. After its retry window, Resume payment requires durable evidence that no submission occurred, rechecks policy and permits only one resume claim.
- Needs attention provides a dedicated payment queue; uncertain payments carry an attention badge.
- Billing verification returns a structured reverted-receipt result only after two confirmations. Checkout clears that pending receipt and offers another attempt. Pending or unavailable receipt lookups retain the original receipt.
- The attention queue and reverted-billing dialog were visually inspected. Screenshots are in .local/qa/story-attention-queue.png and .local/qa/story-billing-reverted.png.
- 397 unit/integration tests and 123 read-only browser checks passed. Typecheck, lint and production build passed. Live browser-wallet and managed-provider acceptance remain unverified.

## Wallet interaction acceptance

Frontend interaction tests now execute the actual delegated component and owner-payment hook through controlled wallet/API boundaries:

- Recipient authorizations are requested in order, followed by the separate fee authorization, before one submission.
- Rejection of a recipient signature stops remaining prompts and prevents submission.
- Changing the connected member during signing stops the flow before submission. Changing the payment invalidates the quoted allowance and fee approval.
- A wallet rejection in the owner flow leaves the payment pending and never submits or schedules it.
- A future owner-approved payment records its schedule without immediate relay submission.
- Owner proposals preserve USDC principal amounts when the reviewed fee uses USDT.
- Receipt linking remains available when new payments are blocked, without requesting signatures.

The changed-directory browser story passes and its screenshot was visually inspected. The editor retains Maya's saved address through review.

397 tests across 45 files pass. The full 123-test browser suite passed. Typecheck, lint and production build passed. The signing tests control external boundaries; they are not real wallet-extension acceptance.

The requested in-app browser was queried again and is unavailable. The connected external Chrome browser was not substituted for the user's requested browser.

Draft review now uses exact money formatting for recipient amounts, grouped totals and the footer. Six-decimal values remain intact.

## Chrome and public-page acceptance

Chrome opened the live development app on port 5173, distinct from the read-only QA app on port 5174. Login opened MetaMask and reached its unlock screen. No live wallet signature or payment was completed. Browser security policy rejected automated inspection of MetaMask's extension URL; manual unlock and connection are required.

The public review found and fixed:
- POC-era positioning and unsupported customer-adoption and compliance claims.
- Public billing terms that incorrectly described automatic renewal. Corrected in English, Spanish and Portuguese.
- Help content that consisted of only two placeholder paragraphs. Added recipient import, bills, approvals, schedules, fees, recovery, renewal and reconciliation guides.
- Nested buttons inside navigation links.
- Low-contrast public links, badges, trust labels and call-to-action content in light mode.

The landing page, pricing and guide were inspected in Chrome. Public checks now cover mobile/desktop accessibility, navigation semantics, billing terms and light/dark trial-call-to-action contrast. Full result: 397 tests across 45 files, 130 browser checks, typecheck, lint and production build pass. Public-copy changes primarily cover English; new help topics use the existing English fallback in other languages.

## Signed-in development acceptance, September 6, 2026 UTC

The user unlocked the wallet and Chrome signed into Disburse.Pro on port 5173. This supersedes the earlier locked-wallet note. These are live development database checks, not preview fixtures. No funds moved.

- Imported two labelled QA recipients with separate USDC and USDT instructions on Sepolia; both survived reload.
- Selected both recipients, entered 0.010001 USDC and 0.020002 USDT, changed the default currency to USDT, and reviewed the resulting separate batches. The USDC recipient retained USDC. Both drafts persisted.
- Opening the saved payment exposed an outdated development API validator. Synchronized development Convex; reloaded the same saved draft successfully. No duplicate drafts were created to recover the page.
- The payment review preserves exact principal and the saved address. Missing managed network fee configuration shows an explicit error and disables signing. Managed browser-wallet settlement remains unverified.
- Settings and billing load. The theme toggle changes the live workspace; corrected the light-theme trial badge contrast after screenshot inspection.
- Created invoice QA-20260906-001 for 0.010001 USDC due September 10. It survived reload and prepared a linked draft using the saved Sepolia recipient. Cancelled that draft and confirmed the bill returned to Unpaid with its original amount and due date.
- Created monthly schedule QA Acceptance monthly 20260906 for September 7. Reload confirmed the next occurrence is October 7. Confirmed pausing the schedule; no future QA drafts will be generated while paused. Its existing first draft remains available for review.
- Corrected the overview's past-date classification. The live Upcoming metric and linked payment filter both show the same one future draft; the old February draft no longer appears under Coming up. Overdue scheduled instructions remain in review/attention.
- Extended exact six-decimal display to payment, bill, recurring and overview records. New mixed-batch names use network names rather than chain IDs. Corrected recurring approval copy to include authorized delegates.

Test reliability: replaced fixed sleeps in recipient suites with fake timers and explicit scheduled-function completion. A browser run interrupted by a development reload was rerun after edits stopped. Treat successful automated checks separately from the live stories above.

The live Reports route exposed historical ETH deposits crashing stablecoin-only aggregation. Fixed report aggregation to preserve native/custom asset precision, and native quantities no longer display a dollar sign. Reloaded and visually inspected the live report with 67 historical transactions and ETH totals. Added regression tests for ETH/custom deposits and amount presentation. Latest unit/integration result: 400 tests across 46 files, typecheck and lint pass.

The live spending report and audit log also load. Audit entries record the imported recipients, drafts, invoice preparation/cancellation and recurring pause. Final automated verification: 400 tests, 130 browser checks, typecheck and lint pass. Production build passes with the existing wallet-bundle size warning. The signed-in browser is left on Overview.

## Native Sepolia fee acceptance, September 6, 2026 UTC

At the user's request, executed a fresh invoice through the isolated QA Safe using native Sepolia ETH for gas. The now-retired `qa-native-fee-acceptance.mjs` runner checked the development deployment, Sepolia chain, isolated owner/Safe identity, exact recipient and 0.010001 USDC amount; caps native transaction gas/fee and refuses blind resubmission after a send attempt.

Transaction: `0xb843b021f4866b265b869dc3280785c0ea5391922e71b4fe08c1f1bb5b288016`.

Verified Safe service proposal, backend intent/current owner signature checks, two receipt confirmations, exact 0.010001 USDC recipient balance increase, payment status executed, linked invoice paid, and matching accounting row/transaction hash. Gas used: 84,470. Native fee: 0.00017337543024627 Sepolia ETH. A repeat check recognized the executed payment and did not resubmit.

This is real SDK-signed native-fee settlement through the development backend. It does not establish browser-extension signing or managed stablecoin-fee relay acceptance. Production relay defaults were not changed.
