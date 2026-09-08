"use node";
import { safeReadHeaders } from "./lib/safeReadService";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { environmentValidator } from "./lib/activityEnvironment";
import { chainEnvironment } from "../shared/assets";
import {
  DEPOSIT_PAGE_SIZE,
  depositScanUrl,
  validateDepositCursor,
  parseDeposit,
  parseAccountTransfer,
} from "./lib/depositSync";

export const syncForOrg = action({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    environment: v.optional(environmentValidator),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.depositsData.authorizeSync, { orgId: args.orgId, sessionToken: args.sessionToken, force: args.force === true });
    const safes = await ctx.runQuery(api.safes.getForOrg, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
    });
    let queued = 0;
    for (const safe of safes) {
      if (
        args.environment &&
        chainEnvironment(safe.chainId) !== args.environment
      )
        continue;
      if (
        await ctx.runMutation(internal.depositsData.requestSync, {
          safeId: safe._id,
          force: args.force,
        })
      )
        queued++;
    }
    return {
      inserted: 0,
      queued,
      errors: [] as Array<{ chainId: number; message: string }>,
    };
  },
});

export const process = internalAction({
  args: { syncId: v.id("depositSyncs") },
  handler: async (ctx, args): Promise<void> => {
    for (let page = 0; page < 4; page++) {
      const state = await ctx.runMutation(
        internal.depositsData.claimPage,
        args,
      );
      if (!state?.scan) return;
      const identity = {
        ...args,
        generation: state.generation!,
        cursor: state.scan.cursor,
        leaseUntil: state.leaseUntil,
      };
      try {
        const cursor = validateDepositCursor(
          state.scan.cursor,
          depositScanUrl(
            state.chainId,
            state.safeAddress,
            state.scan.from,
            state.scan.through,
            state.scan.scope ?? 'incoming',
          ),
        );
        const response = await fetch(cursor, {
          headers: safeReadHeaders(state.chainId),
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        });
        if (!response.ok) {
          const retry = response.headers.get("Retry-After");
          const retryAfterMs = retry
            ? /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : Date.parse(retry) - Date.now()
            : undefined;
          await ctx.runMutation(internal.depositsData.failed, {
            ...identity,
            retryAfterMs: Number.isFinite(retryAfterMs)
              ? Math.max(0, retryAfterMs!)
              : undefined,
            error: `Deposit history unavailable (HTTP ${response.status}). Retry resumes the unfinished scan.`,
          });
          return;
        }
        const payload = await response.json();
        if (
          !Array.isArray(payload.results) ||
          payload.results.length > DEPOSIT_PAGE_SIZE ||
          (payload.next != null && typeof payload.next !== "string") ||
          (payload.next && !payload.results.length)
        )
          throw new Error("Invalid history page");
        const next = payload.next
          ? validateDepositCursor(payload.next, cursor, cursor)
          : null;
        const transfers = payload.results
          .map((transfer: Parameters<typeof parseDeposit>[0]) =>
            (state.scan!.scope === 'all' ? parseAccountTransfer : parseDeposit)(
              transfer,
              state.chainId,
              state.safeAddress,
              state.scan!.from,
              state.scan!.through,
            ),
          )
          .filter((d: ReturnType<typeof parseDeposit>) => d !== null)
          .map((d: NonNullable<ReturnType<typeof parseDeposit>>) => ({
            ...d,
            orgId: state.orgId,
            safeId: state.safeId,
            chainId: state.chainId,
            safeAddress: state.safeAddress,
          }));
        const stored = await ctx.runMutation(internal.depositsData.storePage, {
          ...identity,
          next,
          deposits: transfers.filter((t: NonNullable<ReturnType<typeof parseDeposit>>) => t.toAddress === state.safeAddress.toLowerCase()),
          outgoingTransfers: state.scan.scope === 'all' ? transfers.filter((t: NonNullable<ReturnType<typeof parseDeposit>>) => t.fromAddress === state.safeAddress.toLowerCase()) : [],
        });
        if (!stored || !next) return;
      } catch (error) {
        console.warn(
          "Deposit scan failed",
          error instanceof Error
            ? error.message.split("\n")[0].slice(0, 240)
            : "Unknown failure",
        );
        const detail =
          error instanceof Error &&
          /^(Deposit history|Invalid history page|Invalid deposit history)/.test(
            error.message,
          )
            ? error.message
            : "Deposit history could not be verified";
        await ctx.runMutation(internal.depositsData.failed, {
          ...identity,
          error: `${detail}. Recorded entries are retained; retry resumes the unfinished scan.`,
        });
        return;
      }
    }
    await ctx.scheduler.runAfter(1000, internal.deposits.process, args);
  },
});
