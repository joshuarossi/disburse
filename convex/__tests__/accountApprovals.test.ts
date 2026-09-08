import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import { keccak256, type Hex } from "viem";
import schema from "../schema";
import { api } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  createTestUser,
  signIn,
  TEST_ACCOUNTS,
  TEST_WALLETS,
} from "./factories";
import {
  approvalSigningData,
  transactionSigningData,
  packSafeSignatures,
} from "../../shared/safeSignatures";
import { prepareAccountTransaction } from "../lib/accountApproval";
import { assertPaymentIntent } from "../../shared/paymentIntent";
import { CHAIN_TOKENS } from "../../shared/chains";
import type { AccountAuthority } from "../lib/accountAuthority";
const parent = "0x8888888888888888888888888888888888888888";
const rpc = vi.hoisted(() => ({
  graph: null as AccountAuthority | null,
  check: vi.fn(),
}));
vi.mock("../lib/safeIdentity", () => ({ assertSafeIdentity: async () => {} }));
vi.mock("../lib/accountAuthority", async (original) => ({
  ...(await original<typeof import("../lib/accountAuthority")>()),
  readAccountAuthority: async () => structuredClone(rpc.graph),
  assertSignatureHandler: async () => {},
}));
vi.mock("../lib/safeVerification", () => ({
  getChainClient: () => ({
    getBlockNumber: async () => 123n,
    readContract: async ({
      functionName,
      address,
      args,
    }: {
      functionName: string;
      address: string;
      args: any[];
    }) => {
      const node = rpc.graph!.nodes.find(
        (n) => n.address === address.toLowerCase(),
      )!;
      if (functionName === "getOwners") return node.owners;
      if (functionName === "getThreshold") return BigInt(node.threshold);
      if (functionName === "nonce") return BigInt(node.nonce);
      if (functionName === "checkNSignatures") return rpc.check(args);
      if (functionName === "getTransactionHash") {
        const [
          to,
          value,
          data,
          operation,
          safeTxGas,
          baseGas,
          gasPrice,
          gasToken,
          refundReceiver,
          nonce,
        ] = args;
        return keccak256(
          transactionSigningData(11155111, address, {
            to,
            value: String(value),
            data,
            operation,
            safeTxGas: String(safeTxGas),
            baseGas: String(baseGas),
            gasPrice: String(gasPrice),
            gasToken,
            refundReceiver,
            nonce: Number(nonce),
          }),
        );
      }
      throw new Error(`Unexpected call: ${functionName}`);
    },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  rpc.check.mockResolvedValue(undefined);
});
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const userId = await createTestUser(ctx, {
      walletAddress: TEST_WALLETS.approver,
    });
    await ctx.db.insert("orgMemberships", {
      orgId: ids.orgId,
      userId,
      role: "approver",
      status: "active",
      createdAt: Date.now(),
    });
    const beneficiaryId = await createTestBeneficiary(ctx, ids.orgId, {
      walletAddress: TEST_WALLETS.viewer,
    });
    const disbursementId = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      beneficiaryId,
      ids.userId,
      { amount: "0.000001", status: "pending" },
    );
    await ctx.db.patch(disbursementId, {
      recipientAddress: TEST_WALLETS.viewer,
    });
    await ctx.db.patch(ids.safeId, {
      name: "Payroll",
      owners: [parent],
      threshold: 1,
    });
    return { ...ids, disbursementId };
  });
  const root = ids.safeAddress.toLowerCase();
  rpc.graph = {
    root,
    blockNumber: "123",
    nodes: [
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
        nonce: 42,
        contracts: [],
      },
    ],
  };
  const admin = {
    disbursementId: ids.disbursementId,
    sessionToken: (await signIn(t, "admin")).sessionToken,
  };
  const approver = {
    ...admin,
    sessionToken: (await signIn(t, "approver")).sessionToken,
  };
  const sign = async (role: "admin" | "approver" = "admin") => {
    const args = role === "admin" ? admin : approver;
    const request = await t.action(api.accountApprovals.forSigning, args);
    const path = request.paths[0].path;
    const signature = await TEST_ACCOUNTS[role].sign({
      hash: approvalSigningData(
        11155111,
        path,
        request.proposal.safeTransactionData,
      ).hash,
    });
    return { ...args, proposal: request.proposal, path, signature };
  };
  return { t, ids, admin, approver, sign };
}
it("requires both parent approvers, persists exact approvals through reload, and validates the contract signature before execution", async () => {
  const { t, admin, sign } = await setup();
  const first = await sign();
  await t.action(api.accountApprovals.save, first);
  await t.mutation(api.disbursements.updateStatus, {
    ...admin,
    status: "proposed",
    safeTxHash: first.proposal.safeTxHash,
  });
  const partial = await t.action(api.paymentExecution.approvalStatus, admin);
  expect(partial).toMatchObject({
    owners: [parent],
    threshold: 1,
    confirmedOwners: [],
    ready: false,
  });
  expect(
    partial.workspace?.groups.find((g) => g.address === parent),
  ).toMatchObject({
    threshold: 2,
    confirmedOwners: [TEST_WALLETS.admin.toLowerCase()],
  });
  await expect(t.action(api.accountApprovals.execution, admin)).rejects.toThrow(
    "needs owner signatures",
  );
  const second = await sign("approver");
  expect(second.proposal.safeTxHash).toBe(first.proposal.safeTxHash);
  await t.action(api.accountApprovals.save, second);
  await t.action(api.accountApprovals.save, second);
  const complete = await t.action(api.paymentExecution.approvalStatus, admin);
  expect(complete).toMatchObject({
    owners: [parent],
    threshold: 1,
    confirmedOwners: [parent],
    ready: true,
  });
  expect(complete.confirmedOwners).not.toContain(
    TEST_WALLETS.admin.toLowerCase(),
  );
  expect(rpc.check).toHaveBeenCalled();
  expect((await t.action(api.accountApprovals.execution, admin)).data).toMatch(
    /^0x/,
  );
  expect(
    await t.run((ctx) => ctx.db.query("accountSignatures").collect()),
  ).toHaveLength(2);
});
it("rejects changed recipient amounts, the wrong parent domain and transitive direct-owner signatures", async () => {
  const { t, sign } = await setup();
  const first = await sign();
  const wrong = await TEST_ACCOUNTS.admin.sign({
    hash: first.proposal.safeTxHash as Hex,
  });
  await expect(
    t.action(api.accountApprovals.save, { ...first, signature: wrong }),
  ).rejects.toThrow("signature");
  await expect(
    t.action(api.accountApprovals.save, {
      ...first,
      path: [first.path[0]],
      signature: wrong,
    }),
  ).rejects.toThrow("authority");
  await expect(
    t.action(api.accountApprovals.save, {
      ...first,
      proposal: {
        ...first.proposal,
        safeTransactionData: {
          ...first.proposal.safeTransactionData,
          value: "1",
        },
      },
    }),
  ).rejects.toThrow("unexpected native");
  expect(
    await t.run((ctx) => ctx.db.query("accountProposals").collect()),
  ).toEqual([]);
});
it("removed owners stop contributing without erasing their signed evidence", async () => {
  const { t, admin, sign } = await setup();
  await t.action(api.accountApprovals.save, await sign());
  await t.action(api.accountApprovals.save, await sign("approver"));
  rpc.graph!.nodes[1].owners = [
    TEST_WALLETS.approver.toLowerCase(),
    TEST_WALLETS.viewer.toLowerCase(),
  ];
  const status = await t.action(api.paymentExecution.approvalStatus, admin);
  expect(status.ready).toBe(false);
  expect(status.workspace?.paths).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("accountSignatures").collect()),
  ).toHaveLength(2);
});
it("current on-chain signature validation failure blocks execution even when stored approvals meet the threshold", async () => {
  const { t, admin, sign } = await setup();
  await t.action(api.accountApprovals.save, await sign());
  await t.action(api.accountApprovals.save, await sign("approver"));
  rpc.check.mockRejectedValue(new Error("GS024 invalid contract signature"));
  await expect(t.action(api.accountApprovals.execution, admin)).rejects.toThrow(
    "GS024",
  );
});
it("rejects approvals from another workspace, closed payments and changed account nonces", async () => {
  const { t, ids, admin, sign } = await setup();
  const first = await sign();
  const outsider = await signIn(t, "nonMember");
  await expect(
    t.action(api.accountApprovals.forSigning, {
      ...admin,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow();
  rpc.graph!.nodes[0].nonce = 4;
  await expect(t.action(api.accountApprovals.save, first)).rejects.toThrow(
    "already been used",
  );
  rpc.graph!.nodes[0].nonce = 3;
  await t.run((ctx) =>
    ctx.db.patch(ids.disbursementId, { status: "cancelled" }),
  );
  await expect(t.action(api.accountApprovals.save, first)).rejects.toThrow(
    "cannot accept",
  );
});
it("concurrent retries record a single approval and signatures are bound to their payment nonce", async () => {
  const { t, sign, admin } = await setup();
  const first = await sign();
  await Promise.all([
    t.action(api.accountApprovals.save, first),
    t.action(api.accountApprovals.save, first),
  ]);
  expect(
    await t.run((ctx) => ctx.db.query("accountProposals").collect()),
  ).toHaveLength(1);
  expect(
    await t.run((ctx) => ctx.db.query("accountSignatures").collect()),
  ).toHaveLength(1);
  const other = {
    ...first,
    proposal: {
      ...first.proposal,
      safeTransactionData: { ...first.proposal.safeTransactionData, nonce: 4 },
    },
  };
  await expect(t.action(api.accountApprovals.save, other)).rejects.toThrow();
  expect(
    (await t.action(api.accountApprovals.forSigning, admin)).paths[0].approved,
  ).toBe(true);
});
it("server-built batches preserve every recipient principal with a separately authorized fee token", () => {
  const expected = {
    chainId: 8453,
    token: "USDC",
    recipients: [
      { recipientAddress: TEST_WALLETS.admin, amount: "1.000001" },
      { recipientAddress: TEST_WALLETS.approver, amount: "2.000002" },
    ],
    executionFee: {
      token: "USDT",
      tokenAddress: CHAIN_TOKENS[8453].USDT!.address,
      amount: "0.05",
      collector: TEST_WALLETS.viewer,
    },
  };
  const call = prepareAccountTransaction(expected, 8);
  expect(call.operation).toBe(1);
  expect(() =>
    assertPaymentIntent(
      call,
      { ...expected, tokenAddress: CHAIN_TOKENS[8453].USDC.address },
      [call.to],
    ),
  ).not.toThrow();
  expect(() =>
    assertPaymentIntent(
      call,
      {
        ...expected,
        recipients: expected.recipients.map((r) => ({ ...r, amount: "2" })),
        tokenAddress: CHAIN_TOKENS[8453].USDC.address,
      },
      [call.to],
    ),
  ).toThrow("do not match");
});
it("contract signature offsets are recalculated after sorting and duplicate signers are rejected", () => {
  const direct = {
    owner: "0x1111111111111111111111111111111111111111",
    signature: `0x${"aa".repeat(64)}1b`,
  };
  const nested = {
    owner: parent,
    signature: `0x${"bb".repeat(64)}1c`,
    isContractSignature: true,
  };
  const packed = packSafeSignatures([nested, direct]);
  expect(packed.slice(2, 132)).toBe(direct.signature.slice(2));
  expect(BigInt(`0x${packed.slice(196, 260)}`)).toBe(130n);
  expect(packed.slice(260, 262)).toBe("00");
  expect(() => packSafeSignatures([direct, direct])).toThrow("duplicate");
});

it("keeps a reviewed parent approval tied to its original account despite another linked account on the same network", async () => {
  const { t, ids, sign } = await setup();
  const first = await sign();
  await t.action(api.accountApprovals.save, first);
  await t.run(async (ctx) => {
    const safe = await ctx.db.get(ids.safeId);
    const { _id, _creationTime, ...fields } = safe!;
    void _id;
    void _creationTime;
    await ctx.db.insert("safes", {
      ...fields,
      safeAddress: "0x9999999999999999999999999999999999999999",
      name: "Reserves",
    });
  });
  expect((await sign("approver")).proposal.safeAddress).toBe(
    first.proposal.safeAddress,
  );
  expect((await sign("approver")).path[0]).toBe(ids.safeAddress.toLowerCase());
});

it("collects simultaneous parent signatures once without prompting either owner to sign again", async () => {
  const { t, ids, admin, approver, sign } = await setup();
  const first = await sign("admin"),
    second = await sign("approver");
  await Promise.all([
    t.action(api.accountApprovals.save, first),
    t.action(api.accountApprovals.save, second),
  ]);
  await t.mutation(api.disbursements.updateStatus, {
    ...admin,
    status: "proposed",
    safeTxHash: first.proposal.safeTxHash,
  });
  const saved = await t.run((ctx) =>
    ctx.db
      .query("accountSignatures")
      .withIndex("by_payment", (q) =>
        q.eq("disbursementId", ids.disbursementId),
      )
      .collect(),
  );
  expect(saved).toHaveLength(2);
  expect(new Set(saved.map((s) => s.owner)).size).toBe(2);
  expect(
    (await t.action(api.paymentExecution.approvalStatus, approver)).ready,
  ).toBe(true);
  await t.action(api.accountApprovals.save, first);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("accountSignatures")
        .withIndex("by_payment", (q) =>
          q.eq("disbursementId", ids.disbursementId),
        )
        .collect(),
    ),
  ).toHaveLength(2);
});
