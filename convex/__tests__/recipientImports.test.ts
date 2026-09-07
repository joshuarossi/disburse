import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  signIn,
  TEST_WALLETS,
} from "./factories";
import {
  importFingerprint,
  planRecipientImport,
  type ImportedRecipient,
} from "../../shared/recipientImport";

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const recipientId = await createTestBeneficiary(ctx, ids.orgId, {
      name: "Maya Chen",
      walletAddress: "0x1111111111111111111111111111111111111111",
    });
    await ctx.db.patch(recipientId, {
      email: "maya@example.com",
      sourceSystem: "gusto",
      sourceId: "0012",
      preferredToken: "USDC",
      preferredChainId: 8453,
    });
    return { ...ids, recipientId };
  });
  const { sessionToken } = await signIn(t, "admin");
  const args = { orgId: ids.orgId, sessionToken };
  const plan = async (rows: ImportedRecipient[]) => {
    const directory = await t.run((ctx) =>
      ctx.db
        .query("beneficiaries")
        .withIndex("by_org", (q) => q.eq("orgId", ids.orgId))
        .collect(),
    );
    return planRecipientImport(rows, directory);
  };
  const request = async (rows: ImportedRecipient[]) => ({
    ...args,
    requestId: crypto.randomUUID(),
    rows: (await plan(rows)).map((p) => ({
      recipient: p.row,
      operation: p.recommendation as "create" | "update",
      existingId: p.existingId as Id<"beneficiaries"> | undefined,
      expectedFingerprint: p.expectedFingerprint,
    })),
  });
  return { t, ids, args, plan, request };
}

it("matches a payroll employee by stable ID after an email change and keeps leading zeros", async () => {
  const { t, ids, plan, request } = await setup();
  const rows = [
    {
      name: "Maya Chen",
      sourceSystem: "Gusto",
      sourceId: "0012",
      email: "maya.new@example.com",
    },
  ];
  const preview = await plan(rows);
  expect(preview[0]).toMatchObject({
    recommendation: "update",
    existingId: ids.recipientId,
    payoutChanged: false,
    errors: [],
  });
  await t.mutation(api.recipientImports.commit, await request(rows));
  const saved = await t.run((ctx) => ctx.db.get(ids.recipientId));
  expect(saved).toMatchObject({
    email: "maya.new@example.com",
    sourceId: "0012",
    walletAddress: "0x1111111111111111111111111111111111111111".toLowerCase(),
    payoutVersion: 1,
    payoutReviewStatus: "approved",
  });
  expect((await plan(rows))[0].recommendation).toBe("skip");
});

it("stages imported replacement instructions for review without changing the approved payout", async () => {
  const { t, ids, request } = await setup();
  const result = await t.mutation(
    api.recipientImports.commit,
    await request([
      {
        name: "Maya Chen",
        sourceId: "0012",
        sourceSystem: "gusto",
        walletAddress: "0x2222222222222222222222222222222222222222",
        preferredToken: "USDT",
      },
    ]),
  );
  expect(result).toMatchObject({ created: 0, updated: 1, reviewRequested: 1 });
  const saved = (await t.run((ctx) => ctx.db.get(ids.recipientId)))!;
  expect(saved).toMatchObject({
    walletAddress: "0x1111111111111111111111111111111111111111".toLowerCase(),
    preferredToken: "USDC",
    payoutVersion: 1,
  });
  const pending = await t.run((ctx) =>
    ctx.db.get(saved.pendingPayoutChangeId!),
  );
  expect(pending?.proposed).toMatchObject({
    walletAddress: "0x2222222222222222222222222222222222222222".toLowerCase(),
    preferredToken: "USDT",
    preferredChainId: 8453,
  });
});

it("creates incomplete employee records and replays a lost import response without duplicates", async () => {
  const { t, request } = await setup();
  const args = await request([
    {
      name: "Jamie Rivera",
      email: "jamie@example.com",
      sourceSystem: "gusto",
      sourceId: "0020",
    },
  ]);
  const first = await t.mutation(api.recipientImports.commit, args);
  expect(first).toMatchObject({ created: 1, updated: 0, reviewRequested: 0 });
  expect(await t.mutation(api.recipientImports.commit, args)).toEqual(first);
  expect(
    await t.query(api.recipientImports.status, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
      requestId: args.requestId,
      requestHash: importFingerprint(args.rows),
    }),
  ).toMatchObject({ created: 1, updated: 0 });
  expect(
    await t.query(api.recipientImports.status, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
      requestId: args.requestId,
      requestHash: "wrong",
    }),
  ).toBeNull();
  expect(importFingerprint({ a: 1, b: 2 })).toBe(
    importFingerprint({ b: 2, a: 1 }),
  );
  const saved = await t.run((ctx) => ctx.db.get(first.recipientIds[0]));
  expect(saved).toMatchObject({
    walletAddress: "",
    payoutReviewStatus: "unreviewed",
    sourceId: "0020",
  });
  await expect(
    t.mutation(api.recipientImports.commit, {
      ...args,
      rows: [
        {
          ...args.rows[0],
          recipient: { ...args.rows[0].recipient, name: "Changed" },
        },
      ],
    }),
  ).rejects.toThrow("already saved different rows");
  expect(
    await t.run((ctx) => ctx.db.query("recipientImportBatches").collect()),
  ).toHaveLength(1);
});

it("rejects a stale preview atomically, including other new rows in the same import", async () => {
  const { t, ids, request } = await setup();
  const args = await request([
    { name: "Maya Updated", sourceSystem: "gusto", sourceId: "0012" },
    { name: "New person", email: "new@example.com" },
  ]);
  await t.run((ctx) =>
    ctx.db.patch(ids.recipientId, { notes: "Changed by another finance user" }),
  );
  await expect(t.mutation(api.recipientImports.commit, args)).rejects.toThrow(
    "changed after the preview",
  );
  expect(
    await t.run((ctx) => ctx.db.query("beneficiaries").collect()),
  ).toHaveLength(1);
  expect(
    await t.run((ctx) => ctx.db.query("recipientImportBatches").collect()),
  ).toHaveLength(0);
});

it("refuses conflicting identifiers, duplicate rows, archived recipients and forged cross-org matches", async () => {
  const { t, ids, plan, request } = await setup();
  await t.run((ctx) =>
    createTestBeneficiary(ctx, ids.orgId, {
      walletAddress: "0x2222222222222222222222222222222222222222",
      name: "Someone else",
    }),
  );
  expect(
    (
      await plan([
        {
          name: "Maya",
          sourceSystem: "gusto",
          sourceId: "0012",
          walletAddress: "0x2222222222222222222222222222222222222222",
        },
      ])
    )[0].errors.join(" "),
  ).toContain("more than one recipient");
  expect(
    (
      await plan([
        { name: "Maya", sourceSystem: "gusto", sourceId: "0012" },
        { name: "Maya again", sourceSystem: "gusto", sourceId: "0012" },
      ])
    ).every((p) => p.errors.length > 0),
  ).toBe(true);
  const other = await t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.viewer,
    });
    return createTestBeneficiary(ctx, org.orgId);
  });
  const forged = await request([
    { name: "New person", email: "new@example.com" },
  ]);
  forged.rows[0].existingId = other;
  forged.rows[0].operation = "update";
  await expect(t.mutation(api.recipientImports.commit, forged)).rejects.toThrow(
    "changed after the preview",
  );
  await t.run((ctx) => ctx.db.patch(ids.recipientId, { isActive: false }));
  expect(
    (
      await plan([{ name: "Maya", sourceSystem: "gusto", sourceId: "0012" }])
    )[0].errors.join(" "),
  ).toContain("archived");
});

it("allows only recipient managers to import and does not erase blank profile or payout cells", async () => {
  const { t, ids, request, args, plan } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(ids.recipientId, { type: "business", notes: "Keep me" }),
  );
  const preview = (
    await plan([
      {
        name: "Maya Chen",
        sourceSystem: "gusto",
        sourceId: "0012",
        walletAddress: "",
        email: "",
        notes: "",
      },
    ])
  )[0];
  expect(preview.recommendation).toBe("skip");
  expect(preview.proposed).toMatchObject({
    type: "business",
    email: "maya@example.com",
    notes: "Keep me",
    preferredToken: "USDC",
  });
  const req = await request([
    { name: "Maya new name", sourceSystem: "gusto", sourceId: "0012" },
  ]);
  await t.run((ctx) => ctx.db.patch(ids.membershipId, { role: "viewer" }));
  await expect(t.mutation(api.recipientImports.commit, req)).rejects.toThrow();
  await t.run((ctx) => ctx.db.patch(ids.membershipId, { role: "clerk" }));
  expect(
    await t.mutation(api.recipientImports.commit, { ...req, ...args }),
  ).toMatchObject({ updated: 1 });
});
