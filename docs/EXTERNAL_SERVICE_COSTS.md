# External service costs

Reviewed September 8, 2026. The license covers Disburse software. The customer pays transaction services directly in stablecoins. Disburse's operating costs are Convex and Cloudflare.

| Capability                                      | Implemented dependency                           | Who pays and what happens at a limit                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution from an existing account              | Circle Paymaster, Candide public bundler         | The customer Safe pays Circle in USDC. The public bundler has no application key, prepaid balance or operator usage bill. Throttled or interrupted requests retain the original signed request for reconciliation.         |
| Original account creation                       | MetaMask gas-included transactions               | The customer selects USDC and approves the wallet's fee. Disburse has no provider account. Unsupported wallets or networks cannot silently switch to app sponsorship. Live mainnet wallet acceptance is still outstanding. |
| Account history                                 | Safe API, free Builder plan                      | Authenticated free plan only on production networks. Hard quota, no automatic overages or upgrades. Saved entries remain available during a quota hold; an incomplete scan cannot appear complete.                         |
| Balances, simulations, receipts, archive checks | Public network RPC endpoints                     | Unbilled public access by default. Failures hold the operation or preserve recorded history. RPC overrides must also be unbilled; a paid operator RPC plan would violate this product configuration.                       |
| Invitations and recipient forms                 | Private links and Convex                         | No external delivery submission. Resend credentials cannot activate outgoing delivery. Historic delivery webhook verification and audit records remain readable.                                                           |
| Screening                                       | Official OFAC data, local matching in Convex     | No paid screening API. Outages retain evidence and reviewer decisions with visible freshness status.                                                                                                                       |
| Invoice extraction                              | Browser PDF/text parsing, private Convex storage | No external extraction bill. Scanned files can be entered manually.                                                                                                                                                        |
| Accounting and payroll interoperability         | Reviewed file import/export                      | No paid accounting or payroll connector is enabled.                                                                                                                                                                        |
| Yield and conversion                            | Pending provider integrations                    | No paid API, strategy or replacement service is activated by this inventory. Each new adapter must meet the same customer-cost rule.                                                                                       |

Circle documents a permissionless USDC paymaster without account or API registration. Its 10% gas surcharge is included in the customer's approved execution cap. Candide documents public mainnet and testnet endpoints with IP rate limits. The app does not substitute a paid dashboard endpoint when throttled. [Circle Paymaster](https://developers.circle.com/paymaster), [Candide public endpoints](https://docs.candide.dev/wallet/api/public-endpoints/).

## Account history configuration

Safe's Builder plan includes 50,000 requests per month and five requests per second for free. Production access requires authentication. The provider explicitly states that it has no automatic overages or plan upgrades. Quota exhaustion returns HTTP 429; it does not generate a bill. [Safe pricing](https://safe.global/api), [Safe quota behavior](https://docs.safe.global/core-api/api-authentication).

Select the actual free Builder plan in Safe's developer account. Set `SAFE_TX_SERVICE_API_KEY` and `SAFE_TX_SERVICE_PLAN=builder` in the Convex server environment. Keep the key out of browser configuration. Production history requests reject missing keys, paid plan names and keys without an explicit Builder declaration before sending a provider request. Public access is retained for isolated testnets only.

The declaration records the operator's selected plan. The application cannot infer a provider account's billing contract from its key, so changing that external account to a paid plan would invalidate this configuration. There is no automated plan change, credit card, top-up or paid fallback in Disburse.

This free quota is finite. Load and availability acceptance must measure it across all organizations before rollout. Do not evade it by creating multiple provider accounts. A later customer-paid indexing service would require a separate provider adapter and pricing agreement.

## Verification

Backend tests reject paid or undeclared Safe keys before any network call, retain recorded transfers and the unfinished cursor, and honor the provider's retry time on HTTP 429. Separate tests ensure that configured Turbo/Resend credentials cannot activate app-funded submissions. Existing public RPC outages, missing receipts, quote expiry and ambiguous bundler responses retain their recovery states.

See [the product requirements](PRODUCT_AND_SERVICE_REQUIREMENTS.md), [execution setup](GELATO_V2_SETUP.md), and [live receipt evidence](CUSTOMER_PAID_SERVICES_QA_2026-09-07.md).
