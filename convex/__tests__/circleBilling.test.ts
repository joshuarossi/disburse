import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type Hex,
} from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { createFullOrgSetup, signIn, TEST_WALLETS } from "./factories";
import { readCircleSource } from "../lib/circleSource";
import {
  circleAccountCall,
  circleConfiguration,
  circleOperationHash,
  circleSignature,
} from "../../shared/circleExecution";
import {
  circleChargeEvent,
  circleUserOperationEvent,
} from "../../shared/circleSettlement";
import {
  encodeCircleRequest,
  type CircleRequest,
} from "../../shared/circleRequest";

const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
}));
vi.mock("../lib/safeVerification", async (original) => ({
  ...(await original<typeof import("../lib/safeVerification")>()),
  getChainClient: () => rpc,
}));
const chainId = 84532,
  config = circleConfiguration(chainId),
  txHash = `0x${"cd".repeat(32)}` as Hex;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("DISBURSE_BENEFICIARY_CHAIN_ID", String(chainId));
  vi.stubEnv("DISBURSE_BENEFICIARY_ADDRESS", TEST_WALLETS.nonMember);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
async function setup(t = convexTest(schema)) {
  const org = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
  );
  await t.run((ctx) => ctx.db.patch(org.safeId, { chainId }));
  const { sessionToken, userId } = await signIn(t, "admin");
  if (userId !== org.userId) {
    await t.run((ctx) => ctx.db.patch(org.membershipId, { userId }));
    org.userId = userId;
  }
  const args = {
    orgId: org.orgId,
    sessionToken,
    requestId: crypto.randomUUID(),
    plan: "team" as const,
    chainId,
    safeId: org.safeId,
    tokenAddress: config.token,
    treasury: TEST_WALLETS.nonMember,
    amountRaw: "50000000",
  };
  const checkoutId = await t.mutation(api.billingCheckoutData.create, args);
  const source = { billingCheckoutId: checkoutId },
    identity = { ...source, sessionToken },
    data = await t.run((ctx) =>
      readCircleSource(ctx, source, sessionToken, true),
    );
  if (!data.directCall)
    throw new Error("Expected direct subscription instruction");
  const safe = org.safeAddress as Hex,
    until = Math.floor(Date.now() / 1000) + 1800;
  const request: CircleRequest = {
    chainId,
    safe,
    directCall: true,
    transaction: data.call,
    originalHash: data.target.safeTxHash as Hex,
    startBlock: "90",
    safeNonce: "0",
    validAfter: 0,
    validUntil: until,
    permit: { name: "USDC", version: "2", nonce: "0", amount: "500000" },
    operation: {
      sender: safe,
      nonce: 1n << 64n,
      callData: circleAccountCall(data.call.to, data.call.data),
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
        until,
        `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
      ),
    },
  };
  const persist = () =>
    t.mutation(internal.circlePayments.persist, {
      ...identity,
      record: encodeCircleRequest(request),
      snapshot: data.snapshot,
    });
  const read = () =>
    t.query(api.billingCheckoutData.get, {
      checkoutId,
      orgId: org.orgId,
      sessionToken,
    });
  return { t, org, args, request, checkoutId, identity, persist, read };
}
it("coordinates checkout across tabs and binds the account, terms and creation request", async () => {
  const s = await setup();
  expect(
    await s.t.mutation(api.billingCheckoutData.create, {
      ...s.args,
      requestId: crypto.randomUUID(),
    }),
  ).toBe(s.checkoutId);
  await expect(
    s.t.mutation(api.billingCheckoutData.create, { ...s.args, amountRaw: "1" }),
  ).rejects.toThrow("changed");
  const other = await s.t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
  );
  await s.t.run(async (ctx) => {
    await ctx.db.patch(other.safeId, {
      chainId,
      safeAddress: s.org.safeAddress,
    });
    await ctx.db.patch(other.membershipId, { userId: s.org.userId });
  });
  await expect(
    s.t.mutation(api.billingCheckoutData.create, {
      ...s.args,
      orgId: other.orgId,
      safeId: other.safeId,
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("another workspace");
});
it.each(["amount", "account", "archived", "role"] as const)(
  "rejects invalid subscription %s before any fee request",
  async (kind) => {
    const s = await setup();
    if (kind === "amount") s.request.transaction.data = "0x1234";
    if (kind === "account") s.request.transaction.to = TEST_WALLETS.viewer;
    s.request.operation.callData = circleAccountCall(
      s.request.transaction.to,
      s.request.transaction.data,
    );
    await s.t.run(async (ctx) => {
      if (kind === "archived")
        await ctx.db.patch(s.org.safeId, { isActive: false });
      if (kind === "role") {
        const membership = await ctx.db
          .query("orgMemberships")
          .withIndex("by_org_and_user", (q) =>
            q.eq("orgId", s.org.orgId).eq("userId", s.org.userId),
          )
          .unique();
        await ctx.db.patch(membership!._id, { role: "viewer" });
      }
    });
    await expect(s.persist()).rejects.toThrow();
    expect(
      await s.t.run((ctx) => ctx.db.query("circleExecutions").collect()),
    ).toHaveLength(0);
  },
);
it("retains signed requests through an unknown response and releases only after confirmed expiry", async () => {
  const s = await setup(),
    executionId = await s.persist(),
    scope = { checkoutId: s.checkoutId, sessionToken: s.args.sessionToken };
  await expect(
    s.t.mutation(api.billingCheckoutData.discard, scope),
  ).rejects.toThrow("fee authorization");
  await s.t.run((ctx) => ctx.db.patch(executionId, { stage: "ready" }));
  const claim = {
    executionId,
    sessionToken: scope.sessionToken,
    revision: 0,
    userOpHash: circleOperationHash(chainId, s.request.operation),
  };
  await s.t.mutation(internal.circlePayments.claim, claim);
  await expect(
    s.t.mutation(internal.circlePayments.claim, claim),
  ).rejects.toThrow("already submitted");
  expect(await s.read()).toMatchObject({
    status: "requested",
    circleExecutionId: executionId,
    active: true,
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("accountProposals").collect()),
  ).toHaveLength(0);
  await s.t.mutation(internal.circlePayments.checkpoint, {
    executionId,
    revision: 0,
    scanFrom: "90",
    nextBlock: "110",
    error: "Network unavailable",
  });
  expect((await s.read()).status).toBe("requested");
  await s.t.mutation(internal.circlePayments.checkpoint, {
    executionId,
    revision: 0,
    scanFrom: "110",
    nextBlock: "120",
    state: "expired",
  });
  expect(await s.read()).toMatchObject({ status: "prepared", active: true });
  await s.t.mutation(api.billingCheckoutData.discard, scope);
  expect((await s.read()).active).toBe(false);
});

const transfer = parseAbiItem(
  "event Transfer(address indexed from,address indexed to,uint256 value)",
);
function receiptFor(
  s: Awaited<ReturnType<typeof setup>>,
  variant: "correct" | "outside" | "short" | "failed",
) {
  const hash = circleOperationHash(chainId, s.request.operation);
  const event = (
    logIndex: number,
    address: string,
    abi: any,
    args: any,
    types: any[],
    values: any[],
  ) => ({
    address,
    topics: encodeEventTopics({ abi: [abi], eventName: abi.name, args }),
    data: encodeAbiParameters(types, values),
    logIndex,
    removed: false,
    blockNumber: 100n,
    blockHash: txHash,
    transactionHash: txHash,
  });
  const tokenTransfer = (
    index: number,
    from: string,
    to: string,
    amount: bigint,
  ) =>
    event(
      index,
      config.token,
      transfer,
      { from, to },
      [{ type: "uint256" }],
      [amount],
    );
  const logs = [
    tokenTransfer(1, s.org.safeAddress, config.paymaster, 500000n),
    event(
      5,
      config.entryPoint,
      parseAbiItem("event BeforeExecution()"),
      {},
      [],
      [],
    ),
    tokenTransfer(
      variant === "outside" ? 4 : 6,
      s.org.safeAddress,
      TEST_WALLETS.nonMember,
      variant === "short" ? 49000000n : 50000000n,
    ),
    tokenTransfer(8, config.paymaster, s.org.safeAddress, 480000n),
    event(
      9,
      config.paymaster,
      circleChargeEvent,
      { token: config.token, sender: s.org.safeAddress },
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [hash, 1000n, 20000n, 2000n],
    ),
    event(
      10,
      config.entryPoint,
      circleUserOperationEvent,
      {
        userOpHash: hash,
        sender: s.org.safeAddress,
        paymaster: config.paymaster,
      },
      [
        { type: "uint256" },
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [s.request.operation.nonce, variant !== "failed", 100000n, 1000n],
    ),
  ];
  return {
    status: "success",
    blockNumber: 100n,
    blockHash: txHash,
    transactionHash: txHash,
    logs: logs.sort((a, b) => a.logIndex - b.logIndex),
  };
}
it.each(["correct", "outside", "short", "failed"] as const)(
  "verifies the subscription transfer inside its UserOp (%s)",
  async (variant) => {
    const s = await setup(),
      executionId = await s.persist();
    await s.t.run(async (ctx) => {
      await ctx.db.patch(executionId, {
        stage: "confirmed",
        open: false,
        txHash,
        settlement: {
          blockNumber: "100",
          blockHash: txHash,
          timestamp: Date.now(),
        },
      });
      await ctx.db.patch(s.checkoutId, {
        status: "requested",
        circleExecutionId: executionId,
      });
    });
    rpc.getChainId.mockResolvedValue(chainId);
    rpc.getBlockNumber.mockResolvedValue(103n);
    rpc.getTransactionReceipt.mockResolvedValue(receiptFor(s, variant));
    rpc.getBlock.mockResolvedValue({
      number: 100n,
      hash: txHash,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    });
    const work = () =>
      s.t.action(internal.circleBilling.settle, { checkoutId: s.checkoutId });
    if (variant !== "correct") {
      await expect(work()).rejects.toThrow();
      expect((await s.read()).status).toBe("requested");
      return;
    }
    expect(await work()).toBe("applied");
    const first = (await s.t.run((ctx) => ctx.db.get(s.org.billingId)))!
      .paidThroughAt;
    expect(await work()).toBe("applied");
    expect(
      (await s.t.run((ctx) => ctx.db.get(s.org.billingId)))!.paidThroughAt,
    ).toBe(first);
    expect(
      await s.t.run((ctx) => ctx.db.query("billingPayments").collect()),
    ).toMatchObject([
      { transferId: `${txHash}:6`, redeemedAt: expect.any(Number) },
    ]);
  },
);
it("applies two companies’ transfers in one bundle independently without reusing either transfer", async () => {
  const a = await setup(),
    b = await setup(a.t);
  for (const [s, index] of [
    [a, 6],
    [b, 16],
  ] as const) {
    await s.t.run((ctx) => ctx.db.patch(s.checkoutId, { status: "requested" }));
    const proof = {
      checkoutId: s.checkoutId,
      orgId: s.org.orgId,
      txHash,
      chainId,
      plan: "team" as const,
      tokenAddress: config.token,
      amountRaw: "50000000",
      transferId: `${txHash}:${index}`,
    };
    await s.t.mutation(internal.billing.recordVerifiedPayment, proof);
    await s.t.mutation(internal.billing.redeemCheckout, {
      checkoutId: s.checkoutId,
    });
    expect((await s.read()).status).toBe("applied");
  }
  await expect(
    a.t.mutation(internal.billing.recordVerifiedPayment, {
      checkoutId: b.checkoutId,
      orgId: b.org.orgId,
      txHash,
      chainId,
      plan: "team",
      tokenAddress: config.token,
      amountRaw: "50000000",
      transferId: `${txHash}:6`,
    }),
  ).rejects.toThrow("already been used");
  expect(
    await a.t.run((ctx) => ctx.db.query("billingPayments").collect()),
  ).toHaveLength(2);
});
