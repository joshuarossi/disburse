# Customer-paid services: implementation and QA

September 7, 2026. **The complete requirement is not yet met. Do not release this as finished stablecoin-only execution.** Customer-paid USDC execution is proven on Base Sepolia. The remaining work includes its application integration and original onboarding, whose live provider submission currently fails. No Disburse-funded provider account was created or funded.

## Live execution evidence

These tests used the published Safe 1.4.1, Safe4337Module 0.3.0, EntryPoint 0.7, Circle Paymaster and Candide's public bundler. The signing wallet and Safe had zero Base Sepolia ETH. Fees came from the Safe's canonical test USDC balance. No Circle/Candide account, API key, application gas balance or paid API plan was used.

| Story | Actual outcome | Customer fee | Receipt |
| --- | --- | --- | --- |
| Deploy a prefunded counterfactual Safe and pay 1 USDC | Safe deployed; recipient received 1 USDC | 0.011848 USDC | [Deployment and payment](https://sepolia.basescan.org/tx/0xb84aa79a7742d7a40f141d7cd93b158cfe0273cc91018af361d39e0847be5a33) |
| Attempt an unaffordable transfer | Simulation rejected it before submission; an explicitly forced QA attempt then mined with a failed UserOperation and no recipient payment | 0.005734 USDC for the mined failure | [Failed operation](https://sepolia.basescan.org/tx/0xd66b34a9d1e8f28cbd0e62b8e2e65a0abee24c96976ca8d00e49a2318b56b0d2) |
| Pay again after that failure | Next nonce succeeded; recipient received 0.10 USDC; neither wallet required ETH | 0.006220 USDC | [Recovery payment](https://sepolia.basescan.org/tx/0xc1d4b07908a2c2a6c109de81304ed595616913a7fb2c699733e9f332927685ef) |

The failed operation sits inside a successful bundler transaction. Treating top-level receipt success as payment success would have been wrong. Settlement now interprets the exact EntryPoint result and Circle fee event, including the charge on failure. Missing, duplicate, removed or mismatched events are rejected. Canonical block and confirmation checks remain mandatory at the caller.

The counterfactual Safe was prefunded for these protocol tests. Its test funding used Circle CCTP and source-chain native gas. That preparation is **not** evidence for the original MetaMask-plus-stablecoins onboarding requirement. Total Circle execution fees for these three operations were 0.023802 USDC.

### Reproduce safely

`bun run qa:customer-fees` uses the existing private QA wallet file without printing its key. It only accepts Base Sepolia and verifies the supplied Safe's owner, threshold, module, fallback handler and zero native balances. The default is simulation only. A distinct run name and explicit `--execute` are required to submit. An existing run cannot be overwritten or submitted again.

```sh
bun run qa:customer-fees --run=my-unique-test --safe=<test-safe>
bun run qa:customer-fees --run=my-unique-paid-test --safe=<test-safe> --execute
bun run qa:customer-fees --run=my-unique-paid-test --status
```

The runner saves the original signed operation before its one submission request. Status checking reads the original hash on-chain; it does not resubmit. The force-failure flag is explicitly test-only and must not be copied into product execution. Public receipt fixtures reproduce operation hashes, signer recovery, failure classification and exact charged fees in unit tests.

## Original account setup

The new setup form reviews deposit, provider fee and total USDC debit before requesting a MetaMask permit. It no longer asks the connected wallet to broadcast a native-gas Safe deployment. The implementation validates the quote's complete operations, token, amount, payer, companion account, deployment calls, chain and expiry. Wallet and RPC identity, balance and permit nonce are rechecked around signing.

The exact operation is persisted before provider submission. An ambiguous response locks the original request until canonical chain evidence resolves it. Locks are shared across workspaces for the same payer/network. Reload restores owners, threshold and funding details. A payer can inspect an old operation after losing workspace access, but linking the resulting account still requires current administrator authority. Receipt scans use bounded checkpoints and reject conflicting or reorganized evidence.

New account creation now installs the released Safe4337Module 0.3.0 and its matching fallback handler, preserving the selected owners and threshold. The actual app configuration reproduces the address of the successfully tested Safe above. The backend checks the deployed module and handler before completing setup. Nested account approvals also recognize that handler only at its published address with the pinned, source-verified runtime hash. Missing, disabled or changed module code leaves the original setup recoverable.

The owner reader also recognizes the exact EIP-7702 delegation indicator as a key-controlled wallet. Previously, any code at an owner's address was treated as another Safe, so a wallet upgrade could prevent approvals. Eight regressions cover direct and nested owner paths, real ECDSA signatures, unrelated signers, ordinary contracts and malformed indicators. This does not trust signatures from an arbitrary delegated implementation or grant new wallet permissions. It is protocol-level compatibility coverage, not a claim that every MetaMask extension configuration has been tested. [EIP-7702 delegation indicator](https://eips.ethereum.org/EIPS/eip-7702#delegation-indicator).

The live Biconomy MEE 2.2.3 / Nexus 1.3.3 attempt quoted canonical Base Sepolia USDC successfully, then returned HTTP 400: `Failed to detect token slot. Please check your token overrides`. A fresh simulated quote failed the same way. After their full execution windows expired, canonical scans found no matching fee or work operations and no deployed target Safe. No Biconomy charge was found for either request. The UI does not turn that provider response alone into proof that a payment failed or a fee cannot settle.

This is an unresolved provider failure. The newer experimental MEE versions have not been substituted for the published audited configuration. Mainnet success is not inferred from these failed testnet requests.

A subsequent check used the application’s actual quote/signing implementation and the authenticated development backend. Simulation passed with a 1 USDC deposit and a 0.032347 USDC fee. The provider again rejected the single live submission. Its original request, `0xd182802d2529955a67467365dda4b372228cfa0cf7d63dfa6003e50f0e334995`, was persisted before that request and checked through the application’s recovery action. After the full signed window and canonical scan, the app marked it expired with no provider fee. The signing wallet retained its 11 USDC and zero Base Sepolia ETH; the target account had no deposit or deployment. No replacement request was submitted. This check exercises application persistence and recovery; it does not establish successful onboarding.

Use `bun run qa:customer-setup --run=<unique-name>` for simulation, add `--execute` for one testnet setup attempt, and use the same name with `--status` to check its original request. The runner refuses production, existing runs and native-funded test wallets. The first runner attempt stopped in its local wallet adapter before any provider submission; that adapter was corrected before the recorded request above.

## Failure and visual coverage

| Area | Checked behavior |
| --- | --- |
| Wallet confirmation | Explicit rejection is neutral, form state survives, retry uses the original draft. Nested RPC/SDK diagnostics do not spill into the page. Uncertain errors never count as cancellation. |
| Setup signing | Wrong account/network, changed permit nonce, insufficient USDC, stale quote, invalid provider response, failed signature recovery and disconnected wallet are rejected. |
| Setup recovery | Database failure before submission, interrupted provider response, reload with multiple owners, corrupt saved metadata, cross-workspace lock, expired request, failed reconciliation and failed account linking retain clear recovery actions. |
| Provider transport | Bounded timeout, malformed JSON-RPC, mismatched ID, null/array errors, rate limiting, invalid signatures, simulation failures, expiry and provider liquidity failure have controlled messages. Response streams are stopped at their byte limit, including a never-ending body or interrupted UTF-8. There is no paid/sponsored fallback. |
| Chain settlement | Failed UserOperation inside a successful bundle, altered hashes/senders/nonces, missing fees and contradictory logs cannot mark a payment paid. |
| Existing payment failure | Both native and historical relay recovery require the original Safe failure event, confirmation depth and canonical block evidence. A provider’s unverified hash cannot pin the payment to another receipt. Finalized failures keep their evidence, show “Payment failed” near the top of the dialog and offer a new draft instead of reusing the consumed authorization. |
| Invitations | Private sharing works without a delivery service; denied clipboard leaves manual copy available. The link does not confer email-verification status. Wrong wallet, expired/revoked invitation and failed revocation retain specific messages. |
| Provider billing | Old Gelato and Resend credentials cannot trigger a request through the retired adapters. Tests assert zero network calls. |

The latest full code check passed 859 tests across 89 files, typecheck and lint. The full browser suite passed 288 checks. The production build passed, with existing large on-demand wallet/SDK chunk warnings. Setup cancellation was visually inspected in desktop light and mobile dark. Private invitation manual-copy recovery, corrupt setup recovery and finalized payment failure were inspected on mobile; the historical relay failure view was also inspected on desktop.

Fixture browser stories establish UI behavior under controlled failures. The three network receipts establish the narrower protocol behavior above. Neither proves every possible external failure, all browser extensions, production throughput or full finance-team acceptance.

## Work still required

1. Resolve and repeat original setup from canonical USDC in MetaMask, with zero native tokens, no existing Safe and no application-funded service.
2. Integrate the working USDC execution protocol with in-app approvals. Ordinary Safe transaction signatures cannot become SafeOp signatures. Preserve thresholds, nested ownership, nonce ordering, cancellation, schedules and receipt recovery.
3. Preserve allowance delegation without granting owner authority. Resolve outstanding authorizations on-chain before releasing reservations.
4. Integrate account changes, additional accounts, invoice collection and subscription checkout. Do not leave a native-gas step hidden in these flows.
5. Finish fee authorization limits and accounting, including a mined failed operation's expense. A quoted estimate and an ERC-20 allowance are not automatically a strict signed per-operation fee cap.
6. Establish production provider availability and terms without a Disburse bill, then repeat the full browser-wallet workflow and unattended execution.

The broader v2 work remains in [TODOS.md](../TODOS.md); this pass does not close unbuilt conversion or yield integrations.
