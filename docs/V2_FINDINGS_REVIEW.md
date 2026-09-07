# V2 correctness review

September 7, 2026. Reviewed against `5d581066c0d50b23064e0ac0c7db08c35ccf42f9`, the merged V2 release, and fixed on the follow-up branch. This report follows the numbering in the supplied review.

## 1. Delegated payments and reserved nonces

**Partly correct. The claim that declining the wallet prompt permanently prevents further delegated payments is incorrect.** The existing native recovery flow retries the exact original authorization after an explicit wallet rejection or a verified reverted transaction. It rechecks permissions, funds and the module before sending. Settlement advances the module nonce, so the next payment can use the next authorization.

The inability to discard an already signed allowance authorization is real. Deleting its database reservation would allow conflicting signatures for the same nonce. Safe's published AllowanceModule preserves that nonce when an allowance or delegate is removed. Restoring the grant can make the old signature usable again. There is no zero-amount nonce-invalidation operation. Revocation must not be represented as permanent cancellation of the signature. [Safe AllowanceModule source](https://github.com/safe-global/safe-modules/blob/main/modules/allowances/contracts/AllowanceModule.sol).

Changed `delegatedPayments.quote` to check all recipient and fee reservations **before requesting signatures**, with a link to the original payment in the same workspace. Claim checks the same reservations atomically. Reservations from a different workspace do not expose its payment ID.

The recovery test now follows decline → exact retry → verified receipt → new payment at the advanced nonce. Existing tests cover stale browser attempts, revoked/changed grants at authorization, reverted transactions, multiple recipient nonces and the fee nonce.

**Remaining product constraint:** a revoked or permanently unwanted signed authorization cannot simply be abandoned and replaced at the same nonce. Keep it revoked, or restore permission only if the original payment is still intended. Owner-approved payments and separately authorized delegates remain available. A future abandonment flow must invalidate every affected authorization on-chain and verify that outcome before unlocking it. This patch deliberately does not delete reservations or claim that such a flow exists.

## 2. Screening failures erase review decisions

**Confirmed and fixed.** An unavailable attempt is now recorded as a failed check while preserving the last successful evidence, decision ID and expiry when the recipient is unchanged. `lastError` prevents a prior clear/false-positive result from permitting block-mode payment during the outage. A successful recheck clears that error and retains an applicable review only if the identity and match evidence still agree.

A list activation during a scan now raises `SCREENING_DATASET_CHANGED`. The action queues an immediate scan against the current list, instead of replacing evidence with an unavailable result and waiting an hour. Other transient failures retry after one minute.

Tests cover both reviewed false positives and confirmed matches through an outage and unchanged list replacement, expired false-positive reviews, changed evidence, superseded attempts and retired-dataset rejection.

## 3. List updates block workspaces behind a 20/minute queue

**Confirmed and fixed.** The queue claims up to 100 due recipients per transaction, then schedules another drain after one second while a full page remains. Activation and organization re-screening start drains as they page through records. The minute cron remains a recovery mechanism. Claims move the due date before scheduling, so overlapping drains cannot claim the same recipient twice.

Current-list screening remains required in block mode. The change removes the artificial 20-per-minute platform ceiling; it does not promise an exact end-to-end completion time under provider or scheduler load. A regression verifies that the first 100 of 126 recipients are claimed, continuation is scheduled, and the remaining 26 are claimed without duplicating the first group.

## 4. Native Safe execution failure remains unresolved

**Confirmed and fixed.** Matching `ExecutionFailure` is useful for locating the original transaction, but its outcome must be interpreted separately. After confirmation depth is met, an `ExecutionFailure` emitted by the original Safe for the original Safe transaction hash now finalizes the payment as `failed`, retains the network transaction hash, stops automatic recovery and records an audit entry.

A receipt with missing transfers but no matching Safe failure remains unresolved. It is not evidence that nothing happened. Tests distinguish a genuine Safe failure from a forged event address and an insufficiently confirmed receipt, and ensure the failed intent cannot be resubmitted through the native start action.

## 5. Lowercase API payment currency

**Confirmed and fixed.** Both single and batch creation normalize the token once and reject assets unsupported on the selected network before storing a draft. Validation, saved payout constraints, spending limits, token address and audit metadata use that canonical symbol. List token filters normalize their input too.

Tests call both API entry points with ` usdc `, verify stored `USDC` and its configured contract, then verify that an unknown token creates no extra payment. Recipient currency constraints still apply.

## 6. Screening reviewer permissions and expiry

**Confirmed behavior; tightened and documented.** Screening decisions now require an administrator in both the UI capability query and the mutation. Being a payment approver alone does not allow clearing a hit.

False-positive clearances remain limited to the selected 7 or 30 days, with 30 days as the default. On expiry, they require review again. A confirmed match now remains confirmed through repeated checks with unchanged identity and match evidence even after that period. New evidence requires a new decision. An exact address listed on the selected network still cannot be dismissed as a name false positive.

This separates the approver role from screening clearance. It is not a full separation-of-duties system: an administrator may also be an account owner. Tests verify the approver denial and continued confirmed-match blocking.

## 7. Smaller findings

| Finding | Disposition and resulting behavior | Regression evidence |
| --- | --- | --- |
| `1.500 EUR` parsed as `1.5` | Fixed. A single comma or dot followed by three digits is treated as ambiguous; extraction leaves the amount for review. Unambiguous `1.234,56` still parses. | `invoiceExtraction.test.ts` |
| Phantom type changes for legacy recipients | Fixed. Missing stored type compares as the existing default, `individual`. An actual change to `business` remains a change. | `recipientImports.test.ts` |
| Negative reconciliation differences exported as text | Fixed. Explicit numeric CSV columns allow only strict signed decimal strings through unchanged. Formula-like values and ordinary text columns retain injection protection. | `csv.test.ts`, accounting browser stories |
| Archived recipient blocks draft editing | Fixed. The draft names the unavailable recipient and provides an explicit removal action. Other recipients and amounts remain intact. | `review-regressions.spec.ts` |
| Archived receiving account blocks invoice editing | Fixed. The editor retains the original invoice details and currency, explains the missing account and requires an active replacement before saving. Changing the account never silently changes the invoice currency. | `review-regressions.spec.ts` |
| Valid WebP files rejected | Fixed. Binary RIFF length bytes no longer pass through a UTF-8 decoder that can shift the `WEBP` offset. | A header containing multibyte UTF-8-like size bytes in `invoiceExtraction.test.ts` |
| Viewers can force deposit resync | Fixed. Forced refresh requires a record-editor role before any work is scheduled. Viewers can still read status and use the normal rate-limited refresh. | `depositSync.test.ts` |
| Missing Spanish/Portuguese documentation | Fixed. All ten documentation sections have content in both locales. Also corrected the English billing description: trial expiry returns to Free and does not block core payments. | Public-page browser checks and locale content review |

## 8. Release configuration

**Branch aliases:** the provider's 28-character limit is distinct from DNS's 63-character limit. The deploy script now limits the normalized branch alias to 28 characters and retains the immutable `CF_PAGES_URL` in the sign-in allowlist. The deployment test covers a long branch. Cloudflare's overview documents normalization but omits this length detail; the workers-sdk discussion records it. [Preview aliases](https://developers.cloudflare.com/pages/configuration/preview-deployments/#preview-aliases), [workers-sdk discussion](https://github.com/cloudflare/workers-sdk/discussions/13547).

**Vite environment mismatch:** confirmed and fixed. The standalone release check loads Vite's production environment files with process environment precedence. A build-only Vite hook also validates the resolved environment for the actual selected mode, so calling Vite directly cannot bypass that check. Tests cover `.env`, `.env.production`, `.env.production.local`, host overrides and browser-exposed secrets without printing secret values.

## Cleanup assessment

| Finding | Change or reason to retain it |
| --- | --- |
| Overview collects every document | Partly correct. Payments already had a 5,001-record bound. Recipient, bill and account reads now also have explicit bounds. A truncated overview identifies itself as partial and withholds available-to-spend estimates. It is not a replacement for full reports. |
| Payments list scans all history | Replaced with indexed, bounded database pagination and opaque continuation cursors. Counts describe the visible page. Sparse filters or recipient-name searches may require another page; an empty intermediate page explicitly says there is more history to check. Full-history exports remain in Reports. |
| Spending checks scan all history | Added creator/delegate indexes for creation and scheduled dates. Checks read the planned UTC month and deduplicate payments found through more than one index. Tests cover old history, next-month schedules and double counting. Work still grows with a member's activity within that month. |
| Unused approval helper | Removed `shared/safeApprovals.ts`; there were no importers. Current nested approval and signature verification remain covered by the account execution tests. |
| Unreachable form creation branch | Removed. New single-recipient and multi-recipient payments use the same grouped creation path; draft edits use their existing update action. |
| Duplicated cancellation/policy lifecycle | Extracted shared submission identity, immutable hashes/provider IDs and monotonic checkpoint logic into `accountChangeLifecycle.ts`. Domain authorization and finalization remain separate: cancelling a payment and applying a spending grant have different effects. Combining those effects into one generic lifecycle would obscure that distinction. |
| Three meanings of `writers` | Replaced ambiguous module-local tuples with named shared capabilities: readers, payment operators, record editors, recipient editors, accounting editors and screening reviewers. Existing memberships are preserved except the explicit screening-review restriction above. |

## Wallet cancellation cleanup

The Create Safe screenshot reproduced a product-copy problem: raw Viem request arguments, calldata and version diagnostics reached the user. A shared formatter now recognizes nested explicit rejection codes, provides short messages for pending confirmations and disconnected wallets, and filters technical diagnostics. Retry authorization still depends on explicit provider codes, not message text.

Account creation preserves form settings after rejection and shows a neutral cancellation notice. An ambiguous send response retains the predicted Safe address and directs recovery to linking it after confirmation. Approval, delegated payment, account-change, invoice collection, sign-in and billing errors use the same formatting where they interact with a wallet. Existing saved-submission recovery takes precedence over a generic retry message.

The visual pass also fixed mobile onboarding progress layout and light-theme contrast on its owner badge. Desktop light and mobile dark cancellation screenshots were inspected after exercising the flow twice.

## Verification and deployment scope

- `bun run check`: typecheck and lint passed; **677 unit/integration tests passed**.
- `bun run test:e2e`: **272 browser checks passed**, including five new cancellation and archived-record stories.
- `node --test scripts/check-release-config.test.mjs scripts/deploy.test.mjs`: **17 checks passed**.
- `bun run test:contracts`: receiving contract behavior and pinned artifacts passed.
- `bun run build`: passed. Existing large wallet/SDK chunk warnings remain.

Browser stories use the isolated QA services and wallet fixture. Backend tests exercise the real mutations and signed test identities with controlled provider/RPC responses. These results do not assert a new funded wallet payment or a live Gelato settlement. No customer funds were moved in this review.

The [Gelato setup guide](GELATO_V2_SETUP.md) gives exact environment names, provider funding steps and the new operator-only `relayExecutor:configurationCheck` command. Managed fees still need project configuration and live acceptance before enabling them in production. The signed-allowance abandonment constraint in item 1 remains explicit.
