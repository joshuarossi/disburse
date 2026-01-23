# Stablecoin Treasury Manager (v1.3 MVP)
## Technical Architecture & Design Document

---

## Goals
- Ship a production-quality MVP fast.
- Non-custodial: the app never touches private keys.
- Safe Transaction Service is the system of record for Safe transactions.
- Convex is the system of record for ERP data, RBAC, billing, and audit logs.
- Simple SPA (no SSR).

---

## System Overview

### Components
- **Frontend SPA**: React + Vite, shadcn/ui, Tailwind, Convex client
- **Backend**: Convex (data, RBAC, billing, audit)
- **Blockchain Layer**: Safe Protocol Kit, Safe Transaction Service, Ethereum RPC

### Trust Boundaries
- Safe handles Safe transactions and confirmations.
- Convex handles product logic and metadata.

---

## Identity & Tenancy

- Wallet address = user identity.
- Wallet-based auth (SIWE-style).
- Users can belong to multiple orgs.
- One Safe per org in MVP.

---

## Auth & Session Flow

1. Wallet connects.
2. Convex issues nonce.
3. User signs message.
4. Convex verifies signature and creates session.

Email may be collected for notifications, not auth.

---

## RBAC Model

Roles are capability-based:

- Admin
- Approver
- Initiator
- Clerk
- Viewer

RBAC enforced server-side in Convex.

---

## Data Model (Convex)

### Users
- walletAddress
- email?
- createdAt

### Orgs
- name
- createdBy
- createdAt

### OrgMemberships
- orgId
- userId
- role
- status

### Safes
- orgId
- chainId
- safeAddress

### Beneficiaries
- orgId
- name
- walletAddress
- notes
- isActive

### Disbursements (Intent Records)
- orgId
- safeId
- beneficiaryId
- token
- amount
- memo
- status
- safeTxHash
- txHash

### Billing
- orgId
- plan
- trialEndsAt
- paidThroughAt
- status

### AuditLog
- orgId
- actorUserId
- action
- objectType
- objectId
- metadata

---

## Safe Integration

- Use Safe Protocol Kit to build/sign/execute txs.
- Use Safe API Kit to propose and read txs.
- Convex stores intent + hashes only.

---

## Disbursement Flow (Single Signer)

1. Create draft in Convex.
2. Build Safe tx (ERC20 transfer).
3. Propose via Safe Tx Service.
4. Execute immediately.
5. Store txHash in Convex.

---

## Reporting

- Disbursement register
- Beneficiary list
- CSV export

On-chain truth via Safe service; metadata via Convex.

---

## Billing & Licensing

- 30-day trial.
- Stablecoin billing via in-app disbursement.
- License gates app features only.

---

## Frontend Structure

Routes:
- /login
- /select-org
- /org/:id/dashboard
- /org/:id/beneficiaries
- /org/:id/disbursements
- /org/:id/billing
- /org/:id/settings

---

## MVP Checklist

### Included
- Wallet auth
- Org + Safe creation
- Beneficiaries CRUD
- Single-signer payments
- Audit logs
- Billing via stablecoin

### Excluded
- Scheduling
- Batch payments
- Accounting reports
- Sanctions screening

---

End of Document
