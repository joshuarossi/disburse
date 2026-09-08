# Safe spending module upgrade

September 6, 2026. The review found that Disburse selected AllowanceModule 0.1.1 and 0.1.0 for new grants and delegated transfers. Safe's [1.0.0 release](https://github.com/safe-fndn/safe-modules/releases/tag/allowances%2Fv1.0.0) fixes nonce overflow that can permit replay, false-return ERC-20 transfers, and delegate removal collisions. The [versioned changelog](https://raw.githubusercontent.com/safe-fndn/safe-modules/allowances/v1.0.0/modules/allowances/CHANGELOG.md) publishes the expected address and compatibility change.

## Implementation

`shared/allowanceDeployments.ts` is the common deployment policy for the UI and backend. New grants and delegated payments use only version 1.0.0. Legacy modules remain discoverable for inspection and revocation, including Arbitrum deployments in the updated 3.0.9 deployment registry. That registry still omits 1.0.0, so the fixed release is explicitly pinned:

- Address: `0x691f59471Bfd2B7d639DCF74671a2d648ED1E331`.
- Full runtime keccak256: `0xfafc86ce3000fbdc8ad155875c0b3b5a20d17662e7c2cdbf3e95f15945a46657`.
- Verified networks: Ethereum, Polygon, Base, Arbitrum, Ethereum Sepolia and Base Sepolia. On September 8, the exact published deployment was reproduced on Base Sepolia at the canonical address and its complete runtime hash verified.

The member and policy reads verify the full deployed bytecode. Delegated quotes use the same check, pin allowance and authorization-hash reads to one block, and keep the transfer-counter and fee limits. New grants require an account version supported by Disburse (Safe 1.3.0 or 1.4.1); the upstream module no longer supports Safe 1.0.0. Existing legacy policy proposals remain visible with an explanation, but cannot be approved or executed through Disburse. Revocation remains available.

A backend submission gate stops previously prepared legacy relay jobs before contacting the provider. It preserves the authorization and records that no submission occurred. Already-submitted payments retain reconciliation and receipt verification; the upgrade does not rewrite their signed intent or history.

Existing on-chain grants are not migrated or revoked automatically. Owners must review and revoke old grants, then approve each replacement. Disabling a module, removing a member from Disburse, or refusing new legacy submissions does not itself remove all contract authority. Previously issued signatures can still act outside this application. No production policy was changed during verification.

## Source and live verification

`bun scripts/qa-allowance-release.mjs --compile` performs read-only checks on the six networks, downloads checksum-pinned source from the official release, and compiles it with Solidity 0.7.6 with optimization disabled, as specified by Safe. The executable portion matches the deployed release exactly. The trailing Solidity source/build metadata differs in the reproduction; this is recorded explicitly. Runtime checks in the product compare the **complete deployed code hash**, including its metadata, against the pinned value.

Evidence is saved to `.local/qa/safe-allowance-release/evidence.json`. The source verification helper runs under Node because solc's remote loader requires Node's module compilation API. Neither verification script signs or sends transactions. The runtime fixture in `src/lib/__tests__/fixtures/allowance-v1-runtime.json` was read from the published address and is used to test bytecode mismatch rejection. The upstream contract is LGPL-3.0-only; [source and license](https://github.com/safe-fndn/safe-modules/tree/allowances/v1.0.0/modules/allowances) remain available from Safe.

Regression coverage includes legacy grant rejection and revocation, a queued legacy send held before submission, reconciliation of existing authorization, bytecode mismatch, member-specific and orphaned grant discovery, disabled modules and oversized histories. This verifies the integration; it does not substitute for the independent security review tracked in the launch program.


## Base Sepolia deployment

The [September 8 deployment](https://sepolia.basescan.org/tx/0x40838a2669b57503ad527021d42cd1658cc57ee7f10e374e6249600a8d9ee99b) reproduced the published Base mainnet CREATE2 call, using the same factory, salt and init code. The full runtime matches the pinned 1.0.0 hash above. This deploys Safe's released contract, not a Disburse modification. The isolated customer Safe paid 0.082375 test USDC in execution fees and held zero native ETH. Production networks were read only.
