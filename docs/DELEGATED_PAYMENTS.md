# Delegated payments

Updated September 8, 2026. Members pay through a published Safe allowance without becoming owners of the company's funding account. The assigned payment account pays Circle's execution fee in USDC. Disburse has no provider balance, paid submission account or gas sponsorship.

## Set up a member

1. In **Settings → Funding accounts**, create an assigned payment account for an active member with payment access. Review its initial 3–100 USDC balance separately from the setup fee.
2. The funding account's actual owners approve creation and funding. The new Safe uses the published Safe 1.4.1 and Safe4337 module. It is owned by the selected member's wallet.
3. In **Team & approvals → Delegated spending**, grant the assigned account a token allowance from the company account. Its current owners approve the exact limit, reset period and separate USDC gas fee.
4. The member chooses a saved payment, checks their allowance, reviews the fee, approves the fee limit and then approves the whole execution. A batch uses the same two approval stages as a single payment.

The member controls their assigned account's balance and ownership. Returning unused funds requires their approval. The setup form requires acknowledgment of that control before funding. This is not a parent-recoverable employee balance. Company funds remain in the main account until a payment executes under its revocable allowance.

## Authority and settlement

The allowance delegate is the assigned Safe address. The published AllowanceModule authenticates that calling account with an empty transfer signature. Disburse never obtains a separate reusable EOA transfer signature for this flow. A batch uses the verified MultiSendCallOnly contract through the assigned Safe, preserving the account as the caller for every transfer. All recipient transfers succeed together or revert.

The server verifies active membership, both creator/delegate app limits, reviewed recipient versions, screening, account identity, pinned module bytecode, current ownership, token balance and allowance. It simulates the complete account call before approval and submission. An allowance cannot change a recipient's saved currency or amount.

Principal comes from the company account. Gas comes from the assigned account's USDC. Reconciliation requires the exact allowance events and recipient transfers inside the identified UserOperation; a successful bundle or a fee charge cannot mark a payment Paid. Actual fees and refunds are recorded separately with their paying account and canonical settlement date.

The contract allowance permits transfers to other addresses outside Disburse. App beneficiary controls and member limits govern app workflows, not that external contract authority. Removing a member from Disburse does not revoke an on-chain grant. Owners can revoke the grant through the policy flow.

## Cancellation and failures

Before execution approval begins, an unsigned instruction can be discarded without a fee. Operation-approval attempts are recorded before the wallet opens. If the signature response or its save is lost, the app treats the request as potentially signed and retains its reservation.

Cancelling a signed or potentially signed instruction requires a separately reviewed USDC-paid operation consuming the original EntryPoint sequence. Only a canonical receipt releases its allowance reservations. A failed cancellation execution still consumes that sequence, and its actual fee remains visible. The original transfer cannot execute afterward.

A rejected wallet prompt shows a neutral message and preserves the review. Insufficient USDC, changed recipients, revoked grants and expired quotes stop progression. A submitted request with an unknown result only checks the original hash. Failed or expired requests retain their exact principal instructions for a deliberate retry or discard. A cancelled instruction does not permanently lock the next payment out of the same allowance nonce.

Historical EOA-signed/native payments keep their original recovery path. New native-fee delegation is not offered on production networks. The Sepolia native route remains available for the separately authorized testnet QA stories.

## Evidence

The September 8 built-app test used a separate delegate wallet, actual authenticated development backend, published contracts and Base Sepolia USDC. Every participating wallet and Safe held zero ETH.

- [Assigned account creation and 5 USDC funding](https://sepolia.basescan.org/tx/0xc7ef505c7eb37aeae49c16def2b0bc3c572b72e22931d61ad2246111b2160b4c), with a 0.020654 USDC setup fee.
- [One USDC allowance granted to the assigned Safe](https://sepolia.basescan.org/tx/0x1dfa790aeacd0c2bba1ec0f1d091729366cb84d9e4cfc8fd5025b3702a3180c4), with a 0.019211 USDC fee paid by the company account.
- [Two-recipient payment](https://sepolia.basescan.org/tx/0xc25d5fada9f9092700565ce656e99630d2c70c95253dfb0d1918298107a30570): each received exactly 0.05 USDC, with a separate 0.017627 USDC fee from the assigned Safe. The company's owner-approval nonce remained 7.
- [Signed payment cancellation](https://sepolia.basescan.org/tx/0xddfc9d3d9875d9b79881e8e2bac4b691ee28b59cd8ebe1e7ec52199c5ccdb934), with a 0.014685 USDC fee and no principal transfer.

- [Payment after cancellation](https://sepolia.basescan.org/tx/0x8c926d9ed96b29baf5c0971e00d97e53de3245fedd463fb0955c1edd9818abba): the next batch reused the released allowance nonce, sent exactly 0.05 USDC to each recipient and paid 0.016704 USDC in gas. A subsequent request exceeding the remaining allowance was rejected before fee preparation.

- [Allowance revocation](https://sepolia.basescan.org/tx/0x40522a29abf951e1975b118bc3cf4def0c14f8d725a677e279fa6a72ba2acc6f), paid by the company account with a 0.015762 USDC fee. The test allowance was removed after acceptance.

The built app exercised wallet rejection, reload, exact typed-data approval and submission. Its browser closed before background settlement. `scripts/qa-browser-circle-delegated.mjs` keeps the QA private key in the host process and rejects native-gas sends or signatures for unrelated data. `scripts/qa-circle-delegated.mjs` journals each test action before signing or its single submission attempt. Browser fixtures cover the non-happy and visual cases separately; they are not on-chain acceptance evidence.

Earlier Sepolia native acceptance remains historical evidence: [payment](https://sepolia.etherscan.io/tx/0x1abfc4405eb7c8981ce498044766288eada8c159dd49f07eb6f31d6d8b27bc85), [grant](https://sepolia.etherscan.io/tx/0x78a81c8bbfd00649435e669aea3d30bdea3e3da52293d577d99ccb79ce972fa8) and [revocation](https://sepolia.etherscan.io/tx/0x8066e9f681a2cfa4f9d67953c7957e2157e25552d250fe4ace0adcb5384f73b8). It is not proof of the current stablecoin-fee route. Extension/mobile compatibility and independent security review remain separate acceptance work.
