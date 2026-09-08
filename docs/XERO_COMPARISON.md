# Xero comparison

Reviewed September 8, 2026, using Xero's public product, pricing and developer documentation. A working integration still needs separate acceptance. Disburse prices and entitlements remain unchanged.

## Published prices

The supplied link serves Xero's Global plans in USD. Regular prices below exclude introductory promotions; US plans have different names, features and prices.

| Market / plan | Current monthly USD price | Announced monthly USD price |
| --- | ---: | ---: |
| Global Lite | $7 | $7 |
| Global Starter | $29 | $32 from November 1, 2026 |
| Global Standard | $50 | $54 from November 1, 2026 |
| Global Premium | $75 | $82 from November 1, 2026 |
| US Early | $25 | $27 from October 1, 2026 |
| US Growing | $55 | $59 from October 1, 2026 |
| US Established | $90 | $97 from October 1, 2026 |

Sources: [Global plans](https://www.xero.com/pricing-plans/), [Global price update](https://www.xero.com/pricing-plans/update/), [US plans](https://www.xero.com/us/pricing-plans/), [US price update](https://www.xero.com/us/pricing-plans/update/). US prices exclude applicable taxes. Keep the effective dates with these figures when comparing launch pricing.

The Global Starter plan limits customers to 20 invoices and five bills. Premium includes multiple currencies; project and employee-expense features can carry additional charges. Online invoice payment fees are separate from the software subscription. [Global plan details](https://www.xero.com/pricing-plans/)

US plans advertise no per-user license fees and include standard domestic ACH bill payments, with charges for other payment methods. US payroll is an optional Gusto-powered service. These are meaningful differences from Disburse's team-capacity pricing and customer-paid blockchain execution. [US plan details](https://www.xero.com/us/pricing-plans/)

## What to learn from the product

Xero organizes payables around captured bills, due dates, duplicate detection, approval permissions and paying multiple bills. That is a useful reference for how a finance team expects the work to be arranged. [Xero bills](https://www.xero.com/us/accounting-software/pay-bills/)

Xero also presents matching and categorizing incoming account activity as part of keeping the books current. [Xero reconciliation](https://www.xero.com/us/accounting-software/reconcile-bank-transactions/)

Our product judgments from those references:

- Use familiar objects: contacts, bills, invoices, accounts, payments and reconciliation. A pay run is a reviewable collection of obligations; one recipient follows the same process.
- Make the overview answer what is available, what is due, what needs approval, what customers owe and what still needs matching.
- Keep the bill/invoice attached through payment and reconciliation. An exported file or approved signature must not be represented as settled money or a confirmed ledger import.
- Make accountant collaboration easy. Charging for every reviewer can discourage the second set of eyes that protects a payment.
- Keep stablecoin balances, network choice and fee details accurate, while placing them inside the financial task instead of making blockchain administration the main navigation.

Xero is both a budget comparison and a potential companion system. Disburse can own the stablecoin payment, collection and treasury workflow while Xero remains the customer's ledger. Replacing a complete accounting system would add tax, inventory, accounting-policy and migration requirements that the current application does not meet.

## Implications for Disburse pricing

The current 50/99 USDC prices are per 30 days; Xero prices are per calendar month. Treat these as different billing periods rather than labeling them interchangeable. The comparison puts Disburse within the budget of a substantial accounting subscription. It does not support a blanket claim that Disburse is the cheapest option.

Keep Free core money management and customer control after expiry. For paid plans, test the value of reliable payment preparation, approvals across separate company accounts, reconciliation time saved and accountable team operations. Seat capacity alone is a weak explanation for the higher tier against a product that advertises no per-user fee. Trial an affordable small-team offer and reserve higher prices for observed workflow value; do not change the live license amounts from one competitor comparison.

Subscription revenue licenses the product. Customers still pay every network/provider cost, and any future separately priced Disburse service needs its own reviewed fee and consent. Xero's inclusion of standard ACH fees does not imply that Disburse should sponsor gas.

## Integration costs and sequencing

An ordinary Xero API app is not indefinitely free: its Starter developer tier has a five-connection limit. Core currently costs AUD 35/month for up to 50 connections, with separate data-usage limits. That would create a Disburse provider bill under a conventional shared app integration. It conflicts with the current operating-cost requirement. [Xero developer pricing](https://developer.xero.com/pricing)

Xero documents a customer-purchased Custom Connection option. Eligibility, billing currency, commercial terms and the payment-service use case would need verification before choosing it for Disburse; it is not an implemented or accepted workaround. [Custom Connections](https://developer.xero.com/documentation/guides/oauth2/custom-connections/)

Start with a real customer's exported contacts and bills and a reviewed reconciliation export. Preserve Xero identifiers, prevent duplicate obligations, request separately verified payout instructions and confirm an actual import back into the books. General CSV support does not establish compatibility with every Xero export. A managed connector should follow proven demand and an explicit service-cost arrangement.
