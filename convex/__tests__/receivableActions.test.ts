import { convexTest } from "convex-test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { createFullOrgSetup, signIn, TEST_WALLETS } from "./factories";
import {
  forwarderFactory,
  invoiceAddress,
  invoiceSalt,
} from "../../shared/receivableAddress";
import { CHAIN_TOKENS } from "../../shared/chains";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address } from "viem";

const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getCode: vi.fn(),
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
  getLogs: vi.fn(),
  getTransactionReceipt: vi.fn(),
  readContract: vi.fn(),
}));
const provider = vi.hoisted(() => ({ sendTransaction: vi.fn() }));
vi.mock("../lib/safeVerification", () => ({ getChainClient: () => rpc }));
vi.mock("../lib/safeIdentity", () => ({ assertSafeIdentity: vi.fn() }));
vi.mock("../lib/managedRelay", () => ({ managedRelay: () => provider }));
const factory = TEST_WALLETS.viewer;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("AR_FACTORY_11155111", factory);
  vi.stubEnv("AR_MAINNET_ENABLED", "false");
  vi.stubEnv("GELATO_TESTNET_API_KEY", "");
  rpc.getChainId.mockResolvedValue(11155111);
  rpc.getCode.mockResolvedValue(forwarderFactory.deployedBytecode);
  rpc.getBlockNumber.mockResolvedValue(101n);
  rpc.getBlock.mockResolvedValue({ number: 100n, hash: `0x${'b'.repeat(64)}`, timestamp: 1768521599n });
  rpc.getLogs.mockResolvedValue([]);
  rpc.readContract.mockResolvedValue(0n);
  provider.sendTransaction.mockResolvedValue("forwarding-provider-id");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

async function setup(chainId = 11155111) {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
  );
  if (chainId !== 11155111)
    await t.run((ctx) => ctx.db.patch(ids.safeId, { chainId }));
  const { sessionToken } = await signIn(t, "admin");
  const invoiceId = await t.mutation(api.receivables.create, {
    orgId: ids.orgId,
    sessionToken,
    safeId: ids.safeId,
    number: "AR-ACTIONS",
    customerName: "Customer",
    description: "",
    token: "USDC",
    dueDate: Date.now() + 86400000,
    items: [{ description: "Service", quantity: 1, unitPrice: "10" }],
  });
  const args = { invoiceId, sessionToken };
  const invoice = await t.query(api.receivables.get, args);
  const salt = invoiceSalt(ids.orgId, invoiceId, chainId);
  const receivingAddress = invoiceAddress(
    factory as Address,
    invoice.treasury as Address,
    salt,
  ).toLowerCase();
  return { t, ids, args, invoice, salt, receivingAddress };
}
async function publish(s: Awaited<ReturnType<typeof setup>>) {
  await s.t.mutation(internal.receivables.publish, {
    ...s.args,
    expectedUpdatedAt: s.invoice.updatedAt,
    expectedRevision: s.invoice.revision ?? 0,
    factory,
    salt: s.salt,
    receivingAddress: s.receivingAddress,
    publicToken: "a".repeat(64),
    startBlock: "100",
  });
}
function receipt(
  s: Awaited<ReturnType<typeof setup>>,
  value = 10000000n,
  index = 0,
) {
  return {
    address: s.invoice.tokenAddress,
    args: { from: TEST_WALLETS.nonMember, to: s.receivingAddress, value },
    transactionHash: `0x${"a".repeat(64)}`,
    blockHash: `0x${"b".repeat(64)}`,
    blockNumber: 100n,
    logIndex: index,
    removed: false,
  };
}
describe("receivable chain verification", () => {
  it('enriches legacy receipt evidence without moving the scan cursor or counting the receipt again', async () => {
    const s = await setup(); await publish(s);
    const log = receipt(s);
    await s.t.mutation(internal.receivables.recordScan, { invoiceId: s.args.invoiceId, fromBlock: '100', nextBlock: '101',
      events: [{ key: 'legacy-receipt', kind: 'received', amount: '10000000', txHash: log.transactionHash, logIndex: 0, blockNumber: '100', blockHash: log.blockHash }] });
    const [event] = await s.t.query(api.receivables.receipts, s.args);
    const transaction = { status: 'success', transactionHash: log.transactionHash, blockNumber: 100n, blockHash: log.blockHash, logs: [{ ...log,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: TEST_WALLETS.nonMember as Address, to: s.receivingAddress as Address } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [10000000n]) }] };
    rpc.getTransactionReceipt.mockResolvedValue(transaction);
    await s.t.action(api.receiptEvidence.verify, { eventId: event._id, sessionToken: s.args.sessionToken });
    await s.t.action(api.receiptEvidence.verify, { eventId: event._id, sessionToken: s.args.sessionToken });
    expect(await s.t.query(api.receivables.get, s.args)).toMatchObject({ received: '10000000', scanFromBlock: '101' });
    const events = await s.t.query(api.receivables.receipts, s.args);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ settledAt: 1768521599000, fromAddress: TEST_WALLETS.nonMember.toLowerCase(), toAddress: s.receivingAddress });
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(rpc.getLogs).not.toHaveBeenCalled();
    rpc.getTransactionReceipt.mockResolvedValueOnce({ ...transaction, blockHash: `0x${'f'.repeat(64)}` });
    await expect(s.t.action(api.receiptEvidence.verify, { eventId: event._id, sessionToken: s.args.sessionToken })).rejects.toThrow('no longer matches');
    rpc.getTransactionReceipt.mockResolvedValueOnce({ ...transaction, logs: [{ ...transaction.logs[0], data: encodeAbiParameters([{ type: 'uint256' }], [10000001n]) }] });
    await expect(s.t.action(api.receiptEvidence.verify, { eventId: event._id, sessionToken: s.args.sessionToken })).rejects.toThrow('amount or receiving instructions');
    const other = await signIn(s.t, 'nonMember');
    await expect(s.t.action(api.receiptEvidence.verify, { eventId: event._id, sessionToken: other.sessionToken })).rejects.toThrow();
  });
  it("rejects mismatched factory code, RPC chain, predicted address and disabled production issuance", async () => {
    const s = await setup();
    rpc.getCode.mockResolvedValueOnce("0x00");
    await expect(
      s.t.action(api.receivableActions.issue, s.args),
    ).rejects.toThrow(/factory could not be verified/);
    rpc.getChainId.mockResolvedValueOnce(1);
    await expect(
      s.t.action(api.receivableActions.issue, s.args),
    ).rejects.toThrow(/network does not match/);
    rpc.readContract.mockResolvedValueOnce(TEST_WALLETS.nonMember);
    await expect(
      s.t.action(api.receivableActions.issue, s.args),
    ).rejects.toThrow(/address verification failed/);
    expect((await s.t.query(api.receivables.get, s.args)).state).toBe("draft");
    const mainnet = await setup(1);
    await expect(
      mainnet.t.action(api.receivableActions.issue, mainnet.args),
    ).rejects.toThrow(/production networks is not enabled/);
  });
  it("waits for two testnet confirmations and accepts only the canonical asset and receiving address", async () => {
    const s = await setup();
    await publish(s);
    // A connected provider key must not make Disburse sponsor a customer's collection.
    vi.stubEnv("GELATO_TESTNET_API_KEY", "unit-test-only");
    rpc.readContract.mockResolvedValue(10000000n);
    rpc.getBlockNumber.mockResolvedValueOnce(100n);
    await s.t.action(api.receivableActions.refresh, s.args);
    expect(rpc.getLogs).not.toHaveBeenCalled();
    rpc.getLogs
      .mockResolvedValueOnce([
        receipt(s),
        { ...receipt(s, 5n, 1), address: TEST_WALLETS.viewer },
        {
          ...receipt(s, 5n, 2),
          args: { ...receipt(s).args, to: TEST_WALLETS.viewer },
        },
        { ...receipt(s, 5n, 3), removed: true },
        { ...receipt(s, 5n, 4), blockNumber: 101n },
      ])
      .mockResolvedValueOnce([]);
    await s.t.action(api.receivableActions.refresh, s.args);
    const i = await s.t.query(api.receivables.get, s.args);
    expect(i.received).toBe("10000000");
    expect(i.scanFromBlock).toBe("101");
    const events = await s.t.query(api.receivables.receipts, s.args);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ settledAt: 1768521599000, fromAddress: TEST_WALLETS.nonMember.toLowerCase(), toAddress: s.receivingAddress });
    expect(rpc.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CHAIN_TOKENS[11155111].USDC.address.toLowerCase(),
        args: { to: s.receivingAddress },
        fromBlock: 100n,
        toBlock: 100n,
      }),
    );
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(await s.t.query(api.receivables.configuration, { orgId: s.ids.orgId, sessionToken: s.args.sessionToken }))
      .toEqual([expect.objectContaining({ chainId: 11155111, collectionFeeMode: "wallet" })]);
  });
  it("uses finalized production blocks and bounds each scan to 2,000 blocks", async () => {
    const s = await setup(1);
    await publish(s);
    rpc.getChainId.mockResolvedValue(1);
    rpc.getBlock.mockResolvedValue({ number: 5000n });
    await s.t.action(api.receivableActions.refresh, s.args);
    expect(rpc.getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
    expect(rpc.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 100n, toBlock: 2099n }),
    );
  });
  it("does not advance or erase confirmed totals on provider errors", async () => {
    const s = await setup();
    await publish(s);
    rpc.getLogs.mockRejectedValue(new Error("RPC unavailable"));
    await s.t.action(api.receivableActions.refresh, s.args);
    const i = await s.t.query(api.receivables.get, s.args);
    expect(i.scanFromBlock).toBe("100");
    expect(i.received).toBe("0");
    expect(i.syncError).toMatch(/last confirmed amounts/);
  });
  it('retains its scan checkpoint when a receipt no longer matches its block', async () => {
    const s = await setup();
    await publish(s);
    rpc.getLogs.mockResolvedValueOnce([receipt(s)]).mockResolvedValueOnce([]);
    rpc.getBlock.mockResolvedValueOnce({ number: 100n, hash: `0x${'c'.repeat(64)}`, timestamp: 1768521599n });
    await s.t.action(api.receivableActions.refresh, s.args);
    const invoice = await s.t.query(api.receivables.get, s.args);
    expect(invoice).toMatchObject({ received: '0', scanFromBlock: '100' });
    expect(invoice.syncError).toContain('last confirmed amounts');
    expect(await s.t.query(api.receivables.receipts, s.args)).toEqual([]);
  });
});
