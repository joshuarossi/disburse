import { internalQuery } from "./_generated/server";

// Operator-only, read-only queue health. No session/signature/recipient contents,
// provider calls, job mutations or transaction submissions are returned/performed.
export const summary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now(),
      late = now - 15 * 60_000,
      cap = 100;
    const [circle, native, transfers, services, reports, reportErrors] =
      await Promise.all([
        ctx.db
          .query("circleExecutions")
          .withIndex("by_due", (q) =>
            q.gt("recoveryAt", 0).lte("recoveryAt", late),
          )
          .take(cap + 1),
        ctx.db
          .query("disbursements")
          .withIndex("by_native_recovery", (q) =>
            q.gt("nativeRecoveryAt", 0).lte("nativeRecoveryAt", late),
          )
          .take(cap + 1),
        ctx.db
          .query("treasuryTransfers")
          .withIndex("by_due", (q) =>
            q.gt("recoveryAt", 0).lte("recoveryAt", late),
          )
          .take(cap + 1),
        ctx.db
          .query("treasuryServices")
          .withIndex("by_due", (q) =>
            q.gt("recoveryAt", 0).lte("recoveryAt", late),
          )
          .take(cap + 1),
        ctx.db
          .query("reportIndexJobs")
          .withIndex("by_due", (q) => q.lte("nextAt", late))
          .take(cap + 1),
        ctx.db
          .query("reportIndexJobs")
          .withIndex("by_error", (q) => q.eq("hasError", true))
          .take(cap + 1),
      ]);
    const groups = {
      executionRecovery: circle,
      nativeRecovery: native,
      transferRecovery: transfers,
      serviceRecovery: services,
      reportBacklog: reports,
      reportErrors,
    };
    const queues = Object.fromEntries(
      Object.entries(groups).map(([name, rows]) => [
        name,
        {
          count: Math.min(rows.length, cap),
          truncated: rows.length > cap,
          sampleIds: rows.slice(0, 5).map((row) => row._id),
        },
      ]),
    );
    return {
      checkedAt: now,
      overdueAfterMinutes: 15,
      status: Object.values(groups).some((rows) => rows.length)
        ? "attention"
        : "queues_clear",
      queues,
    };
  },
});
