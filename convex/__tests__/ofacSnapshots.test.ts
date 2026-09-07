import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { buildSdnIndex, type SdnEntry } from "../../shared/sanctions";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const rows: SdnEntry[] = [
  {
    sdnId: 1,
    primaryName: "Different Primary",
    firstName: "",
    lastName: "Different Primary",
    sourceType: "Entity",
    entityType: "entity",
    aliases: ["Alexanderson", "Мария Гарсия"],
    weakAliases: [],
    programs: ["EXAMPLE"],
    addresses: [
      {
        currency: "ETH",
        address: "0x1111111111111111111111111111111111111111",
      },
    ],
  },
];
async function setup() {
  const t = convexTest(schema);
  let sequence = 0;
  const begin = async () => {
    const refreshId = `refresh-${++sequence}`;
    expect(
      await t.mutation(internal.ofacData.claim, { refreshId, force: true }),
    ).toMatchObject({ acquired: true });
    const postings = buildSdnIndex(rows);
    const metadata = {
      refreshId,
      checksum: String(sequence).padStart(64, "0"),
      publishedAt: Date.UTC(2026, 8, 4),
      expectedEntries: rows.length,
      expectedPostings: postings.length,
      aliasCount: 2,
      addressCount: 1,
    };
    const snapshot = await t.mutation(internal.ofacData.begin, metadata);
    return { refreshId, datasetId: snapshot.datasetId, postings, metadata };
  };
  const complete = async (request: Awaited<ReturnType<typeof begin>>) => {
    const { refreshId, datasetId, postings } = request;
    await t.mutation(internal.ofacData.writeEntries, {
      refreshId,
      datasetId,
      offset: 0,
      entries: rows,
    });
    await t.mutation(internal.ofacData.writePostings, {
      refreshId,
      datasetId,
      offset: 0,
      postings,
    });
    await t.mutation(internal.ofacData.activate, { refreshId, datasetId });
  };
  return { t, begin, complete };
}

it("keeps the old complete snapshot visible throughout an interrupted import and switches atomically", async () => {
  const { t, begin, complete } = await setup();
  const first = await begin();
  await complete(first);
  const second = await begin();
  await t.mutation(internal.ofacData.writeEntries, {
    refreshId: second.refreshId,
    datasetId: second.datasetId,
    offset: 0,
    entries: rows,
  });
  await expect(
    t.mutation(internal.ofacData.activate, {
      refreshId: second.refreshId,
      datasetId: second.datasetId,
    }),
  ).rejects.toThrow(/incomplete/);
  expect((await t.query(internal.ofacData.current, {})).dataset?._id).toBe(
    first.datasetId,
  );
  await t.mutation(internal.ofacData.failed, {
    refreshId: second.refreshId,
    message: "Injected download interruption",
  });
  const retained = await t.query(internal.ofacData.current, {});
  expect(retained.dataset?._id).toBe(first.datasetId);
  expect(retained.source?.lastError).toContain("interruption");
  await t.mutation(internal.ofacData.claim, {
    refreshId: "resume",
    force: true,
  });
  const resumed = await t.mutation(internal.ofacData.begin, {
    ...second.metadata,
    refreshId: "resume",
  });
  expect(resumed).toMatchObject({
    datasetId: second.datasetId,
    entryCount: 1,
    postingCount: 0,
  });
  await t.mutation(internal.ofacData.writePostings, {
    refreshId: "resume",
    datasetId: second.datasetId,
    offset: 0,
    postings: second.postings,
  });
  await t.mutation(internal.ofacData.activate, {
    refreshId: "resume",
    datasetId: second.datasetId,
  });
  expect((await t.query(internal.ofacData.current, {})).dataset?._id).toBe(
    second.datasetId,
  );
  expect(await t.run((ctx) => ctx.db.get(first.datasetId))).toMatchObject({
    state: "retired",
  });
});

it("retries identical chunks once and rejects altered retries, missing offsets and duplicate records", async () => {
  const { t, begin } = await setup();
  const request = await begin();
  const args = {
    refreshId: request.refreshId,
    datasetId: request.datasetId,
    offset: 0,
    entries: rows,
  };
  await t.mutation(internal.ofacData.writeEntries, args);
  await t.mutation(internal.ofacData.writeEntries, args);
  expect(
    await t.run((ctx) => ctx.db.query("ofacEntries").collect()),
  ).toHaveLength(1);
  await expect(
    t.mutation(internal.ofacData.writeEntries, {
      ...args,
      entries: [{ ...rows[0], primaryName: "Changed retry" }],
    }),
  ).rejects.toThrow(/different contents/);
  await expect(
    t.mutation(internal.ofacData.writePostings, {
      refreshId: request.refreshId,
      datasetId: request.datasetId,
      offset: 1,
      postings: request.postings.slice(0, 1),
    }),
  ).rejects.toThrow(/in order/);
  await expect(
    t.mutation(internal.ofacData.writePostings, {
      refreshId: request.refreshId,
      datasetId: request.datasetId,
      offset: 0,
      postings: [request.postings[0], request.postings[0]],
    }),
  ).rejects.toThrow(/duplicate/);
  expect(
    await t.run((ctx) => ctx.db.query("ofacSearchPostings").collect()),
  ).toHaveLength(0);
});

it("prevents a stale worker or concurrent refresh from publishing, and rejects publication rollback", async () => {
  const { t, begin, complete } = await setup();
  const first = await begin();
  await complete(first);
  const next = await begin();
  expect(
    await t.mutation(internal.ofacData.claim, {
      refreshId: "competitor",
      force: true,
    }),
  ).toMatchObject({ acquired: false, reason: "in_progress" });
  vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
  await t.mutation(internal.ofacData.claim, {
    refreshId: "new-worker",
    force: true,
  });
  await expect(
    t.mutation(internal.ofacData.writeEntries, {
      refreshId: next.refreshId,
      datasetId: next.datasetId,
      offset: 0,
      entries: rows,
    }),
  ).rejects.toThrow(/lease/);
  await expect(
    t.mutation(internal.ofacData.begin, {
      ...next.metadata,
      refreshId: "new-worker",
      publishedAt: Date.UTC(2025, 1, 1),
    }),
  ).rejects.toThrow(/older/);
  expect((await t.query(internal.ofacData.current, {})).dataset?._id).toBe(
    first.datasetId,
  );
});

it("a successful unchanged download renews freshness without rebuilding or changing the version", async () => {
  const { t, begin, complete } = await setup();
  const first = await begin();
  await complete(first);
  vi.setSystemTime(Date.now() + 3600_000);
  await t.mutation(internal.ofacData.claim, { refreshId: "unchanged" });
  const result = await t.mutation(internal.ofacData.begin, {
    ...first.metadata,
    refreshId: "unchanged",
  });
  expect(result).toMatchObject({ unchanged: true, datasetId: first.datasetId });
  expect(
    (await t.query(internal.ofacData.current, {})).source?.lastCheckedAt,
  ).toBe(Date.now());
  expect(
    await t.run((ctx) => ctx.db.query("ofacDatasets").collect()),
  ).toHaveLength(1);
});

it("candidate retrieval finds unrelated aliases, spelling changes and exact addresses without fuzzy addresses", async () => {
  const { t, begin, complete } = await setup();
  const request = await begin();
  await complete(request);
  for (const name of ["Alexandersan", "Мария Гарсия"])
    expect(
      await t.query(internal.ofacData.candidates, {
        datasetId: request.datasetId,
        name,
      }),
    ).toMatchObject([{ sdnId: 1 }]);
  expect(
    await t.query(internal.ofacData.candidates, {
      datasetId: request.datasetId,
      name: "Unrelated Name",
      walletAddress: rows[0].addresses[0].address,
      chainId: 1,
    }),
  ).toMatchObject([{ sdnId: 1 }]);
  expect(
    await t.query(internal.ofacData.candidates, {
      datasetId: request.datasetId,
      name: "Unrelated Name",
      walletAddress: "0x1111111111111111111111111111111111111112",
      chainId: 1,
    }),
  ).toEqual([]);
});

it("prunes replaced search contents in bounded batches while preserving publication metadata and active data", async () => {
  const { t, begin, complete } = await setup();
  const old = await begin();
  await complete(old);
  await t.run(async (ctx) => {
    for (let i = 2; i <= 180; i++)
      await ctx.db.insert("ofacEntries", {
        ...rows[0],
        datasetId: old.datasetId,
        sdnId: i,
      });
  });
  const active = await begin();
  await complete(active);
  expect(await t.mutation(internal.ofacRetention.prune, {})).toBeNull();
  vi.setSystemTime(Date.now() + 7 * 86400_000 + 1);
  expect(await t.mutation(internal.ofacRetention.prune, {})).toMatchObject({
    datasetId: old.datasetId,
    complete: false,
  });
  expect(await t.mutation(internal.ofacRetention.prune, {})).toMatchObject({
    datasetId: old.datasetId,
    complete: true,
  });
  expect(await t.run((ctx) => ctx.db.get(old.datasetId))).toMatchObject({
    state: "retired",
    checksum: old.metadata.checksum,
    contentsDeletedAt: Date.now(),
  });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("ofacEntries")
        .withIndex("by_dataset_sdn", (q) => q.eq("datasetId", old.datasetId))
        .collect(),
    ),
  ).toEqual([]);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("ofacEntries")
        .withIndex("by_dataset_sdn", (q) => q.eq("datasetId", active.datasetId))
        .collect(),
    ),
  ).toHaveLength(1);
  await expect(
    t.query(internal.ofacData.candidates, {
      datasetId: old.datasetId,
      name: "Different Primary",
    }),
  ).rejects.toThrow(/unavailable/);
  expect(await t.mutation(internal.ofacRetention.prune, {})).toBeNull();
});
