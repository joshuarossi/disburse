import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { sdnEntryFields } from "./lib/sanctionsValidators";
import { requireOrgAccess } from "./lib/rbac";
import { fingerprint } from "../shared/fingerprint";
import {
  NAME_THRESHOLD,
  OFAC_SOURCE,
  SCREENING_ENGINE,
  nameSearchPlan,
} from "../shared/sanctions";

const leaseMs = 10 * 60_000;
export const sourceRecord = (ctx: Pick<QueryCtx, "db">) =>
  ctx.db
    .query("ofacSources")
    .withIndex("by_name", (q) => q.eq("name", "ofac_sdn"))
    .unique();
async function requireLease(ctx: MutationCtx, refreshId: string) {
  const source = await sourceRecord(ctx);
  if (
    !source ||
    source.refreshId !== refreshId ||
    (source.leaseUntil ?? 0) <= Date.now()
  )
    throw new Error(
      "The OFAC refresh lease has expired. Resume with a new refresh.",
    );
  return source;
}
async function staging(
  ctx: MutationCtx,
  refreshId: string,
  datasetId: Id<"ofacDatasets">,
) {
  const source = await requireLease(ctx, refreshId);
  const dataset = await ctx.db.get(datasetId);
  if (source.stagingDatasetId !== datasetId || dataset?.state !== "staging")
    throw new Error("This OFAC snapshot is no longer staging.");
  return { source, dataset };
}
export const claim = internalMutation({
  args: { refreshId: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const source = await sourceRecord(ctx);
    if (source && (source.leaseUntil ?? 0) > Date.now())
      return { acquired: false, reason: "in_progress" as const };
    if (
      !args.force &&
      source?.activeDatasetId &&
      (source.lastCheckedAt ?? 0) > Date.now() - 15 * 60_000
    )
      return { acquired: false, reason: "recently_checked" as const };
    const fields = {
      refreshId: args.refreshId,
      leaseUntil: Date.now() + leaseMs,
      lastAttemptAt: Date.now(),
    };
    if (source) await ctx.db.patch(source._id, fields);
    else await ctx.db.insert("ofacSources", { name: "ofac_sdn", ...fields });
    return { acquired: true, reason: "started" as const };
  },
});
export const begin = internalMutation({
  args: {
    refreshId: v.string(),
    checksum: v.string(),
    publishedAt: v.number(),
    expectedEntries: v.number(),
    expectedPostings: v.number(),
    aliasCount: v.number(),
    addressCount: v.number(),
  },
  handler: async (ctx, args) => {
    const source = await requireLease(ctx, args.refreshId);
    if (
      !/^[a-f0-9]{64}$/.test(args.checksum) ||
      !Number.isSafeInteger(args.expectedEntries) ||
      args.expectedEntries < 1 ||
      args.expectedEntries > 100_000 ||
      !Number.isSafeInteger(args.expectedPostings) ||
      args.expectedPostings < 1 ||
      args.expectedPostings > 500_000
    )
      throw new Error("Invalid OFAC snapshot metadata.");
    const active = source.activeDatasetId
      ? await ctx.db.get(source.activeDatasetId)
      : null;
    if (
      active?.checksum === args.checksum &&
      active.engine === SCREENING_ENGINE
    ) {
      await ctx.db.patch(source._id, {
        lastCheckedAt: Date.now(),
        lastError: undefined,
        refreshId: undefined,
        leaseUntil: undefined,
      });
      return {
        unchanged: true as const,
        datasetId: active._id,
        entryCount: active.entryCount,
        postingCount: active.postingCount,
      };
    }
    if (active && args.publishedAt < active.publishedAt)
      throw new Error(
        "The OFAC download is older than the active publication. The active list was retained.",
      );
    const previous = source.stagingDatasetId
      ? await ctx.db.get(source.stagingDatasetId)
      : null;
    if (
      previous?.state === "staging" &&
      previous.checksum === args.checksum &&
      previous.engine === SCREENING_ENGINE &&
      previous.expectedEntries === args.expectedEntries &&
      previous.expectedPostings === args.expectedPostings
    )
      return {
        unchanged: false as const,
        datasetId: previous._id,
        entryCount: previous.entryCount,
        postingCount: previous.postingCount,
      };
    if (previous?.state === "staging")
      await ctx.db.patch(previous._id, {
        state: "failed",
        retiredAt: Date.now(),
        cleanupAt: Date.now() + 7 * 86400_000,
      });
    const datasetId = await ctx.db.insert("ofacDatasets", {
      checksum: args.checksum,
      engine: SCREENING_ENGINE,
      sourceUrl: OFAC_SOURCE,
      publishedAt: args.publishedAt,
      fetchedAt: Date.now(),
      state: "staging",
      expectedEntries: args.expectedEntries,
      expectedPostings: args.expectedPostings,
      aliasCount: args.aliasCount,
      addressCount: args.addressCount,
      entryCount: 0,
      postingCount: 0,
    });
    await ctx.db.patch(source._id, {
      stagingDatasetId: datasetId,
      leaseUntil: Date.now() + leaseMs,
    });
    return {
      unchanged: false as const,
      datasetId,
      entryCount: 0,
      postingCount: 0,
    };
  },
});
const chunkIdentity = {
  refreshId: v.string(),
  datasetId: v.id("ofacDatasets"),
  offset: v.number(),
};
async function checkChunk(
  ctx: MutationCtx,
  datasetId: Id<"ofacDatasets">,
  kind: "entries" | "postings",
  offset: number,
  rows: unknown[],
  currentCount: number,
  expectedCount: number,
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    rows.length < 1 ||
    rows.length > 200 ||
    offset + rows.length > expectedCount
  )
    throw new Error("Invalid OFAC import chunk.");
  const checksum = fingerprint(rows);
  const saved = await ctx.db
    .query("ofacImportChunks")
    .withIndex("by_dataset_kind_offset", (q) =>
      q.eq("datasetId", datasetId).eq("kind", kind).eq("offset", offset),
    )
    .unique();
  if (saved) {
    if (saved.checksum !== checksum || saved.count !== rows.length)
      throw new Error("An OFAC chunk retry has different contents.");
    return { duplicate: true, checksum };
  }
  if (offset !== currentCount)
    throw new Error("OFAC import chunks must be applied in order.");
  return { duplicate: false, checksum };
}
export const writeEntries = internalMutation({
  args: { ...chunkIdentity, entries: v.array(v.object(sdnEntryFields)) },
  handler: async (ctx, args) => {
    const { source, dataset } = await staging(
      ctx,
      args.refreshId,
      args.datasetId,
    );
    const checked = await checkChunk(
      ctx,
      dataset._id,
      "entries",
      args.offset,
      args.entries,
      dataset.entryCount,
      dataset.expectedEntries,
    );
    if (checked.duplicate) return;
    for (const entry of args.entries) {
      if (
        !Number.isSafeInteger(entry.sdnId) ||
        entry.sdnId < 1 ||
        !entry.primaryName ||
        (await ctx.db
          .query("ofacEntries")
          .withIndex("by_dataset_sdn", (q) =>
            q.eq("datasetId", dataset._id).eq("sdnId", entry.sdnId),
          )
          .first())
      )
        throw new Error("Invalid or duplicate OFAC entry.");
      await ctx.db.insert("ofacEntries", { datasetId: dataset._id, ...entry });
    }
    await ctx.db.insert("ofacImportChunks", {
      datasetId: dataset._id,
      kind: "entries",
      offset: args.offset,
      count: args.entries.length,
      checksum: checked.checksum,
    });
    await ctx.db.patch(dataset._id, {
      entryCount: dataset.entryCount + args.entries.length,
    });
    await ctx.db.patch(source._id, { leaseUntil: Date.now() + leaseMs });
  },
});
export const writePostings = internalMutation({
  args: {
    ...chunkIdentity,
    postings: v.array(
      v.object({
        term: v.string(),
        part: v.number(),
        sdnIds: v.array(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { source, dataset } = await staging(
      ctx,
      args.refreshId,
      args.datasetId,
    );
    const checked = await checkChunk(
      ctx,
      dataset._id,
      "postings",
      args.offset,
      args.postings,
      dataset.postingCount,
      dataset.expectedPostings,
    );
    if (checked.duplicate) return;
    for (const posting of args.postings) {
      if (
        !posting.term ||
        posting.sdnIds.length < 1 ||
        posting.sdnIds.length > 1000 ||
        !Number.isSafeInteger(posting.part) ||
        posting.part < 0 ||
        (await ctx.db
          .query("ofacSearchPostings")
          .withIndex("by_dataset_term", (q) =>
            q
              .eq("datasetId", dataset._id)
              .eq("term", posting.term)
              .eq("part", posting.part),
          )
          .first())
      )
        throw new Error("Invalid or duplicate OFAC search index part.");
      await ctx.db.insert("ofacSearchPostings", {
        datasetId: dataset._id,
        ...posting,
      });
    }
    await ctx.db.insert("ofacImportChunks", {
      datasetId: dataset._id,
      kind: "postings",
      offset: args.offset,
      count: args.postings.length,
      checksum: checked.checksum,
    });
    await ctx.db.patch(dataset._id, {
      postingCount: dataset.postingCount + args.postings.length,
    });
    await ctx.db.patch(source._id, { leaseUntil: Date.now() + leaseMs });
  },
});
export const activate = internalMutation({
  args: { refreshId: v.string(), datasetId: v.id("ofacDatasets") },
  handler: async (ctx, args) => {
    const { source, dataset } = await staging(
      ctx,
      args.refreshId,
      args.datasetId,
    );
    if (
      dataset.entryCount !== dataset.expectedEntries ||
      dataset.postingCount !== dataset.expectedPostings
    )
      throw new Error(
        "The OFAC snapshot is incomplete. The previous list remains active.",
      );
    if (source.activeDatasetId)
      await ctx.db.patch(source.activeDatasetId, {
        state: "retired",
        retiredAt: Date.now(),
        cleanupAt: Date.now() + 7 * 86400_000,
      });
    await ctx.db.patch(dataset._id, {
      state: "active",
      activatedAt: Date.now(),
    });
    await ctx.db.patch(source._id, {
      activeDatasetId: dataset._id,
      stagingDatasetId: undefined,
      refreshId: undefined,
      leaseUntil: undefined,
      lastCheckedAt: Date.now(),
      lastError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.screeningQueue.allPage, {
      datasetId: dataset._id,
      cursor: null,
    });
    return dataset._id;
  },
});
export const failed = internalMutation({
  args: { refreshId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const source = await sourceRecord(ctx);
    if (source?.refreshId === args.refreshId)
      await ctx.db.patch(source._id, {
        leaseUntil: undefined,
        refreshId: undefined,
        lastError: args.message.slice(0, 500),
      });
  },
});
export const current = internalQuery({
  args: {},
  handler: async (ctx) => {
    const source = await sourceRecord(ctx);
    return {
      source,
      dataset: source?.activeDatasetId
        ? await ctx.db.get(source.activeDatasetId)
        : null,
    };
  },
});
export const authorizeRefresh = internalQuery({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin"]);
    return true;
  },
});
export const status = query({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);
    const source = await sourceRecord(ctx),
      dataset = source?.activeDatasetId
        ? await ctx.db.get(source.activeDatasetId)
        : null;
    const staging = source?.stagingDatasetId
      ? await ctx.db.get(source.stagingDatasetId)
      : null;
    return {
      dataset,
      refreshProgress:
        staging?.state === "staging"
          ? {
              completed: staging.entryCount + staging.postingCount,
              total: staging.expectedEntries + staging.expectedPostings,
            }
          : null,
      lastCheckedAt: source?.lastCheckedAt,
      lastError: source?.lastError,
      refreshing: (source?.leaseUntil ?? 0) > Date.now(),
      sourceUrl: OFAC_SOURCE,
      engine: SCREENING_ENGINE,
      threshold: NAME_THRESHOLD,
    };
  },
});
export const candidates = internalQuery({
  args: {
    datasetId: v.id("ofacDatasets"),
    name: v.string(),
    walletAddress: v.optional(v.string()),
    chainId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    if (
      !dataset ||
      dataset.contentsDeletedAt !== undefined ||
      !["active", "retired"].includes(dataset.state) ||
      dataset.engine !== SCREENING_ENGINE
    )
      throw new Error("The OFAC snapshot is unavailable.");
    const plan = nameSearchPlan(args.name),
      counts = new Map<number, number>(),
      addressIds = new Set<number>();
    const addressKey =
      args.walletAddress &&
      /^0x[0-9a-f]{40}$/i.test(args.walletAddress) &&
      ![11155111, 84532].includes(args.chainId ?? 0)
        ? `a:evm:${args.walletAddress.toLowerCase()}`
        : null;
    let postingIds = 0;
    for (const term of [...plan.keys, ...(addressKey ? [addressKey] : [])]) {
      const postings = await ctx.db
        .query("ofacSearchPostings")
        .withIndex("by_dataset_term", (q) =>
          q.eq("datasetId", dataset._id).eq("term", term),
        )
        .take(101);
      if (postings.length > 100)
        throw new Error(
          "This name needs a more specific screening review; candidate lookup exceeded its supported size.",
        );
      for (const part of postings)
        for (const id of part.sdnIds) {
          if (++postingIds > 500_000)
            throw new Error(
              "This name needs a more specific screening review; candidate lookup exceeded its supported size.",
            );
          if (term === addressKey) addressIds.add(id);
          else counts.set(id, (counts.get(id) ?? 0) + 1);
        }
    }
    const ids = [
      ...new Set(
        [...counts]
          .filter(([, count]) => count >= plan.minimumShared)
          .map(([id]) => id)
          .concat([...addressIds]),
      ),
    ];
    if (ids.length > 2000)
      throw new Error(
        "This name is too broad for an automatic screening result. Review a more complete recipient name.",
      );
    const records = await Promise.all(
      ids.map((id) =>
        ctx.db
          .query("ofacEntries")
          .withIndex("by_dataset_sdn", (q) =>
            q.eq("datasetId", dataset._id).eq("sdnId", id),
          )
          .unique(),
      ),
    );
    if (records.some((row) => !row))
      throw new Error(
        "The OFAC search index is incomplete. No clear result was recorded.",
      );
    return records.filter((row) => row !== null);
  },
});
