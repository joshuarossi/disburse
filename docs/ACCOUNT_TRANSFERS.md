# Transfers between company accounts

Implemented September 8, 2026. Accounts → Transfers between accounts moves USDC between connected company accounts on different networks. Source and destination come from the account directory. Recipient payment instructions remain unchanged.

Business routes are Base ↔ Arbitrum. The isolated test route is Base Sepolia → Sepolia. Each source account needs the published Safe 4337 module used by customer-paid execution. The receiving account remains a customer-controlled Safe. New routes need contract, fee-service and settlement verification before being enabled.

## Customer workflow and charges

1. Choose the sending and receiving accounts and the minimum amount to receive.
2. Review the addresses, delivery fee and gross transfer amount. The quote lasts ten minutes.
3. Review the separate execution fee, including the maximum total account debit. Current account owners provide the required direct or nested approvals.
4. Submit once. The request progresses from Sending to On its way, then Received after both network receipts are verified. Closing the browser does not stop delivery checks.

Circle CCTP burns the gross amount on the sending network and mints the net amount to the receiving account. Its Forwarding Service charges delivery in USDC and submits the receiving transaction. Circle may spend the full selected delivery budget, including priority fees. Disburse does not promise a delivery-gas refund. The source execution uses Circle Paymaster and Candide's public bundler; its unused execution prefund is refunded separately. No Disburse provider key, sponsor balance or paid submission account participates. [Circle forwarding and fees](https://developers.circle.com/cctp/concepts/forwarding-service), [forwarding example](https://developers.circle.com/cctp/howtos/transfer-usdc-with-forwarding-service), [Candide public access](https://docs.candide.dev/wallet/api/public-endpoints/).

The adapter selects standard finality and the provider's high delivery estimate. Protocol fees, when quoted, are computed with integer arithmetic against the gross burn, rounded up. The reviewed maximum fee and minimum receipt remain fixed after approval. Fees are provider charges; no additional Disburse service fee is enabled.

## Authorization and recovery

- An administrator or approver can prepare a transfer between active accounts in the same company and activity environment. Safe ownership and current quorum still govern spending.
- The approved batch resets the USDC allowance, grants exactly the gross burn, calls the published CCTP messenger and resets the allowance again. Safe MultiSendCallOnly executes it atomically; no unlimited provider allowance remains.
- New quotes use Circle's documented single-hook format with a 160-bit request reference in its integrator field. Quote, source, destination, amount, fee cap, expiry and exact call bytes are bound together. Identical amounts sent between the same accounts still have distinct receipt identities. Historical composable-hook quotes retain their original bytes for recovery, but cannot receive new spending approvals.
- Proxy, implementation and minter runtime hashes are pinned. Network identity, domain, peer messenger and paused status are checked before a new approval or submission. A provider upgrade stops new transfers pending a code review.
- Request IDs recover a lost quote response. A company account can have one unsent transfer awaiting approval or source confirmation. After its source confirms, another distinct transfer can start while the original delivery remains tracked. History is paginated without dropping older records.
- An unsigned request can be stopped without a transaction. Once an operation approval may exist, cancellation consumes the original EntryPoint authorization sequence before releasing the request. An interrupted submission retains the original operation and cannot silently create a replacement.
- After a confirmed burn, stopping or refunding from the sending account is unavailable. Provider downtime leaves the funds in transit and preserves the sending receipt. Bounded background checks and explicit status checks continue without another burn.
- The provider's receiving transaction hash is a lookup hint. Completion requires the canonical CCTP message, the unique reference, the actual USDC mint, the fee cap and both settlement blocks. A missing or contradictory receipt cannot show Received.
- When the API omits its receipt or is unavailable, the app scans the receiving account's mint events in overlapping ranges of at most 1,000 blocks. It never advances past an unreadable receipt. An administrator or approver can also supply a receiving transaction hash. That only requests verification; it cannot change the amount, destination or payment status. Normal API 404 responses before a burn is observed remain pending.

Provider availability and contract governance remain external dependencies. Disburse cannot cancel an already burned transfer or accelerate Circle's finality and delivery process. Funds awaiting delivery must not be counted as an available receiving balance.

## Reconciliation

The sending account records the gross debit on its source settlement date. The receiving account records its net receipt on its own settlement date. They use a transfer clearing account in the customer's books. The retained delivery fee is an expense in the receiving journal, not an invented second debit from the receiving Safe. The separately charged source execution fee retains its own verified movement and review.

For example, using reviewed USD book values:

| Event | Debit | Credit |
| --- | --- | --- |
| Send 100.25 USDC | Transfer clearing 100.25 | Sending asset 100.25 |
| Receive 100.05 USDC; provider retains 0.20 | Receiving asset 100.05; delivery expense 0.20 | Transfer clearing 100.25 |

The example assumes the accountant has reviewed those carrying values. The app does not automatically value every USDC at one dollar. Actual token quantities, provider fees and functional-currency book values are separate fields. A receipt with a retained fee requires its reviewed book value and an expense account before a journal can be prepared. Both journals and their original movement references are exportable. [Accounting workflow](ACCOUNTING_RECONCILIATION.md).

The Safe history indexer may discover the same debit or mint before or after the direct receipt. Exact chain/account/token/log matching replaces those duplicate report projections atomically. The original movement identity prevents a second journal. Delivery never changes the already recorded gross debit or its accounting fingerprint.

## Verification

The local suite passed 1,129 tests across 111 files and 361 browser stories. TypeScript, ESLint and the production build passed. The build retains the existing deferred wallet SDK chunk-size warnings.

Browser stories cover both themes, mobile layouts, accessible dialogs, rejected approvals, lost quote/submission responses, reload, unsigned and signed cancellation, insufficient execution funds, failed/expired execution, unavailable delivery, unverified receipt entry, role restrictions and separate sending/receiving receipts. The completed screen shows the execution receipt and actual fee, without asking for approvals while loading a closed request.

Backend tests verify exact quote arithmetic, reference binding, provider-data rejection, canonical receipt matching, quote deadlines, source identity, cross-company denial, one saved request, approval cancellation, immutable settlement, paginated history, duplicate indexer projections and balanced clearing-account exports.

The live acceptance run uses the built app, the development backend and an injected EIP-1193 wallet whose key stays in the host process. It exercises real published contracts and USDC, while refusing every native-gas transaction. It does not establish MetaMask extension or mobile connector acceptance. The journaled script is `scripts/qa-circle-treasury.mjs`; it refuses to replay a submission attempt.

The successful forwarding run burned 3.016033 USDC from the company Safe on Base Sepolia, charged 0.017455 USDC for source execution after refund, and delivered exactly 1 USDC to its Sepolia Safe. Circle retained 2.016033 USDC for destination delivery. These are observed testnet charges, not production price estimates. The source owner and source Safe had zero native ETH. The browser was closed after submission, and no Disburse-funded provider account or service API key participated. Both canonical receipts and historical token balance changes were verified. [Sending receipt](https://sepolia.basescan.org/tx/0x0c3fc91697fd033bc68767f06cb4e40bb68723e7237c106cf42f956a6d4912ba), [Circle's receiving receipt](https://sepolia.etherscan.io/tx/0x04bd49874c96f66a58b1d3a464e8e02474cfd642e39c4697a3e326b6754951f8).

An earlier compatibility test used the composable hook described in Circle's concept guide. Sandbox issued its attestation without creating a forwarding job. That test exposed the need for the single-hook adapter and direct receiving-account reconciliation. Its 3.963648 USDC was recovered with a permissionless mint using 0.000160192767475080 of the test wallet's existing Sepolia ETH. This cleanup is not USDC-only forwarding acceptance. The app independently found the receipt without a Circle forwarding hash. New customer transfers use the successfully verified single-hook path. [Experimental sending receipt](https://sepolia.basescan.org/tx/0x708e6e0ba1d68048897d9f2644f4c5b2be20a41a38dab8308dd40902b585af9d), [test cleanup receipt](https://sepolia.etherscan.io/tx/0x07e2562fbe4842c9ff2f6029154a6db3bbd1719e9064f70f02ac2d04b576e59e).

Public receipt fixtures for both runs are committed under `src/lib/__tests__/fixtures/cctp-*.json`. They include no credentials or private keys. Regression tests check the actual protocol events and reject a different request or hook format.

This adapter implements USDC account bridging. Same-network token swaps remain separate work in the v2 program. The direct Aave provider integration is documented in [lending](LENDING.md).
