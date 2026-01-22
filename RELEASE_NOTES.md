# Release Notes

## v0.2.0 (Current Release)

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
