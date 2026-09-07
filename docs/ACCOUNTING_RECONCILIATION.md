# Accounting and reconciliation

The v2 accounting baseline is U.S. GAAP, as requested by the product owner. Reports → Reconciliation now connects settled movements to the customer's existing ledger, with reviewed book values and balanced journal exports when needed. This is a reconciliation workflow, not an assertion that every asset or customer policy complies with GAAP. External-ledger acceptance and accounting-policy review remain in F03 and A12 in `TODOS.md`. Complete account-transfer indexing is described in [Finance activity reports](FINANCE_REPORTS.md).

## Implemented workflow

1. An administrator sets the book name, functional currency and optional closed-through date, then imports reviewed chart rows. CSV columns are `account_id,account_name,account_type,active`. Exact external IDs, leading zeros and full parent:subaccount names are retained. Updates are versioned; existing journal snapshots keep their original mapping.
2. An accountant, approver or admin selects account activity or an invoice receipt. The review shows exact token units, account/network, settlement date, original transaction/log and linked local bill or invoice. Missing receipt evidence can be verified against its original transaction without forwarding funds or changing receipt totals.
3. The reviewer explicitly chooses a book match, existing payable/receivable settlement, unrecorded expense, customer advance, fee or company transfer. A book match creates no journal to import. Existing payable/receivable settlements use their obligation account, external reference and exact book counterparty name. Collection does not automatically post revenue.
4. Asset carrying value and obligation value are separate, exact amounts in the functional currency. A difference requires a reviewed gain or loss account. An excess invoice receipt requires its own customer-liability value and account; a receipt after the invoice was already fully funded cannot reduce the receivable again. Token allocation and book value are different evidence, never an assumed one-to-one exchange rate.
5. The journal preview uses filtered account types and requires review before saving. The server rebuilds and validates the balanced lines. One chain transfer can have only one current reconciliation in an organization, including an Operations-to-Payroll transfer or a forwarder-to-Safe transfer observed at both addresses.
6. Journals are exported in durable batches with stable journal numbers and line identities. Interrupted requests reuse the saved export. A new export cannot include an already-exported journal. Downloading a saved export again retains its original contents. The user confirms an import with a reference from their books; Disburse does not claim that downloading a CSV imported it.
7. Unexported corrections retain the old review as void. Corrections to imported journals create an exact reversal and a replacement, which must be exported together in an open period. Revising a pending replacement retains its original reversal. An uncertain export must be acknowledged before correction. Posted lines and prior export evidence remain unchanged.

Trial expiry does not block reading or reconciling recorded history. Review permissions are separate from payment-signing authority. All accounting endpoints verify workspace membership. Test activity uses `DSB-TEST-` journal numbers, separate export batches and explicit test labels.

## Period balance checks

Reports → Reconciliation → Balance checks verifies a named account and configured currency over 1–366 completed UTC days. It locates the last finalized block before the opening date and the last block before the following day at period end. Historical `balanceOf` reads use those exact blocks. Opening units + recorded receipts − recorded payments must equal closing units.

The check requires completed incoming/outgoing history and a finished report index. It reads indexed movement pages, rejects changing revisions, records missing evidence, checks duplicate transfer IDs and verifies the checkpoint hashes again. A mismatch is saved as **Needs review**, with its exact difference. An RPC failure is never a zero balance. A currency contract that did not yet exist at a verified historical checkpoint has zero units there.

Saved results retain both block hashes/numbers, raw balances, flows, UTC dates, history watermark, report revision, reviewer and check time. Downloads preserve this evidence. Results are historical snapshots; rerun after correcting history. Unit agreement does not establish carrying value, revenue recognition or completeness of the customer's general ledger. The current tool checks connected Safe accounts and configured stablecoins; invoice receiving accounts and external owner-paid native gas require their own supporting schedules.

Historical reads use `ARCHIVE_RPC_URL_<chainId>` when configured, otherwise the ordinary network reader. This is separate from payment execution. A node with pruned state can serve current balances while being unable to answer period checks; the UI reports unavailable history without exposing the provider URL or presenting a successful result.

## Scope and bounds

- Functional currencies: USD, EUR, GBP, CAD, AUD and JPY, using their configured decimal precision. Unsupported precision is rejected instead of rounded. Positive values are required for monetary journal lines; an explicitly documented existing-book match may carry zero book value.
- Chart: up to 1,000 accounts, 500 reviewed rows per import. Source review: up to 1,000 receipt events on an invoice and 100 linked bills on a payment. Larger cases fail explicitly rather than produce a partial journal.
- Export: 1–100 journals per batch. Corrections must include both entries. The latest 20 balance checks are shown; stored evidence is retained. A balance check supports up to 50,000 indexed rows per period and requires historical RPC access.
- CSV is the present accounting interface. A real QuickBooks import, direct accounting APIs, refund/credit-note flows, accounting attachments and customer-specific accounting policies are not verified by the automated suite.
- The customer can manually import the same file twice in an external ledger. Disburse prevents duplicate export assignment and supplies stable IDs and import acknowledgments; it cannot enforce behavior inside an unconnected accounting system.

## Verification

September 6 code checks: **585 tests across 73 files**, typecheck and lint passed; production build passed with existing wallet/Safe bundle warnings. The full browser suite passed **229 stories**, including nine accounting stories. Desktop/light journal tables and mobile/dark journal cards were inspected, as was the mobile balance check.

Backend stories cover existing payables, exact carrying values, internal transfer identity, invoice collections/forwarding, excess receipts, stale allocations, foreign chart access, repeat exports, closed dates, linked and repeated corrections, precise UTC block boundaries, historical RPC failures and changed report revisions. Browser stories cover chart preview, review/required inputs, downloaded journal/evidence files, overpayment liabilities, linked correction, missing evidence and balance-check recovery. Browser fixtures do not exercise a real external ledger or wallet extension.

### Live development acceptance

`bun scripts/qa-accounting.mjs --balance` passed six checks against the isolated Sepolia QA organization. It verified chart persistence, a previously settled payment, a customer invoice receipt, its forwarding transfer and the matching Safe deposit, durable balanced export/retry behavior, duplicate rejection and a clearly labeled synthetic import acknowledgment. It sent no transactions. The journal valuations and import acknowledgment belong to synthetic QA books; no actual QuickBooks import or customer book entries were made.

The period September 1–5, 2026 reconciled seven recorded USDC movements:

| Quantity | USDC |
| --- | ---: |
| Opening balance | 0 |
| Received | 5 |
| Sent | 4.410006 |
| Closing balance | 0.589994 |
| Difference | 0 |

Opening block `11609050`, hash `0xaa22b3b427b366a26fa0555a99ed64d6c26176a551c0442db74a3ac7fccc50fa`; closing block `11643660`, hash `0x7dd2ae1207b5d18484a1c25e42fa605921834a163863a22f879ff10334a76ae9`. Both are historical UTC boundary checkpoints, independent of the current account balance. The result records report revision 97 and no unresolved movements.

Live testing found a pruned-state error on the ordinary reader and intermittent historical block-read failures with the separate public reader. Dedicated archive configuration, bounded sequential lookups, shared-block caching and paced non-batched requests are now in place. The final hosted check passed; a public endpoint is not a production service guarantee. No failed attempt saved a successful check or substituted zero balances. The development archive endpoint is `https://sepolia.gateway.tenderly.co`; normal payment RPC configuration was retained.

Artifacts: `.local/qa/accounting-evidence.json`, `/tmp/disburse-accounting-live6.log`, `/tmp/disburse-accounting-paced-check.log`, `/tmp/disburse-accounting-final-browser-all.log`, `/tmp/disburse-accounting-final-build.log`. The development schema/functions synchronized at 17:21:41 local. Screenshots: `.local/qa/accounting-review-light.png`, `accounting-review-dark.png` and `accounting-balances-mobile.png`.

## Records and controls

The blockchain is the source of truth for settled asset movements. The activity index must include all transfers involving each connected Safe, including transactions initiated outside Disburse, and remain rebuildable from that evidence. Invoice receiving addresses are additional company-controlled locations: a customer receipt followed by forwarding to the Safe is one collection and an internal transfer.

Disburse adds accounting context to verified movements: source bills/invoices, external book references, account mappings, reviewed valuations and reconciliation status. The customer's general ledger remains their accounting book of record. Journal exports, where needed, require balanced amounts, explicit treatment of already-booked obligations, stable IDs and correction history. Disburse does not need a second editable history of blockchain transactions or a replacement general ledger to provide this workflow.

- Preserve chain, contract, account, source record, transaction hash and per-transfer identity. A transaction hash alone cannot identify every recipient or receipt in a batch.
- Keep settlement time, observation time and accounting posting date distinct. Preserve the evidence for each; a later scan must not move a transaction into a different accounting period.
- Store asset quantities as exact decimal/raw-unit strings and functional-currency book values separately. Do not assume that one USDC unit has a one-dollar carrying value, or classify an asset from its ticker.
- Require balanced debits and credits in a configured functional currency. Store chart-of-accounts identifiers and external names, mapping versions, reviewed valuations and their evidence.
- Link settlement to an existing payable/receivable and external book reference. Let the accountant indicate whether the original bill or revenue is already recorded, so the import cannot record it again.
- Separate known payment fees from recipient principal. Native gas paid by an owner's wallet needs separate reimbursement/expense evidence; it is not automatically a treasury-account debit.
- Keep company-account transfers and invoice forwarding out of revenue and expenses. Preserve both asset-location movements and one original customer receipt.
- Treat unclassified deposits, overpayments and customer advances as items requiring review. Receiving funds alone must not post revenue.
- Preserve original posted journals. Corrections produce linked reversals and replacement entries. Closed periods cannot accept silent backdated edits.
- Export stable journal and line IDs, dates, account mappings, source references, quantities and book values. Record export/reconciliation status independently of payment status.

## Accounting policy is explicit

The FASB Codification is the authoritative source for nongovernmental U.S. GAAP; an Accounting Standards Update communicates amendments. Product behavior and CSV headers cannot establish compliance by themselves. [FASB standards](https://fasb.org/standards).

ASC 350-60 has asset-specific scope criteria, including the absence of enforceable claims on underlying assets. Its subsequent fair-value model therefore cannot be applied automatically to every stablecoin. The amendments also distinguish quantities, cost basis, fair value and disposition results. Disburse must retain those distinctions and an accountant-reviewed policy for each supported asset. This is a design inference from the scope and disclosure requirements, not a classification decision for a particular customer's holdings. [FASB ASU 2023-08](https://storage.fasb.org/ASU%202023-08.pdf).

Revenue timing depends on the underlying customer contract and performance, which is why invoice issuance and collection cannot substitute for revenue-recognition review. [FASB Topic 606 project summary](https://fasb.org/projects/recently-completed-projects/revenue-recognition-summary).

## Existing-book export targets

QuickBooks Online's journal import maps journal number, journal date, account name, description, debit and credit fields. Subaccounts require the parent/subaccount name; payable/receivable lines may require a vendor Name. The accounting export must retain external account and counterparty mappings, and use reviewed book values in the customer's functional currency. A token-quantity activity CSV is not directly interchangeable with that journal file. [Intuit journal import guide](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US).

## Acceptance stories

1. Record an already-booked vendor bill, pay it, and reconcile the payable reduction without recording the expense twice.
2. Receive a partial customer payment at a unique invoice address, collect it into the main account, and reconcile one receivable reduction with the internal transfer separately identified.
3. Record an overpayment and later refund/credit without turning the excess into revenue.
4. Settle an obligation where asset carrying value differs from the settlement book amount, with an explicit reviewed gain/loss treatment.
5. Import/export journals and match their quantities, functional-currency debits/credits and source references to the customer's other books.
6. Repeat an export, interrupt it, reverse a posted entry and attempt a closed-period edit. None may duplicate a posting or mutate the original journal.

Sources checked September 6, 2026. The implementation report must distinguish these acceptance stories from completed operational-report checks.
