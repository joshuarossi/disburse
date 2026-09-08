// Read-only network-price snapshot. This is a gas-unit comparison, not a USDC
// service quote: L1 data charges and Safe/paymaster overhead are excluded.
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { base, arbitrum, mainnet } from "viem/chains";
const benchmark = JSON.parse(readFileSync("docs/receiving-gas-benchmark.json"));
const networks = [];
for (const chain of [base, arbitrum, mainnet]) {
  const client = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0], {
      timeout: 15000,
      retryCount: 0,
    }),
  });
  const [gasPrice, block] = await Promise.all([
    client.getGasPrice(),
    client.getBlock(),
  ]);
  networks.push({
    chainId: chain.id,
    name: chain.name,
    blockNumber: String(block.number),
    timestamp: String(block.timestamp),
    gasPriceWei: String(gasPrice),
    models: benchmark.variants.map((v) => ({
      name: v.name,
      firstCollectionExecutionWei: String(
        BigInt(v.sizes[0].separate.first) * gasPrice,
      ),
      repeatCollectionExecutionWei: String(
        BigInt(v.sizes[0].separate.repeat) * gasPrice,
      ),
    })),
  });
}
const result = { scope: benchmark.scope, networks };
if (process.argv.includes("--write"))
  writeFileSync(
    "docs/receiving-network-costs.json",
    JSON.stringify(result, null, 2) + "\n",
  );
console.log(JSON.stringify(result, null, 2));
