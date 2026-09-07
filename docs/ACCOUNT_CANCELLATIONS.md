# Account cancellations

Implemented September 6, 2026. A signed payment or reserved policy request can be cancelled in Disburse using the funding account's current approval threshold, including nested owning accounts. An unsigned payment draft can still be withdrawn immediately without a network transaction.

## What the team sees

Open the payment or policy request, review its cancellation fee, and request approval. The original payment remains in its existing budget reservation while the cancellation collects approvals. Disburse blocks further approval, scheduling and submission of that original request. The cancellation remains visible after reload. It becomes confirmed only after its transaction receipt is verified.

The team can pay the cancellation fee from the account using the configured managed provider, or explicitly select native network fees from the sending wallet. The method, exact currency contract, collector and amount are bound to approval. A changed fee invalidates the review checkbox. No recipient payment is included in the cancellation.

Expired subscriptions and archived accounts retain cancellation access. A removed delegate does not prevent authorized account approvers from cancelling a pending grant. Cancelling a pending policy does not revoke an allowance that was already applied; applied allowances use the separate revocation flow.

## Transaction and persistence

The server constructs a zero-value CALL from the Safe to itself with empty data, using the original proposal's nonce. A managed fee adds only the reviewed token transfer in the verified batch contract. The root Safe checks the exact hash and current signatures before execution. This uses Safe's normal nonce replacement mechanism. [Safe cancellation documentation](https://help.safe.global/articles/3608612277-reject-and-delete-transactions).

`accountCancellations` references the immutable original `accountProposals` record. Cancellation approvals use the same `accountProposals` and `accountSignatures` tables as payments and policies. This replacement intentionally reserves the original nonce; ordinary requests cannot reuse it. Original proposal data, signatures and audit evidence are retained.

Policy creation currently reserves its account transaction immediately. Such a request requires account cancellation even if no signature has yet been saved. Deleting a database record is not proof that no signer holds an executable signature. Unsigned payment drafts have no reserved proposal and use free withdrawal.

Native execution reserves an actor-bound attempt before opening the wallet. Only an explicit wallet decline permits another send attempt for the same intent. Unknown responses trigger receipt lookup. The managed worker claims one submission and disables provider transport retries. A missing provider response does not cause a second submission.

Background recovery scans bounded confirmed blocks for both the cancellation hash and original hash. If the original succeeds first, its exact payment transfers or policy fee are verified and it is recorded as paid/applied. An original Safe ExecutionFailure consumes the nonce without claiming either change was applied. Cancellation receipts require two confirmations, the matching Safe/SafeL2 event, settlement block evidence and any exact fee transfer. An outer reverted transaction must match the reserved calldata before it can mark the attempt failed. Checks are bounded and can be resumed from the UI.

## Verification

Fifteen additional backend stories cover direct/nested signatures, original-signature replay, current authority, competing nonces, payment holds, original-versus-cancellation settlement, exact transfers, expired billing, archived accounts, changed roles, actor-bound retries, receipt evidence and lost managed responses. The existing seventeen policy stories continue to pass. Four browser stories cover mobile/dark and desktop/light review, fee selection, absent original-send controls, reload, retry and confirmed receipts.

`scripts/qa-browser-cancellations.mjs` exercised the actual built app and development backend with two isolated host-held Sepolia wallets. It created and signed a policy request, requested cancellation, declined/retried a cancellation signature, collected both parent approvals, declined/retried the native send after reload, and verified the receipt. Only the original account nonce was consumed. Payroll and parent USDC balances, parent native balance/nonce and the delegated allowance were unchanged. The allowance remained zero.

Receipt: [Sepolia cancellation](https://sepolia.etherscan.io/tx/0x18d51a9da81f841e37872d55689cbd32c7bb281afe98f92cee61bf6aac97136a). Local evidence is in `.local/qa/browser-cancellation-evidence.json`. This proves built-app native cancellation, not extension compatibility or live managed-provider settlement.

Removed the old signed-payment cancellation mutation behavior and the instruction to finish cancellation in the Safe interface. Policies and cancellations now share wallet approval controls, exact account-change validation and settlement lookup. Historical evidence remains intact.
