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
import {
  circleAccountCall,
  circleConfiguration,
  circleOperationHash,
  circleSignature,
} from "../../shared/circleExecution";
import {
  decodeCircleRequest,
  encodeCircleRequest,
  type CircleRequest,
} from "../../shared/circleRequest";
import type { Address, Hex } from "viem";
import { verifyCircleSubmission } from "../lib/circleSubmission";
import { circleRpc } from "../../shared/circleTransport";
import { assertCircleReservation } from "../lib/circleSource";

vi.mock("../lib/circleSubmission", () => ({ verifyCircleSubmission: vi.fn() }));
vi.mock("../../shared/circleTransport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/circleTransport")>()),
  circleRpc: vi.fn(),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
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
    await ctx.db.patch(org.safeId, { chainId: 84532 });
    const beneficiary = await createTestBeneficiary(ctx, org.orgId, {
      walletAddress: TEST_WALLETS.approver,
    });
    const payment = await createTestDisbursement(
      ctx,
      org.orgId,
      org.safeId,
      beneficiary,
      org.userId,
      { status: "draft", amount: "0.1" },
    );
    await ctx.db.patch(payment, {
      scheduledAt: Date.now() + 3600_000,
      tokenAddress: circleConfiguration(84532).token,
    });
    return { ...org, beneficiary, payment };
  });
  const { sessionToken } = await signIn(t, "admin"),
    args = { disbursementId: ids.payment, sessionToken };
  const scheduleId = await t.mutation(api.paymentSchedules.create, args);
  const sourceArgs = { paymentScheduleId: scheduleId, sessionToken };
  const source = await t.query(internal.paymentSchedules.context, sourceArgs);
  const request: CircleRequest = {
    chainId: 84532,
    safe: ids.safeAddress as Address,
    originalHash: source.target.safeTxHash as Hex,
    directCall: true,
    transaction: source.call,
    startBlock: "100",
    safeNonce: "0",
    validAfter: source.schedule.validAfter,
    validUntil: source.schedule.validUntil,
    permit: { name: "USDC", version: "2", nonce: "0", amount: "2000000" },
    operation: {
      sender: ids.safeAddress as Address,
      nonce: 3n << 64n,
      callData: circleAccountCall(
        source.call.to,
        source.call.data,
        source.call.operation,
      ),
      callGasLimit: 200000n,
      verificationGasLimit: 900000n,
      preVerificationGas: 100000n,
      maxFeePerGas: 10000000n,
      maxPriorityFeePerGas: 1000000n,
      paymaster: circleConfiguration(84532).paymaster,
      paymasterVerificationGasLimit: 300000n,
      paymasterPostOpGasLimit: 80000n,
      paymasterData: "0x",
      signature: circleSignature(
        source.schedule.validAfter,
        source.schedule.validUntil,
        `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
      ),
    },
  };
  const executionId = await t.mutation(internal.circlePayments.persist, {
    ...sourceArgs,
    snapshot: source.snapshot,
    record: encodeCircleRequest(request),
  });
  const identity = { executionId, sessionToken };
  const ready = async () =>
    t.run(async (ctx) => {
      await ctx.db.patch(executionId, { stage: "ready", revision: 2 });
      await ctx.db.insert("circleSignatures", {
        executionId,
        stage: "operation",
        pathKey: ids.safeAddress.toLowerCase(),
        path: [ids.safeAddress.toLowerCase()],
        owner: TEST_WALLETS.admin,
        signature: `0x${"11".repeat(65)}`,
        digest: `0x${"22".repeat(32)}`,
        createdBy: ids.userId,
        createdAt: Date.now(),
      });
    });
  const arm = async () => {
    await ready();
    await t.mutation(internal.paymentSchedules.armSaved, {
      ...identity,
      revision: 2,
    });
  };
  const due = () => vi.setSystemTime(request.validAfter * 1000 + 1000);
  const claim = () =>
    t.mutation(internal.paymentSchedules.claim, {
      scheduleId,
      executionId,
      revision: 2,
      userOpHash: circleOperationHash(84532, request.operation),
    });
  return {
    t,
    ids,
    args,
    scheduleId,
    sourceArgs,
    source,
    request,
    executionId,
    identity,
    ready,
    arm,
    due,
    claim,
  };
}

it("prepares one immutable schedule without reserving the normal Safe nonce", async () => {
  const s = await setup();
  expect(await s.t.mutation(api.paymentSchedules.create, s.args)).toBe(
    s.scheduleId,
  );
  expect(await s.t.run((ctx) => ctx.db.get(s.ids.payment))).toMatchObject({
    paymentScheduleId: s.scheduleId,
    status: "draft",
  });
  expect(
    (await s.t.run((ctx) => ctx.db.get(s.ids.payment)))?.safeTxHash,
  ).toBeUndefined();
  expect(
    await s.t.run((ctx) => ctx.db.query("paymentSchedules").collect()),
  ).toHaveLength(1);
});

it("requires new dates to be unsigned and within the supported horizon", async () => {
  const s = await setup();
  await s.t.mutation(api.paymentSchedules.stop, s.args);
  await s.t.mutation(api.paymentSchedules.returnToDraft, s.args);
  await s.t.run((ctx) =>
    ctx.db.patch(s.ids.payment, { safeTxHash: `0x${"ab".repeat(32)}` }),
  );
  await expect(
    s.t.mutation(api.paymentSchedules.create, s.args),
  ).rejects.toThrow("unsigned");
  await s.t.run((ctx) =>
    ctx.db.patch(s.ids.payment, {
      safeTxHash: undefined,
      scheduledAt: Date.now() + 91 * 86400_000,
    }),
  );
  await expect(
    s.t.mutation(api.paymentSchedules.create, s.args),
  ).rejects.toThrow("90 days");
});

it("does not accept a changed signed payment window or call", async () => {
  const s = await setup();
  await expect(
    s.t.mutation(internal.circlePayments.persist, {
      ...s.sourceArgs,
      snapshot: s.source.snapshot,
      record: encodeCircleRequest({ ...s.request, validAfter: 0 }),
    }),
  ).rejects.toThrow("payment window");
  const changed = structuredClone(s.request);
  changed.transaction = { to: s.request.safe, data: "0x" };
  changed.operation.callData = circleAccountCall(
    changed.transaction.to,
    changed.transaction.data,
  );
  await expect(
    s.t.mutation(internal.circlePayments.persist, {
      ...s.sourceArgs,
      snapshot: s.source.snapshot,
      record: encodeCircleRequest(changed),
    }),
  ).rejects.toThrow("reviewed account instruction");
});

it("never dispatches before the signed date and claims only once at that date", async () => {
  const s = await setup();
  await s.arm();
  expect(
    await s.t.query(internal.paymentSchedules.forDispatch, {
      scheduleId: s.scheduleId,
    }),
  ).toBeNull();
  await expect(s.claim()).rejects.toThrow("payment window");
  s.due();
  const results = await Promise.allSettled([s.claim(), s.claim()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await s.t.run((ctx) => ctx.db.get(s.executionId)))?.stage).toBe(
    "submitting",
  );
});

it("checks the scheduling member and payment creator again before dispatch", async () => {
  const s = await setup();
  await s.arm();
  s.due();
  await s.t.run(async (ctx) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", s.ids.orgId).eq("userId", s.ids.userId),
      )
      .unique();
    await ctx.db.patch(membership!._id, { status: "removed" });
  });
  await expect(
    s.t.query(internal.paymentSchedules.forDispatch, {
      scheduleId: s.scheduleId,
    }),
  ).rejects.toThrow("payment access");
  await expect(s.claim()).rejects.toThrow("payment access");
});

it("a changed recipient prevents automatic execution and cannot be silently re-signed", async () => {
  const s = await setup();
  await s.arm();
  s.due();
  await s.t.run((ctx) =>
    ctx.db.patch(s.ids.beneficiary, { payoutVersion: 99 }),
  );
  await expect(s.claim()).rejects.toThrow("payout details");
  await s.t.action(internal.paymentSchedules.dispatch, {
    scheduleId: s.scheduleId,
  });
  expect(circleRpc).not.toHaveBeenCalled();
  expect((await s.t.run((ctx) => ctx.db.get(s.scheduleId)))?.status).toBe(
    "paused",
  );
});

it("lost provider responses keep the claimed request and never submit it twice", async () => {
  const s = await setup();
  await s.arm();
  s.due();
  vi.mocked(verifyCircleSubmission).mockResolvedValue(s.request);
  vi.mocked(circleRpc).mockRejectedValue(new Error("Response lost"));
  await s.t.action(internal.paymentSchedules.dispatch, {
    scheduleId: s.scheduleId,
  });
  await s.t.action(internal.paymentSchedules.dispatch, {
    scheduleId: s.scheduleId,
  });
  expect(circleRpc).toHaveBeenCalledTimes(1);
  expect((await s.t.run((ctx) => ctx.db.get(s.executionId)))?.stage).toBe(
    "submitting",
  );
  expect((await s.t.run((ctx) => ctx.db.get(s.scheduleId)))?.status).toBe(
    "processing",
  );
});

it("unsigned cancellation costs nothing, releases the draft, and blocks generic cancellation while reserved", async () => {
  const s = await setup();
  await expect(
    s.t.mutation(api.disbursements.updateStatus, {
      ...s.args,
      status: "cancelled",
    }),
  ).rejects.toThrow("scheduled payment review");
  await s.t.mutation(api.paymentSchedules.stop, s.args);
  expect((await s.t.run((ctx) => ctx.db.get(s.executionId)))?.stage).toBe(
    "cancelled",
  );
  expect((await s.t.run((ctx) => ctx.db.get(s.ids.payment)))?.status).toBe(
    "cancelled",
  );
  await s.t.mutation(api.paymentSchedules.returnToDraft, s.args);
  expect(
    (await s.t.run((ctx) => ctx.db.get(s.ids.payment)))?.paymentScheduleId,
  ).toBeUndefined();
});

it("a signed schedule is paused until the same nonce is cancelled on-chain", async () => {
  const s = await setup();
  await s.arm();
  await s.t.mutation(api.paymentSchedules.stop, s.args);
  const source = await s.t.query(internal.paymentSchedules.context, {
    scheduleCancellationId: s.scheduleId,
    sessionToken: s.args.sessionToken,
  });
  const request: CircleRequest = {
    ...s.request,
    originalHash: source.target.safeTxHash as Hex,
    transaction: source.call,
    validAfter: 0,
    validUntil: Math.floor(Date.now() / 1000) + 1800,
    operation: {
      ...s.request.operation,
      callData: circleAccountCall(source.call.to, source.call.data),
    },
  };
  const cancellationId = await s.t.mutation(internal.circlePayments.persist, {
    scheduleCancellationId: s.scheduleId,
    sessionToken: s.args.sessionToken,
    record: encodeCircleRequest(request),
    snapshot: source.snapshot,
  });
  await s.t.run((ctx) =>
    assertCircleReservation(ctx, s.ids.safeId, cancellationId),
  );
  await expect(
    s.t.mutation(api.paymentSchedules.returnToDraft, s.args),
  ).rejects.toThrow("original authorization");
  s.due();
  await expect(s.claim()).rejects.toThrow("paused or changed");
  expect((await s.t.run((ctx) => ctx.db.get(s.ids.payment)))?.status).toBe(
    "scheduled",
  );
  const cancellation = (await s.t.run((ctx) => ctx.db.get(cancellationId)))!;
  await s.t.mutation(internal.circlePayments.checkpoint, {
    executionId: cancellationId,
    revision: cancellation.revision,
    scanFrom: cancellation.scanFrom,
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
  });
  expect((await s.t.run((ctx) => ctx.db.get(s.ids.payment)))?.status).toBe(
    "cancelled",
  );
  expect((await s.t.run((ctx) => ctx.db.get(s.executionId)))?.stage).toBe(
    "cancelled",
  );
});

it("a claimed payment wins a cancellation race and cannot be relabelled cancelled", async () => {
  const s = await setup();
  await s.arm();
  s.due();
  await s.claim();
  await expect(s.t.mutation(api.paymentSchedules.stop, s.args)).rejects.toThrow(
    "being checked",
  );
});

it("does not mark a scheduled payment paid from a fee-only receipt", async () => {
  const s = await setup();
  await s.arm();
  s.due();
  await s.claim();
  await expect(
    s.t.mutation(internal.circlePayments.checkpoint, {
      executionId: s.executionId,
      revision: 2,
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
});

it("confirmed expiry releases only the original schedule and permits a draft correction", async () => {
  const s = await setup();
  await s.arm();
  vi.setSystemTime(s.request.validUntil * 1000 + 1000);
  await s.t.mutation(internal.circlePayments.checkpoint, {
    executionId: s.executionId,
    revision: 2,
    scanFrom: "100",
    nextBlock: "111",
    state: "expired",
  });
  expect((await s.t.run((ctx) => ctx.db.get(s.scheduleId)))?.status).toBe(
    "expired",
  );
  await s.t.mutation(api.paymentSchedules.returnToDraft, s.args);
  expect((await s.t.run((ctx) => ctx.db.get(s.ids.payment)))?.status).toBe(
    "draft",
  );
  expect(
    decodeCircleRequest(
      (await s.t.run((ctx) => ctx.db.get(s.executionId)))!.record,
    ).operation.nonce,
  ).toBe(s.request.operation.nonce);
});
