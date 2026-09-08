# Pilot readiness review

September 8, 2026. Public mainnet launch remains on hold. This review improves the pilot workflow; it supplies no new mainnet, customer, external-ledger or independent security evidence.

## Assessment and changes

- Entry pages already inherited workspace colors through CSS. Counting navy utility classes alone overstated the visual gap. Login, onboarding and workspace selection now use explicit workspace tokens. Login explains the purpose of the signature before connection. Account setup explains Safe, account ownership and the number of approvals in plain language without changing authority.
- The payment builder constrained its final recipient review to 256px. All recipients now participate in the dialog's main scroll flow on desktop and mobile, with an explicit review count. A 50-person payroll regression covers the last recipient.
- Bulk selection includes all matching recipients, even below the fold. The button now names that scope and count. An empty selection shows no currency total; selected totals still respect saved currency and network instructions. The overview uses singular grammar for one recipient needing review.
- Screening defaults to Warn for new workspaces and missing settings. Saved Off and Block choices remain unchanged. Warn presents missing, stale or flagged evidence for review; it does not establish compliance or enforce Block behavior.
- Reports uses finance tables and workspace status badges. Settled outgoing payments read Paid. Counterparty names remain prominent; full wallet addresses are available under Wallet address. Exports retain their existing fields and status values.
- Delegated spending states its unrestricted destination authority up front. Revocation guidance remains available, and the explicit grant acknowledgment remains required. Copy cannot turn an allowance into a recipient allowlist.
- Payments and Schedules already open their intended screens. Their older route names are retained to preserve saved links and recovery destinations. The URL vocabulary is a follow-up navigation migration, not a reason to swap screen labels.

## Five-team pilot

Recruit five teams that already hold stablecoins and operate a Safe. Do not count internal QA accounts as customers. Each team completes two payment cycles using actual obligations and reviewed exports. Participation, named team contacts and acceptance records are still pending.

Before the first cycle, record the current preparation and reconciliation process, time spent, approvers, recipient count, support needs and ledger. Confirm the wallet/network combination has passed the acceptance below before using it with real funds. Keep mainnet receivables disabled pending independent review.

For each cycle, record preparation time, recipient corrections, approval delays, payment failures, reconciliation time, fees and every support intervention. Retain redacted evidence of reviewed payments and journal imports. Have an accountant reconcile existing obligations without duplicating them, review classifications and close a period in the actual ledger. CSV and journal export are the current accounting handoff; native QuickBooks/Xero sync and fiat entry/exit are not established by this pilot.

After cycle two, ask each team whether they would use Disburse for its next cycle and whether they would pay the stated 50/99 USDC prices. Record actual decisions separately from interview interest. Summarize support time and observed cost per team before revising pricing. A pilot invitation or a passing test does not prove demand.

## Evidence required for public launch

All items below remain open. Each needs a named accountable owner and a dated evidence link before release sign-off. Do not infer acceptance from this PR.

| Gate | Acceptance record |
| --- | --- |
| Mainnet setup without native ETH | An explicitly authorized, bounded real-money run on each advertised network, Base and Arbitrum. Record wallet/version, starting and ending native balances, stablecoin deposit and all fees, transaction receipts, cancellation and interruption recovery. Include both new-account and existing-account setup. Testnet Circle evidence does not validate MetaMask's mainnet gas-included flow. |
| Actual wallets | Record MetaMask extension and supported mobile connector/device versions. Exercise login, network/account switching, setup, approvals, declined signatures, reload and recovery. EIP-1193 fixture results remain separate. |
| Security | Independent review of the pinned receiving contract and financial authorization boundaries, with findings resolved or explicitly accepted. Keep `AR_MAINNET_ENABLED` off until accepted. |
| External books | Accountant-approved period close and actual ledger journal import, with obligations, fees, corrections and duplicate prevention reconciled. |
| Business terms | Approve refund policy, invoice/tax-receipt requirements and production billing address before public checkout. This review does not choose or publish those terms. |
| Operations | Assign incident owner and backup, connect alerts, verify delivery with a rehearsal, and record escalation and recovery responsibilities. |
| Customer acceptance | Five real teams, two payment cycles each, repeat-use decisions, willingness-to-pay evidence and measured support burden. |

The existing [launch review](LAUNCH_READINESS.md), [market research](MARKET_RESEARCH.md), [finance-cycle evidence](FINANCE_CYCLE_ACCEPTANCE.md) and [operations rehearsal](OPERATIONS_REHEARSAL.md) remain the source records for prior work.

## Validation for this change

- 1,193 unit/backend tests passed across 120 files. Added coverage checks Warn for missing settings and preservation of explicit Off/Block choices.
- Typecheck, lint, production build, receiving-contract checks, 17 release/deployment configuration tests and two snapshot-verifier tests passed.
- The full 438-scenario browser run passed 437 scenarios and timed out waiting for Verify payment in one existing billing-retry scenario. All eight billing-checkout scenarios passed on an isolated rerun. The initial timeout remains disclosed; the full run was not uniformly green.
- New desktop/mobile checks cover all 50 payroll recipients in the main review flow, empty-selection totals, report address disclosure and light/dark accessibility. Existing setup/recovery and screening checks passed. Screenshots were inspected.
- The production build's login and wallet picker rendered at desktop/light and mobile/dark sizes. Login passed automated accessibility checks after adding persistent link underlines. This checks presentation only, not extension or mobile-wallet signing.

All checks ran locally in an isolated worktree. No backend deployment, real-money transaction, customer invitation or public launch was performed.
