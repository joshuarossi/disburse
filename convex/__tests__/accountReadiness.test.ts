import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { createFullOrgSetup, signIn, TEST_WALLETS } from "./factories";
import { CHAIN_TOKENS } from "../../shared/chains";
import { assessAccount, assessPayments } from "../../shared/accountReadiness";

const rpc = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  readContract: vi.fn(),
  getBalance: vi.fn(),
  getCode: vi.fn(),
  identity: vi.fn(),
  customerFees: vi.fn(),
}));
vi.mock("../lib/safeVerification", () => ({ getChainClient: () => rpc }));
vi.mock("../lib/safeIdentity", () => ({
  assertSafeIdentity: (...args: unknown[]) => rpc.identity(...args),
}));
vi.mock("../lib/customerPaidAccount", () => ({
  assertCustomerPaidAccount: (...args: unknown[]) => rpc.customerFees(...args),
}));
beforeEach(() => {
  vi.clearAllMocks();
  rpc.identity.mockResolvedValue(undefined);
  rpc.customerFees.mockResolvedValue(undefined);
  rpc.getBlockNumber.mockResolvedValue(123n);
  rpc.getCode.mockResolvedValue(undefined);
  rpc.getBalance.mockResolvedValue(1000000000000000n);
  rpc.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      functionName === "getOwners"
        ? [TEST_WALLETS.admin, TEST_WALLETS.approver]
        : functionName === "getThreshold"
          ? 2n
          : 100000001n,
  );
});
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
  );
  const { sessionToken } = await signIn(t, "admin");
  return { t, ids, args: { safeId: ids.safeId, sessionToken } };
}

it("reads current owners, thresholds and exact balances at the same verified block", async () => {
  const { t, args } = await setup();
  const result = await t.action(api.accountReadiness.get, args);
  expect(result).toMatchObject({
    threshold: 2,
    isOwner: true,
    canPrepare: true,
    blockNumber: "123",
    environment: "test",
    native: { balance: "0.001" },
  });
  expect(result.assets.find((a) => a.token === "USDC")).toMatchObject({
    balance: "100.000001",
    address: CHAIN_TOKENS[11155111].USDC.address,
  });
  expect(rpc.identity).toHaveBeenCalled();
  for (const [request] of rpc.readContract.mock.calls)
    expect(request.blockNumber).toBe(123n);
  expect(result.owners.filter((o) => o.canApproveInApp)).toHaveLength(1);
});

it("keeps business account names within the organization and preserves payment authority when renamed", async () => {
  const { t, ids, args } = await setup();
  await t.mutation(api.safes.rename, { ...args, name: "  Payroll account  " });
  const account = await t.action(api.accountReadiness.get, args);
  expect(account.name).toBe("Payroll account");
  expect(account.threshold).toBe(2);
  const outsider = await signIn(t, "viewer");
  await expect(
    t.mutation(api.safes.rename, {
      ...args,
      sessionToken: outsider.sessionToken,
      name: "Changed",
    }),
  ).rejects.toThrow();
  await t.run((ctx) => ctx.db.patch(ids.membershipId, { role: "clerk" }));
  await expect(
    t.mutation(api.safes.rename, { ...args, name: "Changed" }),
  ).rejects.toThrow();
  expect((await t.action(api.accountReadiness.get, args)).name).toBe(
    "Payroll account",
  );
});

it("keeps a failed asset balance unknown and rejects an unverifiable account identity", async () => {
  const { t, args } = await setup();
  rpc.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") throw new Error("RPC unavailable");
      return functionName === "getOwners" ? [TEST_WALLETS.admin] : 1n;
    },
  );
  const partial = await t.action(api.accountReadiness.get, args);
  expect(partial.assets.every((a) => a.balance === null)).toBe(true);
  expect(partial.threshold).toBe(1);
  rpc.identity.mockRejectedValue(new Error("Unexpected proxy"));
  const failed = await t.action(api.accountReadiness.get, args);
  expect(failed.error).toContain("could not be verified");
  expect(failed.owners).toEqual([]);
  expect(failed.blockNumber).toBeNull();
});

it("authorizes the exact account before reading it and distinguishes read access from payment access", async () => {
  const { t, ids, args } = await setup();
  const outsider = await signIn(t, "viewer");
  await expect(
    t.action(api.accountReadiness.get, {
      ...args,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow();
  expect(rpc.getBlockNumber).not.toHaveBeenCalled();
  await t.run((ctx) => ctx.db.patch(ids.membershipId, { role: "viewer" }));
  expect((await t.action(api.accountReadiness.get, args)).canPrepare).toBe(
    false,
  );
});

it("shows principal and fee shortfalls separately without substituting a recipient currency", async () => {
  const { t, args } = await setup();
  const account = await t.action(api.accountReadiness.get, args);
  account.managed = {
    fee: {
      token: "USDC",
      tokenAddress: CHAIN_TOKENS[11155111].USDC.address,
      collector: TEST_WALLETS.viewer,
      amount: "0.05",
    },
    error: null,
  };
  account.assets = [
    { token: "USDC", address: account.managed.fee!.tokenAddress, balance: "0" },
    { token: "USDT", address: TEST_WALLETS.approver, balance: "100" },
  ];
  const check = assessAccount(account, "USDT", "100.000001", true);
  expect(check.debits).toEqual([
    {
      token: "USDT",
      amount: "100.000001",
      available: "100",
      shortfall: "0.000001",
    },
    { token: "USDC", amount: "0.05", available: "0", shortfall: "0.05" },
  ]);
  expect(check.issues).toContain(
    "Add 0.05 USDC to this account before sending.",
  );
  account.assets[0].balance = "1.075";
  const combined = assessPayments(
    account,
    [
      { token: "USDC", amount: "1" },
      { token: "USDT", amount: "2" },
    ],
    true,
  );
  expect(combined.debits.find((d) => d.token === "USDC")).toMatchObject({
    amount: "1.1",
    shortfall: "0.025",
  });
});

it("identifies stale checks, missing native test gas and insufficient team approval access", async () => {
  const { t, args } = await setup();
  const account = await t.action(api.accountReadiness.get, args);
  account.native.balance = "0";
  const check = assessAccount(
    account,
    "USDC",
    "1",
    false,
    account.checkedAt + 61000,
  );
  expect(check.current).toBe(false);
  expect(check.issues).toContain(
    "The sending wallet needs test ETH for the network fee.",
  );
  expect(check.issues).toContain(
    "Not enough account owners have payment access in this workspace to collect all approvals here.",
  );
});

it("uses the verified Circle setup with zero native gas and no retired-relay quote", async () => {
  const { t, args, ids } = await setup();
  await t.run((ctx) => ctx.db.patch(ids.safeId, { chainId: 84532 }));
  rpc.getBalance.mockResolvedValue(0n);
  const account = await t.action(api.accountReadiness.get, args);
  expect(account.managed).toEqual({
    service: "circle",
    fee: null,
    error: null,
    ready: true,
  });
  expect(rpc.customerFees).toHaveBeenCalledWith(
    rpc,
    account.safeAddress,
    84532,
    123n,
  );
  for (const managed of [true, false]) {
    const result = assessAccount(account, "USDC", "1", managed);
    expect(result.issues.some((i) => /ETH|unavailable|fee setup/.test(i))).toBe(
      false,
    );
    expect(result.debits).toEqual([
      { token: "USDC", amount: "1", available: "100.000001", shortfall: null },
    ]);
  }
});
it("preserves unknown fee setup and requires spare USDC even when paying another currency", async () => {
  const { t, args, ids } = await setup();
  await t.run((ctx) => ctx.db.patch(ids.safeId, { chainId: 84532 }));
  rpc.customerFees.mockRejectedValue(new Error("RPC timeout"));
  const account = await t.action(api.accountReadiness.get, args);
  expect(account.error).toBeNull();
  expect(account.assets[0].balance).not.toBeNull();
  expect(assessAccount(account, "USDC", "1", true).issues.join(" ")).toContain(
    "USDC fee setup could not be verified",
  );
  account.managed.ready = true;
  account.managed.error = null;
  account.assets.push({
    token: "USDT",
    address: TEST_WALLETS.viewer,
    balance: "100",
  });
  account.assets.find((a) => a.token === "USDC")!.balance = "0";
  expect(
    assessAccount(account, "USDT", "100", true).issues.join(" "),
  ).toContain("additional USDC");
  account.assets.find((a) => a.token === "USDC")!.balance = "100";
  expect(
    assessAccount(account, "USDC", "100", true).issues.join(" "),
  ).toContain("additional USDC");
});
