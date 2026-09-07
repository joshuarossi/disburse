import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { sourceRecord } from "./ofacData";

// Evidence runs and publication metadata remain available. Search contents and
// resumable import journals for replaced snapshots are retained for seven days.
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const source = await sourceRecord(ctx);
    for (const state of ["retired", "failed"] as const) {
      const dataset = await ctx.db
        .query("ofacDatasets")
        .withIndex("by_state_cleanup", (q) =>
          q.eq("state", state).gt("cleanupAt", 0).lte("cleanupAt", Date.now()),
        )
        .first();
      if (!dataset) continue;
      if (
        source?.activeDatasetId === dataset._id ||
        source?.stagingDatasetId === dataset._id
      ) {
        await ctx.db.patch(dataset._id, { cleanupAt: Date.now() + 86400_000 });
        continue;
      }
      const entries = await ctx.db
        .query("ofacEntries")
        .withIndex("by_dataset_sdn", (q) => q.eq("datasetId", dataset._id))
        .take(151);
      const postings = await ctx.db
        .query("ofacSearchPostings")
        .withIndex("by_dataset_term", (q) => q.eq("datasetId", dataset._id))
        .take(151);
      const chunks = await ctx.db
        .query("ofacImportChunks")
        .withIndex("by_dataset_kind_offset", (q) =>
          q.eq("datasetId", dataset._id),
        )
        .take(151);
      let deleted = 0;
      for (const group of [entries, postings, chunks])
        for (const row of group.slice(0, 150)) {
          await ctx.db.delete(row._id);
          deleted++;
        }
      const complete = [entries, postings, chunks].every(
        (group) => group.length <= 150,
      );
      if (complete)
        await ctx.db.patch(dataset._id, {
          cleanupAt: undefined,
          contentsDeletedAt: Date.now(),
        });
      await ctx.scheduler.runAfter(0, internal.ofacRetention.prune, {});
      return { datasetId: dataset._id, deleted, complete };
    }
    return null;
  },
});
