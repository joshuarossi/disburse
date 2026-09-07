import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestMembership,
  signIn,
  TEST_WALLETS,
} from "./factories";
import {
  buildSdnIndex,
  OFAC_SOURCE,
  SCREENING_ENGINE,
  type SdnEntry,
} from "../../shared/sanctions";
import {
  screeningInput,
  screeningInputFingerprint,
} from "../../shared/screeningEvidence";
import { assertPaymentMayProceed } from "../lib/disbursementPolicy";
import { createTestDisbursement } from "./factories";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const listed: SdnEntry = {
  sdnId: 1,
  primaryName: "Maya Chen",
  firstName: "Maya",
  lastName: "Chen",
  sourceType: "Individual",
  entityType: "individual",
  aliases: [],
  weakAliases: [],
  programs: ["EXAMPLE"],
  addresses: [
    { currency: "ETH", address: "0x2222222222222222222222222222222222222222" },
  ],
};
async function setup(name = "Maya Chen") {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const beneficiaryId = await createTestBeneficiary(ctx, ids.orgId, {
      name,
      walletAddress: "0x1111111111111111111111111111111111111111",
    });
    const paymentId = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      beneficiaryId,
      ids.userId,
      { status: "draft" },
    );
    return { ...ids, beneficiaryId, paymentId };
  });
  const { sessionToken } = await signIn(t, "admin");
  // Isolate screening expiry from the separately tested sign-in expiry.
  await t.run(async (ctx) => {
    for (const session of await ctx.db.query("sessions").collect())
      await ctx.db.patch(session._id, {
        expiresAt: Date.now() + 40 * 86400_000,
      });
  });
  const load = async (entry = listed) =>
    t.run(async (ctx) => {
      const postings = buildSdnIndex([entry]);
      const old = await ctx.db.query("ofacSources").first();
      const datasetId = await ctx.db.insert("ofacDatasets", {
        checksum: "a".repeat(64),
        engine: SCREENING_ENGINE,
        sourceUrl: OFAC_SOURCE,
        publishedAt: Date.UTC(2026, 8, 4),
        fetchedAt: Date.now(),
        activatedAt: Date.now(),
        state: "active",
        expectedEntries: 1,
        expectedPostings: postings.length,
        entryCount: 1,
        postingCount: postings.length,
        aliasCount: entry.aliases.length,
        addressCount: entry.addresses.length,
      });
      if (old) {
        if (old.activeDatasetId)
          await ctx.db.patch(old.activeDatasetId, { state: "retired" });
        await ctx.db.patch(old._id, {
          activeDatasetId: datasetId,
          lastCheckedAt: Date.now(),
        });
      } else
        await ctx.db.insert("ofacSources", {
          name: "ofac_sdn",
          activeDatasetId: datasetId,
          lastCheckedAt: Date.now(),
        });
      await ctx.db.insert("ofacEntries", { datasetId, ...entry });
      for (const posting of postings)
        await ctx.db.insert("ofacSearchPostings", { datasetId, ...posting });
      return datasetId;
    });
  const read = () =>
    t.query(api.screeningQueries.getScreeningResult, {
      beneficiaryId: ids.beneficiaryId,
      sessionToken,
    });
  const scan = () =>
    t.action(api.screening.rerunScreening, {
      beneficiaryId: ids.beneficiaryId,
      sessionToken,
    });
  const decision = async () => {
    const result = await read();
    if (!result?._id || !result.evidenceKey)
      throw new Error("Missing fixture evidence");
    return {
      screeningResultId: result._id,
      sessionToken,
      status: "false_positive" as const,
      reason:
        "Independent identity records distinguish this supplier from the listed person.",
      expectedEvidenceKey: result.evidenceKey,
      validDays: 7,
    };
  };
  const check = () =>
    t.query(api.screeningQueries.checkBeneficiaries, {
      orgId: ids.orgId,
      sessionToken,
      beneficiaryIds: [ids.beneficiaryId],
    });
  return { t, ids, sessionToken, load, read, scan, decision, check };
}

it("records versioned evidence and retains an unexpired decision only for unchanged recipient and matches", async () => {
  const { t, load, scan, read, decision } = await setup();
  const first = await load();
  await scan();
  expect(await read()).toMatchObject({
    datasetId: first,
    status: "potential_match",
    matches: [{ kind: "name", matchedName: "Maya Chen" }],
  });
  await t.mutation(
    api.screeningMutations.reviewScreeningResult,
    await decision(),
  );
  const reviewed = await read();
  if (!reviewed?._id) throw new Error("Missing reviewed evidence");
  expect(reviewed?.status).toBe("false_positive");
  vi.setSystemTime(Date.now() + 2 * 60_000);
  const second = await load();
  await scan();
  expect(await read()).toMatchObject({
    datasetId: second,
    status: "false_positive",
    reviewExpiresAt: reviewed?.reviewExpiresAt,
  });
  expect(
    await t.run((ctx) => ctx.db.query("screeningDecisions").collect()),
  ).toHaveLength(1);
  vi.setSystemTime(Date.now() + 2 * 60_000);
  await load({ ...listed, programs: ["CHANGED-EVIDENCE"] });
  await scan();
  expect(await read()).toMatchObject({
    status: "potential_match",
  });
  expect((await read())?.reviewExpiresAt).toBeUndefined();
  expect(
    await t.run((ctx) => ctx.db.query("screeningRuns").collect()),
  ).toHaveLength(3);
});

it("rejects stale review screens, expires decisions, and requires a fresh check after recipient edits", async () => {
  const { t, ids, load, scan, read, decision, sessionToken, check } =
    await setup();
  await load();
  await scan();
  const staleDecision = await decision();
  await t.mutation(api.screeningMutations.updateScreeningEnforcement, {
    orgId: ids.orgId,
    sessionToken,
    enforcement: "block",
  });
  await t.run((ctx) =>
    ctx.db.patch(ids.beneficiaryId, { email: "new@example.com" }),
  );
  expect(await check()).toMatchObject({
    clear: false,
    flagged: [{ status: "changed" }],
  });
  await expect(
    t.mutation(api.screeningMutations.reviewScreeningResult, staleDecision),
  ).rejects.toThrow(/details changed/);
  await scan();
  await expect(
    t.mutation(api.screeningMutations.reviewScreeningResult, staleDecision),
  ).rejects.toThrow(/evidence changed/);
  await t.mutation(
    api.screeningMutations.reviewScreeningResult,
    await decision(),
  );
  vi.setSystemTime(Date.now() + 7 * 86400_000 + 1);
  await load();
  await scan();
  expect((await read())?.status).toBe("potential_match");
});

it("blocks missing, stale and unavailable screening at the shared payment gate and honors warn/off policy", async () => {
  const { t, ids, load, scan, sessionToken, check } = await setup(
    "Unrelated Contractor",
  );
  const set = (enforcement: "block" | "warn" | "off", maximumAgeHours = 24) =>
    t.mutation(api.screeningMutations.updateScreeningEnforcement, {
      orgId: ids.orgId,
      sessionToken,
      enforcement,
      maximumAgeHours,
    });
  const gate = () =>
    t.run(async (ctx) =>
      assertPaymentMayProceed(ctx, (await ctx.db.get(ids.paymentId))!),
    );
  await set("block");
  expect(await check()).toMatchObject({
    clear: false,
    flagged: [{ status: "unavailable" }],
  });
  await expect(gate()).rejects.toThrow(/screening policy/);
  await load();
  expect(await check()).toMatchObject({
    clear: false,
    flagged: [{ status: "pending" }],
  });
  await scan();
  expect(await check()).toMatchObject({ clear: true });
  await expect(gate()).resolves.toBeNull();
  vi.setSystemTime(Date.now() + 25 * 3600_000);
  expect(await check()).toMatchObject({
    clear: false,
    flagged: [{ status: "stale" }],
  });
  await expect(gate()).rejects.toThrow(/freshness/);
  await set("warn");
  expect(await check()).toMatchObject({ clear: false, enforcement: "warn" });
  await expect(gate()).resolves.toBeNull();
  await set("block", 72);
  expect(await check()).toMatchObject({ clear: true });
  await expect(gate()).resolves.toBeNull();
  const recipient = await t.run((ctx) => ctx.db.get(ids.beneficiaryId));
  const outage = await t.mutation(internal.screeningMutations.beginScreening, {
    orgId: ids.orgId,
    beneficiaryId: ids.beneficiaryId,
  });
  await t.mutation(internal.screeningMutations.upsertScreeningResult, {
    orgId: ids.orgId,
    beneficiaryId: ids.beneficiaryId,
    input: screeningInput(recipient!),
    expectedFingerprint: screeningInputFingerprint(recipient!),
    attempt: outage!.attempt,
    status: "unavailable",
    matches: [],
    error: "Injected provider outage",
  });
  expect(await check()).toMatchObject({
    clear: false,
    flagged: [{ status: "unavailable" }],
  });
  await expect(gate()).rejects.toThrow(/provider outage/);
  await set("off");
  expect(await check()).toMatchObject({ clear: true, enforcement: "off" });
  await expect(gate()).resolves.toBeNull();
});

it("does not accept a name false-positive override for an exact address on its listed network", async () => {
  const { t, ids, load, scan, read, decision } = await setup(
    "Unrelated Contractor",
  );
  await load();
  await t.run((ctx) =>
    ctx.db.patch(ids.beneficiaryId, {
      walletAddress: listed.addresses[0].address,
      preferredChainId: 1,
    }),
  );
  await scan();
  expect(await read()).toMatchObject({
    matches: [
      { kind: "address", networkMatch: "listed_network", matchScore: 1 },
    ],
  });
  await expect(
    t.mutation(api.screeningMutations.reviewScreeningResult, await decision()),
  ).rejects.toThrow(/exact address/);
});

it("holds a bounded group for background screening and does not requeue the same recipients immediately", async () => {
  const { t, ids, load } = await setup("Unrelated Contractor");
  await load();
  await t.run(async (ctx) => {
    for (let i = 0; i < 125; i++)
      await createTestBeneficiary(ctx, ids.orgId, {
        name: `Queue recipient ${i}`,
      });
  });
  await t.mutation(internal.screeningQueue.due, {});
  const waiting = await t.run((ctx) => ctx.db.query("beneficiaries").collect());
  expect(
    waiting.filter((r) => (r.nextScreeningAt ?? 0) > Date.now()),
  ).toHaveLength(100);
  const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.some(job => job.name === "screeningQueue:due" && job.scheduledTime <= Date.now() + 1000)).toBe(true);
  await t.mutation(internal.screeningQueue.due, {});
  expect(
    (await t.run((ctx) => ctx.db.query("beneficiaries").collect())).filter(
      (r) => (r.nextScreeningAt ?? 0) > Date.now(),
    ),
  ).toHaveLength(126);
});

it.each(["false_positive", "confirmed_match"] as const)("preserves a %s decision across an outage and an unchanged list update", async status => {
  const { t, ids, sessionToken, load, scan, read, decision, check } = await setup();
  await t.mutation(api.screeningMutations.updateScreeningEnforcement, { orgId: ids.orgId, sessionToken, enforcement: "block" });
  await load();
  await scan();
  await t.mutation(api.screeningMutations.reviewScreeningResult, { ...(await decision()), status });
  const reviewed = await read();
  if (!reviewed?._id) throw new Error("Missing reviewed evidence");
  const attempt = await t.mutation(internal.screeningMutations.beginScreening, { orgId: ids.orgId, beneficiaryId: ids.beneficiaryId });
  await t.mutation(internal.screeningMutations.upsertScreeningResult, {
    orgId: ids.orgId, beneficiaryId: ids.beneficiaryId, attempt: attempt!.attempt,
    input: screeningInput(attempt!.recipient), expectedFingerprint: screeningInputFingerprint(attempt!.recipient),
    status: "unavailable", matches: [], error: "Temporary source outage",
  });
  expect(await read()).toMatchObject({ status, decisionId: reviewed!.decisionId, runId: reviewed!.runId, reviewExpiresAt: reviewed!.reviewExpiresAt, lastError: "Temporary source outage" });
  expect(await check()).toMatchObject({ clear: false, flagged: [{ status: status === "confirmed_match" ? status : "unavailable" }] });
  const nextDataset = await load();
  await scan();
  expect(await read()).toMatchObject({ status, decisionId: reviewed!.decisionId, datasetId: nextDataset, reviewExpiresAt: reviewed!.reviewExpiresAt });
  expect((await t.run(ctx => ctx.db.get(reviewed._id)))!.lastError).toBeUndefined();
  expect(await t.run(ctx => ctx.db.query("screeningRuns").collect())).toHaveLength(3);
});

it("keeps a confirmed match after the review period while retaining its original evidence", async () => {
  const { t, load, scan, read, decision } = await setup();
  await load(); await scan();
  await t.mutation(api.screeningMutations.reviewScreeningResult, { ...(await decision()), status: "confirmed_match" });
  const reviewed = await read();
  if (!reviewed?._id) throw new Error("Missing reviewed evidence");
  vi.setSystemTime(Date.now() + 8 * 86400_000);
  await load(); await scan();
  expect(await read()).toMatchObject({ status: "confirmed_match", decisionId: reviewed!.decisionId });
});

it("requires an administrator to review a hit even when an approver can authorize payments", async () => {
  const { t, ids, load, scan, decision } = await setup();
  const approver = await signIn(t, "approver");
  await t.run(ctx => createTestMembership(ctx, ids.orgId, approver.userId, { role: "approver" }));
  await load(); await scan();
  const review = await decision();
  expect(await t.query(api.screeningQueries.getScreeningResult, { beneficiaryId: ids.beneficiaryId, sessionToken: approver.sessionToken })).toMatchObject({ canReview: false });
  await expect(t.mutation(api.screeningMutations.reviewScreeningResult, { ...review, sessionToken: approver.sessionToken })).rejects.toThrow(/role|permission|access/i);
  expect(await t.run(ctx => ctx.db.query("screeningDecisions").collect())).toHaveLength(0);
});

it("rejects results for a retired list with a retryable code without overwriting the last evidence", async () => {
  const { t, ids, load, scan, read } = await setup();
  const datasetId = await load(); await scan();
  const previous = await read();
  const attempt = await t.mutation(internal.screeningMutations.beginScreening, { orgId: ids.orgId, beneficiaryId: ids.beneficiaryId });
  await load();
  await expect(t.mutation(internal.screeningMutations.upsertScreeningResult, {
    orgId: ids.orgId, beneficiaryId: ids.beneficiaryId, datasetId, attempt: attempt!.attempt,
    input: screeningInput(attempt!.recipient), expectedFingerprint: screeningInputFingerprint(attempt!.recipient), status: "clear", matches: [],
  })).rejects.toThrow(/SCREENING_DATASET_CHANGED/);
  expect(await read()).toMatchObject({ runId: previous!.runId, status: previous!.status });
});

it("rejects both older success and older failure after a newer attempt completes", async () => {
  const { t, ids, load, scan, read } = await setup("Unrelated Contractor");
  const datasetId = await load();
  const earlier = await t.mutation(internal.screeningMutations.beginScreening, {
    orgId: ids.orgId,
    beneficiaryId: ids.beneficiaryId,
  });
  await scan();
  const current = await read();
  const request = {
    orgId: ids.orgId,
    beneficiaryId: ids.beneficiaryId,
    input: screeningInput(earlier!.recipient),
    expectedFingerprint: screeningInputFingerprint(earlier!.recipient),
    attempt: earlier!.attempt,
    matches: [],
  };
  await expect(
    t.mutation(internal.screeningMutations.upsertScreeningResult, {
      ...request,
      status: "unavailable",
      error: "Delayed failure",
    }),
  ).rejects.toThrow(/superseded/);
  await expect(
    t.mutation(internal.screeningMutations.upsertScreeningResult, {
      ...request,
      status: "clear",
      datasetId,
    }),
  ).rejects.toThrow(/superseded/);
  expect(await read()).toMatchObject({
    runId: current!.runId,
    status: "clear",
  });
  expect(
    await t.run((ctx) => ctx.db.query("screeningRuns").collect()),
  ).toHaveLength(1);
});

it("keeps confirmed-match warnings visible but hides decisions when the underlying evidence is stale", async () => {
  const { t, load, scan, read, decision } = await setup();
  await load();
  await scan();
  await t.mutation(api.screeningMutations.reviewScreeningResult, {
    ...(await decision()),
    status: "confirmed_match",
  });
  expect(await read()).toMatchObject({
    status: "confirmed_match",
    canReview: true,
  });
  vi.setSystemTime(Date.now() + 25 * 3600_000);
  expect(await read()).toMatchObject({
    issue: { status: "confirmed_match" },
    canReview: false,
  });
  await expect(
    t.mutation(api.screeningMutations.reviewScreeningResult, await decision()),
  ).rejects.toThrow(/freshness/);
});
