# Customer-paid invoice collection

Updated September 7, 2026. Invoice receiving setup and collection now use the company Safe's USDC through Circle Paymaster and the public Candide bundler. Disburse has no provider account, gas balance or execution bill. License tier does not change who pays these costs.

## Customer flow

1. An administrator selects the receiving company account. If the shared receiving factory is absent, its deployment is an explicit setup operation. The owners review and approve its USDC fee before deployment.
2. Issuing an invoice records the invoice and predicts its unique address. This step does not deploy a contract or incur a network fee. The customer sees that collecting funds later has a separate execution cost.
3. Ordinary token transfers to the invoice address are reconciled from confirmed chain events. Received and collected amounts are tracked separately.
4. Collection uses the immutable factory and invoice salt to deploy the forwarder if needed and move its full token balance into the selected company Safe. Its owners approve the complete call and a separate USDC execution fee.
5. The application independently verifies the receipt, invoice transfer, fee and unused fee refund. A submitted request is not proof of collection.

The fixed destination cannot be replaced by the person submitting the collection. The backend verifies factory code, token, invoice address and destination before constructing a call. A previously submitted collection must be resolved before another paid attempt. Late funds sent to a voided invoice remain collectable. An RPC outage during receiving setup leaves issuance disabled with a retry action.

The first customer's setup pays the shared immutable factory's deployment cost. Other customers can reuse that factory without another deployment charge. No deployment bill is advanced by Disburse. The canonical CREATE2 deployer, salt, factory bytecode and runtime are pinned in `shared/receivableAddress.ts`.

## Acceptance

The actual development application completed factory setup, issued an invoice, detected its 0.10 USDC payment and collected the full 0.10 USDC into the company Safe on Base Sepolia. Factory deployment cost 0.025571 USDC; collection cost 0.020242 USDC. Both the signing wallet and Safe had zero native ETH. See the [receipt evidence](CUSTOMER_PAID_SERVICES_QA_2026-09-07.md).

Backend and browser coverage includes fee approval, recipient-principal preservation, insufficient funds, interrupted responses, stale requests, wallet cancellation, changed ownership, late funds and viewer restrictions. Collection fees have their own accounting source. If gross prefund/refund movements were already booked, late fee evidence preserves that basis instead of adding a second net fee expense.

Independent forwarder-contract review, grouped-collection cost comparisons and external-ledger acceptance remain open. Automatic collection under a standing authorization is separate from the completed owner-approved flow. Historical native/sponsored receipt recovery remains available; the public native sweep action and sponsored submission path have been removed.
