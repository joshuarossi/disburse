import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Hex } from "viem";
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
  encodeCircleRequest,
  type CircleRequest,
} from "../../shared/circleRequest";
import {
  invoiceAddress,
  invoiceSalt,
  RECEIVING_FACTORY_ADDRESS,
} from "../../shared/receivableAddress";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function setup(factory = false) {
  const t = convexTest(schema),
    org = await t.run((ctx) =>
      createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
    );
  await t.run((ctx) => ctx.db.patch(org.safeId, { chainId: 84532 }));
  const { sessionToken } = await signIn(t, "admin");
  const invoiceId = await t.mutation(api.receivables.create, {
    orgId: org.orgId,
    safeId: org.safeId,
    sessionToken,
    number: "TEST-100",
    customerName: "Test customer",
    description: "Test services invoice",
    token: "USDC",
    dueDate: Date.now() + 86400000,
    items: [{ description: "Services", quantity: 1, unitPrice: "1" }],
  });
  await t.run(async (ctx) => {
    const salt = invoiceSalt(org.orgId, invoiceId, 84532);
    await ctx.db.patch(invoiceId, {
      state: "issued",
      factory: RECEIVING_FACTORY_ADDRESS,
      salt,
      receivingAddress: invoiceAddress(
        RECEIVING_FACTORY_ADDRESS,
        org.safeAddress as Hex,
        salt,
      ).toLowerCase(),
      received: "1000000",
    });
  });
  const source = factory
    ? { receivingSetupSafeId: org.safeId }
    : { receivableId: invoiceId };
  const args = { ...source, sessionToken },
    data = await t.run((ctx) =>
      readCircleSource(ctx, source, sessionToken, true),
    );
  if (!data.directCall) throw new Error("Expected receiving call");
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
      nonce: 0n,
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
      ...args,
      snapshot: data.snapshot,
      record: encodeCircleRequest(request),
    });
  return { t, org, source, args, data, request, invoiceId, persist };
}
it.each([false, true])(
  "claims receiving execution once without consuming a payment SafeTx reservation (factory=%s)",
  async (factory) => {
    const s = await setup(factory),
      executionId = await s.persist();
    expect(await s.persist()).toBe(executionId);
    await s.t.run((ctx) => ctx.db.patch(executionId, { stage: "ready" }));
    const input = {
      executionId,
      sessionToken: s.args.sessionToken,
      revision: 0,
      userOpHash: circleOperationHash(84532, s.request.operation),
    };
    await s.t.mutation(internal.circlePayments.claim, input);
    await expect(
      s.t.mutation(internal.circlePayments.claim, input),
    ).rejects.toThrow("already submitted");
    expect(
      await s.t.run((ctx) => ctx.db.query("accountProposals").collect()),
    ).toHaveLength(0);
    expect(await s.t.run((ctx) => ctx.db.get(s.invoiceId))).toMatchObject({
      received: "1000000",
      forwarded: "0",
    });
    expect(await s.t.query(api.circlePayments.get, s.args)).toMatchObject({
      stage: "submitting",
      ...s.source,
    });
  },
);
it("rejects a changed collection target even if its operation calldata is internally consistent", async () => {
  const s = await setup();
  s.request.transaction.to = TEST_WALLETS.viewer;
  s.request.operation.callData = circleAccountCall(
    s.request.transaction.to,
    s.request.transaction.data,
  );
  await expect(s.persist()).rejects.toThrow("reviewed account instruction");
});
it("blocks a second invoice while the first account fee request is open", async () => {
  const s = await setup();
  await s.persist();
  await expect(
    s.t.query(internal.circlePayments.previous, {
      receivingSetupSafeId: s.org.safeId,
      sessionToken: s.args.sessionToken,
    }),
  ).rejects.toThrow("open fee authorization");
});
it.each(["draft", "changed account", "old service", "viewer"] as const)(
  "stops collection when %s invalidates its authorization",
  async (kind) => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      if (kind === "draft") await ctx.db.patch(s.invoiceId, { state: "draft" });
      if (kind === "changed account")
        await ctx.db.patch(s.org.safeId, { chainId: 8453 });
      if (kind === "old service")
        await ctx.db.patch(s.invoiceId, { sweepState: "submitted" });
      if (kind === "viewer") {
        const member = await ctx.db
          .query("orgMemberships")
          .withIndex("by_org_and_user", (q) =>
            q.eq("orgId", s.org.orgId).eq("userId", s.org.userId),
          )
          .unique();
        await ctx.db.patch(member!._id, { role: "viewer" });
      }
    });
    await expect(s.persist()).rejects.toThrow();
    expect(
      await s.t.run((ctx) => ctx.db.query("circleExecutions").collect()),
    ).toHaveLength(0);
  },
);
it("allows late funds at a voided invoice address to be collected", async () => {
  const s = await setup();
  await s.t.run((ctx) => ctx.db.patch(s.invoiceId, { state: "void" }));
  expect(await s.persist()).toBeTruthy();
});
it("rejects mixed payment and receiving identities", async () => {
  const s = await setup();
  await expect(
    s.t.query(api.circlePayments.get, {
      ...s.args,
      receivingSetupSafeId: s.org.safeId,
    }),
  ).rejects.toThrow("one account instruction");
});
