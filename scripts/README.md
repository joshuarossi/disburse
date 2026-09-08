# Development and QA runners

Run ordinary checks from the repository root:

```sh
bun run check
bun run test:e2e
bun run build
bun run test:contracts
node --test scripts/check-release-config.test.mjs
```

Playwright's ordinary suite uses the controlled QA fixtures. It verifies user stories and failure states; it does not establish live provider settlement. `bun run dev:qa` serves those fixtures on port 5174.

Use `bun run build:release` for a checked release artifact and the [deployment runbook](../docs/DEPLOYMENT.md) for publishing. `bun run deploy` publishes the selected Convex backend and builds the matching frontend; it is not a local verification command.

## Built-app Sepolia acceptance

The current payment runners use the built app, the development backend and isolated host-held wallets. They check the allowed deployment, account and Sepolia chain. Their local journals prevent blind replay of completed or uncertain transactions. They do not use the replaced Safe transaction-service submission flow.

| Runner | Acceptance |
| --- | --- |
| `qa-browser-payments.mjs` | Nested payment approvals, rejected signatures/sends, reload and exact settlement |
| `qa-browser-policies.mjs` | Grant and revoke through two parent signers |
| `qa-browser-cancellations.mjs` | Signed original, cancellation approvals, original-nonce replacement and recovery |
| `qa-browser-delegated.mjs` | Allowance payment, explicit native fees, rejected signatures/sends and background recovery without a returned hash |
| `qa-license-management.mjs` | Temporary dev-only operator authorization, complimentary Pro grant through the normal build, billing reload, unchanged paid history, and restoration |

Build and serve the native-fee QA app before running these scripts:

```sh
VITE_GELATO_RELAY_ENABLED=false bunx vite build --outDir .local/qa/browser-build
bunx vite preview --outDir .local/qa/browser-build --host 127.0.0.1 --port 4180 --strictPort
```

Run an individual runner with Bun from another terminal. The native-fee build setting is deliberate; it does not verify managed provider execution. Review each script's preflight and local journal before reusing the isolated fixtures. Completed runners report their existing result instead of paying again. Wallet keys and private journals stay under ignored `.local/qa`; do not publish them.

The four older `qa-funded-workspace`, `qa-native-recovery`, `qa-native-fee-acceptance` and `qa-two-owner-workspace` scripts were removed with their unused Safe API Kit dependency. Their historical receipts remain in the QA reports. Lower-level contract, accounting, recipient, invoice and network runners remain useful for their narrower checks. They are not substitutes for the built-app stories.

Current evidence and remaining acceptance are in [the QA report](../docs/QA_V2.md) and [active TODO](../TODOS.md).

## Customer-paid execution QA

Both runners require the isolated wallet under `.local/qa/wallet.json`. They never print its key or fund an application gas balance. They save each unique run before sending and refuse to resubmit it. Default behavior is simulation; `--execute` explicitly spends test funds. `--status` only checks the original request.

```sh
bun run qa:customer-setup --run=unique-setup
bun run qa:customer-setup --run=unique-paid-setup --execute
bun run qa:customer-setup --run=unique-paid-setup --status

bun run qa:customer-fees --run=unique-payment --safe=<test-safe>
bun run qa:customer-fees --run=unique-paid-payment --safe=<test-safe> --execute
bun run qa:customer-fees --run=unique-paid-payment --status
```

The setup runner uses the application’s quote, permit and authenticated recovery code against the development backend. It requires canonical Base Sepolia USDC and zero native ETH in the signing wallet. A successful quote does not mean the provider accepted execution.

The payment runner exercises the published Safe4337/Circle protocol using an already funded, sole-owner Base Sepolia test Safe. It does not establish complete in-app payment integration or original onboarding. Its deliberate `--force-failure` option exists only to verify fees and recovery after a mined failed operation. Do not copy that simulation bypass into a product flow.

Actual receipts, failure results and remaining work are in [the customer-paid services report](../docs/CUSTOMER_PAID_SERVICES_QA_2026-09-07.md).

## License acceptance

`bun scripts/qa-license-management.mjs` uses the normal build at `http://127.0.0.1:4190` and the isolated QA company. It temporarily updates the development operator allowlist, then restores it in `finally`. The company grant is restored as well. It cannot send a network transaction. A restricted journal supports `--restore` after an interruption. Run this against a synchronized development backend; `convex codegen` alone generates bindings and does not publish the new function routes.

`qa-receivable-workflows.mjs --phase=browser|status|inspect` exercises the fixed, already-collected Base Sepolia QA invoice through credit issuance and a 0.01 USDC customer refund. It uses the built app on port 4183 and the hosted development backend, keeps its journal under `.local/qa/receivable-workflows`, and refuses to replay a submission. The wallet prompt is intentionally declined once. Status verifies exact block balance changes and the separate customer fee; inspect checks the completed payment and public credit statement. It is not a general-purpose refund command.
