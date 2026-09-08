import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  signIn,
  TEST_WALLETS,
} from "./factories";
import { refreshReportIndex } from "./reportHelpers";
import { circleConfiguration } from "../../shared/circleExecution";
import { loadAccountingFact } from "../lib/accountingSource";
import { queueReportSource } from "../lib/reportIndex";
import { depositReportRows, outgoingReportRows } from "../lib/reportRows";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const txHash = `0x${"cd".repeat(32)}`,
  chainId = 84532,
  config = circleConfiguration(chainId);
const proof = {
  prefund: { logIndex: 10, amountRaw: "77911" },
  refund: { logIndex: 20, amountRaw: "66063" },
};
async function setup(status: "executed" | "proposed", withProof = true) {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    await ctx.db.patch(org.safeId, { chainId });
    const beneficiary = await createTestBeneficiary(ctx, org.orgId);
    const payment = await createTestDisbursement(
      ctx,
      org.orgId,
      org.safeId,
      beneficiary,
      org.userId,
      { status, amount: "1" },
    );
    await ctx.db.patch(payment, { chainId, tokenAddress: config.token });
    const common = {
      orgId: org.orgId,
      safeId: org.safeId,
      chainId,
      safeAddress: org.safeAddress,
      tokenAddress: config.token,
      tokenSymbol: "USDC",
      decimals: 6,
      txHash,
      timestamp: Date.now(),
      blockNumber: 100,
      source: "safe_tx_service" as const,
      createdAt: Date.now(),
    };
    const out = await ctx.db.insert("outgoingTransfers", {
      ...common,
      amountRaw: "77911",
      amount: "0.077911",
      fromAddress: org.safeAddress,
      toAddress: config.paymaster,
      transferId: `e${txHash.slice(2)}10`,
    });
    const refund = await ctx.db.insert("deposits", {
      ...common,
      amountRaw: "66063",
      amount: "0.066063",
      fromAddress: config.paymaster,
      toAddress: org.safeAddress,
      transferId: `e${txHash.slice(2)}20`,
    });
    const execution = await ctx.db.insert("circleExecutions", {
      orgId: org.orgId,
      safeId: org.safeId,
      accountKey: `${chainId}:${org.safeAddress}`,
      disbursementId: payment,
      createdBy: org.userId,
      record: "{}",
      revision: 2,
      open: false,
      stage: status === "executed" ? "confirmed" : "failed",
      scanFrom: "100",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      txHash,
      fee: "11848",
      feeProof: withProof ? proof : undefined,
      settlement: {
        blockNumber: "100",
        blockHash: txHash,
        timestamp: Date.now(),
      },
    });
    return { ...org, payment, execution, out, refund };
  });
  const { sessionToken } = await signIn(t, "admin");
  const report = () =>
    t.query(api.reports.getTransactionReport, {
      orgId: ids.orgId,
      sessionToken,
      environment: "test",
    });
  return { t, ids, report, sessionToken };
}
it.each(["executed", "proposed"] as const)(
  "records a net fee once even when the payment is %s",
  async (status) => {
    const s = await setup(status);
    await refreshReportIndex(s.t, s.ids.orgId);
    const report = await s.report(),
      fees = report.items.filter((r) => r.kind === "fee");
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({
      amount: "0.011848",
      amountRaw: "11848",
      transferId: `c${txHash.slice(2)}:10:20`,
      includedInTotals: true,
    });
    expect(
      report.items.some((r) =>
        ["deposit", "account_transfer"].includes(r.kind),
      ),
    ).toBe(false);
    expect(report.totals[0]).toMatchObject({
      inflow: "0",
      outflow: status === "executed" ? "1.011848" : "0.011848",
    });
    const fact = await s.t.run((ctx) =>
      loadAccountingFact(ctx, s.ids.orgId, {
        kind: "activity",
        id: fees[0].rowId,
      }),
    );
    expect(fact).toMatchObject({
      amountRaw: "11848",
      direction: "outflow",
      transferId: `c${txHash.slice(2)}:10:20`,
      companyTransfer: false,
    });
  },
);
it("replaces previously indexed gross movements atomically when fee evidence arrives later", async () => {
  const s = await setup("proposed", false);
  await refreshReportIndex(s.t, s.ids.orgId);
  expect((await s.report()).items.map((r) => r.kind).sort()).toEqual([
    "account_transfer",
    "deposit",
  ]);
  const jobId = await s.t.run(async (ctx) => {
    await ctx.db.patch(s.ids.execution, { feeProof: proof });
    await queueReportSource(ctx, s.ids.orgId, "fee", s.ids.execution);
    return (await ctx.db
      .query("reportIndexJobs")
      .withIndex("by_source", (q) =>
        q.eq("sourceKey", `fee:${s.ids.execution}`),
      )
      .unique())!._id;
  });
  await s.t.mutation(internal.reportIndex.processJob, { jobId });
  expect((await s.report()).items.map((r) => r.kind)).toEqual(["fee"]);
  expect((await s.report()).totals[0]).toMatchObject({
    inflow: "0",
    outflow: "0.011848",
    net: "-0.011848",
  });
  await s.t.run(async (ctx) => {
    await queueReportSource(ctx, s.ids.orgId, "deposit", s.ids.refund);
    await queueReportSource(ctx, s.ids.orgId, "outgoing", s.ids.out);
  });
  await refreshReportIndex(s.t, s.ids.orgId);
  expect((await s.report()).items.map((r) => r.kind)).toEqual(["fee"]);
});
it.each(["quantity", "identity", "token", "destination", "block"] as const)(
  "does not hide another movement with a different %s",
  async (variant) => {
    const s = await setup("proposed");
    await s.t.run(async (ctx) => {
      const original = (await ctx.db.get(s.ids.out))!;
      if (variant === "quantity")
        await ctx.db.patch(original._id, { amountRaw: "77912" });
      if (variant === "identity")
        await ctx.db.patch(original._id, {
          transferId: `e${txHash.slice(2)}11`,
        });
      if (variant === "token")
        await ctx.db.patch(original._id, { tokenAddress: TEST_WALLETS.viewer });
      if (variant === "destination")
        await ctx.db.patch(original._id, { toAddress: TEST_WALLETS.viewer });
      if (variant === "block")
        await ctx.db.patch(original._id, { blockNumber: 101 });
      expect(await outgoingReportRows(ctx, original._id)).toHaveLength(1);
      expect(await depositReportRows(ctx, s.ids.refund)).toHaveLength(0);
    });
  },
);

it.each(["prefund", "refund"] as const)(
  "preserves a reconciled %s and prevents a second net-fee journal when proof arrives late",
  async (leg) => {
    const s = await setup("proposed", false),
      scope = { orgId: s.ids.orgId, sessionToken: s.sessionToken };
    await refreshReportIndex(s.t, s.ids.orgId);
    await s.t.mutation(api.accounting.configure, {
      ...scope,
      currency: "USD",
      bookName: "Company books",
      expectedVersion: 0,
    });
    const source = {
      kind: "activity" as const,
      id:
        leg === "prefund" ? `${s.ids.out}:transfer` : `${s.ids.refund}:deposit`,
    };
    const fact = await s.t.run((ctx) =>
      loadAccountingFact(ctx, s.ids.orgId, source),
    );
    const entryId = await s.t.mutation(api.accounting.review, {
      ...scope,
      source,
      expectedFingerprint: fact.fingerprint,
      expectedProfileVersion: 1,
      treatment: "already_recorded",
      assetBookValue: leg === "prefund" ? "0.08" : "0.07",
      postingDate: new Date(fact.settledAt).toISOString().slice(0, 10),
      bookReference: "QBO-FEE-1",
      valuationEvidence: "Gross fee transfers reconciled in company books",
      memo: "Provider prefund and refund",
    });
    const jobId = await s.t.run(async (ctx) => {
      await ctx.db.patch(s.ids.execution, { feeProof: proof });
      await queueReportSource(ctx, s.ids.orgId, "fee", s.ids.execution);
      return (await ctx.db
        .query("reportIndexJobs")
        .withIndex("by_source", (q) =>
          q.eq("sourceKey", `fee:${s.ids.execution}`),
        )
        .unique())!._id;
    });
    await s.t.mutation(internal.reportIndex.processJob, { jobId });
    const report = await s.report();
    expect(report.items.map((r) => r.kind).sort()).toEqual([
      "account_transfer",
      "deposit",
    ]);
    expect(report.totals[0]).toMatchObject({ net: "-0.011848" });
    const detail = await s.t.query(api.accounting.sourceDetails, {
      ...scope,
      source,
    });
    expect(detail.fact?.fingerprint).toBe(fact.fingerprint);
    expect(detail.entry?._id).toBe(entryId);
    await expect(
      s.t.run((ctx) =>
        loadAccountingFact(ctx, s.ids.orgId, {
          kind: "activity",
          id: `${s.ids.execution}:fee`,
        }),
      ),
    ).rejects.toThrow("Activity not found");
    expect(
      await s.t.run((ctx) => ctx.db.query("accountingEntries").collect()),
    ).toHaveLength(1);
  },
);
