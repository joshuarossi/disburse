# PRD — Batch Disbursements (Multi-Recipient) for Disburse.Pro

**Owner:** Josh  
**Last updated:** 2026-01-22  
**Status:** Draft

## Summary
Add support for creating a **single disbursement that pays multiple beneficiaries** in one Safe transaction using Safe’s batched transaction support (MultiSend under the hood). The existing **single-beneficiary flow remains the default** and is extended with a progressive “Add another beneficiary” affordance.

In the disbursements list, batch items display **Beneficiary = “Batch”** and can be opened to view recipient-level details.

---

## Goals
1. **Enable lightweight batching** from the existing “New Disbursement” modal without introducing a separate heavy workflow.
2. Keep UX **simple to demo**: “Total of X TOKEN to N beneficiaries” above the submit button.
3. Create a batch as **one Safe transaction** (batched operations), not multiple separate on-chain txs.
4. Maintain a clean path for future **CSV import** for large-scale payroll-style batching (out of scope for this PRD).

## Non-Goals (for this iteration)
- Multi-token batches in a single batch disbursement (we will **limit to one token**).
- CSV import / payroll file upload.
- Per-beneficiary memo fields (batch memo only).
- Scheduling / delayed execution / automated future execution (can be added later).
- Partial success batches (batch is **atomic**, see below).

---

## Key Decisions / Constraints
- **Single token per batch:** the token is chosen once, applies to all recipients.
- **One memo per batch:** shared across all recipients.
- **Each recipient has its own amount.**
- **Unique beneficiaries:** you can’t add the same beneficiary twice in one batch.
- **Atomic execution:** if any sub-transfer fails, the entire batch reverts.
- **Default remains single:** user only “enters batch mode” after adding a second recipient.

---

## UX / UI

### Current screen context
On `/disbursements`, the “New Disbursement” button opens a modal:
- Beneficiary (select)
- Amount (number)
- Token (select)
- Memo (optional)
- Create Disbursement / Cancel

### Proposed modal behavior (progressive batching)
#### Base state (single)
- Same as today.
- Add a subtle link under the first row’s **Amount/Token** area:  
  **“+ Add another beneficiary”**

#### After adding another beneficiary (batch mode)
- A second “Recipient row” appears:
  - Beneficiary (select, excludes already-selected beneficiaries)
  - Amount (number)
  - (No token selector on additional rows; token stays global)
  - Optional “Remove” icon/link on each additional row

- The **Memo** field remains a single field for the whole batch and appears **below all recipient rows**.

- Above **Create Disbursement**, display:
  - **“Total: 17 USDC to 3 beneficiaries”**
  - (Optional but recommended) A subtle breakdown line for clarity:
    - “Giorgio 5 + Angie 7 + Acme 5 = 17 USDC”

#### Visual placement
- Place **“+ Add another beneficiary”** *under the Amount/Token section* of the first row.
- Place the **Total** summary *directly above* the “Create Disbursement” button.
- Keep everything else unchanged to avoid UX fragmentation.

### Disbursements list changes
- For batch disbursements:
  - **Beneficiary column:** show `Batch`
  - **Amount column:** show total amount + token (e.g., `17 USDC`)
  - **Memo column:** show batch memo (or truncated)
  - **Status/Date/Actions:** unchanged

- Clicking a batch row navigates to a detail view (or opens a detail modal/drawer) showing:
  - Token, total, memo, created by, created date
  - Recipient breakdown table:
    - Beneficiary | Address | Amount | Status (derived) | (Optional) tx link once executed

---

## User Stories

### Create batch from modal
1. **As a user**, I can create a normal single disbursement by selecting one beneficiary, amount, token, and optional memo.
2. **As a user**, I can click “+ Add another beneficiary” to add additional recipients to the same disbursement.
3. **As a user**, I can select a beneficiary for each row, but the UI prevents choosing duplicates.
4. **As a user**, I can set a different amount per recipient.
5. **As a user**, I can see a running total like “Total: 17 USDC to 3 beneficiaries” before submitting.
6. **As a user**, I can remove an additional recipient row and see totals update.

### Review & tracking
7. **As a user**, I can see batch disbursements in the list as “Batch” and open them to view recipient-level details.
8. **As a user**, I can see whether a batch is pending approvals, ready to execute, executed, failed, or cancelled.

### Safety / clarity
9. **As a user**, I can easily understand when I’m creating a batch (count + total summary) without a separate workflow.
10. **As a user**, I get clear errors if I try to submit with invalid rows (missing beneficiary, amount <= 0, etc.).

---

## Acceptance Criteria

### Modal / form
- [ ] Default state is identical to current single flow.
- [ ] Clicking “+ Add another beneficiary” adds a new recipient row.
- [ ] Token is selected once and applied to all rows.
- [ ] Beneficiaries must be unique within the batch.
- [ ] Amount must be a positive number; decimals allowed consistent with token decimals.
- [ ] Total summary appears above submit once batch mode is active (>= 2 recipients).
- [ ] Total updates live as amounts are edited or rows removed.
- [ ] Submitting creates exactly **one** Safe transaction (batched).

### List + details
- [ ] List displays `Batch` as beneficiary for batch disbursements.
- [ ] Batch list item shows total amount + token and uses standard status display.
- [ ] Batch detail view shows recipient breakdown.

---

## Functional Requirements

### Form validation
- Require at least 1 recipient row.
- In batch mode (>=2 recipients):
  - Require each row has beneficiary + amount
  - Enforce uniqueness
- Memo is optional (shared across batch).

### Totals
- Total = sum(amounts) per token.
- Display formatted total respecting token decimals.

### Permissions / auth
- Must be authenticated and authorized for the org.
- Must have permission to create disbursements (existing permission model).

---

## Safe / MultiSend Implementation Details

### High-level approach
Use Safe Protocol Kit to build a batched Safe transaction where each recipient corresponds to an ERC-20 `transfer()` call:
- `to`: token contract address (e.g., USDC)
- `value`: `0`
- `data`: ABI-encoded `transfer(recipient, amountInSmallestUnit)`
- `operation`: `0` (CALL)

Then:
1. `createTransaction({ transactions })`
2. Sign / propose / execute depending on Safe threshold.

### Pseudocode (TypeScript-style)
```ts
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import { encodeFunctionData, parseUnits } from 'viem' // or ethers equivalents

const tokenDecimals = 6 // example for USDC
const tokenAddress = USDC_CONTRACT_ADDRESS

const transactions: MetaTransactionData[] = recipients.map(r => ({
  to: tokenAddress,
  value: '0',
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [r.walletAddress, parseUnits(r.amount, tokenDecimals)]
  }),
  operation: 0
}))

const safeTx = await protocolKit.createTransaction({ transactions })

// If threshold is 1 and current signer is owner:
const signedTx = await protocolKit.signTransaction(safeTx)
const response = await protocolKit.executeTransaction(signedTx)

// If threshold > 1:
// - Propose tx to Safe Transaction Service (API Kit), collect confirmations
// - Execute after threshold met
```

### Threshold handling (important)
- If the Safe has **threshold > 1**, the “Create Disbursement” action should generally:
  - **Create + propose** the Safe tx to the Safe Transaction Service
  - Capture returned `safeTxHash` and track confirmations
  - Mark disbursement status as **Pending Approvals**
  - Enable an “Execute” action once threshold is reached

### Atomicity
Because this is a single batched Safe tx:
- **All transfers succeed or none do.**
- Common failure cases:
  - Insufficient token balance in Safe
  - Token contract transfer revert (blacklist, paused token, etc.)
  - Incorrect decimals conversion

### Gas estimation (optional for v1, recommended)
- For demo, it’s optional.
- Later, surface “estimated gas” and show savings vs N separate txs.

---

## Data Model (Suggested)

### Disbursement (existing) — add fields
- `id`
- `org_id`
- `type`: `single | batch`
- `token`: `USDC | USDT | ...`
- `memo`: string nullable
- `total_amount`: string/decimal (human units or base units; pick one)
- `status`: `draft | proposed | pending_approvals | ready | executed | failed | cancelled`
- `safe_address`
- `safe_tx_hash` (nullable until proposed)
- `chain_id`
- timestamps: `created_at`, `updated_at`, `executed_at` (nullable)

### DisbursementRecipient (new table)
- `id`
- `disbursement_id`
- `beneficiary_id`
- `recipient_address`
- `amount` (again: human or base units consistently)
- `created_at`

*(Recipient-level “status” is derived from parent for now. If you later support partial flows, you’d store it.)*

---

## Backend / API (Suggested)

### Create disbursement
`POST /api/disbursements`
```json
{
  "type": "batch",
  "token": "USDC",
  "memo": "Payroll Jan 2026",
  "recipients": [
    { "beneficiary_id": "…", "amount": "5.00" },
    { "beneficiary_id": "…", "amount": "7.00" }
  ]
}
```

**Server actions:**
- Validate auth + org
- Validate uniqueness of beneficiaries
- Resolve addresses from beneficiaries
- Build Safe tx meta transactions
- Create Safe transaction with Protocol Kit
- If threshold == 1 and server is executing signer (or client executes): execute
- Else: propose to transaction service and store hash, set status accordingly
- Persist disbursement + recipients

### Fetch list
`GET /api/disbursements?org_id=...`
- List items include `type`, `total_amount`, `token`, `status`, `created_at`

### Fetch detail
`GET /api/disbursements/:id`
- Returns disbursement + recipients array

---

## Status Model

### Single + Batch (shared)
- `draft` (optional if you add drafts later)
- `proposed` (created and submitted to Safe service)
- `pending_approvals` (not enough confirmations)
- `ready` (threshold met; can execute)
- `executed`
- `failed`
- `cancelled`

**UI mapping examples:**
- “Pending approvals” → show “Awaiting signatures”
- “Ready” → show “Ready to execute” + action button

---

## Edge Cases / Error Handling
- **Duplicate beneficiary:** prevent in UI + validate server-side.
- **Amount 0 or negative:** prevent + validate.
- **Decimals mismatch:** server should convert to base units using token decimals.
- **Insufficient Safe balance:** show error on execution / proposal.
- **Approval threshold not met:** created as pending approvals; execution disabled.
- **Recipient removed:** totals update.
- **Network/chain mismatch:** validate chain_id against Safe & token addresses.
- **Token not supported:** block at token selector; server validates allowlist.

---

## Telemetry (Optional)
- Track: batch created, number of recipients, total amount, time to approvals, execution success/failure reasons.

---

## Rollout Plan
1. Implement UI changes behind a feature flag: `batch_disbursements_enabled`.
2. Enable in dev/staging with Sepolia Safe.
3. Dogfood with a handful of internal beneficiaries.
4. Release broadly.

---

## Future Enhancements (Not in scope)
- CSV import flow with per-recipient memo and validation preview.
- Multi-token batching via advanced mode.
- Scheduling and automated execution once threshold met.
- Recipient-level status tracking, retries, and partial execution patterns (if ever desired).
