import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { keccak256, toHex, type Address, type Hex } from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestMembership,
  signIn,
  TEST_WALLETS,
} from "./factories";
import {
  lendingCall,
  lendingQuoteHash,
  LENDING_QUOTE_LIFETIME,
  lendingMarket,
  type LendingQuote,
} from "../../shared/lending";
import {
  circleAccountCall,
  circleConfiguration,
  circleOperationHash,
  circleSignature,
} from "../../shared/circleExecution";
import {
  encodeCircleRequest,
  type CircleRequest,
} from "../../shared/circleRequest";
import { readCircleSource } from "../lib/circleSource";
import { readTreasuryService } from "../lib/treasuryService";
import { treasuryServiceReportRows } from "../lib/treasuryServiceReports";
import { outgoingReportRows, depositReportRows } from "../lib/reportRows";
import { loadAccountingFact } from "../lib/accountingSource";
import { refreshReportIndex } from "./reportHelpers";
import { queueReportSource } from "../lib/reportIndex";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function setup(
  kind: "supply" | "withdraw" = "supply",
  withdrawAll = false,
) {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    await ctx.db.patch(ids.safeId, { chainId: 8453 });
    return ids;
  });
  const { sessionToken } = await signIn(t, "admin");
  const args = {
    orgId: ids.orgId,
    safeId: ids.safeId,
    kind,
    amount: "100000000",
    requestId: "qa-lending-request-1",
    withdrawAll: withdrawAll ? true : undefined,
    sessionToken,
  };
  const now = Date.now(),
    quote: LendingQuote = {
      version: 1,
      provider: "aave_v3",
      kind,
      chainId: 8453,
      account: ids.safeAddress as Address,
      reference: keccak256(toHex(`${ids.orgId}:${args.requestId}`)),
      amount: args.amount,
      ...(withdrawAll ? { withdrawAll: true } : {}),
      rateRay: "30000000000000000000000000",
      price: "100000000",
      priceUnit: "100000000",
      createdAt: now,
      expiresAt: now + LENDING_QUOTE_LIFETIME,
    };
  const id = await t.mutation(internal.treasuryServices.save, {
    ...args,
    quote: JSON.stringify(quote),
  });
  const sourceArgs = { treasuryServiceId: id, sessionToken },
    call = lendingCall(quote),
    until = Math.floor(quote.expiresAt / 1000);
  const source = await t.run((ctx) =>
    readTreasuryService(ctx, id, sessionToken, true),
  );
  const request: CircleRequest = {
    chainId: 8453,
    safe: ids.safeAddress as Address,
    directCall: true,
    transaction: call,
    originalHash: lendingQuoteHash(quote),
    startBlock: "100",
    safeNonce: "0",
    validAfter: 0,
    validUntil: until,
    permit: { name: "USDC", version: "2", nonce: "0", amount: "2000000" },
    operation: {
      sender: ids.safeAddress as Address,
      nonce: 1n << 64n,
      callData: circleAccountCall(call.to, call.data, call.operation),
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
  return { t, ids, args, id, quote, sourceArgs, source, request, persist };
}
it("keeps an interrupted preparation idempotent and refuses different instructions or competing requests", async () => {
  const s = await setup();
  expect(
    await s.t.mutation(internal.treasuryServices.save, {
      ...s.args,
      quote: JSON.stringify(s.quote),
    }),
  ).toBe(s.id);
  await expect(
    s.t.mutation(internal.treasuryServices.save, {
      ...s.args,
      amount: "2",
      quote: JSON.stringify({ ...s.quote, amount: "2" }),
    }),
  ).rejects.toThrow("different instructions");
  await expect(
    s.t.query(internal.treasuryServices.preparation, {
      ...s.args,
      requestId: "another-request-12345",
    }),
  ).rejects.toThrow("already has");
  const feeId = await s.persist();
  expect(await s.t.query(api.circlePayments.get, s.sourceArgs)).toMatchObject({
    _id: feeId,
    treasuryServiceId: s.id,
  });
});
it("requires treasury access even when a member may create ordinary payments", async () => {
  const s = await setup();
  for (const role of ["initiator", "viewer"] as const) {
    const { sessionToken, userId } = await signIn(s.t, role);
    await s.t.run((ctx) =>
      createTestMembership(ctx, s.ids.orgId, userId, { role }),
    );
    await expect(
      s.t.query(api.treasuryServices.get, { ...s.sourceArgs, sessionToken }),
    ).resolves.toMatchObject({ _id: s.id });
    await expect(
      s.t.mutation(api.treasuryServices.stop, {
        ...s.sourceArgs,
        sessionToken,
      }),
    ).rejects.toThrow();
    await expect(
      s.t.query(internal.treasuryServices.context, {
        ...s.sourceArgs,
        sessionToken,
      }),
    ).rejects.toThrow();
  }
});
it("stops an unsigned request without fees and prevents further use of its original quote", async () => {
  const s = await setup(),
    executionId = await s.persist();
  expect(
    await s.t.mutation(api.treasuryServices.stop, s.sourceArgs),
  ).toMatchObject({ cancelled: true });
  expect(await s.t.run((ctx) => ctx.db.get(executionId))).toMatchObject({
    open: false,
    stage: "cancelled",
  });
  await expect(
    s.t.query(internal.treasuryServices.context, s.sourceArgs),
  ).rejects.toThrow("no longer ready");
  await expect(
    s.t.query(internal.treasuryServices.preparation, {
      ...s.args,
      requestId: "replacement-123456",
    }),
  ).resolves.toBeDefined();
});
it("retains possibly signed approvals and cancels only their original nonce", async () => {
  const s = await setup(),
    executionId = await s.persist();
  await s.t.run((ctx) =>
    ctx.db.patch(executionId, {
      stage: "operation",
      operationApprovalStartedAt: Date.now(),
    }),
  );
  expect(await s.t.mutation(api.treasuryServices.stop, s.sourceArgs)).toEqual({
    cancelled: false,
    executionId,
  });
  const cancellation = await s.t.run((ctx) =>
    readCircleSource(
      ctx,
      { cancelExecutionId: executionId },
      s.args.sessionToken,
      true,
    ),
  );
  expect(cancellation).toMatchObject({
    directCall: true,
    principalUSDC: "0",
    call: { to: s.request.safe, data: "0x" },
    originalRecord: encodeCircleRequest(s.request),
  });
  expect(await s.t.query(api.treasuryServices.get, s.sourceArgs)).toMatchObject(
    { open: true, status: "approving" },
  );
  await expect(
    s.t.query(internal.treasuryServices.context, s.sourceArgs),
  ).rejects.toThrow("no longer ready");
});
it("never discards or resends a request once submission has been claimed", async () => {
  const s = await setup(),
    executionId = await s.persist();
  await s.t.run((ctx) => ctx.db.patch(executionId, { stage: "ready" }));
  await s.t.mutation(internal.circlePayments.claim, {
    executionId,
    sessionToken: s.args.sessionToken,
    revision: 0,
    userOpHash: circleOperationHash(8453, s.request.operation),
  });
  expect(await s.t.query(api.treasuryServices.get, s.sourceArgs)).toMatchObject(
    { status: "processing" },
  );
  await expect(
    s.t.mutation(api.treasuryServices.stop, s.sourceArgs),
  ).rejects.toThrow("already be submitted");
});
it("expires an unsigned review and keeps archived history accessible", async () => {
  const s = await setup();
  vi.setSystemTime(s.quote.expiresAt + 1000);
  await s.t.mutation(internal.treasuryServices.checkpoint, {
    treasuryServiceId: s.id,
  });
  await s.t.run((ctx) => ctx.db.patch(s.ids.safeId, { isActive: false }));
  expect(await s.t.query(api.treasuryServices.get, s.sourceArgs)).toMatchObject(
    { status: "expired", open: false },
  );
});
it("requires independent fee and principal evidence before recording completion", async () => {
  const s = await setup(),
    executionId = await s.persist();
  const settlement = {
    blockNumber: "120",
    blockHash: `0x${"cd".repeat(32)}`,
    timestamp: Date.now(),
  };
  const checkpoint = {
    executionId,
    revision: 0,
    scanFrom: "100",
    nextBlock: "121",
    state: "confirmed" as const,
    txHash: `0x${"ab".repeat(32)}`,
    fee: "1000",
    feeProof: {
      prefund: { amountRaw: "2000", logIndex: 1 },
      refund: { amountRaw: "1000", logIndex: 9 },
    },
    settlement,
  };
  await expect(
    s.t.mutation(internal.circlePayments.checkpoint, checkpoint),
  ).rejects.toThrow("principal");
  await expect(
    s.t.mutation(internal.circlePayments.checkpoint, {
      ...checkpoint,
      principalVerified: true,
    }),
  ).rejects.toThrow("asset transfer");
  await s.t.mutation(internal.circlePayments.checkpoint, {
    ...checkpoint,
    principalVerified: true,
    serviceTransferIndex: 4,
    serviceAmount: "100000000",
  });
  expect(await s.t.query(api.treasuryServices.get, s.sourceArgs)).toMatchObject(
    {
      status: "completed",
      sourceTransferId: `e${"ab".repeat(32)}4`,
      sourceSettlement: settlement,
    },
  );
});
for (const kind of ["supply", "withdraw"] as const)
  it(`reconciles ${kind} without double counting a late Safe-indexed principal movement`, async () => {
    const s = await setup(kind),
      market = lendingMarket(8453),
      txHash = `0x${"ab".repeat(32)}` as Hex;
    const transferId = `e${txHash.slice(2)}4`,
      timestamp = Date.now();
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.id, {
        status: "completed",
        open: false,
        sourceTxHash: txHash,
        sourceTransferId: transferId,
        sourceSettlement: {
          blockNumber: "120",
          blockHash: `0x${"cd".repeat(32)}`,
          timestamp,
        },
      });
      await queueReportSource(ctx, s.ids.orgId, "service", s.id);
    });
    await refreshReportIndex(s.t, s.ids.orgId);
    const rows = await s.t.run((ctx) => treasuryServiceReportRows(ctx, s.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amountRaw: "100000000",
      kind: "investment",
      serviceKind: kind,
      includedInTotals: true,
    });
    const fact = await s.t.run((ctx) =>
      loadAccountingFact(ctx, s.ids.orgId, {
        kind: "activity",
        id: `${s.id}:principal`,
      }),
    );
    expect(fact).toMatchObject({
      companyTransfer: false,
      lendingMovement: kind,
      transferId,
      amount: "100",
    });
    await s.t.run(async (ctx) => {
      const common = {
        orgId: s.ids.orgId,
        safeId: s.ids.safeId,
        chainId: 8453,
        safeAddress: s.ids.safeAddress,
        tokenAddress: market.asset,
        tokenSymbol: "USDC",
        decimals: 6,
        source: "safe_tx_service" as const,
        amount: "100",
        amountRaw: "100000000",
        txHash,
        transferId,
        blockNumber: 120,
        timestamp,
        createdAt: timestamp,
      };
      if (kind === "supply") {
        const id = await ctx.db.insert("outgoingTransfers", {
          ...common,
          fromAddress: s.ids.safeAddress,
          toAddress: market.aToken,
        });
        expect(await outgoingReportRows(ctx, id)).toEqual([]);
      } else {
        const id = await ctx.db.insert("deposits", {
          ...common,
          fromAddress: market.aToken,
          toAddress: s.ids.safeAddress,
        });
        expect(await depositReportRows(ctx, id)).toEqual([]);
      }
    });
  });

it("records actual full-withdrawal quantity rather than the earlier estimate", async () => {
  const s = await setup("withdraw", true),
    executionId = await s.persist();
  await s.t.mutation(internal.circlePayments.checkpoint, {
    executionId,
    revision: 0,
    scanFrom: "100",
    nextBlock: "121",
    state: "confirmed",
    txHash: `0x${"ab".repeat(32)}`,
    fee: "1000",
    feeProof: {
      prefund: { amountRaw: "2000", logIndex: 1 },
      refund: { amountRaw: "1000", logIndex: 9 },
    },
    settlement: {
      blockNumber: "120",
      blockHash: `0x${"cd".repeat(32)}`,
      timestamp: Date.now(),
    },
    principalVerified: true,
    serviceTransferIndex: 4,
    serviceAmount: "100000001",
  });
  expect(
    (await s.t.run((ctx) => treasuryServiceReportRows(ctx, s.id)))[0],
  ).toMatchObject({ amountRaw: "100000001", amount: "100.000001" });
});
