import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
} from "./factories";

it("detects stopped recovery and report failures without executing work or exposing payloads", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx);
    const recipient = await createTestBeneficiary(ctx, ids.orgId);
    const payment = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      recipient,
      ids.userId,
      { status: "relaying" },
    );
    await ctx.db.patch(payment, {
      nativeRecoveryAt: now - 20 * 60000,
      memo: "Private payroll details",
    });
    await ctx.db.insert("reportIndexJobs", {
      orgId: ids.orgId,
      sourceKey: `payment:${payment}`,
      sourceId: payment,
      kind: "payment",
      nextAt: now + 3600000,
      attempts: 4,
      hasError: true,
      error: "Private provider details",
    });
    return { ...ids, payment };
  });
  const result = await t.query(internal.operationsHealth.summary, {});
  expect(result.status).toBe("attention");
  expect(result.queues.nativeRecovery.count).toBe(1);
  expect(result.queues.reportErrors.count).toBe(1);
  expect(result.queues.reportBacklog.count).toBe(0);
  expect(JSON.stringify(result)).not.toContain("Private");
  expect((await t.run((ctx) => ctx.db.get(ids.payment)))?.status).toBe(
    "relaying",
  );
  expect(
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(0);
});
it("bounds the operator response and recognizes recovery after queues are cleared", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const payments = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx);
    const recipient = await createTestBeneficiary(ctx, ids.orgId);
    const payments = [];
    for (let i = 0; i < 101; i++) {
      const id = await createTestDisbursement(
        ctx,
        ids.orgId,
        ids.safeId,
        recipient,
        ids.userId,
        { status: "relaying" },
      );
      await ctx.db.patch(id, { nativeRecoveryAt: now - 3600000 });
      payments.push(id);
    }
    return payments;
  });
  const result = await t.query(internal.operationsHealth.summary, {});
  expect(result.queues.nativeRecovery).toMatchObject({
    count: 100,
    truncated: true,
  });
  expect(result.queues.nativeRecovery.sampleIds).toHaveLength(5);
  await t.run(async (ctx) => {
    for (const id of payments)
      await ctx.db.patch(id, { nativeRecoveryAt: undefined });
  });
  expect((await t.query(internal.operationsHealth.summary, {})).status).toBe(
    "queues_clear",
  );
});
