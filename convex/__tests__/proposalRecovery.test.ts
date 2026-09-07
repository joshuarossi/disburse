import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import schema from "../schema";
import { api } from "../_generated/api";
import { CHAIN_TOKENS } from "../../shared/chains";
import type { PreparedOwnerProposal } from "../../shared/ownerProposal";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  signIn,
  TEST_ACCOUNTS,
  TEST_WALLETS,
} from "./factories";

const chain = vi.hoisted(() => ({
  hash: `0x${"ab".repeat(32)}`,
  owners: [] as string[],
}));
vi.mock("../lib/safeIdentity", () => ({ assertSafeIdentity: async () => {} }));
vi.mock("../lib/safeVerification", () => ({
  getChainClient: () => ({
    getBlockNumber: async () => 100n,
    readContract: async ({ functionName }: { functionName: string }) =>
      ({
        getTransactionHash: chain.hash,
        getOwners: chain.owners,
        getThreshold: 2n,
        nonce: 3n,
      })[functionName],
  }),
}));

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const b = await createTestBeneficiary(ctx, ids.orgId, {
      walletAddress: TEST_WALLETS.approver,
    });
    const disbursementId = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      b,
      ids.userId,
      { amount: "0.000001", status: "pending" },
    );
    await ctx.db.patch(disbursementId, {
      recipientAddress: TEST_WALLETS.approver,
    });
    return { ...ids, disbursementId };
  });
  const { sessionToken } = await signIn(t, "admin");
  chain.owners = [TEST_WALLETS.admin];
  const zero = "0x0000000000000000000000000000000000000000";
  const proposal: PreparedOwnerProposal = {
    safeAddress: ids.safeAddress,
    safeTxHash: chain.hash,
    senderAddress: TEST_WALLETS.admin,
    senderSignature: await TEST_ACCOUNTS.admin.sign({
      hash: chain.hash as `0x${string}`,
    }),
    safeTransactionData: {
      to: CHAIN_TOKENS[11155111].USDC.address,
      value: "0",
      operation: 0,
      data: encodeFunctionData({
        abi: parseAbi(["function transfer(address,uint256)"]),
        functionName: "transfer",
        args: [TEST_WALLETS.approver as `0x${string}`, 1n],
      }),
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: zero,
      refundReceiver: zero,
      nonce: 3,
    },
  };
  return {
    t,
    ids,
    args: { disbursementId: ids.disbursementId, sessionToken, proposal },
  };
}

it('recovers an original signed proposal without posting it again or changing its nonce', async () => {
  const { t, ids, args } = await setup();
  await t.run(async ctx => {
    await ctx.db.insert('ownerProposals', { disbursementId: ids.disbursementId, proposal: args.proposal, createdAt: Date.now() });
    await ctx.db.patch(ids.disbursementId, { safeTxHash: args.proposal.safeTxHash, preparedProposalAt: Date.now() });
  });
  const identity = { disbursementId: ids.disbursementId, sessionToken: args.sessionToken };
  await expect(t.action(api.accountApprovals.recoverOriginal, identity)).resolves.toBe(chain.hash);
  await expect(t.action(api.accountApprovals.recoverOriginal, identity)).resolves.toBe(chain.hash);
  const recovered = await t.run(async ctx => ({ proposal: await ctx.db.query('accountProposals').unique(), signatures: await ctx.db.query('accountSignatures').collect(), payment: await ctx.db.get(ids.disbursementId) }));
  expect(recovered.proposal?.proposal.safeTransactionData).toEqual(args.proposal.safeTransactionData);
  expect(recovered.signatures).toHaveLength(1);
  expect(recovered.signatures[0].signature).toBe(args.proposal.senderSignature);
  expect(recovered.payment?.approvalMethod).toBe('workspace');
});
it('does not expose an original signature to another workspace', async () => {
  const { t, ids, args } = await setup();
  await t.run(ctx => ctx.db.patch(ids.disbursementId, { safeTxHash: args.proposal.safeTxHash }));
  const outsider = await signIn(t, 'nonMember');
  await expect(t.action(api.accountApprovals.recoverOriginal, { disbursementId: ids.disbursementId, sessionToken: outsider.sessionToken })).rejects.toThrow();
});
