/** Refresh the official OFAC snapshot through the configured Convex CLI identity. */
import { spawnSync } from "node:child_process";
// All downloading, validation, staging and activation run in the backend.
// There is no clear-and-reload path and no public database-write endpoint.
const result = spawnSync("bunx", ["convex", "run", "ofac:refresh", "{}"], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
