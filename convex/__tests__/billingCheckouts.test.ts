import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { encodeFunctionData, erc20Abi } from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { createTestOrg, signIn, TEST_WALLETS } from "./factories";

const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getBlockNumber: vi.fn(),
  getTransactionCount: vi.fn(),
  estimateGas: vi.fn(),
  getLogs: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  getBlock: vi.fn(),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => rpc,
}));
const token = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  treasury = TEST_WALLETS.nonMember.toLowerCase();
const hash = `0x${"ab".repeat(32)}`,
  replacementHash = `0x${"cd".repeat(32)}`;
const input = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: [treasury as `0x${string}`, 50_000_000n],
});
const topic = (address: string) =>
  `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const transaction = () => ({
  from: TEST_WALLETS.admin,
  to: token,
  input,
  nonce: 7,
  value: 0n,
});
const receipt = () => ({
  status: "success",
  blockNumber: 101n,
  logs: [
    {
      address: token,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        topic(TEST_WALLETS.admin),
        topic(treasury),
      ],
      data: `0x${50_000_000n.toString(16)}`,
    },
  ],
});

async function setup() {
  const t = convexTest(schema);
  const admin = await signIn(t, "admin");
  const org = await t.run((ctx) => createTestOrg(ctx, admin.userId));
  const args = {
    orgId: org.orgId,
    sessionToken: admin.sessionToken,
    plan: "team" as const,
    requestId: crypto.randomUUID(),
    chainId: 11155111,
    treasury,
    tokenAddress: token,
    amountRaw: "50000000",
  };
  // Receipt recovery fixture from the retired EOA checkout path.
  const terms = { ...args };
  Reflect.deleteProperty(terms, "sessionToken");
  const id = await t.run(ctx => ctx.db.insert('billingCheckouts', { ...terms, createdBy: admin.userId, payer: TEST_WALLETS.admin.toLowerCase(), status: 'prepared', active: true, checks: 0, createdAt: Date.now(), updatedAt: Date.now() }));
  const scope = { checkoutId: id, sessionToken: admin.sessionToken };
  return {
    t,
    args,
    id,
    scope,
    admin,
    claim: () => t.mutation(internal.billingCheckoutData.claim, { ...scope, nonce: 7, fromBlock: '90', attemptId: 'legacy-attempt' }),
    org,
    read: () =>
      t.query(api.billingCheckoutData.get, { ...scope, orgId: org.orgId }),
  };
}
beforeEach(() => {
  vi.stubEnv("DISBURSE_BENEFICIARY_ADDRESS", treasury);
  vi.stubEnv("DISBURSE_BENEFICIARY_CHAIN_ID", "11155111");
  rpc.getChainId.mockResolvedValue(11155111);
  rpc.getBlockNumber.mockResolvedValue(102n);
  rpc.getTransactionCount.mockResolvedValue(7);
  rpc.estimateGas.mockResolvedValue(70000n);
  rpc.getLogs.mockResolvedValue([
    { args: { value: 50_000_000n }, transactionHash: hash },
  ]);
  rpc.getTransactionReceipt.mockResolvedValue(receipt());
  rpc.getTransaction.mockResolvedValue(transaction());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("durable subscription checkout", () => {
  it("reserves one checkout across tabs and administrators without repeating wallet requests", async () => {
    const s = await setup();
    expect(
      await s.t.mutation(api.billingCheckoutData.create, {
        ...s.args,
        requestId: crypto.randomUUID(),
      }),
    ).toBe(s.id);
    const other = await signIn(s.t, "approver");
    await s.t.run((ctx) =>
      ctx.db.insert("orgMemberships", {
        orgId: s.org.orgId,
        userId: other.userId,
        role: "admin",
        status: "active",
        createdAt: Date.now(),
      }),
    );
    expect(
      (
        await s.t.query(api.billingCheckoutData.current, {
          orgId: s.org.orgId,
          sessionToken: other.sessionToken,
        })
      )?._id,
    ).toBe(s.id);
    await expect(
      s.t.action(api.billingCheckoutActions.begin, {
        ...s.scope,
        sessionToken: other.sessionToken,
      }),
    ).rejects.toThrow("Connect the wallet");
    await expect(s.t.action(api.billingCheckoutActions.begin, s.scope)).rejects.toThrow('pay all fees in USDC');
    expect((await s.read()).status).toBe('prepared');
    expect(rpc.estimateGas).not.toHaveBeenCalled();
  });

  it("refuses new EOA checkouts and permits discarding only an unsubmitted request", async () => {
    const s = await setup();
    await s.t.mutation(api.billingCheckoutData.discard, s.scope);
    await expect(s.t.mutation(api.billingCheckoutData.create, { ...s.args, requestId: crypto.randomUUID() })).rejects.toThrow('company account');
    const pending = await setup();
    const attempt = await pending.claim();
    await expect(pending.t.mutation(api.billingCheckoutData.discard, pending.scope)).rejects.toThrow('wallet request');
    await expect(pending.t.mutation(api.billingCheckoutData.walletResult, { ...pending.scope, attemptId: 'other', declined: true })).rejects.toThrow('does not belong');
    await pending.t.mutation(api.billingCheckoutData.walletResult, { ...pending.scope, attemptId: attempt.attemptId, declined: true });
    expect((await pending.read()).active).toBe(false);
  });

  it("finds a withheld receipt with the browser closed and activates exactly once after trial expiry", async () => {
    const s = await setup();
    await s.claim();
    await s.t.run((ctx) =>
      ctx.db.patch(s.org.billingId, { trialEndsAt: Date.now() - 1 }),
    );
    await s.t.action(internal.billingCheckoutActions.reconcile, {
      checkoutId: s.id,
    });
    expect((await s.read()).error).toBeUndefined();
    expect(await s.read()).toMatchObject({
      status: "applied",
      active: false,
      txHash: hash,
    });
    const before = await s.t.run((ctx) => ctx.db.get(s.org.billingId));
    await s.t.action(internal.billingCheckoutActions.reconcile, {
      checkoutId: s.id,
    });
    await s.t.mutation(internal.billing.redeemCheckout, { checkoutId: s.id });
    expect(
      (await s.t.run((ctx) => ctx.db.get(s.org.billingId)))?.paidThroughAt,
    ).toBe(before?.paidThroughAt);
    expect(
      await s.t.run((ctx) => ctx.db.query("billingPayments").collect()),
    ).toHaveLength(1);
  });

  it("honors the saved terms after billing configuration changes", async () => {
    const s = await setup();
    await s.claim();
    vi.stubEnv("DISBURSE_BENEFICIARY_CHAIN_ID", "1");
    vi.stubEnv("DISBURSE_BENEFICIARY_ADDRESS", TEST_WALLETS.viewer);
    expect(
      await s.t.action(api.billingCheckoutActions.verify, {
        ...s.scope,
        txHash: hash,
      }),
    ).toEqual({ status: "applied" });
  });

  it("does not release an unrelated revert or accept a receipt for another wallet nonce", async () => {
    const s = await setup();
    await s.claim();
    rpc.getTransaction.mockResolvedValue({ ...transaction(), nonce: 6 });
    rpc.getTransactionReceipt.mockResolvedValue({
      ...receipt(),
      status: "reverted",
    });
    await expect(
      s.t.action(api.billingCheckoutActions.verify, {
        ...s.scope,
        txHash: hash,
      }),
    ).rejects.toThrow("does not match");
    expect((await s.read()).active).toBe(true);
    rpc.getTransaction.mockResolvedValue(transaction());
    rpc.getBlockNumber.mockResolvedValue(101n);
    await expect(
      s.t.action(api.billingCheckoutActions.verify, {
        ...s.scope,
        txHash: hash,
      }),
    ).rejects.toThrow("two network confirmations");
    rpc.getBlockNumber.mockResolvedValue(102n);
    expect(
      await s.t.action(api.billingCheckoutActions.verify, {
        ...s.scope,
        txHash: hash,
      }),
    ).toEqual({ status: "reverted" });
    expect((await s.read()).active).toBe(false);
    expect(
      await s.t.run((ctx) => ctx.db.query("billingPayments").collect()),
    ).toHaveLength(0);
  });

  it("releases an unknown request only after a replacement consumes its original nonce", async () => {
    const s = await setup();
    await s.claim();
    rpc.getTransaction.mockResolvedValue({
      ...transaction(),
      input: "0x",
      to: TEST_WALLETS.admin,
      nonce: 8,
    });
    await expect(
      s.t.action(api.billingCheckoutActions.verifyReplacement, {
        ...s.scope,
        txHash: replacementHash,
      }),
    ).rejects.toThrow("original wallet transaction number");
    rpc.getTransaction.mockResolvedValue({
      ...transaction(),
      input: "0x",
      to: TEST_WALLETS.admin,
    });
    expect(
      await s.t.action(api.billingCheckoutActions.verifyReplacement, {
        ...s.scope,
        txHash: replacementHash,
      }),
    ).toEqual({ status: "cancelled" });
    expect(await s.read()).toMatchObject({ active: false, replacementHash });
  });

  it("keeps an unknown submission reserved through provider outages and rejects changed receipts", async () => {
    const s = await setup();
    const attempt = await s.claim();
    rpc.getLogs.mockRejectedValueOnce(new Error("Network unavailable"));
    await s.t.action(internal.billingCheckoutActions.reconcile, {
      checkoutId: s.id,
    });
    expect(await s.read()).toMatchObject({
      active: true,
      error: "Network unavailable",
    });
    await s.t.mutation(api.billingCheckoutData.walletResult, {
      ...s.scope,
      attemptId: attempt.attemptId,
      txHash: hash,
    });
    await expect(
      s.t.mutation(api.billingCheckoutData.walletResult, {
        ...s.scope,
        attemptId: attempt.attemptId,
        txHash: replacementHash,
      }),
    ).rejects.toThrow("cannot be replaced");
  });
});
