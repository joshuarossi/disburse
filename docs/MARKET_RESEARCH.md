# Disburse: market opportunity and product direction

Research date: September 5, 2026. This is a product thesis, not a forecast or evidence of product-market fit. Product claims below are tied to sources; customer counts, pricing, and conversion rates in the scenarios are assumptions to validate.

## The opportunity

Build a familiar payments workspace for finance teams that already receive digital dollars or regularly pay people across borders. Let teams import recipients, prepare payroll batches, approve bills, schedule payments, and reconcile results without managing transaction construction or gas balances themselves.

The starting proposition is operational: **pay the right people, on time, with approvals and records your finance team can use.** Stablecoins supply the payment infrastructure. Non-custodial control is a purchasing consideration for the finance lead, not the organizing principle of every screen.

A sensible first customer is a business with 20–200 international contractors or vendors, a small finance team, and an existing reason to hold or pay in stablecoins. That segment is a hypothesis. Interview customers before treating it as an established market segment.

Do not start by replacing Gusto's payroll calculations, tax filings, benefits, or employment records. Disburse currently prepares payouts; it does not calculate net wages. Keep the payroll or accounting system as the source of amounts owed, and become the approval, settlement, and reconciliation layer.

## Evidence of demand, and its limits

Artemis reported an approximately $122 billion annualized payments run rate using August 2025 observations, up 137% year over year. Its provider-based work helps distinguish identifiable payments from the much larger pool of stablecoin transfers. This is a historical annualized observation, not realized annual revenue, not the September 2026 market size, and not a count of businesses buying treasury software. [Artemis research, October 2025](https://research.artemisanalytics.com/p/digital-finance-fundamentals-10282025)

Visa's on-chain dashboard distinguishes adjusted activity from raw transactions and explains that some on-chain transactions do not resemble conventional settlement. Raw transfer volume must not be used as Disburse's addressable market. [Visa Onchain Analytics](https://www.visaonchainanalytics.com/transactions)

Infrastructure providers already offer conversion and transfer building blocks. Bridge documents fiat/stablecoin conversion and reusable transfer instructions. Brale documents transfer rails and status transitions. Their existence reduces the need to build every funding and payout connection, but does not establish coverage, economics, availability, or an acceptable custody model for a particular customer. Those need provider diligence. [Bridge platform](https://apidocs.bridge.xyz/platform), [Brale transfers](https://docs.brale.xyz/key-concepts/transfers)

**Inference:** there is a plausible gap between payment infrastructure and finance operations. A small team may be able to transfer tokens today but still lack recipient onboarding, approval queues, duplicate-invoice controls, exception handling, and an accounting-ready record. Whether that gap supports a standalone product must be tested against existing tools and customer behavior.

## Who to pursue first

| Segment                                                                     | Why it might adopt                                                          | Main obstacle                                                | Priority                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| Businesses already holding stablecoins and paying international contractors | Avoid repeated conversion and manual address entry; repeatable monthly work | Recipient readiness, reconciliation, trust                   | First design partners               |
| Distributed agencies and software teams with cross-border vendors           | Consolidate batches, due dates, and payment records                         | Funding/off-ramp economics and recipient preference          | Second, after corridor validation   |
| Crypto-native organizations using Safe                                      | Existing wallet control and signing processes fit the architecture          | Strong specialist competition and complex ownership policies | Useful early distribution           |
| Domestic-only businesses satisfied with payroll and bank payments           | Familiar UI alone offers little reason to switch                            | Little demonstrated advantage over incumbent rails           | Deprioritize                        |
| Businesses requiring tax, benefits, and employer-of-record services         | Need a complete employment platform                                         | Far beyond payout orchestration                              | Integrate; do not claim replacement |

## Product inspiration and competitive pressure

| Reference      | Workflow to learn from                                  | How Disburse should apply it                                                    |
| -------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Gusto          | Review payroll, request approvals, then submit          | Import people and approved payout amounts; make payroll a guided batch workflow |
| BILL           | Capture a vendor bill and connect approval to payment   | Keep invoice number, vendor, amount, due date, and linked payment together      |
| Ramp           | Treat a bill as a structured record with approval state | Separate the invoice from its transfer and show who needs to act next           |
| QuickBooks     | Accounts payable and the accounting record              | Complement the ledger with exports and later a reconciliation integration       |
| Bridge / Brale | Funding, conversion, and payout infrastructure          | Integrate behind funding and withdrawal flows after provider validation         |

Gusto's approval workflow and BILL's invoice-to-payment workflow provide practical references. Ramp's API describes a bill as the record driving approvals, coding, and payment. These references support the workflow choices above; they do not establish that any one vendor lacks stablecoin support. [Gusto approvals](https://support.gusto.com/article/240829150046240/set-up-approvals-for-payroll-for-admins), [BILL accounts payable](https://www.bill.com/product/accounts-payable/), [Ramp bill records](https://docs.ramp.com/developer-api/v1/guides/bill-pay), [QuickBooks bill workflow](https://intuitglobal.intuit.com/delivery/cms/prod/sites/default/intuit.ca/pdf/allaboutqbo/new-to-quickbooks/Manage_and_Pay_Bills.pdf)

Specialists already cover much of the proposed feature set:

| Competitor      | Documented overlap                                                                    | Implication                                                         |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Request Finance | Batch invoice payments and salary workflows                                           | Invoicing plus stablecoin batches is not sufficient differentiation |
| Coinshift       | Safe-based non-custodial treasury and mass payments                                   | Safe integration alone is not a competitive advantage               |
| Deel            | Employment/payroll services with stablecoin funding or payouts for eligible use cases | Compare the entire employment workflow, not just transfer fees      |

Sources: [Request batch payments](https://help.request.finance/en/articles/8622160-how-to-batch-multiple-payments-into-one-transaction), [Request salaries](https://docs.request.finance/salaries), [Coinshift overview](https://docs.coinshift.xyz/business/about-us/overview), [Deel crypto businesses](https://www.deel.com/industries/crypto/).

Current published pricing is reviewed in BILLING_AND_PRICING.md. Competitive diligence still needs hands-on product demos and eligibility checks. Do not claim an uncontested market. Existing accounting and AP tools can add new payment rails; infrastructure partners can move into finance workflows.

The defensible work would be the quality of recipient data, integrations, approval controls, exception recovery, reconciliation, and distribution through accountants and existing payroll providers. A token-transfer form is easy to replicate.

## Market sizing: build from customers, not token supply

No verified count of qualified buyer organizations was established in this review. The table below is a sensitivity model, not a TAM estimate or sales forecast. Subscription ARR equals customers × monthly subscription × 12. It excludes infrastructure fees, support cost, discounts, churn, and implementation cost.

| Illustrative scenario     | Paying organizations | Monthly subscription assumption | Subscription ARR |
| ------------------------- | -------------------: | ------------------------------: | ---------------: |
| Focused early business    |                  250 |                            $200 |         $600,000 |
| Established niche product |                2,000 |                            $300 |     $7.2 million |
| Broader finance platform  |               10,000 |                            $400 |      $48 million |

For payment-based revenue, 2,000 customers each moving $100,000 a month imply $2.4 billion of annual payment volume. At an assumed 10 basis points, that produces $2.4 million in gross annual transaction revenue **before** provider costs and other expenses. This is a unit-economics illustration, not a recommendation to charge 10 basis points or an estimate of attainable volume.

To establish an actual serviceable market, count organizations meeting all of these filters: supported geography, eligible business type, supported funding/off-ramp route, repeat payment need, sufficient recipient acceptance, and willingness to use the chosen control model. Validate that count using a named prospect list and partner/channel evidence. Then apply observed conversion and retention, not assumed market share.

## The Gusto onboarding opportunity

The first experience should be: export an employee directory → upload or paste → preview mapped columns → check duplicates → save recipients → complete payout details → review a payment batch.

The implementation accepts common name, first/last name, email, and address headings, plus explicit column mapping for unfamiliar exports. Currency/network preferences are preserved. A name and email can create a directory entry without a payout address. An incomplete entry cannot become a payable recipient until its address is added. Representative CSV/TSV shapes are supported; an actual customer Gusto export has not been tested in this work.

A future direct integration should use **Gusto App Integrations**, not assume that Gusto Embedded Payroll is a shortcut to accessing an existing customer's company. Gusto states that production integration access requires pre-approval and security review; individual customers cannot simply connect an internal system with unrestricted API access. [Gusto integration introduction](https://docs.gusto.com/app-integrations/docs/introduction)

Gusto's employee endpoint supports employee records and an `employees:read` scope, while compensation access is separately scoped. OAuth provides company-scoped authorization. Import employee identity using the minimum permitted scope and paginate results; do not import tax IDs or bank details just because an endpoint returns them. [Employee endpoint](https://docs.gusto.com/app-integrations/reference/get-v1-companies-company_id-employees), [OAuth](https://docs.gusto.com/app-integrations/docs/oauth2)

A production connector needs encrypted server-side token storage, refresh handling, disconnect/revocation, stable external IDs, previewable updates, termination handling, and an audit log. Sync must never overwrite a verified payout address based on an HR record or interpret compensation as net payroll. Record directory sync and payroll payment as separate permissions.

Later integrations worth validating with actual customers: QuickBooks/Xero vendor and bill sync, approved payroll exports, and accounting-ready payment reconciliation. A connector should solve an observed workflow, not fill an integrations logo wall.

## Funding, conversions, and yield

1. **Funding and withdrawals:** validate one useful fiat corridor with one provider first. Show the expected amount received, fees, status, and the responsible provider. Keep provider credentials on the server. A non-custodial Safe does not make every external funding leg non-custodial.
2. **Currency/network conversion:** add only after finance teams demonstrate a recurring need. Quote input/output assets, network, fees, minimum received, expiry, and failure recovery. Treat it as a separate approved treasury transfer. Do not silently convert a payroll balance.
3. **Yield:** defer until payment reliability and customer demand justify it. Stablecoins themselves do not imply a yield product. Keep any reserve investment separate from money committed to payroll, with explicit authorization and liquidity information. Do not represent invested funds as immediately available for bills.

No live ramp, swap, lending, or yield integration is included in the current implementation. No provider availability or commercial agreement is implied.

## What would validate the business

Recruit 10–15 finance leads and bookkeepers, initially from teams already paying contractors with stablecoins. Watch them complete a real payroll or vendor-payment cycle in their current tools. Measure manual preparation time, address-handling incidents, approval delays, reconciliation effort, all-in payment cost, and recipient support requests.

Then run a small paid pilot spanning at least two payment cycles. Proposed targets to test, not measured results: import a 50-person directory in under 10 minutes; reduce preparation time by at least half; eliminate repeated address copying; attach a payment record to every paid invoice; and have customers choose to use the next cycle without prompting.

Interview both the budget owner and the operator. Stop expanding the product if customers will not pay, recipient onboarding dominates support, funding costs erase the advantage, or non-custodial signing creates more work than it removes.

Price around the value of repeatable finance work and control, with transparent payment/provider fees. Validate willingness to pay before publishing a new pricing model.

## Request product distinction

Request’s documented Safe workflow starts inside Safe → Apps → Request Finance. The user selects an invoice, clicks Pay and chooses Safe; other owners then sign as required. That establishes the documented Safe App workflow, not a standalone finance interface replacing Safe’s approval interface. Request also offers a separate Business Account product. Those must be evaluated separately; its current account pricing is not proof of the legacy Safe App’s price or custody model. [Request’s Safe instructions](https://help.request.finance/en/articles/8622172-how-do-i-pay-with-safe-wallet-formerly-gnosis-safe), [Request Business Account](https://help.request.finance/en/articles/13434908-request-business-account-overview).

Disburse’s proposed advantage is a complete daily finance workflow above Safe: recipients, bills, preparation, approval progress, payment and records in one interface. Non-custody alone is not unique, and this UX advantage has not yet been validated with customers.

## September 8: Xero as a comparable product

[Xero comparison](XERO_COMPARISON.md) adds region-specific regular prices and announced increases, bill/reconciliation workflow references and implications for team-based pricing. Xero strengthens the case for familiar finance navigation and accountant collaboration, while raising the bar for Disburse's paid value. Treat it as both a customer-budget comparison and a potential source ledger. A future API connector needs separate economics because Xero's developer platform charges beyond its small free connection allowance; no connector cost is assumed to fit the current Convex/Cloudflare-only operating model.
