# Customer-paid invoice collection

The customer pays every network and provider fee directly in stablecoins. A free, trial, paid or complimentary software license does not include gas or external service fees. This applies to invoice creation and any receiving-address provisioning as well as collection. See the [product-wide service requirements](PRODUCT_AND_SERVICE_REQUIREMENTS.md).

The current invoice collection flow uses the customer's connected wallet to pay native gas, so it does not yet satisfy the stablecoin-only service-cost requirement. It verifies the receiving factory and fixed destination before requesting the transaction. The receiving contract forwards the full principal to the company account. Confirmed token transfers determine the collected amount; a successful wallet submission alone does not mark funds collected.

The sponsored Gelato collection path has been removed. A provider API key cannot enable automatic customer-fee subsidies. The old timeout-based `forward`, `sweepClaim` and `sweepResult` endpoints are also removed. Earlier submission evidence remains available if an existing record needs recovery.

Managed collection with stablecoin fees needs an explicitly authorized company-account transaction or a contract-enforced standing fee allowance. The reviewed call must collect the full principal and pay a separately disclosed fee from the customer's account. Provider/network costs must not be absorbed by Disburse. That integration remains unfinished under A07/A11 in [the TODO](../TODOS.md).

The invoice review and collection controls now state who pays. Browser coverage checks fee disclosure, mobile/dark layout, desktop/light layout and viewer access. Backend coverage verifies that refreshing confirmed receipts never sends a sponsored collection, even with a provider key configured. Earlier real Sepolia native collection evidence is in [receivables](ACCOUNTS_RECEIVABLE.md).
