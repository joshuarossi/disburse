import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { keccak256, toHex, type Address } from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestMembership,
  signIn,
  TEST_WALLETS,
} from "./factories";
import {
  conversionCall,
  conversionMarket,
  conversionPool,
  conversionQuoteHash,
  maximumConversionInput,
  CONVERSION_QUOTE_LIFETIME,
  type ConversionQuote,
} from "../../shared/conversion";
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
import { readTreasuryService } from "../lib/treasuryService";
import { treasuryServiceReportRows } from "../lib/treasuryServiceReports";
import { depositReportRows, outgoingReportRows } from "../lib/reportRows";
import { loadAccountingFact } from "../lib/accountingSource";
import { refreshReportIndex } from "./reportHelpers";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function setup() {
  const t = convexTest(schema),
    ids = await t.run(async (ctx) => {
      const ids = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      await ctx.db.patch(ids.safeId, { chainId: 8453 });
      return ids;
    });
  const { sessionToken } = await signIn(t, "admin"),
    market = conversionMarket(8453);
  const args = {
    orgId: ids.orgId,
    safeId: ids.safeId,
    kind: "conversion" as const,
    amount: "100000000",
    tokenIn: market.assets[0].address,
    slippageBps: 50,
    requestId: "qa-conversion-request-1",
    sessionToken,
  };
  const now = Date.now(),
    quote: ConversionQuote = {
      version: 1,
      provider: "uniswap_v3",
      kind: "conversion",
      chainId: 8453,
      account: ids.safeAddress as Address,
      reference: keccak256(toHex(`${ids.orgId}:${args.requestId}`)),
      tokenIn: args.tokenIn,
      tokenOut: market.assets[1].address,
      amount: args.amount,
      expectedInput: "100000000",
      maximumInput: maximumConversionInput("100000000", 50),
      pool: conversionPool(8453, 100),
      poolFee: 100,
      slippageBps: 50,
      priceImpactBps: 1,
      blockNumber: "100",
      createdAt: now,
      expiresAt: now + CONVERSION_QUOTE_LIFETIME,
    };
  const id = await t.mutation(internal.treasuryServices.save, {
      ...args,
      quote: JSON.stringify(quote),
    }),
    sourceArgs = { treasuryServiceId: id, sessionToken },
    source = await t.run((ctx) =>
      readTreasuryService(ctx, id, sessionToken, true),
    ),
    call = conversionCall(quote),
    until = Math.floor(quote.expiresAt / 1000);
  const request: CircleRequest = {
    chainId: 8453,
    safe: ids.safeAddress as Address,
    directCall: true,
    transaction: call,
    originalHash: conversionQuoteHash(quote),
    startBlock: "100",
    safeNonce: "0",
    validAfter: 0,
    validUntil: until,
    permit: { name: "USDC", version: "2", nonce: "0", amount: "2000000" },
    operation: {
      sender: ids.safeAddress as Address,
      nonce: 1n << 64n,
      callData: circleAccountCall(call.to, call.data, call.operation),
      callGasLimit: 300000n,
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
  const executionId = await t.mutation(internal.circlePayments.persist, {
    ...sourceArgs,
    snapshot: source.snapshot,
    record: encodeCircleRequest(request),
  });
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
    settlement: {
      blockNumber: "120",
      blockHash: `0x${"cd".repeat(32)}`,
      timestamp: now,
    },
    principalVerified: true,
    serviceTransferIndex: 4,
    serviceOutputIndex: 3,
    serviceAmount: "100015000",
  };
  return {
    t,
    ids,
    args,
    quote,
    id,
    sourceArgs,
    source,
    request,
    executionId,
    checkpoint,
  };
}
it("recovers one quote, binds currency direction and tolerance, and isolates provider history", async () => {
  const s = await setup();
  expect(
    (await s.t.query(internal.treasuryServices.preparation, s.args)).existing
      ?._id,
  ).toBe(s.id);
  for (const changed of [
    { tokenIn: s.quote.tokenOut },
    { slippageBps: 100 },
    { amount: "50000000" },
    { kind: "supply" as const },
  ])
    await expect(
      s.t.query(internal.treasuryServices.preparation, {
        ...s.args,
        ...changed,
      }),
    ).rejects.toThrow();
  const scope = {
    orgId: s.ids.orgId,
    sessionToken: s.args.sessionToken,
    environment: "production" as const,
    paginationOpts: { numItems: 10, cursor: null },
  };
  expect(
    (
      await s.t.query(api.treasuryServices.list, {
        ...scope,
        provider: "aave_v3",
      })
    ).page,
  ).toEqual([]);
  expect(
    (
      await s.t.query(api.treasuryServices.list, {
        ...scope,
        provider: "uniswap_v3",
      })
    ).page.map((r) => r._id),
  ).toEqual([s.id]);
  expect(s.source.principalUSDC).toBe(s.quote.maximumInput);
});
it("refuses ordinary initiators and other workspaces while preserving viewer history", async () => {
  const s = await setup();
  for (const role of ["initiator", "viewer"] as const) {
    const user = await signIn(s.t, role);
    await s.t.run((ctx) =>
      createTestMembership(ctx, s.ids.orgId, user.userId, { role }),
    );
    await expect(
      s.t.query(api.treasuryServices.get, {
        ...s.sourceArgs,
        sessionToken: user.sessionToken,
      }),
    ).resolves.toMatchObject({ _id: s.id });
    await expect(
      s.t.query(internal.treasuryServices.preparation, {
        ...s.args,
        sessionToken: user.sessionToken,
      }),
    ).rejects.toThrow();
    await expect(
      s.t.mutation(api.treasuryServices.stop, {
        ...s.sourceArgs,
        sessionToken: user.sessionToken,
      }),
    ).rejects.toThrow();
  }
  const outsider = await signIn(s.t, "approver");
  await expect(
    s.t.query(api.treasuryServices.get, {
      ...s.sourceArgs,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow();
});
it("keeps possibly signed conversions reserved and cannot stop or resend a claimed operation", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.executionId, {
      stage: "operation",
      operationApprovalStartedAt: Date.now(),
    }),
  );
  expect(await s.t.mutation(api.treasuryServices.stop, s.sourceArgs)).toEqual({
    cancelled: false,
    executionId: s.executionId,
  });
  await expect(
    s.t.query(internal.treasuryServices.context, s.sourceArgs),
  ).rejects.toThrow("no longer ready");
  const other = await setup();
  await other.t.run((ctx) =>
    ctx.db.patch(other.executionId, { stage: "ready" }),
  );
  await other.t.mutation(internal.circlePayments.claim, {
    executionId: other.executionId,
    sessionToken: other.args.sessionToken,
    revision: 0,
    userOpHash: circleOperationHash(8453, other.request.operation),
  });
  await expect(
    other.t.mutation(api.treasuryServices.stop, other.sourceArgs),
  ).rejects.toThrow("already be submitted");
  await expect(
    other.t.mutation(internal.circlePayments.claim, {
      executionId: other.executionId,
      sessionToken: other.args.sessionToken,
      revision: 0,
      userOpHash: circleOperationHash(8453, other.request.operation),
    }),
  ).rejects.toThrow();
});
it("does not complete without both canonical transfer identities and an in-cap actual debit", async () => {
  const s = await setup();
  for (const changed of [
    { principalVerified: false },
    { serviceOutputIndex: undefined },
    { serviceOutputIndex: 4 },
    { serviceAmount: "100500001" },
    { serviceAmount: "0" },
  ])
    await expect(
      s.t.mutation(internal.circlePayments.checkpoint, {
        ...s.checkpoint,
        ...changed,
      }),
    ).rejects.toThrow();
  expect(await s.t.query(api.treasuryServices.get, s.sourceArgs)).toMatchObject(
    { open: true, status: "approving" },
  );
  await s.t.mutation(internal.circlePayments.checkpoint, s.checkpoint);
  expect(await s.t.query(api.treasuryServices.get, s.sourceArgs)).toMatchObject(
    {
      open: false,
      status: "completed",
      settledAmount: "100015000",
      sourceTransferId: `e${"ab".repeat(32)}4`,
      outputTransferId: `e${"ab".repeat(32)}3`,
    },
  );
});
it("reports both actual currencies once and supplies conversion evidence to the book review", async () => {
  const s = await setup();
  await s.t.mutation(internal.circlePayments.checkpoint, s.checkpoint);
  const rows = await s.t.run((ctx) => treasuryServiceReportRows(ctx, s.id));
  expect(
    rows.map((r) => [r.direction, r.amountRaw, r.token, r.serviceKind]),
  ).toEqual([
    ["outflow", "100015000", "USDC", "conversion"],
    ["inflow", "100000000", "USDT", "conversion"],
  ]);
  await s.t.run(async (ctx) => {
    for (const row of rows) {
      const common = {
        orgId: s.ids.orgId,
        safeId: s.ids.safeId,
        chainId: 8453,
        txHash: s.checkpoint.txHash,
        transferId: row.transferId!,
        tokenAddress: row.tokenAddress!,
        tokenSymbol: row.token,
        decimals: 6,
        safeAddress: s.ids.safeAddress,
        source: "safe_tx_service" as const,
        amountRaw: row.amountRaw!,
        amount: row.amount,
        blockNumber: 120,
        timestamp: Date.now(),
        createdAt: Date.now(),
        fromAddress:
          row.direction === "inflow" ? s.quote.pool : s.ids.safeAddress,
        toAddress:
          row.direction === "inflow" ? s.ids.safeAddress : s.quote.pool,
      };
      if (row.direction === "inflow") {
        const id = await ctx.db.insert("deposits", common);
        expect(await depositReportRows(ctx, id)).toEqual([]);
      } else {
        const id = await ctx.db.insert("outgoingTransfers", common);
        expect(await outgoingReportRows(ctx, id)).toEqual([]);
      }
    }
  });
  await refreshReportIndex(s.t, s.ids.orgId);
  for (const row of rows) {
    const fact = await s.t.run((ctx) =>
      loadAccountingFact(ctx, s.ids.orgId, { kind: "activity", id: row.rowId }),
    );
    expect(fact).toMatchObject({
      conversionMovement: row.direction,
      treasuryServiceId: s.id,
      amountRaw: row.amountRaw,
      token: row.token,
    });
    expect(fact.lendingMovement).toBeUndefined();
  }
});
