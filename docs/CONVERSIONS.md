# Currency conversions

Implemented September 8, 2026. Accounts → Convert currencies exchanges supported currencies inside a company account. The customer chooses what to receive, reviews the paying currency and maximum debit, and approves the operation with the account's current owners. Beneficiary instructions and existing payments never change.

## Provider selection and costs

The adapter uses Uniswap V3 direct pools through the published **Universal Router 2.1.1** on Base and Arbitrum. This is the supported 2.1 release, including the fixes that superseded 2.1.0. It does not use the deprecated SwapRouter02 path. The additional V4 functionality in 2.2 is unnecessary for this V3 integration. [Router releases](https://github.com/Uniswap/universal-router/releases), [router overview](https://developers.uniswap.org/docs/protocols/universal-router/overview).

Base supports canonical USDC and the configured bridged USDT contract; Arbitrum supports native USDC and its configured USDT contract. Token addresses, decimals and networks identify assets, not symbols. Base Sepolia uses Circle test USDC and the distinct Aave test USDC solely for acceptance. The deployment manifest records the published factory, router, Permit2, quoter and their runtime hashes. The backend verifies those pins and the factory/pool relationships before quoting or preparing execution. Contract changes stop new requests until reviewed. [Published router addresses](https://github.com/Uniswap/universal-router/tree/main/deploy-addresses), [Base V3 deployment](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments), [Arbitrum V3 deployment](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-arbitrum-deployments).

Quotes use on-chain QuoterV2 calls through unbilled RPC endpoints. No Uniswap API account or billed quote service is required. Liquidity-provider fees are included in the paying amount. The separate execution uses Circle Paymaster and Candide's unbilled public bundler, funded entirely by the customer's USDC. The unused fee prefund returns to that same account. Disburse has no provider account, sponsor balance or execution bill, and adds no conversion fee. [Product and service boundary](PRODUCT_AND_SERVICE_REQUIREMENTS.md).

## Review and execution

1. Choose a company account, paying currency and exact amount to receive. View both balances and select a price tolerance of 0.1%, 0.5% or 1%.
2. Compare the eligible direct pools at 0.01%, 0.05% and 0.3% pool fees. The saved review identifies the selected pool, expected input, exact output, maximum input, price impact and ten-minute deadline.
3. Review the separate USDC execution fee limit. An account paying USDC must cover the maximum principal plus the fee prefund. An account receiving USDC still needs available fee USDC before the swap; expected proceeds cannot pay an upfront fee.
4. Each required owner approves the same saved fee and operation. Submit once. Background reconciliation continues after the browser closes.
5. The completed review shows actual input, exact output and the fee after refund, with a confirmed transaction link. A submitted request alone cannot complete a conversion.

Only direct pools with an input/output exchange rate between 0.98 and 1.02 and price impact of at most 1% are offered. This is a pair-rate restriction, **not a USD price oracle or protection against both assets losing value together**. A missing pool, insufficient liquidity, stale network state or out-of-range quote leaves the entered amount available for correction. Multi-hop routes and other assets remain outside the implemented scope.

The Safe executes one atomic batch: clear the token allowance, approve the exact maximum to Permit2, give the published router that same bounded amount until the deadline, execute the exact-output swap, and clear both Permit2 and token allowances. There is no unlimited approval, reusable external Permit2 signature, allow-revert command or partial fulfillment. The current router's six-argument V3 command encoding includes `minHopPriceX36`; the single-hop exact-output route is bounded by its maximum input. [Router command implementation](https://github.com/Uniswap/universal-router/blob/2.1.1/contracts/base/Dispatcher.sol).

## Recovery and accounting

Lending and conversions share the saved review, current owner authorization, fee, cancellation and recovery controls. An unsigned request can be stopped without a transaction fee. Once an operation authorization may exist, cancellation consumes the original authorization sequence through a separately approved USDC-funded operation. Unknown submission status retains the original request and prevents a second operation. An expired software subscription does not block recovery.

Settlement verifies the selected pool's Swap event and exactly matching input/output token transfers inside the original account operation. It checks the actual input against the approved ceiling and the output against the exact requested amount. Fee prefund/refund movements are reconciled independently; only the exact verified paymaster refund is excluded from conversion principal. Removed logs, another account, an unrelated operation, a changed amount or an extra transfer cannot complete the request.

Reports contain both currency movements and a separate fee source. Canonical chain, token, account, transaction and log identities deduplicate them against later Safe-history observations. The received and paid currencies remain separate even when both have a dollar reference.

Accounting uses a reviewed conversion clearing account: the paid leg releases the input asset's carrying value into clearing; the received leg recognizes the output asset, releases the reviewed clearing basis and records a reviewed difference when needed. Review both legs against the same clearing account and transfer reference, and ensure the released basis matches. The app does not automatically equate token units with USD book values or replace the external general ledger. Matching an already recorded transaction remains available. [Accounting reconciliation](ACCOUNTING_RECONCILIATION.md).

## Actual testnet evidence

The built application converted 0.050170 Circle test USDC into exactly 0.05 Aave test USDC on Base Sepolia. The separate fee was 0.019016 Circle test USDC. The owner wallet and company account both held zero native ETH. The first prompt was declined, the browser was reopened, approvals resumed, and the original request was submitted once. [Conversion receipt](https://sepolia.basescan.org/tx/0xaccf536191a61404348ee27635b91a1b085146e818300b7f80931faf3da920d8).

This acceptance exposed a receipt-checking error: the paymaster refund appears before the EntryPoint completion event and was initially counted as an unexpected principal transfer. The verified refund is now separated explicitly. Reconciliation completed the original transaction without another submission. The real receipt is a regression fixture; missing, altered or extra refund evidence must fail verification.

The reverse built-browser conversion paid 0.050133 Aave test USDC and received exactly 0.05 Circle test USDC. Its separate Circle USDC fee was 0.018838. Receipt-block balance deltas independently prove both the gross output and the fee: the net Circle USDC increase was 0.031162. ERC-20 and Permit2 allowances ended at zero; both native balances remained zero. This direction also declined and resumed approvals. [Reverse conversion receipt](https://sepolia.basescan.org/tx/0xf1437b1b788ffe1b39a360fbdcf701e0eeebe190b83a80db99a4918df96cb541).

The published test pool required isolated QA liquidity. A USDC-funded setup initialized its existing contract and provided 0.4 of each test asset, costing 0.028131 USDC. The Safe owns the resulting position. An earlier pool-creation attempt was not accepted by the public submission endpoint; its original authorization was invalidated on-chain for 0.014685 USDC before the smaller setup. No abandoned setup authorization remains executable. These setup costs and artificial test liquidity are not mainnet liquidity or pricing evidence. [Successful fixture setup](https://sepolia.basescan.org/tx/0xa650675fcb53f8577befb44bed8d6820e493b5bb53c00202d046edeb32bd0122), [earlier authorization cancellation](https://sepolia.basescan.org/tx/0xbdddba9900b60bf23fc5c4994d53f6d8f3acdca311781b2bf34e0bc546af9c45).

The journaled QA scripts refuse implicit replay, restrict execution to the development backend and Base Sepolia, and keep private approvals in ignored files. Public receipt fixtures contain no keys or reusable signatures. Browser stories cover both themes, mobile layout, rejected approvals, insufficient funds, missing liquidity, stale quotes, provider failure, lost submission replies and recovery. No mainnet funds were spent; mainnet and extension-wallet acceptance remain separate release work.
