# Stablecoin Treasury Manager

## Product Requirements Document

**Version 1.3 — MVP Focus**

*A non-custodial, enterprise-grade treasury management SaaS for stablecoins.*

---

**Scope Legend:** `[MVP]` = v1.0 Launch | `[v1.5]` = Near-term | `[v2.0+]` = Future

---

## 1. Strategic Positioning

### What This Product Is

Software for managing stablecoin treasury operations: beneficiary management, approval workflows, disbursement execution, and financial reporting.

### What This Product Is Not

- Not a payment processor or money transmitter
- Not a custodian—we never hold or control customer funds
- Not an exchange or on/off-ramp
- Not financial infrastructure or rails

### Positioning Analogy

> *This product is to stablecoins what QuickBooks is to banking.* QuickBooks didn't replace banks—it gave small businesses professional tools to manage their finances without hiring accountants. We give businesses professional tools to manage stablecoin operations without hiring blockchain engineers.
>
> **Coinbase, Circle, and others are building Visa. We're building Intuit. They don't compete on tooling; we don't compete on rails.**

---

## 2. Problem Statement

Small and mid-sized businesses are increasingly using stablecoins for treasury operations—payroll, contractor payments, vendor disbursements, and international transfers. However, they currently rely on:

- Spreadsheets to track beneficiaries and payment schedules
- Exchange interfaces not designed for treasury workflows
- Manual Safe management requiring blockchain expertise
- No approval workflows, audit trails, or role-based access

This approach is error-prone, difficult to audit, and disconnected from standard finance workflows. As stablecoin adoption scales, businesses need professional tooling—not more spreadsheets.

---

## 3. Core Principles

- **Non-custodial by design:** Private keys are never stored, transmitted, or accessible to the platform
- **Wallet = Person, Safe = Organization:** Clear identity model mapping to business structures
- **Self-service only:** No sales-gated features, no mandatory onboarding calls
- **Enterprise mental model, SMB pricing:** Professional controls at accessible price points
- **Software licensing, not financial rails:** We sell tools, not transaction processing
- **Blockchain abstraction:** Users think in finance terms; we handle blockchain mechanics

---

## 4. Target Customer

### Primary: SMBs Already Using Stablecoins

- 5-100 employees
- Already hold stablecoins for operational use
- Currently using spreadsheets + exchanges for treasury
- Pain points: manual processes, audit gaps, no approval workflows

### Typical Users

- Finance managers responsible for payments
- Operations leads managing contractor disbursements
- Founders at early-stage companies wearing multiple hats
- CFOs seeking audit-ready processes

---

## 5. Technical Scope

### MVP Technical Stack `[MVP]`

| Component | Specification |
|-----------|---------------|
| **Blockchain** | Ethereum Mainnet |
| **Stablecoins** | USDC, USDT |
| **Wallet Support** | MetaMask, WalletConnect (hardware wallet compatible) |
| **Execution Layer** | Safe smart contracts (formerly Gnosis Safe) |
| **Safe Limit** | 1 Safe per organization |
| **Gas Fees** | User-paid; estimates displayed before signing |
| **Authentication** | Wallet-based via signed messages (no passwords) |

### Technical Roadmap

- **v1.5:** L2 chains (Arbitrum, Base, Polygon)
- **v1.5:** Multiple Safes per organization
- **v3.0:** Additional stablecoins (DAI, PYUSD)

---

## 6. Pricing Structure

### MVP Pricing Tiers `[MVP]`

| Tier | Price | Limits | Features |
|------|-------|--------|----------|
| **Starter** | $25/mo | 1 user, 1 Safe, 25 beneficiaries | One-time disbursements, audit logs, CSV export |
| **Team** | $50/mo | 5 users, 1 Safe, 100 beneficiaries | Organizations, all 5 roles, multi-sig approval |
| **Pro** | $99/mo | Unlimited users, 1 Safe, unlimited beneficiaries | Professional reports, priority support |

**Annual billing:** 2 months free (pay for 10, get 12)

**Free trial:** 30 days, Team tier access, no credit card required

### Tier Expansion Roadmap `[v1.5]`

- Team tier: Increase to 10 users, add 3 Safes
- Pro tier: Unlimited Safes
- All tiers: Scheduled and recurring payments

### Premium Add-Ons `[v2.0+]`

*Note: Add-ons will not ship in v1.0. This section documents planned monetization extensions.*

| Add-On | Price | Description |
|--------|-------|-------------|
| Sanctions Screening | +$29/mo | OFAC/SDN screening of beneficiary names and wallet addresses |
| Enhanced Compliance | +$99/mo | Chainalysis/Elliptic integration, transaction risk scoring |
| Tax Reporting | +$19/mo | Cost basis tracking, annual summaries, accountant-ready exports |
| API Access | +$49/mo | Programmatic access for custom integrations |

---

## 7. MVP Functional Scope `[MVP]`

> **MVP Focus:** Ship the minimum required to prove the core thesis—that SMBs will pay for professional stablecoin treasury tooling. Every feature below ships in v1.0.

### Safe Management

- In-app Safe creation with guided setup
- Import existing Safe by address
- Signer management and threshold configuration

### Beneficiary Management

- Add individuals and companies as beneficiaries
- Store name, wallet address, and metadata
- Beneficiary categories and tags
- Address validation before save

### Disbursements

- One-time stablecoin payments to single beneficiary
- Multi-sig approval workflow (configurable threshold)
- Transaction status tracking (pending, signed, executed, failed)
- Gas estimate display before signing

### Reporting & Audit

- Complete audit logs (append-only, immutable)
- Transaction history with filtering
- CSV export of all data
- Basic dashboard (balances, recent activity)

---

## 8. Features NOT in MVP

The following features are explicitly **out of scope** for v1.0 to ensure fast time-to-market. They are planned for subsequent releases.

| Feature | Target | Rationale for Deferral |
|---------|--------|------------------------|
| Batch disbursements | v1.5 | Adds UI and transaction complexity |
| Scheduled payments | v1.5 | Requires background job infrastructure |
| Recurring payments | v1.5 | Depends on scheduling infrastructure |
| Multiple Safes per org | v1.5 | Natural upsell trigger; simplifies MVP data model |
| L2 chain support | v1.5 | Multi-chain adds testing and UX complexity |
| Gas optimization / smart scheduling | v2.0 | Complex to build correctly; not core value prop |
| Sanctions screening | v2.0 | Requires vendor integration and compliance review |
| Accounting integrations | v2.0 | QuickBooks/Xero APIs add significant scope |
| Public API | v3.0 | API design should be informed by real usage patterns |

---

## 9. Roles & Permissions `[MVP]`

| Role | Permissions |
|------|-------------|
| **Admin** | Full access: organization settings, billing, user management, all operations |
| **Approver** | Approve and sign proposed payments; view all data |
| **Initiator** | Create and propose payments; cannot approve own proposals |
| **Clerk** | Manage beneficiaries; create draft payments; read-only reports |
| **Viewer** | Read-only access to all data and reports |

*Note: All 5 roles ship in MVP. Starter tier has only Admin role (single user). Team and Pro tiers unlock all roles.*

---

## 10. License Expiration Behavior `[MVP]`

**Critical principle:** License expiration restricts software features only, never access to funds.

| Status | Behavior |
|--------|----------|
| **Always Permitted** | Direct Safe access via safe.global (users control their own wallets) |
| **Read-Only Mode** | View historical data, beneficiaries, disbursement records, audit logs |
| **Restricted** | Initiating payments, editing beneficiaries, generating new reports |

---

## 11. Security Model `[MVP]`

- **Non-custodial:** Private keys are never stored, transmitted, or accessible to the platform
- **User-signed:** All transactions require explicit user signature via their wallet
- **On-chain truth:** Blockchain state is the ultimate source of truth; platform data is supplementary
- **Immutable audit:** Audit logs are append-only and cannot be modified or deleted
- **No fund access:** Platform cannot initiate, approve, or execute transactions without user action

---

## 12. Onboarding Experience `[MVP]`

Designed for finance professionals who may not have blockchain experience.

1. **Wallet Connection:** Connect MetaMask or WalletConnect; guidance for first-time wallet users
2. **Organization Setup:** Name organization, select tier
3. **Safe Setup:** Create new Safe or import existing; configure signers
4. **First Beneficiary:** Add first beneficiary with address validation
5. **Ready to Disburse:** Dashboard with clear next steps

**Target:** Complete onboarding in under 10 minutes for users with existing wallet.

---

## 13. Success Metrics (MVP)

| Metric | Target (90 days) | Stretch |
|--------|------------------|---------|
| Organizations onboarded | 50 | 100 |
| Trial-to-paid conversion | 20% | 30% |
| Monthly disbursement volume | $500K | $2M |
| Avg beneficiaries per org | 8 | 15 |
| Multi-sig feature adoption (Team+) | 40% | 60% |

---

## 14. Product Roadmap

| Version | Capabilities |
|---------|--------------|
| **v1.0** | MVP: Ethereum mainnet, USDC/USDT, one-time disbursements, 1 Safe per org, core approval workflows, audit logs |
| **v1.5** | Batch disbursements, scheduled & recurring payments, multiple Safes, L2 chains (Arbitrum, Base, Polygon) |
| **v2.0** | Accounting integrations (QuickBooks, Xero), sanctions screening add-on, gas optimization, smart scheduling |
| **v2.5** | Zapier integration, webhooks, enhanced compliance add-on (Chainalysis/Elliptic) |
| **v3.0** | Public API, additional stablecoins (DAI, PYUSD), ERP beneficiary sync, tax reporting |

---

## 15. Competitive Differentiation

| Dimension | Competitors | Our Approach |
|-----------|-------------|--------------|
| Business Model | Financial infrastructure / rails | Pure software tooling |
| Pricing | Volume-based, enterprise sales | Flat subscription, self-service |
| Regulatory | Money transmitter exposure | Software license only |
| Target Customer | DAOs, crypto-native orgs | Traditional SMBs using stablecoins |
| UX Philosophy | Crypto-native interface | Finance-native, blockchain abstraction |

---

## 16. Blockchain Abstraction Vision `[v2.0+]`

*Note: This section describes the long-term vision for blockchain abstraction. MVP will include gas estimates only; optimization features are v2.0+.*

Users will interact with financial concepts (payment dates, recipients, amounts). The platform will handle blockchain mechanics invisibly.

### Gas Optimization (v2.0)

- Real-time gas price monitoring and forecasting
- Execution timing optimization within user-defined windows
- Savings estimates shown before scheduling

### Scheduling Modes (v2.0)

- **Deadline Guaranteed:** Payment arrives by specified time
- **Cost Optimized:** Payment sent within window when gas is lowest

### Intelligent Execution (v2.0)

- Automatic nonce management
- Failed transaction detection and retry
- Stuck transaction speedup/replacement
- Plain-language status notifications

---

*— End of PRD v1.3 —*

*MVP-focused with clear roadmap separation*
