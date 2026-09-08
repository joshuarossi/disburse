import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, keccak256, toHex, type Hex } from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { createFullOrgSetup, signIn, TEST_WALLETS } from "./factories";
import { assertParentHierarchy } from "../accountSetups";
import { readCircleSource } from "../lib/circleSource";
import {
  circleAccountCall,
  circleConfiguration,
  circleSignature,
} from "../../shared/circleExecution";
import {
  encodeCircleRequest,
  type CircleRequest,
} from "../../shared/circleRequest";
import { companyFactoryAbi } from "../../shared/companyAccountSetup";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema),
    org = await t.run((ctx) =>
      createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
    );
  await t.run((ctx) => ctx.db.patch(org.safeId, { chainId: 84532 }));
  const { sessionToken } = await signIn(t, "admin");
  const requestId = "test-account-request-0001";
  const preparation = {
    orgId: org.orgId,
    parentSafeId: org.safeId,
    sessionToken,
    name: "Payroll",
    requestId,
    chainId: 84532,
    parentAddress: org.safeAddress.toLowerCase(),
    address: TEST_WALLETS.viewer.toLowerCase(),
    salt: keccak256(toHex(`${org.orgId}:${requestId}`)),
  };
  const accountSetupId = await t.mutation(
    internal.accountSetups.persist,
    preparation,
  );
  const source = { accountSetupId },
    args = { ...source, sessionToken };
  const data = await t.run((ctx) =>
    readCircleSource(ctx, source, sessionToken, true),
  );
  if (!data.directCall) throw new Error("Expected direct account creation");
  const safe = org.safeAddress as Hex,
    config = circleConfiguration(84532),
    until = Math.floor(Date.now() / 1000) + 1800;
  const request: CircleRequest = {
    chainId: 84532,
    safe,
    directCall: true,
    transaction: data.call,
    originalHash: data.target.safeTxHash as Hex,
    startBlock: "100",
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
  const persistFee = () =>
    t.mutation(internal.circlePayments.persist, {
      ...args,
      snapshot: data.snapshot,
      record: encodeCircleRequest(request),
    });
  return {
    t,
    org,
    args,
    accountSetupId,
    preparation,
    data,
    request,
    persistFee,
  };
}

it("restores the original named account and derives its published factory call on the server", async () => {
  const s = await setup();
  expect(
    await s.t.mutation(internal.accountSetups.persist, s.preparation),
  ).toBe(s.accountSetupId);
  expect(
    await s.t.query(api.accountSetups.current, {
      orgId: s.org.orgId,
      sessionToken: s.args.sessionToken,
    }),
  ).toMatchObject({
    _id: s.accountSetupId,
    parentSafeId: s.org.safeId,
    name: "Payroll",
  });
  const decoded = decodeFunctionData({
    abi: companyFactoryAbi,
    data: s.data.call.data,
  });
  expect(decoded.functionName).toBe("createProxyWithNonce");
  expect(decoded.args[2]).toBe(BigInt(s.preparation.salt));
  expect(
    await s.t.run((ctx) => ctx.db.query("accountSetups").collect()),
  ).toHaveLength(1);
});

it("rejects another setup or changed intent while the original is saved", async () => {
  const s = await setup();
  await expect(
    s.t.query(internal.accountSetups.preparationContext, {
      orgId: s.org.orgId,
      sessionToken: s.args.sessionToken,
      parentSafeId: s.org.safeId,
      name: "Reserves",
      requestId: "another-request-0001",
    }),
  ).rejects.toThrow("saved account setup");
  await expect(
    s.t.mutation(internal.accountSetups.persist, {
      ...s.preparation,
      name: "Changed",
    }),
  ).rejects.toThrow("already saved");
});

it("prevents reusing a discarded request identifier for different instructions", async () => {
  const s = await setup();
  await s.t.mutation(api.accountSetups.discard, s.args);
  await expect(
    s.t.mutation(internal.accountSetups.persist, {
      ...s.preparation,
      name: "Changed",
    }),
  ).rejects.toThrow("different instructions");
});

it("keeps fee-authorized creation recoverable and blocks archiving its paying account", async () => {
  const s = await setup();
  await s.persistFee();
  await expect(s.t.mutation(api.accountSetups.discard, s.args)).rejects.toThrow(
    "saved execution",
  );
  await expect(
    s.t.mutation(api.safes.unlink, {
      safeId: s.org.safeId,
      sessionToken: s.args.sessionToken,
    }),
  ).rejects.toThrow("saved USDC fee request");
  expect(await s.t.query(api.accountSetups.get, s.args)).toMatchObject({
    open: true,
    status: "prepared",
  });
});

it.each(["viewer", "archived", "changed chain", "changed name"])(
  "rejects account creation after %s invalidates its preparation",
  async (reason) => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      if (reason === "viewer") {
        const member = await ctx.db
          .query("orgMemberships")
          .withIndex("by_org_and_user", (q) =>
            q.eq("orgId", s.org.orgId).eq("userId", s.org.userId),
          )
          .unique();
        await ctx.db.patch(member!._id, { role: "viewer" });
      } else if (reason === "archived")
        await ctx.db.patch(s.org.safeId, { isActive: false });
      else if (reason === "changed chain")
        await ctx.db.patch(s.org.safeId, { chainId: 8453 });
      else await ctx.db.patch(s.accountSetupId, { name: "Different account" });
    });
    await expect(s.persistFee()).rejects.toThrow();
    expect(
      await s.t.run((ctx) => ctx.db.query("circleExecutions").collect()),
    ).toHaveLength(0);
  },
);

it("rejects arbitrary calls disguised as the approved account deployment", async () => {
  const s = await setup();
  s.request.transaction.to = TEST_WALLETS.viewer;
  s.request.operation.callData = circleAccountCall(
    s.request.transaction.to,
    s.request.transaction.data,
  );
  await expect(s.persistFee()).rejects.toThrow("reviewed account instruction");
});

it("links a confirmed deployment once and preserves its parent as the actual owner", async () => {
  const s = await setup(),
    executionId = await s.persistFee(),
    txHash = `0x${"ab".repeat(32)}`;
  await expect(
    s.t.mutation(internal.accountSetups.finish, {
      accountSetupId: s.accountSetupId,
      txHash,
    }),
  ).rejects.toThrow("receipt changed");
  await s.t.run((ctx) =>
    ctx.db.patch(executionId, { stage: "confirmed", open: false, txHash }),
  );
  await s.t.mutation(internal.accountSetups.finish, {
    accountSetupId: s.accountSetupId,
    txHash,
  });
  await s.t.mutation(internal.accountSetups.finish, {
    accountSetupId: s.accountSetupId,
    txHash,
  });
  const saved = await s.t.query(api.accountSetups.get, s.args);
  expect(saved).toMatchObject({ status: "complete", open: false, txHash });
  expect(await s.t.run((ctx) => ctx.db.get(saved.safeId!))).toMatchObject({
    name: "Payroll",
    owners: [s.preparation.parentAddress],
    threshold: 1,
    safeAddress: s.preparation.address,
  });
  expect(await s.t.run((ctx) => ctx.db.query("safes").collect())).toHaveLength(
    2,
  );
});

it("durably retries account linking without scheduling another paid execution", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.accountSetupId, { recoveryAt: Date.now() - 1 }),
  );
  await s.t.mutation(internal.accountSetups.recover, {});
  expect(await s.t.query(api.accountSetups.get, s.args)).toMatchObject({
    recoveryAt: Date.now() + 60_000,
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("circleExecutions").collect()),
  ).toHaveLength(0);
  const jobs = await s.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(
    jobs.some(
      (job) =>
        job.name.includes("accountSetups") && job.name.includes("complete"),
    ),
  ).toBe(true);
});

it("rejects a parent that would make its new child exceed supported approval depth", () => {
  const nodes = ["a", "b", "c", "d"].map((address, i, all) => ({
    address,
    nonce: 0,
    threshold: 1,
    owners: [all[i + 1] ?? "human"],
    contracts: all[i + 1] ? [all[i + 1]] : [],
  }));
  expect(() =>
    assertParentHierarchy({ root: "a", blockNumber: "100", nodes }),
  ).toThrow("approval depth");
  expect(() =>
    assertParentHierarchy({
      root: "b",
      blockNumber: "100",
      nodes: nodes.slice(1),
    }),
  ).not.toThrow();
});
