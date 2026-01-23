# Bulk Beneficiary Import (CSV)

## Overview
The **Bulk Beneficiary Import** feature allows users to add multiple beneficiaries at once by uploading a CSV file. This feature is designed to be **fast, safe, and user-friendly**, while keeping the existing single-beneficiary flow unchanged and uncluttered.

This experience emphasizes:
- Clear guidance (CSV template)
- Immediate feedback (preview + validation)
- High confidence before committing changes

---

## Goals
- Reduce friction when onboarding many beneficiaries
- Prevent costly mistakes (invalid wallet addresses, wrong types)
- Maintain a clean, elegant UI consistent with the existing design

---

## Non-Goals
- Editing beneficiaries inline during import (CSV re-upload instead)
- Supporting file formats other than CSV (v1)
- Auto-creating disbursements from imports

---

## Entry Point

### Buttons (Beneficiaries Page Header)
- **Primary Button:** `Add Beneficiary`
- **Secondary Button:** `Bulk Import`

**Placement:**
- Both buttons appear in the **top-right corner** of the page.
- `Add Beneficiary` remains **visually dominant**.
- `Bulk Import` uses a **secondary / outline** style.

**Behavior:**
- Clicking **Bulk Import** opens a modal (see below).

---

## Bulk Import Modal

### Modal Characteristics
- Size: **Medium–large** modal (enough room for a preview table).
- Dismissal:
  - Dismissible via `X` / outside click **only when not processing**.
  - **Not dismissible** while parsing/upload/creating beneficiaries is in progress.
- Layout:
  - Step-based conceptually, but presented in a **single flow** within one modal.

### Modal Title
**Bulk Import Beneficiaries**

---

## Step 1: CSV Template

### UI Elements
- Short instructional text: what this import does and what columns are supported.
- Primary link/button: **Download CSV Template**

### CSV Template Format
**Required columns:**
- `type` (allowed values: `individual` | `business`)
- `name`
- `wallet_address`

**Optional columns:**
- `notes`

**Example row:**
```csv
type,name,wallet_address,notes
individual,John Doe,0xabc123...,Monthly contractor
```

**Notes:**
- Template download should always reflect the latest supported schema.

---

## Step 2: File Upload

### Upload Methods
- Drag & drop zone
- File system picker (`Choose file`)

### Supported Files
- `.csv` only

### UI States
- **Empty state:**
  - Copy: “Drop your CSV here, or choose a file.”
  - Secondary hint: “Use the template above to ensure formatting.”
- **File selected:**
  - Show file name + file size
  - Action: `Replace file`
- **Parsing state:**
  - Spinner/progress indicator
  - Status text: “Parsing CSV…”

---

## Step 3: Preview & Validation

### Preview Table
After upload + parse, show a preview table.

**Columns:**
- **Type**
- **Name**
- **Wallet Address**
- **Notes**
- **Status / Errors**

### Validation Rules
- `wallet_address` must be a valid address for the selected chain/network
- `type` must be `individual` or `business`
- `name` must be present (non-empty)
- Duplicate wallet addresses are detected:
  - duplicates **within the CSV**
  - duplicates **against existing beneficiaries** (if feasible to check immediately)

### Error Handling
- Rows with errors are highlighted.
- Errors are shown inline per row in the **Status / Errors** column.
- The user can re-upload a corrected CSV.

### Selection Behavior
- Default: valid rows are selected for import.
- Invalid rows are not selectable.

---

## Primary Action

### CTA Button
**Label:**
```
Add X beneficiaries
```

**Behavior:**
- `X` updates dynamically to reflect **valid & selected** rows.
- Disabled if **0 valid rows** exist.
- Shows loading state while creating beneficiaries.

---

## Confirmation & Completion

### On Success
- Modal closes automatically.
- Toast: `X beneficiaries added successfully`
- Beneficiaries list refreshes, showing newly added entries.

### On Failure
- Inline error message at top of modal.
- Modal remains open with the preview table preserved.

---

## User Stories

### As a user…
- I want to upload a CSV so I don’t have to add beneficiaries one by one.
- I want to download a template so I know the correct formatting.
- I want to preview beneficiaries before adding them.
- I want to know exactly how many beneficiaries will be added.
- I want clear row-level errors so I can fix my CSV quickly.
- I want duplicates flagged so I don’t pay the same person twice.

---

## Functional Requirements
- Parse CSV client-side (or server-side) into row objects.
- Validate each row and surface row-level errors.
- Detect duplicates (within CSV; and optionally against existing records).
- Allow import of valid rows even if some rows are invalid (partial success).
- Create beneficiaries in the backend in a single operation (bulk API endpoint) or batched calls.

---

## UX Requirements
- Modal-based flow (no full page navigation).
- Clear hierarchy of actions:
  - Template download → upload → preview → confirm.
- Strong visual feedback for errors.
- Preserve user confidence: no silent failures; no ambiguity about what will be added.

---

## Future Enhancements (Out of Scope)
- Inline editing of rows inside the preview table.
- Bulk updates of existing beneficiaries.
- Export existing beneficiaries to CSV.
- Support for XLSX.

---

## Success Metrics
- Reduced time-to-onboard beneficiaries (minutes → seconds).
- High completion rate after file upload.
- Low error rate during import.
- Reduced support tickets related to beneficiary entry.

---

## Design Notes
This feature should feel like a **power tool**, but never intimidating. The preview step is mandatory to maintain user trust and prevent irreversible mistakes.
