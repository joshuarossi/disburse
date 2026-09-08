// Read-only CLI monitor. Uses the operator's existing Convex CLI authorization.
// Exit 2 means queued work needs investigation; it never retries or sends money.
import { spawnSync } from "node:child_process";
const name = process.argv
  .find((arg) => arg.startsWith("--deployment="))
  ?.slice(13);
if (!name || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(name))
  throw new Error("Specify --deployment=<Convex deployment name>.");
const result = spawnSync(
  "bunx",
  [
    "convex",
    "run",
    "operationsHealth:summary",
    "{}",
    "--deployment-name",
    name,
  ],
  { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 },
);
if (result.status !== 0) {
  console.error(
    "Queue health could not be checked. Inspect Convex availability and CLI authorization.",
  );
  process.exit(1);
}
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("The health response was not readable. No jobs were changed.");
  process.exit(1);
}
console.log(JSON.stringify({ deployment: name, ...report }, null, 2));
process.exitCode = report.status === "queues_clear" ? 0 : 2;
