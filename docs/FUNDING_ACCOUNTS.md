# Company accounts and nested Safe ownership

Disburse accounts represent individual Safes on individual networks. Operations, Payroll and Reserves can coexist on the same network. Names are organization metadata; each Safe retains its actual balance, owner threshold and per-account allowance grants.

## Implemented account selection

- Connecting an account validates its supported Safe identity and a verified direct or nested approval path for the current user. Duplicate address/network links in one organization are rejected. Reconnecting an archived account restores its original database identity and history.
- The payment builder chooses an explicit funding account for each requested network. If more than one is available, the user must choose; saved recipient currencies and networks remain authoritative. The account's current balance, approval threshold and fee-inclusive debit appear before saving and in review.
- Payroll, grouped payments, individual legacy endpoints and bill preparation validate the account's organization, network and active state on the server. A legacy caller can omit the ID only if exactly one active account exists on that network.
- Recurring schedules save the original funding account. Legacy schedules recover it from their own last payment. A removed or unverifiable account pauses preparation; another account never takes over silently. Draft edits retain the original account unless explicitly changed.
- Accounts links carry the exact account into the payment builder. Payment history and exports retain its ID, name and address, including archived accounts. Unlinking Operations does not require pausing unrelated Payroll schedules.

Linking and naming accounts do not alter their ownership or spending grants. The acceptance scripts created separate, explicitly guarded Sepolia QA accounts; existing company accounts were not changed.

Verified September 6: six funding-account backend stories, updated Safe-linking tests and four browser stories; the complete named-account milestone passed 566 tests and 220 browser stories before the accounting additions. Operations-to-Payroll accounting now shares one movement identity across both locations; see [reconciliation](ACCOUNTING_RECONCILIATION.md).

## Nested ownership research

Safe supports using another Safe as an owner and gathering approval through its own owner threshold. This is useful for a central treasury approval group controlling operational accounts. The Safe help center describes the nested proposal and approval flow. [Safe nested accounts](https://help.safe.global/articles/5578582438-nested-safes).

The contract signature must be encoded and validated as a contract signature. Protocol Kit documents nested transaction signatures and the signing Safe address. A set of human signatures for an owning Safe cannot be substituted for direct owners of the paying Safe. [Safe transaction signatures](https://docs.safe.global/sdk/protocol-kit/guides/signatures/transactions).

A possible customer setup is:

- Treasury: finance leaders, two approvals required.
- Operations: a separate balance and payment history, with Treasury as a controlling owner.
- Payroll: a separate balance and payment history, with Treasury as a controlling owner and optionally bounded payment delegation.

The exact owners and thresholds determine whether Treasury approval is required. Merely including Treasury among several owners does not make its approval mandatory if other owners alone can meet the threshold. Allowance modules can separately authorize delegates, so their spending authority must be assessed alongside the owner path. This is an implementation inference from Safe's owner/threshold and signature rules.

Parent ownership does not pool balances. Transfers between company accounts are internal asset movements and need matching across both locations in accounting. Accounts on different networks still require separate approvals and, where needed, an explicit conversion or bridge operation.

## Implemented nested payment approvals

New payment approvals are stored in Disburse. `accountProposals` holds the exact server-built Safe transaction, account/network/nonce identity and original payment hash. `accountSignatures` holds each human signature, its complete account path and digest. One account nonce is reserved atomically across workspaces. A reload or interrupted save resumes the same intent; another currency, destination or fee cannot replace it.

Authority discovery reads each account at one chain checkpoint, pins supported Safe proxy/singleton code and the owning account's compatibility fallback handler, and rejects cycles, unavailable evidence and unsupported contract owners. Limits are three owning-account levels above the payer, 32 account nodes, 50 owners per account, 64 available paths and 500 persisted leaf signatures per payment. The actual thresholds remain authoritative. Including Treasury among several owners does not make it mandatory if another combination can meet the payer's threshold.

Humans approve the paying Safe transaction directly or the exact SafeMessage envelope of an owning Safe. The owning Safe's transaction nonce is not consumed: its signatures authorize a message bound to the paying Safe's nonce and transaction hash. Each complete parent threshold contributes one contract signature. Dynamic signature offsets are recomputed after owner sorting. Server verification calls the paying Safe's signature check before accepting a complete parent approval. Removed owners and obsolete paths remain in the evidence store but do not count toward current authority.

Native and managed payment execution use the same canonical transaction and assembled signatures. Contract approvals do not pool funds or cause a separate transfer from Treasury. The payment screen names both accounts, shows each threshold's progress and reviews the signing account before opening the wallet.

### Testnet and browser evidence

On September 6 (local time), a new two-owner Treasury and Treasury-owned Payroll account were deployed on Sepolia. One Treasury signature could not authorize Payroll; two did. Payroll sent exactly 0.000001 USDC. Treasury's USDC balance, native balance and transaction nonce remained unchanged. [First nested payment receipt](https://sepolia.etherscan.io/tx/0x10ab820ccd133b2be1aaff09abe944482b530019be35b7b6f0dbc25321486664).

A second payment used the actual built app with two isolated EIP-1193 wallets. Both signed in, the first declined its approval and resumed after reload, and the second completed the parent threshold on a mobile viewport. Declining the native send retained the original transaction; reloading offered Retry original payment. That retry settled exactly 0.000001 USDC once. [Built-browser payment receipt](https://sepolia.etherscan.io/tx/0x19aed0f1f233951a36b1ed3cd85c3c94d26d69c977bebf8d7ff04f12b4836074).

The scripts are `scripts/qa-account-approvals.mjs` and `scripts/qa-browser-payments.mjs`; evidence and screenshots stay in the ignored `.local/qa` directory. Wallet keys remain in the host test process, never the browser page. These are real backend/chain transactions through a scripted wallet provider, not a claim of manual extension-wallet acceptance. Native gas used test ETH. Live managed-fee settlement remains a separate acceptance item.

### Remaining authority work

Spending-policy requests now use the same persisted proposal/signature store and account/nonce reservation as payments. Direct and nested grants and revocations are implemented, with exact native or managed fee consent and durable recovery. A real built-browser Sepolia grant and revocation passed through two parent-account wallets. [Policy implementation and receipts](SPENDING_POLICY_APPROVALS.md). Arbitrary contract owners, unpinned handlers and unsupported account versions are not enabled by nested payment support.

Sources checked September 6, 2026: [Safe nested accounts](https://help.safe.global/articles/5578582438-nested-safes), [Safe transaction signatures](https://docs.safe.global/sdk/protocol-kit/guides/signatures/transactions), [CompatibilityFallbackHandler 1.4.1](https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/handler/CompatibilityFallbackHandler.sol).
