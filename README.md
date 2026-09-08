# Disburse

Payroll batches, vendor payments, and treasury controls for finance teams, with stablecoin settlement and non-custodial accounts.

The v2 refactor includes a redesigned finance workspace, recipient imports, editable payment/bill/recurring flows, member budgets, Safe allowance proposals, and server-verified execution. See the [product review](docs/V2_REVIEW.md), [architecture and release notes](docs/ARCHITECTURE_V2.md), and [market research](docs/MARKET_RESEARCH.md) for implemented scope and remaining work.

## Tech Stack

- **Frontend**: React 19 + Vite + TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Runtime**: Bun
- **Hosting**: Cloudflare Pages

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) 1.4.0, pinned in `package.json` and CI
- A [Convex](https://convex.dev) account
- A [WalletConnect](https://cloud.walletconnect.com/) project ID

### Environment Variables

Create a `.env.local` file:

```bash
# Convex deployment URL (get from `bunx convex dev`)
VITE_CONVEX_URL=https://your-project.convex.cloud

# WalletConnect Project ID (get from cloud.walletconnect.com)
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

### Installation

```bash
bun install
```

### Development

```bash
bun run dev
```

### Populated, read-only product review

```bash
bun run dev:qa
```

Open `http://127.0.0.1:5174/org/demo/dashboard`. This serves actual workspace screens with local fixtures; signing and writes are disabled. QA mode cannot be built for production.

### Verification

```bash
bun run check
bunx playwright install chromium
bun run test:e2e
bun run test:contracts
node --test scripts/check-release-config.test.mjs
```

### Build

```bash
bun run build
```

### Preview Production Build

```bash
bun run preview
```

## Deployment

The frontend runs on Cloudflare Pages; Convex hosts the API, database and scheduled jobs. The release build publishes the matching backend and builds the frontend with that deployment's URL:

```sh
bun install --frozen-lockfile
bun run deploy
```

Configure Pages' build command as `bun run deploy` and its output directory as `dist`. Use a production Convex deploy key only in the production build environment; use an isolated preview target for PR builds. `bun run build:release` validates public configuration and builds locally without deploying. Copy public settings from [.env.example](.env.example). Service credentials belong in Convex or the hosting secret store.

The [deployment runbook](docs/DEPLOYMENT.md) covers target configuration, schema review, acceptance and rollback. The `public/_redirects` file handles direct navigation to app routes. This is a release candidate; deployment does not close the live acceptance items in [launch readiness](docs/LAUNCH_READINESS.md).

## Project Structure

```
src/
├── components/
│   ├── ui/           # Reusable UI components
│   ├── workspace/    # Shared finance screens and presentation
│   └── landing/      # Landing page components
├── features/         # Payment, treasury, team, and settings services
├── dev/qa/           # Serve-only adapters for browser QA
├── pages/            # Page components
├── lib/              # Utilities
└── App.tsx           # Main app with routing
```

## License

MIT

### V2 QA

See [the current runner guide](scripts/README.md) and [QA evidence](docs/QA_V2.md). Run
`bun run qa:testnet` for the isolated Sepolia wallet preflight,
`bun run qa:workspace` for authenticated development-backend checks, and
`bun run qa:screenshots` with `bun run dev:qa` running for visual artifacts.
Funded execution is opt-in through `bun run qa:testnet --execute`.

## V2 release review

Current release assessment: [Launch readiness](docs/LAUNCH_READINESS.md). The report separates implemented features from browser, provider and production acceptance still required. See [user stories](docs/USER_STORY_QA.md), [QA evidence](docs/QA_V2.md), [architecture](docs/ARCHITECTURE_V2.md), and [billing/pricing](docs/BILLING_AND_PRICING.md).

Product-wide requirements: the subscription licenses the software; customers pay all external service costs directly in stablecoins, including original Safe setup. Getting started must require only MetaMask and supported stablecoins, with zero native tokens. Disburse's application operating costs are limited to Convex and Cloudflare. This target and the remaining implementation gaps are recorded in [product and service requirements](docs/PRODUCT_AND_SERVICE_REQUIREMENTS.md).

Current customer-paid service status and testnet receipts: [September 7 QA report](docs/CUSTOMER_PAID_SERVICES_QA_2026-09-07.md).
