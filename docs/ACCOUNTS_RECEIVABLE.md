# Customer invoices and collections

**September 7 requirement:** invoice creation, receiving-address provisioning and collection follow the [product-wide service boundary](PRODUCT_AND_SERVICE_REQUIREMENTS.md). The issuer pays any creation-service cost in stablecoins when creating the invoice. Current issuance only predicts an address; it has no receiving-contract deployment cost at issuance. First collection deploys that contract, and its full cost must be quoted to and paid by the customer in stablecoins. Current native-wallet collection does not yet satisfy that requirement. Disburse must not fund a factory, collection or indexing service on the customer's behalf.

## Product behavior

**Invoices** is accounts receivable: create a draft, review its items and receiving account, generate a payment link, share it, and track payment. **Bills** remains accounts payable. The customer can view and print the invoice without creating a Disburse account.

Each issued invoice has one fixed amount, currency, network, destination account and unique receiving address. Drafts can be edited; issued payment instructions cannot. An invoice can receive several partial payments. Overpayments and payments arriving after voiding remain visible. Customer email is kept out of the public page, and links are unguessable bearer tokens. Anyone with the link can see the shared invoice; treat it as a document link, not an authenticated customer portal.

Received and collected are separate amounts. A confirmed payment satisfies the invoice even if collection into the main account has not completed. Collection never counts as another customer payment. No fee is deducted from the invoice principal by the current contract. This is an implementation choice, not a promise that invoicing will always have no service fee. Pricing remains open; no new service charge is enabled.

## Receiving-address options

| Approach | Customer experience | Authority and recovery | Cost/tradeoff |
| --- | --- | --- | --- |
| Separate ordinary wallet per invoice | Normal transfer to a unique address | Requires private-key generation, backup and transaction signing. A server holding keys would control receipts. | No contract deployment, but key custody and native-gas funding for every sweep are substantial operational obligations. Does not fit the current architecture. |
| Separate Safe per invoice | Normal transfer to a unique address | Customer-controlled account with owner configuration | Repeats account setup and deployment per invoice; more configuration than collection requires. |
| Shared account plus invoice-reference payment contract | Pay a contract method with an invoice identifier | Customer controls treasury; attribution recorded by router | Avoids per-invoice deployment, but an ordinary exchange withdrawal cannot include that contract call. Shared-address transfers without the reference are ambiguous. Worth retaining for customers paying through a compatible wallet. |
| Deterministic receiving contract per invoice | Normal transfer to a unique address; no reference copying | Immutable destination, permissionless collection, no operator key controlling receipts | Contract deployment on first collection, then gas for each later collection. Chosen for predictable attribution from normal token transfers. |

The address is computed using CREATE2 from the factory, invoice salt, and creation code containing the destination account. The same factory and salt with another destination produce another address. An address can receive tokens before its code is deployed. The system checks both local derivation and the deployed factory's prediction before issuing instructions. [CREATE2 specification](https://eips.ethereum.org/EIPS/eip-1014).

The first implementation uses a small, fully deployed contract with an immutable constructor argument. Minimal proxies could reduce deployment gas, but add an implementation dependency and initialization considerations. Benchmark a clone variant before changing the design; lower gas alone is not enough reason to introduce a destination-initialization failure mode. [OpenZeppelin proxy and clone documentation](https://docs.openzeppelin.com/contracts/5.x/api/proxy).

## Collection and gas

```mermaid
sequenceDiagram
  participant Team
  participant App as Disburse
  participant Customer
  participant Address as Invoice address
  participant Collector as Collection service or wallet
  participant Safe as Organization account
  Team->>App: Review and issue invoice
  App-->>Team: Unique address and payment link
  Team-->>Customer: Share invoice
  Customer->>Address: Transfer requested currency
  App->>Address: Read confirmed transfer events
  App-->>Team: Paid or partially paid
  Collector->>Address: Deploy if needed, then collect
  Address->>Safe: Entire token balance
  App-->>Team: Funds collected into account
```

ERC-20 transfers do not require a callback into the receiving address. Consequently a plain transfer does not automatically forward itself. A later transaction must call the collection function. The contract uses SafeERC20 to support tokens with standard boolean returns and common tokens without a return value; unsuccessful transfers revert. Only the invoice's configured canonical token is credited toward payment. [ERC-20 specification](https://eips.ethereum.org/EIPS/eip-20), [OpenZeppelin SafeERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20).

There are three distinct costs: a shared factory deployment for each supported network; the invoice receiving-contract deployment on its first funded collection; and execution gas for that and subsequent collections. Issuing an unused invoice does not deploy its receiving contract. The first collection is more expensive than later ones. Measure gas units and customer cost at the actual network fee, especially before enabling low-value invoices on expensive networks. Sepolia gas prices are test evidence, not production cost forecasts.

The customer pays every collection fee. The implemented collection flow uses the customer's connected wallet for native gas. The sponsored Gelato path has been removed. Managed collection with stablecoin fees requires a separately reviewed company-account fee authorization; that integration remains open. A free software license never includes network or provider charges. See [customer-paid collection](INVOICE_COLLECTIONS.md).

## Authority, verification and failure handling

- The receiving contract has no administrator, upgrade entry point, arbitrary call, approval, or change-destination function. Its treasury is fixed at deployment. The factory's idempotent `deployAndSweep` can only deploy the predicted contract and invoke its sweep.
- Anyone can pay collection gas. A caller cannot redirect collected assets. Repeated calls with an empty balance transfer nothing; they may still consume gas. The factory and invoice contracts are pinned to reproducible compiler output.
- Issue verifies the RPC chain, factory runtime, independently predicted address, active linked account and published Safe identity. The mutation rechecks role and the draft revision after chain verification.
- Address issuance binds organization, invoice, chain, token contract and treasury. Names or token symbols alone never identify receipts. Incoming transfers cannot add or change a payable beneficiary.
- Scanning uses exact canonical token and destination filters, positive event values, block bounds and confirmation checks. Production reads finalized blocks; Sepolia and Base Sepolia use two confirmations for acceptance. Two testnet confirmations do not provide production finality guarantees.
- Event identity is chain + transaction hash + log index. The scan cursor and event writes update atomically. Concurrent/repeated scans cannot count a transfer twice. RPC failure leaves the last amounts and cursor intact and exposes a retry message.
- Each job reads at most 2,000 blocks; the scheduler rotates a bounded set of invoices. Queueing a job does not change the last actual receipt-check timestamp. Large numbers of invoices still require load testing and likely a dedicated indexing provider.
- Managed collection is not submitted until customer-paid fee authorization is implemented. Earlier submission evidence is retained for inspection; elapsed time does not justify another sponsored request. Native collection discloses the customer-paid fee before the wallet request.
- Subscription expiry does not stop tracking issued invoices or collection/recovery. Voiding stops requesting further payment; it does not destroy an address or reverse transfers. Wrong ERC-20 assets and native assets can be recovered by invoking the corresponding contract sweep to the same fixed treasury. They are not credited toward the invoice.
- A payment on the wrong network is not credited. Recovery there is not guaranteed. It depends on compatible factory/account deployments and must not be advertised as automatic cross-chain recovery.

## Configuration and evidence

Source: `contracts/InvoiceForwarder.sol`; generated artifact: `shared/invoiceForwarderArtifact.ts`. Rebuild with `bun run contracts:compile`; run contract behavior and artifact-consistency tests with `bun run test:contracts`. CI runs those checks.

Configure `AR_FACTORY_<chainId>` with a deployed factory whose runtime matches the pinned artifact. Production issuance also requires `AR_MAINNET_ENABLED=true`; it remains disabled pending independent review. The UI explains customer-paid native-wallet collection before issuance. A Gelato key alone never enables sponsored invoice collection.

Backend acceptance tests cover draft immutability, exact decimals, partial/over/late payments, role and public-data boundaries, expiry, duplicate scans, factory/network mismatches, finality, bounded scans, provider errors and submission recovery. Contract tests exercise destination binding, funding before deployment, permissionless collection, repeated/late deposits, failed/no-return tokens and native-asset recovery.

`scripts/qa-receivables.mjs` performs the actual development-backend flow on Sepolia using the existing isolated QA wallet and Safe. It caps aggregate execution at 0.01 Sepolia ETH, records exact signed transaction identity before broadcasting, and resumes using the same transaction bytes. Its private report lives under ignored `.local/qa`; browser screenshots and public transaction evidence belong in the QA report.

The Sepolia proof passed for 0.010001 USDC. Shared factory deployment used 579,774 gas; the first collection used 354,038 gas including the receiving-contract deployment. Full principal reached the Safe. See [transaction evidence and visual QA](QA_V2.md). The production billing model remains undecided and no new invoice service charge is enabled.

## Remaining acceptance and extensions

Track completion in [TODOS.md](../TODOS.md), especially A01–A12. Before real-money collection: independent contract/security review and live managed-provider collection evidence. Test both public and internal invoice flows in desktop/mobile and both themes.

Accounting now recognizes the original receipt and classifies invoice-address-to-Safe movement as internal collection. Reviewed chart mappings, receivable settlement, overpayment liabilities and balanced exports are implemented; external-ledger acceptance remains open. Attachments, tax fields, credit notes/refunds, customer records and reminders remain separate work. Printable invoices contain the captured commercial fields, not a complete jurisdiction-specific tax invoice system.
