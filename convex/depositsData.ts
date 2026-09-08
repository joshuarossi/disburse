import { ORG_READER_ROLES } from '../shared/roles';
import { queueReportSource } from './lib/reportIndex';
import { v, type Infer } from "convex/values";
import { query, internalQuery, internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";

export const authorizeSync = internalQuery({
  args: { orgId: v.id("orgs"), sessionToken: v.string(), force: v.boolean() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken,
      args.force ? ["admin", "approver", "initiator", "clerk"] : ["admin", "approver", "initiator", "clerk", "viewer"]);
  },
});
import { environmentValidator } from "./lib/activityEnvironment";
import { chainEnvironment } from "../shared/assets";
import { outgoingTransferFields, outgoingTransferValidator, storeOutgoingTransfer, matchOutgoingTransaction } from './lib/outgoingTransfers';
import {
  DEPOSIT_REFRESH_MS,
  DEPOSIT_FULL_SCAN_MS,
  DEPOSIT_OVERLAP_MS,
  DEPOSIT_LEASE_MS,
  DEPOSIT_PAGE_SIZE,
  depositScanUrl,
  validateDepositCursor,
} from "./lib/depositSync";


const depositFields = {
  orgId: v.id("orgs"),
  safeId: v.id("safes"),
  chainId: v.number(),
  safeAddress: v.string(),
  tokenAddress: v.string(),
  tokenSymbol: v.string(),
  decimals: v.number(),
  amountRaw: v.string(),
  amount: v.string(),
  txHash: v.string(),
  transferId: v.string(),
  blockNumber: v.optional(v.number()),
  timestamp: v.number(),
  fromAddress: v.optional(v.string()),
  toAddress: v.string(),
  source: v.literal("safe_tx_service"),
};
const depositValidator = v.object(depositFields);

async function storeDeposit(
  ctx: MutationCtx,
  input: Infer<typeof depositValidator>,
) {
  const args = {
    ...input,
    safeAddress: input.safeAddress.toLowerCase(),
    toAddress: input.toAddress.toLowerCase(),
    tokenAddress: input.tokenAddress.toLowerCase(),
    txHash: input.txHash.toLowerCase(),
    transferId: input.transferId.toLowerCase(),
  };
  const safe = await ctx.db.get(args.safeId);
  if (!safe || safe.orgId !== args.orgId || safe.chainId !== args.chainId)
    throw new Error(
      "Deposit account does not belong to this organization and network",
    );
  if (
    safe.safeAddress.toLowerCase() !== args.safeAddress ||
    args.safeAddress !== args.toAddress
  )
    throw new Error("Deposit destination does not match its account");
  if (
    !/^0x[\da-f]{40}$/.test(args.tokenAddress) ||
    !/^0x[\da-f]{64}$/.test(args.txHash) ||
    !/^[ei][\da-f_,]+$/.test(args.transferId) ||
    !args.transferId.slice(1).startsWith(args.txHash.slice(2)) ||
    !/^\d+$/.test(args.amountRaw) ||
    !Number.isInteger(args.decimals) ||
    args.decimals < 0 ||
    args.decimals > 255
  )
    throw new Error("Invalid deposit identity, asset or amount");
  const existing = await ctx.db
    .query("deposits")
    .withIndex("by_safe_transfer", (q) =>
      q.eq("safeId", safe._id).eq("transferId", args.transferId),
    )
    .unique();
  if (existing) {
    if (
      existing.txHash.toLowerCase() !== args.txHash ||
      existing.tokenAddress.toLowerCase() !== args.tokenAddress ||
      existing.amountRaw !== args.amountRaw ||
      existing.toAddress.toLowerCase() !== args.toAddress
    )
      throw new Error(
        "Deposit identity conflicts with its previously recorded transfer",
      );
    return { inserted: false };
  }
  // Adopt the old collapsed record once, retaining its prior values. Further logs
  // become separate entries. Other organizations' linked accounts are independent.
  const legacy = (
    await ctx.db
      .query("deposits")
      .withIndex("by_safe_tx", (q) =>
        q.eq("safeId", safe._id).eq("txHash", args.txHash),
      )
      .collect()
  ).filter(
    (d) =>
      !d.transferId &&
      !d.supersededBy &&
      d.chainId === args.chainId &&
      d.tokenAddress.toLowerCase() === args.tokenAddress &&
      d.toAddress.toLowerCase() === args.toAddress,
  );
  if (legacy.length) {
    const first = legacy[0];
    await ctx.db.patch(first._id, {
      ...args,
      legacyRecord: {
        amount: first.amount,
        amountRaw: first.amountRaw,
        tokenSymbol: first.tokenSymbol,
        decimals: first.decimals,
        reconciledAt: Date.now(),
      },
    });
    for (const duplicate of legacy.slice(1)) {
      await ctx.db.patch(duplicate._id, { supersededBy: first._id });
      await queueReportSource(ctx, args.orgId, 'deposit', duplicate._id);
    }
    await queueReportSource(ctx, args.orgId, 'deposit', first._id);
    return { inserted: false };
  }
  const depositId = await ctx.db.insert("deposits", { ...args, createdAt: Date.now() });
  await queueReportSource(ctx, args.orgId, 'deposit', depositId);
  return { inserted: true };
}

export const upsertDeposit = internalMutation({
  args: depositFields,
  handler: storeDeposit,
});

export const upsertOutgoingTransfer = internalMutation({
  args: outgoingTransferFields,
  handler: async (ctx, args) => {
    const id = await storeOutgoingTransfer(ctx, args);
    await matchOutgoingTransaction(ctx, args.safeId, args.txHash.toLowerCase());
    return id;
  },
});

// Requesting a refresh never advances the completed watermark or discards a cursor.
export const requestSync = internalMutation({
  args: { safeId: v.id("safes"), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const safe = await ctx.db.get(args.safeId);
    if (
      !safe ||
      safe.isActive === false ||
      chainEnvironment(safe.chainId) === "unclassified"
    )
      return false;
    const now = Date.now();
    const state = await ctx.db
      .query("depositSyncs")
      .withIndex("by_safe", (q) => q.eq("safeId", safe._id))
      .unique();
    if (state?.leaseUntil && state.leaseUntil > now) return false;
    if (state?.scan) {
      await ctx.db.patch(state._id, {
        nextAttemptAt: now,
        error: undefined,
        failures: 0,
      });
      await ctx.scheduler.runAfter(0, internal.deposits.process, {
        syncId: state._id,
      });
      return true;
    }
    if (
      !args.force &&
      state?.historyScope === 'all' &&
      state?.lastSyncedAt &&
      now - state.lastSyncedAt < DEPOSIT_REFRESH_MS
    )
      return false;
    const full =
      state?.historyScope !== 'all' ||
      !state?.lastFullScanAt ||
      now - state.lastFullScanAt >= DEPOSIT_FULL_SCAN_MS;
    const from = full
      ? 0
      : Math.max(0, (state?.completedThrough ?? 0) - DEPOSIT_OVERLAP_MS);
    const through = Math.max(from, now - 60_000);
    const scan = {
      from,
      through,
      cursor: depositScanUrl(safe.chainId, safe.safeAddress, from, through, 'all'),
      page: 0,
      full,
      scope: 'all' as const,
    };
    const fields = {
      scan,
      generation: (state?.generation ?? 0) + 1,
      nextAttemptAt: now,
      error: undefined,
      failures: 0,
      leaseUntil: undefined,
    };
    const syncId =
      state?._id ??
      (await ctx.db.insert("depositSyncs", {
        orgId: safe.orgId,
        safeId: safe._id,
        chainId: safe.chainId,
        lastSyncedAt: 0,
      }));
    await ctx.db.patch(syncId, fields);
    await ctx.scheduler.runAfter(0, internal.deposits.process, { syncId });
    return true;
  },
});

export const claimPage = internalMutation({
  args: { syncId: v.id("depositSyncs") },
  handler: async (ctx, args) => {
    const state = await ctx.db.get(args.syncId);
    if (!state?.scan || (state.leaseUntil ?? 0) > Date.now()) return null;
    const safe = await ctx.db.get(state.safeId);
    if (
      !safe ||
      safe.isActive === false ||
      safe.orgId !== state.orgId ||
      safe.chainId !== state.chainId
    )
      return null;
    const leaseUntil = Date.now() + DEPOSIT_LEASE_MS;
    await ctx.db.patch(state._id, { leaseUntil, nextAttemptAt: leaseUntil });
    return { ...state, leaseUntil, safeAddress: safe.safeAddress };
  },
});

// Rows and the next cursor commit together. Replayed/stale workers cannot skip a page.
export const storePage = internalMutation({
  args: {
    syncId: v.id("depositSyncs"),
    generation: v.number(),
    cursor: v.string(),
    leaseUntil: v.number(),
    next: v.union(v.string(), v.null()),
    deposits: v.array(depositValidator),
    outgoingTransfers: v.optional(v.array(outgoingTransferValidator)),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db.get(args.syncId);
    if (
      !state?.scan ||
      state.generation !== args.generation ||
      state.scan.cursor !== args.cursor ||
      state.leaseUntil !== args.leaseUntil
    )
      return false;
    if (args.deposits.length > DEPOSIT_PAGE_SIZE)
      throw new Error("Deposit history page exceeds its limit");
    if (args.next)
      validateDepositCursor(args.next, state.scan.cursor, state.scan.cursor);
    for (const deposit of args.deposits) {
      if (
        deposit.safeId !== state.safeId ||
        deposit.orgId !== state.orgId ||
        deposit.chainId !== state.chainId ||
        deposit.timestamp < state.scan.from ||
        deposit.timestamp > state.scan.through
      )
        throw new Error("Deposit does not belong to this scan");
      await storeDeposit(ctx, deposit);
    }
    if ((args.outgoingTransfers?.length ?? 0) > DEPOSIT_PAGE_SIZE || (args.outgoingTransfers?.length && state.scan.scope !== 'all'))
      throw new Error('Outgoing transfers do not belong to this history scan');
    const outgoingTransactions = new Set<string>();
    for (const transfer of args.outgoingTransfers ?? []) {
      if (transfer.safeId !== state.safeId || transfer.orgId !== state.orgId || transfer.chainId !== state.chainId
        || transfer.timestamp < state.scan.from || transfer.timestamp > state.scan.through)
        throw new Error('Outgoing transfer does not belong to this scan');
      await storeOutgoingTransfer(ctx, transfer);
      outgoingTransactions.add(transfer.txHash.toLowerCase());
    }
    for (const txHash of outgoingTransactions) await matchOutgoingTransaction(ctx, state.safeId, txHash);
    await ctx.db.patch(
      state._id,
      args.next
        ? {
            scan: {
              ...state.scan,
              cursor: args.next,
              page: state.scan.page + 1,
            },
            leaseUntil: undefined,
            nextAttemptAt: Date.now(),
            error: undefined,
            failures: 0,
          }
        : {
            completedThrough: state.scan.through,
            lastSyncedAt: Date.now(),
            lastFullScanAt: state.scan.full ? Date.now() : state.lastFullScanAt,
            historyScope: state.scan.scope ?? state.historyScope,
            scan: undefined,
            leaseUntil: undefined,
            nextAttemptAt: Date.now() + DEPOSIT_REFRESH_MS,
            error: undefined,
            failures: 0,
          },
    );
    if (!args.next && !state.scan.scope) await ctx.scheduler.runAfter(0, internal.depositsData.requestSync, { safeId: state.safeId });
    return true;
  },
});

export const failed = internalMutation({
  args: {
    syncId: v.id("depositSyncs"),
    generation: v.number(),
    cursor: v.string(),
    leaseUntil: v.number(),
    error: v.string(),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db.get(args.syncId);
    if (
      !state?.scan ||
      state.generation !== args.generation ||
      state.scan.cursor !== args.cursor ||
      state.leaseUntil !== args.leaseUntil
    )
      return;
    const failures = (state.failures ?? 0) + 1;
    const delay = Math.max(
      Math.min(3600_000, 60_000 * 2 ** Math.min(failures, 6)),
      Number.isFinite(args.retryAfterMs)
        ? Math.min(86400_000, args.retryAfterMs!)
        : 0,
    );
    await ctx.db.patch(state._id, {
      leaseUntil: undefined,
      failures,
      error: args.error.slice(0, 240),
      nextAttemptAt: Date.now() + delay,
    });
  },
});

export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("depositSyncs")
      .withIndex("by_next_attempt", (q) =>
        q.gt("nextAttemptAt", 0).lte("nextAttemptAt", Date.now()),
      )
      .take(20);
    for (const state of due) {
      const safe = await ctx.db.get(state.safeId);
      if (!safe || safe.isActive === false) {
        await ctx.db.patch(state._id, {
          nextAttemptAt: undefined,
          leaseUntil: undefined,
        });
        continue;
      }
      await ctx.db.patch(state._id, {
        nextAttemptAt: Date.now() + DEPOSIT_REFRESH_MS,
      });
      if (state.scan)
        await ctx.scheduler.runAfter(0, internal.deposits.process, {
          syncId: state._id,
        });
      else
        await ctx.scheduler.runAfter(0, internal.depositsData.requestSync, {
          safeId: state.safeId,
        });
    }
  },
});

export const statusForOrg = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    environment: v.optional(environmentValidator),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    const states = await ctx.db
      .query("depositSyncs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const active = new Set(
      (
        await ctx.db
          .query("safes")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .collect()
      )
        .filter((s) => s.isActive !== false)
        .map((s) => s._id),
    );
    return states
      .filter(
        (s) =>
          active.has(s.safeId) &&
          (!args.environment ||
            chainEnvironment(s.chainId) === args.environment),
      )
      .map((s) => ({
        safeId: s.safeId,
        chainId: s.chainId,
        lastSyncedAt: s.lastSyncedAt || null,
        completedThrough: s.completedThrough ?? null,
        historyReconciled: !!s.lastFullScanAt,
        includesOutgoing: s.historyScope === 'all',
        syncing: !!s.scan && !s.error,
        error: s.error ?? null,
        nextAttemptAt: s.error ? s.nextAttemptAt ?? null : null,
        pages: s.scan?.page ?? 0,
      }));
  },
});

export const listRecent = query({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [...ORG_READER_ROLES]);
    const deposits = await ctx.db
      .query("deposits")
      .withIndex("by_org_time", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .filter((q) => q.eq(q.field("supersededBy"), undefined))
      .take(Math.max(1, Math.min(100, args.limit ?? 5)));
    return deposits.map((d) => ({
      _id: d._id,
      timestamp: d.timestamp,
      amount: d.amount,
      tokenSymbol: d.tokenSymbol,
      chainId: d.chainId,
      fromAddress: d.fromAddress,
      txHash: d.txHash,
    }));
  },
});
