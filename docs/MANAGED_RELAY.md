# Managed payment execution

For operator setup and a read-only check of deployed configuration, follow [Gelato V2 setup](GELATO_V2_SETUP.md).

Disburse uses Gelato Turbo Relayer through `@gelatocloud/gasless` 0.0.12. Gelato manages network submission and gas. Disburse does not run an operator wallet, store an operator private key, or allocate network transaction nonces.

The deprecated Safe Relay Kit and `call-with-sync-fee` submission paths have been removed. Existing legacy task-status lookup remains solely for historical records. Old signed SyncFee proposals cannot be converted without new owner approval.

## Payment and fee authorization

A configured, fixed service fee is displayed separately from recipient amounts before the wallet prompt. The customer approves the exact currency, amount and collector. That ERC-20 transfer is included in the same Safe MultiSend as the recipients. Safe gas refund fields are zero, preventing an additional Safe refund. The fee is charged only if the atomic payment succeeds. Changing fee currency never changes recipient currency.

The collector must match the managed Gelato project's live capabilities. Unsupported chains, unsupported fee tokens, missing credentials and an empty Gas Tank block submission. Provider availability is checked before the wallet prompt and again before creating a relay job. Production fee amounts are business configuration, not a claim to reimburse exact gas at execution time. Gelato bills the project's Gas Tank; fee collection does not imply automatic Gas Tank replenishment.

Fee collection is a separate provider capability from network relaying. Gelato documents aggregation on Ethereum, Base and Ink; testnet capability must be verified for the connected project. The app does not infer support from a network appearing in its token list. [Turbo quick start](https://docs.gelato.cloud/gasless-with-relay/gelato-turbo-relayer/quick-start), [fee aggregation](https://docs.gelato.cloud/paymaster-&-bundler/features/fee-aggregation).

## Server configuration

Store credentials only in Convex environment variables, never `VITE_` variables or browser storage:

- `GELATO_API_KEY`: production managed project.
- `GELATO_TESTNET_API_KEY`: isolated test project; testnet requests never use the production credential.
- `GELATO_<chainId>_FEE_COLLECTOR`: project collector returned by Gelato capabilities.
- `GELATO_<chainId>_FEE_USDC` / `GELATO_<chainId>_FEE_USDT`: approved fixed fee in whole-token decimal units.

The provider project must have a Gas Tank balance and fee collection enabled. Finance-team members do not configure provider accounts or hold native gas. Provider billing remains an application operating cost, like database hosting.

## Durable execution

1. Verify canonical Safe identity, exact recipients and fee, recomputed transaction hash, current owners, threshold and nonce.
2. Recheck subscription, screening, active creator permissions, creator limits and scheduled version in an atomic database mutation. Fee amounts count toward app spending limits. Members restricted to one currency must also pay their fee in that currency.
   Scheduled preflight retries every 30 seconds for a bounded hour while waiting for approvals, earlier account transactions or provider availability; cancellation and changed schedule versions invalidate these retries.
3. Save the exact Safe execution calldata in `relayJobs` and enqueue a backend worker.
4. Claim the provider submission once before the external request. Both SDK and HTTP submission retries are disabled.
5. Persist Gelato's request ID. A minute cron polls provider status; successful provider responses still require independent receipt verification and at least two confirmations.
6. If the request response is lost, inspect the original Safe hash for settlement. Never blindly send a second provider request. After the bounded recovery window, retain an exception and show the payment as needing investigation. The scoped exception query exposes no signed calldata or credentials.

This deliberately preserves an ambiguous result for investigation rather than declaring failure or creating a duplicate payment. Payment details provides a Check settlement action that preserves the original submission identity and never re-enables submission. Exceptions also appear in Needs review. Automated notifications remain separate work.

## Evidence and outstanding acceptance

September 5, 2026: typecheck, lint, 397 unit/integration tests and 130 browser checks passed. Tests include exact fee binding, full recipient settlement, fee-budget enforcement, duplicate claims, provider-ID immutability, interrupted responses, credential redaction and wallet-button gating. Build passed with existing large wallet-bundle warnings.

No Gelato credentials were configured in the development environment when inspected. Therefore no live Turbo Relay payment or unattended scheduled settlement has been claimed. The earlier funded Sepolia owner/delegate receipts exercise Safe and the database, not this new provider integration.

Before enabling a network: verify project capabilities and billing, make a small test payment, check the full recipient and fee-collector deltas, then execute a scheduled payment with the browser closed. Exercise cancellation, missing signatures, insufficient fee balance, provider rejection and lost responses. Public launch readiness still depends on this evidence and the other items in LAUNCH_READINESS.md.

Desktop light and mobile dark fee-review screenshots were inspected. The pass fixed totals wrapping mid-decimal on mobile and replaced the horizontally scrolling recipient review with cards showing complete amounts. Managed execution now covers owner-approved payments and delegated single and batch payments. The delegated browser flow discloses the number of signatures and signs recipient and fee authorizations; it no longer broadcasts a wallet-paid native-gas transaction. All authorizations execute through published MultiSendCallOnly, reserve their allowance nonces atomically and require exact recipient/fee receipt evidence. Provider interruptions are reconciled using the saved allowance event and starting block.

## Delegated stablecoin fees

The browser obtains a reviewed stablecoin fee and signs one allowance authorization per recipient, then one for the fee transfer to the managed collector. No native-gas wallet transaction is requested. If both use the same token, their nonces are consecutive and the available allowance must cover their combined amount. Different fee tokens require their own sufficient allowance. All recipient and fee nonces are reserved globally in one database mutation, preventing another draft from consuming the fee authorization.

The backend simulates the atomic batch before claiming it and queues the existing managed relay worker. A failed fee transfer reverts the recipient transfer too. Receipt verification requires every module event and every exact ERC-20 transfer; a provider success response alone cannot mark the payment paid. The legacy receipt-linking path also understands these batches.

Coding scope: provider configuration and deployment are separate operational tasks, not reasons to leave the implementation unfinished. The automated acceptance covers the provider boundary with controlled responses; no live provider settlement is asserted by these tests.

## Recovery behavior

The cron selects the least recently checked jobs within each status and rotates selected entries before scheduling work. This prevents the first 20 unresolved jobs from starving later payments. Provider status failures do not stop independent Safe proposal or allowance-event lookup.

Failures before the durable submission claim retain a prepared job for automatic retry. If preparation exhausts its retries, the stored exception records that no submission occurred. Resume payment accepts only that state, rechecks subscription, screening and spending policies, and atomically restores one prepared job. Once submission was claimed, only settlement checking is permitted. Both actions are audited. The Payments attention view exposes failed payments and uncertain submissions without exposing signed calldata.

Latest checks: 397 unit/integration tests and 130 browser checks passed, along with typecheck, lint and production build. These do not assert live provider settlement.
