import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { CHAIN_TOKENS } from "../../shared/chains";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  signIn,
  TEST_WALLETS,
} from "./factories";

const chain = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
  getChainId: vi.fn(),
}));
vi.mock("../lib/safeVerification", () => ({ getChainClient: () => chain }));
vi.mock("../lib/safeProposal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/safeProposal")>()),
  assertSafeProposal: vi.fn(),
}));
const safeTxHash = `0x${"ab".repeat(32)}` as `0x${string}`;
const txHash = `0x${"cd".repeat(32)}` as `0x${string}`;
const blockHash = `0x${"ef".repeat(32)}` as `0x${string}`;
const settledAt = Date.UTC(2026, 0, 15, 23, 59, 59);
const recipient = TEST_WALLETS.approver as `0x${string}`;

beforeEach(() => {
  vi.useFakeTimers();
  chain.getBlockNumber.mockResolvedValue(500n);
  chain.getLogs.mockResolvedValue([]);
  chain.getChainId.mockResolvedValue(11155111);
  chain.getBlock.mockResolvedValue({ number: 490n, hash: blockHash, timestamp: BigInt(settledAt / 1000) });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ safeTxHash }), { status: 200 }),
    ),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const beneficiaryId = await createTestBeneficiary(ctx, org.orgId, {
      walletAddress: recipient,
    });
    const disbursementId = await createTestDisbursement(
      ctx,
      org.orgId,
      org.safeId,
      beneficiaryId,
      org.userId,
      { status: "proposed", safeTxHash, amount: "1.000001" },
    );
    await ctx.db.patch(disbursementId, {
      recipientAddress: recipient,
      tokenAddress: CHAIN_TOKENS[11155111].USDC.address,
    });
    return { ...org, disbursementId };
  });
  const { sessionToken } = await signIn(t, "admin");
  return {
    t,
    ids,
    args: { disbursementId: ids.disbursementId, sessionToken, safeTxHash },
  };
}

function receipt(safe: string, amount = 1000001n, hash = safeTxHash) {
  return {
    status: "success",
    blockNumber: 490n,
    blockHash,
    logs: [
      {
        address: safe,
        topics: encodeEventTopics({
          abi: parseAbi([
            "event ExecutionSuccess(bytes32 txHash, uint256 payment)",
          ]),
          eventName: "ExecutionSuccess",
        }),
        data: encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }],
          [hash, 0n],
        ),
      },
      {
        address: CHAIN_TOKENS[11155111].USDC.address,
        topics: encodeEventTopics({
          abi: parseAbi([
            "event Transfer(address indexed from, address indexed to, uint256 value)",
          ]),
          eventName: "Transfer",
          args: { from: safe as `0x${string}`, to: recipient },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [amount]),
      },
    ],
  };
}

it("saves a network checkpoint before broadcasting and rejects another claim", async () => {
  const { t, args } = await setup();
  await t.action(api.nativePayments.start, args);
  const p = await t.run((ctx) => ctx.db.get(args.disbursementId));
  expect(p).toMatchObject({
    status: "relaying",
    safeTxHash,
    nativeExecution: { searchFromBlock: "488", checks: 0 },
  });
  expect(p?.txHash).toBeUndefined();
  expect(p?.nativeRecoveryAt).toBeTypeOf("number");
  await expect(t.action(api.nativePayments.start, args)).rejects.toThrow(
    "already being submitted",
  );
});

it("recovers a lost wallet response directly from the network while the indexer is down", async () => {
  const { t, ids, args } = await setup();
  await t.action(api.nativePayments.start, args);
  vi.mocked(fetch).mockRejectedValue(new Error("Service unavailable"));
  chain.getLogs.mockResolvedValue([
    { ...receipt(ids.safeAddress).logs[0], transactionHash: txHash, removed: false },
  ]);
  chain.getTransactionReceipt.mockResolvedValue(receipt(ids.safeAddress));
  await t.action(internal.nativePayments.reconcile, {
    disbursementId: ids.disbursementId,
  });
  await t.action(internal.nativePayments.reconcile, {
    disbursementId: ids.disbursementId,
  });
  expect(await t.run((ctx) => ctx.db.get(ids.disbursementId))).toMatchObject({
    status: "executed",
    txHash,
    settlement: { blockNumber: "490", blockHash, timestamp: settledAt },
  });
  expect(
    (await t.run((ctx) => ctx.db.get(ids.disbursementId)))?.nativeRecoveryAt,
  ).toBeUndefined();
  expect(chain.getTransactionReceipt).toHaveBeenCalledTimes(1);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "disbursement.executed"))
        .collect(),
    ),
  ).toHaveLength(1);
});

it('keeps declined sends bound to the original payment and rejects stale browser attempts', async () => {
  const { t, ids, args } = await setup();
  const first = await t.action(api.nativePayments.start, args);
  const rejection = { disbursementId: args.disbursementId, sessionToken: args.sessionToken, attemptId: first.attemptId };
  await expect(t.mutation(api.nativePayments.walletRejected, { ...rejection, attemptId: 'unrelated' })).rejects.toThrow('no longer current');
  await t.mutation(api.nativePayments.walletRejected, rejection);
  await t.mutation(api.nativePayments.walletRejected, rejection);
  let p = await t.run(ctx => ctx.db.get(ids.disbursementId));
  expect(p).toMatchObject({ status: 'relaying', safeTxHash, nativeExecution: { attemptId: first.attemptId, walletRejectedAt: expect.any(Number) } });
  expect(p?.nativeRecoveryAt).toBeTypeOf('number');
  await expect(t.mutation(api.disbursements.updateStatus, { disbursementId: args.disbursementId, sessionToken: args.sessionToken, status: 'draft' })).rejects.toThrow();
  const retry = await t.action(api.nativePayments.start, args);
  expect(retry.attemptId).not.toBe(first.attemptId);
  p = await t.run(ctx => ctx.db.get(ids.disbursementId));
  expect(p?.safeTxHash).toBe(safeTxHash);
  expect(p?.nativeExecution?.walletRejectedAt).toBeUndefined();
  await expect(t.mutation(api.nativePayments.walletRejected, rejection)).rejects.toThrow('no longer current');
  await t.run(ctx => ctx.db.patch(ids.disbursementId, { txHash }));
  await expect(t.mutation(api.nativePayments.walletRejected, { ...rejection, attemptId: retry.attemptId })).rejects.toThrow('no longer current');
});

it('still reconciles real settlement after a reported wallet rejection', async () => {
  const { t, ids, args } = await setup();
  const first = await t.action(api.nativePayments.start, args);
  await t.mutation(api.nativePayments.walletRejected, { disbursementId: args.disbursementId, sessionToken: args.sessionToken, attemptId: first.attemptId });
  chain.getLogs.mockResolvedValue([{ ...receipt(ids.safeAddress).logs[0], transactionHash: txHash, removed: false }]);
  chain.getTransactionReceipt.mockResolvedValue(receipt(ids.safeAddress));
  await t.action(internal.nativePayments.reconcile, { disbursementId: ids.disbursementId });
  expect(await t.run(ctx => ctx.db.get(ids.disbursementId))).toMatchObject({ status: 'executed', txHash });
  await expect(t.action(api.nativePayments.start, args)).rejects.toThrow();
});

it("continues a bounded scan without accepting a different proposal or an unconfirmed event", async () => {
  const { t, ids, args } = await setup();
  await t.action(api.nativePayments.start, args);
  chain.getBlockNumber.mockResolvedValue(10000n);
  chain.getLogs.mockResolvedValue([
    { ...receipt(ids.safeAddress, 1000001n, txHash).logs[0], transactionHash: txHash, removed: false },
    { ...receipt(ids.safeAddress).logs[0], transactionHash: txHash, removed: true },
  ]);
  await t.action(internal.nativePayments.reconcile, {
    disbursementId: ids.disbursementId,
  });
  expect(chain.getLogs).toHaveBeenLastCalledWith(
    expect.objectContaining({ fromBlock: 488n, toBlock: 2487n }),
  );
  expect(await t.run((ctx) => ctx.db.get(ids.disbursementId))).toMatchObject({
    status: "relaying",
    nativeExecution: { searchFromBlock: "2475", checks: 1 },
  });
  expect(chain.getTransactionReceipt).not.toHaveBeenCalled();
  chain.getLogs.mockRejectedValue(new Error("RPC unavailable"));
  await t.action(internal.nativePayments.reconcile, {
    disbursementId: ids.disbursementId,
  });
  expect(await t.run((ctx) => ctx.db.get(ids.disbursementId))).toMatchObject({
    nativeExecution: { searchFromBlock: "2475" },
  });
});

it("requires confirmed recipient transfers even when the transaction service reports execution", async () => {
  const { t, ids, args } = await setup();
  await t.action(api.nativePayments.start, args);
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ safeTxHash, transactionHash: txHash })),
  );
  chain.getTransactionReceipt.mockResolvedValue(receipt(ids.safeAddress, 1n));
  await t.action(internal.nativePayments.reconcile, {
    disbursementId: ids.disbursementId,
  });
  expect(await t.run((ctx) => ctx.db.get(ids.disbursementId))).toMatchObject({
    status: "relaying",
    relayStatus: "Needs investigation",
    txHash,
  });
  expect(
    (await t.run((ctx) => ctx.db.get(ids.disbursementId)))?.nativeRecoveryAt,
  ).toBeUndefined();
  await expect(
    t.action(api.nativePayments.start, args),
  ).rejects.toThrow();
});

it("waits for confirmation depth and a manual recheck cannot change the original identity", async () => {
  const { t, ids, args } = await setup();
  await t.action(api.nativePayments.start, args);
  chain.getLogs.mockResolvedValue([
    { ...receipt(ids.safeAddress).logs[0], transactionHash: txHash, removed: false },
  ]);
  chain.getTransactionReceipt.mockResolvedValue({
    ...receipt(ids.safeAddress),
    blockNumber: 500n,
  });
  await t.action(internal.nativePayments.reconcile, {
    disbursementId: ids.disbursementId,
  });
  const identity = {
    disbursementId: ids.disbursementId,
    sessionToken: args.sessionToken,
  };
  await t.mutation(api.nativePayments.recheck, identity);
  expect(await t.run((ctx) => ctx.db.get(ids.disbursementId))).toMatchObject({
    status: "relaying",
    safeTxHash,
    nativeExecution: { searchFromBlock: "488", checks: 0 },
  });
  const outsider = await signIn(t, "nonMember");
  await expect(
    t.mutation(api.nativePayments.recheck, {
      ...identity,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow();
});

it("does not change an approved managed-fee payment to native execution", async () => {
  const { t, args } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(args.disbursementId, {
      executionFee: {
        token: "USDC",
        tokenAddress: CHAIN_TOKENS[11155111].USDC.address,
        collector: recipient,
        amount: "0.05",
      },
    }),
  );
  await expect(t.action(api.nativePayments.start, args)).rejects.toThrow(
    "execution method",
  );
  expect(await t.run((ctx) => ctx.db.get(args.disbursementId))).toMatchObject({
    status: "proposed",
  });
});

it("rotates a bounded recovery queue and stops automatic retries with a visible exception", async () => {
  const { t, ids, args } = await setup();
  await t.action(api.nativePayments.start, args);
  await t.run(async (ctx) => {
    for (let i = 0; i < 24; i++) {
      const p = await ctx.db.get(ids.disbursementId);
      if (!p) throw new Error("Missing fixture");
      const { _id, _creationTime, ...copy } = p;
      void _id;
      void _creationTime;
      await ctx.db.insert("disbursements", copy);
    }
  });
  await t.mutation(internal.nativePayments.recover, {});
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("disbursements")
        .withIndex("by_native_recovery", (q) =>
          q.gt("nativeRecoveryAt", 0).lte("nativeRecoveryAt", Date.now()),
        )
        .collect(),
    ),
  ).toHaveLength(5);
  await t.run(async (ctx) => {
    const p = await ctx.db.get(ids.disbursementId);
    await ctx.db.patch(ids.disbursementId, {
      nativeExecution: { ...p!.nativeExecution!, checks: 119 },
    });
  });
  await t.action(internal.nativePayments.reconcile, {
    disbursementId: ids.disbursementId,
  });
  expect(await t.run((ctx) => ctx.db.get(ids.disbursementId))).toMatchObject({
    status: "relaying",
    relayStatus: "Needs investigation",
  });
  expect(
    (await t.run((ctx) => ctx.db.get(ids.disbursementId)))?.nativeRecoveryAt,
  ).toBeUndefined();
});
