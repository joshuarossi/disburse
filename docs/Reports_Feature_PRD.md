# Reports Feature PRD

**Version:** 1.0  
**Status:** Ready for Development  
**Target:** Jan 30, 2026 (Conference Demo)

---

## Overview

Add a Reports section to Disburse that provides users with exportable financial data for accounting, compliance, and operational visibility. Reports should be filterable, viewable in-app, and exportable as CSV.

---

## Goals

1. **Accounting Integration** — Users can export transaction data for their accountants
2. **Compliance** — Full audit trail of all actions for regulatory requirements
3. **Operational Visibility** — Quick answers to "how much did we pay X?" and "what happened when?"

---

## User Stories

### Transaction Report

**As a** finance manager  
**I want to** see all disbursements with filtering options  
**So that** I can review payment history and export it for bookkeeping

**Acceptance Criteria:**
- [ ] View all disbursements in a table format
- [ ] Filter by date range (start date, end date)
- [ ] Filter by status (Executed, Failed, Cancelled, Pending)
- [ ] Filter by beneficiary
- [ ] Filter by token (USDC, USDT)
- [ ] Display totals (total amount, transaction count)
- [ ] Export filtered results to CSV

---

### Spending by Beneficiary

**As a** CFO  
**I want to** see total spending grouped by beneficiary  
**So that** I can understand where money is going and prepare tax documents (1099s)

**Acceptance Criteria:**
- [ ] View all beneficiaries with aggregated payment data
- [ ] Show: beneficiary name, type (individual/business), transaction count, total paid
- [ ] Filter by date range
- [ ] Filter by beneficiary type (Individual, Business)
- [ ] Sort by total paid (ascending/descending)
- [ ] Sort by transaction count
- [ ] Export to CSV

---

### Audit Log

**As a** compliance officer  
**I want to** see every action taken in the system  
**So that** I can demonstrate proper controls to auditors

**Acceptance Criteria:**
- [ ] View all system events in chronological order
- [ ] Event types to capture:
  - Beneficiary created
  - Beneficiary updated
  - Beneficiary deleted
  - Disbursement created
  - Disbursement approved
  - Disbursement executed
  - Disbursement failed
  - Disbursement cancelled
  - Team member invited
  - Team member role changed
  - Team member removed
  - Safe connected
  - Safe disconnected
  - Settings changed
- [ ] Display: timestamp, user (name + wallet), action, details
- [ ] Filter by date range
- [ ] Filter by user
- [ ] Filter by action type
- [ ] Export to CSV

---

## UI Specification

### Navigation

Add "Reports" to the left sidebar between "Disbursements" and "Settings".

```
Dashboard
Beneficiaries
Disbursements
Reports        ← New
Settings
```

### Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Reports                                                                │
│  Export and analyze your treasury data                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Transactions]  [Spending by Beneficiary]  [Audit Log]    ← Tab nav   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────┐  ┌──────────┐ │
│  │ Filters (date range, status, etc.)                  │  │ Export   │ │
│  └─────────────────────────────────────────────────────┘  │ CSV  ↓   │ │
│                                                           └──────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┤
│  │ Results Table                                                       │
│  │ ─────────────────────────────────────────────────────────────────── │
│  │  Date   │ Beneficiary │ Amount │ Token │ Status │ Memo             │
│  │  ...    │ ...         │ ...    │ ...   │ ...    │ ...              │
│  └─────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Showing 47 transactions · Total: $12,450.00 USDC            ← Summary │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tab: Transactions

**Columns:**
| Column | Description |
|--------|-------------|
| Date | Execution date (or created date if pending) |
| Beneficiary | Name (linked to beneficiary) |
| Amount | Formatted with token symbol |
| Token | USDC or USDT |
| Status | Executed, Failed, Cancelled, Pending |
| Memo | Truncated, tooltip for full |
| Tx | Link to block explorer (if executed) |

**Filters:**
- Date range (date pickers)
- Status (multi-select)
- Beneficiary (dropdown/search)
- Token (multi-select)

**Summary Row:**
- Total transactions: X
- Total amount: $X.XX USDC, $X.XX USDT (separate by token)

---

### Tab: Spending by Beneficiary

**Columns:**
| Column | Description |
|--------|-------------|
| Beneficiary | Name |
| Type | Individual / Business |
| Transactions | Count of executed disbursements |
| Total Paid | Sum of executed disbursements |

**Filters:**
- Date range
- Type (Individual, Business)

**Sorting:**
- By name (A-Z, Z-A)
- By total paid (High-Low, Low-High)
- By transaction count (High-Low, Low-High)

---

### Tab: Audit Log

**Columns:**
| Column | Description |
|--------|-------------|
| Timestamp | Date and time |
| User | Name + truncated wallet |
| Action | Human-readable action name |
| Details | Context (e.g., "Beneficiary: Alice Johnson") |

**Filters:**
- Date range
- User (dropdown)
- Action type (multi-select)

---

## Data Requirements

### Transaction Report Query

```javascript
// Convex query
export const getTransactionReport = query({
  args: {
    orgId: v.id("organizations"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    status: v.optional(v.array(v.string())),
    beneficiaryId: v.optional(v.id("beneficiaries")),
    token: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Query disbursements with filters
    // Join beneficiary names
    // Return sorted by date descending
  },
})
```

### Spending by Beneficiary Query

```javascript
// Convex query
export const getSpendingByBeneficiary = query({
  args: {
    orgId: v.id("organizations"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    type: v.optional(v.string()), // "individual" | "business"
  },
  handler: async (ctx, args) => {
    // Query executed disbursements
    // Group by beneficiaryId
    // Sum amounts, count transactions
    // Join beneficiary details
    // Return sorted by total descending
  },
})
```

### Audit Log Query

```javascript
// Convex query
export const getAuditLog = query({
  args: {
    orgId: v.id("organizations"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    userId: v.optional(v.id("users")),
    actionType: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Query audit_logs with filters
    // Join user details
    // Return sorted by timestamp descending
  },
})
```

---

## CSV Export Specification

### Utility Function

```javascript
function exportToCsv(filename, rows, columns) {
  const header = columns.map(c => c.label).join(',')
  const data = rows.map(row => 
    columns.map(c => {
      const value = row[c.key] ?? ''
      // Escape quotes and wrap in quotes
      return `"${String(value).replace(/"/g, '""')}"`
    }).join(',')
  ).join('\n')
  
  const blob = new Blob([header + '\n' + data], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

### CSV Schemas

**transactions_YYYY-MM-DD.csv**
```
Date,Beneficiary,Wallet Address,Amount,Token,Status,Memo,Transaction Hash
2026-01-21,Alice Johnson,0xd916...b58b,4500.00,USDC,Executed,January payment,0x8f3a...2d1c
```

**spending_by_beneficiary_YYYY-MM-DD.csv**
```
Beneficiary,Type,Wallet Address,Transactions,Total Paid,Token
Alice Johnson,Individual,0xd916...b58b,12,54000.00,USDC
```

**audit_log_YYYY-MM-DD.csv**
```
Timestamp,User,Wallet,Action,Details
2026-01-21 09:15:23,Josh Rossi,0x8e14...14bb,Disbursement Approved,Disbursement #127 to Alice Johnson
```

---

## Permissions

| Role | Can View Reports | Can Export |
|------|------------------|------------|
| Admin | ✅ | ✅ |
| Approver | ✅ | ✅ |
| Initiator | ✅ | ✅ |
| Clerk | ✅ | ✅ |
| Viewer | ✅ | ✅ |

All roles can view and export reports. Reports are read-only by nature.

---

## Audit Log Events

Ensure these events are being captured (if not already):

| Event | Trigger | Details to Capture |
|-------|---------|-------------------|
| `beneficiary.created` | Beneficiary added | Beneficiary name, wallet |
| `beneficiary.updated` | Beneficiary edited | What changed |
| `beneficiary.deleted` | Beneficiary removed | Beneficiary name |
| `disbursement.created` | Payment initiated | Beneficiary, amount, token |
| `disbursement.approved` | Signer approves | Disbursement ID, approver |
| `disbursement.executed` | On-chain success | Tx hash |
| `disbursement.failed` | On-chain failure | Error reason |
| `disbursement.cancelled` | User cancels | Reason (if provided) |
| `team.invited` | Member added | Email/wallet, role |
| `team.role_changed` | Role updated | Old role → new role |
| `team.removed` | Member removed | Who was removed |
| `safe.connected` | Safe linked | Safe address, chain |
| `safe.disconnected` | Safe unlinked | Safe address |
| `settings.updated` | Org settings changed | What changed |

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Create `/reports` route
- [ ] Add Reports to sidebar navigation
- [ ] Create tab component for switching between reports
- [ ] Implement `exportToCsv` utility

### Phase 2: Transaction Report
- [ ] Build `getTransactionReport` query
- [ ] Create filter UI (date range, status, beneficiary, token)
- [ ] Create results table
- [ ] Add summary row (totals)
- [ ] Wire up CSV export

### Phase 3: Spending by Beneficiary
- [ ] Build `getSpendingByBeneficiary` query
- [ ] Create filter UI (date range, type)
- [ ] Create results table with sorting
- [ ] Wire up CSV export

### Phase 4: Audit Log
- [ ] Verify audit events are being captured
- [ ] Build `getAuditLog` query
- [ ] Create filter UI (date range, user, action type)
- [ ] Create results table
- [ ] Wire up CSV export

### Phase 5: Polish
- [ ] Loading states
- [ ] Empty states ("No transactions found")
- [ ] Error handling
- [ ] Mobile responsiveness
- [ ] Date formatting consistency

---

## Out of Scope (Future)

- PDF export
- Scheduled email reports
- Custom date presets (This Month, Last Quarter, YTD)
- Data visualization / charts
- Comparison reports (this month vs last month)
- QuickBooks/Xero direct export format

---

## Success Criteria

**Demo Ready:**
- [ ] User can view all three reports
- [ ] User can filter each report by date range
- [ ] User can export each report to CSV
- [ ] Exported CSV opens correctly in Excel/Google Sheets
- [ ] Reports load in under 2 seconds for typical data volumes (<1000 records)

---

*— End of Reports Feature PRD —*
