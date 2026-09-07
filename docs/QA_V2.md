# V2 QA and visual polish — September 5, 2026

The earlier claim that the application and visual pass was verified is withdrawn. User walkthroughs found payout-currency substitution and duplicate primary actions that the earlier tests missed. [The user story acceptance review](USER_STORY_QA.md) is the current source of acceptance status. Funded Sepolia batch, allowance, and backend invoice reconciliation tests have passed; they do not establish complete browser or launch acceptance.

## Current acceptance and runners

The latest complete code check passed 644 tests in 76 files, typecheck and lint. The full browser suite passed 267 stories. Built-app testnet runners now cover [payments](FUNDING_ACCOUNTS.md), [policy changes](SPENDING_POLICY_APPROVALS.md), [cancellation](ACCOUNT_CANCELLATIONS.md) and [delegated recovery](DELEGATED_PAYMENTS.md). [Database-backed billing recovery](BILLING_CHECKOUT.md) has backend, frontend and browser coverage; the actual built app also passed signed-in usage and disabled-checkout inspection. [Operator licensing](LICENSE_MANAGEMENT.md) also passed a real built-browser Pro grant, reload and restoration on the isolated QA company. No subscription receipt was created, and the temporary operator authorization was removed. See the [runner guide](../scripts/README.md) for current commands. The sections below record earlier milestones; their counts are historical.

## Verified results

### Accounting, page recovery and payment interruption pass, September 6, 2026

Validation at this milestone was **442 unit/integration tests in 54 files** and **150 Chromium checks**, with TypeScript, ESLint, normal production build and development backend synchronization passed. The final mobile recovery checks passed in both themes after the visual corrections. The normal built app was also checked in the signed-in browser, including Team's three sections and separate business/test Accounts and Reports. Large wallet/Safe chunk warnings remain.

A fresh **0.000001 test USDC** payment reconciled after the QA runner deliberately withheld the broadcast hash from Disburse. The backend found the original transaction, verified confirmations and full recipient value, marked the bill paid and included it only in test accounting. [Sepolia receipt](https://sepolia.etherscan.io/tx/0x7754db8a62227955b745241cee3a18c48ad51a63f9e1e45b3c7c679c75e88fd8). Gas used was 84,446, with a measured fee of 0.000173424517447760 test ETH. A rerun verified the same result without sending again.

The now-retired `qa-native-recovery.mjs` produced this evidence; its restricted local journal is `.local/qa/native-recovery-report.json`. Full story observations, code boundaries, screenshots and remaining gaps are in the [fix-pass report](READINESS_FIX_PASS_2026-09-06.md). This was SDK signing in an isolated development workspace, not browser-extension or live managed-provider acceptance. Contract sources did not change in this pass.

### Receivables and screening pass — September 6, 2026

Current validation: **418 unit/integration tests in 49 files**, TypeScript and ESLint passed. The full Chromium suite passed **141 checks**; the 11 receivable checks were rerun after the final mobile layout changes and passed. Contract behavior and pinned-artifact tests passed. Production build passed with the existing wallet/Safe bundle-size warnings. Empty-list screening failures in scheduled test jobs are expected negative-path output; they no longer produce a new clear result.

Real development-backend receivable acceptance used the isolated Sepolia wallet and Safe. An invoice for **0.010001 USDC** was issued with its own address, paid before receiving-contract deployment, recorded as paid, collected into the Safe in full, and rescanned without duplicate accounting. Provider acceptance alone never supplies paid/collected status.

| Operation | Transaction | Gas used | Actual Sepolia ETH fee |
| --- | --- | ---: | ---: |
| Shared factory deployment | [Deployment receipt](https://sepolia.etherscan.io/tx/0xb0caa4d9c468321a7004ec3b6bde1648e5776fc74fe612f91c86ddd8d332bf9e) | 579,774 | 0.000593076756731472 |
| Customer test payment | [Payment receipt](https://sepolia.etherscan.io/tx/0x15dcc2dbda4435345ed9566e31a018bdb507da15e008b43afcdd6d841ca5b2a1) | 62,147 | 0.000066707709736333 |
| First collection, including invoice-contract deployment | [Collection receipt](https://sepolia.etherscan.io/tx/0x6fe38445b89be1f845201197a1621b4a2b1951fcae6d48bef7fcf3c104187a1d) | 354,038 | 0.000373283569406840 |

Factory: `0xfec37f8a6de34536536fa9c4e4ec13e9ee2eb86c`. Receiving address: `0xc0adcdb40a4af60688d485d3daa7cdd62ad07b21`. Destination Safe: `0x17Fc8c99f7e823eB73b5325a0A7699f7e9c729c7`. Test-network fees are measured evidence, not mainnet price estimates. The repeat-collection contract behavior was tested locally; a second real funded collection is not claimed.

The signed-in browser also completed create draft → review exact six-decimal total → generate link → copy address → void in Disburse.Pro, using the clearly labelled test invoice `QA-INVOICE-FLOW-20260906`. Its unpaid/voided customer pages and the isolated paid customer page were inspected. The test invoice was voided after QA so it no longer requests payment. Both public themes were reviewed; eight saved fixture screenshots cover desktop, draft review and 320px mobile layouts. The mobile line table was replaced with stacked items after visual review found that horizontal scrolling obscured amounts. Final invoice creation/public-page behavior is exercised in `e2e/receivables.spec.ts`. Rerunning the real Sepolia script after the final backend update reconciled the same receipts without another broadcast.

Screenshots: `.local/qa/screenshots/{light,dark}-{receivables,invoice-review,customer-invoice,mobile-customer-invoice}.png`. The 5173 browser flow uses the real development backend; 5174 screenshots use read-only fixtures. The receiving contract is unaudited and production issuance remains gated. Live managed-provider collection, operational cost controls and accounting integration remain open in [the TODO](../TODOS.md).

The initial screening review found name-only coverage, an unguarded bulk action, cross-organization recipient lookups and empty-list false-clear behavior. Access and empty-list boundaries now have regression tests; labels state the actual name-only scope. Provider/address-screening expansion and dataset freshness/review semantics remain open in [the screening review](SCREENING_REVIEW.md).

### Earlier evidence

| Check | Result | Environment |
| --- | --- | --- |
| TypeScript and ESLint | Pass | Local application and Convex code |
| Unit/integration tests | 374 passed in 43 files | Vitest / Convex test harness |
| Browser checks | 116 passed | Chromium, actual workspace routes with read-only fixtures |
| Accessibility | 48 WCAG 2 A/AA and 2.1 AA automated scans passed | Light/dark pages, settings, dialogs, mobile report filters |
| Responsive layout | Pass at 320px; screenshots at 390px and 1440px | Page and dialog overflow checks |
| Keyboard dialog behavior | Pass | Focus stays within dialog and returns to trigger on close |
| Exact report export | Pass | `9007199254.740993 USDC` survives CSV export unchanged |
| Real backend smoke tests | 10 passed | Authenticated, isolated development workspace |
| Production build | Pass | Existing large wallet/Safe bundle warnings remain |
| Sepolia preflight | RPC and Circle USDC reads succeed | Chain ID 11155111; token decimals verified as 6 |
| Funded Safe / payment / delegation acceptance | Batch, invoice, signed delegate and revoke passed | Isolated funded Sepolia Safe; SDK signing, real backend |

Automated accessibility scans are regression coverage, not a full accessibility certification. Browser fixtures never sign or mutate the real database. Licensing stories simulate writes in an isolated browser store. The real backend checks use normal SIWE authentication; they do not bypass authorization.

## Defects fixed

- **Real wallet sign-in failed in the deployed Convex runtime.** Viem's signature recovery used a dynamic import that Convex rejected. Sign-in and Safe proposal verification now use a statically imported secp256k1 implementation. Valid, tampered, malformed, parity-format and raw-digest signatures have regression coverage. The fix was synced to the development deployment and verified by signing in with a fresh QA wallet.
- Report calculations converted decimal strings to floating-point numbers, and spending exports discarded four decimal places. Calculations now use integer base units, displays use the exact money formatter, and CSV exports retain full precision.
- Draft badges, report badges, plan labels, and dark helper text had insufficient contrast. Corrected the foreground/background combinations, including the mobile transaction cards.
- Organization name, fee preferences, funding-account fields, and report filters lacked accessible names. Connected their labels or supplied explicit accessible names.
- Dialog keyboard traversal could leave the dialog at its boundary. Added forward/reverse cycling and explicit focus restoration.
- Allowance proposals did not request the funding account's network before signing. They now request a network switch and surface a rejected switch without proposing a policy.
- Report filters were cramped on narrow screens. Date controls now stack on mobile; report headings/navigation use the workspace styling.

## Real development-backend checks

An isolated organization named **Disburse QA · Sepolia only** was created using a fresh QA identity. Existing organizations and their payments were not used for these tests.

1. A real SIWE signature creates a session for the correct wallet.
2. Reusing the signed nonce is rejected.
3. The authenticated member can access the isolated workspace.
4. An invalid session cannot read its membership list.
5. Bulk employee import accepts both complete and identity-only records.
6. An invoice retains `1.000001 USDC` exactly.
7. A duplicate vendor/invoice number is rejected.
8. A negative invoice amount is rejected.
9. An invalid beneficiary address is rejected.
10. Logout invalidates the session.

The runner logs out in a `finally` block. Public QA record IDs and outcomes are saved in `.local/qa/workspace-report.json`; session tokens are not persisted.

## Testnet evidence and remaining acceptance

QA wallet: `0x01585228489577cdCdbd5eBb822C7c439a2c564c`

Network: **Ethereum Sepolia**, chain ID `11155111`.

Currency: Circle test USDC, `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.

Funding received: **0.05 test ETH and 60 test USDC**. The wallet's private key is stored only in the ignored `.local/qa/wallet.json`, with mode `0600` inside a mode `0700` directory.

The checked-in `qa:testnet` runner refuses any RPC whose reported chain ID is not Sepolia. Its funded branch has run: it deployed an isolated one-owner Safe, funded it with 5 test USDC, paid two controlled recipients `1.000001` and `2.000002` USDC, waited for confirmations, and compared exact balance deltas. It journals transaction hashes for recovery. This is a network execution test, not complete app acceptance.

The remaining acceptance matrix is:

| Scenario | Required evidence |
| --- | --- |
| App Safe linking and batch payment | Successful link, saved proposal, owner signature, receipt, exact beneficiary balance deltas, executed database status |
| Multiple owners | Threshold enforced; insufficient signatures rejected; second owner approval enables execution |
| Bills | Payment receipt reconciles every linked invoice to paid; duplicate preparation rejected |
| Scheduled payment | Signed payment fires at its due time with the browser closed, once only |
| Recurring payment | Next occurrence is prepared; pause/edit invalidates stale scheduled jobs; approval remains explicit |
| Stablecoin gas | Actual fee quote and successful relay using the selected stablecoin, with fee debit reconciled |
| Contract allowance | Grant approved by owners; delegate spends within limit; excess rejected; revoke prevents further spending; reset-period behavior verified |
| Recovery | Rejected wallet request, insufficient funds, failed receipt, stale Safe nonce, and interrupted submission do not create duplicate payments |

The Gelato endpoint `https://api.gelato.digital/relays/v2` reset connections from this environment through both its SDK and curl. This establishes an environment/provider connectivity blocker, not a confirmed global outage. Stablecoin fee support and scheduled execution need a successful provider connection and actual transaction evidence. No fallback to a different payment or fee mode was performed.

## Reproduce

```sh
bun run check
bun run test:e2e
bun run build

# Start read-only visual fixture server in another terminal.
bun run dev:qa
bun run qa:screenshots

# Reads Sepolia; creates an isolated local QA key if absent.
bun run qa:testnet

# Real isolated development-backend checks; requires configured dev Convex env.
bun run qa:workspace

# Funded network smoke test, after funding the displayed QA address.
bun run qa:testnet --execute
```

Screenshots are saved under `.local/qa/screenshots/` (22 desktop/mobile images across both themes). Playwright retains failure traces under `test-results/`. No production deployment was performed.

## Funded Sepolia results

Funding received: 0.05 test ETH and 60 test USDC. The isolated Safe is `0x17Fc8c99f7e823eB73b5325a0A7699f7e9c729c7`.

- [Safe deployed](https://sepolia.etherscan.io/tx/0x465bb17ce22e7ae1a6149fd40319b9d9987986eec0daa5abbfffffc6af72633f).
- [Batch executed](https://sepolia.etherscan.io/tx/0x8ecfaae826304bb3e32463bb432bc3b761f154c4fc7ad7f37d10b8eb42b52728): exact balance increases of 1.000001 and 2.000002 USDC verified.
- [One USDC allowance granted](https://sepolia.etherscan.io/tx/0xc809f03d26ec993cc91811866f1ee24ab81d0cbb8690aabab87eb26b12f7107a).
- [Delegate spent 0.4 USDC](https://sepolia.etherscan.io/tx/0xced00341500689534c0d6332e34161d77e2b91b5177e14be023a875539d53165). Exact recipient delta and contract spending counter verified.
- A simulated attempt to spend 0.600001 USDC against the remaining 0.6 reverted.
- [Allowance revoked](https://sepolia.etherscan.io/tx/0xe6a3fc7ad7f4d71cd07efcddb93f4de1dce076c355da862c2acf2a928ec97d41). A subsequent simulated 0.000001 USDC transfer reverted, and the application's module snapshot no longer showed the grant.

The initial RPC rate-limited reads after deployment/funding. The runner resumed against PublicNode after verifying chain ID 11165111; saved receipts prevented repeating deployment or funding. The relay endpoint still reset connections when rechecked.

Repeat the allowance check using `QA_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com bun scripts/qa-allowance.mjs`. Completed runs return without submitting new transactions.

## Funded application lifecycle additions

- [Owner invoice settlement](https://sepolia.etherscan.io/tx/0xe0dccb9c0a104161cd98d61dfff166f387ed607ec8c671a7925c09eb3c4757a1): real backend linking, saved proposal, exact signature/intent verification, 1.000001 USDC payment and invoice Paid state.
- [Delegated invoice settlement](https://sepolia.etherscan.io/tx/0x6456c7e29bf27052a21eb9a4c92ecb2459c57ed2688e12f069d260885a01169b): real invitation acceptance, signed nonce reservation, 0.010001 USDC exact recipient delta, backend reconciliation and linked invoice Paid state. Replaying the signed authorization reverted.
- [Delegated test grant](https://sepolia.etherscan.io/tx/0x75b1d86a0411a54c3c39541717870513157df88eee1f0343c2205d8c5aea4aa3) and [revocation](https://sepolia.etherscan.io/tx/0x67bf17e617069984cce6b08f84f6f72a407246a73c56566134ab9bc9defd05e7): the app’s actual policy queue verified both proposed changes before script execution. The test allowance is revoked.

The retired `qa-funded-workspace.mjs` and `qa-two-owner-workspace.mjs` runners, plus `scripts/qa-delegated-workspace.mjs`, produced these historical results using isolated keys and normal authenticated backend operations. They do not establish browser wallet acceptance. The private QA reports are ignored and must not be published.

Visual inspection of `.local/qa/story-payment-approvals.png`, `story-import-mapping.png`, `story-policy-desktop.png`, and `story-delegated-payment.png` informed this pass. The policy view exposed raw amounts and excessive contract details; the delegated preview exposed an inconsistent fixture total. Both were corrected. Capture alone is not a visual pass.

Two-owner live backend acceptance passed: one signature was rejected, two were verified, and [0.000001 USDC settled the bill](https://sepolia.etherscan.io/tx/0x382a4bf90b9095f30846b5eb3fe2f9f6ae8a0394b56c0d983e3fd9fe27cd3887). [The original single-owner policy was restored](https://sepolia.etherscan.io/tx/0xd3f10265a5138ba62447fa87755f1002a818013cf0801041b5414927995df3f4). The first QA-script attempt failed before broadcast due to an SDK construction argument; cleanup invalidated that proposal, and its isolated database record was marked failed with the restoration receipt. The corrected second attempt passed. These were SDK signatures, not browser wallet prompts.

The deprecated SyncFee submission path has been replaced with managed Gelato Turbo Relayer, durable submission records and explicit owner-approved stablecoin fees. Live provider acceptance remains open because the development Gelato project is not connected. See MANAGED_RELAY.md.

Acceptance at this milestone: `bun run check` passed 374 tests/43 files plus typecheck/lint; `bun run test:e2e` passed 116 Chromium checks. `scripts/qa-safe-identity.mjs` passed against the development backend, verifying supported account identity, removed-owner handling and consumed-nonce readiness. Development functions were synchronized; production was not deployed.
