# Disburse product and service requirements

Confirmed with the product owner on September 7, 2026. These requirements govern provider selection and implementation.

## Product and service boundary

This boundary applies to every feature, including onboarding, account creation, invoices, payments, collection, conversions, yield, screening and integrations.

Disburse is the software product. Its monthly subscription grants a license to use the tool and the capabilities of the selected tier. Disburse's permitted application operating costs are Convex and Cloudflare. The subscription must not create an obligation to pay external service costs for customers.

Beneficiary records, imports, payment preparation, approvals, invoice drafting, accounting and reports are software capabilities. An external service used through the product quotes its complete cost to the customer, who pays that cost in stablecoins when using the service. A license tier does not change who pays service costs.

An external execution service supplies native gas, submits transactions and charges the customer for its work. The customer pays every transaction cost from their own Safe in supported stablecoins. Disburse may prepare and submit customer-signed requests, but it has no financial role in execution.

Disburse must not fund gas, maintain a prepaid service balance, pay an external provider's subscription or usage bill, or collect a reimbursement for those costs. This includes submission, indexing, screening, document processing and delivery APIs. An API free allowance does not establish this billing model if usage can create a Disburse bill. Convex and Cloudflare are the stated infrastructure exceptions.

If Disburse later operates an execution, conversion or other payment service, that is a separate service with explicit customer pricing. That future option does not authorize a product-funded service today.

## Getting started

A new finance team needs MetaMask and enough of a supported stablecoin on a supported network to cover setup and the amount it wants in its company account. It must not need ETH or another native gas token, an existing Safe, a provider account or a provider API key.

1. Connect MetaMask and choose the supported stablecoin balance to use.
2. Configure the company account, its owners and approval threshold in Disburse.
3. Review the complete setup cost in stablecoins, the amount to put in the company account and the total wallet debit.
4. Authorize those terms in MetaMask. The execution service takes its fee directly from the customer's stablecoins and creates and funds the Safe.
5. Disburse verifies deployment, ownership and transferred balances before showing the account as ready.

The first fee must be payable from the existing MetaMask wallet. A design that requires a funded Safe before the Safe can be created is incomplete. Asking the user to transfer tokens to a predicted address with a native-gas transaction does not meet this requirement. A provider must support the complete setup and funding sequence.

Cancellation preserves the form. An interrupted provider response must recover the original operation before permitting another paid attempt. The acceptance test starts with zero native tokens in MetaMask, no existing Safe and no Disburse-funded provider account. Repeat it for additional and nested company accounts, with their actual owner approvals.

## Costs across the product

| Feature                                          | Software capability                                                        | External service cost, if any                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Safe setup                                       | Company information, owners, approvals and account management              | Customer authorizes and pays setup, deployment and initial funding costs in stablecoins during onboarding                                              |
| Invoice creation                                 | Draft, number, render, share and record an invoice                         | Any paid creation or provisioning service is quoted and paid by the issuing customer at creation; local address prediction alone has no deployment fee |
| Invoice collection                               | Track received and collected amounts and reconcile the books               | Customer pays any forwarder deployment, collection and service fees in stablecoins when the corresponding service is used                              |
| Payments and account changes                     | Prepare, approve, schedule and record instructions                         | Customer pays all execution and service costs in stablecoins, including grants, revocations and signed cancellations                                   |
| Conversion, bridging and yield                   | Review provider options and record positions or movements                  | Customer pays the selected external provider's disclosed costs in stablecoins as part of the authorized service                                        |
| Screening, extraction, integrations and delivery | Local processing, public-source screening, files, links and in-app updates | A paid external service requires a customer-paid route; it must not create a Disburse provider bill                                                    |
| Software subscription                            | License and tier access                                                    | The subscription price goes to Disburse; the customer separately pays the execution service's cost in stablecoins                                      |

Quote a cost at the action that incurs it. Do not invent an invoice issuance fee when issuance only creates a database record and predicts an address. Conversely, do not silently fund a service at issuance and recover its cost at collection or through the software subscription. Later collection costs must be explained before issuing an invoice, with a fresh quote or explicit standing authorization when collection occurs.

## Required customer flow

For the example of a customer holding 105 USDC and paying a 100 USDC invoice:

| Item                               | Amount   | Paid by / received by               |
| ---------------------------------- | -------- | ----------------------------------- |
| Invoice payment                    | 100 USDC | Customer's Safe / beneficiary       |
| Quoted execution costs             | 5 USDC   | Customer's Safe / execution service |
| Total customer debit               | 105 USDC | Customer's Safe                     |
| Execution cost charged to Disburse | 0        | None                                |

The 5 USDC is an illustrative quote. The amount left in a wallet must never determine the fee. Show the exact beneficiary amount and the complete service quote before requesting approval. If the quote sets a maximum rather than a fixed price, show that distinction and reconcile any unused amount back to the customer's balance.

The service quote must cover network gas and every execution-provider charge. No separate execution charge may later be billed to Disburse. The beneficiary receives the full approved amount. Paying service fees in another supported stablecoin must never change the beneficiary's saved payment currency.

The customer signs using their existing Safe authority. Disburse must not take custody, hold an execution private key or become a required funder. Single payments, batches and scheduled or delegated payments must preserve their approval and spending controls.

## Provider acceptance

Before declaring any service provider suitable, verify both its technical behavior and its billing terms:

1. Customer stablecoins pay all service costs directly to the service. Disburse has no service balance or provider subscription/usage bill.
2. Quotes identify the chain, fee token, full recipient amounts, complete fee and maximum authorized debit.
3. The provider supports the relevant Safe configuration, approvals and payment schedules without changing a saved authorization.
4. Insufficient funds, expired quotes, rejection, execution failure and interrupted responses have defined outcomes. None can fall back to billing Disburse or automatically replay a payment.
5. Receipt reconciliation independently verifies recipient transfers and actual fees, including refunds when applicable.
6. Supported token and chain combinations are explicit. A USDC-only service does not establish support for paying fees in USDT or other stablecoins.
7. Original account creation works from MetaMask with supported stablecoins and zero native tokens. Additional accounts, service setup and provider onboarding cannot introduce a hidden native-token prerequisite.

The implemented owner execution route combines Circle Paymaster with Candide's public bundler. The public endpoint has no application account, key or billing relationship. Its rate limits are an availability constraint, not an implied Disburse API bill. No paid or sponsored fallback is configured. See the [provider review](GELATO_V2_SETUP.md).

## Current implementation status

The requirements remain broader than the completed work. The September 7 pass now includes:

- Owner-authorized payments, policy changes and signed cancellations use separately approved Circle USDC fees. Exact original Safe transaction signatures are preserved, with current direct/nested owner quorum required for both fee and operation approval.
- Existing accounts have an in-app fee setup path: exact published module/handler changes, current direct/nested owner approvals, customer-paid MetaMask completion and canonical/background recovery. Custom handlers are held for review. This path still needs mainnet wallet acceptance.
- Additional company accounts deploy with the parent Safe as their owner. The parent pays setup in USDC. Canonical deployment evidence and current authority are checked before the child is linked.
- Receiving-factory setup, invoice collection and subscription checkout use the same customer-paid execution flow. Invoice principal and license price remain separate from execution costs. Live testnet evidence covers invoice setup/collection, child-account creation and exact-price Team subscription activation.
- Original onboarding uses MetaMask's documented gas-included dapp transaction route on Base and Arbitrum. It prepares one atomic Safe deployment/deposit batch. The customer selects USDC and reviews the wallet's fee in MetaMask; EIP-5792 does not let the app force that selection. Testnet support is not claimed. Live zero-ETH onboarding acceptance remains open.
- Onboarding persists the wallet request before prompting, restores rejected/interrupted steps and verifies the full deposit and account authority. Background recovery finds the exact deployment with the browser closed. An earlier failed receipt cannot unlock a later pending attempt.
- App-funded Turbo and outgoing Resend submission remain disabled regardless of credentials. Invitations use private links. Existing recovery records are retained.

Owner-approved schedules now dispatch the exact saved request automatically, use independent execution sequences and support USDC-paid on-chain cancellation. Sending a later-created payment first and cancelling the other before its due date both passed live Base Sepolia acceptance. Delegated stablecoin-fee execution now uses an assigned member-owned payment Safe, with exact batch amounts, separately charged USDC gas and on-chain cancellation. See [delegated payment acceptance](DELEGATED_PAYMENTS.md). Broader conversion/yield integrations remain implementation work. A direct Circle execution from the published customer-owned Nexus account succeeded on testnet, and a read-only validator check confirmed exact transaction/time-window binding. That Nexus experiment is protocol research; completed Safe-based delegated and scheduled acceptance is recorded separately.

See [the implementation TODO](../TODOS.md) and [QA evidence](CUSTOMER_PAID_SERVICES_QA_2026-09-07.md). Native-gas tests, browser fixtures and a provider quote do not substitute for actual stablecoin-paid settlement.
