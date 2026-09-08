# Provider setup for customer-paid stablecoin gas

Reviewed September 7, 2026. The implemented owner execution path uses Circle Paymaster and Candide's public bundler. Do not fund a Disburse Gas Tank or buy an execution API plan to enable it. The customer pays the execution service directly in USDC. This boundary covers setup, payments, account changes, invoices and subscription checkout.

## What to configure

No Circle or Candide credential is required for the integrated route. `shared/circleTransport.ts` selects `https://api.candide.dev/public/v3/<chainId>` explicitly, with no paid endpoint or sponsored fallback. Circle charges the customer's smart account and refunds unused prefunding. Its documented Base/Arbitrum surcharge is included in the on-chain fee calculation. [Circle Paymaster](https://developers.circle.com/paymaster).

The account uses published Safe 1.4.1, Safe4337Module 0.3.0 and EntryPoint 0.7. Supported application networks are Base, Arbitrum and Base Sepolia. Circle also publishes an Arbitrum Sepolia paymaster, but that alone does not add the missing network/token configuration to Disburse. Broader EntryPoint 0.8 network support is not interchangeable with the installed module. [Circle addresses](https://developers.circle.com/paymaster/addresses-and-events), [Safe module release](https://github.com/safe-global/safe-modules/tree/4337/v0.3.0).

For subscription collection, set `DISBURSE_BENEFICIARY_ADDRESS` to the license treasury and `DISBURSE_BENEFICIARY_CHAIN_ID` to a supported billing network in the target Convex deployment. These are license payment instructions. They do not sponsor execution. The customer chooses a company account on that same network, pays the exact license price and approves the separate USDC execution cost. Never reuse a test treasury in production.

Candide documents public mainnet and testnet access without an API key. It applies IP rate limits and recommends dashboard URLs for higher capacity. The selected public route has no application billing account or automatic overage charge. Rate-limit behavior and production capacity still need acceptance; that does not imply a hidden Disburse API bill. A separately purchased provider plan would need a customer-paid arrangement before integration. [Public endpoints](https://docs.candide.dev/wallet/api/public-endpoints/).

## Original MetaMask setup

New onboarding sends one atomic Safe deployment and optional USDC deposit through MetaMask's published EIP-5792 wallet interface. The customer reviews the wallet's complete fee and selects USDC in MetaMask. The app cannot force the gas-token choice through this interface. MetaMask documents gas-included dapp transactions on Base and Arbitrum, with Smart Transactions and Estimate balance changes enabled. Its documented network list excludes testnets. No Disburse/provider account or API key is introduced. [MetaMask gas-included transactions](https://support.metamask.io/manage-crypto/transactions/metamask-gas-station/), [wallet_sendCalls](https://docs.metamask.io/metamask-connect/evm/reference/json-rpc-api/wallet_sendCalls/).

The form, immutable batch, rejection/reload recovery and independent deployment/deposit checks are implemented. Live mainnet acceptance from MetaMask with zero ETH remains open. Testnet Circle payments from an already funded Safe do not establish this original onboarding story.

## Why the old Gelato setup was withdrawn

The original SyncFee integration charged customer tokens. The later Turbo adapter used an application Gas Tank alongside a fixed customer fee transfer. That still left Disburse paying the provider. The adapter now refuses new submissions even when old credentials are present. Removing its balance check would not fix its billing model.

Gelato's migration guidance retires `callWithSyncFee`; old how-to pages remain searchable. Turbo's sponsored service and a bundler using an external token paymaster are different integrations. Do not reactivate the retired adapter merely because an API key exists. [Gelato migration guidance](https://github.com/gelatodigital/gelato-migration-erc2271-syncfee), [Turbo payment methods](https://docs.gelato.cloud/gasless-with-relay/gasless-transactions-evm/payment-methods).

## Acceptance and remaining work

Actual application receipts now cover a payment, signed cancellation, receiving-factory deployment, full-principal invoice collection, parent-owned company-account creation and Team subscription activation. Each used customer USDC with zero native balances in the signing wallet and company Safe. Fee and operation approval preserve the current direct/nested owner quorum. The original signed payload is persisted before one submission request; unknown responses trigger reconciliation of that same hash. See the [QA report](CUSTOMER_PAID_SERVICES_QA_2026-09-07.md).

Existing Safes still need a complete customer-paid module-installation flow. Delegated payments cannot use an owner's SafeOp signature in place of the member's allowance authorization. Unattended scheduling also requires a separate implementation for time windows, fee limits and nonce ordering.

Biconomy's published MEE 2.2.3 route was tested with both canonical-USDC permits and an already funded Nexus account. Its execution endpoint rejected both with a token-slot-detection error. Old requests remain recoverable; that route is no longer offered for new onboarding. A direct Circle/Candide execution on the published Nexus account succeeded without the Biconomy service, and its validator accepted an exact bounded authorization while rejecting altered calldata in a read-only test. This is a candidate for the remaining execution work, not an integrated delegated-payment feature.

Relay's permit/solver routes were also investigated. No verified quote-to-signature binding and complete Safe execution was established, so no Relay adapter is enabled. Conversion/bridging research remains separate from the working owner payment route.

## Existing Safe accounts

Open **Settings → Funding accounts → Execution fee setup**. Check support, prepare the setup and collect the current owners’ approvals. The completing member uses MetaMask on Base or Arbitrum and selects USDC in the wallet’s Network fee field. The fee comes from that member’s connected wallet for this one-time change; subsequent payments use the company account’s USDC. No provider account, app key or app-funded balance is part of this flow.

The app verifies the released module/runtime and refuses an unknown custom signature handler. Pending requests, rejections and interrupted responses remain visible in the same panel. Check the original receipt before another paid attempt. Mainnet acceptance with the actual MetaMask service remains open; browser fixtures are not a live fee payment.
