import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestMembership,
  signIn,
  TEST_WALLETS,
} from "./factories";
import { loadAccountingFact } from "../lib/accountingSource";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function setup(publish = true) {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin, plan: "pro" }),
  );
  const admin = await signIn(t, "admin"),
    viewer = await signIn(t, "viewer"),
    outsider = await signIn(t, "nonMember");
  await t.run((ctx) =>
    createTestMembership(ctx, ids.orgId, viewer.userId, { role: "viewer" }),
  );
  const beneficiaryId = await t.run((ctx) =>
    createTestBeneficiary(ctx, ids.orgId, {
      name: "Reviewed customer",
      walletAddress: TEST_WALLETS.approver,
    }),
  );
  const invoiceId = await t.mutation(api.receivables.create, {
    orgId: ids.orgId,
    sessionToken: admin.sessionToken,
    safeId: ids.safeId,
    number: "AR-10",
    customerName: "Customer",
    customerEmail: "private@example.invalid",
    description: "Services",
    token: "USDC",
    dueDate: Date.now() + 86400000,
    items: [{ description: "Work", quantity: 1, unitPrice: "100" }],
  });
  const identity = { invoiceId, sessionToken: admin.sessionToken };
  const issue = async () => {
    const row = await t.query(api.receivables.get, identity);
    await t.mutation(internal.receivables.publish, {
      ...identity,
      expectedUpdatedAt: row.updatedAt,
      expectedRevision: row.revision ?? 0,
      factory: TEST_WALLETS.viewer,
      salt: `0x${"1".repeat(64)}`,
      receivingAddress: TEST_WALLETS.initiator,
      publicToken: "a".repeat(64),
      startBlock: "100",
    });
  };
  if (publish) await issue();
  const credit = (overrides = {}) => ({
    ...identity,
    requestId: crypto.randomUUID(),
    number: "CN-10",
    amount: "20",
    reason: "Agreed service adjustment",
    reviewed: true,
    ...overrides,
  });
  const refund = (overrides = {}) => ({
    ...identity,
    requestId: crypto.randomUUID(),
    safeId: ids.safeId,
    beneficiaryId,
    amount: "20",
    reviewed: true,
    ...overrides,
  });
  return {
    t,
    ids,
    admin,
    viewer,
    outsider,
    beneficiaryId,
    invoiceId,
    identity,
    issue,
    credit,
    refund,
  };
}

it("issues immutable credits exactly once, caps concurrent credits and preserves original instructions", async () => {
  const s = await setup(),
    before = await s.t.query(api.receivables.get, s.identity),
    input = s.credit();
  const id = await s.t.mutation(api.receivableWorkflows.issueCredit, input);
  expect(await s.t.mutation(api.receivableWorkflows.issueCredit, input)).toBe(
    id,
  );
  await expect(
    s.t.mutation(api.receivableWorkflows.issueCredit, {
      ...input,
      amount: "21",
    }),
  ).rejects.toThrow(/changed/);
  const results = await Promise.allSettled([
    s.t.mutation(
      api.receivableWorkflows.issueCredit,
      s.credit({ number: "CN-11", amount: "60" }),
    ),
    s.t.mutation(
      api.receivableWorkflows.issueCredit,
      s.credit({ number: "CN-12", amount: "60" }),
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const row = await s.t.query(api.receivables.get, s.identity);
  expect(row.credited).toBe("80000000");
  expect(row.amount).toBe(before.amount);
  expect(row.receivingAddress).toBe(before.receivingAddress);
  expect(row.items).toEqual(before.items);
  const shared = await s.t.query(api.receivables.publicInvoice, {
    token: "a".repeat(64),
  });
  expect(shared?.amounts.remaining).toBe("20");
  expect(shared?.credits).toHaveLength(2);
  expect(shared).not.toHaveProperty("customerEmail");
  expect(shared?.credits[0]).not.toHaveProperty("createdBy");
  await expect(
    s.t.mutation(api.receivables.voidInvoice, s.identity),
  ).rejects.toThrow(/credit notes/);
});

it("refuses unauthorized, unreviewed, duplicate-number, zero and unissued credits", async () => {
  const s = await setup(false);
  await expect(
    s.t.mutation(api.receivableWorkflows.issueCredit, s.credit()),
  ).rejects.toThrow(/issued invoice/);
  await s.issue();
  for (const sessionToken of [s.viewer.sessionToken, s.outsider.sessionToken])
    await expect(
      s.t.mutation(
        api.receivableWorkflows.issueCredit,
        s.credit({ sessionToken }),
      ),
    ).rejects.toThrow();
  for (const change of [
    { reviewed: false },
    { amount: "0" },
    { amount: "100.000001" },
    { reason: "x" },
  ])
    await expect(
      s.t.mutation(api.receivableWorkflows.issueCredit, s.credit(change)),
    ).rejects.toThrow();
  await s.t.mutation(api.receivableWorkflows.issueCredit, s.credit());
  await expect(
    s.t.mutation(
      api.receivableWorkflows.issueCredit,
      s.credit({ amount: "1" }),
    ),
  ).rejects.toThrow(/already has/);
});

it("reserves one refund to reviewed instructions, recovers lost replies and releases a cancelled draft", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.invoiceId, {
      received: "100000000",
      forwarded: "100000000",
    }),
  );
  await s.t.mutation(api.receivableWorkflows.issueCredit, s.credit());
  const input = s.refund(),
    id = await s.t.mutation(api.receivableWorkflows.prepareRefund, input);
  expect(await s.t.mutation(api.receivableWorkflows.prepareRefund, input)).toBe(
    id,
  );
  await expect(
    s.t.mutation(api.receivableWorkflows.prepareRefund, s.refund()),
  ).rejects.toThrow(/exceeds/);
  const payment = await s.t.query(api.disbursements.getWithRecipients, {
    disbursementId: id,
    sessionToken: s.admin.sessionToken,
  });
  expect(payment?.type).toBe("batch");
  expect(payment?.refundInvoiceId).toBe(s.invoiceId);
  expect(payment?.recipients).toHaveLength(1);
  expect(payment?.recipients[0].recipientAddress.toLowerCase()).toBe(
    TEST_WALLETS.approver.toLowerCase(),
  );
  await expect(
    s.t.mutation(api.paymentRuns.updateDraft, {
      disbursementId: id,
      sessionToken: s.admin.sessionToken,
      name: "Changed",
      purpose: "other",
      chainId: payment!.chainId!,
      safeId: s.ids.safeId,
      token: "USDC",
      recipients: [{ beneficiaryId: s.beneficiaryId, amount: "99" }],
    }),
  ).rejects.toThrow(/reserved customer refund/);
  expect(
    (await s.t.query(api.receivableWorkflows.details, s.identity)).reserved,
  ).toBe("20");
  await s.t.mutation(api.disbursements.updateStatus, {
    disbursementId: id,
    sessionToken: s.admin.sessionToken,
    status: "cancelled",
  });
  const replacement = await s.t.mutation(
    api.receivableWorkflows.prepareRefund,
    s.refund(),
  );
  expect(replacement).not.toBe(id);
  // Canonical settlement normally produces this status; no client mutation can
  // set it merely to release a refund reservation.
  await s.t.run((ctx) => ctx.db.patch(replacement, { status: "executed" }));
  const invoice = await s.t.query(api.receivables.get, s.identity);
  expect(invoice.refunded).toBe("20000000");
  expect(
    (await s.t.query(api.receivables.publicInvoice, { token: "a".repeat(64) }))
      ?.amounts.overpayment,
  ).toBe("0");
});

it("rejects refund destinations with changed currency, unreviewed or archived details and holds failed requests", async () => {
  const s = await setup();
  await s.t.run((ctx) => ctx.db.patch(s.invoiceId, { received: "120000000" }));
  const original = await s.t.run((ctx) => ctx.db.get(s.beneficiaryId));
  for (const change of [
    { preferredToken: "USDT" },
    { isActive: false },
    { payoutReviewStatus: "unreviewed" as const },
  ]) {
    await s.t.run((ctx) => ctx.db.patch(s.beneficiaryId, change));
    await expect(
      s.t.mutation(api.receivableWorkflows.prepareRefund, s.refund()),
    ).rejects.toThrow();
    await s.t.run((ctx) =>
      ctx.db.patch(s.beneficiaryId, {
        preferredToken: original?.preferredToken,
        isActive: true,
        payoutReviewStatus: "approved",
      }),
    );
  }
  await expect(
    s.t.mutation(
      api.receivableWorkflows.prepareRefund,
      s.refund({ sessionToken: s.viewer.sessionToken }),
    ),
  ).rejects.toThrow();
  const id = await s.t.mutation(
    api.receivableWorkflows.prepareRefund,
    s.refund(),
  );
  await s.t.run((ctx) => ctx.db.patch(id, { status: "failed" }));
  expect(
    (await s.t.query(api.receivableWorkflows.details, s.identity))
      .availableRefund,
  ).toBe("0");
  await expect(
    s.t.mutation(api.receivableWorkflows.prepareRefund, s.refund()),
  ).rejects.toThrow(/exceeds/);
});

it("can refund a late payment to a voided invoice without crediting its original amount", async () => {
  const s = await setup();
  await s.t.mutation(api.receivables.voidInvoice, s.identity);
  await s.t.run((ctx) => ctx.db.patch(s.invoiceId, { received: "5000000" }));
  expect(
    (await s.t.query(api.receivableWorkflows.details, s.identity))
      .availableRefund,
  ).toBe("5");
  await s.t.mutation(
    api.receivableWorkflows.prepareRefund,
    s.refund({ amount: "5" }),
  );
});

it("keeps reminder preparation separate from email delivery and rejects reminders after full credit", async () => {
  const s = await setup(),
    at = Date.now() + 86400000;
  await s.t.mutation(api.receivableWorkflows.setFollowUp, {
    ...s.identity,
    at,
  });
  expect((await s.t.query(api.receivables.get, s.identity)).followUpAt).toBe(
    at,
  );
  const input = { ...s.identity, requestId: crypto.randomUUID() };
  await s.t.mutation(api.receivableWorkflows.reminderPrepared, input);
  await s.t.mutation(api.receivableWorkflows.reminderPrepared, input);
  expect(
    (await s.t.query(api.receivables.get, s.identity)).followUpAt,
  ).toBeUndefined();
  expect(
    await s.t.run((ctx) => ctx.db.query("emailDeliveries").collect()),
  ).toHaveLength(0);
  await s.t.mutation(
    api.receivableWorkflows.issueCredit,
    s.credit({ amount: "100" }),
  );
  await expect(
    s.t.mutation(api.receivableWorkflows.reminderPrepared, {
      ...s.identity,
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toThrow(/no longer/);
  await expect(
    s.t.mutation(api.receivableWorkflows.setFollowUp, { ...s.identity, at }),
  ).rejects.toThrow(/unpaid/);
});

it("does not rewrite earlier receipt accounting when a later credit is issued", async () => {
  const s = await setup(),
    beforeCredit = Date.now() - 10000;
  const insert = async (amount: string, blockNumber: string, time: number) =>
    s.t.run((ctx) =>
      ctx.db.insert("receivableEvents", {
        invoiceId: s.invoiceId,
        orgId: s.ids.orgId,
        key: `key-${blockNumber}`,
        kind: "received",
        amount,
        txHash: `0x${"a".repeat(64)}`,
        logIndex: Number(blockNumber),
        blockNumber,
        blockHash: `0x${"b".repeat(64)}`,
        recordedAt: time,
        settledAt: time,
        fromAddress: TEST_WALLETS.nonMember,
        toAddress: TEST_WALLETS.initiator,
      }),
    );
  const first = await insert("50000000", "100", beforeCredit);
  const source = { kind: "receipt" as const, id: first };
  const prior = await s.t.run((ctx) =>
    loadAccountingFact(ctx, s.ids.orgId, source),
  );
  const credit = await s.t.mutation(
    api.receivableWorkflows.issueCredit,
    s.credit({ amount: "60" }),
  );
  const after = await s.t.run((ctx) =>
    loadAccountingFact(ctx, s.ids.orgId, source),
  );
  expect(after.fingerprint).toBe(prior.fingerprint);
  expect(after.invoiceAppliedRaw).toBe("50000000");
  const second = await insert("10000000", "101", Date.now() + 1000);
  const later = await s.t.run((ctx) =>
    loadAccountingFact(ctx, s.ids.orgId, { kind: "receipt", id: second }),
  );
  expect(later.invoiceAppliedRaw).toBe("0");
  expect(later.invoiceExcessRaw).toBe("10000000");
  const fact = await s.t.run((ctx) =>
    loadAccountingFact(ctx, s.ids.orgId, { kind: "credit_note", id: credit }),
  );
  expect(fact.direction).toBe("noncash");
  expect(fact.dateSource).toBe("document");
  expect(fact.txHash).toBeUndefined();
  expect(fact.transferId).toBeUndefined();
});

it("prepares an exactly-once credit journal through the shared book review without mapping a cash holding", async () => {
  const s = await setup(),
    access = { orgId: s.ids.orgId, sessionToken: s.admin.sessionToken };
  await s.t.mutation(api.accounting.configure, {
    ...access,
    currency: "USD",
    bookName: "General ledger",
    expectedVersion: 0,
  });
  await s.t.mutation(api.accounting.importAccounts, {
    ...access,
    expectedVersion: 1,
    accounts: [
      {
        externalId: "4100",
        name: "Sales returns",
        kind: "income",
        active: true,
      },
      {
        externalId: "1200",
        name: "Accounts receivable",
        kind: "receivable",
        active: true,
      },
      {
        externalId: "2100",
        name: "Customer credits",
        kind: "liability",
        active: true,
      },
    ],
  });
  const credit = await s.t.mutation(
    api.receivableWorkflows.issueCredit,
    s.credit(),
  );
  const source = { kind: "credit_note" as const, id: credit };
  const data = await s.t.query(api.accounting.sourceDetails, {
      ...access,
      source,
    }),
    config = await s.t.query(api.accounting.configuration, access);
  const input = {
    ...access,
    source,
    expectedFingerprint: data.fact!.fingerprint,
    expectedProfileVersion: config.profile!.version,
    treatment: "credit_note" as const,
    postingDate: new Date().toISOString().slice(0, 10),
    assetBookValue: "20.00",
    obligationBookValue: "10.00",
    assetAccountId: config.accounts.find((a) => a.kind === "income")!._id,
    counterAccountId: config.accounts.find((a) => a.kind === "receivable")!._id,
    advanceAccountId: config.accounts.find((a) => a.kind === "liability")!._id,
    bookReference: "CN-10",
    externalName: "Customer",
    valuationEvidence: "Reviewed customer balance and credit value",
    memo: "Agreed invoice adjustment",
  };
  const id = await s.t.mutation(api.accounting.review, input);
  expect(await s.t.mutation(api.accounting.review, input)).toBe(id);
  const entry = await s.t.run((ctx) => ctx.db.get(id));
  expect(entry?.lines).toHaveLength(3);
  expect(entry?.fact.dateSource).toBe("document");
  expect(entry?.fact.txHash).toBeUndefined();
  expect(
    await s.t.run((ctx) => ctx.db.query("accountingMappings").collect()),
  ).toHaveLength(0);
  expect(
    await s.t.run((ctx) => ctx.db.query("accountingEntries").collect()),
  ).toHaveLength(1);
  await s.t.run((ctx) =>
    ctx.db.patch(config.profile!._id, { closedThrough: input.postingDate }),
  );
  await expect(s.t.mutation(api.accounting.review, input)).rejects.toThrow(
    /closed/,
  );
});

it("requires explicit document sharing, isolates bill files and preserves attached files during pruning", async () => {
  const s = await setup(false),
    fileBody = "%PDF-1.7\nDocument fixture\n%%EOF";
  const upload = async () => {
    const response = await s.t.fetch(`/invoice-files?orgId=${s.ids.orgId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.admin.sessionToken}`,
        "Content-Type": "application/pdf",
        "X-File-Name": "customer.pdf",
        "X-Request-Id": crypto.randomUUID(),
      },
      body: fileBody,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { fileId: Id<"invoiceFiles"> }).fileId;
  };
  const fileId = await upload();
  await s.t.mutation(api.invoiceFiles.attachToReceivable, {
    ...s.identity,
    fileId,
  });
  await s.t.mutation(api.invoiceFiles.attachToReceivable, {
    ...s.identity,
    fileId,
  });
  const download = () =>
    s.t.fetch(`/invoice-files?fileId=${fileId}&publicToken=${"a".repeat(64)}`);
  expect((await download()).status).toBe(403);
  await s.t.mutation(api.invoiceFiles.shareReceivableFile, {
    fileId,
    sessionToken: s.admin.sessionToken,
    shared: true,
  });
  expect((await download()).status).toBe(403);
  await s.issue();
  const response = await download();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toContain("attachment");
  expect(await response.text()).toBe(fileBody);
  expect(
    (await s.t.query(api.receivables.publicInvoice, { token: "a".repeat(64) }))
      ?.documents,
  ).toHaveLength(1);
  await expect(
    s.t.mutation(api.invoiceFiles.shareReceivableFile, {
      fileId,
      sessionToken: s.viewer.sessionToken,
      shared: false,
    }),
  ).rejects.toThrow();
  await s.t.mutation(api.invoiceFiles.shareReceivableFile, {
    fileId,
    sessionToken: s.admin.sessionToken,
    shared: false,
  });
  expect((await download()).status).toBe(403);
  expect(
    (await s.t.query(api.receivables.publicInvoice, { token: "a".repeat(64) }))
      ?.documents,
  ).toHaveLength(0);
  const billFile = await upload();
  await s.t.mutation(api.invoices.create, {
    orgId: s.ids.orgId,
    sessionToken: s.admin.sessionToken,
    beneficiaryId: s.beneficiaryId,
    invoiceNumber: "PRIVATE-BILL",
    amount: "1",
    token: "USDC",
    dueDate: Date.now() + 86400000,
    sourceFileIds: [billFile],
    sourceReviewed: true,
  });
  await expect(
    s.t.mutation(api.invoiceFiles.attachToReceivable, {
      ...s.identity,
      fileId: billFile,
    }),
  ).rejects.toThrow(/unavailable/);
  expect(
    (
      await s.t.fetch(
        `/invoice-files?fileId=${billFile}&publicToken=${"a".repeat(64)}`,
      )
    ).status,
  ).toBe(403);
  vi.setSystemTime(Date.now() + 2 * 86400000);
  await s.t.mutation(internal.invoiceFiles.prune, {});
  expect(await s.t.run((ctx) => ctx.db.get(fileId))).not.toBeNull();
  expect(
    (
      await s.t.fetch(`/invoice-files?fileId=${fileId}`, {
        headers: { Authorization: `Bearer ${s.viewer.sessionToken}` },
      })
    ).status,
  ).toBe(200);
});
