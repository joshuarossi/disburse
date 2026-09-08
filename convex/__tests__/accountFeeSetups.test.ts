import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  type Hex,
} from "viem";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestUser,
  signIn,
  TEST_ACCOUNTS,
  TEST_WALLETS,
} from "./factories";
import type { AccountAuthority } from "../lib/accountAuthority";
import { approvalSigningData } from "../../shared/safeSignatures";
import { accountFeeSetupTransaction } from "../lib/accountFeeSetup";
import { customerWalletExecutionData } from "../../shared/walletCalls";

const state = vi.hoisted(() => ({
  authority: null as AccountAuthority | null,
  changed: false,
  ready: false,
  runtime: vi.fn(),
  call: vi.fn(),
  receipt: vi.fn(),
  tx: vi.fn(),
  logs: vi.fn(),
  block: vi.fn(),
}));
vi.mock("../lib/accountAuthority", async (original) => ({
  ...(await original<typeof import("../lib/accountAuthority")>()),
  readAccountAuthority: async () => structuredClone(state.authority),
  assertSignatureHandler: async () => {},
}));
vi.mock("../lib/accountFeeSetup", async (original) => ({
  ...(await original<typeof import("../lib/accountFeeSetup")>()),
  inspectAccountFeeSetup: async () => ({
    handler: "0x0000000000000000000000000000000000000000",
    enabled: false,
    ready: state.ready,
  }),
  verifyAccountFeeSetup: async (setup: {
    proposal: { safeTransactionData: { nonce: number } };
  }) => {
    if (state.changed)
      throw new Error("The account service configuration changed.");
    if (
      setup.proposal.safeTransactionData.nonce !==
      state.authority!.nodes[0].nonce
    )
      throw new Error("The account transaction number changed.");
  },
}));
vi.mock("../lib/customerPaidAccount", () => ({
  assertCustomerPaidAccount: state.runtime,
}));
vi.mock("../lib/safeVerification", () => ({
  getChainClient: () => ({
    getChainId: async () => 8453,
    getBlockNumber: async () => 123n,
    getBlock: state.block,
    getLogs: state.logs,
    getTransactionReceipt: state.receipt,
    getTransaction: state.tx,
    call: state.call,
    readContract: async () => BigInt(state.authority!.nodes[0].nonce),
  }),
}));
const hash = `0x${"ab".repeat(32)}` as Hex,
  blockHash = `0x${"cd".repeat(32)}` as Hex;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.changed = false;
  state.ready = false;
  state.call.mockResolvedValue({ data: `0x${"00".repeat(31)}01` });
  state.runtime.mockResolvedValue(undefined);
  state.logs.mockResolvedValue([]);
  state.block.mockImplementation(
    async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: blockHash,
    }),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function fixture(nested = false) {
  const t = convexTest(schema),
    ids = await t.run(async (ctx) => {
      const ids = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      await ctx.db.patch(ids.safeId, { chainId: 8453 });
      for (const role of ["approver", "viewer"] as const) {
        const userId = await createTestUser(ctx, {
          walletAddress: TEST_WALLETS[role],
        });
        await ctx.db.insert("orgMemberships", {
          orgId: ids.orgId,
          userId,
          role,
          status: "active",
          createdAt: Date.now(),
        });
      }
      return ids;
    });
  const root = ids.safeAddress.toLowerCase(),
    parent = "0x8888888888888888888888888888888888888888";
  state.authority = {
    root,
    blockNumber: "100",
    nodes: nested
      ? [
          {
            address: root,
            owners: [parent],
            threshold: 1,
            nonce: 3,
            contracts: [parent],
          },
          {
            address: parent,
            owners: [
              TEST_WALLETS.admin.toLowerCase(),
              TEST_WALLETS.approver.toLowerCase(),
            ],
            threshold: 2,
            nonce: 20,
            contracts: [],
          },
        ]
      : [
          {
            address: root,
            owners: [
              TEST_WALLETS.admin.toLowerCase(),
              TEST_WALLETS.approver.toLowerCase(),
            ],
            threshold: 2,
            nonce: 3,
            contracts: [],
          },
        ],
  };
  const admin = await signIn(t, "admin"),
    approver = await signIn(t, "approver"),
    viewer = await signIn(t, "viewer");
  const account = { safeId: ids.safeId, sessionToken: admin.sessionToken },
    requestId = crypto.randomUUID();
  const create = () =>
    t.action(api.accountFeeSetups.prepare, { ...account, requestId });
  const sign = async (
    setupId: Awaited<ReturnType<typeof create>>,
    role: "admin" | "approver",
  ) => {
    const identity = {
      setupId,
      sessionToken: (role === "admin" ? admin : approver).sessionToken,
    };
    const view = await t.action(api.accountFeeSetups.approvals, identity),
      path = view.paths[0].path;
    const signature = await TEST_ACCOUNTS[role].sign({
      hash: approvalSigningData(8453, path, view.proposal.safeTransactionData)
        .hash,
    });
    await t.action(api.accountFeeSetups.approve, {
      ...identity,
      path,
      signature,
    });
  };
  const requested = async () => {
    const setupId = await create();
    await sign(setupId, "admin");
    await sign(setupId, "approver");
    const identity = { setupId, sessionToken: admin.sessionToken },
      claimId = crypto.randomUUID();
    const request = await t.action(api.accountFeeSetups.begin, {
      ...identity,
      claimId,
    });
    return { ...request, identity, claimId };
  };
  return { t, ids, account, admin, approver, viewer, create, sign, requested };
}
it("reserves the current account nonce once and returns the original setup on repeated preparation", async () => {
  const { t, account, create } = await fixture();
  const id = await create();
  expect(await create()).toBe(id);
  const saved = await t.query(api.accountFeeSetups.current, account);
  expect(saved?.proposal.safeTransactionData).toEqual(
    accountFeeSetupTransaction(
      8453,
      state.authority!.root,
      { handler: "0x0000000000000000000000000000000000000000", enabled: false },
      3,
    ),
  );
  expect(
    await t.run((ctx) => ctx.db.query("accountProposals").collect()),
  ).toHaveLength(1);
});
it("requires admin preparation and rejects viewer approvals or wallet claims", async () => {
  const { t, account, approver, viewer, create } = await fixture();
  await expect(
    t.action(api.accountFeeSetups.prepare, {
      ...account,
      sessionToken: approver.sessionToken,
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("administrator");
  const id = await create();
  await expect(t.action(api.accountFeeSetups.check, { setupId: id, sessionToken: viewer.sessionToken })).rejects.toThrow();
  await expect(
    t.action(api.accountFeeSetups.begin, {
      setupId: id,
      sessionToken: viewer.sessionToken,
      claimId: crypto.randomUUID(),
    }),
  ).rejects.toThrow();
});
it("does not open a wallet request until the current direct owner quorum is complete", async () => {
  const { t, admin, create, sign } = await fixture();
  const setupId = await create(),
    identity = { setupId, sessionToken: admin.sessionToken };
  await sign(setupId, "admin");
  await expect(
    t.action(api.accountFeeSetups.begin, {
      ...identity,
      claimId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("current account owners");
  expect(state.call).not.toHaveBeenCalled();
  await sign(setupId, "approver");
  expect((await t.action(api.accountFeeSetups.approvals, identity)).ready).toBe(
    true,
  );
});
it("assembles nested owner quorum without giving the workspace a signing key", async () => {
  const { t, requested } = await fixture(true);
  const request = await requested();
  expect(request.intent.payer.toLowerCase()).toBe(
    TEST_WALLETS.admin.toLowerCase(),
  );
  expect(request.intent.calls).toHaveLength(1);
  expect(request.intent.calls[0].to.toLowerCase()).toBe(state.authority!.root);
  expect(
    (await t.query(internal.accountFeeSetups.context, request.identity)).setup
      .signatures,
  ).toHaveLength(2);
});
it("rejects changed account service settings and stale account nonces before submitting", async () => {
  const { t, admin, create, sign } = await fixture();
  const setupId = await create();
  await sign(setupId, "admin");
  await sign(setupId, "approver");
  const identity = { setupId, sessionToken: admin.sessionToken };
  state.changed = true;
  await expect(
    t.action(api.accountFeeSetups.begin, {
      ...identity,
      claimId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("configuration changed");
  state.changed = false;
  state.authority!.nodes[0].nonce++;
  await expect(
    t.action(api.accountFeeSetups.begin, {
      ...identity,
      claimId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("transaction number changed");
});
it("rejects simulation failure before reserving a submitting attempt", async () => {
  const { t, admin, create, sign } = await fixture();
  const setupId = await create();
  await sign(setupId, "admin");
  await sign(setupId, "approver");
  state.call.mockResolvedValue({ data: "0x00" });
  await expect(
    t.action(api.accountFeeSetups.begin, {
      setupId,
      sessionToken: admin.sessionToken,
      claimId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("account rejected");
  expect((await t.run((ctx) => ctx.db.get(setupId)))?.stage).toBe("approval");
});
it("recovers a lost claim response by the same identity and refuses another paid attempt", async () => {
  const { t, requested } = await fixture();
  const request = await requested();
  expect(
    await t.action(api.accountFeeSetups.begin, {
      ...request.identity,
      claimId: request.claimId,
    }),
  ).toEqual({ batchId: request.batchId, intent: request.intent });
  await expect(
    t.action(api.accountFeeSetups.begin, {
      ...request.identity,
      claimId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("original wallet request");
  expect(state.call).toHaveBeenCalledTimes(1);
});
it("keeps approvals after a decline and refuses a stale decline from the earlier attempt", async () => {
  const { t, requested } = await fixture();
  const r = await requested();
  await t.mutation(api.accountFeeSetups.declined, {
    ...r.identity,
    claimId: r.claimId,
    batchId: r.batchId,
  });
  const saved = (await t.query(internal.accountFeeSetups.context, r.identity))
    .setup;
  expect(saved.stage).toBe("approval");
  expect(saved.signatures).toHaveLength(2);
  expect(saved.batchId).not.toBe(r.batchId);
  await t.action(api.accountFeeSetups.begin, {
    ...r.identity,
    claimId: crypto.randomUUID(),
  });
  await expect(
    t.mutation(api.accountFeeSetups.declined, {
      ...r.identity,
      claimId: r.claimId,
      batchId: r.batchId,
    }),
  ).rejects.toThrow("no longer current");
});
it("releases only an unsigned draft and refuses disconnecting an account with an open setup", async () => {
  const { t, create, admin, account, sign } = await fixture();
  const id = await create(),
    identity = { setupId: id, sessionToken: admin.sessionToken };
  await expect(t.mutation(api.safes.unlink, account)).rejects.toThrow(
    "fee setup",
  );
  await t.mutation(api.accountFeeSetups.discard, identity);
  expect(
    await t.run((ctx) => ctx.db.query("accountProposals").collect()),
  ).toHaveLength(0);
  const next = await t.action(api.accountFeeSetups.prepare, {
    ...account,
    requestId: crypto.randomUUID(),
  });
  await sign(next, "admin");
  await expect(
    t.mutation(api.accountFeeSetups.discard, { ...identity, setupId: next }),
  ).rejects.toThrow("approval evidence");
});
function successReceipt(safe: string, safeTxHash: string) {
  return {
    status: "success",
    transactionHash: hash,
    blockNumber: 110n,
    blockHash,
    logs: [
      {
        address: safe,
        topics: encodeEventTopics({
          abi: parseAbi([
            "event ExecutionSuccess(bytes32 txHash,uint256 payment)",
          ]),
          eventName: "ExecutionSuccess",
        }),
        data: encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }],
          [safeTxHash as Hex, 0n],
        ),
      },
    ],
  };
}
it("verifies the exact Safe execution and service configuration before closing setup", async () => {
  const { t, requested } = await fixture();
  const r = await requested();
  const saved = (await t.query(internal.accountFeeSetups.context, r.identity))
    .setup;
  state.receipt.mockResolvedValue(successReceipt(saved.safeAddress, hash));
  await expect(
    t.action(api.accountFeeSetups.check, { ...r.identity, txHash: hash }),
  ).rejects.toThrow("does not confirm");
  state.receipt.mockResolvedValue(
    successReceipt(saved.safeAddress, saved.proposal.safeTxHash),
  );
  await t.action(api.accountFeeSetups.check, { ...r.identity, txHash: hash });
  expect(state.runtime).toHaveBeenCalledTimes(1);
  expect(
    (await t.query(internal.accountFeeSetups.context, r.identity)).setup.stage,
  ).toBe("complete");
});
it("does not treat an unrelated reverted wallet transaction as permission to retry", async () => {
  const { t, requested } = await fixture();
  const r = await requested();
  state.receipt.mockResolvedValue({
    status: "reverted",
    transactionHash: hash,
    blockNumber: 110n,
    blockHash,
  });
  state.tx.mockResolvedValue({
    from: r.intent.payer,
    to: r.intent.payer,
    value: 0n,
    input: "0x1234",
  });
  await expect(
    t.action(api.accountFeeSetups.check, { ...r.identity, txHash: hash }),
  ).rejects.toThrow("original wallet request");
  expect(
    (await t.query(internal.accountFeeSetups.context, r.identity)).setup.stage,
  ).toBe("requested");
  state.tx.mockResolvedValue({
    from: r.intent.payer,
    to: r.intent.payer,
    value: 0n,
    input: customerWalletExecutionData(r.intent),
  });
  await t.action(api.accountFeeSetups.check, { ...r.identity, txHash: hash });
  expect(
    (await t.query(internal.accountFeeSetups.context, r.identity)).setup.stage,
  ).toBe("approval");
  await t.action(api.accountFeeSetups.begin, {
    ...r.identity,
    claimId: crypto.randomUUID(),
  });
  await expect(
    t.action(api.accountFeeSetups.check, { ...r.identity, txHash: hash }),
  ).rejects.toThrow("current setup attempt");
});
it("background receipt recovery finishes without a wallet response and never submits", async () => {
  const { t, requested } = await fixture();
  const r = await requested(),
    saved = (await t.query(internal.accountFeeSetups.context, r.identity))
      .setup;
  const receipt = successReceipt(saved.safeAddress, saved.proposal.safeTxHash);
  state.receipt.mockResolvedValue(receipt);
  state.logs.mockResolvedValue([
    { ...receipt.logs[0], transactionHash: hash, removed: false },
  ]);
  await t.action(internal.accountFeeSetups.reconcile, {
    setupId: r.identity.setupId,
  });
  expect(
    (await t.query(internal.accountFeeSetups.context, r.identity)).setup.stage,
  ).toBe("complete");
  expect(state.call).toHaveBeenCalledTimes(1);
});
it("preserves recovery on provider failure and restarts a reorged checkpoint", async () => {
  const { t, requested } = await fixture();
  const r = await requested();
  state.logs.mockRejectedValueOnce(new Error("offline"));
  await t.action(internal.accountFeeSetups.reconcile, {
    setupId: r.identity.setupId,
  });
  expect(
    (await t.query(internal.accountFeeSetups.context, r.identity)).setup
      .scanFrom,
  ).toBe("100");
  await t.run((ctx) =>
    ctx.db.patch(r.identity.setupId, { scanFrom: "110", scanHash: hash }),
  );
  await t.action(internal.accountFeeSetups.reconcile, {
    setupId: r.identity.setupId,
  });
  expect(state.logs).toHaveBeenLastCalledWith(
    expect.objectContaining({ fromBlock: 100n }),
  );
});

it("closes a superseded setup only after scanning confirmed history through its consumed nonce", async () => {
  const { t, requested } = await fixture();
  const r = await requested();
  state.authority!.nodes[0].nonce = 4;
  await t.action(internal.accountFeeSetups.reconcile, {
    setupId: r.identity.setupId,
  });
  const result = (await t.query(internal.accountFeeSetups.context, r.identity))
    .setup;
  expect(result.stage).toBe("failed");
  expect(result.open).toBe(false);
  expect(result.error).toContain("Another confirmed account transaction");
  expect(result.txHash).toBeUndefined();
});
it("does not leave a nonce gap by discarding setup beneath a later account proposal", async () => {
  const { t, create, admin } = await fixture();
  const setupId = await create();
  await t.run(async (ctx) => {
    const setup = (await ctx.db.get(setupId))!;
    await ctx.db.insert("accountProposals", {
      accountKey: setup.accountKey,
      nonce: 4,
      proposal: {
        ...setup.proposal,
        safeTransactionData: {
          ...setup.proposal.safeTransactionData,
          nonce: 4,
        },
      },
      createdAt: Date.now(),
    });
  });
  await expect(
    t.mutation(api.accountFeeSetups.discard, {
      setupId,
      sessionToken: admin.sessionToken,
    }),
  ).rejects.toThrow("Later account transactions");
  expect(
    await t.run((ctx) => ctx.db.query("accountProposals").collect()),
  ).toHaveLength(2);
});

it("does not count declined wallet prompts as paid execution failures or lock out later attempts", async () => {
  const { t, requested } = await fixture();
  const r = await requested();
  await t.run((ctx) => ctx.db.patch(r.identity.setupId, { attempt: 60 }));
  await t.mutation(api.accountFeeSetups.declined, {
    ...r.identity,
    claimId: r.claimId,
    batchId: r.batchId,
  });
  const saved = (await t.query(internal.accountFeeSetups.context, r.identity))
    .setup;
  expect(saved.stage).toBe("approval");
  expect(saved.attempt).toBe(61);
  expect(saved.failedHashes).toEqual([]);
  await expect(
    t.action(api.accountFeeSetups.begin, {
      ...r.identity,
      claimId: crypto.randomUUID(),
    }),
  ).resolves.toBeDefined();
});
