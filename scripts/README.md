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

## License acceptance

`bun scripts/qa-license-management.mjs` uses the normal build at `http://127.0.0.1:4190` and the isolated QA company. It temporarily updates the development operator allowlist, then restores it in `finally`. The company grant is restored as well. It cannot send a network transaction. A restricted journal supports `--restore` after an interruption. Run this against a synchronized development backend; `convex codegen` alone generates bindings and does not publish the new function routes.
