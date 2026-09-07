# Disburse v2 implementation

Disburse now organizes the finance team's work around recipients, bills, payment batches, upcoming payroll, funding accounts, and approvals. Stablecoins remain the settlement mechanism; the workspace uses familiar payment language and keeps technical details in funding, signing, and delegated spending controls.

## Implemented product

| Area       | Working flow                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview   | Review queue, upcoming payments, overdue bills, incomplete recipients, account balances, recent activity, and first-payment setup                                     |
| Recipients | Searchable people/vendor directory, groups, archive, bulk selection, CSV export, create/edit, and explicit address-change confirmation                                |
| Import     | CSV/TSV upload or spreadsheet paste, employee/vendor column aliases, duplicate/row validation, and preview; identities can be saved without a payout address          |
| Payments   | Select saved recipients, enter individual or shared amounts, choose an account, pay as soon as approved or choose a payday, review, and save a draft                  |
| Review     | Immutable recipient details, exact amounts, draft edits, screening acknowledgement, owner approvals, sending, cancellation, rescheduling, and receipt recovery        |
| Bills      | Record and edit vendor invoices, reject duplicates, track due dates, void unpaid bills, combine selected bills by vendor, and follow the linked payment to settlement |
| Recurrence | Weekly, biweekly, and anchored monthly schedules; edit future instructions, pause/resume, and prepare each future batch three days before payday                      |
| Accounts   | Per-account/token balances, explicit unavailable states, correct network/address/QR funding instructions, owner threshold, and account management                     |
| Team       | Invitations, atomic profile/role updates, last-admin protection, app payment budgets, contract allowances, and offboarding reminders                                  |
| Fees       | Configurable stablecoin fee currency, fee availability checks, and relay submission; an unavailable configured currency requires review before signing                |
| Reports    | Transaction, recipient spending, and audit reports with exact backend aggregation, CSV exports, and retained payout snapshots                                         |
| Settings   | Separate general, funding, fee, screening, and billing sections; test billing handles submitted transactions through receipt verification                             |

A pay run is one reviewed batch, usually for a payroll period. Disburse pays the amounts provided by the business; Gusto or another payroll system remains responsible for taxes, deductions, and payroll calculations. Recurrence prepares instructions and never signs on the team's behalf.

## Design and code refactor

The app has a persistent workspace shell, shared semantic design tokens, light and dark appearances, compact tables, responsive navigation, native focus-managed dialogs, and consistent loading, empty, error, and confirmation states. The dashboard's chart-heavy implementation and superseded payment/recipient components have been removed.

Route pages coordinate focused components and services. Payment signing/submission is isolated from payment list presentation. Settings sections share a controller without performing payment side effects during rendering. Amount calculations use integer base units; detailed payment formatting preserves all six decimals, including values beyond JavaScript's safe integer range.

Server operations enforce organization access and current app budgets. New payment records retain their recipient address/name snapshots. Safe proposal verification checks exact transfer calldata, supported batch contract code, the saved hash and fee currency, current owners, signatures, and nonce order. Confirmed receipts drive paid status. Both native and relayed submissions have backend reconciliation.

## Product boundaries

- **Payroll integration:** representative employee CSV import is implemented. Gusto OAuth/API access is not configured, and a real customer's export still needs acceptance testing.
- **Invoicing:** this is vendor accounts payable. Customer invoices, attachments/OCR, credits, partial payments, tax calculation, and general-ledger accounting are not presented as working features.
- **Delegation:** owners can propose real Safe Allowance Module grants and revocations. Delegates spend through Safe; normal Disburse payroll/bill flows still use owner approvals. Module grants do not enforce recipient allowlists or app budgets.
- **Treasury services:** Bridge/Brale onboarding, conversions, cross-chain transfers, and yield are not simulated as completed integrations. The [market research](MARKET_RESEARCH.md) explains the proposed buyer and integration strategy.

## Verification and review

```bash
bun install
bun run check
bun run build
bunx playwright install chromium
bun run test:e2e
```

The browser suite uses the **actual application routes** with serve-only read-only adapters. It covers all nine workspace screens, recipient filtering and employee import preview, immediate batch review, bill payment preparation, draft and recurring edits, delegated spending, dark appearance, and mobile navigation/overflow. It blocks outbound network requests and never signs or writes to a database. These checks supplement backend integration tests; they are not funded end-to-end payment tests.

To review the populated workspace without signing in:

```bash
bun run dev:qa
# Open http://127.0.0.1:5174/org/demo/dashboard
```

Normal development remains `bun run dev` with real authentication and the configured Convex development backend. QA builds are deliberately rejected, and QA fixtures are absent from production assets.

The production build succeeds. Wallet/Safe dependencies still produce large-chunk warnings; the obsolete ApexCharts dependencies are removed. Funded network/provider acceptance testing and independent security review remain release requirements. See [architecture and migration notes](ARCHITECTURE_V2.md) for the operational limits.
