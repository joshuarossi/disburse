import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestSafe,
  signIn,
  TEST_WALLETS,
} from "./factories";
import { nextPayDate, PREPARATION_LEAD_MS } from "../../shared/recurrence";

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const beneficiaryId = await createTestBeneficiary(ctx, org.orgId);
    return { ...org, beneficiaryId };
  });
  const { sessionToken } = await signIn(t, "admin");
  const args = {
    orgId: ids.orgId,
    sessionToken,
    name: "Monthly payroll",
    purpose: "payroll" as const,
    chainId: 11155111,
    token: "USDC",
    payDate: Date.now() + 5 * 86400000,
    recipients: [{ beneficiaryId: ids.beneficiaryId, amount: "100.000001" }],
  };
  return { t, ids, args };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("payment batches", () => {
  it("shows the next draft and limits a schedule's payment history to its own workspace", async () => {
    const {t, ids, args} = await setup();
    const scheduled = await t.mutation(api.paymentRuns.create, {...args,cadence:'monthly'});
    await t.mutation(api.paymentRuns.create, {...args,name:'One time'});
    const rows = await t.query(api.paymentRuns.listRecurring, {orgId:ids.orgId,sessionToken:args.sessionToken});
    expect(rows[0].nextDraftAt).toBe(rows[0].nextPayDate - PREPARATION_LEAD_MS);
    expect(rows[0].latestPayment?._id).toBe(scheduled.disbursementId);
    const history = await t.query(api.disbursements.list,{orgId:ids.orgId,sessionToken:args.sessionToken,recurringPaymentId:scheduled.recurringPaymentId});
    expect(history.items.map(p => p._id)).toEqual([scheduled.disbursementId]);
    const other = await t.run(ctx => createFullOrgSetup(ctx,{walletAddress:TEST_WALLETS.viewer}));
    const outsider = await signIn(t,'viewer');
    await expect(t.query(api.disbursements.list,{orgId:other.orgId,sessionToken:outsider.sessionToken,recurringPaymentId:scheduled.recurringPaymentId})).rejects.toThrow('Schedule not found');
  });
  it("rejects Maya USDC being replaced by a USDT batch and leaves no draft", async () => {
    const { t, ids, args } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.beneficiaryId, {
        name: "Maya Chen",
        preferredToken: "USDC",
        preferredChainId: 8453,
      });
      await ctx.db.patch(ids.safeId, { chainId: 8453 });
    });
    await expect(
      t.mutation(api.paymentRuns.create, {
        ...args,
        chainId: 8453,
        token: "USDT",
      }),
    ).rejects.toThrow("Maya Chen requests USDC");
    expect(
      await t.run((ctx) => ctx.db.query("disbursements").collect()),
    ).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(ids.beneficiaryId))).toMatchObject({
      preferredToken: "USDC",
      preferredChainId: 8453,
    });
  });
  it("rejects a network mismatch even when the currency matches", async () => {
    const { t, ids, args } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(ids.beneficiaryId, {
        preferredToken: "USDC",
        preferredChainId: 8453,
      }),
    );
    await expect(t.mutation(api.paymentRuns.create, args)).rejects.toThrow(
      "different network",
    );
  });
  it("refuses to change an existing draft to a currency contrary to recipient instructions", async () => {
    const { t, ids, args } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.beneficiaryId, {
        preferredToken: "USDC",
        preferredChainId: 8453,
      });
      await ctx.db.patch(ids.safeId, { chainId: 8453 });
    });
    const { disbursementId } = await t.mutation(api.paymentRuns.create, {
      ...args,
      chainId: 8453,
    });
    const { orgId: _org, ...fields } = args;
    void _org;
    await expect(
      t.mutation(api.paymentRuns.updateDraft, {
        ...fields,
        disbursementId,
        chainId: 8453,
        token: "USDT",
      }),
    ).rejects.toThrow("requests USDC");
    expect(await t.run((ctx) => ctx.db.get(disbursementId))).toMatchObject({
      token: "USDC",
    });
  });
  it("pauses recurrence when saved payout instructions change", async () => {
    const { t, ids, args } = await setup();
    const { recurringPaymentId } = await t.mutation(api.paymentRuns.create, {
      ...args,
      cadence: "weekly",
    });
    const series = (await t.run((ctx) => ctx.db.get(recurringPaymentId!)))!;
    await t.run((ctx) =>
      ctx.db.patch(ids.beneficiaryId, { preferredToken: "USDT" }),
    );
    vi.setSystemTime(series.nextPayDate - PREPARATION_LEAD_MS);
    await t.mutation(internal.paymentRuns.prepareNext, {
      recurringPaymentId: recurringPaymentId!,
      version: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(recurringPaymentId!))).toMatchObject(
      {
        status: "paused",
        pauseReason: expect.stringContaining("requests USDT"),
      },
    );
    expect(
      await t.run((ctx) => ctx.db.query("disbursements").collect()),
    ).toHaveLength(1);
  });
  it("creates a draft without executing or approving the payment", async () => {
    const { t, args } = await setup();
    const result = await t.mutation(api.paymentRuns.create, args);
    expect(result.recurringPaymentId).toBeUndefined();
    expect(
      await t.run((ctx) => ctx.db.get(result.disbursementId)),
    ).toMatchObject({
      status: "draft",
      totalAmount: "100.000001",
      name: args.name,
      purpose: "payroll",
      scheduledAt: args.payDate,
    });
  });
  it("rejects recipients without payment details", async () => {
    const { t, ids, args } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(ids.beneficiaryId, { walletAddress: "" }),
    );
    await expect(t.mutation(api.paymentRuns.create, args)).rejects.toThrow(
      "Payment details needed",
    );
  });
  it("rejects duplicate recipients", async () => {
    const { t, args } = await setup();
    await expect(
      t.mutation(api.paymentRuns.create, {
        ...args,
        recipients: [...args.recipients, ...args.recipients],
      }),
    ).rejects.toThrow("only once");
  });
  it("prepares exactly one future draft and ignores retries from an old job", async () => {
    const { t, args } = await setup();
    const { recurringPaymentId } = await t.mutation(api.paymentRuns.create, {
      ...args,
      cadence: "monthly",
    });
    const series = (await t.run((ctx) => ctx.db.get(recurringPaymentId!)))!;
    vi.useFakeTimers();
    vi.setSystemTime(series.nextPayDate - PREPARATION_LEAD_MS);
    await t.mutation(internal.paymentRuns.prepareNext, {
      recurringPaymentId: recurringPaymentId!,
      version: 1,
    });
    await t.mutation(internal.paymentRuns.prepareNext, {
      recurringPaymentId: recurringPaymentId!,
      version: 1,
    });
    const runs = await t.run((ctx) => ctx.db.query("disbursements").collect());
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "draft")).toBe(true);
  });
  it("pausing invalidates queued work without cancelling an existing batch", async () => {
    const { t, args } = await setup();
    const { recurringPaymentId, disbursementId } = await t.mutation(
      api.paymentRuns.create,
      { ...args, cadence: "weekly" },
    );
    await t.mutation(api.paymentRuns.setRecurringStatus, {
      recurringPaymentId: recurringPaymentId!,
      sessionToken: args.sessionToken,
      status: "paused",
    });
    await t.mutation(internal.paymentRuns.prepareNext, {
      recurringPaymentId: recurringPaymentId!,
      version: 1,
    });
    expect(
      await t.run((ctx) => ctx.db.query("disbursements").collect()),
    ).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(disbursementId)))?.status).toBe(
      "draft",
    );
  });
  it("pauses when a recipient becomes inactive before the next run", async () => {
    const { t, ids, args } = await setup();
    const { recurringPaymentId } = await t.mutation(api.paymentRuns.create, {
      ...args,
      cadence: "weekly",
    });
    const series = (await t.run((ctx) => ctx.db.get(recurringPaymentId!)))!;
    await t.run((ctx) => ctx.db.patch(ids.beneficiaryId, { isActive: false }));
    vi.useFakeTimers();
    vi.setSystemTime(series.nextPayDate - PREPARATION_LEAD_MS);
    await t.mutation(internal.paymentRuns.prepareNext, {
      recurringPaymentId: recurringPaymentId!,
      version: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(recurringPaymentId!))).toMatchObject(
      { status: "paused" },
    );
    expect(
      await t.run((ctx) => ctx.db.query("disbursements").collect()),
    ).toHaveLength(1);
  });
});

describe("recurrence calendar", () => {
  it("keeps a January 31 schedule anchored after February", () => {
    const february = nextPayDate(Date.UTC(2026, 0, 31, 12), "monthly", 31);
    expect(new Date(february).toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(new Date(nextPayDate(february, "monthly", 31)).toISOString()).toBe(
      "2026-03-31T12:00:00.000Z",
    );
  });
  it("handles leap years and year boundaries", () => {
    expect(
      new Date(
        nextPayDate(Date.UTC(2028, 0, 31, 12), "monthly", 31),
      ).toISOString(),
    ).toBe("2028-02-29T12:00:00.000Z");
    expect(
      new Date(
        nextPayDate(Date.UTC(2026, 11, 31, 12), "weekly", 31),
      ).toISOString(),
    ).toBe("2027-01-07T12:00:00.000Z");
  });
});

describe("editing payment instructions", () => {
  it("creates an immediate draft without a scheduled job or pay date", async () => {
    const { t, args } = await setup();
    const { disbursementId } = await t.mutation(api.paymentRuns.create, {
      ...args,
      payDate: undefined,
    });
    const payment = await t.run((ctx) => ctx.db.get(disbursementId));
    expect(payment?.status).toBe("draft");
    expect(payment?.scheduledAt).toBeUndefined();
    expect(payment?.safeTxHash).toBeUndefined();
  });
  it("requires a first payday for recurring instructions", async () => {
    const { t, args } = await setup();
    await expect(
      t.mutation(api.paymentRuns.create, {
        ...args,
        payDate: undefined,
        cadence: "monthly",
      }),
    ).rejects.toThrow("future first pay date");
    expect(
      await t.run((ctx) => ctx.db.query("recurringPayments").collect()),
    ).toHaveLength(0);
  });
  it("edits an unsigned draft while its approved payout instructions remain unchanged", async () => {
    const { t, ids, args } = await setup();
    const before = await t.run((ctx) => ctx.db.get(ids.beneficiaryId));
    const { disbursementId } = await t.mutation(api.paymentRuns.create, args);
    await t.run((ctx) =>
      ctx.db.patch(ids.beneficiaryId, {
        name: "Changed name",
      }),
    );
    await t.mutation(api.paymentRuns.updateDraft, {
      disbursementId,
      sessionToken: args.sessionToken,
      name: "Corrected payroll",
      purpose: args.purpose,
      chainId: args.chainId,
      token: args.token,
      recipients: [{ beneficiaryId: ids.beneficiaryId, amount: "250.000002" }],
    });
    const row = (
      await t.run((ctx) => ctx.db.query("disbursementRecipients").collect())
    )[0];
    expect(row).toMatchObject({
      recipientAddress: before?.walletAddress,
      recipientName: before?.name,
      amount: "250.000002",
    });
    expect(await t.run((ctx) => ctx.db.get(disbursementId))).toMatchObject({
      name: "Corrected payroll",
      totalAmount: "250.000002",
      status: "draft",
    });
    expect(
      (await t.run((ctx) => ctx.db.get(disbursementId)))?.scheduledAt,
    ).toBeUndefined();
  });
  it("rejects edits after a proposal has been attached", async () => {
    const { t, args } = await setup();
    const { disbursementId } = await t.mutation(api.paymentRuns.create, args);
    await t.run((ctx) =>
      ctx.db.patch(disbursementId, { safeTxHash: "0x" + "ab".repeat(32) }),
    );
    const fields = {
      sessionToken: args.sessionToken,
      name: args.name,
      purpose: args.purpose,
      chainId: args.chainId,
      token: args.token,
      payDate: args.payDate,
      recipients: args.recipients,
    };
    await expect(
      t.mutation(api.paymentRuns.updateDraft, { ...fields, disbursementId }),
    ).rejects.toThrow("unsigned");
  });
  it("editing a series invalidates its old job and does not rewrite its first draft", async () => {
    const { t, args } = await setup();
    const { disbursementId, recurringPaymentId } = await t.mutation(
      api.paymentRuns.create,
      { ...args, cadence: "monthly" },
    );
    const first = await t.run((ctx) => ctx.db.get(disbursementId));
    const nextDate = args.payDate + 35 * 86400000;
    await t.mutation(api.paymentRuns.updateRecurring, {
      recurringPaymentId: recurringPaymentId!,
      sessionToken: args.sessionToken,
      name: "Revised payroll",
      cadence: "biweekly",
      nextPayDate: nextDate,
      recipients: args.recipients,
    });
    await t.mutation(internal.paymentRuns.prepareNext, {
      recurringPaymentId: recurringPaymentId!,
      version: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(disbursementId))).toEqual(first);
    expect(
      await t.run((ctx) => ctx.db.query("disbursements").collect()),
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(recurringPaymentId!))).toMatchObject(
      {
        name: "Revised payroll",
        version: 2,
        cadence: "biweekly",
        nextPayDate: nextDate,
      },
    );
  });
  it("cannot shift an existing recurring occurrence into a different period", async () => {
    const { t, args } = await setup();
    const { disbursementId } = await t.mutation(api.paymentRuns.create, {
      ...args,
      cadence: "monthly",
    });
    const fields = {
      sessionToken: args.sessionToken,
      name: args.name,
      purpose: args.purpose,
      chainId: args.chainId,
      token: args.token,
      payDate: args.payDate,
      recipients: args.recipients,
    };
    await expect(
      t.mutation(api.paymentRuns.updateDraft, {
        ...fields,
        disbursementId,
        payDate: args.payDate + 86400000,
      }),
    ).rejects.toThrow("original pay date");
  });
});

describe("mixed payout preparation", () => {
  async function mixedSetup() {
    const context = await setup();
    const secondId = await context.t.run(async (ctx) => {
      await ctx.db.patch(context.ids.beneficiaryId, {
        name: "Maya",
        preferredToken: "USDC",
        preferredChainId: 11155111,
      });
      const id = await createTestBeneficiary(ctx, context.ids.orgId, { name: "Arjun" });
      await ctx.db.patch(id, { preferredToken: "USDT", preferredChainId: 11155111 });
      return id;
    });
    const {
      chainId,
      token: _token,
      recipients: _recipients,
      ...base
    } = context.args;
    void _token;
    void _recipients;
    return {
      ...context,
      secondId,
      grouped: {
        ...base,
        recipients: [
          {
            beneficiaryId: context.ids.beneficiaryId,
            amount: "1.000001",
            chainId,
            token: "USDC",
          },
          {
            beneficiaryId: secondId,
            amount: "2.000002",
            chainId,
            token: "USDT",
          },
        ],
      },
    };
  }
  it("creates exact separate currency batches and preserves every saved instruction", async () => {
    const { t, grouped } = await mixedSetup();
    const result = await t.mutation(api.paymentRuns.createGrouped, grouped);
    expect(result.batches).toHaveLength(2);
    const records = await t.run((ctx) =>
      ctx.db.query("disbursements").collect(),
    );
    expect(records.map((r) => [r.token, r.totalAmount, r.status])).toEqual([
      ["USDC", "1.000001", "draft"],
      ["USDT", "2.000002", "draft"],
    ]);
    const recipients = await t.run((ctx) =>
      ctx.db.query("disbursementRecipients").collect(),
    );
    expect(recipients.map((r) => r.recipientName)).toEqual(["Maya", "Arjun"]);
  });
  it("keeps the same currency on different networks in separate funding accounts", async () => {
    const { t, ids, grouped, secondId } = await mixedSetup();
    const otherSafe = await t.run(async (ctx) => {
      await ctx.db.patch(secondId, { preferredToken: "USDC", preferredChainId: 8453 });
      return createTestSafe(ctx, ids.orgId, { chainId: 8453 });
    });
    grouped.recipients[1] = { ...grouped.recipients[1], token: "USDC", chainId: 8453 };
    const result = await t.mutation(api.paymentRuns.createGrouped, grouped);
    expect(result.batches).toHaveLength(2);
    const records = await t.run((ctx) => ctx.db.query("disbursements").collect());
    expect(records.map((r) => [r.chainId, r.safeId, r.totalAmount])).toEqual([
      [11155111, ids.safeId, "1.000001"], [8453, otherSafe, "2.000002"],
    ]);
  });
  it("does not bypass a per-payment limit by splitting one currency across networks", async () => {
    const { t, ids, grouped, secondId } = await mixedSetup();
    await t.run(async (ctx) => {
      await ctx.db.patch(secondId, { preferredToken: "USDC", preferredChainId: 8453 });
      await createTestSafe(ctx, ids.orgId, { chainId: 8453 });
      await ctx.db.patch(ids.membershipId, { paymentPolicy: { token: "USDC", perPayment: "3", perMonth: "100" } });
    });
    grouped.recipients[1] = { ...grouped.recipients[1], token: "USDC", chainId: 8453 };
    await expect(t.mutation(api.paymentRuns.createGrouped, grouped)).rejects.toThrow("per-payment limit");
    expect(await t.run((ctx) => ctx.db.query("disbursements").collect())).toHaveLength(0);
  });
  it("rolls back all batches when instructions change after review", async () => {
    const { t, grouped, secondId } = await mixedSetup();
    await t.run((ctx) => ctx.db.patch(secondId, { preferredToken: "USDC" }));
    await expect(
      t.mutation(api.paymentRuns.createGrouped, grouped),
    ).rejects.toThrow("Arjun requests USDC");
    expect(
      await t.run((ctx) => ctx.db.query("disbursements").collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("disbursementRecipients").collect()),
    ).toHaveLength(0);
  });
  it("rejects duplicates across currency groups", async () => {
    const { t, grouped } = await mixedSetup();
    grouped.recipients[1].beneficiaryId = grouped.recipients[0].beneficiaryId;
    await expect(
      t.mutation(api.paymentRuns.createGrouped, grouped),
    ).rejects.toThrow("only once");
  });
  it("prepares recurring series independently without changing the first payouts", async () => {
    const { t, grouped } = await mixedSetup();
    const result = await t.mutation(api.paymentRuns.createGrouped, {
      ...grouped,
      cadence: "monthly",
    });
    expect(result.batches.every((b) => b.recurringPaymentId)).toBe(true);
    const series = await t.run((ctx) =>
      ctx.db.query("recurringPayments").collect(),
    );
    expect(series.map((s) => [s.token, s.recipients.length, s.status])).toEqual(
      [
        ["USDC", 1, "active"],
        ["USDT", 1, "active"],
      ],
    );
  });
});

it('prepares successive recurring runs once and never carries an old execution fee or signature forward', async () => {
  const { t, args } = await setup();
  const { recurringPaymentId, disbursementId } = await t.mutation(api.paymentRuns.create, { ...args, cadence: 'monthly' });
  await t.run(ctx => ctx.db.patch(disbursementId, { status: 'executed', safeTxHash: '0x' + 'ab'.repeat(32), executionFee: { token: 'USDC', amount: '0.05', collector: TEST_WALLETS.viewer, tokenAddress: TEST_WALLETS.approver } }));
  for (let i = 0; i < 2; i++) {
    const series = (await t.run(ctx => ctx.db.get(recurringPaymentId!)))!;
    vi.setSystemTime(series.nextPayDate - PREPARATION_LEAD_MS);
    const call = { recurringPaymentId: recurringPaymentId!, version: series.version };
    await t.mutation(internal.paymentRuns.prepareNext, call);
    await t.mutation(internal.paymentRuns.prepareNext, call);
  }
  const payments = await t.run(ctx => ctx.db.query('disbursements').collect());
  expect(payments).toHaveLength(3);
  expect(new Set(payments.map(p => p.scheduledAt)).size).toBe(3);
  for (const payment of payments.filter(p => p._id !== disbursementId)) {
    expect(payment.status).toBe('draft');
    expect(payment.totalAmount).toBe('100.000001');
    expect(payment.executionFee).toBeUndefined();
    expect(payment.safeTxHash).toBeUndefined();
  }
});
