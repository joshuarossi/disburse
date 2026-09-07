# Spending policy approvals

Implemented September 6, 2026, local time. Administrators request an allowance or revocation in Team & approvals. Account approvers review the member, currency, limit, reset interval and execution fee, then sign in Disburse. Direct owners and nested owning accounts use the same signature model as payments.

## Authority and state

An app administrator can request a change without being an account signer. Execution still requires the current Safe approval threshold, including the complete threshold of each contributing parent account. One owner of a two-approval account can receive an independent allowance. A wallet that can already meet the account threshold by itself cannot be presented as restricted by an allowance.

New grants require an active account, a current requesting administrator, an active payment-enabled delegate. Subscription expiry does not block grants or revocations. These checks run again before signatures are saved and before execution. Revocation does not require active delegate membership or an active app account. Archived accounts remain selectable for inspection and revocation.

The server constructs exact calls to the pinned allowance module, including any necessary module/delegate activation. Disabled modules with dormant allowances cannot be reactivated through a new grant. New grants use the pinned 1.0.0 release; supported legacy modules remain available for revocation. The previous limit and reset interval are bound to review. Ordinary spending within an interval does not invalidate an approved limit change. Updating a limit retains the interval's accumulated spending; the contract's normal timed resets still apply. [Safe's versioned allowance implementation](https://github.com/safe-fndn/safe-modules/blob/allowances/v1.0.0/modules/allowances/contracts/AllowanceModule.sol).

Allowances permit transfers to any destination. Disburse's beneficiary directory and app payment limits do not become contract restrictions. Removing a member or archiving an account does not revoke contract authority. The request form requires explicit acknowledgment of this distinction.

## Persistence, fees and recovery

`spendingPolicyChanges` stores immutable requests and their execution state. `accountProposals` and `accountSignatures` are shared with payments. Their common account/nonce index prevents a policy request and payment from reserving the same account transaction number. Parent signatures use SafeMessage and become a contract signature only after the parent threshold is verified. The root Safe checks those signatures before execution.

The execution method is selected before the request. A managed fee binds its exact token contract, collector and amount to the signed transaction. It uses the existing Gelato adapter with transport retries disabled. Native execution reserves an attempt and block checkpoint before asking the wallet to send. A reported wallet decline permits retry of the same signed intent. An unknown response retains independent chain reconciliation and does not trigger another provider submission.

Confirmed Safe/SafeL2 execution and the original intent hash determine whether a policy was applied. Managed execution additionally requires the exact approved fee transfer. Wallet/provider hashes are candidates, not proof. Recovery continues after the browser closes. The UI retains the original request and offers a confirmation check. Policy history includes receipt links and application dates.

Signed payment and reserved policy cancellation is now implemented in-app. It keeps the original evidence and budget until verified nonce replacement, and reconciles the original if it completes first. See [account cancellation](ACCOUNT_CANCELLATIONS.md).

## Acceptance and cleanup

Seventeen backend stories cover direct/nested thresholds, current contract-signature verification, forged signatures and payloads, concurrent nonce allocation, request retries, membership/expiry/archive boundaries, dormant grants, fee consent, wallet rejection, lost provider responses and exact settlement. Browser stories cover both themes, mobile layout, fee choice, blocked reviews, parent paths, archived-account revocation and keyboard navigation.

`scripts/qa-browser-policies.mjs` uses two isolated host-held Sepolia wallets against the actual built app and development backend. It requests a 0.000002 USDC allowance for one human owner of a nested Payroll account, declines the first approval, reloads, collects both Treasury approvals, declines the native send, reloads and sends the original intent. It then requests and approves revocation through both wallets.

- Grant: [confirmed Sepolia transaction](https://sepolia.etherscan.io/tx/0x1bbf856e474981ad104503e94eab1eb8fa3d76ce54c78def5a3766dfc5297dcd).
- Revocation: [confirmed Sepolia transaction](https://sepolia.etherscan.io/tx/0xd46ac2be6f4477bba99c489f8c65f83cb02dff6fa42fc1c98aa4053b247297d4).
- The allowance is now zero. Payroll/Treasury USDC balances, Treasury native balance and Treasury transaction nonce were unchanged. Only the isolated sender paid Sepolia network fees.
- Evidence: `.local/qa/browser-policies-evidence.json`, `.local/qa/built-grant-policy-dark.png`, `.local/qa/built-revoke-policy-dark.png`, `.local/qa/built-policy-complete-light.png`. Keys are not available to page scripts. This is not evidence of browser-extension compatibility or live managed-provider settlement.

Removed the former Safe service policy queue, browser transaction proposal/POST/execution helpers, obsolete queue mocks and decoder/retry tests. Replaced those tests with the current server-authorized behavior. Protocol Kit remains only for account creation in the product. The API Kit dependency and four obsolete Safe-service QA runners were subsequently removed. Current payment, policy and cancellation runners exercise the built app. Historical signed payment evidence and recovery remain intact.

At this milestone, the complete type/lint/unit pass had 599 passing tests in 73 files. The full browser run passed 244 stories; subsequent keyboard/archive stories are additional targeted acceptance. The normal production build also passed. New work remains recorded separately in `TODOS.md`.
