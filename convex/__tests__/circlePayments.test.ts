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
import { verificationContext } from "../disbursements";
import type { Hex } from "viem";
import { assertCircleReservation } from "../lib/circleSource";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const hash = `0x${"ab".repeat(32)}`;
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
      { status: "proposed", safeTxHash: hash, amount: "0.1" },
    );
    await ctx.db.patch(payment, { chainId: 84532 });
    return { ...org, payment };
  });
  const { sessionToken } = await signIn(t, "admin"),
    safe = ids.safeAddress as Hex,
    config = circleConfiguration(84532);
  const request: CircleRequest = {
    chainId: 84532,
    safe,
    originalHash: hash as Hex,
    transaction: { to: safe, data: "0x1234" },
    startBlock: "100",
    safeNonce: "0",
    validAfter: 0,
    validUntil: Math.floor(Date.now() / 1000) + 1800,
    permit: { name: "USDC", version: "2", nonce: "0", amount: "500000" },
    operation: {
      sender: safe,
      nonce: 1n << 64n,
      callData: circleAccountCall(safe, "0x1234"),
      callGasLimit: 200000n,
      verificationGasLimit: 900000n,
      preVerificationGas: 100000n,
      maxFeePerGas: 10000000n,
      maxPriorityFeePerGas: 1000000n,
      paymaster: config.paymaster,
      paymasterVerificationGasLimit: 300000n,
      paymasterPostOpGasLimit: 80000n,
      paymasterData: "0x",
      signature: circleSignature(
        0,
        Math.floor(Date.now() / 1000) + 1800,
        `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
      ),
    },
  };
  const args = { disbursementId: ids.payment, sessionToken };
  const expected = await t.run((ctx) => verificationContext(ctx, args));
  const executionId = await t.mutation(internal.circlePayments.persist, {
    ...args,
    snapshot: expected.snapshot,
    record: encodeCircleRequest(request),
  });
  return {
    t,
    ids,
    args,
    request,
    expected,
    executionId,
    identity: { executionId, sessionToken },
  };
}
it("returns the original fee request after a lost preparation response", async () => {
  const s = await setup();
  expect(
    await s.t.mutation(internal.circlePayments.persist, {
      ...s.args,
      snapshot: s.expected.snapshot,
      record: encodeCircleRequest(s.request),
    }),
  ).toBe(s.executionId);
  expect(
    await s.t.run((ctx) => ctx.db.query("circleExecutions").collect()),
  ).toHaveLength(1);
});

async function anotherPayment(
  s: Awaited<ReturnType<typeof setup>>,
  key: bigint,
  amount = "500000",
) {
  const payment = await s.t.run(async (ctx) => {
    const original = (await ctx.db.get(s.ids.payment))!;
    return createTestDisbursement(
      ctx,
      s.ids.orgId,
      s.ids.safeId,
      original.beneficiaryId!,
      s.ids.userId,
      { status: "proposed", safeTxHash: `0x${"cd".repeat(32)}`, amount: "0.1" },
    );
  });
  const args = { disbursementId: payment, sessionToken: s.args.sessionToken };
  const expected = await s.t.run((ctx) => verificationContext(ctx, args));
  const request = {
    ...s.request,
    originalHash: `0x${"cd".repeat(32)}` as Hex,
    permit: { ...s.request.permit, amount },
    operation: { ...s.request.operation, nonce: key << 64n },
  };
  const save = () =>
    s.t.mutation(internal.circlePayments.persist, {
      ...args,
      snapshot: expected.snapshot,
      record: encodeCircleRequest(request),
    });
  return { args, request, save };
}

it("keeps independent execution sequences open with the same approved fee limit", async () => {
  const s = await setup(),
    next = await anotherPayment(s, 2n);
  expect(
    await s.t.query(internal.circlePayments.previous, next.args),
  ).toMatchObject({ open: null, queueFeeLimit: "500000" });
  const id = await next.save();
  await s.t.run(async (ctx) => {
    await assertCircleReservation(ctx, s.ids.safeId, s.executionId);
    await assertCircleReservation(ctx, s.ids.safeId, id);
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("circleExecutions").collect()),
  ).toHaveLength(2);
  await expect(
    s.t.run((ctx) => assertCircleReservation(ctx, s.ids.safeId)),
  ).rejects.toThrow("saved USDC fee request");
});

it.each(["400000", "600000"])(
  "refuses a concurrent fee limit of %s that would change an earlier authorization",
  async (amount) => {
    const s = await setup(),
      next = await anotherPayment(s, 2n, amount);
    await expect(next.save()).rejects.toThrow("fixed this account");
    expect(
      await s.t.run((ctx) => ctx.db.query("circleExecutions").collect()),
    ).toHaveLength(1);
  },
);

it("refuses duplicate nonce sequences for different instructions", async () => {
  const s = await setup(),
    next = await anotherPayment(s, 1n);
  await expect(next.save()).rejects.toThrow("sequence is already reserved");
});

it("does not place new work beside an unresolved legacy request", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.executionId, {
      concurrentFees: undefined,
      record: encodeCircleRequest({
        ...s.request,
        operation: { ...s.request.operation, nonce: 0n },
      }),
    }),
  );
  const next = await anotherPayment(s, 2n);
  await expect(next.save()).rejects.toThrow("earlier fee request");
  await expect(
    s.t.query(internal.circlePayments.previous, next.args),
  ).rejects.toThrow("earlier fee request");
});

it("closes the concurrent preparation race before either changed limit can be approved", async () => {
  const s = await setup(),
    first = await anotherPayment(s, 2n),
    second = await anotherPayment(s, 3n, "900000");
  const results = await Promise.allSettled([first.save(), second.save()]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  const queued = await s.t.run((ctx) =>
    ctx.db.query("circleExecutions").collect(),
  );
  expect(queued).toHaveLength(2);
  expect(
    queued.every(
      (e) => decodeCircleRequest(e.record).permit.amount === "500000",
    ),
  ).toBe(true);
});
it("accepts a retry of the original proposal status without replacing its hash or submission metadata", async () => {
  const s = await setup(),
    args = { ...s.args, status: "proposed" as const, safeTxHash: hash };
  expect(await s.t.mutation(api.disbursements.updateStatus, args)).toEqual({
    success: true,
  });
  await expect(
    s.t.mutation(api.disbursements.updateStatus, {
      ...args,
      safeTxHash: `0x${"cd".repeat(32)}`,
    }),
  ).rejects.toThrow("cannot be replaced");
  await expect(
    s.t.mutation(api.disbursements.updateStatus, {
      ...args,
      relayTaskId: "different-request",
    }),
  ).rejects.toThrow("Invalid status transition");
  expect(await s.t.query(api.circlePayments.get, s.args)).toMatchObject({
    _id: s.executionId,
    stage: "fee",
  });
});
it("reserves the USDC permit across organizations linking the same underlying account", async () => {
  const s = await setup();
  const second = await s.t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    await ctx.db.patch(org.safeId, {
      chainId: 84532,
      safeAddress: s.ids.safeAddress,
    });
    const member = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", org.orgId).eq("userId", org.userId),
      )
      .unique();
    await ctx.db.patch(member!._id, { userId: s.ids.userId });
    const recipient = await createTestBeneficiary(ctx, org.orgId);
    const payment = await createTestDisbursement(
      ctx,
      org.orgId,
      org.safeId,
      recipient,
      org.userId,
      { status: "proposed", safeTxHash: hash },
    );
    await ctx.db.patch(payment, { chainId: 84532 });
    return { disbursementId: payment, sessionToken: s.args.sessionToken };
  });
  await expect(
    s.t.query(internal.circlePayments.previous, second),
  ).rejects.toThrow("open fee authorization");
});
it("blocks the native send route while this account has a saved USDC fee request", async () => {
  const s = await setup();
  await expect(
    s.t.mutation(internal.disbursements.claimNativeExecution, {
      ...s.args,
      safeTxHash: hash,
      searchFromBlock: "100",
      attemptId: "native",
    }),
  ).rejects.toThrow("saved USDC fee request");
});
it("never claims a fee-only authorization as a complete execution", async () => {
  const s = await setup();
  await expect(
    s.t.mutation(internal.circlePayments.claim, {
      ...s.identity,
      revision: 0,
      userOpHash: circleOperationHash(84532, s.request.operation),
    }),
  ).rejects.toThrow("changed");
  expect((await s.t.run((ctx) => ctx.db.get(s.ids.payment)))?.status).toBe(
    "proposed",
  );
});
it("validates the current stage through the public approval action without forwarding signature fields into its identity query", async () => {
  const s = await setup();
  await expect(
    s.t.action(api.circlePayments.approve, {
      ...s.identity,
      revision: 0,
      stage: "operation",
      path: [s.ids.safeAddress],
      signature: "0x",
    }),
  ).rejects.toThrow("current approval step");
});
it("rejects a duplicate submission atomically and preserves the original hash", async () => {
  const s = await setup(),
    userOpHash = circleOperationHash(84532, s.request.operation);
  await s.t.run((ctx) => ctx.db.patch(s.executionId, { stage: "ready" }));
  await s.t.mutation(internal.circlePayments.claim, {
    ...s.identity,
    revision: 0,
    userOpHash,
  });
  await expect(
    s.t.mutation(internal.circlePayments.claim, {
      ...s.identity,
      revision: 0,
      userOpHash,
    }),
  ).rejects.toThrow("already submitted");
  expect(await s.t.run((ctx) => ctx.db.get(s.executionId))).toMatchObject({
    stage: "submitting",
    userOpHash,
    open: true,
  });
});
it("does not accept another signature after the member loses payment permissions", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    const member = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", s.ids.orgId).eq("userId", s.ids.userId),
      )
      .unique();
    await ctx.db.patch(member!._id, { role: "viewer" });
  });
  await expect(
    s.t.mutation(internal.circlePayments.saveSignature, {
      ...s.identity,
      stage: "fee",
      revision: 0,
      path: [s.ids.safeAddress],
      signature: "0x",
      digest: hash,
    }),
  ).rejects.toThrow("permissions");
});
it("preserves saved requests when a network outage provides no evidence", async () => {
  const s = await setup();
  await s.t.mutation(internal.circlePayments.checkpoint, {
    executionId: s.executionId,
    revision: 0,
    scanFrom: "100",
    nextBlock: "100",
    error: "Network unavailable",
  });
  expect(await s.t.run((ctx) => ctx.db.get(s.executionId))).toMatchObject({
    open: true,
    stage: "fee",
    record: encodeCircleRequest(s.request),
  });
});
it("does not let an obsolete recovery result overwrite a newer approval stage", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.executionId, { revision: 1, stage: "operation" }),
  );
  await s.t.mutation(internal.circlePayments.checkpoint, {
    executionId: s.executionId,
    revision: 0,
    scanFrom: "100",
    nextBlock: "200",
    state: "expired",
  });
  expect(await s.t.run((ctx) => ctx.db.get(s.executionId))).toMatchObject({
    open: true,
    stage: "operation",
    scanFrom: "100",
  });
});
it("cannot lower a still-unused permit cap after its execution window expires", async () => {
  const s = await setup();
  await s.t.mutation(internal.circlePayments.checkpoint, {
    executionId: s.executionId,
    revision: 0,
    scanFrom: "100",
    nextBlock: "200",
    state: "expired",
    originalNonceAvailable: true,
  });
  s.request.permit.amount = "100000";
  await expect(
    s.t.mutation(internal.circlePayments.persist, {
      ...s.args,
      snapshot: s.expected.snapshot,
      record: encodeCircleRequest(s.request),
    }),
  ).rejects.toThrow("original limit");
});
it.each(["failed", "expired"] as const)(
  "releases a %s fee attempt only when its original Safe transaction nonce remains available",
  async (state) => {
    for (const originalNonceAvailable of [true, false]) {
      const s = await setup();
      await s.t.run((ctx) => ctx.db.patch(s.executionId, { stage: "ready" }));
      await s.t.mutation(internal.circlePayments.claim, {
        ...s.identity,
        revision: 0,
        userOpHash: circleOperationHash(84532, s.request.operation),
      });
      await s.t.mutation(internal.circlePayments.checkpoint, {
        executionId: s.executionId,
        revision: 0,
        scanFrom: "100",
        nextBlock: "200",
        state,
        originalNonceAvailable,
        ...(state === "failed"
          ? {
              txHash: hash,
              fee: "5000",
              feeProof: {
                prefund: { logIndex: 1, amountRaw: "8000" },
                refund: { logIndex: 2, amountRaw: "3000" },
              },
              settlement: {
                blockNumber: "199",
                blockHash: hash,
                timestamp: Date.now(),
              },
            }
          : {}),
      });
      expect((await s.t.run((ctx) => ctx.db.get(s.ids.payment)))?.status).toBe(
        originalNonceAvailable ? "proposed" : "relaying",
      );
      const execution = await s.t.run((ctx) => ctx.db.get(s.executionId));
      expect(execution).toMatchObject({ open: false, stage: state });
      expect(decodeCircleRequest(execution!.record).originalHash).toBe(hash);
    }
  },
);
it("refuses a claimed success without the original receipt and fee evidence", async () => {
  const s = await setup();
  await expect(
    s.t.mutation(internal.circlePayments.checkpoint, {
      executionId: s.executionId,
      revision: 0,
      scanFrom: "100",
      nextBlock: "200",
      state: "confirmed",
    }),
  ).rejects.toThrow("incomplete");
  expect((await s.t.run((ctx) => ctx.db.get(s.executionId)))?.open).toBe(true);
});
