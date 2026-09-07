# Subscription checkout and recovery

An administrator selects a plan and reviews its price and payment destination. Before opening the wallet, Disburse saves that checkout in the database. The record fixes the organization, plan, chain, USDC contract, amount, destination and paying wallet. A later configuration change cannot redirect or reprice an existing request.

## One payment request

`billingCheckoutData.create` permits one active checkout per organization and reserves the paying wallet on that network across organizations. Another administrator can inspect and recover the same checkout. Only the original paying wallet can send it. A prepared checkout can be discarded before a wallet request is made.

`billingCheckoutActions.begin` checks the network, simulates the exact transfer and reads the wallet nonce. An atomic claim saves that nonce and a block checkpoint before returning the transaction to the browser. The wallet receives the server-built call with that exact nonce. A second caller cannot claim another send for the same checkout.

The browser also uses a Web Lock to coordinate tabs and saves a local recovery hint before requesting funds. Storage failures stop a new wallet request. Browser storage is not payment evidence; clearing it does not remove the database checkout.

## Uncertain wallet responses

A reported wallet decline releases its matching attempt. An unknown response keeps the checkout active and blocks another send. A returned hash is immutable once recorded. Closing the browser or letting the session or trial expire does not stop receipt recovery.

The background queue checks the saved hash, or searches canonical USDC transfer logs from the saved block checkpoint. Each candidate must match the original payer, nonce, token, destination, calldata and amount. The scan is bounded and overlaps block ranges; it never resubmits a payment. Public recovery checks can resume a paused scan.

Two confirmations are required. An exact confirmed revert releases the attempt. An unrelated reverted transaction cannot release it. If the wallet replaced the transaction, an administrator can provide that receipt. The server requires the same payer and consumed nonce with two confirmations. An identical replacement is applied as payment; a different confirmed replacement releases the cancelled request.

After verification, redemption and checkout completion are atomic. Repeated verification cannot add another paid period. The background action can finish a payment after the administrator's session or trial ends. Local hints for older already-paid transfers remain verifiable through the existing receipt flow.

## Verification and limits

Eight backend stories cover cross-administrator access, conflicting checkouts, failed simulation, lost hashes, trial expiry, changed configuration, exact reverts, replacements and provider outages. Eight frontend tests cover interruption, storage errors, reload, wallet decline and cross-tab locking. Thirteen billing browser stories cover usage and checkout, including fresh browser storage, another administrator, mobile/dark layout and accessibility. The full browser suite passed 257 stories.

The actual signed-in normal build loaded plan usage and an unconfigured checkout without requesting payment. Its screenshot is `.local/qa/built-billing-checkout-current.png`. The development backend had no billing destination configured, so live activation, renewal and upgrade settlement remain Q04 in [the TODO](../TODOS.md). Mocked receipt tests are not live checkout evidence.

Direct checkout currently pays from the connected administrator wallet. A payment from a linked funding account can be verified through the existing receipt flow. There is no automatic renewal debit. Original database-backed requests have no seven-day recovery cutoff; manually submitted receipts without a saved checkout retain the existing seven-day verification window.
