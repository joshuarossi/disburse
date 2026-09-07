# Billing, trial and pricing review

Reviewed September 5, 2026. Prices below are published reference points, not evidence that customers will pay Disburse. The September 6 licensing update below supersedes the earlier expiry policy; external comparisons remain dated reference points.

## Implemented terms

| Plan | Price per 30 days | Members | Recipients |
| --- | ---: | ---: | ---: |
| Free | No subscription charge | 1 | 25 |
| Trial (30 days, configurable) | No subscription charge | 5 by default | 100 by default |
| Starter, historical receipts only | 25 USDC | 1 | 25 |
| Team | 50 USDC | 5 | 100 |
| Pro | 99 USDC | Unlimited | Unlimited |

The source of limits and prices is `shared/billing.ts`. The billing period is 30 days, not a calendar month. There is no automatic debit or card subscription. An administrator sends USDC and redeems the verified receipt. Same-plan renewal preserves unused paid time; an upgrade converts remaining paid time at the old price into credit at the new price. Trial time has no cash credit. A lower plan can be selected after the current paid period ends.

Access is computed from the current timestamp. An active operator grant takes precedence over a valid paid or trial period. Otherwise the company receives its permanent free fallback, defaulting to one seat and 25 saved recipients. Invalid dates never create perpetual premium access. Existing members and records remain after a downgrade; adding recipients and reserving or accepting invitations requires available capacity. Core payments, scheduling, account access, collection and recovery are no longer gated by subscription expiry.

Customers own their Safe and pay every network and provider fee. A license governs the Disburse interface and services; it does not govern the customer's ownership of funds. The present choice is to keep core money management and payments free. Other tools, including specialized reports, can receive their own tier rules later. No new reporting or screening gate has been introduced. See [company license controls](LICENSE_MANAGEMENT.md).

Operators can give a company permanent or dated complimentary access, change its trial end date, create custom free tiers, and configure future signups, including 30 days Pro followed by lifetime Free. Paid receipts and grants remain separate. The default signup trial is unchanged until an operator changes the program. Free's current limits cover the old Starter offer, so new Starter checkout is disabled; already prepared checkouts and historical paid receipts retain their original terms.

## Payment verification and recovery

The server accepts configured Ethereum mainnet or Sepolia canonical USDC. It verifies the network, successful receipt, two confirmations, the treasury destination, an authorized payer and the plan amount. A payer must be the administrator's wallet or an account linked to that organization on the same chain. A transaction hash can fund only one organization/plan redemption; retrying the same completed redemption does not extend access again. Redemption and its audit entry are atomic.

Wallet checkout now saves the original terms and a durable attempt before requesting payment. It coordinates administrators and browsers, retains the original wallet nonce, and recovers confirmed payments in the background even after session or trial expiry. Unknown wallet responses block a new send. Database-backed checkout verifies the exact payment amount; a manually submitted receipt without a saved checkout retains the seven-day verification window and accepts an overpayment as satisfying one selected plan. Overpayment does not buy extra periods or trigger an automatic refund. See [checkout implementation and evidence](BILLING_CHECKOUT.md). Downgrade, invoice/tax receipt requirements and refund policy need final business terms before public checkout.

The production treasury address and billing network have not been confirmed. Unconfigured checkout disables sending and copying a destination. No successful live subscription checkout is claimed in this review. Never use a developer's QA wallet as a default production billing destination.

## External price comparison

| Product | Published reference | What the comparison means |
| --- | --- | --- |
| Request Finance | Starter $42, Growth $250, Pro $500 and Scale $1,040 per month **billed annually**; 30-day trial | Its current pricing describes the account product and includes free stablecoin payouts. It does not establish the legacy Safe App's price. [Request pricing](https://www.requestfinance.com/pricing) |
| BILL | Essentials $49 per user/month; ACH $0.59 per transfer | A finance workflow buyer already pays for controls and records, but BILL offers bank/AP capabilities Disburse does not match. [BILL pricing](https://www.bill.com/product/pricing) |
| Gusto | Simple $49/month plus $6/person; Plus $80/month plus $12/person | Full payroll calculations and services make it a complement and workflow reference. Disburse is not an equivalent payroll replacement. [Gusto pricing](https://gusto.com/product/pricing) |
| Ramp | Free plan; Plus $15/user/month **plus a platform fee based on team size** | Per-seat price alone is not the complete bill. A free incumbent also raises the bar for generic finance features. [Ramp pricing](https://ramp.com/pricing) |

A five-member Team workspace costs 50 USDC per 30 days. That is inexpensive relative to many paid finance tools, but a lower price does not compensate for payment uncertainty, missing accounting sync or signing friction. Request's free stablecoin payouts also weaken any simple claim that transaction-fee savings alone justify Disburse.

## Recommended launch experiment

The integrated workflow itself can be a paid service: customers may prefer Disburse to assembling Safe, spreadsheets, exchanges and several provider interfaces. Operating the underlying infrastructure is not a requirement for charging for useful coordination, controls and convenience. Evaluate affordability using total fees and time saved; being the cheapest remains a comparison to validate, not an established claim.

**Updated product direction:** prove the best practical finance experience before optimizing monetization. The current model keeps core payments available on Free, offers paid capacity and convenience, and leaves optional service fees to be decided after the integrations work. Invoice generation/service pricing is undecided. No new add-on fee has been activated. Team size and advanced controls are tier hypotheses, not new enforced limits; consider small businesses and accountants managing multiple client organizations as well as finance teams.

Build integrations first, measure their usage and contribution margin, and consider operating a replacement service only when that improves customer value and economics. A provider integration does not automatically transfer the provider's revenue to Disburse. Gelato separates network costs and service fees; LI.FI documents both its own fee and an optional integrator fee. Wholesale terms or revenue sharing may leave room for margin without increasing the customer's total cost. Yield curator fees also compensate for ongoing allocation and risk responsibilities, which Disburse is not taking on with a provider integration. [Gelato Gas Tank](https://docs.gelato.cloud/Paymaster-%26-Bundler/GasTank), [LI.FI fees](https://docs.li.fi/faqs/fees-monetization), [Morpho curator responsibilities](https://docs.morpho.org/learn/concepts/curator/).

Track subscription contribution independently of optional services. For each service measure customer service revenue less external execution charges, network costs, failed attempts and support. Quotes must distinguish costs from Disburse fees and require consent before execution. Keep fee policy separate from provider adapters. Invoicing economics must include one-time receiving-contract activation, each collection transaction, monitoring, and support; generating an unused address does not itself require deploying a contract.

Evaluate Team at 50 USDC per workspace per 30 days for a paid pilot with five members and 100 recipients. Compare it against the new Free baseline and test whether the extra team capacity earns its price. Display customer-paid provider/network fees separately. New customers should not be sold the former Starter package when its limits are already included in Free.

Treat Pro's 99 USDC unlimited seats/recipients as unvalidated economics; no priority-support promise is included. Measure onboarding time, monthly support, RPC/relay costs and active recipient counts before promising unlimited service broadly. A later growth tier around 149 USDC is a willingness-to-pay experiment, not a price recommendation established by research. No price increase was applied to existing workspaces.

Get five design partners through two payment cycles and ask for payment. Record why prospects decline. Compare preparation time, approval delay, correction frequency, reconciliation time and support cost with their existing process. A retained paying customer is stronger evidence than a positive interview or a large stablecoin-volume chart.


## September 6 implementation follow-up

Billing displays active members, reserved invitation seats, saved recipients including archived records and connected accounts using the same definitions as enforcement. It keeps renewal available if usage cannot be counted. No per-network account cap is advertised or enforced. All plans describe the implemented core workflows; obsolete per-plan feature restrictions and the unvalidated priority-support promise were removed. English, Spanish and Portuguese show the same USD price and 30-day billing period. Trial copy explains its actual end date and absence of paid credit. Current paid prices remain 50/99 USDC. Free replaces the former Starter offer for new checkout.

Core payment approvals, native and managed submission, scheduling, delegated authorization and account-readiness checks no longer use the old subscription gate. Customer authority, recipient review, screening policy, balances and fee checks remain. Paid checkout keeps its verified-receipt and recovery rules. Operator changes are audited and reject stale revisions or an outstanding checkout. The [license guide](LICENSE_MANAGEMENT.md) records implemented controls and evidence boundaries.
