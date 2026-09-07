// Read-only checks against the configured development deployment and the official
// download saved during QA. No recipients, decisions or payments are changed.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { parseOfacXml } from "../convex/lib/ofacXml.ts";
import { normalizeScreeningName as normalizeSdnName } from "../shared/sanctions.ts";

const { entries } = parseOfacXml(readFileSync(".local/qa/ofac-current.xml", "utf8"));
const entry = entries.find(row => row.addresses.some(a => a.currency === "ETH" && /^0x[0-9a-f]{40}$/i.test(a.address)));
const aliasEntry = entries.find(row => row.aliases.some(alias => normalizeSdnName(alias) !== normalizeSdnName(row.primaryName) && alias.length > 15));
assert(entry && aliasEntry);
const alias = aliasEntry.aliases.find(name => normalizeSdnName(name) !== normalizeSdnName(aliasEntry.primaryName) && name.length > 15);
const listed = entry.addresses.find(a => a.currency === "ETH");
function run(args) {
  const started = performance.now();
  const result = spawnSync("bunx", ["convex", "run", "screening:screenName", JSON.stringify(args)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return { result: JSON.parse(result.stdout), elapsedMs: Math.round(performance.now() - started) };
}
const exact = run({ name: "Disburse QA Unrelated Name", walletAddress: listed.address, chainId: 1 });
assert(exact.result.matches.some(m => m.sdnId === entry.sdnId && m.kind === "address" && m.networkMatch === "listed_network"));
const other = run({ name: "Disburse QA Unrelated Name", walletAddress: listed.address, chainId: 8453 });
assert(other.result.matches.some(m => m.sdnId === entry.sdnId && m.kind === "address" && m.networkMatch === "other_network"));
const testnet = run({ name: "Disburse QA Unrelated Name", walletAddress: listed.address, chainId: 11155111 });
assert(!testnet.result.matches.some(m => m.kind === "address"));
const name = run({ name: alias });
assert(name.result.matches.some(m => m.sdnId === aliasEntry.sdnId && m.kind === "name"));
const evidence = {
  checkedAt: new Date().toISOString(), datasetId: exact.result.datasetId,
  cases: { exactListedNetwork: true, sameAddressOtherNetwork: true, testNetworkSeparation: true, unrelatedAliasRetrieved: true },
  commandDurationsMs: [exact, other, testnet, name].map(c => c.elapsedMs),
  note: "Durations include CLI startup and transport; not isolated server latency.",
};
writeFileSync(".local/qa/ofac-live-evidence.json", JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
