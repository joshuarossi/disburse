import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { ORG_READER_ROLES } from "../shared/roles";
import { appendAudit } from "./audit";
import { assertCircleReservation } from "./lib/circleSource";
import { approvalPaths, readAccountAuthority } from "./lib/accountAuthority";
import {
  accountFeeSetupTransaction,
  inspectAccountFeeSetup,
  verifyAccountFeeSetup,
} from "./lib/accountFeeSetup";
import { approvalSigningData } from "../shared/safeSignatures";
import { ownerProposalValidator } from "./lib/ownerProposalValidator";
import {
  assembleAccountApprovals,
  verifyAccountSignature,
} from "./lib/accountApproval";
import { encodeExecTransaction } from "./lib/encodeSafeExecution";
import { getChainClient } from "./lib/safeVerification";
import { assertCustomerPaidAccount } from "./lib/customerPaidAccount";
import { assertReceiptConfirmations } from "../shared/confirmations";
import { accountChangeReceiptOutcome } from "./lib/accountChange";
import { accountExecutionOutcome } from "../shared/accountExecution";
import {
  customerWalletExecutionData,
  type WalletCalls,
} from "../shared/walletCalls";
import { keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import type { AccountApprovalView } from "../shared/accountApprovalView";

const accountIdentity = { safeId: v.id("safes"), sessionToken: v.string() };
const identity = {
  setupId: v.id("accountFeeSetups"),
  sessionToken: v.string(),
};
const batchId = (id: string, attempt: number) =>
  keccak256(toHex(`disburse:account-fees:${id}:${attempt}`));
const uuid = (value: string) =>
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
async function account(
  ctx: QueryCtx,
  safeId: Id<"safes">,
  sessionToken: string,
  write = false,
) {
  const safe = await ctx.db.get(safeId);
  if (!safe) throw new Error("Company account not found.");
  const access = await requireOrgAccess(
    ctx,
    safe.orgId,
    sessionToken,
    write ? ["admin", "approver"] : [...ORG_READER_ROLES],
  );
  return { safe, ...access };
}
export const current = query({
  args: accountIdentity,
  handler: async (ctx, args) => {
    await account(ctx, args.safeId, args.sessionToken);
    return ctx.db
      .query("accountFeeSetups")
      .withIndex("by_safe", (q) => q.eq("safeId", args.safeId))
      .order("desc")
      .first();
  },
});
export const creationContext = internalQuery({
  args: accountIdentity,
  handler: async (ctx, args) => {
    const access = await account(ctx, args.safeId, args.sessionToken, true);
    const { safe } = access;
    const key = `${safe.chainId}:${safe.safeAddress.toLowerCase()}`;
    const open = await ctx.db
      .query("accountFeeSetups")
      .withIndex("by_account_open", (q) =>
        q.eq("accountKey", key).eq("open", true),
      )
      .first();
    if (open && open.safeId !== safe._id)
      throw new Error(
        "This account has a pending setup in another workspace. Complete that request first.",
      );
    const latest = await ctx.db
      .query("accountProposals")
      .withIndex("by_account_nonce", (q) => q.eq("accountKey", key))
      .order("desc")
      .first();
    return { ...access, open, latestNonce: latest?.nonce ?? -1 };
  },
});
export const inspect = action({
  args: accountIdentity,
  handler: async (ctx, args): Promise<{ ready: boolean }> => {
    const { safe } = await ctx.runQuery(
      internal.accountFeeSetups.creationContext,
      args,
    );
    const authority = await readAccountAuthority(
      safe.chainId,
      safe.safeAddress,
    );
    return {
      ready: (
        await inspectAccountFeeSetup(
          safe.chainId,
          safe.safeAddress,
          BigInt(authority.blockNumber),
        )
      ).ready,
    };
  },
});
export const prepare = action({
  args: { ...accountIdentity, requestId: v.string() },
  handler: async (ctx, args): Promise<Id<"accountFeeSetups">> => {
    if (!uuid(args.requestId))
      throw new Error("Invalid account setup request.");
    const { safe, user, membership, open, latestNonce } = await ctx.runQuery(
      internal.accountFeeSetups.creationContext,
      { safeId: args.safeId, sessionToken: args.sessionToken },
    );
    if (open) return open._id;
    if (membership.role !== "admin" || safe.isActive === false)
      throw new Error(
        "An administrator must prepare setup for an active account.",
      );
    const authority = await readAccountAuthority(
      safe.chainId,
      safe.safeAddress,
    );
    const state = await inspectAccountFeeSetup(
      safe.chainId,
      safe.safeAddress,
      BigInt(authority.blockNumber),
    );
    if (latestNonce >= authority.nodes[0].nonce)
      throw new Error(
        "Complete the pending account transactions before setting up USDC fees.",
      );
    const tx = accountFeeSetupTransaction(
      safe.chainId,
      safe.safeAddress,
      state,
      authority.nodes[0].nonce,
    );
    const proposal = {
      safeAddress: safe.safeAddress,
      safeTxHash: approvalSigningData(safe.chainId, [authority.root], tx).hash,
      senderAddress: user.walletAddress,
      senderSignature: "0x",
      safeTransactionData: tx,
    };
    await verifyAccountFeeSetup(
      {
        ...state,
        chainId: safe.chainId,
        safeAddress: safe.safeAddress,
        proposal,
      },
      authority,
    );
    return ctx.runMutation(internal.accountFeeSetups.persist, {
      ...args,
      handler: state.handler,
      enabled: state.enabled,
      proposal,
      startBlock: authority.blockNumber,
      latestNonce,
    });
  },
});
export const persist = internalMutation({
  args: {
    ...accountIdentity,
    requestId: v.string(),
    handler: v.string(),
    enabled: v.boolean(),
    proposal: ownerProposalValidator,
    startBlock: v.string(),
    latestNonce: v.number(),
  },
  handler: async (ctx, args) => {
    const { safe, user, membership } = await account(
      ctx,
      args.safeId,
      args.sessionToken,
      true,
    );
    if (membership.role !== "admin" || safe.isActive === false)
      throw new Error(
        "An administrator must prepare setup for an active account.",
      );
    const accountKey = `${safe.chainId}:${safe.safeAddress.toLowerCase()}`;
    await assertCircleReservation(ctx, safe._id);
    const open = await ctx.db
      .query("accountFeeSetups")
      .withIndex("by_account_open", (q) =>
        q.eq("accountKey", accountKey).eq("open", true),
      )
      .first();
    if (open) {
      if (open.safeId !== safe._id)
        throw new Error("Complete the original account setup first.");
      return open._id;
    }
    const old = await ctx.db
      .query("accountFeeSetups")
      .withIndex("by_request", (q) =>
        q.eq("orgId", safe.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (old)
      throw new Error(
        "This setup request is already closed. Refresh the account before preparing another.",
      );
    const latest = await ctx.db
      .query("accountProposals")
      .withIndex("by_account_nonce", (q) => q.eq("accountKey", accountKey))
      .order("desc")
      .first();
    if (
      (latest?.nonce ?? -1) !== args.latestNonce ||
      args.proposal.safeTransactionData.nonce <= args.latestNonce
    )
      throw new Error(
        "Another account transaction was prepared. Review the account again.",
      );
    const id = await ctx.db.insert("accountFeeSetups", {
      orgId: safe.orgId,
      safeId: safe._id,
      accountKey,
      chainId: safe.chainId,
      safeAddress: safe.safeAddress,
      createdBy: user._id,
      requestId: args.requestId,
      handler: args.handler,
      enabled: args.enabled,
      proposal: args.proposal,
      signatures: [],
      stage: "approval",
      open: true,
      attempt: 0,
      batchId: "",
      startBlock: args.startBlock,
      failedHashes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(id, { batchId: batchId(id, 0) });
    await ctx.db.insert("accountProposals", {
      accountFeeSetupId: id,
      accountKey,
      nonce: args.proposal.safeTransactionData.nonce,
      proposal: args.proposal,
      createdAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: safe.orgId,
      actorUserId: user._id,
      action: "account.fee_setup_prepared",
      objectType: "account_fee_setup",
      objectId: id,
      metadata: { safeId: safe._id, safeTxHash: args.proposal.safeTxHash },
    });
    return id;
  },
});
export const context = internalQuery({
  args: {
    setupId: v.id("accountFeeSetups"),
    sessionToken: v.optional(v.string()),
    write: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) throw new Error("The account setup request was not found.");
    const access = args.sessionToken
      ? await account(ctx, setup.safeId, args.sessionToken, args.write)
      : null;
    const safe = access?.safe ?? (await ctx.db.get(setup.safeId));
    if (
      !safe ||
      safe.orgId !== setup.orgId ||
      safe.chainId !== setup.chainId ||
      safe.safeAddress.toLowerCase() !== setup.safeAddress.toLowerCase()
    )
      throw new Error("The original company account changed.");
    if (args.write && safe.isActive === false)
      throw new Error("Reconnect the original account before continuing.");
    return { setup, safe, user: access?.user, membership: access?.membership };
  },
});
export const approvals = action({
  args: identity,
  handler: async (ctx, args): Promise<AccountApprovalView> => {
    const { setup, user } = await ctx.runQuery(
      internal.accountFeeSetups.context,
      args,
    );
    const authority = await readAccountAuthority(
      setup.chainId,
      setup.safeAddress,
    );
    const assembled = await assembleAccountApprovals(
      setup.chainId,
      authority,
      setup.proposal,
      setup.signatures,
    );
    let blockedReason: string | null = null;
    try {
      await verifyAccountFeeSetup(setup, authority);
    } catch (e) {
      blockedReason =
        e instanceof Error
          ? e.message
          : "The account configuration could not be verified.";
    }
    return {
      proposal: setup.proposal,
      groups: assembled.groups,
      names: [],
      currentNonce: authority.nodes[0].nonce,
      ready:
        setup.stage === "approval" &&
        !blockedReason &&
        assembled.confirmations.length >= authority.nodes[0].threshold,
      blockedReason,
      paths: approvalPaths(authority, user!.walletAddress).map((path) => ({
        path,
        labels: path.map((a) => `${a.slice(0, 8)}…${a.slice(-6)}`),
        approved: setup.signatures.some(
          (s) =>
            s.owner === user!.walletAddress.toLowerCase() &&
            s.path.join(":") === path.join(":"),
        ),
      })),
    };
  },
});
export const approve = action({
  args: { ...identity, path: v.array(v.string()), signature: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const { setup, user } = await ctx.runQuery(
      internal.accountFeeSetups.context,
      { setupId: args.setupId, sessionToken: args.sessionToken, write: true },
    );
    if (setup.stage !== "approval")
      throw new Error("This setup no longer accepts approvals.");
    const authority = await readAccountAuthority(
      setup.chainId,
      setup.safeAddress,
    );
    await verifyAccountFeeSetup(setup, authority);
    const signed = {
      path: args.path.map((a) => a.toLowerCase()),
      owner: user!.walletAddress.toLowerCase(),
      signature: args.signature,
    };
    const digest = await verifyAccountSignature(
      setup.chainId,
      authority,
      setup.proposal,
      signed,
    );
    await ctx.runMutation(internal.accountFeeSetups.saveSignature, {
      ...args,
      digest,
    });
  },
});
export const saveSignature = internalMutation({
  args: {
    ...identity,
    path: v.array(v.string()),
    signature: v.string(),
    digest: v.string(),
  },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup || setup.stage !== "approval")
      throw new Error("This setup no longer accepts approvals.");
    const { user } = await account(ctx, setup.safeId, args.sessionToken, true);
    const path = args.path.map((a) => a.toLowerCase()),
      owner = user.walletAddress.toLowerCase();
    const existing = setup.signatures.find(
      (s) => s.owner === owner && s.path.join(":") === path.join(":"),
    );
    if (existing) {
      if (existing.digest !== args.digest)
        throw new Error("The original approval cannot be replaced.");
      return;
    }
    if (setup.signatures.length >= 500)
      throw new Error("This request exceeds the approval evidence limit.");
    await ctx.db.patch(setup._id, {
      signatures: [
        ...setup.signatures,
        { path, owner, signature: args.signature, digest: args.digest },
      ],
      recoveryAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: setup.orgId,
      actorUserId: user._id,
      action: "account.fee_setup_approved",
      objectType: "account_fee_setup",
      objectId: setup._id,
      metadata: { digest: args.digest, path },
    });
  },
});

export const begin = action({
  args: { ...identity, claimId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ batchId: string; intent: WalletCalls }> => {
    if (!uuid(args.claimId))
      throw new Error("Invalid wallet request identifier.");
    const { setup, user } = await ctx.runQuery(
      internal.accountFeeSetups.context,
      { setupId: args.setupId, sessionToken: args.sessionToken, write: true },
    );
    if (
      setup.stage === "requested" &&
      setup.claimId === args.claimId &&
      setup.payer?.toLowerCase() === user!.walletAddress.toLowerCase()
    )
      return { batchId: setup.batchId, intent: walletIntent(setup) };
    if (setup.stage !== "approval")
      throw new Error("Check the original wallet request before trying again.");
    const authority = await readAccountAuthority(
      setup.chainId,
      setup.safeAddress,
    );
    await verifyAccountFeeSetup(setup, authority);
    const assembled = await assembleAccountApprovals(
      setup.chainId,
      authority,
      setup.proposal,
      setup.signatures,
    );
    if (assembled.confirmations.length < authority.nodes[0].threshold)
      throw new Error(
        "The current account owners must finish approving this setup.",
      );
    const data = encodeExecTransaction({
      ...setup.proposal.safeTransactionData,
      confirmations: assembled.confirmations,
    });
    const client = getChainClient(setup.chainId);
    const simulation = await client.call({
      account: user!.walletAddress as Address,
      to: setup.safeAddress as Address,
      data: data as Hex,
      blockNumber: BigInt(authority.blockNumber),
    });
    if (!simulation.data || BigInt(simulation.data) !== 1n)
      throw new Error(
        "The account rejected this setup. Check the current owner approvals.",
      );
    await ctx.runMutation(internal.accountFeeSetups.claim, {
      ...args,
      callData: data,
      expectedUpdatedAt: setup.updatedAt,
    });
    return {
      batchId: setup.batchId,
      intent: {
        chainId: setup.chainId,
        payer: user!.walletAddress as Address,
        calls: [{ to: setup.safeAddress as Address, data: data as Hex }],
      },
    };
  },
});
export const claim = internalMutation({
  args: {
    ...identity,
    claimId: v.string(),
    callData: v.string(),
    expectedUpdatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) throw new Error("Account setup not found.");
    const { safe, user } = await account(
      ctx,
      setup.safeId,
      args.sessionToken,
      true,
    );
    if (safe.isActive === false)
      throw new Error("Reconnect the original account before continuing.");
    if (
      setup.stage === "requested" &&
      setup.claimId === args.claimId &&
      setup.payer === user.walletAddress
    )
      return;
    if (
      setup.stage !== "approval" ||
      setup.updatedAt !== args.expectedUpdatedAt
    )
      throw new Error(
        "This request changed or was already submitted. Check its original status.",
      );
    await ctx.db.patch(setup._id, {
      stage: "requested",
      claimId: args.claimId,
      payer: user.walletAddress,
      callData: args.callData,
      scanFrom: setup.startBlock,
      scanHash: undefined,
      recoveryAt: Date.now() + 30_000,
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});
export const declined = mutation({
  args: { ...identity, claimId: v.string(), batchId: v.string() },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) throw new Error("Account setup not found.");
    const { user } = await account(ctx, setup.safeId, args.sessionToken, true);
    if (
      setup.stage !== "requested" ||
      setup.claimId !== args.claimId ||
      setup.batchId !== args.batchId ||
      setup.payer?.toLowerCase() !== user.walletAddress.toLowerCase()
    )
      throw new Error(
        "This wallet attempt is no longer current. Check its original status.",
      );
    const attempt = setup.attempt + 1;
    await ctx.db.patch(setup._id, {
      stage: "approval",
      claimId: undefined,
      payer: undefined,
      callData: undefined,
      attempt,
      batchId: batchId(setup._id, attempt),
      recoveryAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    });
  },
});
function walletIntent(setup: Doc<"accountFeeSetups">): WalletCalls {
  if (!setup.payer || !setup.callData)
    throw new Error("The original wallet request is incomplete.");
  return {
    chainId: setup.chainId,
    payer: setup.payer as Address,
    calls: [{ to: setup.safeAddress as Address, data: setup.callData as Hex }],
  };
}
export const check = action({
  args: { ...identity, txHash: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const { setup } = await ctx.runQuery(internal.accountFeeSetups.context, {
      setupId: args.setupId,
      sessionToken: args.sessionToken,
      write: true,
    });
    if (args.txHash) await verifyReceipt(ctx, setup, args.txHash);
    else
      await ctx.runAction(internal.accountFeeSetups.reconcile, {
        setupId: setup._id,
      });
  },
});
async function verifyReceipt(
  ctx: ActionCtx,
  setup: Doc<"accountFeeSetups">,
  hash: string,
) {
  if (setup.stage === "complete") return;
  if (
    !/^0x[\da-f]{64}$/i.test(hash) ||
    setup.failedHashes.includes(hash.toLowerCase())
  )
    throw new Error(
      "This receipt does not identify the current setup attempt.",
    );
  const client = getChainClient(setup.chainId);
  if ((await client.getChainId()) !== setup.chainId)
    throw new Error("The account network could not be verified.");
  const receipt = await client.getTransactionReceipt({ hash: hash as Hex });
  const head = await client.getBlockNumber();
  assertReceiptConfirmations(receipt.blockNumber, head);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (
    block.hash !== receipt.blockHash ||
    receipt.blockNumber < BigInt(setup.startBlock)
  )
    throw new Error(
      "The setup receipt is not confirmed on the original network.",
    );
  if (receipt.status !== "success") {
    const tx = await client.getTransaction({ hash: hash as Hex });
    // A wallet status alone cannot authorize another paid send. Only the exact
    // original batch, reverted on chain, can release this attempt.
    if (
      setup.stage !== "requested" ||
      tx.from.toLowerCase() !== setup.payer?.toLowerCase() ||
      tx.to?.toLowerCase() !== setup.payer?.toLowerCase() ||
      tx.value !== 0n ||
      tx.input.toLowerCase() !==
        customerWalletExecutionData(walletIntent(setup)).toLowerCase()
    )
      throw new Error(
        "This failed transaction does not identify the original wallet request.",
      );
    await ctx.runMutation(internal.accountFeeSetups.finish, {
      setupId: setup._id,
      hash,
      outcome: "retry",
      batchId: setup.batchId,
    });
    return;
  }
  const outcome = accountChangeReceiptOutcome(receipt, {
    safeAddress: setup.safeAddress,
    safeTxHash: setup.proposal.safeTxHash,
  });
  if (outcome === "success") {
    await assertCustomerPaidAccount(
      client,
      setup.safeAddress as Address,
      setup.chainId,
      receipt.blockNumber,
    );
  }
  await ctx.runMutation(internal.accountFeeSetups.finish, {
    setupId: setup._id,
    hash,
    outcome: outcome === "success" ? "complete" : "failed",
    batchId: setup.batchId,
  });
}
export const finish = internalMutation({
  args: {
    setupId: v.id("accountFeeSetups"),
    hash: v.string(),
    batchId: v.string(),
    outcome: v.union(
      v.literal("complete"),
      v.literal("failed"),
      v.literal("retry"),
    ),
  },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup?.open || setup.batchId !== args.batchId) return;
    if (args.outcome === "retry") {
      if (
        setup.stage !== "requested" ||
        setup.failedHashes.includes(args.hash.toLowerCase())
      )
        throw new Error(
          "This failed receipt belongs to an earlier wallet attempt.",
        );
      const attempt = setup.attempt + 1;
      if (setup.failedHashes.length >= 50)
        throw new Error(
          "This setup needs review after repeated confirmed execution failures.",
        );
      await ctx.db.patch(setup._id, {
        stage: "approval",
        attempt,
        batchId: batchId(setup._id, attempt),
        claimId: undefined,
        payer: undefined,
        callData: undefined,
        failedHashes: [...setup.failedHashes, args.hash.toLowerCase()],
        recoveryAt: undefined,
        error:
          "The setup transaction reverted. Review MetaMask for any execution fee before trying again.",
        updatedAt: Date.now(),
      });
    } else
      await ctx.db.patch(setup._id, {
        stage: args.outcome,
        open: false,
        txHash: args.hash,
        recoveryAt: undefined,
        error:
          args.outcome === "failed"
            ? "The account did not apply this setup. Review its current configuration before preparing another request."
            : undefined,
        updatedAt: Date.now(),
      });
    await appendAudit(ctx, {
      orgId: setup.orgId,
      actorUserId: setup.createdBy,
      action: `account.fee_setup_${args.outcome}`,
      objectType: "account_fee_setup",
      objectId: setup._id,
      metadata: { txHash: args.hash },
    });
  },
});
export const discard = mutation({
  args: identity,
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) throw new Error("Account setup not found.");
    const { membership } = await account(
      ctx,
      setup.safeId,
      args.sessionToken,
      true,
    );
    if (
      membership.role !== "admin" ||
      setup.stage !== "approval" ||
      setup.signatures.length ||
      setup.attempt
    )
      throw new Error(
        "This setup already has approval evidence. Complete or reconcile the original request.",
      );
    const proposal = await ctx.db
      .query("accountProposals")
      .withIndex("by_fee_setup", (q) => q.eq("accountFeeSetupId", setup._id))
      .unique();
    const latest = await ctx.db
      .query("accountProposals")
      .withIndex("by_account_nonce", (q) =>
        q.eq("accountKey", setup.accountKey),
      )
      .order("desc")
      .first();
    if (proposal && latest?._id !== proposal._id)
      throw new Error(
        "Later account transactions depend on this setup. Complete the original setup before continuing.",
      );
    // Once any signature may exist this nonce must remain reserved. Unsigned
    // drafts alone can release their proposal without an on-chain cancellation.
    if (proposal) await ctx.db.delete(proposal._id);
    await ctx.db.patch(setup._id, {
      stage: "cancelled",
      open: false,
      updatedAt: Date.now(),
    });
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("accountFeeSetups")
      .withIndex("by_due", (q) =>
        q.gt("recoveryAt", 0).lte("recoveryAt", Date.now()),
      )
      .take(20);
    for (const setup of due) {
      await ctx.db.patch(setup._id, { recoveryAt: Date.now() + 60_000 });
      await ctx.scheduler.runAfter(0, internal.accountFeeSetups.reconcile, {
        setupId: setup._id,
      });
    }
  },
});
export const reconcile = internalAction({
  args: { setupId: v.id("accountFeeSetups") },
  handler: async (ctx, args): Promise<void> => {
    const { setup } = await ctx.runQuery(
      internal.accountFeeSetups.context,
      args,
    );
    if (!setup.open) return;
    try {
      const client = getChainClient(setup.chainId);
      if ((await client.getChainId()) !== setup.chainId) return;
      const head = await client.getBlockNumber();
      if (head < 2n) return;
      let fromBlock = BigInt(setup.scanFrom ?? setup.startBlock);
      if (
        setup.scanHash &&
        fromBlock > BigInt(setup.startBlock) &&
        (await client.getBlock({ blockNumber: fromBlock - 1n })).hash !==
          setup.scanHash
      )
        fromBlock = BigInt(setup.startBlock);
      if (fromBlock > head - 2n) return;
      const toBlock =
        fromBlock + 1999n < head - 2n ? fromBlock + 1999n : head - 2n;
      const checkpoint = await client.getBlock({ blockNumber: toBlock });
      const logs = await client.getLogs({
        address: setup.safeAddress as Address,
        events: parseAbi([
          "event ExecutionSuccess(bytes32 txHash,uint256 payment)",
          "event ExecutionFailure(bytes32 txHash,uint256 payment)",
        ]),
        fromBlock,
        toBlock,
      });
      const result = logs.find(
        (log) =>
          !log.removed &&
          accountExecutionOutcome(log, setup.proposal.safeTxHash),
      );
      if (result?.transactionHash) {
        await verifyReceipt(ctx, setup, result.transactionHash);
        return;
      }
      if (
        (await client.getBlock({ blockNumber: toBlock })).hash !==
        checkpoint.hash
      )
        return;
      const nonce = await client.readContract({
        address: setup.safeAddress as Address,
        abi: parseAbi(["function nonce() view returns(uint256)"]),
        functionName: "nonce",
        blockNumber: toBlock,
      });
      if (
        typeof nonce === "bigint" &&
        nonce > BigInt(setup.proposal.safeTransactionData.nonce)
      ) {
        await ctx.runMutation(internal.accountFeeSetups.superseded, {
          setupId: setup._id,
          expectedFrom: setup.scanFrom,
          blockNumber: String(toBlock),
          blockHash: checkpoint.hash,
        });
        return;
      }
      await ctx.runMutation(internal.accountFeeSetups.checkpoint, {
        setupId: setup._id,
        expectedFrom: setup.scanFrom,
        nextBlock: String(toBlock + 1n),
        hash: checkpoint.hash,
      });
    } catch {
      /* Preserve the exact request and cursor on incomplete evidence. */
    }
  },
});
export const superseded = internalMutation({
  args: {
    setupId: v.id("accountFeeSetups"),
    expectedFrom: v.optional(v.string()),
    blockNumber: v.string(),
    blockHash: v.string(),
  },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup?.open || setup.scanFrom !== args.expectedFrom) return;
    await ctx.db.patch(setup._id, {
      open: false,
      stage: "failed",
      recoveryAt: undefined,
      error:
        "Another confirmed account transaction replaced this setup. Check the current fee configuration before preparing a new request.",
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: setup.orgId,
      actorUserId: setup.createdBy,
      action: "account.fee_setup_superseded",
      objectType: "account_fee_setup",
      objectId: setup._id,
      metadata: {
        blockNumber: args.blockNumber,
        blockHash: args.blockHash,
        safeTxHash: setup.proposal.safeTxHash,
      },
    });
  },
});
export const checkpoint = internalMutation({
  args: {
    setupId: v.id("accountFeeSetups"),
    expectedFrom: v.optional(v.string()),
    nextBlock: v.string(),
    hash: v.string(),
  },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup?.open || setup.scanFrom !== args.expectedFrom) return;
    await ctx.db.patch(setup._id, {
      scanFrom: args.nextBlock,
      scanHash: args.hash,
      recoveryAt: Date.now() + 60_000,
    });
  },
});
