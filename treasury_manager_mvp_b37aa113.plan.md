---
name: Treasury Manager MVP
overview: Build and deploy a professional landing page first on Cloudflare Pages, then incrementally add React + Vite app features with Convex backend, RainbowKit wallet connection, and Safe Protocol integration targeting Sepolia testnet.
todos:
  - id: scaffold
    content: Initialize Vite + React + TypeScript project with Bun
    status: completed
  - id: tailwind-shadcn
    content: Configure Tailwind CSS and install core shadcn/ui components
    status: completed
    dependencies:
      - scaffold
  - id: landing-page
    content: Build professional landing page with hero, features, CTAs
    status: completed
    dependencies:
      - tailwind-shadcn
  - id: cloudflare-deploy
    content: Configure and deploy landing page to Cloudflare Pages
    status: completed
    dependencies:
      - landing-page
  - id: convex-setup
    content: Set up Convex project and define schema
    status: completed
    dependencies:
      - cloudflare-deploy
  - id: wallet-config
    content: Configure RainbowKit + wagmi for Sepolia
    status: completed
    dependencies:
      - cloudflare-deploy
  - id: auth-flow
    content: Implement SIWE authentication with Convex
    status: completed
    dependencies:
      - convex-setup
      - wallet-config
  - id: rbac-layer
    content: Build RBAC enforcement in Convex functions
    status: completed
    dependencies:
      - convex-setup
  - id: org-management
    content: Create org selection and creation flow
    status: completed
    dependencies:
      - auth-flow
      - rbac-layer
  - id: safe-integration
    content: Integrate Safe Protocol Kit for Safe deployment/linking
    status: completed
    dependencies:
      - wallet-config
      - org-management
  - id: beneficiaries
    content: Build beneficiaries CRUD pages
    status: completed
    dependencies:
      - org-management
  - id: disbursements
    content: Implement disbursement flow with Safe transactions
    status: completed
    dependencies:
      - safe-integration
      - beneficiaries
  - id: dashboard
    content: Create main dashboard with balances and activity
    status: completed
    dependencies:
      - safe-integration
      - disbursements
  - id: billing
    content: Implement billing page and trial management
    status: completed
    dependencies:
      - disbursements
  - id: settings
    content: Build org settings and team management
    status: completed
    dependencies:
      - org-management
---

# Stablecoin Treasury Manager MVP Implementation Plan

## Tech Stack

| Layer | Technology |

|-------|------------|

| Frontend | React 19 + Vite + TypeScript |

| Styling | Tailwind CSS + shadcn/ui |

| Wallet | RainbowKit + wagmi v2 + viem |

| Backend | Convex |

| Blockchain | Safe Protocol Kit + Safe API Kit |

| Network | Sepolia Testnet |

| Tokens | USDC, USDT (testnet addresses) |

| Runtime | Bun |

| Hosting | Cloudflare Pages |

## Architecture Overview

```mermaid
flowchart TB
    subgraph frontend [Frontend SPA]
        LP[Landing Page]
        App[App Shell]
        RK[RainbowKit]
    end
    
    subgraph convex [Convex Backend]
        Auth[Auth/Sessions]
        RBAC[RBAC Layer]
        Data[Data Layer]
        Audit[Audit Logs]
    end
    
    subgraph blockchain [Blockchain Layer]
        Safe[Safe Protocol Kit]
        TxService[Safe Transaction Service]
        RPC[Ethereum RPC - Sepolia]
    end
    
    LP --> App
    App <--> RK
    RK <--> RPC
    App <--> convex
    App <--> Safe
    Safe <--> TxService
    Safe <--> RPC
```

---

## Phase 1: Project Scaffolding (Landing Page Only)

Initialize a minimal project for the landing page deployment.

**Initial Directory Structure:**

```
disburse/
├── src/
│   ├── components/
│   │   ├── ui/           # shadcn components
│   │   └── landing/      # Landing page components
│   ├── pages/
│   │   └── Landing.tsx
│   ├── lib/
│   │   └── utils.ts
│   └── App.tsx
├── public/
│   └── _redirects        # Cloudflare Pages SPA routing
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

**Phase 1 Dependencies (minimal):**

- `react`, `react-dom`, `react-router-dom`
- `tailwindcss`, `@radix-ui/*` (via shadcn)
- `lucide-react` (icons)
- `framer-motion` (animations)

---

## Phase 2: Landing Page + Deploy

Build a professional, modern landing page and deploy immediately to Cloudflare Pages.

### Landing Page Sections

1. **Navigation Header**

   - Logo/brand name
   - "Login" button (links to `/login`, placeholder for now)
   - "Try For Free" button (primary CTA)

2. **Hero Section**

   - Bold headline: "Treasury Management for Web3 Teams"
   - Subheadline explaining non-custodial stablecoin disbursements
   - Two CTAs: "Try For Free" (primary) + "Learn More" (secondary)
   - Subtle animated background or gradient

3. **Features Grid** (4-6 cards)

   - Non-Custodial: Your keys, your funds
   - Safe-Powered: Built on Gnosis Safe
   - Audit Trail: Complete transaction history
   - Stablecoin Native: USDC, USDT support
   - Role-Based Access: Team permissions
   - Simple Billing: Pay in stablecoins

4. **How It Works** (3-step flow)

   - Connect your Safe
   - Add beneficiaries
   - Send payments

5. **CTA Section**

   - "Start your 30-day free trial"
   - "Try For Free" button

6. **Footer**

   - Links (placeholder): Docs, Support, Terms, Privacy
   - Copyright

### Design Direction

- **Theme**: Dark mode with deep navy/charcoal background
- **Accent**: Vibrant teal/cyan gradient for CTAs and highlights
- **Typography**: Satoshi or Plus Jakarta Sans (distinctive, modern)
- **Effects**: Subtle gradient orbs, smooth fade-in animations on scroll
- **Layout**: Generous whitespace, large typography, clear visual hierarchy

### Cloudflare Pages Deployment

- Create `public/_redirects` file for SPA routing: `/* /index.html 200`
- Build command: `bun run build`
- Install command: `bun install`
- Output directory: `dist`
- Connect GitHub repo to Cloudflare Pages for auto-deploy

---

## Phase 3: Backend + Wallet Setup (Post-Deploy)

After the landing page is live, add the remaining dependencies:

- `@rainbow-me/rainbowkit`, `wagmi`, `viem`, `@tanstack/react-query`
- `convex`

Expand directory structure:

```
├── convex/
│   ├── schema.ts
│   ├── auth.ts
│   ├── users.ts
│   ├── orgs.ts
│   ├── beneficiaries.ts
│   ├── disbursements.ts
│   └── audit.ts
├── src/
│   ├── lib/
│   │   ├── wagmi.ts      # Wallet config
│   │   └── convex.ts     # Convex client
```

---

## Phase 4: Wallet Authentication

Implement SIWE (Sign-In with Ethereum) flow with Convex:

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant RainbowKit
    participant Convex
    
    User->>Frontend: Click Connect
    Frontend->>RainbowKit: Open Modal
    User->>RainbowKit: Select Wallet
    RainbowKit->>Frontend: Wallet Connected
    Frontend->>Convex: Request Nonce
    Convex->>Frontend: Return Nonce
    Frontend->>RainbowKit: Sign Message
    User->>RainbowKit: Approve Signature
    RainbowKit->>Frontend: Signature
    Frontend->>Convex: Verify Signature
    Convex->>Frontend: Session Token
    Frontend->>Frontend: Store Session
```

**Convex Functions:**

- `auth.generateNonce` - Create challenge nonce
- `auth.verifySignature` - Verify SIWE signature, create/update user, issue session
- `auth.getSession` - Validate active session

---

## Phase 5: Convex Data Layer

Define schema in `convex/schema.ts`:

```typescript
// Core tables based on architecture doc
users: { walletAddress, email?, createdAt }
orgs: { name, createdBy, createdAt }
orgMemberships: { orgId, userId, role, status }
safes: { orgId, chainId, safeAddress }
beneficiaries: { orgId, name, walletAddress, notes, isActive }
disbursements: { orgId, safeId, beneficiaryId, token, amount, memo, status, safeTxHash, txHash }
billing: { orgId, plan, trialEndsAt, paidThroughAt, status }
auditLog: { orgId, actorUserId, action, objectType, objectId, metadata, timestamp }
```

**RBAC Enforcement:**

- Helper function to check user role before mutations
- Roles: Admin, Approver, Initiator, Clerk, Viewer

---

## Phase 6: Core Application Features

Add Safe Protocol dependencies when this phase starts:

- `@safe-global/protocol-kit`, `@safe-global/api-kit`

### 6.1 Org Management

- `/select-org` - List user's orgs, create new org
- Org creation flow creates billing record with 30-day trial

### 6.2 Safe Integration

- Use Safe Protocol Kit to deploy new Safe or link existing
- Store Safe address in Convex
- Fetch Safe balances via viem

### 6.3 Beneficiaries CRUD (`/org/:id/beneficiaries`)

- List, create, edit, deactivate beneficiaries
- Validate wallet addresses

### 6.4 Disbursements (`/org/:id/disbursements`)

- Create disbursement draft in Convex
- Build ERC20 transfer tx via Safe Protocol Kit
- Propose to Safe Transaction Service
- Execute (single-signer MVP)
- Update Convex with txHash
- Real-time status updates

### 6.5 Dashboard (`/org/:id/dashboard`)

- Safe balance (USDC, USDT)
- Recent disbursements
- Quick actions

---

## Phase 7: Billing and Settings

### Billing (`/org/:id/billing`)

- Display trial status / paid status
- Stablecoin payment via in-app disbursement to platform wallet

### Settings (`/org/:id/settings`)

- Org name
- Team members (invite, change roles)
- Connected Safe details

---

## Token Addresses (Sepolia)

| Token | Address |

|-------|---------|

| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |

| USDT | `0x7169D38820dfd117C3FA1f22a697dBA58d90BA06` |

---

## Routes Summary

| Route | Description |

|-------|-------------|

| `/` | Landing page |

| `/login` | Wallet connection + SIWE |

| `/select-org` | Org selection/creation |

| `/org/:id/dashboard` | Main dashboard |

| `/org/:id/beneficiaries` | Beneficiary management |

| `/org/:id/disbursements` | Payment management |

| `/org/:id/billing` | Subscription management |

| `/org/:id/settings` | Org settings |

---

## Implementation Order

**Milestone 1: Landing Page Live**

1. Project scaffold (Vite + React + Tailwind)
2. Build landing page with all sections
3. Deploy to Cloudflare Pages

**Milestone 2: Auth Working**

4. Add Convex + RainbowKit dependencies
5. Implement wallet authentication

**Milestone 3: Core Features**

6. Org management + RBAC
7. Safe integration
8. Beneficiaries CRUD
9. Disbursements flow
10. Dashboard

**Milestone 4: MVP Complete**

11. Billing system
12. Settings pages