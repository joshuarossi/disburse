import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { createFullOrgSetup, signIn, TEST_WALLETS } from "./factories";
import { encodeEventTopics } from "viem";
import { CIRCLE_ENTRY_POINT } from "../../shared/circleExecution";
import { circleUserOperationEvent } from "../../shared/circleSettlement";
const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getBlockNumber: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => rpc,
}));
const token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const hash = "0x" + "cd".repeat(32);
const topic = (address: string) =>
  "0x" + address.slice(2).toLowerCase().padStart(64, "0");
const transfer = () => ({
  address: token,
  topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    topic(TEST_WALLETS.admin),
    topic(TEST_WALLETS.nonMember),
  ],
  data: "0x" + 50_000_000n.toString(16),
});
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
  );
  const admin = await signIn(t, "admin");
  return {
    t,
    args: {
      orgId: ids.orgId,
      sessionToken: admin.sessionToken,
      plan: "team" as const,
      txHash: hash,
    },
  };
}
beforeEach(() => {
  vi.stubEnv("DISBURSE_BENEFICIARY_ADDRESS", TEST_WALLETS.nonMember);
  vi.stubEnv("DISBURSE_BENEFICIARY_CHAIN_ID", "1");
  rpc.getChainId.mockResolvedValue(1);
  rpc.getBlockNumber.mockResolvedValue(101n);
  rpc.getTransactionReceipt.mockResolvedValue({
    status: "success",
    blockNumber: 100n,
    logs: [transfer()],
  });
  rpc.getBlock.mockResolvedValue({
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("Subscription receipt verification", () => {
  it("cannot reserve an account bundle through legacy transaction-wide recovery", async () => {
    const { t, args } = await setup();
    rpc.getTransactionReceipt.mockResolvedValue({
      status: "success", blockNumber: 100n,
      logs: [transfer(), { address: CIRCLE_ENTRY_POINT,
        topics: encodeEventTopics({ abi: [circleUserOperationEvent] }), data: "0x" }],
    });
    await expect(t.action(api.billing.verifySubscriptionPayment, args)).rejects.toThrow("saved subscription checkout");
    expect(await t.run(ctx => ctx.db.query("billingPayments").collect())).toHaveLength(0);
  });
  it("verifies the payer, token, treasury, amount and confirmations then activates exactly once", async () => {
    const { t, args } = await setup();
    await t.action(api.billing.verifySubscriptionPayment, args);
    await t.mutation(api.billing.subscribe, args);
    const before = await t.query(api.billing.get, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
    });
    await t.action(api.billing.verifySubscriptionPayment, args);
    await t.mutation(api.billing.subscribe, args);
    expect(
      (
        await t.query(api.billing.get, {
          orgId: args.orgId,
          sessionToken: args.sessionToken,
        })
      )?.paidThroughAt,
    ).toBe(before?.paidThroughAt);
  });
  for (const mismatch of ["payer", "token", "treasury", "amount"])
    it(`rejects incorrect ${mismatch}`, async () => {
      const { t, args } = await setup();
      const log = transfer();
      if (mismatch === "payer") log.topics[1] = topic(TEST_WALLETS.viewer);
      if (mismatch === "token") log.address = TEST_WALLETS.viewer;
      if (mismatch === "treasury") log.topics[2] = topic(TEST_WALLETS.viewer);
      if (mismatch === "amount") log.data = "0x01";
      rpc.getTransactionReceipt.mockResolvedValue({
        status: "success",
        blockNumber: 100n,
        logs: [log],
      });
      await expect(
        t.action(api.billing.verifySubscriptionPayment, args),
      ).rejects.toThrow("insufficient");
    });
  it("rejects one confirmation, reverted transactions, stale transfers and wrong RPC chain", async () => {
    const { t, args } = await setup();
    rpc.getBlockNumber.mockResolvedValue(100n);
    await expect(
      t.action(api.billing.verifySubscriptionPayment, args),
    ).rejects.toThrow("two network confirmations");
    rpc.getBlockNumber.mockResolvedValue(101n);
    rpc.getTransactionReceipt.mockResolvedValueOnce({ status: "reverted", blockNumber: 100n });
    await expect(
      t.action(api.billing.verifySubscriptionPayment, args),
    ).rejects.toThrow("reverted");
    rpc.getBlock.mockResolvedValue({ timestamp: 0n });
    await expect(
      t.action(api.billing.verifySubscriptionPayment, args),
    ).rejects.toThrow("older than 7 days");
    rpc.getChainId.mockResolvedValue(11155111);
    await expect(
      t.action(api.billing.verifySubscriptionPayment, args),
    ).rejects.toThrow("network mismatch");
  });
  it("disables checkout when the treasury is absent or invalid", async () => {
    const { t, args } = await setup();
    vi.stubEnv("DISBURSE_BENEFICIARY_ADDRESS", "invalid");
    const b = await t.query(api.billing.get, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
    });
    expect(b?.paymentConfig).toBeNull();
    await expect(
      t.action(api.billing.verifySubscriptionPayment, args),
    ).rejects.toThrow("not configured");
  });
});

it('only releases a reverted subscription receipt after two confirmations', async () => {
  const { t, args } = await setup();
  rpc.getTransactionReceipt.mockResolvedValue({ status: 'reverted', blockNumber: 100n, logs: [] });
  rpc.getBlockNumber.mockResolvedValue(100n);
  await expect(t.action(api.billing.verifySubscriptionPayment, args)).rejects.toThrow('two network confirmations');
  rpc.getBlockNumber.mockResolvedValue(101n);
  await expect(t.action(api.billing.verifySubscriptionPayment, args)).rejects.toThrow('BILLING_PAYMENT_REVERTED');
  expect(await t.run(ctx => ctx.db.query('billingPayments').collect())).toHaveLength(0);
});
