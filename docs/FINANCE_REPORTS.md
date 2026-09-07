# Finance activity reports

Transaction and recipient reports use a derived activity index. They no longer collect the organization's entire payment and account-transfer history on every query. Matching to the customer's general ledger is documented separately in [Accounting and reconciliation](ACCOUNTING_RECONCILIATION.md).

## Processing and recovery

Confirmed owner/delegate payments and newly saved/reconciled deposits queue an organization-bound source update in the same mutation. A worker replaces that source's report rows and applies exact aggregate deltas atomically. Retrying the worker preserves reconciliation IDs and does not count the source again. Superseded deposits remove their old contribution. Payment fees are one distinct entry per payment, including batches.

Existing organizations receive a resumable backfill: 25 source records per page, followed by bounded source jobs. A minute-based maintenance task discovers organizations and recovers delayed jobs. Failed replacements retain the previous completed source snapshot, expose the error and retry with backoff. Report screens hide incomplete summary totals and disable complete exports while jobs remain. They preserve existing rows and navigation.

The blockchain supplies settled transfer facts. Stored network/provider evidence and payment intent records rebuild the activity index; app payment records alone do not describe every account movement. Future source migrations must call `queueReportSource` for changed records; changing raw records directly does not invalidate an already completed projection automatically.

## Complete account-transfer history

The Safe adapter uses the current `/transfers/` endpoint for incoming and outgoing fungible-token and native transfers. This includes transfers initiated directly through Safe or another frontend. Existing incoming-only cursors finish first; the next scan starts a complete history pass from zero. A history-coverage flag changes only after that pass completes. Cursor validation preserves the endpoint, date window, page size and ordering and refuses injected filters. [Safe transaction-service reference](https://docs.safe.global/core-api/transaction-service-reference/mainnet).

Incoming records retain their existing deposit IDs. Outgoing evidence lives in `outgoingTransfers`, with a unique per-account log/trace identity. Exact network, account, transaction, token contract, recipient and raw amount must match before a transfer is associated with a Disburse recipient/fee leg. One log satisfies one leg, including identical batch amounts. Additional outflows remain visible for review. No observed transfer creates a beneficiary or authorizes a payment.

If transfer history arrives before app confirmation, its reconciliation ID survives attachment of the payment context. If the app has already recorded a payment, its existing ID survives the added transfer proof. Known fees remain separate. Failed/conflicting evidence holds the affected index and complete export rather than reporting successful reconciliation.

When a transaction's outgoing evidence exists but a payment leg cannot match it, the app record is flagged `Transfer match pending` and excluded from totals. The observed transfer stays in the report. This prevents changed legacy recipient details or partial indexer results from counting both an unmatched intent and its possible settlement. The CSV retains the review flag and exact chain evidence separately.

Payment confirmation now reads the actual network block, checks its chain/number/hash and stores the block timestamp independently of the app observation time. Re-verifying an old payment can add missing evidence without repeating settlement or altering previously established evidence. Invoice receipt/forwarding scans also save verified block time and sender/destination evidence for new events. Legacy event times remain explicitly recorded/unknown until reverified.

The UI uses UTC for report dates and exposes history coverage. A completed provider scan is not a proof that opening and closing balances reconcile: indexer lag, unsupported assets and account locations outside the Safe still need accounting review. These reports cover recorded fungible/native movements; they do not claim NFT valuation, all asset balance adjustments or full financial statements.

## Queries and exports

- Transaction pages return at most 100 entries, with indexed date/environment, exact asset, currency, network or recipient lookups. Additional combined filters have a 500-row/1 MB read budget. A continuation is retained if a filtered scan needs another page.
- Complete recognized-asset totals come from disjoint daily/monthly/all-history aggregates. Values use integer base units, with no floating-point summation. Unrecognized identities are excluded.
- Recipient summaries return at most 50 recipient/asset groups by default. Each group's value covers the selected dates. Sorting is explicitly limited to the displayed page.
- All-history reports are available with both dates cleared. Custom date ranges cover at most 732 days; the UI reports longer/invalid ranges explicitly. Daily boundary buckets and whole-month buckets do not overlap.
- The observed-asset picker shows up to 100 workspace assets for the chosen activity scope. When more exist, an exact contract search is available. The catalogue is a workspace history catalogue, not a claim that every listed asset has activity in the currently selected dates.
- A single historical payment may have at most 500 recipient rows for indexing; current pay runs are limited to 200 recipients. An oversized legacy source produces an explicit recoverable error rather than silent omission.
- Export all matches reads every page against one index revision. Changed/unfinished histories, repeated cursors, cancellation and oversized results produce no partial download. Limits are 10,000 rows, 20 MB of row data and 500 scanned pages per export; narrower date ranges provide larger-history exports in parts.

CSV rows preserve reconciliation ID, source ID, chain transfer ID, UTC activity and observation timestamps, date evidence, block identity, exact decimal/raw quantities, network ID, contract, account, entry type and verification status. Token quantities receive no inferred fiat valuation. These files are operational reconciliation evidence, not direct general-ledger journals or GAAP financial statements.

The installed Convex 1.31.7 runtime and shipped pagination validator support explicit read budgets; its `PaginationOptions` type declaration omits those fields. `reportPagination.ts` uses the shipped validator's inferred type. [Convex pagination documentation](https://docs.convex.dev/database/pagination).

## Acceptance evidence

The account-history pass completed 559 code tests across 70 files, lint/typecheck and a checked build. The full browser pass completed 215 stories; five affected stories passed after the final mismatch flag was added, including the new legacy-record case. Desktop light, mobile dark and mismatch screenshots were inspected. Final development functions deployed at 15:12:34 local on September 6, 2026.

The actual isolated Sepolia acceptance completed a full incoming/outgoing scan, reverified the earlier native-gas payment against block 11645570, attached its unique transfer ID and retained one payment entry. The observed confirmation time remains separate from the block time. Full recorded USDC inflows less outflows matched the Safe's independently read USDC balance exactly. This verifies that asset/account at the recorded block; it does not establish reconciliation for other customer accounts or accounting books.

Evidence: `/tmp/disburse-account-history-check3.log`, `/tmp/disburse-account-history-browser-all.log`, `/tmp/disburse-account-history-browser-final.log`, `/tmp/disburse-account-history-build2.log`, `/tmp/disburse-account-history-deploy3.log`, `/tmp/disburse-account-history-live3.log`, `.local/qa/report-index-evidence.json` and `.local/qa/account-history-*.png`. The acceptance script authenticates only to the isolated development organization and re-verifies existing chain activity; it does not send funds. The signed-in user-browser recheck remains Q06.

### Earlier index pass

Seven backend index stories cover equal-time pagination, interrupted backfills, exact large values, superseded entries, failed replacements, export revision checks, workspace access, a 200-recipient pay run and UTC bucket boundaries. Three export tests cover empty filtered pages, changed revisions, repeated cursors, cancellation and size caps. Existing asset/deposit/fee regressions also pass.

The full pass completed 544 code tests in 68 files, lint/typecheck, a checked build and 213 browser stories. Four new browser stories exercise paging, export completeness, interrupted exports and recovery; both theme screenshots were inspected. The development backend deployed at 14:06:19 local on September 6, 2026.

`scripts/qa-report-index.mjs` verified the actual isolated development organization's completed index, cursor pages, recipient aggregates and the previously settled 0.000001 Sepolia USDC payment's exact transaction hash. It did not send funds or change payment records. Evidence: `.local/qa/report-index-evidence.json` and `/tmp/disburse-report-index-live.log`.

The preexisting signed-in Chrome connection closed before the final built-browser check. Browser discovery returned no active browser; the supported launcher was unable to read Chrome's Local State due to an operating-system permission error. The actual database check passed separately; the live signed-in visual recheck remains part of Q06. This does not affect the recorded browser-suite results or establish full launch readiness.
