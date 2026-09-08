import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  signIn,
  TEST_WALLETS,
} from "./factories";

it("marks a bounded overview as partial and withholds available-to-spend estimates", async () => {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    for (let i = 0; i < 1001; i++) await createTestBeneficiary(ctx, ids.orgId);
    return ids;
  });
  const { sessionToken } = await signIn(t, "admin");
  expect(
    await t.query(api.workspace.overview, { orgId: ids.orgId, sessionToken }),
  ).toMatchObject({
    limitedHistory: true,
    plansIncomplete: true,
    recipientCount: 1000,
  });
});

it("keeps overview and upcoming filters aligned while retaining overdue instructions for review", async () => {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const beneficiary = await createTestBeneficiary(ctx, ids.orgId);
    const payments = [];
    for (const [status, offset] of [
      ["draft", -86400000],
      ["draft", 86400000],
      ["scheduled", -86400000],
      ["scheduled", 86400000],
      ["executed", 86400000],
    ] as const) {
      const id = await createTestDisbursement(
        ctx,
        ids.orgId,
        ids.safeId,
        beneficiary,
        ids.userId,
        { status },
      );
      await ctx.db.patch(id, { scheduledAt: Date.now() + offset });
      payments.push(id);
    }
    return { ...ids, payments };
  });
  const { sessionToken } = await signIn(t, "admin");
  const args = { orgId: ids.orgId, sessionToken, environment: "test" as const };
  const overview = await t.query(api.workspace.overview, args);
  const upcoming = await t.query(api.disbursements.list, {
    ...args,
    upcomingOnly: true,
  });
  expect(overview.scheduledCount).toBe(2);
  expect(new Set(overview.upcoming.map((p) => p._id))).toEqual(
    new Set(upcoming.items.map((p) => p._id)),
  );
  expect(overview.exceptions.map((p) => p._id)).toContain(ids.payments[2]);
  expect(
    overview.exceptions.find((p) => p._id === ids.payments[0])?.exceptionReason,
  ).toBe("Approval deadline missed");
  expect(overview.draftCount).toBe(1);
  expect(overview.needsReview).toBe(0);
  expect(overview.plannedDebits).toEqual([
    { safeId: ids.safeId, token: "USDC", amount: "400" },
  ]);
  expect(overview.plansIncomplete).toBe(false);
  expect(overview.upcoming.map((p) => p._id)).not.toContain(ids.payments[0]);
  const attention = await t.query(api.disbursements.list, {
    ...args,
    status: ["failed"],
    includeOverdueScheduled: true,
  });
  expect(new Set(attention.items.map((p) => p._id))).toEqual(
    new Set([ids.payments[0], ids.payments[2]]),
  );
});

it("shows declined wallet sends and blocked recipient submissions in the same review queue on Overview and Payments", async () => {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const recipient = await createTestBeneficiary(ctx, ids.orgId);
    const declined = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      recipient,
      ids.userId,
      { status: "relaying" },
    );
    await ctx.db.patch(declined, {
      nativeExecution: {
        startedAt: Date.now() - 1000,
        checks: 0,
        walletRejectedAt: Date.now(),
      },
    });
    const blocked = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      recipient,
      ids.userId,
      { status: "relaying" },
    );
    await ctx.db.patch(blocked, { relayStatus: "Payment review required" });
    return { ...ids, declined, blocked };
  });
  const { sessionToken } = await signIn(t, "admin");
  const args = { orgId: ids.orgId, sessionToken, environment: "test" as const };
  const overview = await t.query(api.workspace.overview, args);
  const payments = await t.query(api.disbursements.list, {
    ...args,
    status: ["failed"],
    includeRelayExceptions: true,
  });
  expect(new Set(overview.exceptions.map((p) => p._id))).toEqual(
    new Set([ids.declined, ids.blocked]),
  );
  expect(new Set(payments.items.map((p) => p._id))).toEqual(
    new Set([ids.declined, ids.blocked]),
  );
  expect(
    overview.exceptions.find((p) => p._id === ids.declined)?.exceptionReason,
  ).toBe("Wallet approval declined");
});

it("retains old unpaid work across 6,000 completed or cancelled records and 1,100 archived recipients", async () => {
  const t = convexTest(schema);
  const started = performance.now();
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const recipient = await createTestBeneficiary(ctx, ids.orgId);
    const open = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      recipient,
      ids.userId,
      { status: "proposed", amount: "12.000001" },
    );
    const scheduled = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      recipient,
      ids.userId,
      { status: "scheduled", amount: "3" },
    );
    await ctx.db.patch(scheduled, { scheduledAt: Date.now() + 86400000 });
    for (let i = 0; i < 6000; i++)
      await createTestDisbursement(
        ctx,
        ids.orgId,
        ids.safeId,
        recipient,
        ids.userId,
        { status: i % 2 ? "executed" : "cancelled", amount: "1" },
      );
    for (let i = 0; i < 1100; i++) {
      const id = await createTestBeneficiary(ctx, ids.orgId);
      await ctx.db.patch(id, { isActive: false });
    }
    return { ...ids, open, scheduled };
  });
  const { sessionToken } = await signIn(t, "admin");
  const begin = performance.now();
  const overview = await t.query(api.workspace.overview, {
    orgId: ids.orgId,
    sessionToken,
    environment: "test",
  });
  expect(overview.limitedHistory).toBe(false);
  expect(overview.plansIncomplete).toBe(false);
  expect(overview.review.map((p) => p._id)).toContain(ids.open);
  expect(overview.upcoming.map((p) => p._id)).toContain(ids.scheduled);
  expect(overview.plannedDebits).toEqual([
    { safeId: ids.safeId, token: "USDC", amount: "15.000001" },
  ]);
  expect(overview.recipientCount).toBe(1);
  expect(overview.recent).toHaveLength(6);
  expect(
    overview.recent.every((p) => ["executed", "cancelled"].includes(p.status)),
  ).toBe(true);
  console.info(
    JSON.stringify({
      scenario: "6000 closed payments / 1100 archived recipients",
      overviewMs: Math.round(performance.now() - begin),
      fixtureAndCheckMs: Math.round(performance.now() - started),
    }),
  );
}, 20000);
it("reports an overfull active bucket without hiding other statuses or mixing test and business balances", async () => {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const recipient = await createTestBeneficiary(ctx, ids.orgId);
    for (let i = 0; i < 201; i++)
      await createTestDisbursement(
        ctx,
        ids.orgId,
        ids.safeId,
        recipient,
        ids.userId,
        { status: "draft", amount: "1" },
      );
    const review = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      recipient,
      ids.userId,
      { status: "proposed", amount: "2" },
    );
    const live = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      recipient,
      ids.userId,
      { status: "proposed", amount: "999" },
    );
    await ctx.db.patch(live, { chainId: 8453 });
    return { ...ids, review };
  });
  const { sessionToken } = await signIn(t, "admin");
  const overview = await t.query(api.workspace.overview, {
    orgId: ids.orgId,
    sessionToken,
    environment: "test",
  });
  expect(overview.limitedHistory).toBe(true);
  expect(overview.plansIncomplete).toBe(true);
  expect(overview.draftCount).toBe(200);
  expect(overview.review.map((p) => p._id)).toEqual([ids.review]);
  expect(overview.plannedDebits[0].amount).toBe("202");
});
