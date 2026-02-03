# Release Notes

## v0.3.0 (Current Release)

### 🎉 Major Features

#### Batch Disbursements
- **Multi-Recipient Payments**: Added support for creating batch disbursements that pay multiple beneficiaries in a single Safe transaction
- **Progressive UI**: Implemented intuitive progressive form that allows users to add recipients one at a time
- **Single Transaction**: All recipients in a batch are paid atomically in one Safe transaction using MultiSend
- **Batch Detail View**: Added detailed modal view showing all recipients in a batch disbursement with breakdown
- **Smart Totals**: Real-time total calculation that includes both added recipients and the current input row
- **Visual Breakdown**: Improved total summary with line-item breakdown showing each recipient and amount

### 🔧 Improvements

#### User Experience
- **Better Form Flow**: Redesigned batch disbursement form with locked recipient cards appearing above the input row
- **Improved Alignment**: Fixed action column alignment in disbursements table for consistent visual presentation
- **Enhanced Modals**: Replaced browser alerts with styled confirmation modals for better UX
- **Clear Button Labels**: Improved cancel confirmation modal with distinct "Cancel" (dismiss) and "Yes, Cancel Disbursement" (confirm) buttons

#### Data Model
- **Schema Updates**: Extended disbursements table with `type` (single/batch) and `totalAmount` fields
- **Recipients Table**: Added new `disbursementRecipients` table to track individual recipients in batch disbursements
- **Backward Compatibility**: Existing single disbursements continue to work seamlessly with new batch functionality

#### Safe Integration
- **Batch Transaction Support**: Added `createBatchTransferTxs` helper function for creating multiple ERC-20 transfers
- **Atomic Execution**: Batch disbursements execute atomically - all transfers succeed or none do
- **MultiSend Integration**: Leverages Safe's native MultiSend functionality for efficient batch transactions

#### Reports
- **Batch Support**: Updated reports to handle batch disbursements, showing "Batch" as beneficiary name
- **Total Amount Display**: Reports now correctly display total amounts for batch disbursements

### 🌐 Internationalization
- Added batch-related translation keys to all supported locales (English, Spanish, Portuguese)
- Improved translation strings for batch operations

### 🐛 Bug Fixes
- Fixed beneficiary dropdown not showing selected value in batch mode
- Fixed total display showing extra characters in pluralization
- Fixed alignment issues in Actions column
- Fixed reports query to handle optional beneficiaryId for batch disbursements

### 📝 Documentation
- Added comprehensive PRD for batch disbursements feature (`PRD_Batch_Disbursements.md`)

### 📊 Statistics
- **15+ files changed**
- **2,000+ additions**
- **500+ deletions**

---

# Unreleased

### ⚡ Gasless Execution

- Added Gelato relay integration for Safe execution with USDC-first fee payment and native fallback.
- Added relay status tracking and polling for relayed disbursements.

---

## v0.2.0

### 🎉 Major Features

#### Disbursements Management
- **Advanced Filtering & Search**: Added comprehensive filtering, searching, sorting, and pagination capabilities to disbursement listings
- **Multi-Status Support**: Enhanced query handling for multiple disbursement statuses and date ranges
- **Cancel Functionality**: Introduced ability to cancel disbursements with improved status handling
- **Draft Status**: Added new 'draft' status for disbursements in progress
- **Data Enrichment**: Disbursement data now includes enriched beneficiary details for better context

#### Dashboard Enhancements
- **Real-Time Monitoring**: Implemented real-time monitoring of USDC and USDT transfer events using `useWatchContractEvent`
- **Live Balance Updates**: Dashboard now automatically updates balances when transfer events occur
- **Copy Address Feature**: Added clipboard copy functionality for Safe addresses in the Dashboard

#### Billing & Beneficiaries
- **Tier Limits**: Introduced tier-based limits for organizations
- **Beneficiary Types**: Added support for both individual and business beneficiary types
- **Enhanced Management**: Improved billing and beneficiaries management interfaces

### 🔧 Improvements

#### Safe API Integration
- **Address Checksumming**: Enhanced Safe API integration with proper address checksumming
- **Improved Logging**: Added comprehensive logging for transaction processes and debugging
- **Error Handling**: Refactored Safe API integration with enhanced error handling
- **Validation**: Added validation logging for Safe address linking in Settings

#### Authentication & Routing
- **Protected Routes**: Implemented protected routes for organization-specific pages
- **Sign-In Flow**: Improved sign-in flow in Login.tsx with better state management
- **Route Protection**: Enhanced routing with organization-specific route protection

### 🧪 Testing Infrastructure

- **Comprehensive Test Suite**: Added extensive test coverage including:
  - Authentication tests (`auth.test.ts`)
  - Beneficiaries tests (`beneficiaries.test.ts`)
  - Billing tests (`billing.test.ts`)
  - Disbursements tests (`disbursements.test.ts`)
  - Organization tests (`orgs.test.ts`)
  - RBAC tests (`rbac.test.ts`)
  - Integration tests for billing upgrades, disbursement flows, and org setup
  - Frontend component tests (`Button.test.tsx`)
  - Safe integration tests (`safe.test.ts`)
  - Utility tests (`utils.test.ts`)

- **Test Configuration**: Added Vitest configuration with separate projects for frontend and Convex backend testing
- **Test Scripts**: Added new testing scripts in package.json:
  - `test:convex` - Run Convex backend tests
  - `test:frontend` - Run frontend tests
  - `test:coverage` - Generate test coverage reports

### 📦 Dependencies & Configuration

- Updated package dependencies
- Added test setup files and configurations
- Improved TypeScript configuration

### 📝 Documentation

- Added comprehensive PRD documentation (`Stablecoin_Treasury_Manager_PRD_v1_3_MVP.md`)

### 🔄 Database & Migrations

- Added migration script for backfilling beneficiary types (`backfillBeneficiaryType.ts`)
- Enhanced schema with new fields and types

### 📊 Statistics

- **34 files changed**
- **8,471 additions**
- **299 deletions**

---

## v0.1.0

### Initial Release
- Initial project setup with React, Vite, and TypeScript
- Landing page components
- Basic routing and styling with Tailwind CSS
- Convex integration
- RainbowKit for wallet connection
- Basic authentication flow
