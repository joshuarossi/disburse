# Receiving-address and collection costs

Measured September 8, 2026 with the production Solidity 0.8.30 settings (optimizer 200, Shanghai), OpenZeppelin 5.4.0 and an isolated local EVM. No production contracts or invoice addresses changed. The reproducible results are [gas units](receiving-gas-benchmark.json) and [network price models](receiving-network-costs.json).

## Results

All rows use the same nonzero treasury balance and a conventional ERC-20. Every collection verifies that the complete principal reaches the fixed treasury and nothing reaches the unrelated caller. Addresses can receive tokens before deployment. Totals for groups include the local batch harness call.

| Design / operation | One invoice | Five invoices | Twenty invoices |
| --- | ---: | ---: | ---: |
| Current immutable contract, separate first collections | 342,403 | 1,712,015 | 6,848,060 |
| Current immutable contract, grouped first collections | 346,815 | 1,594,215 | 6,271,965 |
| Current immutable contract, separate repeat collections | 46,950 | 234,750 | 939,000 |
| Current immutable contract, grouped repeat collections | 51,362 | 123,960 | 411,924 |
| Clone prototype, separate first collections | 116,794 | 583,970 | 2,335,880 |
| Clone prototype, grouped first collections | 121,206 | 456,170 | 1,712,285 |
| Clone prototype, separate repeat collections | 46,536 | 232,680 | 930,720 |
| Clone prototype, grouped repeat collections | 50,948 | 114,304 | 367,300 |

The clone reduces a first collection's execution gas by about 66%. Its repeat sweep costs almost the same as the current contract. Grouping twenty current-contract repeat collections saves about 56% against separate calls. Grouping one invoice adds overhead. The current shared factory costs 579,774 gas to deploy; the prototype factory including its implementation costs 677,969 gas. The benchmark harness itself costs 161,399 gas and is not a product deployment artifact.

The network snapshot models both first and repeat execution on Base, Arbitrum and Ethereum using each network's observed gas price and block identity. **These are execution-cost models, not total customer fees.** L2 data charges, Safe batching, ERC-4337 validation, paymaster charges and fee refunds are excluded. An actual customer's USDC quote remains the authority. The existing live Base Sepolia first collection cost 0.020242 USDC including its execution service; that testnet result is not a production price forecast.

## Design decision

Keep the current immutable forwarder for this candidate. Preserve every issued address and its fixed destination. The prototype is worth a separately reviewed contract version when invoice volume justifies it; its lower cost does not constitute security approval.

The prototype uses OpenZeppelin deterministic clones with the destination encoded as immutable arguments, avoiding an externally callable initializer. The implementation address is fixed, with no upgrade entry point. It adds a delegatecall/implementation dependency that the present full contract does not have. Pin both implementation and factory runtime before enabling any future version. [OpenZeppelin Clones](https://docs.openzeppelin.com/contracts/5.x/api/proxy#Clones), [ERC-1167](https://eips.ethereum.org/EIPS/eip-1167).

A future grouped collection should use the customer's existing Safe batching and one reviewed USDC fee, group only a single account/network, cap gas and invoice count, and preserve per-invoice receipt matching. A failed sweep in an atomic group reverts the group; offer a reviewed smaller group rather than silently excluding invoices. The benchmark harness does not implement that application workflow or its authorization/receipt rules.

Issuing the offchain invoice still has no receiving-contract deployment cost. First collection pays deployment; later collection pays sweep execution. The first customer enabling a network pays shared factory setup through an explicit USDC quote. Disburse advances none of these costs. No invoice platform fee has been activated.

## Reproduce

```sh
bun scripts/contracts/benchmark.mjs
bun scripts/contracts/network-costs.mjs
```

Add `--write` to refresh the respective checked-in report. The benchmark never connects to a public chain. The price snapshot makes read-only RPC calls. Importing the compiler from another script cannot rewrite production artifacts; only direct invocation of `scripts/contracts/compile.mjs --write` does that.
