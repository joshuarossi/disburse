# Provider setup for customer-paid stablecoin gas

Reviewed September 7, 2026. **Do not fund a Disburse Gas Tank to enable this feature.** The customer must pay every execution cost directly in stablecoins from funds they control. This includes the execution service's charges. Application-funded gas, reimbursements and execution API bills charged to Disburse fail the [product-wide service requirements](PRODUCT_AND_SERVICE_REQUIREMENTS.md). The same requirements cover original Safe creation from MetaMask with stablecoins and zero native tokens, invoice creation and every other service.

## Correction to the previous setup instructions

The earlier SyncFee integration did allow USDC fee payments. The previous V2 code used Gelato Turbo with a separate fixed fee transfer and a project Gas Tank. That transport now rejects before any provider request, even if credentials are configured. That is an application-sponsored execution model, even when the app collects money from the customer. It does not satisfy the requirement and must not be described as a credentials-only launch task.

Gelato distinguishes Turbo's [sponsored Gas Tank payment method](https://docs.gelato.cloud/gasless-with-relay/gasless-transactions-evm/payment-methods) from its bundler's [user-paid ERC-20 payment method](https://docs.gelato.cloud/paymaster-%26-bundler/features/paymnet-methods). Its [ERC-20 integration guide](https://docs.gelato.cloud/paymaster-%26-bundler/how-to-guides/pay-with-erc20-tokens/pay-with-erc20) uses a third-party paymaster. Removing the Gas Tank balance check from Turbo would not change how that service bills transactions.

## Provider direction

Circle's permissionless Paymaster is the leading option for USDC fees. It charges the customer's smart account before execution and refunds excess after the actual cost is known. Circle maintains the native gas liquidity. No Circle developer account, API key, or application-funded gas balance is required. [Circle Paymaster](https://developers.circle.com/paymaster), [settlement events](https://developers.circle.com/paymaster/addresses-and-events).

Candide's public bundler has now submitted three Base Sepolia Safe operations using Circle Paymaster: successful deployment/payment, a mined failure charged in USDC, and a successful payment after that failure. No provider account, API key, application gas balance or paid API plan was supplied. This proves the protocol route on that testnet, not complete app integration or production throughput. The actual charges and receipts are in [the QA report](CUSTOMER_PAID_SERVICES_QA_2026-09-07.md). [Candide bundler documentation](https://docs.candide.dev/wallet/abstractionkit/bundler/).

The public endpoint is selected explicitly in `shared/circleTransport.ts`. There is no automatic paid endpoint or sponsored fallback. Candide documents public mainnet and testnet access without a key, with IP rate limiting, and recommends its dashboard URLs for production or higher limits. Its separate account plans include a 90-day mainnet trial and paid production subscriptions. Those subscriptions must not be charged to Disburse. The public route needs production-capacity acceptance; current test success does not establish an SLA. [Public endpoints](https://docs.candide.dev/wallet/api/public-endpoints/), [account pricing](https://docs.candide.dev/wallet/pricing/).

Pimlico's standard plan bills the API account for usage beyond its included credits. It therefore does not meet this requirement when that account belongs to Disburse. Its public endpoint is documented for testing and prototyping with a 20-request-per-minute limit per IP. A free quota is not evidence that production execution has no Disburse liability. [Pimlico pricing](https://www.pimlico.io/pricing), [public endpoint limits](https://docs.pimlico.io/references/bundler/public-endpoint).

Gelato's bundler supports third-party token paymasters, but its published compute-unit pricing also describes API usage billing. Its older public examples omit an API key when submitting token-paid operations; that alone does not establish a supported production route with no separate bill. A qualifying route needs current provider terms and a verified execution. [Gelato compute units](https://docs.gelato.cloud/pricing/compute-units), [Gelato bundler examples](https://github.com/gelatodigital/how-to-use-bundler-api-endpoints).

Pimlico and Candide also offer their own ERC-20 paymasters. The live route above uses Circle's paymaster, not Candide's token-paymaster API. Alternate paymasters require their own contract, pricing and failure review. In particular, Pimlico's current singleton paymaster documents fallback to the API account's balance if ERC-20 collection is bypassed. It must not be presented as a guarantee of zero application gas liability without resolving that behavior. [Pimlico singleton implementation](https://github.com/pimlicolabs/singleton-paymaster), [Candide token payment guide](https://docs.candide.dev/wallet/guides/pay-gas-in-erc20).

Biconomy's public MEE permit flow is implemented for initial funding from MetaMask. The published MEE 2.2.3 / Nexus 1.3.3 configuration quoted canonical Base Sepolia USDC but rejected execution during token-slot detection. Two expired attempts were checked on-chain without fee or work events. A subsequent test using the actual application quote/signing code and development database passed simulation, but the single live submission was again rejected. Application recovery confirmed expiry without a fee or deployment. Original onboarding therefore remains unverified. The newer experimental contracts have not been substituted. [Biconomy external-wallet integration](https://docs.biconomy.io/wallet-integrations/external-wallets/abstractjs), [contracts and audits](https://docs.biconomy.io/contracts-and-audits).

Relay's generic gasless-execution documentation requires a funded application balance. Its permit-based cross-chain flow may be relevant to later conversions, but the documentation says same-chain gasless swaps require sponsorship. It is not a verified replacement for ordinary customer-paid Safe execution. [Relay execution](https://docs.relay.link/features/gasless-execution), [Relay gasless swaps](https://docs.relay.link/features/gasless-swaps).

## Safe compatibility and work required

This is a change to the execution integration, not a replacement API key. The current flow stores ordinary Safe transaction and AllowanceModule signatures. ERC-4337 uses a separately signed operation and its own nonce. Existing Safes need a compatible module and fallback handler, installed with their owners' approval. Existing payment signatures must never be silently converted.

The pinned Safe4337Module 0.3.0 uses EntryPoint 0.7. Circle documents that version on Base and Arbitrum, including their Sepolia testnets. Circle's wider EntryPoint 0.8 network coverage must not be assumed compatible with the installed Safe module. Its paymaster accepts USDC; paying an invoice in USDT does not require changing the invoice currency, but USDC must cover its fee. [Safe module source](https://github.com/safe-global/safe-modules/blob/main/modules/4337/contracts/Safe4337Module.sol), [Circle addresses](https://developers.circle.com/paymaster/addresses-and-events).

Before enabling the replacement, verify:

1. Existing and new Safe account setup, owner thresholds and nested approvals. Original onboarding must work from stablecoins in MetaMask with zero native tokens and no existing Safe. A paymaster that requires funds in the new Safe does not by itself solve initial funding from MetaMask.
2. A reviewed maximum USDC fee bound in the signed authorization, with actual fees and refunds reconciled from receipts.
3. Single and batch payments without application gas funding, execution API billing to Disburse or reduced recipient amounts.
4. Future-dated execution, nonce ordering, cancellation and recovery without changing a saved authorization.
5. Delegated spending authority. An allowance delegate is not automatically a Safe4337 owner; do not bypass the existing limits or imply compatibility merely because ordinary owner payments work.
6. Rejected wallet confirmations, failed executions, interrupted provider responses, and insufficient customer USDC.

## What is needed from the operator

No Gas Tank deposit, personal wallet private key or paid execution API plan for Disburse. First select and verify a service whose complete execution charge is paid directly by the customer in stablecoins. If that service requires a credential solely for access, store it in Convex's server environment. Test funds belong in the customer's test Safe. A Circle paymaster key and a custom Gelato Fee Collector are not needed for the Circle route.

The old `relayExecutor:configurationCheck` now refuses the retired transport. It cannot activate Turbo through credentials. Stablecoin-only application execution remains unfinished; the existing native-wallet flows are legacy/testnet capabilities and do not satisfy this requirement.
