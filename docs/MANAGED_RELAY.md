# Customer-paid execution and historical relay recovery

Updated September 7, 2026. **The application-funded Gelato Turbo transport is disabled in code.** It rejects before creating a client or making a network request, even when old credentials remain configured. Configuring a Gas Tank, collector or fee reimbursement cannot enable it. Customers must pay the external execution service directly in stablecoins; Disburse cannot incur its gas or usage bill.

The deprecated SyncFee path has not been restored. Historical signed transactions, allowance reservations and relay jobs remain available for settlement recovery. No stored signature is translated into a new execution protocol.

## Replacement status

Circle Paymaster plus Candide's public bundler has completed three Base Sepolia operations with USDC fees taken from the customer's Safe: deployment plus a payment, a deliberately failed payment, and a successful payment after the failure. Both the Safe and its signing wallet held zero native ETH. No provider account, API key or Disburse funding was supplied. This establishes protocol execution, not full application integration or production capacity.

`shared/circleExecution.ts`, `circleTransport.ts` and `circleSettlement.ts` implement bounded operation encoding, submission error handling and exact receipt interpretation. The reproducible testnet runner is `scripts/qa-customer-fees.mjs`. The Safe application approval, scheduling, delegated spending, account-control, receivable collection and checkout flows still need the replacement integration. Circle's fee is USDC; it must never replace a beneficiary's chosen payment currency.

Original MetaMask-only onboarding uses a separately implemented Biconomy permit flow. Its Base Sepolia service accepts the quote but rejects submission during token-slot detection. That live failure remains open. A prefunded counterfactual Safe test does not close original onboarding.

See [provider findings](GELATO_V2_SETUP.md) and the [receipt and failure evidence](CUSTOMER_PAID_SERVICES_QA_2026-09-07.md).

## Historical execution records

The previous Turbo flow saved the exact Safe transaction, recipient transfers and a separate fixed collector transfer. Its fee was atomic with payment success, but Turbo billed a project Gas Tank. That financial arrangement fails the current requirements. It is documented here only to interpret existing authorizations and tests.

Historical jobs retain their original submission claim, calldata, provider identity and start block. A lost submission response never permits another economic payment. Recovery checks canonical chain evidence independently of provider status. Provider-status failure does not erase an execution or release an allowance reservation.

The least-recently-checked job rotation prevents an unresolved first page from starving later records. Failures before submission remain distinguishable from ambiguous submissions. The UI offers settlement checks for the original record and preserves signed approvals. A confirmed Safe `ExecutionFailure` is a failed payment; a receipt with no matching result remains unresolved.

## Delegated spending

Saved AllowanceModule authorizations retain their exact recipients, fee terms, nonces and global reservations. Revocation followed by regrant can revive an old authorization because the module preserves its nonce. Deleting a database reservation would therefore be unsafe. Recovery must finish or invalidate the original on-chain authorization before another payment can reuse its nonce.

An allowance delegate is not a Safe owner. A Circle owner-operation test does not establish delegated compatibility. Replacement execution must retain contract-enforced limits and cannot promote a delegate to an owner or rely only on app roles.

## Fee and failure behavior

The replacement must distinguish a quoted estimate, an authorized limit and an actual receipt charge. Circle charges USDC for a mined failed operation too. UI copy saying a fee is charged only when a payment succeeds applies to the historical atomic collector transfer and must not be reused for Circle. Pending submission, invalid signatures, expiry, insufficient fee balance, failed execution, refunds and RPC outages require separate outcomes.

Tests that mock the retired provider preserve historical recovery coverage. They are not evidence that the replacement works in the app. No production activation is implied by a green build or by the live testnet protocol receipts.
