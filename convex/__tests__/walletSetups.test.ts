import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  parseAbiItem,
  type Hex,
} from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { createFullOrgSetup, signIn, TEST_WALLETS } from "./factories";
import {
  walletSetupCall,
  walletSetupExecutionData,
  type WalletSetupIntent,
} from "../../shared/walletSetup";
import { circleConfiguration } from "../../shared/circleExecution";

const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
  getLogs: vi.fn(),
}));
const ownership = vi.hoisted(() => vi.fn());
const moduleCheck = vi.hoisted(() => vi.fn());
vi.mock("../lib/safeVerification", () => ({
  getChainClient: () => rpc,
  verifySafeOwnership: ownership,
}));
vi.mock("../lib/customerPaidAccount", () => ({
  assertCustomerPaidAccount: moduleCheck,
}));
const txHash = `0x${"cd".repeat(32)}` as Hex,
  blockHash = `0x${"ab".repeat(32)}` as Hex,
  address = "0x1111111111111111111111111111111111111111";
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  rpc.getChainId.mockResolvedValue(8453);
  rpc.getBlockNumber.mockResolvedValue(102n);
  rpc.getBlock.mockResolvedValue({ hash: blockHash });
  rpc.getLogs.mockResolvedValue([]);
  ownership.mockResolvedValue({
    owners: [TEST_WALLETS.admin.toLowerCase()],
    threshold: 1,
  });
  moduleCheck.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function setup() {
  const t = convexTest(schema),
    org = await t.run((ctx) =>
      createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
    );
  const { sessionToken } = await signIn(t, "admin");
  const args = {
    orgId: org.orgId,
    sessionToken,
    chainId: 8453,
    owners: [TEST_WALLETS.admin],
    threshold: 1,
    deposit: "1000000",
    requestId: "wallet-setup-request-01",
    address,
    startBlock: "99",
  };
  const setupId = await t.mutation(internal.walletSetups.persist, args),
    identity = { setupId, sessionToken },
    claimId = crypto.randomUUID();
  const saved = await t.query(api.walletSetups.get, identity),
    intent = saved as WalletSetupIntent,
    call = walletSetupCall(intent);
  const proxyEvent = parseAbiItem(
    "event ProxyCreation(address indexed proxy,address singleton)",
  );
  const creation = {
    address: call.to,
    topics: encodeEventTopics({
      abi: [proxyEvent],
      eventName: "ProxyCreation",
      args: { proxy: address },
    }),
    data: encodeAbiParameters([{ type: "address" }], [call.code[1].address]),
    logIndex: 1,
    removed: false,
  };
  const transfer = {
    address: circleConfiguration(8453).token,
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: TEST_WALLETS.admin, to: address },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [1000000n]),
    logIndex: 2,
    removed: false,
  };
  const receipt = {
    transactionHash: txHash,
    blockNumber: 100n,
    blockHash,
    status: "success",
    logs: [creation, transfer],
  };
  rpc.getTransactionReceipt.mockResolvedValue(receipt);
  return {
    t,
    org,
    args,
    identity,
    saved,
    claimId,
    receipt,
    creation,
    transfer,
    intent,
    begin: () => t.mutation(api.walletSetups.begin, { ...identity, claimId }),
    complete: () =>
      t.action(api.walletSetups.complete, { ...identity, txHash }),
  };
}
it("saves only one immutable setup across overlapping tabs", async () => {
  const s = await setup();
  expect(await s.t.mutation(internal.walletSetups.persist, s.args)).toBe(
    s.identity.setupId,
  );
  await expect(
    s.t.mutation(internal.walletSetups.persist, { ...s.args, chainId: 42161 }),
  ).rejects.toThrow("Another account setup");
  await expect(
    s.t.mutation(internal.walletSetups.persist, {
      ...s.args,
      owners: [TEST_WALLETS.admin, TEST_WALLETS.approver],
      threshold: 2,
    }),
  ).rejects.toThrow("Another account setup");
  expect(
    await s.t.run((ctx) => ctx.db.query("walletSetups").collect()),
  ).toHaveLength(1);
});
it("claims a wallet prompt once and never discards a potentially submitted setup", async () => {
  const s = await setup();
  expect(await s.begin()).toBe(s.saved.batchId);
  await expect(s.begin()).rejects.toThrow("original wallet setup request");
  await expect(
    s.t.mutation(api.walletSetups.discard, s.identity),
  ).rejects.toThrow("original wallet request");
});
it("releases a cancelled prompt only for its original claim and keeps the same deposit and Safe", async () => {
  const s = await setup();
  await s.begin();
  const rejection = {
    ...s.identity,
    batchId: s.saved.batchId,
    claimId: s.claimId,
    reason: "declined" as const,
  };
  await expect(
    s.t.mutation(api.walletSetups.declined, {
      ...rejection,
      claimId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("changed");
  await s.t.mutation(api.walletSetups.declined, rejection);
  const next = await s.t.query(api.walletSetups.get, s.identity);
  expect(next).toMatchObject({
    address,
    deposit: "1000000",
    stage: "prepared",
    attempt: 1,
  });
  expect(next.batchId).not.toBe(s.saved.batchId);
  await expect(
    s.t.mutation(api.walletSetups.declined, rejection),
  ).rejects.toThrow("changed");
});
it("recovers a lost database response before a wallet prompt using its saved claim", async () => {
  const s = await setup();
  await s.begin();
  await s.t.mutation(api.walletSetups.declined, {
    ...s.identity,
    batchId: s.saved.batchId,
    claimId: s.claimId,
    reason: "not_sent",
  });
  expect(await s.t.query(api.walletSetups.get, s.identity)).toMatchObject({
    stage: "prepared",
    address,
  });
});
it("connects the confirmed Safe only after checking the full deposit, owners and module", async () => {
  const s = await setup();
  await s.begin();
  expect(await s.complete()).toBe("complete");
  expect(moduleCheck).toHaveBeenCalledTimes(1);
  const saved = await s.t.query(api.walletSetups.get, s.identity);
  expect(saved).toMatchObject({ stage: "complete", open: false, txHash });
  expect(await s.t.run((ctx) => ctx.db.get(saved.safeId!))).toMatchObject({
    safeAddress: address,
    name: "Main account",
    threshold: 1,
    owners: [TEST_WALLETS.admin.toLowerCase()],
  });
  await s.complete();
  expect(moduleCheck).toHaveBeenCalledTimes(1);
  expect(
    await s.t.query(api.walletSetups.current, {
      orgId: s.org.orgId,
      sessionToken: s.identity.sessionToken,
    }),
  ).toMatchObject({
    _id: s.identity.setupId,
    stage: "complete",
    safeId: saved.safeId,
  });
});
it.each([
  "short deposit",
  "wrong token",
  "wrong account",
  "missing deployment",
  "duplicate deployment",
  "reorganization",
  "not confirmed",
  "changed owners",
  "unsupported module",
])("keeps a request unresolved for %s evidence", async (reason) => {
  const s = await setup();
  await s.begin();
  if (reason === "short deposit")
    s.transfer.data = encodeAbiParameters([{ type: "uint256" }], [999999n]);
  if (reason === "wrong token") s.transfer.address = TEST_WALLETS.viewer;
  if (reason === "wrong account")
    s.creation.topics = encodeEventTopics({
      abi: [
        parseAbiItem(
          "event ProxyCreation(address indexed proxy,address singleton)",
        ),
      ],
      eventName: "ProxyCreation",
      args: { proxy: TEST_WALLETS.viewer },
    });
  if (reason === "missing deployment") s.receipt.logs.shift();
  if (reason === "duplicate deployment") s.receipt.logs.push(s.creation);
  if (reason === "reorganization")
    rpc.getBlock.mockResolvedValue({ hash: txHash });
  if (reason === "not confirmed") rpc.getBlockNumber.mockResolvedValue(101n);
  if (reason === "changed owners")
    ownership.mockResolvedValue({
      owners: [TEST_WALLETS.viewer],
      threshold: 1,
    });
  if (reason === "unsupported module")
    moduleCheck.mockRejectedValue(new Error("Unsupported account module"));
  await expect(s.complete()).rejects.toThrow();
  expect(await s.t.query(api.walletSetups.get, s.identity)).toMatchObject({
    stage: "requested",
    open: true,
  });
  expect(await s.t.run((ctx) => ctx.db.query("safes").collect())).toHaveLength(
    1,
  );
});
it("only a reverted receipt for the exact payer-signed batch permits another attempt", async () => {
  const s = await setup();
  await s.begin();
  s.receipt.status = "reverted";
  s.receipt.logs = [];
  const transaction = {
    from: TEST_WALLETS.admin,
    to: TEST_WALLETS.admin,
    input: "0x1234",
  };
  rpc.getTransaction.mockResolvedValue(transaction);
  await expect(s.complete()).rejects.toThrow("failed receipt");
  transaction.input = walletSetupExecutionData(s.intent);
  expect(await s.complete()).toBe("failed");
  expect(await s.t.query(api.walletSetups.get, s.identity)).toMatchObject({
    stage: "prepared",
    open: true,
    address,
    deposit: "1000000",
  });
});
it("revoked admin access stops completion before reading or modifying the chain", async () => {
  const s = await setup();
  await s.begin();
  await s.t.run((ctx) => ctx.db.patch(s.org.membershipId, { role: "viewer" }));
  await expect(s.complete()).rejects.toThrow();
  expect(rpc.getTransactionReceipt).not.toHaveBeenCalled();
});

it("recovers the exact setup with the browser closed and no returned transaction hash", async () => {
  const s = await setup();
  await s.begin();
  rpc.getLogs.mockResolvedValue([{ transactionHash: txHash, removed: false }]);
  await s.t.action(internal.walletSetups.reconcile, {
    setupId: s.identity.setupId,
  });
  expect(await s.t.query(api.walletSetups.get, s.identity)).toMatchObject({
    stage: "complete",
    txHash,
    open: false,
  });
  expect(rpc.getLogs).toHaveBeenCalledWith(
    expect.objectContaining({
      args: { proxy: address },
      fromBlock: 99n,
      toBlock: 100n,
    }),
  );
});
it("bounds background scans and rewinds after a checkpoint reorganization", async () => {
  const s = await setup();
  await s.begin();
  rpc.getBlockNumber.mockResolvedValue(5000n);
  await s.t.action(internal.walletSetups.reconcile, {
    setupId: s.identity.setupId,
  });
  expect(rpc.getLogs).toHaveBeenLastCalledWith(
    expect.objectContaining({ fromBlock: 99n, toBlock: 2098n }),
  );
  expect(await s.t.query(api.walletSetups.get, s.identity)).toMatchObject({
    scanFrom: "2099",
    scanHash: blockHash,
  });
  rpc.getBlock.mockResolvedValueOnce({ hash: txHash });
  await s.t.action(internal.walletSetups.reconcile, {
    setupId: s.identity.setupId,
  });
  expect(rpc.getLogs).toHaveBeenLastCalledWith(
    expect.objectContaining({ fromBlock: 99n, toBlock: 2098n }),
  );
});
it("retains the saved cursor and authorization during a background RPC outage", async () => {
  const s = await setup();
  await s.begin();
  rpc.getLogs.mockRejectedValue(new Error("provider unavailable"));
  await s.t.action(internal.walletSetups.reconcile, {
    setupId: s.identity.setupId,
  });
  expect(await s.t.query(api.walletSetups.get, s.identity)).toMatchObject({
    stage: "requested",
    scanFrom: "99",
    batchId: s.saved.batchId,
  });
  expect(rpc.getTransactionReceipt).not.toHaveBeenCalled();
});
it("does not accept a factory event without the complete reviewed deposit", async () => {
  const s = await setup();
  await s.begin();
  s.receipt.logs = [s.creation];
  rpc.getLogs.mockResolvedValue([{ transactionHash: txHash, removed: false }]);
  await s.t.action(internal.walletSetups.reconcile, {
    setupId: s.identity.setupId,
  });
  expect(await s.t.query(api.walletSetups.get, s.identity)).toMatchObject({
    stage: "requested",
    open: true,
    scanFrom: "99",
  });
});
it("an earlier failure receipt cannot release a newer wallet attempt", async () => {
  const s = await setup();
  await s.begin();
  s.receipt.status = "reverted";
  s.receipt.logs = [];
  rpc.getTransaction.mockResolvedValue({
    from: TEST_WALLETS.admin,
    to: TEST_WALLETS.admin,
    input: walletSetupExecutionData(s.intent),
  });
  expect(await s.complete()).toBe("failed");
  await s.t.mutation(api.walletSetups.begin, {
    ...s.identity,
    claimId: crypto.randomUUID(),
  });
  const current = await s.t.query(api.walletSetups.get, s.identity);
  await expect(s.complete()).rejects.toThrow("earlier setup attempt");
  expect(await s.t.query(api.walletSetups.get, s.identity)).toMatchObject({
    stage: "requested",
    batchId: current.batchId,
    attempt: 1,
  });
});
