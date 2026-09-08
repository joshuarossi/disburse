# Built-app finance-cycle acceptance

September 8, 2026. The complete workflow passed against the development backend and the built application, using the existing isolated Sepolia accounts. One browser wallet represented the preparer; a second wallet approved through a mobile dark layout. Signing keys stayed in the host process. These are actual testnet records and receipts, not the browser suite's sample-data fixtures.

## Workflow and result

1. Imported an employee export through the recipient import screen. The existing recipient gained its source-system ID; its approved address, USDC preference and Sepolia network stayed unchanged. Re-importing the same file showed Skip and disabled applying zero changes. The directory still contained three recipients.
2. Recorded a 0.01 USDC vendor bill in the app. Selecting the saved recipient populated USDC. Prepared its payment from the named Payroll account; the bill and payment retained the same recipient, amount and funding account.
3. Declined the first approval signature, checked the readable cancellation state, reloaded and approved the original proposal. Sending stayed disabled with only one of the two parent-owner approvals.
4. The second wallet approved in the built mobile dark interface. The Payroll Safe is owned by a parent Safe, whose two owners must approve. Both owners' signatures remained attached to the original proposal.
5. Declined the send request. The application retained the signatures and exposed Retry original payment after reload. Retrying broadcast one original transaction, which paid exactly 0.01 USDC. The bill became Paid only after receipt verification.
6. Reconciled the actual movement to an explicitly synthetic existing payable. The form required reviewed book values and mappings. Downloaded one balanced journal and its reconciliation evidence; the CSV retained the exact transaction, 10,000 raw token units, source bill and stable journal number. The export remains Awaiting import because no external accounting system was used.

The synthetic journal debits accounts payable 0.01 USD and credits the reviewed holding account 0.01 USD. It does not record another expense or infer the value of USDC from its symbol. The entered USD values are test book values, not market-price or accounting-policy evidence.

| Evidence | Result |
| --- | --- |
| Original payment | [Sepolia receipt](https://sepolia.etherscan.io/tx/0x98fac50228a73d7af1554a2e818ca4ab41c3d9ca08311af8eddb0894a4d1b402) |
| Settlement block | 11,661,420 |
| Recipient quantity | Exactly 0.01 USDC / 10,000 raw units |
| Historical balance check | Recipient balance rose by exactly 10,000 units at the receipt block |
| Required approval | Payroll account → parent account → two owners |
| Journal | `DSB-TEST-4`, two balanced lines, original export retained |
| Native execution fee | Paid by the existing test wallet in Sepolia ETH, under a 0.001 ETH transaction cap |

Native Sepolia fees were explicitly authorized for this test. This workflow does **not** establish stablecoin-fee acceptance; the separate [customer-paid services](CUSTOMER_PAID_SERVICES_QA_2026-09-07.md), [delegated payment](DELEGATED_PAYMENTS.md), [receiving](ACCOUNTS_RECEIVABLE.md), [lending](LENDING.md) and [conversion](CONVERSIONS.md) evidence covers those actual USDC-fee flows.

## Reproduction and recovery

Build the native test preview as described in [the runner guide](../scripts/README.md), on port 4180 with the isolated development backend. Run a fresh acceptance using a unique name:

```sh
bun scripts/qa-finance-cycle.mjs --run=<unique-run-name> --phase=prepare
bun scripts/qa-finance-cycle.mjs --run=<unique-run-name> --phase=execute
bun scripts/qa-finance-cycle.mjs --run=<unique-run-name> --phase=status
bun scripts/qa-finance-cycle.mjs --run=<unique-run-name> --phase=export
bun scripts/qa-finance-cycle.mjs --run=<unique-run-name> --phase=inspect
```

Preparation creates development records but sends no funds. Execution funds only the missing test principal, collects approvals and sends the payment. Status is read-only. Export prepares/downloads the reviewed synthetic journal and deliberately leaves import unconfirmed. Inspect reopens completed records without another financial signature or transaction.

The private journal is written before each broadcast, including its exact transaction hash. A recorded broadcast cannot be blindly repeated; inspect its original receipt instead. A wallet-declined original attempt can resume only after the server recorded that decline. Interrupted bill creation is located by its unique invoice number before another create. Each script signs out its own sessions. Never commit wallet keys, signatures, signed transactions or private execution journals.

## Presentation findings

The walkthrough corrected singular bill/journal labels and added current account names, including archived-account labels, to reconciliation. Mobile account activity, invoice receipts and journals now use cards with visible review/export controls. Recipients, Bills, Payments, Invoices, Schedules and Team retain their full record details and actions within the viewport; table headings remain available to screen readers. Both themes have browser checks for on-screen amounts/actions, selection and actual review dialogs. The overview hides only confirmed zero balances without planned payments; unknown balances, smallest-unit amounts and unfunded plans stay visible, and empty balances can be expanded. Account names remain visible while funding checks load or fail.

The v2 financial workspace ships in English. Landing, pricing and help keep the visitor's language preference; entering the workspace does not overwrite it. Spanish and Brazilian Portuguese public copy now describes fees and screening accurately. Translation catalogs preserve every English key and the same price/count/date interpolation variables. Full workspace localization can follow as a separate complete rollout.

External extension/mobile-connector compatibility, a real customer export, actual ledger import and accountant-led close remain separate acceptance. The test wallets exercise real signatures and settlement, but are not a claim about every installed wallet extension.


## Final built visual sweep

Eleven routes were opened against real development records in a 1440-pixel light desktop and a 390-pixel dark mobile viewport: Overview, Recipients, Bills, Invoices, Payments, Schedules, Accounts, Reports/Reconciliation, Team, Settings/General and Settings/Billing. All 22 views passed WCAG 2 A/AA checks and document-width checks after data and account checks completed. Screenshots were visually inspected; mobile tables were corrected where ordinary visibility checks had allowed important columns to sit outside the viewport.

The full fixture suite passes 410 stories, including 12 mobile record stories covering both themes, visible fields/actions, recipient/bill selection and actual review dialogs. Invoice screens also pass at 320 pixels. Source verification passes 1,192 tests across 120 files, typecheck and lint. Both the normal release and explicitly native-fee QA builds pass. The original completed journal export was reopened and downloaded again from the final build without another payment or a new export.
