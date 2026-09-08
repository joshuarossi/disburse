# Disburse v2 launch review

Updated September 8, 2026. **The implemented application is ready for continued testnet acceptance; public mainnet launch still requires the external acceptance below.** The outstanding list now separates unverified production conditions from code that already works. Earlier dated reports remain evidence of their own runs, not current feature status.

## Implemented and verified

| Workflow | Current result | Evidence and practical limit |
| --- | --- | --- |
| Recipients and payments | Reviewed beneficiary directory, mapped/repeated imports, one builder for one or many recipients, saved currency/network, bills and exact funding-account selection | Backend/browser regressions include archived records, duplicate imports, instruction changes, fee shortfalls and separate mixed-currency drafts. Real customer exports remain pilot acceptance. |
| Approvals and delegation | Current direct/nested Safe quorum, member controls, contract allowance grants/revocations and assigned member payment accounts | Built-app two-owner Sepolia settlement and Base Sepolia delegated batches passed. Simultaneous parent-owner approval regression passes. Safe owners retain direct authority; app roles cannot restrict activity outside Disburse. |
| Customer-paid execution | Circle USDC fees for payments, schedules, policy/account operations, receivables and subscriptions; customer approves the exact operation and fee ceiling | Real app receipts verify principal, fee/refund and zero native ETH balances. No Disburse sponsor balance or paid submission account was used. Account readiness checks the actual Circle module/handler setup and keeps fee approval separate from principal. |
| Scheduled work and recovery | Independent authorization sequences, unattended execution, on-chain cancellation and durable original-request reconciliation | A real due payment settled with browsers closed; a cancelled sibling stayed cancelled past its due date. Native lost-hash recovery and managed decline/reload/resume passed. A real accepted managed submission with its response withheld recovered 0.10 USDC principal and a 0.015708 USDC fee in the background, without another POST. Production outages can still differ from this controlled transport interruption. |
| Accounts receivable | Unique receiving addresses, confirmed payment status, full-principal collection, private/shared documents, manual reminder drafts, credit notes and reviewed-beneficiary refunds | Base Sepolia collection and a real 0.01 USDC refund plus 0.015708 USDC execution fee passed in the built app. A reminder draft is not a sent email. Independent contract review remains required for mainnet. |
| Treasury services | Direct Aave supply/withdrawal, reviewed Uniswap exact-output conversion and Circle CCTP forwarding between company accounts | Each has real testnet principal/fee and receipt-block balance evidence, declined approvals, durable execution and no native source gas. Test liquidity is artificial; it does not establish mainnet liquidity or yield. |
| Licensing | Free core operations after trial/paid expiry; operator grants, trial extensions and tier controls; immutable paid checkout and replay protection | Exact 50 USDC Team activation and renewal passed on-chain. Pro upgrade credit has automated coverage; the live upgrade remains pending additional test funds. Customers pay every network/provider fee. |
| Accounting | Verified movements, reviewed functional-currency amounts and book references, chart imports, balanced journals, credits/refunds, immutable exports, corrections and closed periods | Actual Sepolia movements reconcile to historical balances. A complete imported-recipient → bill → nested approvals → settlement → reviewed journal/export workflow passed in the built app. Synthetic book acceptance does not establish an external-ledger import or an accountant-approved classification. The customer's ledger remains the book of record. |
| Scale and operations | Indexed open-work queues, bounded account/history queries, status-specific dashboard plans, bounded read-only operator health and snapshot verification | A 6,000-payment/1,100-archived-recipient regression retains old unpaid work. An isolated restore matched 96,275 records and a stored file exactly. Monitoring detects backlog/failures without retrying financial work. |

Current checks pass 1,192 unit/backend tests across 120 files, typecheck, lint, receiving-contract tests, release-configuration tests and the build. All 410 stories pass in the latest full browser run. Branch CI and Cloudflare preview results are tracked on [PR #3](https://github.com/joshuarossi/disburse/pull/3); hosted sign-in verification is separate from production payment acceptance.

Live evidence and scope: [customer-paid services](CUSTOMER_PAID_SERVICES_QA_2026-09-07.md), [delegated payments](DELEGATED_PAYMENTS.md), [receivables](ACCOUNTS_RECEIVABLE.md), [account transfers](ACCOUNT_TRANSFERS.md), [lending](LENDING.md), [conversions](CONVERSIONS.md), [receiving costs](RECEIVING_COSTS.md), [operations rehearsal](OPERATIONS_REHEARSAL.md), [complete finance cycle](FINANCE_CYCLE_ACCEPTANCE.md).

## Remaining implementation and acceptance

The active work list is [TODOS.md](../TODOS.md). The complete two-parent-owner finance cycle now passes through exact Sepolia settlement and a balanced journal/evidence export. The first-release finance workspace is consistently English; landing, pricing and help retain translated language preferences. Eleven actual built workspace routes pass desktop/light and mobile/dark review (22 views); mobile amounts/actions, screen-reader headings, account-name loading, zero-balance summaries and duplicate/singular labels were corrected. No requirement is marked complete solely because its fixtures pass.

| External gate | Evidence needed before relying on it |
| --- | --- |
| Original/existing-account MetaMask setup | The atomic setup and interruption recovery are implemented. Verify the actual gas-included MetaMask flow with stablecoins and zero native ETH on an advertised network; the service does not advertise testnet support. No mainnet spending was performed or authorized in this pass. |
| Wallet compatibility | Actual extension/mobile connector acceptance, in addition to the isolated EIP-1193 wallets that already completed real built-app settlements. |
| Receiving contracts and broader security | Independent review of the pinned receiving contract and financial authorization boundaries before mainnet enablement. Keep `AR_MAINNET_ENABLED` off until accepted. |
| External books | Import the generated journals into a real customer ledger, reconcile existing obligations without duplicating them and complete an accountant-led close. |
| Operations | Review the final production target/schema, connect existing monitoring to alerts and assign incident ownership. Database restore cannot rewind a chain transaction or invalidate an authorization. |
| Live subscription upgrade | Verify the Pro receipt and prorated remaining-term credit with sufficient test USDC. Activation, renewal, expiry and replay behavior already have coverage. |
| Customer validation | Observe repeat use, preparation time, approval delays, reconciliation effort and support cost with actual finance teams. No demand or willingness-to-pay claim is established by tests. |

## Product and pricing judgment

Disburse has a focused proposition for teams already paying contractors and vendors in stablecoins: saved payout instructions, clear review, company-controlled funds and reconciled records in a familiar finance interface. It complements payroll calculation and accounting systems. It does not provide tax filing, benefits administration or a replacement general ledger.

Request's Safe App and its separate custodial Business Account must be compared separately. A complete finance interface above Safe is a useful product distinction; non-custody or batching alone does not establish a unique market position. The dated source review and pricing comparisons are in [market research](MARKET_RESEARCH.md), [billing and pricing](BILLING_AND_PRICING.md) and the September 8 [Xero comparison](XERO_COMPARISON.md). Xero is a useful workflow and budget reference; its broad accounting offer and collaboration pricing raise the bar for the value of a second subscription.

The current offer is Free, Team at 50 USDC and Pro at 99 USDC per workspace per 30 days. Expiry preserves Free core money management; licensing never changes Safe ownership. Those prices are pilot hypotheses, not proven unit economics. Network/provider charges belong to the customer and are displayed separately. No additional Disburse service fee is enabled by the receiving-cost benchmark or provider integrations.

Validate the product with several teams already using stablecoins, using their actual exports and two payment cycles. Compare preparation and reconciliation time against their existing process and ask whether they choose to use it again. Pricing should follow that evidence. Do not claim the lowest cost without comparing an actual workload and all fees.

## Release decision

The coded release candidate has passed the source, browser and controlled testnet checks above. Complete the listed external acceptance before opening unrestricted mainnet use. Public launch should follow the production-specific evidence above; a passing CI badge cannot stand in for it. The deployment procedure and rollback limits are in [DEPLOYMENT.md](DEPLOYMENT.md).
