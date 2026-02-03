# Scheduled Disbursements — Implementation Plan

## Overview

Add the ability to schedule a disbursement for a future date/time. The user signs the Safe transaction now (same wallet interaction as today), but the Gelato relay (execute step) is deferred to the scheduled time via a Convex background job (`ctx.scheduler.runAfter`). When the job fires, it POSTs to Gelato server-side and the existing frontend polling picks up the `relaying` → `executed` transition automatically.

**Status flow:** `draft` → (user clicks Propose, signs) → `scheduled` → (job fires at scheduledAt) → `relaying` → `executed`

For non-scheduled disbursements, nothing changes. The `scheduled` status only appears when `scheduledAt` is set.

---

## Critical Files

| File | Changes |
|---|---|
| `convex/schema.ts` | Add `scheduledAt`, `scheduledJobId` fields; add `"scheduled"` to status union; add index |
| `convex/disbursements.ts` | Extend `create`/`createBatch` args; add `getInternal` (internalQuery), `updateStatusInternal` (internalMutation), `schedule`, `reschedule` mutations; extend `list` sort |
| `convex/relay.ts` | Add `fireScheduledRelay` internalAction + `encodeExecTransaction` helper |
| `src/pages/Disbursements.tsx` | Date picker in form; branch in `handlePropose`; new status badge; new sortable column; reschedule modal; action buttons for `scheduled` |
| `src/locales/en/translation.json` | New keys for scheduled status, form labels, table header, actions |
| `src/locales/es/translation.json` | Same keys in Spanish |
| `src/locales/pt-BR/translation.json` | Same keys in Portuguese |

---

## 1. Schema — `convex/schema.ts`

Add two optional fields to the `disbursements` table (after `relayError`, before `createdBy`):

```typescript
scheduledAt: v.optional(v.number()),       // epoch ms when relay should fire
scheduledJobId: v.optional(v.string()),    // "sched_{disbursementId}" — audit trail only
```

Add `"scheduled"` to the status union (after `"proposed"`):

```typescript
v.literal("scheduled"),
```

Add a new index after `by_safe`:

```typescript
.index("by_org_scheduledAt", ["orgId", "scheduledAt"])
```

All fields are `v.optional` so no migration is needed for existing rows.

---

## 2. Backend — `convex/disbursements.ts`

### 2a. Extend `create` and `createBatch` args

Add to both mutations' args:
```typescript
scheduledAt: v.optional(v.number()),
```

In each handler, pass it through to the `ctx.db.insert` call. The row still starts as `status: "draft"` — `scheduledAt` is just stored for the propose step to read later.

### 2b. Add `getInternal` (internalQuery)

The scheduled relay action runs with no user context. It needs to read a disbursement + its safe address.

```typescript
import { ..., internalQuery } from "./_generated/server";

export const getInternal = internalQuery({
  args: { disbursementId: v.id("disbursements") },
  handler: async (ctx, args) => {
    const d = await ctx.db.get(args.disbursementId);
    if (!d) return null;
    const safe = await ctx.db.get(d.safeId);
    return { ...d, safeAddress: safe?.safeAddress ?? null };
  },
});
```

### 2c. Add `updateStatusInternal` (internalMutation)

Called by `fireScheduledRelay` to transition to `relaying` or `failed` without RBAC checks. Uses `createdBy` on the disbursement as the actor for audit.

```typescript
import { ..., internalMutation } from "./_generated/server";

export const updateStatusInternal = internalMutation({
  args: {
    disbursementId: v.id("disbursements"),
    status: v.union(v.literal("relaying"), v.literal("failed"), v.literal("cancelled")),
    relayTaskId: v.optional(v.string()),
    relayStatus: v.optional(v.string()),
    relayError: v.optional(v.string()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const updates: Record<string, unknown> = { status: args.status, updatedAt: now };
    if (args.relayTaskId) updates.relayTaskId = args.relayTaskId;
    if (args.relayStatus) updates.relayStatus = args.relayStatus;
    if (args.relayError) updates.relayError = args.relayError;
    if (args.txHash) updates.txHash = args.txHash;
    await ctx.db.patch(args.disbursementId, updates);

    // Audit log using createdBy as actor, with source: "scheduled_relay"
    const d = await ctx.db.get(args.disbursementId);
    if (d) {
      await ctx.db.insert("auditLog", {
        orgId: d.orgId,
        actorUserId: d.createdBy,
        action: `disbursement.${args.status}`,
        objectType: "disbursement",
        objectId: args.disbursementId,
        metadata: { status: args.status, source: "scheduled_relay", relayTaskId: args.relayTaskId, relayError: args.relayError },
        timestamp: now,
      });
    }
    return { success: true };
  },
});
```

### 2d. Add `schedule` mutation

Called by the frontend after propose succeeds and the disbursement has a `scheduledAt`. This is where `ctx.scheduler.runAfter` is called (only available on MutationCtx).

```typescript
export const schedule = mutation({
  args: {
    disbursementId: v.id("disbursements"),
    walletAddress: v.string(),
    scheduledAt: v.number(),
    safeTxHash: v.string(),
    relayFeeToken: v.optional(v.string()),
    relayFeeTokenSymbol: v.optional(v.string()),
    relayFeeMode: v.optional(v.union(v.literal("stablecoin_preferred"), v.literal("stablecoin_only"))),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();
    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) throw new Error("Disbursement not found");

    const { user } = await requireOrgAccess(ctx, disbursement.orgId, walletAddress, ["admin", "approver", "initiator"]);

    // Accept scheduledAt even if slightly in the past due to clock skew; runAfter(0) fires immediately
    const delayMs = Math.max(0, args.scheduledAt - now);

    await ctx.db.patch(args.disbursementId, {
      status: "scheduled",
      scheduledAt: args.scheduledAt,
      scheduledJobId: `sched_${args.disbursementId}`,
      safeTxHash: args.safeTxHash,
      relayFeeToken: args.relayFeeToken,
      relayFeeTokenSymbol: args.relayFeeTokenSymbol,
      relayFeeMode: args.relayFeeMode,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(delayMs, internal.relay.fireScheduledRelay, {
      disbursementId: args.disbursementId,
    });

    await ctx.db.insert("auditLog", {
      orgId: disbursement.orgId,
      actorUserId: user._id,
      action: "disbursement.scheduled",
      objectType: "disbursement",
      objectId: args.disbursementId,
      metadata: { scheduledAt: args.scheduledAt },
      timestamp: now,
    });

    return { success: true };
  },
});
```

### 2e. Add `reschedule` mutation

Updates `scheduledAt` and queues a new job. The old job becomes a no-op (guard in `fireScheduledRelay` checks `status === "scheduled"` at fire time; the first job to fire transitions to `relaying`, any subsequent job sees a non-`scheduled` status and exits).

```typescript
export const reschedule = mutation({
  args: {
    disbursementId: v.id("disbursements"),
    walletAddress: v.string(),
    newScheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();
    const disbursement = await ctx.db.get(args.disbursementId);
    if (!disbursement) throw new Error("Disbursement not found");
    if (disbursement.status !== "scheduled") throw new Error("Only scheduled disbursements can be rescheduled");

    const { user } = await requireOrgAccess(ctx, disbursement.orgId, walletAddress, ["admin", "approver", "initiator"]);

    const delayMs = Math.max(0, args.newScheduledAt - now);

    await ctx.db.patch(args.disbursementId, {
      scheduledAt: args.newScheduledAt,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(delayMs, internal.relay.fireScheduledRelay, {
      disbursementId: args.disbursementId,
    });

    await ctx.db.insert("auditLog", {
      orgId: disbursement.orgId,
      actorUserId: user._id,
      action: "disbursement.rescheduled",
      objectType: "disbursement",
      objectId: args.disbursementId,
      metadata: { previousScheduledAt: disbursement.scheduledAt, newScheduledAt: args.newScheduledAt },
      timestamp: now,
    });

    return { success: true };
  },
});
```

### 2f. Extend `list` query sort

Add `"scheduledAt"` to the `sortBy` union in the args (alongside `createdAt`, `amount`, `status`).

Add a case in the sorting switch block:
```typescript
case "scheduledAt":
  // Nulls sort last regardless of direction
  const aSchedVal = a.scheduledAt ?? (sortOrder === "desc" ? -Infinity : Infinity);
  const bSchedVal = b.scheduledAt ?? (sortOrder === "desc" ? -Infinity : Infinity);
  comparison = aSchedVal - bSchedVal;
  break;
```

### 2g. Add `"scheduled"` to public `updateStatus` status union

So cancellation via the existing `handleCancel` flow (which calls `updateStatus` with `"cancelled"`) works on `scheduled` disbursements without changes to the cancel handler.

---

## 3. Backend — `convex/relay.ts`

Add the `fireScheduledRelay` internalAction. This is the function the scheduler invokes. It does everything inline (Convex does not support nested action-calls-action, so the Gelato POST logic lives directly in this handler).

Key points:
- The file already has `"use node"` and uses raw `fetch` — same pattern here.
- `viem`'s `encodeFunctionData` and `getAddress` are used to ABI-encode the Safe `execTransaction` call. `viem` is in package.json and works in Node.
- Signatures from the Safe TX service response are sorted by signer address ascending (Safe contract requirement) and concatenated into a single `bytes` value.
- The existing `getSafeTxServiceUrl` helper in this file is reused.

```typescript
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { encodeFunctionData, getAddress } from "viem";

// ABI for Safe's execTransaction
const SAFE_EXEC_TX_ABI = [{ /* see below */ }];

function encodeExecTransaction(safeTx: any): string {
  const confirmations = [...(safeTx.confirmations || [])];
  confirmations.sort((a: any, b: any) =>
    getAddress(a.owner).localeCompare(getAddress(b.owner))
  );
  const signaturesHex = "0x" + confirmations
    .map((c: any) => c.signature.replace("0x", ""))
    .join("");

  return encodeFunctionData({
    abi: SAFE_EXEC_TX_ABI,
    functionName: "execTransaction",
    args: [
      safeTx.to,
      BigInt(safeTx.value),
      safeTx.data || "0x",
      safeTx.operation,
      BigInt(safeTx.safeTxGas),
      BigInt(safeTx.baseGas),
      BigInt(safeTx.gasPrice),
      safeTx.gasToken,
      safeTx.refundReceiver,
      signaturesHex as `0x${string}`,
    ],
  });
}

const GELATO_NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const fireScheduledRelay = internalAction({
  args: { disbursementId: v.id("disbursements") },
  handler: async (ctx, args) => {
    // 1. Read disbursement
    const disbursement = await ctx.runQuery(internal.disbursements.getInternal, {
      disbursementId: args.disbursementId,
    });

    // 2. Guard: if no longer "scheduled", exit (was cancelled or already fired)
    if (!disbursement || disbursement.status !== "scheduled") {
      console.info("[Relay] Scheduled job fired but status is not 'scheduled', skipping.", {
        disbursementId: args.disbursementId, status: disbursement?.status
      });
      return { skipped: true };
    }

    if (!disbursement.safeTxHash || !disbursement.chainId || !disbursement.safeAddress) {
      await ctx.runMutation(internal.disbursements.updateStatusInternal, {
        disbursementId: args.disbursementId,
        status: "failed",
        relayError: "Missing safeTxHash, chainId, or safeAddress at relay time.",
      });
      return { error: "missing_data" };
    }

    try {
      // 3. Fetch signed tx from Safe TX service
      const txServiceUrl = getSafeTxServiceUrl(disbursement.chainId);
      const txResponse = await fetch(`${txServiceUrl}/v1/multisig_transactions/${disbursement.safeTxHash}`);
      if (!txResponse.ok) throw new Error(`Safe TX service returned ${txResponse.status}`);
      const safeTx = await txResponse.json();

      // 4. Encode execTransaction
      const encodedTransaction = encodeExecTransaction(safeTx);

      // 5. Determine fee token
      const gasToken = safeTx.gasToken ?? ZERO_ADDRESS;
      const feeToken = (!gasToken || gasToken === ZERO_ADDRESS)
        ? GELATO_NATIVE_TOKEN_ADDRESS : gasToken;

      // 6. POST to Gelato
      const relayResponse = await fetch("https://api.gelato.digital/relays/v2/call-with-sync-fee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: String(disbursement.chainId),
          target: disbursement.safeAddress,
          data: encodedTransaction,
          feeToken,
          isRelayContext: false,
        }),
      });

      const responseBody = await relayResponse.text();
      console.info("[Relay] Gelato response (scheduled)", { status: relayResponse.status, body: responseBody });

      if (!relayResponse.ok) throw new Error(`Gelato relay failed: ${relayResponse.status} ${responseBody}`);

      const parsed = JSON.parse(responseBody);
      if (!parsed?.taskId) throw new Error("Relay did not return a taskId.");

      // 7. Transition to relaying
      await ctx.runMutation(internal.disbursements.updateStatusInternal, {
        disbursementId: args.disbursementId,
        status: "relaying",
        relayTaskId: parsed.taskId,
        relayStatus: "submitted",
      });

      return { taskId: parsed.taskId };

    } catch (err) {
      await ctx.runMutation(internal.disbursements.updateStatusInternal, {
        disbursementId: args.disbursementId,
        status: "failed",
        relayError: err instanceof Error ? err.message : "Unknown error",
      });
      console.error("[Relay] Scheduled relay failed", { disbursementId: args.disbursementId, error: err });
      return { error: "relay_failed" };
    }
  },
});
```

The `SAFE_EXEC_TX_ABI` is the standard Safe `execTransaction` function ABI with 10 params: `to (address)`, `value (uint256)`, `data (bytes)`, `operation (uint8)`, `safeTxGas (uint256)`, `baseGas (uint256)`, `gasPrice (uint256)`, `gasToken (address)`, `refundReceiver (address)`, `signatures (bytes)`. Returns `bool`.

---

## 4. Frontend — `src/pages/Disbursements.tsx`

### 4a. New state

```typescript
const [scheduledAt, setScheduledAt] = useState<string>('');  // datetime-local string
// Reschedule modal
const [rescheduleDisbursementId, setRescheduleDisbursementId] = useState<Id<'disbursements'> | null>(null);
const [newScheduledAt, setNewScheduledAt] = useState<string>('');
```

Add `setScheduledAt('')` to `resetForm`.

### 4b. New mutation hooks (alongside existing ones at ~line 233-235)

```typescript
const scheduleDisbursement = useMutation(api.disbursements.schedule);
const rescheduleDisbursement = useMutation(api.disbursements.reschedule);
```

### 4c. Pass `scheduledAt` to create mutations

In `handleCreate`, add `scheduledAt: scheduledAt ? new Date(scheduledAt).getTime() : undefined` to both the `createDisbursement` and `createBatchDisbursement` calls.

### 4d. Branch in `handlePropose` — replace the final `updateStatus` to `"proposed"`

After the `safeTxHash` is obtained (after the propose call succeeds), read the disbursement to check `scheduledAt`:

```typescript
// Replace the current updateStatus({ status: 'proposed', ... }) block with:
const currentDisb = await convex.query(api.disbursements.get, {
  disbursementId: disbursement._id, walletAddress: address
});

if (currentDisb?.scheduledAt && currentDisb.scheduledAt > Date.now()) {
  // Scheduled path
  await scheduleDisbursement({
    disbursementId: disbursement._id,
    walletAddress: address,
    scheduledAt: currentDisb.scheduledAt,
    safeTxHash,
    relayFeeToken,
    relayFeeTokenSymbol,
    relayFeeMode,
  });
} else {
  // Immediate path (existing behavior)
  await updateStatus({
    disbursementId: disbursement._id,
    walletAddress: address,
    status: 'proposed',
    safeTxHash,
    relayFeeToken,
    relayFeeTokenSymbol,
    relayFeeMode,
  });
}
```

### 4e. Date/time picker in creation form

Insert after the memo field (after ~line 1466), before the total summary block:

```tsx
<div>
  <label className="mb-2 block text-sm font-medium text-slate-300">
    {t('disbursements.form.scheduleFor')} ({t('common.optional')})
  </label>
  <input
    type="datetime-local"
    value={scheduledAt}
    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
    onChange={(e) => setScheduledAt(e.target.value)}
    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
  />
  {scheduledAt && (
    <p className="mt-1 text-xs text-slate-400">
      {t('disbursements.form.scheduleNote')}
    </p>
  )}
</div>
```

### 4f. `STATUS_OPTIONS` — add `scheduled`

```typescript
{ value: 'scheduled', label: t('status.scheduled') },  // after 'proposed'
```

### 4g. `getStatusColor` — add `'scheduled'` to the yellow group

```typescript
case 'scheduled':  // alongside pending, proposed, relaying
```

### 4h. `renderActionButton` — add `case 'scheduled'`

Shows a Calendar (reschedule) button and an X (cancel) button:

```tsx
case 'scheduled':
  return (
    <div className="flex items-center justify-center gap-2 h-8">
      <Button variant="ghost" size="sm"
        onClick={() => {
          setRescheduleDisbursementId(disbursement._id);
          setNewScheduledAt(disbursement.scheduledAt
            ? new Date(disbursement.scheduledAt).toISOString().slice(0, 16) : '');
        }}
        title={t('disbursements.actions.reschedule')}
        className="h-8 w-8 p-0">
        <Calendar className="h-4 w-4 text-yellow-400" />
      </Button>
      <Button variant="ghost" size="sm"
        onClick={() => handleCancel(disbursement._id)}
        title="Cancel"
        className="h-8 w-8 p-0">
        <X className="h-4 w-4 text-slate-400 hover:text-red-400" />
      </Button>
    </div>
  );
```

`Calendar` is already imported.

### 4i. Status badge — show date next to "Scheduled" badge

In the desktop table status `<td>` and mobile card status area, after the badge span, add:

```tsx
{disbursement.status === 'scheduled' && disbursement.scheduledAt && (
  <span className="ml-2 text-xs text-slate-500">
    {new Date(disbursement.scheduledAt).toLocaleString()}
  </span>
)}
```

### 4j. New sortable "Scheduled For" column — desktop table

Add `<th>` header (after Status, before Date) with `onClick={() => handleSort('scheduledAt')}` and the sort arrow pattern matching existing sortable columns.

Add `<td>` in each row:
```tsx
<td className="px-6 py-4 text-slate-400">
  {disbursement.scheduledAt
    ? new Date(disbursement.scheduledAt).toLocaleString()
    : <span className="text-slate-600">—</span>}
</td>
```

### 4k. Sort state type update

```typescript
const [sortBy, setSortBy] = useState<'createdAt' | 'amount' | 'status' | 'scheduledAt'>('createdAt');
```

### 4l. Mobile — show scheduled date in cards

After the memo block in each mobile card, before the date/actions footer:
```tsx
{disbursement.scheduledAt && (
  <div>
    <p className="text-xs text-slate-500 mb-0.5">{t('disbursements.table.scheduledFor')}</p>
    <p className="text-sm text-yellow-400">{new Date(disbursement.scheduledAt).toLocaleString()}</p>
  </div>
)}
```

### 4m. Reschedule modal

Follows the exact same structural pattern as the existing cancel confirmation modal. Contains:
- A `datetime-local` input pre-populated with current `scheduledAt`
- `min` set to 1 minute in the future
- Confirm button calls `rescheduleDisbursement` mutation
- Cancel button clears state

Add `handleReschedule` async function:
```typescript
const handleReschedule = async () => {
  if (!rescheduleDisbursementId || !newScheduledAt || !address) return;
  try {
    await rescheduleDisbursement({
      disbursementId: rescheduleDisbursementId,
      walletAddress: address,
      newScheduledAt: new Date(newScheduledAt).getTime(),
    });
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to reschedule');
  }
  setRescheduleDisbursementId(null);
  setNewScheduledAt('');
};
```

---

## 5. Translations

### New keys to add to all three locale files:

**`status` object:**
- `"scheduled"`: EN `"Scheduled"` | ES `"Programado"` | PT-BR `"Agendado"`

**`disbursements.form` object:**
- `"scheduleFor"`: EN `"Schedule for"` | ES `"Programar para"` | PT-BR `"Agendar para"`
- `"scheduleNote"`: EN `"You will sign now. The relay will execute at the scheduled time."` | ES `"Firmarás ahora. El relay se ejecutará en el momento programado."` | PT-BR `"Você assinará agora. O relay será executado no horário agendado."`

**`disbursements.table` object:**
- `"scheduledFor"`: EN `"Scheduled For"` | ES `"Programado Para"` | PT-BR `"Agendado Para"`

**`disbursements.actions` object:**
- `"reschedule"`: EN `"Reschedule"` | ES `"Reprogramar"` | PT-BR `"Reagendar"`
- `"rescheduleTitle"`: EN `"Reschedule Disbursement"` | ES `"Reprogramar Desembolso"` | PT-BR `"Reagendar Desembolso"`
- `"rescheduleConfirm"`: EN `"Pick a new date and time for this disbursement."` | ES `"Elige una nueva fecha y hora para este desembolso."` | PT-BR `"Escolha uma nova data e hora para este desembolso."`

---

## 6. Edge Cases & Design Notes

- **Cancellation of scheduled disbursements:** Uses the existing `handleCancel` → `updateStatus("cancelled")` path. The queued `fireScheduledRelay` job will fire regardless (Convex jobs can't be cancelled), but the guard (`status !== "scheduled"`) makes it a no-op. No on-chain transaction occurs.
- **Rescheduling leaves old job in place:** Same guard logic. Only the first job to fire when `status === "scheduled"` does real work. Subsequent jobs exit immediately.
- **Clock skew tolerance:** `schedule` and `reschedule` accept any `scheduledAt` value. If it's in the past by the time the mutation runs, `Math.max(0, scheduledAt - now)` results in `delayMs = 0`, so `runAfter` fires immediately. This is acceptable — it degrades gracefully to an instant relay.
- **Relay failure at fire time:** `fireScheduledRelay` catches errors and marks the disbursement as `failed` with a `relayError`. The existing "Retry relay" button (rendered for `failed` + `safeTxHash`) lets the user manually re-execute. No new retry code needed.
- **Audit trail:** `scheduled`, `rescheduled` are logged with user context (from the mutation). `relaying` and `failed` from the scheduled job are logged with `source: "scheduled_relay"` and `createdBy` as actor.
- **No tier gating:** Per requirements, scheduling is available on all plans.
- **Existing relay polling picks up automatically:** The `useEffect` at line 244 already watches for `status === "relaying"` + `relayTaskId`. Once `fireScheduledRelay` transitions to `relaying`, the frontend will poll Gelato every 15s until `executed` or `failed`. Zero changes needed to the polling logic.

---

## 7. Verification

1. Run `npx convex dev` after schema changes — confirm no type errors and types regenerate.
2. Create a single disbursement with a `scheduledAt` 2 minutes in the future. Propose it. Verify status becomes `Scheduled` with the date shown.
3. Cancel it. Verify status becomes `Cancelled`. Wait for the original scheduled time to pass — confirm no relay fires (check Gelato dashboard + console logs for "skipping").
4. Create another scheduled disbursement. Reschedule it to 30 seconds from now. Verify the date updates in the table.
5. Let the rescheduled time pass. Verify status transitions: `Scheduled` → `Relaying` → `Executed`. Confirm the transaction appears on-chain.
6. Create a scheduled disbursement where Gelato will fail (e.g., empty Safe balance). Verify it transitions to `Failed` with an error message and the retry button appears.
7. Test sorting by the "Scheduled For" column in both directions. Verify non-scheduled disbursements sort to the end.
8. Run existing test suite (`npm test`) — confirm no regressions.
