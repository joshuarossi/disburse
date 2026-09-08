import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { type Address, type Hex, zeroAddress } from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestSafe,
  createTestMembership,
  signIn,
  TEST_WALLETS,
} from "./factories";
import { cctpConfiguration, makeCctpQuote } from "../../shared/cctp";
import { refreshReportIndex } from "./reportHelpers";
import { queueReportSource } from "../lib/reportIndex";
import { treasuryReportRows } from "../lib/treasuryReports";
import { depositReportRows, outgoingReportRows } from "../lib/reportRows";
import {
  buildSettlementJournal,
  type BookAccount,
} from "../../shared/accounting";
import { readCircleSource } from "../lib/circleSource";
import {
  circleAccountCall,
  circleConfiguration,
  circleSignature,
  circleOperationHash,
} from "../../shared/circleExecution";
import {
  encodeCircleRequest,
  type CircleRequest,
} from "../../shared/circleRequest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("reconciles a transfer through clearing with the provider fee and without inventing another wallet debit", () => {
  const account = (
    id: string,
    kind: BookAccount["kind"] = "asset",
  ): BookAccount => ({ id, name: id, externalId: id, kind, version: 1 });
  const source = buildSettlementJournal({
    treatment: "internal_transfer",
    direction: "outflow",
    currency: "USD",
    companyTransfer: true,
    assetBookValue: "100.25",
    assetAccount: account("operations"),
    counterAccount: account("clearing"),
  });
  const receipt = {
    treatment: "internal_transfer" as const,
    direction: "inflow" as const,
    currency: "USD" as const,
    companyTransfer: true,
    assetBookValue: "100.05",
    assetAccount: account("payroll"),
    counterAccount: account("clearing"),
    deliveryFeeRequired: true,
  };
  expect(() => buildSettlementJournal(receipt)).toThrow();
  expect(() =>
    buildSettlementJournal({
      ...receipt,
      deliveryFeeBookValue: "0.20",
      deliveryFeeAccount: account("wrong"),
    }),
  ).toThrow("expense");
  const destination = buildSettlementJournal({
    ...receipt,
    deliveryFeeBookValue: "0.20",
    deliveryFeeAccount: account("delivery", "expense"),
  });
  expect(
    source.map((line) => [line.account.id, line.debit, line.credit]),
  ).toEqual([
    ["operations", "", "100.25"],
    ["clearing", "100.25", ""],
  ]);
  expect(
    destination.map((line) => [line.account.id, line.debit, line.credit]),
  ).toEqual([
    ["payroll", "100.05", ""],
    ["clearing", "", "100.25"],
    ["delivery", "0.20", ""],
  ]);
});
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    await ctx.db.patch(org.safeId, { chainId: 8453 });
    const destinationSafeId = await createTestSafe(ctx, org.orgId, {
      chainId: 42161,
      safeAddress: TEST_WALLETS.approver,
    });
    return { ...org, destinationSafeId };
  });
  const { sessionToken } = await signIn(t, "admin");
  const args = {
    orgId: ids.orgId,
    safeId: ids.safeId,
    destinationSafeId: ids.destinationSafeId,
    amount: "2000000",
    requestId: "qa-treasury-request-1",
    sessionToken,
  };
  const quote = makeCctpQuote(
    {
      reference: `0x${"12".repeat(32)}`,
      chainId: 8453,
      destinationChainId: 42161,
      account: ids.safeAddress as Address,
      destination: TEST_WALLETS.approver as Address,
      amount: args.amount,
    },
    [{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { high: 250000 } }],
    Date.now(),
  );
  const id = await t.mutation(internal.treasury.save, {
    ...args,
    quote: JSON.stringify(quote),
  });
  const sourceArgs = { treasuryTransferId: id, sessionToken };
  const source = await t.run((ctx) =>
    readCircleSource(ctx, sourceArgs, sessionToken, true),
  );
  if (!source.directCall) throw new Error("Expected provider call");
  const until = Math.floor(quote.expiresAt / 1000);
  const request: CircleRequest = {
    chainId: 8453,
    safe: ids.safeAddress as Address,
    directCall: true,
    transaction: source.call,
    originalHash: source.target.safeTxHash as Hex,
    startBlock: "100",
    safeNonce: "0",
    validAfter: 0,
    validUntil: until,
    permit: { name: "USDC", version: "2", nonce: "0", amount: "2000000" },
    operation: {
      sender: ids.safeAddress as Address,
      nonce: 1n << 64n,
      callData: circleAccountCall(
        source.call.to,
        source.call.data,
        "operation" in source.call ? source.call.operation : 0,
      ),
      callGasLimit: 200000n,
      verificationGasLimit: 900000n,
      preVerificationGas: 100000n,
      maxFeePerGas: 10000000n,
      maxPriorityFeePerGas: 1000000n,
      paymaster: circleConfiguration(8453).paymaster,
      paymasterVerificationGasLimit: 300000n,
      paymasterPostOpGasLimit: 80000n,
      paymasterData: "0x",
      signature: circleSignature(
        0,
        until,
        `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
      ),
    },
  };
  const persist = () =>
    t.mutation(internal.circlePayments.persist, {
      ...sourceArgs,
      snapshot: source.snapshot,
      record: encodeCircleRequest(request),
    });
  return { t, ids, args, id, quote, request, source, sourceArgs, persist };
}

it("permits a distinct transfer after the source confirms while retaining the undelivered original", async () => {
  const { t, ids, args, id, quote } = await setup();
  const next = {
    ...args,
    requestId: "qa-treasury-request-2",
    quote: JSON.stringify({ ...quote, reference: `0x${"23".repeat(32)}` }),
  };
  await expect(t.mutation(internal.treasury.save, next)).rejects.toThrow(
    "saved transfer",
  );
  await t.run((ctx) =>
    ctx.db.patch(id, {
      status: "delivering",
      sourceTxHash: `0x${"ab".repeat(32)}`,
    }),
  );
  const second = await t.mutation(internal.treasury.save, next);
  expect(second).not.toBe(id);
  expect((await t.run((ctx) => ctx.db.get(id)))?.open).toBe(true);
  await expect(
    t.mutation(internal.treasury.save, {
      ...next,
      requestId: "qa-treasury-request-3",
    }),
  ).rejects.toThrow("saved transfer");
  expect((await t.run((ctx) => ctx.db.get(second)))?.safeId).toBe(ids.safeId);
});

it("treats customer-supplied receiving receipts only as unverified hints", async () => {
  const { t, id, sourceArgs } = await setup();
  const txHash = `0x${"ab".repeat(32)}`;
  await expect(
    t.mutation(api.treasury.reportDelivery, { ...sourceArgs, txHash }),
  ).rejects.toThrow("status");
  await t.run((ctx) =>
    ctx.db.patch(id, {
      status: "delivering",
      sourceTxHash: `0x${"cd".repeat(32)}`,
    }),
  );
  await expect(
    t.mutation(api.treasury.reportDelivery, { ...sourceArgs, txHash: "0x123" }),
  ).rejects.toThrow("full receiving");
  await t.mutation(api.treasury.reportDelivery, { ...sourceArgs, txHash });
  const original = await t.run((ctx) => ctx.db.get(id));
  expect(original).toMatchObject({
    status: "delivering",
    open: true,
    deliveryHint: txHash,
  });
  expect(original?.destinationTxHash).toBeUndefined();
  expect(original?.deliveredAmount).toBeUndefined();
  await expect(
    t.mutation(api.treasury.reportDelivery, { ...sourceArgs, txHash }),
  ).rejects.toThrow("still being checked");
});

it("paginates older transfer history without mixing activity environments or companies", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    const row = (await ctx.db.get(s.id))!;
    const { _id, _creationTime, ...fields } = row;
    void _id;
    void _creationTime;
    for (let index = 0; index < 4; index++)
      await ctx.db.insert("treasuryTransfers", {
        ...fields,
        requestId: `pagination-request-${index}`,
        open: false,
        status: "cancelled",
      });
    const quote = makeCctpQuote(
      { ...s.quote, chainId: 84532, destinationChainId: 11155111 },
      [
        {
          finalityThreshold: 2000,
          minimumFee: 0,
          forwardFee: { high: 100000 },
        },
      ],
      Date.now(),
    );
    await ctx.db.insert("treasuryTransfers", {
      ...fields,
      environment: "test",
      chainId: 84532,
      destinationChainId: 11155111,
      quote: JSON.stringify(quote),
      requestId: "test-pagination-request",
      open: false,
      status: "cancelled",
    });
  });
  const args = {
    orgId: s.ids.orgId,
    sessionToken: s.args.sessionToken,
    environment: "production" as const,
  };
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let i = 0; i < 3; i++) {
    const page: FunctionReturnType<typeof api.treasury.list> = await s.t.query(
      api.treasury.list,
      { ...args, paginationOpts: { numItems: 2, cursor } },
    );
    for (const row of page.page) {
      expect(row.environment).toBe("production");
      expect(ids.has(row._id)).toBe(false);
      ids.add(row._id);
    }
    cursor = page.continueCursor;
    expect(page.isDone).toBe(i === 2);
  }
  expect(ids.size).toBe(5);
  await expect(
    s.t.query(api.treasury.list, {
      ...args,
      paginationOpts: { numItems: 1000, cursor: null },
    }),
  ).rejects.toThrow("100 transfers");
  const outsider = await signIn(s.t, "nonMember");
  await expect(
    s.t.query(api.treasury.list, {
      ...args,
      sessionToken: outsider.sessionToken,
      paginationOpts: { numItems: 20, cursor: null },
    }),
  ).rejects.toThrow();
});
it("journals one reviewed quote and recovers a lost response without a second transfer", async () => {
  const s = await setup();
  expect(
    await s.t.mutation(internal.treasury.save, {
      ...s.args,
      quote: JSON.stringify(s.quote),
    }),
  ).toBe(s.id);
  expect(
    (await s.t.query(internal.treasury.preparation, s.args)).existing?._id,
  ).toBe(s.id);
  await expect(
    s.t.mutation(internal.treasury.save, {
      ...s.args,
      amount: "3000000",
      quote: JSON.stringify(s.quote),
    }),
  ).rejects.toThrow("different");
  expect(
    await s.t.run((ctx) => ctx.db.query("treasuryTransfers").collect()),
  ).toHaveLength(1);
});
it("does not allow a second unpaid instruction to hide the first one", async () => {
  const s = await setup();
  await expect(
    s.t.query(internal.treasury.preparation, {
      ...s.args,
      requestId: "qa-second-transfer-2",
    }),
  ).rejects.toThrow("already has");
});
it("separates viewing from transfer preparation and rejects cross-company records", async () => {
  const s = await setup(),
    viewer = await signIn(s.t, "viewer"),
    outsider = await signIn(s.t, "nonMember");
  await s.t.run((ctx) =>
    createTestMembership(ctx, s.ids.orgId, viewer.userId, { role: "viewer" }),
  );
  await expect(
    s.t.query(api.treasury.get, {
      ...s.sourceArgs,
      sessionToken: viewer.sessionToken,
    }),
  ).resolves.toBeDefined();
  await expect(
    s.t.mutation(api.treasury.stop, {
      ...s.sourceArgs,
      sessionToken: viewer.sessionToken,
    }),
  ).rejects.toThrow();
  await expect(
    s.t.query(internal.treasury.preparation, {
      ...s.args,
      sessionToken: viewer.sessionToken,
    }),
  ).rejects.toThrow();
  await expect(
    s.t.query(api.treasury.get, {
      ...s.sourceArgs,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow();
});
it("blocks account changes and expired quotes before any wallet approval", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.ids.destinationSafeId, { isActive: false }),
  );
  await expect(s.persist()).rejects.toThrow("no longer");
  await expect(
    s.t.query(api.treasury.get, s.sourceArgs),
  ).resolves.toBeDefined();
  await s.t.run((ctx) =>
    ctx.db.patch(s.ids.destinationSafeId, { isActive: true }),
  );
  vi.setSystemTime(s.quote.expiresAt + 1);
  await expect(s.persist()).rejects.toThrow("no longer");
  await s.t.mutation(internal.treasury.checkpoint, {
    treasuryTransferId: s.id,
  });
  expect(await s.t.query(api.treasury.get, s.sourceArgs)).toMatchObject({
    status: "expired",
    open: false,
  });
});
it("binds the fee account and the approval deadline to the provider quote", async () => {
  const s = await setup();
  expect(s.source).toMatchObject({
    principalUSDC: "2250000",
    window: { validUntil: Math.floor(s.quote.expiresAt / 1000) },
  });
  const record = { ...s.request, validUntil: s.request.validUntil + 60 };
  record.operation = {
    ...record.operation,
    signature: circleSignature(
      0,
      record.validUntil,
      `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
    ),
  };
  await expect(
    s.t.mutation(internal.circlePayments.persist, {
      ...s.sourceArgs,
      snapshot: s.source.snapshot,
      record: encodeCircleRequest(record),
    }),
  ).rejects.toThrow("window");
});
it("discards an unsigned transfer and fee review without charging the customer", async () => {
  const s = await setup(),
    executionId = await s.persist();
  expect(await s.t.mutation(api.treasury.stop, s.sourceArgs)).toMatchObject({
    cancelled: true,
  });
  expect(await s.t.run((ctx) => ctx.db.get(executionId))).toMatchObject({
    open: false,
    stage: "cancelled",
  });
  expect(await s.t.query(api.treasury.get, s.sourceArgs)).toMatchObject({
    status: "cancelled",
    open: false,
  });
  expect(
    await s.t.query(internal.treasury.preparation, {
      ...s.args,
      requestId: "qa-replacement-transfer",
    }),
  ).toBeDefined();
});
it("treats a lost signature response as a possible on-chain authorization", async () => {
  const s = await setup(),
    executionId = await s.persist();
  await s.t.run((ctx) =>
    ctx.db.patch(executionId, {
      stage: "operation",
      operationApprovalStartedAt: Date.now(),
    }),
  );
  expect(await s.t.mutation(api.treasury.stop, s.sourceArgs)).toMatchObject({
    cancelled: false,
    executionId,
  });
  expect(await s.t.query(api.treasury.get, s.sourceArgs)).toMatchObject({
    status: "approving",
    open: true,
  });
  const cancel = await s.t.run((ctx) =>
    readCircleSource(
      ctx,
      { cancelExecutionId: executionId },
      s.args.sessionToken,
      true,
    ),
  );
  expect(cancel).toMatchObject({
    directCall: true,
    principalUSDC: "0",
    call: { to: s.request.safe, data: "0x" },
    originalRecord: encodeCircleRequest(s.request),
  });
});
it("never discards or reprices a transfer after submission has been claimed", async () => {
  const s = await setup(),
    executionId = await s.persist();
  await s.t.run((ctx) => ctx.db.patch(executionId, { stage: "ready" }));
  await s.t.mutation(internal.circlePayments.claim, {
    executionId,
    sessionToken: s.args.sessionToken,
    revision: 0,
    userOpHash: circleOperationHash(s.request.chainId, s.request.operation),
  });
  await expect(s.t.mutation(api.treasury.stop, s.sourceArgs)).rejects.toThrow(
    "on its way",
  );
  expect(await s.t.query(api.treasury.get, s.sourceArgs)).toMatchObject({
    status: "processing",
    open: true,
  });
});
it("does not mark a burn or delivery complete without both independent proofs", async () => {
  const s = await setup(),
    executionId = await s.persist();
  await expect(
    s.t.mutation(internal.circlePayments.checkpoint, {
      executionId,
      revision: 0,
      scanFrom: "100",
      nextBlock: "101",
      state: "confirmed",
      txHash: `0x${"ab".repeat(32)}`,
      fee: "1",
    }),
  ).rejects.toThrow("evidence");
  await expect(
    s.t.mutation(internal.treasury.settled, {
      treasuryTransferId: s.id,
      txHash: `0x${"ab".repeat(32)}`,
      amount: "2000000",
      fee: "250000",
      nonce: `0x${"ab".repeat(32)}`,
      logIndex: 3,
      settlement: {
        blockNumber: "10",
        blockHash: `0x${"cd".repeat(32)}`,
        timestamp: Date.now(),
      },
    }),
  ).rejects.toThrow("original debit");
});
it("preserves receipt evidence during provider downtime and only records delivery once", async () => {
  const s = await setup(),
    sourceTx = `0x${"ab".repeat(32)}`,
    destinationTx = `0x${"cd".repeat(32)}`;
  const settlement = {
    blockNumber: "10",
    blockHash: `0x${"ef".repeat(32)}`,
    timestamp: Date.now(),
  };
  await s.t.run((ctx) =>
    ctx.db.patch(s.id, {
      status: "delivering",
      open: false,
      sourceTxHash: sourceTx,
      sourceSettlement: settlement,
    }),
  );
  await s.t.mutation(internal.treasury.checkpoint, {
    treasuryTransferId: s.id,
    error: "Provider unavailable",
  });
  expect(await s.t.query(api.treasury.get, s.sourceArgs)).toMatchObject({
    status: "delivering",
    sourceTxHash: sourceTx,
    error: "Provider unavailable",
  });
  const proof = {
    treasuryTransferId: s.id,
    txHash: destinationTx,
    amount: "2050000",
    fee: "200000",
    nonce: `0x${"23".repeat(32)}`,
    logIndex: 4,
    settlement,
  };
  await s.t.mutation(internal.treasury.settled, proof);
  await s.t.mutation(internal.treasury.settled, proof);
  const completed = await s.t.query(api.treasury.get, s.sourceArgs);
  expect(completed).toMatchObject({
    status: "completed",
    deliveredAmount: "2050000",
  });
  expect(completed?.recoveryAt).toBeUndefined();
  await expect(
    s.t.mutation(internal.treasury.settled, { ...proof, txHash: sourceTx }),
  ).rejects.toThrow("different delivery");
  await expect(
    s.t.mutation(internal.treasury.settled, {
      ...proof,
      amount: "1999999",
      fee: "250001",
    }),
  ).rejects.toThrow("original transfer");
});

it("keeps the gross debit while in transit and removes duplicate indexer movements after delivery", async () => {
  const s = await setup(),
    sourceHash = `0x${"aa".repeat(32)}`,
    destinationHash = `0x${"bb".repeat(32)}`;
  const sourceSettlement = {
      blockNumber: "10",
      blockHash: `0x${"cc".repeat(32)}`,
      timestamp: Date.now(),
    },
    destinationSettlement = {
      ...sourceSettlement,
      blockNumber: "12",
      timestamp: Date.now() + 120000,
    };
  const sent = `e${sourceHash.slice(2)}3`,
    received = `e${destinationHash.slice(2)}4`;
  const transfers = await s.t.run(async (ctx) => {
    await ctx.db.patch(s.id, {
      status: "delivering",
      open: false,
      sourceTxHash: sourceHash,
      sourceTransferId: sent,
      sourceSettlement,
    });
    const common = {
      orgId: s.ids.orgId,
      tokenSymbol: "USDC",
      decimals: 6,
      source: "safe_tx_service" as const,
      createdAt: Date.now(),
    };
    const outgoing = await ctx.db.insert("outgoingTransfers", {
      ...common,
      safeId: s.ids.safeId,
      chainId: 8453,
      safeAddress: s.quote.account,
      tokenAddress: cctpConfiguration(8453).token,
      amountRaw: s.quote.total,
      amount: "2.25",
      txHash: sourceHash,
      transferId: sent,
      blockNumber: 10,
      timestamp: sourceSettlement.timestamp,
      fromAddress: s.quote.account,
      toAddress: cctpConfiguration(8453).minter,
    });
    const incoming = await ctx.db.insert("deposits", {
      ...common,
      safeId: s.ids.destinationSafeId,
      chainId: 42161,
      safeAddress: s.quote.destination,
      tokenAddress: cctpConfiguration(42161).token,
      amountRaw: "2050000",
      amount: "2.05",
      txHash: destinationHash,
      transferId: received,
      blockNumber: 12,
      timestamp: destinationSettlement.timestamp,
      fromAddress: zeroAddress,
      toAddress: s.quote.destination,
    });
    return { outgoing, incoming };
  });
  expect(await s.t.run((ctx) => treasuryReportRows(ctx, s.id))).toHaveLength(1);
  expect(
    await s.t.run((ctx) => outgoingReportRows(ctx, transfers.outgoing)),
  ).toEqual([]);
  await refreshReportIndex(s.t, s.ids.orgId);
  const sentFact = (
    await s.t.query(api.accounting.sourceDetails, {
      orgId: s.ids.orgId,
      sessionToken: s.args.sessionToken,
      source: { kind: "activity", id: `${s.id}:sent` },
    })
  ).fact!;
  expect(sentFact).toMatchObject({
    companyTransfer: true,
    amountRaw: "2250000",
    transferId: sent,
    settledAt: sourceSettlement.timestamp,
  });
  await s.t.mutation(internal.treasury.settled, {
    treasuryTransferId: s.id,
    txHash: destinationHash,
    amount: "2050000",
    fee: "200000",
    nonce: `0x${"11".repeat(32)}`,
    logIndex: 4,
    settlement: destinationSettlement,
  });
  await refreshReportIndex(s.t, s.ids.orgId);
  expect(
    await s.t.run((ctx) => depositReportRows(ctx, transfers.incoming)),
  ).toEqual([]);
  const rows = await s.t.run((ctx) => ctx.db.query("reportEntries").collect());
  expect(rows).toHaveLength(2);
  expect(
    rows.filter((r) => r.direction === "outflow").map((r) => r.amountRaw),
  ).toEqual(["2250000"]);
  expect(
    rows.filter((r) => r.direction === "inflow").map((r) => r.amountRaw),
  ).toEqual(["2050000"]);
  const scope = { orgId: s.ids.orgId, sessionToken: s.args.sessionToken };
  const currentSent = (
    await s.t.query(api.accounting.sourceDetails, {
      ...scope,
      source: { kind: "activity", id: `${s.id}:sent` },
    })
  ).fact!;
  expect(currentSent.fingerprint).toBe(sentFact.fingerprint);
  const receiptFact = (
    await s.t.query(api.accounting.sourceDetails, {
      ...scope,
      source: { kind: "activity", id: `${s.id}:received` },
    })
  ).fact!;
  expect(receiptFact).toMatchObject({
    companyTransfer: true,
    amountRaw: "2050000",
    deliveryFeeRaw: "200000",
    settledAt: destinationSettlement.timestamp,
  });
  await s.t.mutation(api.accounting.configure, {
    ...scope,
    currency: "USD",
    bookName: "QA company ledger",
    expectedVersion: 0,
  });
  await s.t.mutation(api.accounting.importAccounts, {
    ...scope,
    expectedVersion: 1,
    accounts: [
      {
        externalId: "operations",
        name: "Operations balance",
        kind: "asset",
        active: true,
      },
      {
        externalId: "payroll",
        name: "Payroll balance",
        kind: "asset",
        active: true,
      },
      {
        externalId: "clearing",
        name: "Transfers in transit",
        kind: "asset",
        active: true,
      },
      {
        externalId: "delivery",
        name: "Delivery fees",
        kind: "expense",
        active: true,
      },
    ],
  });
  const config = await s.t.query(api.accounting.configuration, scope),
    accountId = (id: string) =>
      config.accounts.find((row) => row.externalId === id)!._id;
  const review = {
    ...scope,
    expectedProfileVersion: config.profile!.version,
    treatment: "internal_transfer" as const,
    counterAccountId: accountId("clearing"),
    bookReference: "Transfer reconciliation 1",
    valuationEvidence:
      "Reviewed carrying value and confirmed source and destination receipts",
    memo: "Company account transfer",
  };
  const sentEntry = await s.t.mutation(api.accounting.review, {
    ...review,
    source: sentFact.source,
    expectedFingerprint: sentFact.fingerprint,
    postingDate: new Date(sentFact.settledAt).toISOString().slice(0, 10),
    assetAccountId: accountId("operations"),
    assetBookValue: "2.25",
  });
  const receivedInput = {
    ...review,
    source: receiptFact.source,
    expectedFingerprint: receiptFact.fingerprint,
    postingDate: new Date(receiptFact.settledAt).toISOString().slice(0, 10),
    assetAccountId: accountId("payroll"),
    assetBookValue: "2.05",
  };
  await expect(
    s.t.mutation(api.accounting.review, receivedInput),
  ).rejects.toThrow();
  const receiptEntry = await s.t.mutation(api.accounting.review, {
    ...receivedInput,
    deliveryFeeBookValue: "0.20",
    deliveryFeeAccountId: accountId("delivery"),
  });
  const exportId = await s.t.mutation(api.accounting.createExport, {
    ...scope,
    entryIds: [sentEntry, receiptEntry],
    environment: "production",
    requestId: "treasury-export-request-1",
  });
  const exported = await s.t.query(api.accounting.exportDetails, {
    exportId,
    sessionToken: scope.sessionToken,
  });
  expect(exported.entries).toHaveLength(2);
  const deliveryEntry = exported.entries.find(
    (row) => row._id === receiptEntry,
  )!;
  expect(deliveryEntry.deliveryFeeBookValue).toBe("0.20");
  expect(
    deliveryEntry.lines.map((line) => [
      line.account.externalId,
      line.debit,
      line.credit,
    ]),
  ).toEqual([
    ["payroll", "2.05", ""],
    ["clearing", "", "2.25"],
    ["delivery", "0.20", ""],
  ]);
  expect(deliveryEntry.fact.transferId).toBe(received);
  // A late indexer retry must not restore duplicate rows or aggregate totals.
  await s.t.run(async (ctx) => {
    await queueReportSource(ctx, s.ids.orgId, "deposit", transfers.incoming);
    await queueReportSource(ctx, s.ids.orgId, "outgoing", transfers.outgoing);
  });
  await refreshReportIndex(s.t, s.ids.orgId);
  expect(
    await s.t.run((ctx) => ctx.db.query("reportEntries").collect()),
  ).toHaveLength(2);
});
