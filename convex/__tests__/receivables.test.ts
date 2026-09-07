import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { createFullOrgSetup, signIn, TEST_WALLETS } from "./factories";
import { receivableStatus } from "../../shared/receivables";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
  );
  const { sessionToken } = await signIn(t, "admin");
  const fields = {
    orgId: ids.orgId,
    sessionToken,
    safeId: ids.safeId,
    number: "AR-1001",
    customerName: "Customer",
    customerEmail: "private@example.invalid",
    description: "Consulting",
    token: "USDC",
    dueDate: Date.now() + 86400000,
    items: [{ description: "Work", quantity: 3, unitPrice: "0.010001" }],
  };
  const invoiceId = await t.mutation(api.receivables.create, fields);
  return { t, ids, fields, invoiceId, args: { invoiceId, sessionToken } };
}
async function publish(s: Awaited<ReturnType<typeof setup>>) {
  const i = await s.t.query(api.receivables.get, s.args);
  await s.t.mutation(internal.receivables.publish, {
    ...s.args,
    expectedUpdatedAt: i.updatedAt,
    expectedRevision: i.revision ?? 0,
    factory: TEST_WALLETS.viewer,
    salt: `0x${"1".repeat(64)}`,
    receivingAddress: TEST_WALLETS.initiator,
    publicToken: "a".repeat(64),
    startBlock: "100",
  });
}
const event = (
  kind: "received" | "forwarded",
  amount: string,
  index: number,
) => ({
  key: `11155111:0x${"1".repeat(64)}:${index}`,
  kind,
  amount,
  txHash: `0x${"1".repeat(64)}`,
  logIndex: index,
  blockNumber: "100",
  blockHash: `0x${"2".repeat(64)}`,
});
describe("accounts receivable", () => {
  it("rejects publishing an older revision even when edits share a millisecond timestamp", async () => {
    const s = await setup();
    const before = await s.t.query(api.receivables.get, s.args);
    await s.t.mutation(api.receivables.create, {
      ...s.fields,
      invoiceId: s.invoiceId,
      customerName: "Changed customer",
    });
    const after = await s.t.query(api.receivables.get, s.args);
    expect(after.updatedAt).toBe(before.updatedAt);
    await expect(
      s.t.mutation(internal.receivables.publish, {
        ...s.args,
        expectedUpdatedAt: before.updatedAt,
        expectedRevision: before.revision ?? 0,
        factory: TEST_WALLETS.viewer,
        salt: `0x${"1".repeat(64)}`,
        receivingAddress: TEST_WALLETS.initiator,
        publicToken: "a".repeat(64),
        startBlock: "100",
      }),
    ).rejects.toThrow(/changed/);
    expect(after.state).toBe("draft");
  });
  it("calculates exact invoice totals, allows draft edits, and locks issued instructions", async () => {
    const s = await setup();
    expect((await s.t.query(api.receivables.get, s.args)).amount).toBe(
      "0.030003",
    );
    await s.t.mutation(api.receivables.create, {
      ...s.fields,
      invoiceId: s.invoiceId,
      customerName: "Updated customer",
    });
    await publish(s);
    await expect(
      s.t.mutation(api.receivables.create, {
        ...s.fields,
        invoiceId: s.invoiceId,
        token: "USDT",
      }),
    ).rejects.toThrow(/Only drafts/);
    await expect(
      s.t.mutation(api.receivables.create, s.fields),
    ).rejects.toThrow(/already has/);
  });
  it("tracks partial, exact and excess receipts independently of forwarding and rejects repeated scans", async () => {
    const s = await setup();
    await publish(s);
    await s.t.mutation(internal.receivables.recordScan, {
      invoiceId: s.invoiceId,
      fromBlock: "100",
      nextBlock: "101",
      events: [event("received", "10001", 0)],
    });
    let i = await s.t.query(api.receivables.get, s.args);
    expect(receivableStatus(i)).toBe("Partially paid");
    expect(
      await s.t.mutation(internal.receivables.recordScan, {
        invoiceId: s.invoiceId,
        fromBlock: "100",
        nextBlock: "101",
        events: [event("received", "10001", 0)],
      }),
    ).toBe(false);
    await s.t.mutation(internal.receivables.recordScan, {
      invoiceId: s.invoiceId,
      fromBlock: "101",
      nextBlock: "102",
      events: [event("received", "20002", 1)],
    });
    i = await s.t.query(api.receivables.get, s.args);
    expect(receivableStatus(i)).toBe("Paid");
    expect(i.forwarded).toBe("0");
    await s.t.mutation(internal.receivables.recordScan, {
      invoiceId: s.invoiceId,
      fromBlock: "102",
      nextBlock: "103",
      events: [event("forwarded", "30003", 2), event("received", "1", 3)],
    });
    const row = (
      await s.t.query(api.receivables.list, {
        orgId: s.ids.orgId,
        sessionToken: s.args.sessionToken,
      })
    ).items[0];
    expect(row.status).toBe("Overpaid");
    expect(row.amounts.awaitingForwarding).toBe("0.000001");
    expect(row.amounts.overpayment).toBe("0.000001");
  });
  it("keeps customer email and internal identifiers private on the shared invoice", async () => {
    const s = await setup();
    expect(
      await s.t.query(api.receivables.publicInvoice, { token: "a".repeat(64) }),
    ).toBeNull();
    await publish(s);
    const publicInvoice = await s.t.query(api.receivables.publicInvoice, {
      token: "a".repeat(64),
    });
    expect(publicInvoice?.amount).toBe("0.030003");
    expect(publicInvoice).not.toHaveProperty("customerEmail");
    expect(publicInvoice).not.toHaveProperty("orgId");
    expect(
      await s.t.query(api.receivables.publicInvoice, { token: "b".repeat(64) }),
    ).toBeNull();
  });
  it("continues tracking payments arriving after an invoice is voided", async () => {
    const s = await setup();
    await publish(s);
    await s.t.mutation(api.receivables.voidInvoice, s.args);
    await s.t.mutation(internal.receivables.recordScan, {
      invoiceId: s.invoiceId,
      fromBlock: "100",
      nextBlock: "101",
      events: [event("received", "10001", 0)],
    });
    expect(receivableStatus(await s.t.query(api.receivables.get, s.args))).toBe(
      "Voided · payment received",
    );
  });
  it("rejects outsiders and read-only invoice writes", async () => {
    const s = await setup();
    const outsider = await signIn(s.t, "nonMember");
    await expect(
      s.t.query(api.receivables.get, {
        invoiceId: s.invoiceId,
        sessionToken: outsider.sessionToken,
      }),
    ).rejects.toThrow(/member/);
    const viewer = await signIn(s.t, "viewer");
    await expect(
      s.t.mutation(api.receivables.create, {
        ...s.fields,
        sessionToken: viewer.sessionToken,
      }),
    ).rejects.toThrow();
  });
  it("keeps invoice preparation and receipt tracking available after trial expiry", async () => {
    const s = await setup();
    await publish(s);
    await s.t.run(async (ctx) => {
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_org", (q) => q.eq("orgId", s.ids.orgId))
        .first();
      if (billing)
        await ctx.db.patch(billing._id, { trialEndsAt: Date.now() - 1 });
    });
    const draftId = await s.t.mutation(api.receivables.create, {
      ...s.fields,
      number: "AR-1002",
    });
    await expect(
      s.t.query(api.receivables.forOperation, {
        invoiceId: draftId,
        sessionToken: s.args.sessionToken,
      }),
    ).resolves.toMatchObject({ _id: draftId });
    await s.t.mutation(internal.receivables.recordScan, {
      invoiceId: s.invoiceId,
      fromBlock: "100",
      nextBlock: "101",
      events: [event("received", "30003", 0)],
    });
    expect(receivableStatus(await s.t.query(api.receivables.get, s.args))).toBe(
      "Paid",
    );
  });
  it("queues issued invoices without making their last receipt check look fresher", async () => {
    const s = await setup();
    await publish(s);
    for (let n = 0; n < 12; n++) {
      const invoiceId = await s.t.mutation(api.receivables.create, {
        ...s.fields,
        number: `VOID-${n}`,
      });
      await s.t.mutation(api.receivables.voidInvoice, {
        invoiceId,
        sessionToken: s.args.sessionToken,
      });
    }
    await s.t.mutation(api.receivables.voidInvoice, s.args);
    await s.t.mutation(internal.receivables.monitor, {});
    const i = await s.t.query(api.receivables.get, s.args);
    expect(i.nextScanAt).toBeGreaterThan(Date.now());
    expect(i.lastCheckedAt).toBe(0);
    const jobs = await s.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(jobs.some((job) => job.args[0]?.invoiceId === s.invoiceId)).toBe(
      true,
    );
  });
});
