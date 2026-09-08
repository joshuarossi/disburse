# Deploying the v2 release candidate

Updated September 8, 2026 for `2.0.0-rc.1`. Cloudflare Pages hosts the React app; Convex provides the API, database, file storage and scheduled jobs. The PR remains a release candidate. Mainnet enablement requires the acceptance listed below.

Current local checks pass 1,187 unit/backend tests, frontend/Convex typecheck, lint and the release build. All 395 browser stories pass, including the separate Circle USDC fee review. Receiving-contract and release-configuration tests also pass. These browser stories use fixtures; the built-app testnet evidence below uses actual customer-funded receipts.

The previous committed build passed GitHub CI and Cloudflare Pages. Its deployed sign-in page was opened and verified in Chromium. A full development snapshot was restored into an isolated schema-only backend: 96,275 records across 62 nonempty tables and one stored file matched exactly. See [operations rehearsal](OPERATIONS_REHEARSAL.md). Production has not been modified by this rehearsal. Keys, sessions, authorizations and private journals stay outside source control.

## Release commands

```sh
bun install --frozen-lockfile
bun run check
bun run test:contracts
node --test scripts/check-release-config.test.mjs scripts/deploy.test.mjs
bunx playwright install chromium
bun run test:e2e
bun run build:release
```

Use Bun 1.4.0, as pinned in `package.json`. CI installs Chromium with its OS dependencies. The browser suite uses local fixtures; the separate built-app Sepolia runners exercise actual development-backend and network settlement. See [the runner guide](../scripts/README.md).

QA mode defines a reserved mock invoice-storage origin. Upload/download failure stories therefore do not depend on a developer's `.env.local` or contact that developer's backend. The mock origin is serve-only and is absent from release builds.

Both `build` and `build:release` check the public Convex URL, WalletConnect project ID, explicit relay setting and optional HTTP-action URL before building. `build:release` also typechecks. The checks reject a `.convex.site` URL for a different deployment and service-secret names exposed through `VITE_`. They cannot prove that a provider credential works. QA mode is serve-only and cannot produce a deployment artifact.

The existing Pages integration initially reported a successful PR preview while publishing a blank page. An actual Chromium navigation found `No address provided to ConvexReactClient`; the preview build had no Convex URL. The ordinary build now fails on that missing configuration. Configure the isolated preview backend and public settings before treating the Cloudflare build status as working-app evidence.

On September 7, GitHub CI passed all 644 tests, 267 browser stories and fifteen release configuration/deployment checks. The corrected command also completed through the Pages integration against an isolated Convex preview. The existing production deployment was backed up with file storage. Production sign-in is configured for `disburse.pro` and `disburse.pages.dev`; deployment and browser verification remain distinct from live payment/provider acceptance.

## Cloudflare Pages configuration

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | Repository root |
| Bun version | `BUN_VERSION=1.4.0` |
| Automatic dependency install | Disabled with `SKIP_DEPENDENCY_INSTALL=1` |
| Build command | `bun install --frozen-lockfile && bun run deploy` |
| Output directory | `dist` |

Set `CONVEX_DEPLOY_KEY` separately in the hosting secret store for each environment. Production builds require a `prod:` deployment key. PR builds require a `preview:<team>:<project>|...` project preview key. The deploy script rejects missing keys and keys assigned to the wrong environment before calling Convex. Never give an unreviewed PR a production key. The script and Pages project both use `main` as the production branch.

`bun run deploy` calls the pinned Convex CLI with `--cmd 'bun run build:release' --cmd-url-env-var-name VITE_CONVEX_URL --typecheck enable`. Convex selects the backend target and supplies its URL to the build, then publishes the functions and schema. Pages publishes `dist` only after that command succeeds. This coordinates the releases but is not an atomic deployment across both providers. Local deploys retain the CLI's interactive target confirmation; `bun run deploy --dry-run --yes` checks the plan without publishing.

Convex 1.31.7 does not detect `CF_PAGES_BRANCH`. The script passes it explicitly with that version's `--preview-create` flag. Treat these preview backends as disposable, with no customer data. After a successful preview deployment, the script configures its exact Pages deployment and branch-alias hosts in `SIWE_ALLOWED_DOMAINS`, along with `SIWE_DOMAIN` and `PUBLIC_APP_URL`. A configuration failure also fails the Pages build. Production backend settings are managed separately and are never copied from a preview. [Cloudflare preview aliases](https://developers.cloudflare.com/pages/configuration/preview-deployments/).

Do not retain a development `VITE_CONVEX_SITE_URL` in production or preview build settings. Omit it for ordinary Convex hosting so the client derives the matching `.convex.site` origin. If using a custom HTTP-action domain, configure and verify it on the selected backend. Pages supplies the SPA fallback when no root `404.html` exists. The former catch-all `_redirects` rule was rejected as a redirect loop and has been removed. [Convex deploy command](https://docs.convex.dev/cli/reference/deploy), [Cloudflare build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Pages SPA routing](https://developers.cloudflare.com/pages/configuration/serving-pages/).

## Public browser settings

Start from [.env.example](../.env.example). All `VITE_` values are public in the JavaScript bundle.

| Variable | Purpose |
| --- | --- |
| `VITE_CONVEX_URL` | Selected backend's `.convex.cloud` URL, supplied by the coordinated deployment command |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect project with the app/preview origins configured |
| `VITE_CONVEX_SITE_URL` | Optional HTTP-action origin for private invoice documents; normally derived |
| `VITE_GELATO_RELAY_ENABLED` | Explicit `true` or `false` for the build; a UI choice, not a server shutdown control |
| `VITE_GELATO_DEFAULT_FEE_TOKEN` | `USDC` or `USDT` |
| `VITE_GELATO_DEFAULT_FEE_MODE` | `stablecoin_preferred` or `stablecoin_only` |
| `VITE_RPC_URL_<chainId>` | Optional public endpoint for account/receipt reads |
| `VITE_ETHEREUM_RPC_URL`, `VITE_POLYGON_RPC_URL`, `VITE_BASE_RPC_URL`, `VITE_ARBITRUM_RPC_URL`, `VITE_SEPOLIA_RPC_URL`, `VITE_BASE_SEPOLIA_RPC_URL` | Optional wallet transport endpoints; matching `*_RPC_WS_URL` settings enable WebSockets |

Public RPC URLs may contain browser-restricted provider identifiers. Never use an unrestricted server key in them. Restrict and monitor those endpoints separately from server RPCs.

## Convex configuration

The [product-wide cost requirements](PRODUCT_AND_SERVICE_REQUIREMENTS.md) limit Disburse's application operating costs to Convex and Cloudflare. The configurations below describe current capabilities, not permission to open a paid third-party account. Do not enable customer services through Disburse-funded gas, email, RPC, indexing or other provider usage. Live MetaMask-and-stablecoins onboarding with zero native gas remains COST02 in [the TODO](../TODOS.md).

Set these on the selected Convex deployment through its environment settings or the installed CLI's `convex env set`. Setting them only in Cloudflare does not configure backend actions. Do not copy the QA deployment's credentials, wallet files, sessions or journals.

| Area | Server settings and behavior |
| --- | --- |
| Sign-in | `SIWE_ALLOWED_DOMAINS` lists exact allowed hosts, comma-separated. `SIWE_DOMAIN` is the canonical host. Include the intended preview host only on its isolated backend. |
| RPC | `RPC_URL_<chainId>` for current reads; `ARCHIVE_RPC_URL_<chainId>` for historical accounting checkpoints. Public defaults are fallbacks. |
| Licensing | `DISBURSE_LICENSE_OPERATORS` contains the full operator wallet addresses. Empty means no operator. Configure signup trial/free terms through `/admin/licenses`. |
| Paid subscriptions | `DISBURSE_BENEFICIARY_ADDRESS` is the receiving treasury; `DISBURSE_BENEFICIARY_CHAIN_ID` selects a supported billing network. Missing configuration disables new paid checkout. Free access and operator grants remain available. |
| Managed payments | Circle Paymaster charges the customer's Safe in USDC; the public submission endpoint requires no Disburse-funded account. Owner/delegate payments, schedules, policy changes, account operations, receivables and billing use durable customer-approved execution. Turbo remains disabled. See [managed payments](MANAGED_RELAY.md) and the [provider review](GELATO_V2_SETUP.md). |
| New workspace defaults | The current backend also reads `VITE_GELATO_DEFAULT_FEE_TOKEN` and `VITE_GELATO_DEFAULT_FEE_MODE`. Set these non-secret defaults on Convex if overriding the built-in USDC/preferred choices. |
| Private invitations | `PUBLIC_APP_URL`, `EMAIL_OUTBOX_KEY` (independent 32-byte secret encoded as 64 hex characters), and optional `EMAIL_OUTBOX_PREVIOUS_KEY` for rotation. No sending account is used. `RESEND_WEBHOOK_SECRET` only verifies historical callbacks. |
| Receiving invoices | `AR_FACTORY_<chainId>` must match the pinned deployed factory. Keep `AR_MAINNET_ENABLED` unset or `false` until contract review and mainnet acceptance. Issue/setup and collection use customer-approved Circle USDC fees on supported networks; the complete invoice principal reaches its treasury. Mainnet contract review remains required. |

Invitations are shared privately by their administrator; the app can open an email draft but never sends through a paid delivery API. Historical callbacks use `POST /webhooks/email` and retain signature verification. Details are in [team invitations](TEAM_INVITATIONS.md), [managed payments](MANAGED_RELAY.md), [billing checkout](BILLING_CHECKOUT.md), [licensing](LICENSE_MANAGEMENT.md) and [receiving invoices](ACCOUNTS_RECEIVABLE.md).

## Database review and rollout

1. Record the intended Convex deployment name, Pages project/domain and release commit. Inspect `bunx convex deploy --dry-run --yes --typecheck enable` against that target before publishing. `--yes` suppresses the CLI prompt; `--dry-run` prevents publishing. A dry run checks the deployment bundle and proposed changes; it does not replace actual target schema acceptance.
2. The existing production target contains records and must be backed up before release. The schema includes payment attempts/approvals, schedules, invoices, receiving receipts, accounting records, recipient reviews, invitations and licenses. No destructive migration is bundled. Do not delete historical signed transactions, payment attempts or audit records to make schema validation pass.
3. If the target contains data, export it with file storage before updating it. Use `bunx convex export --deployment-name <target> --include-file-storage --path <private-backup.zip>`. Keep the archive in restricted storage outside the repository. Rehearse restore only in an isolated deployment and inspect record counts, file links and recovery evidence there. Export/import does not restore external chain state, provider requests, environment secrets or all operational scheduler state.
4. Rehearse the coordinated build against the isolated target. Keep mainnet issuance off. Configure only the networks and providers being accepted. Do not enable paid checkout or managed fees merely because the build succeeds.
5. After the approved production release, verify the actual deployed URL and direct navigation to sign-in, workspace settings, recipients, payment review, reports and invoice links. Confirm the browser is using the intended backend. Check sign-in domain enforcement and denied access from an unrelated wallet.
6. Verify the runtime acceptance below before treating the release as available for customer payment work. Record receipts and provider IDs in restricted evidence, without keys or signed session tokens.

`convex codegen` only regenerates bindings. Use `convex dev --once` to publish development functions and the coordinated release command for the chosen deployment. Regenerated types alone do not mean the backend is running the new code.

## Acceptance still required for a public launch

| Area | Evidence still needed |
| --- | --- |
| Managed fee payment | Built-app exact principal/fee settlement, declined approvals and durable reconciliation pass on Base Sepolia. Broader provider-outage and production acceptance remain. |
| Unattended schedule | Due USDC-fee execution with browsers closed, independent authorization order and on-chain cancellation pass on Base Sepolia. Production outage acceptance remains. |
| Paid license | Real 50 USDC Team activation and renewal pass. Pro upgrade credit has automated coverage; the live receipt remains acceptance work. |
| Customer wallet | Direct/nested two-owner approval, rejection/reload and real testnet settlement pass through isolated EIP-1193 wallets. Original/existing-account MetaMask mainnet and extension/mobile connector acceptance remain. |
| Accountant workflow | Actual external-ledger import, corrections and period-close acceptance |
| Operations | Development schema acceptance, exact backup/restore and bounded queue-monitoring failure/recovery pass. Production target review, alert delivery, staffing and independent security review remain. |
| Mainnet receivables | USDC-fee setup/collection and reviewed customer refunds pass on Base Sepolia. Independent receiving-contract review and broader live failure acceptance remain. |

The full current assessment is [launch readiness](LAUNCH_READINESS.md). Direct Aave lending, reviewed Uniswap conversion and Circle CCTP account transfers are implemented and have exact live testnet receipts. See [lending](LENDING.md), [conversions](CONVERSIONS.md) and [account transfers](ACCOUNT_TRANSFERS.md). Mainnet acceptance is separate. Customer funds remain in their Safes; license changes never alter ownership or cover network/provider fees.

## Recovery and rollback

Retain the previous Pages deployment, its commit and corresponding backend source. A Pages rollback changes only the frontend. It does not revert Convex functions, data, scheduled work, Safe authorizations or network transactions. After the first v2 writes, the old POC backend is not a safe automatic rollback target.

For a release failure, preserve current payment attempts and approvals, investigate provider/chain settlement, and deploy a reviewed compatible fix. Do not restore an old database snapshot over live transaction evidence or replay a payment whose outcome is unknown. For new relay submissions, remove the affected server provider/fee configuration while investigating; removing a browser flag alone does not stop server jobs, and an already accepted transaction can still settle. Continue read-only receipt checks for existing attempts where provider access remains available.

Inspect function failures, scheduled jobs, payment exception queues and provider outcomes after release. Run the bounded read-only operator check in [operations rehearsal](OPERATIONS_REHEARSAL.md). Assign an operator to investigate unresolved attempts using the original record. External alert delivery and incident staffing remain launch work; the isolated backup/restore and monitoring failure/recovery rehearsal is complete.
