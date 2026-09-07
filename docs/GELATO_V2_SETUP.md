# Set up Gelato for Disburse V2

Reviewed September 7, 2026. This guide describes the integration in this repository, using `@gelatocloud/gasless` **0.0.12** and **Turbo Relayer**.

The old integration did support USDC fees. Commit `8623b0a` added it in February 2026 through `call-with-sync-fee`. Gelato has since retired SyncFee; its migration guidance requires applications to collect their own approved fee with the new transport. V2 already implements that fee transfer. Reusing the old endpoint or simply enabling the browser flag does not configure the new service. [Gelato migration guidance](https://github.com/gelatodigital/gelato-migration-erc2271-syncfee).

## What the customer pays

For a payment of 100 USDC with a configured fee of 0.05 USDC, the customer approves a total debit of 100.05 USDC: 100 to the saved recipient and 0.05 to the configured collector. The transfers execute atomically. Recipient amounts are never reduced to pay fees, and Safe's gas-refund fields are zero to prevent a second refund.

The fee is currently a **fixed amount configured per network and currency**, not a live quote of exact execution gas. Choose and test it accordingly. Batches, network congestion and failed relay attempts can have different provider costs. Customer fee collection and the provider bill must be reconciled separately.

Gelato pays the network transaction's native gas and bills the project's Gas Tank. Customer fee collection does **not** automatically replenish that balance. The operator maintains the provider billing balance; customers do not need Gelato accounts. The app stores no operator signing key. Customers continue using their existing Safe accounts. [Gasless SDK and Turbo transport](https://github.com/gelatodigital/gasless).

## 1. Create the provider project and keys

In [Gelato](https://app.gelato.cloud/), select your organization and open **Paymaster & Bundler → API Keys**. Create separate mainnet and testnet keys. Activate the applicable policy and networks; authorize the actual execution targets used by your test. Owner payments target the customer's Safe. Delegated batches target the published MultiSendCallOnly contract and invoke the supported allowance module. A policy restricted to an unrelated example contract will reject those requests.

Fund the selected project's Gas Tank. Gelato's current key guide specifies USDC for mainnet funding and **Sepolia ETH for testnet funding**. This deposit is separate from the funds held in the customer's Safe. Check the dashboard's current deposit network and asset before funding. [Gelato key and Gas Tank guide](https://docs.gelato.cloud/paymaster-%26-bundler/how-to-guides/create-a-api-key).

## 2. Enable fee collection

Enable **Fee Collector** in Gelato organization settings. Copy the assigned collector address. Do not substitute a personal wallet: Disburse verifies the collector against the project's live capabilities before accepting managed payments.

Gelato currently documents fee aggregation on **Ethereum, Base and Ink**. Disburse supports Ethereum and Base; Ink is not configured in this application. Support for relaying a transaction on a chain does not establish support for collecting its fee token. Verify the exact project/network/token combination, especially testnets, Polygon and Arbitrum. Collected fees can be converted and withdrawn through Gelato's dashboard; arranging Gas Tank replenishment remains a separate task. [Fee collection, supported chains and withdrawals](https://docs.gelato.cloud/paymaster-%26-bundler/features/fee-aggregation).

## 3. Configure the Convex deployment

Use the **Convex dashboard → selected deployment → Settings → Environment Variables**. Add secrets there so they do not enter shell history or browser bundles. Development, preview and production deployments have separate configuration.

| Variable | Value |
| --- | --- |
| `GELATO_API_KEY` | Mainnet project API key |
| `GELATO_TESTNET_API_KEY` | Testnet project API key; test requests never fall back to the mainnet key |
| `GELATO_8453_FEE_COLLECTOR` | The collector supported for Base by this Gelato project |
| `GELATO_8453_FEE_USDC` | Positive whole-token decimal fee, such as `0.05` for an illustrative test |
| `GELATO_8453_FEE_USDT` | Optional, only if the project supports that token on Base |

For Ethereum replace `8453` with `1`. For Sepolia use `11155111`; for Base Sepolia use `84532`. Configure testnet collection only if the provider reports support. Never copy these secrets into `VITE_` variables or Cloudflare's public frontend configuration.

Use the token contract already configured in `shared/chains.ts`; a token with the same symbol at another address is not interchangeable. If a workspace charges fees in USDT, that chain needs both the USDT fee setting and provider support for the exact contract. Payment currency and fee currency remain independent.

## 4. Run the read-only preflight

Deploy this revision's backend, then run from the repository with your existing Convex operator login:

```sh
# Development deployment, if Sepolia fee collection is enabled by Gelato
bunx convex run relayExecutor:configurationCheck '{"chainId":11155111,"token":"USDC"}'

# Production deployment, Base
bunx convex run --prod relayExecutor:configurationCheck '{"chainId":8453,"token":"USDC"}'
```

`configurationCheck` is an internal action, available to deployment operators through the CLI/dashboard. It reads the deployed configuration, calls Gelato's capabilities and balance methods, and runs the same checks used before payment submission. It creates no payment, relay job or transaction. A successful result includes `status: "ready"` and the configured fee's amount, token contract and collector; it never returns the API key.

| Result | What to check |
| --- | --- |
| Managed payments are not configured | Missing key, collector or fee for this deployment/network/token |
| Service does not support this network and fee currency | Wrong collector, unsupported chain or unsupported token contract/decimals |
| Service needs billing attention | Empty Gas Tank for the selected project/environment |
| Service could not be reached | Key access, provider availability and project policy |

A successful preflight proves configuration and provider availability at that moment. It does not prove that a particular Safe transaction will be accepted or settled.

## 5. Enable the frontend

Set these **public build variables** in the relevant Cloudflare Pages environment:

```dotenv
VITE_GELATO_RELAY_ENABLED=true
VITE_GELATO_DEFAULT_FEE_TOKEN=USDC
VITE_GELATO_DEFAULT_FEE_MODE=stablecoin_preferred
```

Rebuild the frontend; Vite embeds these values at build time. Existing workspaces may have their own fee-currency setting in Settings. These defaults do not replace it. Unsupported combinations still fail the backend preflight.

Keep preview and production keys separate. Flipping the browser flag off is not a cancellation mechanism for already approved or queued payments. Their backend jobs and settlement checks remain active.

## 6. Verify actual payments

Use a supported test environment and a Safe with a small balance. If Gelato does not enable testnet fee collection for your project, wallet-paid Sepolia transactions can still validate the Safe flows, but they do not validate Turbo fee collection. A controlled mainnet acceptance payment then needs its own explicit approval.

1. Create a payment using a saved recipient. Confirm the recipient's currency and full amount, then the separate fee and collector.
2. Cancel a wallet confirmation. Verify that the draft/authorization remains recoverable and no new provider request is created. Retry the original payment.
3. Complete the required approvals and submit. Confirm the exact recipient transfer and separate collector transfer on-chain, and wait for Disburse to show verified settlement. Record the network hash and Gelato request ID.
4. Repeat with a batch. For delegated payments, grant sufficient allowance for every recipient and the fee; a different fee currency needs its own allowance.
5. Schedule an approved payment, close the browser and verify that the backend submits it when due.
6. Check an interrupted response through **Check settlement**. Do not create a replacement while its outcome is unknown. The stored request ID and signed authorization must remain unchanged.

At the configuration inspection for this review, neither the development nor production deployment had the new Gelato keys or per-chain fee settings, and production's frontend flag was disabled. No live Turbo/USDC settlement is claimed by this guide. The old successful SyncFee payments establish the earlier integration's behavior, not activation of this replacement.

See [managed execution and recovery](MANAGED_RELAY.md) for the implementation, and [the findings review](V2_FINDINGS_REVIEW.md) for the related fixes and test evidence.
