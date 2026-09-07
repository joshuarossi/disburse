# Delegated payments

Implemented and verified September 6, 2026, local time. A member with a current account allowance can authorize a payment in Disburse without collecting owner approvals for each transfer. Account owners approve the allowance itself through the [spending-policy flow](SPENDING_POLICY_APPROVALS.md).

## Payment and fee review

Managed execution remains the default. Its separate, exact stablecoin fee is included in the reviewed authorization and allowance check. The recipient receives the full requested amount. A member can explicitly choose native network fees, in which case the connected wallet pays gas and signs only the recipient transfers. There is no automatic fallback between these methods.

The server checks current membership, app limits, subscription, account identity, the pinned allowance module, available allowance, balance and reviewed recipient instructions before authorization and again before reserving execution. Each signature binds the account, module, token contract, recipient, exact amount and allowance nonce. Native mode rejects an extra fee authorization. Changing the fee method clears the current review and consent.

One canonical builder creates single and batch calls for both fee methods. A single native payment calls the allowance module directly. Batches and managed fees use the published MultiSendCallOnly contract after runtime verification. The complete call is simulated before execution. All transfers succeed atomically or revert together.

## Recovery

Native execution stores the original authorization and a block checkpoint before opening the wallet. The original delegate can resume after a reported wallet decline. An unknown wallet response keeps the payment in recovery; it does not authorize another broadcast.

Background reconciliation searches bounded allowance-module logs for the original transfers, verifies the complete receipt and requires two confirmations. It works without a returned wallet hash and with the browser closed. A linked hash is only a candidate receipt. A confirmed reverted transaction must match the exact saved call before retry becomes available, and the original intent is checked again before retry. A reverted transaction and a wallet decline have distinct records and UI messages.

Managed submissions continue through the existing durable relay queue. This pass did not establish live managed-provider settlement.

## Built-app acceptance

`scripts/qa-browser-delegated.mjs` ran against the actual built app and development backend with isolated host-held EIP-1193 wallets. It granted a small allowance through both owners of a nested account, declined the first transfer signature, reloaded, declined the first native send and reloaded again. It then sent the original authorization while deliberately returning an unknown wallet response. The browser closed before background reconciliation marked the payment Paid.

- [Payment receipt](https://sepolia.etherscan.io/tx/0x1abfc4405eb7c8981ce498044766288eada8c159dd49f07eb6f31d6d8b27bc85): exactly 0.000001 test USDC reached the reviewed recipient.
- [Allowance grant](https://sepolia.etherscan.io/tx/0x78a81c8bbfd00649435e669aea3d30bdea3e3da52293d577d99ccb79ce972fa8) and [revocation](https://sepolia.etherscan.io/tx/0x8066e9f681a2cfa4f9d67953c7957e2157e25552d250fe4ace0adcb5384f73b8): the test allowance is now zero.
- Temporary funding and the return payment reconciled exactly. Account, parent and recipient stablecoin balances returned to their starting values; the parent account's native balance and transaction nonce were unchanged.
- Local evidence is in `.local/qa/browser-delegated-evidence.json`, `built-delegated-recovery.png` and `built-delegated-paid.png`. Both screenshots were inspected. Private journals are not public deliverables.

Seven backend stories cover native preparation, batches, forged or extra fee signatures, changed grants, actor-bound retries, subscription expiry, missing-hash recovery and confirmed reverts. Six component tests and the native batch browser story cover fee choice and signature handling. The full check passed 622 tests in 73 files; the full browser suite passed 251 stories, followed by 18 targeted stories after recovery wording changes. These are built-app and testnet results. Extension/mobile connector compatibility remains separate acceptance.

## Refactor cleanup

`shared/delegatedAccountCall.ts` replaces the relay-only builder and the separate native single-transfer encoder. The schema and backend share one saved-intent validator. Policy and cancellation execution share account-call preparation, signature controls and receipt scanning. The four obsolete Safe-service QA runners and the unused API Kit dependency were removed; current runners exercise the built app. Existing signed payment evidence remains available for recovery.

The allowance contract permits transfers to any recipient outside Disburse. App beneficiary review and member limits do not restrict that contract authority. Owner authority and an allowance are separate controls.
