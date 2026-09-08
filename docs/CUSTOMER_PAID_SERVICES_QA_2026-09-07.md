# Customer-paid services: implementation and QA

Updated September 7, 2026. Owner payment execution, account changes, additional accounts, invoice receiving/collection and subscription checkout now have integrated customer-paid USDC execution. The complete v2 requirement is still open for MetaMask mainnet acceptance, delegated execution and unattended schedules. No Disburse-funded provider account was created or funded.

## Actual application receipts

These actions used the authenticated development application backend, persisted its approvals and execution requests, and reconciled canonical receipts. The signing wallet and company Safe had zero Base Sepolia ETH. The Safe paid Circle in canonical test USDC; Candide's public bundler received the signed operations without an account, API key or application gas balance.

| Story                    | Principal/result                                                  | Actual execution fee | Receipt                                                                                                               |
| ------------------------ | ----------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Owner payment            | Recipient received 0.10 USDC                                      | 0.015708 USDC        | [Payment](https://sepolia.basescan.org/tx/0xf27b85db8017c054ebe7184e3a674b9b73b837d581488f8863f58492a4c64f96)         |
| Signed cancellation      | Original payment authorization invalidated; no recipient transfer | 0.015167 USDC        | [Cancellation](https://sepolia.basescan.org/tx/0x1b5c77fa80c6f7b7a5766c1258211f6fb28248a8ff037aee8e932754e628f49d)    |
| Set up invoice receiving | Shared immutable factory deployed                                 | 0.025571 USDC        | [Factory setup](https://sepolia.basescan.org/tx/0x401798eb55ab77aad0f1cd7d4bb416ca7d84142d6715c9fa7f735a9a889c5106)   |
| Pay issued invoice       | Unique address received 0.10 USDC                                 | 0.015708 USDC        | [Invoice payment](https://sepolia.basescan.org/tx/0xc43712a1f8ddbd97c413a3f7edf61a4d419ea79f8048d2551646411decd7972c) |
| Collect invoice          | Full 0.10 USDC moved into company Safe; invoice address emptied   | 0.020242 USDC        | [Collection](https://sepolia.basescan.org/tx/0x420c1b58c2ae49e97090b2721f261547601dbe5152e7b6c928c52ef02afd776b)      |
| Team subscription        | Exact 50 USDC license payment applied to the Team plan            | 0.014584 USDC        | [Subscription](https://sepolia.basescan.org/tx/0x23199fc4cf35b57746ab89c059a4b7429b67342372ff5f7853697fbf45681ba8)    |
| Create Payroll account   | Child Safe deployed and linked with the parent Safe as its owner  | 0.019559 USDC        | [Company account](https://sepolia.basescan.org/tx/0x597c2beb0668d22201075c15a7382ecb8b4ec87d64bc538759b587145a7c188b) |

Invoice `mx7efa63pakqhcpbxt26gswhxs8dz107` used `0x02a757fc1706bfb68145d64ba0403a6a73706984`. The application reconciled 100000 received and 100000 forwarded base units. The child account is `0xea9dab22e7ee7e33bcf639f5c603b42b19d5df56`, controlled by parent `0x1d724C69fEB3C75Ed33511E3a09aF5b4D0377aB5`.

The subscription test used the unchanged Team price and a temporary testnet billing destination controlled by the QA wallet. Test funding used 40 Sepolia USDC through CCTP and an 8 USDC authorization from the Base Sepolia signing wallet. The source-chain CCTP preparation used previously authorized native test gas; it is not onboarding acceptance. The actual subscription transaction charged 50.014584 USDC from the Safe, activated the Team plan and used no native tokens in either Base Sepolia wallet.

Policy grants/revocations use the same approval and execution component, with dedicated backend/browser coverage. Their older native Sepolia receipts do not establish new live USDC-fee policy acceptance.

Application runners are `scripts/qa-circle-payment.mjs`, `qa-circle-receiving.mjs`, `qa-circle-account.mjs` and `qa-circle-billing.mjs`. They require the isolated development backend and Base Sepolia, keep private keys/session tokens out of output, persist a unique run before submission, and check existing requests with `--status`. Never reuse a paid run name to submit again.

## Approval, fees and recovery

The original Safe transaction remains unchanged. Its actual owner quorum approves the fee permit and then the exact SafeOp. Nested owners use the same current authority checks. A Circle operation cannot turn an allowance delegate into a Safe owner.

An account-wide reservation prevents overlapping unresolved requests across workspaces. The fee permit keeps the same cap while its token nonce remains unconsumed. The signed operation fixes chain, sender, call, nonce, gas terms and bounded validity. The server claims the original operation hash before making one provider submission request. An unknown response never permits an automatic duplicate send.

Reconciliation checks the exact EntryPoint operation, Circle fee result, canonical block and confirmation depth. It records failed execution fees independently of recipient settlement. Fee prefunding and refunds are matched by exact receipt/log identity. Late fee evidence preserves already-booked gross movements instead of adding a second net expense.

## Original account setup

New onboarding uses MetaMask's published atomic wallet-call interface for Safe deployment and the exact reviewed deposit on Base or Arbitrum. The customer chooses USDC and reviews the wallet's fee in MetaMask. The API cannot force the fee-token choice. MetaMask does not advertise gas-included transactions on testnets, so the new route has not been claimed as live-accepted from a zero-ETH wallet. [MetaMask gas-included transactions](https://support.metamask.io/manage-crypto/transactions/metamask-gas-station/).

The account installs the pinned Safe4337 module and handler at creation. Preflight checks the selected owner hierarchy before deployment and again before the wallet request. EIP-7702 signing wallets are recognized without treating arbitrary contracts as ordinary key owners. The final receipt must contain one matching deployment, the full reviewed deposit and the expected current authority/module.

The browser saves a claim before asking the backend to begin, saves its wallet phase before requesting the atomic batch, and preserves the same request on ambiguous errors. Lost database replies before the wallet prompt and lost rejection acknowledgments have separate recovery states. A completed setup is restored after a lost completion reply instead of inviting another deposit. Background recovery independently finds the predicted account's factory event when the browser is closed. It bounds scans, detects changed checkpoints and never sends a replacement transaction. An earlier failed receipt cannot release a newer pending attempt.

The prior Biconomy MEE route rejected canonical Base Sepolia USDC during token-slot detection, including an already funded-account attempt. Expired original requests were checked without finding matching fee/work operations. That provider route is retained only for existing setup recovery; no newer experimental version was substituted.

## Existing-account fee setup

Funding accounts now includes an Execution fee setup panel. An administrator prepares the exact module/handler change, and the current direct or nested owner quorum approves it. A member then completes the atomic request in MetaMask, choosing USDC and paying the one-time fee from their own wallet. Subsequent payments use the company Safe’s USDC. Disburse has no setup provider account or bill.

The setup only enables the pinned, published Safe4337 module and installs its matching signature handler. It accepts the standard Safe handler or an empty handler and refuses an unknown custom handler. It preserves owners and thresholds, reserves the shared Safe nonce, checks exact signatures and simulates the complete execution before claiming a wallet request. Unsigned setup can be discarded only when it cannot leave a gap below another queued transaction.

The saved batch survives rejection, lost database acknowledgments, unknown wallet responses and reload. Receipt recovery checks canonical Safe execution events and the fee configuration at that block. An unrelated failed transaction or an earlier failed receipt cannot release a newer attempt. Bounded background scans detect reorged checkpoints and close a setup replaced by another confirmed Safe transaction. Disconnecting the account cannot remove an unresolved request.

Sixteen backend lifecycle stories, four contract-configuration checks, four shared wallet-call checks and nine browser stories cover this path. Mobile dark rejection and desktop light completion were visually inspected with no overflow or accessibility violations. This is code/browser acceptance, not a claim that a mainnet MetaMask fee transaction was sent.

## Remaining execution research

A published Nexus account executed through Circle and Candide directly, without the failing Biconomy execution API. It deployed and returned 0.01 USDC to the company Safe, paying 0.009981 USDC. [Direct Nexus execution](https://sepolia.basescan.org/tx/0x827c7470dd84164849f9a6f36ed4a8161b210385df971ad1d2e3d7ff419a808a).

The counterfactual ERC-6492 envelope must be checked against the expected factory and initialization data and unwrapped before supplying its ERC-1271 permit to Circle. EntryPoint deploys the account before validating that permit. A separate read-only check against the deployed validator accepted the exact signed operation's validity window and rejected an altered call hash. The check reused an already consumed QA nonce, so it did not create a new spendable authorization.

This is protocol evidence only. No member fee account, funding policy, delegated adapter or unattended scheduling flow has been enabled from that experiment. Fee custody, withdrawal authority, accounting and nonce ordering still require application implementation.

## Failure and visual coverage

| Area                   | Checked behavior                                                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet confirmation    | Neutral cancellation; original form/approvals survive; nested RPC/SDK diagnostics do not spill into the page. Unknown errors do not count as rejection.                                                                                                                    |
| Existing-account setup | Direct/nested quorum, unknown handler, stale nonce, rejected simulation, duplicate claims, declined prompts, lost acknowledgments, failed receipt replay, external nonce consumption and browser-closed recovery.                                                          |
| Original setup         | Wrong wallet/network, unsupported batching, insufficient USDC, changed owner hierarchy, database interruption, local-storage failure, unknown submission, malformed wallet status, lost completion response and reorg recovery.                                            |
| Owner execution        | Fee/operation signatures use current direct/nested quorum, expired/stale intent cannot send, unknown submission retains its original hash, failed operation and actual fees remain visible.                                                                                |
| Receiving              | First deployment, existing factory reuse, full-principal collection, late funds on voided invoices, expired/changed requests and unavailable RPC.                                                                                                                          |
| Company accounts       | Exact parent-controlled deployment; concurrent requests, changed hierarchy, missing module and incomplete linking retain recovery.                                                                                                                                         |
| Subscription           | Immutable network/account/price, current approvals, failure/retry, confirmed transfer scoped to its UserOperation, replay rejection and durable activation recovery. Legacy transaction-wide recovery cannot reserve an ERC-4337 bundle ahead of its individual checkouts. |
| Transport              | Bounded timeouts/body size; invalid JSON-RPC IDs, malformed replies, rate limits, approval failures and provider liquidity errors have controlled messages. No paid or sponsored fallback.                                                                                 |
| Accounting             | Exact fee/prefund/refund identity; late evidence cannot double-book an expense.                                                                                                                                                                                            |
| Invitations            | Private links and manual copy work without a paid delivery service. A shared link does not verify the recipient's email inbox.                                                                                                                                             |

The full code check passed 1013 tests across 102 files, frontend/Convex typecheck and lint. The complete browser suite passed all 327 stories. The production build passes with existing deferred wallet/SDK chunk warnings. Mobile dark onboarding cancellation was visually inspected at 390px; it has a neutral notice, retained deposit and no horizontal overflow. Company-account creation was also inspected on mobile. Blocked browser storage no longer breaks theme initialization. Public invoice connection stalls show a reload action instead of an endless spinner; unavailable invoices never expose payment instructions. The light-theme sign-in icon is now legible. Legacy Gelato task lookup is internal, bounded and treated only as an untrusted receipt hint. Earlier light/dark payment, invitation and recovery inspections remain in the QA artifacts.

Browser fixtures establish controlled UI behavior. Real receipts establish only the exact chain stories recorded here. Neither proves every possible provider failure, all wallet extensions, mainnet onboarding, unattended payroll or external-ledger acceptance.

## Earlier protocol evidence

These tests used the published Safe 1.4.1, Safe4337Module 0.3.0, EntryPoint 0.7, Circle Paymaster and Candide's public bundler. The signing wallet and Safe had zero Base Sepolia ETH. Fees came from the Safe's canonical test USDC balance. No Circle/Candide account, API key, application gas balance or paid API plan was used.

| Story                                                 | Actual outcome                                                                                                                            | Customer fee                        | Receipt                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Deploy a prefunded counterfactual Safe and pay 1 USDC | Safe deployed; recipient received 1 USDC                                                                                                  | 0.011848 USDC                       | [Deployment and payment](https://sepolia.basescan.org/tx/0xb84aa79a7742d7a40f141d7cd93b158cfe0273cc91018af361d39e0847be5a33) |
| Attempt an unaffordable transfer                      | Simulation rejected it before submission; an explicitly forced QA attempt then mined with a failed UserOperation and no recipient payment | 0.005734 USDC for the mined failure | [Failed operation](https://sepolia.basescan.org/tx/0xd66b34a9d1e8f28cbd0e62b8e2e65a0abee24c96976ca8d00e49a2318b56b0d2)       |
| Pay again after that failure                          | Next nonce succeeded; recipient received 0.10 USDC; neither wallet required ETH                                                           | 0.006220 USDC                       | [Recovery payment](https://sepolia.basescan.org/tx/0xc1d4b07908a2c2a6c109de81304ed595616913a7fb2c699733e9f332927685ef)       |

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

## Work still required

1. Live original MetaMask setup with USDC and zero native tokens on a documented supported mainnet. No mainnet transaction has been signed or paid in this pass.
2. Delegated stablecoin-fee execution, preserving exact authority and recovery. Owner-approved scheduling is now implemented and live-verified below. Existing-account module installation is implemented; its real MetaMask mainnet acceptance remains with item 1.
3. A full multi-approver finance cycle, actual external-ledger import and accountant-led close.
4. Production capacity, restore/incident acceptance and independent contract review.
5. Broader optional yield/conversion integrations and remaining receivable follow-ons listed in [TODOS.md](../TODOS.md).

## September 8 continuation

A second real Team checkout paid 50 USDC and 0.014584 USDC in gas, extending the existing paid-through date by exactly 30 days. Rechecking produced one billing payment and one extension. Both the owner and company account held zero ETH. Temporary development billing-recipient overrides were removed afterwards. [Renewal receipt](https://sepolia.basescan.org/tx/0xcde31709670b8df22309070d830139d349ac687722d622bb53e82ce737eea778). Pro upgrade credit still needs live acceptance at the actual plan price.

New execution requests have independent EntryPoint nonce sequences. Simultaneous requests retain one common approved fee ceiling, so a later request cannot increase an earlier authorization. Existing unresolved requests retain their original sequence and remain exclusive. The queue is bounded at 50 requests; cross-workspace account reservations remain exclusive.

After explicitly pushing the updated development backend, an app payment sent 0.10 USDC and paid 0.015708 USDC from its Safe using a nonzero nonce key. Both wallets held zero ETH. [Independent-sequence receipt](https://sepolia.basescan.org/tx/0x00c8c16adc3365e58de7cbd317152a53c6ac57a72c1b7274c5bbce62e71ec9e0). An earlier successful payment ran against old deployed code and is excluded from this queue acceptance evidence. Code generation alone did not update the running development backend.

The code check passed 1019 tests across 102 files, typecheck and lint. All 13 targeted Circle payment browser stories passed, including a draft that no longer waits on the retired fee provider. The previously completed full browser suite had 327 stories; the expanded full suite has not yet been rerun. Commit 95f8e5c passed both GitHub CI and Cloudflare Pages. Its immutable preview rendered sign-in in Chromium without page errors, and the light-theme page was visually inspected. Scheduling and delegated fee execution remain unfinished.

## Scheduled payment acceptance — September 8

Owner-approved payments can be scheduled up to 90 days ahead. Owners approve the exact recipient transfers, a USDC fee ceiling and a 24-hour execution window. Each request uses an independent EntryPoint sequence, so an earlier-created future payment cannot block a payment due sooner or consume the Safe’s normal transaction nonce. Scheduled funds are not reserved. The dispatcher rechecks account authority, current team access, recipient instructions, screening and funding before submitting the saved operation once. It stores no wallet key or session token.

The live Base Sepolia test created payment A first for 05:59:55 UTC, then payment B for 05:55:19 UTC. B sent **0.10 USDC** automatically while A stayed armed, charging **0.014892 USDC**. The network head initially lagged the approved start time; the dispatcher retried its preflight without submitting early. [Scheduled payment B](https://sepolia.basescan.org/tx/0x8eb54e1d08264ed9ba5c85f8b240b5843cd98e17ed825fa894b78990ce72cb82).

A was then cancelled using the same authorization sequence. Its on-chain cancellation cost **0.014685 USDC** and transferred no payment principal. A read-only check after its original due date found the request and payment still cancelled, with balances unchanged. The signing wallet and company Safe had zero ETH throughout; the Safe’s ordinary transaction nonce remained 6. [Cancellation of A](https://sepolia.basescan.org/tx/0x81686fa9728e66d63fecafc2098281b00ccca666ac8c0314e77d67f86200ea0f).

Discarding an unsigned instruction is free. Once an operation has any owner signatures, stopping the app’s dispatcher does not revoke its contract authority: the interface prepares a separately reviewed USDC-paid cancellation. It only marks the original authorization cancelled after canonical nonce-consumption evidence. Unknown submission responses retain the original hash and recovery checkpoint without a second automatic POST. Confirming a scheduled payment requires its exact principal transfers within that UserOperation’s logs, separately from Circle’s fee transfers.

The full check passed **1041 tests across 105 files**, frontend/backend typecheck and lint. The production build passed with existing deferred SDK chunk warnings. The full browser suite passed **334 stories** after a transient navigation interruption during editing was rerun successfully. Six scheduled-payment browser stories cover both themes, mobile layout, neutral wallet rejection, retained approvals after reload, unsigned discard, paid cancellation and insufficient funds. Visual review found and fixed low-contrast dark status text and mixed local/UTC dates. Controlled tests also cover batch-transfer evidence, changed instructions/permissions, early claims, missing approvals, expiry, unavailable providers and ambiguous submissions. They are not evidence for an actual live scheduled batch or every possible provider failure.

The prior commit `7abba0b` passed GitHub CI and Cloudflare Pages. Scheduled execution changes remain subject to their own hosted checks. Delegated stablecoin-fee execution remains unfinished.
