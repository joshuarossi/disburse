# Reports Feature Implementation Plan

## Overview

Implement a Reports section for Disburse with three report types: Transactions, Spending by Beneficiary, and Audit Log. All reports support filtering and CSV export.

---

## Key Findings from Codebase Exploration

### Existing Infrastructure
- **Framework**: React 19 + TypeScript + Vite + Tailwind CSS 4
- **Backend**: Convex (serverless database)
- **Routing**: React Router v7 at `/org/:orgId/*`
- **UI Pattern**: Semantic HTML tables with mobile card fallbacks
- **Icons**: Lucide React

### Existing Data Models (convex/schema.ts)
- **disbursements**: Has all needed fields (orgId, beneficiaryId, token, amount, status, memo, txHash, createdAt)
- **beneficiaries**: Has type (individual/business), name, walletAddress
- **audit_logs**: Already exists with orgId, actorUserId, action, objectType, objectId, metadata, timestamp

### Current Audit Log Events Tracked
The system already logs these events:
- `disbursement.created`, `.draft`, `.pending`, `.proposed`, `.executed`, `.failed`, `.cancelled`
- `beneficiary.created`, `.updated`
- `safe.linked`, `.unlinked`
- `member.invited`, `.removed`, `.roleUpdated`, `.nameUpdated`, `.emailUpdated`
- `org.created`, `.updated`
- `billing.subscribed`, `.upgraded`

**Gap**: Missing `beneficiary.deleted` event (need to verify if delete exists)

---

## Implementation Steps

### Phase 1: Core Infrastructure

#### 1.1 Add Route and Navigation
**Files to modify:**
- `src/App.tsx` - Add `/org/:orgId/reports` route
- `src/components/layout/AppLayout.tsx` - Add "Reports" nav item between Disbursements and Settings

```tsx
// AppLayout.tsx navItems array (around line 49-54)
{ name: "Reports", href: `/org/${orgId}/reports`, icon: FileText }
```

#### 1.2 Create Reports Page Shell
**New file:** `src/pages/Reports.tsx`

Structure:
- Page header ("Reports" title + subtitle)
- Tab navigation (3 tabs)
- Filter section (varies by tab)
- Results table/cards
- Summary row
- Export button

#### 1.3 Create CSV Export Utility
**New file:** `src/lib/csv.ts`

```typescript
export function exportToCsv(filename: string, rows: any[], columns: { key: string; label: string }[])
```
- Escape quotes, handle commas
- Generate and download blob

---

### Phase 2: Transaction Report Tab

#### 2.1 Backend Query
**New in:** `convex/reports.ts`

```typescript
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
    // Join beneficiary data
    // Calculate totals by token
    // Return { items, totals }
  }
})
```

#### 2.2 Frontend Component
**In:** `src/pages/Reports.tsx` (TransactionsTab component)

Columns: Date | Beneficiary | Amount | Token | Status | Memo | Tx Link

Filters:
- Date range (two date inputs)
- Status multi-select (buttons like Disbursements page)
- Beneficiary dropdown/search
- Token multi-select

Summary: "Showing X transactions · Total: $X USDC, $X USDT"

---

### Phase 3: Spending by Beneficiary Tab

#### 3.1 Backend Query
**Add to:** `convex/reports.ts`

```typescript
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
    // Return aggregated data
  }
})
```

#### 3.2 Frontend Component
**In:** `src/pages/Reports.tsx` (SpendingTab component)

Columns: Beneficiary | Type | Transactions | Total Paid

Filters:
- Date range
- Type (Individual/Business/All)

Sorting (client-side):
- Name (A-Z, Z-A)
- Total paid (High-Low, Low-High)
- Transaction count (High-Low, Low-High)

---

### Phase 4: Audit Log Tab

#### 4.1 Backend Query Enhancement
**Modify:** `convex/audit.ts` (existing `list` query)

Current query already supports:
- orgId filter
- Joins user details (actor name, wallet)

Need to add:
- startDate/endDate filters
- userId filter
- actionType filter (array of action strings)

```typescript
export const list = query({
  args: {
    orgId: v.id("organizations"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    userId: v.optional(v.id("users")),
    actionType: v.optional(v.array(v.string())),
  },
  // ... handler
})
```

#### 4.2 Frontend Component
**In:** `src/pages/Reports.tsx` (AuditLogTab component)

Columns: Timestamp | User | Action | Details

Filters:
- Date range
- User dropdown
- Action type multi-select

Action types for filter dropdown:
- Beneficiary Created/Updated/Deleted
- Disbursement Created/Approved/Executed/Failed/Cancelled
- Team Member Invited/Role Changed/Removed
- Safe Connected/Disconnected
- Settings Changed

---

### Phase 5: Polish

#### 5.1 Loading States
- Skeleton/spinner while data loads
- Disabled export button during load

#### 5.2 Empty States
- "No transactions found" with suggestion to adjust filters
- Same pattern for each tab

#### 5.3 Error Handling
- Try-catch around exports
- Error toast/alert if export fails

#### 5.4 Mobile Responsiveness
- Follow existing pattern: table hidden on mobile, card layout shown
- Stack filters vertically on mobile

#### 5.5 Internationalization
- Add translation keys for all new strings
- Update `src/lib/i18n.ts` translation files

---

## File Changes Summary

### New Files
| File | Description |
|------|-------------|
| `src/pages/Reports.tsx` | Main reports page with 3 tabs |
| `src/lib/csv.ts` | CSV export utility function |
| `convex/reports.ts` | Backend queries for transactions and spending reports |

### Modified Files
| File | Change |
|------|--------|
| `src/App.tsx` | Add `/org/:orgId/reports` route |
| `src/components/layout/AppLayout.tsx` | Add "Reports" nav item |
| `convex/audit.ts` | Add date/user/action filters to list query |
| `src/locales/en/translation.json` | Add English translation keys for Reports |
| `src/locales/es/translation.json` | Add Spanish translation keys for Reports |
| `src/locales/pt-BR/translation.json` | Add Portuguese translation keys for Reports |

---

## User Decisions

- **i18n**: Add full translation keys for all new strings (matching existing patterns)
- **Beneficiary Filter**: Use simple native `<select>` dropdown (not searchable combobox)

---

## Technical Notes

### Beneficiary Dropdown for Transactions Filter
- Fetch beneficiaries list from existing `api.beneficiaries.list`
- Use simple native `<select>` dropdown (matching existing token filter pattern)
- Show beneficiary name in options

### Date Range Handling
- Use native `<input type="date">` (matches existing pattern)
- Convert to timestamps for Convex query
- Default: no date filter (show all)

### CSV Export Filenames
- `transactions_YYYY-MM-DD.csv`
- `spending_by_beneficiary_YYYY-MM-DD.csv`
- `audit_log_YYYY-MM-DD.csv`

### Sorting Strategy
- Transactions: Server-side (Convex)
- Spending by Beneficiary: Client-side (small dataset per org)
- Audit Log: Server-side, default timestamp DESC

### Totals Calculation
- Transactions: Sum amounts by token (separate USDC/USDT totals)
- Spending: Already aggregated per beneficiary

---

## Permissions

Per PRD: All roles can view and export reports. No additional RBAC changes needed since reports are read-only views of existing data.

---

## Testing Checklist

- [ ] Reports link appears in sidebar
- [ ] Tab navigation switches between 3 reports
- [ ] Transaction report loads with all disbursement data
- [ ] Transaction filters work (date, status, beneficiary, token)
- [ ] Spending report groups by beneficiary correctly
- [ ] Spending sorting works (name, total, count)
- [ ] Audit log shows all system events
- [ ] Audit log filters work (date, user, action type)
- [ ] CSV export downloads valid file for each report
- [ ] CSV opens correctly in Excel/Google Sheets
- [ ] Empty states display when no data matches filters
- [ ] Mobile layout is usable
- [ ] Page loads in under 2 seconds

---

## Estimated Complexity

| Phase | Files | Complexity |
|-------|-------|------------|
| Phase 1 (Infrastructure) | 4 | Low |
| Phase 2 (Transactions) | 2 | Medium |
| Phase 3 (Spending) | 1 | Medium |
| Phase 4 (Audit Log) | 2 | Low-Medium |
| Phase 5 (Polish) | 1 | Low |

Total: ~10 file touches, medium overall complexity.
