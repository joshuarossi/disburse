/** Read-only verification of Safe's fixed allowance release; never signs or sends. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPublicClient, http, keccak256 } from 'viem';
import { CURRENT_ALLOWANCE } from '../shared/allowanceDeployments.ts';
import { CHAIN_ID_TO_CHAIN, getPublicRpcUrl } from '../src/lib/chains.ts';
const directory = new URL('../.local/qa/safe-allowance-release/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = { checkedAt: new Date().toISOString(), release: 'allowances/v1.0.0', address: CURRENT_ALLOWANCE.address, expectedCodeHash: CURRENT_ALLOWANCE.codeHash, networks: [], compilation: null };
let referenceRuntime;
for (const chainId of [1, 137, 8453, 42161, 11155111, 84532]) {
  const client = createPublicClient({ chain: CHAIN_ID_TO_CHAIN[chainId], transport: http(getPublicRpcUrl(chainId), { timeout: 15000, retryCount: 1 }) });
  const blockNumber = await client.getBlockNumber();
  const code = await client.getCode({ address: CURRENT_ALLOWANCE.address, blockNumber });
  const deployed = !!code && code !== '0x';
  const row = { chainId, blockNumber: String(blockNumber), deployed, codeHash: deployed ? keccak256(code) : null };
  report.networks.push(row);
  if (chainId !== 84532 && row.codeHash !== CURRENT_ALLOWANCE.codeHash) throw new Error(`Unexpected spending module on network ${chainId}`);
  if (deployed) referenceRuntime = code;
}
if (process.argv.includes('--compile')) {
  const hashes = {
    'AllowanceModule.sol': 'a5e1c3490ebf9607c2631dca6e14ce96f0df2ecd6aaecf1a2b4608b81734f2cf',
    'Enum.sol': '3a2623c96b876a14d6eb75bf30a39ec72c8e8756ddbe5983b34d38798673af4c',
    'SignatureDecoder.sol': '72e0e37aba7f62a6de6b6a08235cc00c8a3a0524d47e59e9d47bdbf0f803d17a',
  };
  const sources = {};
  for (const [file, hash] of Object.entries(hashes)) {
    const response = await fetch(`https://raw.githubusercontent.com/safe-fndn/safe-modules/allowances/v1.0.0/modules/allowances/contracts/${file}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Could not retrieve published source ${file}`);
    const content = await response.text();
    if (createHash('sha256').update(content).digest('hex') !== hash) throw new Error(`Release source checksum changed: ${file}`);
    sources[`contracts/${file}`] = { content };
  }
  const compiled = spawnSync('node', [fileURLToPath(new URL('./verify-allowance-source.mjs', import.meta.url))], { input: JSON.stringify({ sources, runtime: referenceRuntime }), encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  if (compiled.status !== 0) throw new Error(`Source verification failed: ${compiled.stderr || compiled.error?.message}`);
  report.compilation = { ...JSON.parse(compiled.stdout), sourceSha256: hashes };
}
await writeFile(new URL('evidence.json', directory), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
