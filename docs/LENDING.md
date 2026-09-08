# Lending through Aave

Implemented September 8, 2026. Accounts → Earn → View lending lets an administrator or approver review a company account's USDC, lend it through Aave V3, and withdraw to the same account. The Safe retains its position and all spending requires its current direct or nested owner threshold. Disburse does not hold assets, borrow, operate a strategy or charge an additional service fee.

## Provider and route selection

The first integration uses Aave's published V3 Pool directly on Base and Arbitrum. It accepts canonical USDC, including native USDC on Arbitrum. It does not accept same-symbol bridged assets. Aave's Pool supports supply and withdrawal to a specified account, including full-balance withdrawal; available reserve liquidity determines whether a withdrawal can execute. Its rate varies with the reserve. This is lending, not staking, a guaranteed return or an insured bank deposit. [Aave Pool](https://aave.com/docs/aave-v3/smart-contracts/pool), [withdrawal terms](https://aave.com/help/supplying/withdraw-tokens).

Direct Pool integration avoids a second vault or strategy wrapper. The adapter reads positions and contract state from unbilled RPC endpoints; it requires no Aave API subscription, hosted quote account or operator-funded relayer. Published deployments come from Aave's address book, with runtime and proxy implementation pins checked against each configured network. Pool, address provider, data provider, aToken and oracle relationships must all match. An upgrade stops new execution until its code and configuration are reviewed. [Base deployment](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol), [Arbitrum deployment](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Arbitrum.sol).

The isolated Base Sepolia route uses **Aave test USDC**, because Aave does not list Circle's test USDC in that market. Circle's canonical test USDC still pays execution fees. These two token contracts are displayed separately and cannot substitute for one another in payments, account balances or settlement checks. Testnet liquidity and fees are not production forecasts. [Test deployment](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3BaseSepolia.sol).

## Customer workflow and charges

1. Choose an account and inspect available cash, the current lending position, variable APR and available withdrawal liquidity.
2. Enter a deposit or withdrawal amount, or choose Withdraw all. A full withdrawal reviews an estimate and instructs Aave to close the actual position at execution.
3. Review the provider, account, principal, withdrawal conditions and separate USDC execution limit. Each owner signs the same saved request through the usual approval controls.
4. Submit once. Closing the browser preserves the request; background reconciliation verifies the actual receipt. The completed screen shows actual principal and the execution fee after refund.

Circle Paymaster and Candide's unbilled public bundler execute the Safe operation. The customer Safe supplies the USDC fee prefund and receives any unused amount back. Deposits must leave enough cash for the reviewed fee. For a withdrawal, the Safe needs separate available fee USDC before submission; invested funds are not counted as spendable fee cash. No native-gas fallback, Disburse provider account or sponsor balance participates. [Customer-paid service requirements](PRODUCT_AND_SERVICE_REQUIREMENTS.md).

Supply is an atomic batch: reset allowance, approve exactly the deposit, supply to the same Safe, disable use of this reserve as collateral, and reset the allowance again. There is no unlimited Aave spending approval. Existing Aave borrowing on the account blocks these simplified controls because withdrawing collateral requires a loan-management workflow. The app links the customer to manage that existing position through Aave.

## Availability, rejection and recovery

- Quotes expire after ten minutes. Preparation and execution both verify current confirmed state, supported asset identity, fee funds and available principal. New deposits also check reserve capacity and whether the reserve is active, frozen or paused.
- New deposits require a sufficiently recent USDC price within the configured 98–102% range. Aave's capped price adapter is resolved to its underlying feed for freshness. Missing/stale prices or an out-of-range price stop deposits; they do not by themselves prevent withdrawals. This check is a deposit guard, not a guarantee of redemption value. [Aave price adapter](https://github.com/aave-dao/aave-price-feeds/blob/main/src/contracts/PriceCapAdapterStable.sol).
- Insufficient withdrawal liquidity explains the restriction and preserves the amount and position. There is no fabricated withdrawal queue or promised completion date. Aave's own paused reserve can still prevent execution.
- Declined wallet prompts retain the request and use the shared short cancellation message. Reopening a saved request does not deposit again. Lost submission responses reconcile the original operation instead of silently replacing it.
- An unsigned request can be discarded without a fee. If an operation approval may exist, cancellation consumes that original authorization sequence with a separately reviewed USDC fee. The saved evidence and recovery controls remain after an account is archived or a subscription expires.
- Full withdrawals use the live balance rather than the review estimate. Settlement requires a matching Pool withdrawal event and an exact underlying-token transfer within the original Safe operation. A different account, token, direction, amount, extra debit or unrelated operation cannot mark the request complete.

## Positions and books

Available cash and invested balances are separate. The current aToken balance includes accrued yield and can change between refreshes; APR is variable and does not promise future earnings. Historical realized/unrealized earnings require the customer's opening position and existing book basis, including any income already accrued outside Disburse. The app does not invent a lifetime profit number from incomplete account history.

A confirmed supply creates an investment movement, not payroll spending or an operating expense: debit the reviewed lending asset carrying value and credit the cash asset. Withdrawal credits the released lending asset basis and debits actual cash received. A reviewed difference can record previously unrecorded income or loss. Zero released basis is supported without exporting zero-value journal lines. Customers can instead match a movement already recorded in their ledger. Execution fees retain their separate verified cash movements. USDC quantities are not automatically treated as USD book values. [Accounting reconciliation](ACCOUNTING_RECONCILIATION.md).

Canonical transfer identity deduplicates the direct service receipt and later Safe-history observations. Full withdrawal accounting uses the actual received quantity, not the earlier estimate. aToken mint/burn events can include accrued interest; they are not substituted for the underlying principal transfer.

## Verification

The built application completed a real 0.1 Aave test USDC supply on Base Sepolia, charging 0.019195 Circle test USDC. Both the owner and company Safe had zero native ETH. The test declined the first wallet prompt, reopened the browser, resumed the original request, signed the two required approvals, submitted once and closed the browser. Background reconciliation verified the canonical supply, full principal debit, exact fee, zero remaining allowance and disabled collateral. [Supply receipt](https://sepolia.basescan.org/tx/0xea9b82c18770b73d6545f26150e8bb8c45c514d13d568c5687e445fea0b3b30c).

The observed initial position was 0.099999 due to the protocol's smallest-unit rounding. This exposed a fixed-amount withdrawal problem during acceptance and led to the full-balance control. A second built-browser run withdrew all 0.099999 to the original Safe, paid 0.017365 Circle test USDC and left a zero aToken balance. The actual withdrawal, cash delta, fee, account identity and zero native balances were verified independently. Both completed screens were visually inspected. [Full withdrawal receipt](https://sepolia.basescan.org/tx/0x2a645b0c15b56c4f5f191b550f19f82bde52d380639733b8ab2e737f86f71429).

The test asset was obtained from Aave's published test faucet using another customer-paid Circle operation. Its fee was 0.016138 USDC; the faucet minted one test USDC. The adapter does not expose this faucet as a production funding service. [Faucet receipt](https://sepolia.basescan.org/tx/0x46fb546522331d245594e1ac594ebe6da732f635135b638912cf8e0a152175a9).

The journaled scripts `scripts/qa-aave-faucet.mjs` and `scripts/qa-circle-lending.mjs` refuse implicit replay, restrict execution to the development backend and Base Sepolia, and retain private signing data only in ignored local files. Public receipt fixtures under `src/lib/__tests__/fixtures/aave-*.json` contain no keys or reusable signatures. They are regression inputs for canonical settlement verification.

Twelve browser stories cover both themes, a mobile layout, supply, fixed/full withdrawal, rejected approvals, price/availability failures, provider outage, interrupted submission and both cancellation paths. Backend and unit tests cover authorization, immutable intent, quote expiry, actual settlement quantity, position changes, accounting and index deduplication. The pre-full-withdrawal suite passed 372 browser stories; the final focused lending/accounting/account-transfer run passed all 38 stories. Extension/mobile wallet compatibility, mainnet execution acceptance and independent security review remain separate release work; no mainnet spending was performed.
