# Recovery and operations rehearsal

September 8, 2026. A full export of the hosted development database, including file storage, was restored into a new anonymous local Convex deployment. Production was not modified. The local deployment contained only the release schema: no application actions, crons, provider credentials or payment jobs were installed. Importing therefore could not resubmit an authorization or call an external service.

A second export was compared against the first. Verification passed for **96,275 records across 62 nonempty tables and one stored file**. Record IDs, creation times and complete canonical values matched; stored file bytes matched by SHA-256. This includes saved signatures, original execution records, invoice receipts, credit notes, license history and accounting exports. Archive integrity was checked without extracting paths. The verifier rejects changed/missing records, duplicate IDs, unsafe paths, missing/changed files and corrupt archives; its negative tests pass.

The original snapshot and restored snapshot are private files under ignored `.local/backups`, with restricted directory and file permissions. They contain personal and authorization data and must never be committed or uploaded as general CI artifacts. The checked-in verifier emits counts and table names, not record values.

## Procedure

1. Record source deployment and release commit. Export with `bunx convex export --deployment-name <source> --include-file-storage --path <private-file.zip>`.
2. Restore only into a new isolated deployment. Install the intended schema with **no crons or submission actions**, no external service credentials and no provider network access. Verify the target URL/name before using `convex import --replace-all --yes <private-file.zip>`. Never use this command against the serving application for a rehearsal.
3. Export the isolated result, including files, and compare it:

```sh
python3 scripts/operations/verify-snapshot.py <source.zip> <restored.zip>
python3 -m unittest discover -s scripts/operations -p 'test_*.py'
```

4. Inspect saved execution identities and unresolved requests before re-enabling any worker. Restore cannot rewind the blockchain, invalidate a signature, restore provider requests or reproduce environment secrets. Convex snapshot exports do not substitute for a scheduler recovery plan.
5. Retain backups using the operator's approved storage and retention policy. Restore a compatible database/function combination, then reconcile original chain/provider outcomes before submitting anything new. A frontend rollback alone does not undo database writes or financial authorizations.

## Queue monitoring

`operationsHealth:summary` is an internal, read-only operator query. It checks overdue Circle/native recovery, treasury transfer/service recovery, report backlog and failed report projections using bounded indexes. It returns counts and at most five record IDs per queue, never payment payloads, signatures, sessions or recipient details. Counts stop at 100 and explicitly report truncation.

```sh
node scripts/operations/check-health.mjs --deployment=<target-name>
```

The command uses the operator's existing Convex CLI authorization. Exit 0 means the measured queues are clear; exit 2 means attention is required; exit 1 means the check itself failed. A queue more than fifteen minutes behind triggers attention. This does not prove that every RPC/provider is healthy. Wire these exit codes into the organization's existing monitoring; no paid delivery API, sponsor account or Disburse-funded service is introduced.

The failure rehearsal creates overdue recovery and a failed report projection, checks that monitoring detects both without mutating or scheduling anything, clears them, and verifies recovery to `queues_clear`. It also verifies bounded output for more than 100 overdue records. External alert delivery, incident staffing and independent security review remain rollout work.
