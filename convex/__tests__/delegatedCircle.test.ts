import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, type Address, type Hex } from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  createTestSafe,
  signIn,
  TEST_WALLETS,
} from "./factories";
import { CURRENT_ALLOWANCE } from "../../shared/allowanceDeployments";
import {
  type DelegatedIntent,
  allowanceTransferAbi,
} from "../../shared/allowanceTransfer";
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
import { readCircleSource, assertCircleReservation } from "../lib/circleSource";
import { grantAccess } from "../spendingPolicyData";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    await ctx.db.patch(org.safeId, { chainId: 8453 });
    const feeAddress = TEST_WALLETS.nonMember.toLowerCase();
    const feeSafeId = await createTestSafe(ctx, org.orgId, {
      chainId: 8453,
      safeAddress: feeAddress,
    });
    await ctx.db.patch(feeSafeId, {
      assignedUserId: org.userId,
      owners: [TEST_WALLETS.admin],
      threshold: 1,
    });
    const recipient = await createTestBeneficiary(ctx, org.orgId, {
      walletAddress: TEST_WALLETS.viewer,
    });
    const paymentId = await createTestDisbursement(
      ctx,
      org.orgId,
      org.safeId,
      recipient,
      org.userId,
      { token: "USDC", amount: "0.1", status: "draft" },
    );
    return { ...org, feeSafeId, feeAddress, recipient, paymentId };
  });
  const { sessionToken } = await signIn(t, "admin");
  const args = { disbursementId: ids.paymentId, sessionToken };
  const intent: DelegatedIntent = {
    chainId: 8453,
    safeAddress: ids.safeAddress,
    tokenAddress: circleConfiguration(8453).token,
    module: CURRENT_ALLOWANCE.address,
    delegate: ids.feeAddress,
    nonce: 1,
    hash: `0x${"12".repeat(32)}`,
    signature: "0x",
    recipientAddress: TEST_WALLETS.viewer,
    amount: "0.1",
  };
  const claim = (next = intent) =>
    t.mutation(internal.delegatedPayments.claim, {
      ...args,
      intent: next,
      feeSafeId: ids.feeSafeId,
      relayFromBlock: "100",
    });
  await claim();
  const sourceArgs = { delegatedDisbursementId: ids.paymentId, sessionToken };
  const source = await t.run((ctx) =>
    readCircleSource(ctx, sourceArgs, sessionToken, true),
  );
  if (!source.directCall) throw new Error("Expected account call");
  const until = Math.floor(Date.now() / 1000) + 1800;
  const request: CircleRequest = {
    chainId: 8453,
    safe: ids.feeAddress as Address,
    directCall: true,
    transaction: source.call,
    originalHash: source.target.safeTxHash as Hex,
    startBlock: "100",
    safeNonce: "0",
    validAfter: 0,
    validUntil: until,
    permit: { name: "USDC", version: "2", nonce: "0", amount: "2000000" },
    operation: {
      sender: ids.feeAddress as Address,
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
  const save = () =>
    t.mutation(internal.circlePayments.persist, {
      ...sourceArgs,
      snapshot: source.snapshot,
      record: encodeCircleRequest(request),
    });
  const ready = (
    id: ReturnType<typeof save> extends Promise<infer I> ? I : never,
  ) => t.run((ctx) => ctx.db.patch(id, { stage: "ready" }));
  return {
    t,
    ids,
    args,
    intent,
    claim,
    request,
    source,
    sourceArgs,
    save,
    ready,
  };
}

it("binds the published allowance caller to the assigned account and keeps company principal separate from USDC gas", async () => {
  const s = await setup();
  const p = await s.t.run((ctx) => ctx.db.get(s.ids.paymentId));
  expect(p).toMatchObject({
    status: "relaying",
    allowanceFeeSafeId: s.ids.feeSafeId,
    allowanceExecution: { signature: "0x", delegate: s.ids.feeAddress },
  });
  expect(p?.nativeExecution).toBeUndefined();
  expect(p?.executionFee).toBeUndefined();
  expect(s.source).toMatchObject({
    safe: { _id: s.ids.feeSafeId },
    principalUSDC: "0",
  });
  if (!s.source.directCall) throw new Error("Expected account call");
  const decoded = decodeFunctionData({
    abi: allowanceTransferAbi,
    data: s.source.call.data,
  });
  expect(decoded.functionName).toBe("executeAllowanceTransfer");
  expect(
    decoded.args?.map((v) => (typeof v === "string" ? v.toLowerCase() : v)),
  ).toEqual([
    s.ids.safeAddress,
    s.intent.tokenAddress.toLowerCase(),
    TEST_WALLETS.viewer.toLowerCase(),
    100000n,
    `0x${"0".repeat(40)}`,
    0n,
    s.ids.feeAddress,
    "0x",
  ]);
  await expect(
    s.t.run((ctx) =>
      grantAccess(ctx, s.ids.safeId, s.ids.feeAddress, s.ids.userId),
    ),
  ).resolves.toBeNull();
});

it("refuses a reusable wallet signature, a different assigned account and a cross-workspace fee source", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.ids.paymentId, {
      status: "draft",
      allowanceExecution: undefined,
      allowanceFeeSafeId: undefined,
    }),
  );
  await expect(
    s.claim({ ...s.intent, signature: `0x${"11".repeat(65)}` }),
  ).rejects.toThrow("exact authorization");
  await s.t.run((ctx) =>
    ctx.db.patch(s.ids.feeSafeId, { assignedUserId: undefined }),
  );
  await expect(s.claim()).rejects.toThrow("assigned payment account");
  const other = await s.t.run((ctx) => createFullOrgSetup(ctx));
  await s.t.run((ctx) => ctx.db.patch(s.ids.feeSafeId, { orgId: other.orgId }));
  await expect(s.claim()).rejects.toThrow("this workspace");
});

it("frees an unsigned contract authorization without spending gas and allows the same module nonce to be used again", async () => {
  const s = await setup(),
    executionId = await s.save();
  expect(await s.t.mutation(api.delegatedCircle.stop, s.args)).toEqual({
    cancelExecutionId: null,
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("delegationReservations").collect()),
  ).toHaveLength(0);
  expect(await s.t.run((ctx) => ctx.db.get(executionId))).toMatchObject({
    stage: "cancelled",
    open: false,
  });
  expect(await s.t.run((ctx) => ctx.db.get(s.ids.paymentId))).toMatchObject({
    status: "cancelled",
  });
  const second = await s.t.run((ctx) =>
    createTestDisbursement(
      ctx,
      s.ids.orgId,
      s.ids.safeId,
      s.ids.recipient,
      s.ids.userId,
      { token: "USDC", amount: "0.1", status: "draft" },
    ),
  );
  await s.t.mutation(internal.delegatedPayments.claim, {
    ...s.args,
    disbursementId: second,
    feeSafeId: s.ids.feeSafeId,
    intent: s.intent,
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("delegationReservations").collect()),
  ).toHaveLength(1);
});

it.each(["confirmed", "failed"] as const)(
  "only releases a signed contract payment after its cancellation consumes the same nonce (%s)",
  async (state) => {
    const s = await setup(),
      executionId = await s.save();
    await s.ready(executionId);
    expect(await s.t.mutation(api.delegatedCircle.stop, s.args)).toEqual({
      cancelExecutionId: executionId,
    });
    expect(
      await s.t.run((ctx) => ctx.db.query("delegationReservations").collect()),
    ).toHaveLength(1);
    await expect(
      s.t.mutation(internal.circlePayments.claim, {
        executionId,
        sessionToken: s.args.sessionToken,
        revision: 0,
        userOpHash: circleOperationHash(8453, s.request.operation),
      }),
    ).rejects.toThrow("original allowance payment");
    const identity = {
      cancelExecutionId: executionId,
      sessionToken: s.args.sessionToken,
    };
    const source = await s.t.run((ctx) =>
      readCircleSource(ctx, identity, s.args.sessionToken, true),
    );
    if (!source.directCall) throw new Error("Expected cancellation call");
    const request = {
      ...s.request,
      transaction: source.call,
      originalHash: source.target.safeTxHash as Hex,
      operation: {
        ...s.request.operation,
        callData: circleAccountCall(s.ids.feeAddress as Address, "0x"),
      },
    };
    const persist = (next = request) =>
      s.t.mutation(internal.circlePayments.persist, {
        ...identity,
        snapshot: source.snapshot,
        record: encodeCircleRequest(next),
      });
    await expect(
      persist({
        ...request,
        operation: { ...request.operation, nonce: 2n << 64n },
      }),
    ).rejects.toThrow("original sequence");
    const cancellationId = await persist();
    await s.t.run((ctx) =>
      assertCircleReservation(ctx, s.ids.feeSafeId, cancellationId),
    );
    await s.t.mutation(internal.circlePayments.checkpoint, {
      executionId: cancellationId,
      revision: 0,
      scanFrom: "100",
      nextBlock: "111",
      state,
      txHash: `0x${"ef".repeat(32)}`,
      fee: "10000",
      feeProof: { prefund: { logIndex: 1, amountRaw: "10000" } },
      settlement: {
        blockNumber: "110",
        blockHash: `0x${"aa".repeat(32)}`,
        timestamp: Date.now(),
      },
    });
    expect(await s.t.run((ctx) => ctx.db.get(executionId))).toMatchObject({
      stage: "cancelled",
      open: false,
    });
    expect(await s.t.run((ctx) => ctx.db.get(s.ids.paymentId))).toMatchObject({
      status: "cancelled",
    });
    expect(
      await s.t.run((ctx) => ctx.db.query("delegationReservations").collect()),
    ).toHaveLength(0);
  },
);

it("never treats a fee-only receipt as a paid invoice", async () => {
  const s = await setup(),
    executionId = await s.save();
  await s.ready(executionId);
  await expect(
    s.t.mutation(internal.circlePayments.checkpoint, {
      executionId,
      revision: 0,
      scanFrom: "100",
      nextBlock: "111",
      state: "confirmed",
      txHash: `0x${"ef".repeat(32)}`,
      fee: "10000",
      feeProof: { prefund: { logIndex: 1, amountRaw: "10000" } },
      settlement: {
        blockNumber: "110",
        blockHash: `0x${"aa".repeat(32)}`,
        timestamp: Date.now(),
      },
    }),
  ).rejects.toThrow("principal transfers");
  expect(await s.t.run((ctx) => ctx.db.get(s.ids.paymentId))).toMatchObject({
    status: "relaying",
  });
  expect(await s.t.run((ctx) => ctx.db.get(executionId))).toMatchObject({
    open: true,
  });
});

it("retains the original reservation after a declined approval or failed execution, and disallows cancellation during an uncertain submission", async () => {
  const s = await setup(),
    executionId = await s.save();
  await s.ready(executionId);
  await s.t.mutation(internal.circlePayments.claim, {
    executionId,
    sessionToken: s.args.sessionToken,
    revision: 0,
    userOpHash: circleOperationHash(8453, s.request.operation),
  });
  await expect(s.t.mutation(api.delegatedCircle.stop, s.args)).rejects.toThrow(
    "original payment settlement",
  );
  await expect(
    s.t.mutation(internal.circlePayments.claim, {
      executionId,
      sessionToken: s.args.sessionToken,
      revision: 0,
      userOpHash: circleOperationHash(8453, s.request.operation),
    }),
  ).rejects.toThrow();
  await s.t.mutation(internal.circlePayments.checkpoint, {
    executionId,
    revision: 0,
    scanFrom: "100",
    nextBlock: "111",
    state: "failed",
    txHash: `0x${"ef".repeat(32)}`,
    fee: "10000",
    feeProof: { prefund: { logIndex: 1, amountRaw: "10000" } },
    settlement: {
      blockNumber: "110",
      blockHash: `0x${"aa".repeat(32)}`,
      timestamp: Date.now(),
    },
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("delegationReservations").collect()),
  ).toHaveLength(1);
  expect(await s.t.run((ctx) => ctx.db.get(s.ids.paymentId))).toMatchObject({
    status: "relaying",
    allowanceExecution: s.intent,
  });
  expect(await s.t.mutation(api.delegatedCircle.stop, s.args)).toEqual({
    cancelExecutionId: null,
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("delegationReservations").collect()),
  ).toHaveLength(0);
});

it("blocks changed recipient instructions before any submission but preserves cancellation", async () => {
  const s = await setup(),
    executionId = await s.save();
  await s.ready(executionId);
  await s.t.run((ctx) => ctx.db.patch(s.ids.recipient, { payoutVersion: 2 }));
  await expect(
    s.t.run((ctx) =>
      readCircleSource(ctx, s.sourceArgs, s.args.sessionToken, true),
    ),
  ).rejects.toThrow();
  await s.t.mutation(api.delegatedCircle.stop, s.args);
  await expect(
    s.t.run((ctx) =>
      readCircleSource(
        ctx,
        { cancelExecutionId: executionId },
        s.args.sessionToken,
        true,
      ),
    ),
  ).resolves.toMatchObject({ principalUSDC: "0" });
});

it("keeps a possibly signed operation reserved when its wallet response never reaches signature storage", async () => {
  const s = await setup(),
    executionId = await s.save();
  await s.t.run((ctx) => ctx.db.patch(executionId, { stage: "operation" }));
  await s.t.mutation(api.circlePayments.beginApproval, {
    executionId,
    sessionToken: s.args.sessionToken,
    revision: 0,
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("circleSignatures").collect()),
  ).toHaveLength(0);
  expect(await s.t.mutation(api.delegatedCircle.stop, s.args)).toEqual({
    cancelExecutionId: executionId,
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("delegationReservations").collect()),
  ).toHaveLength(1);
  await expect(
    s.t.mutation(api.circlePayments.beginApproval, {
      executionId,
      sessionToken: s.args.sessionToken,
      revision: 0,
    }),
  ).rejects.toThrow("original allowance payment");
});
