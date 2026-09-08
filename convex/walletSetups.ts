import { v } from "convex/values";
import {
  erc20Abi,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  action,
  internalAction,
  internalMutation,
  type ActionCtx,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { getChainClient, verifySafeOwnership } from "./lib/safeVerification";
import { assertCustomerPaidAccount } from "./lib/customerPaidAccount";
import { circleConfiguration } from "../shared/circleExecution";
import {
  predictedWalletSafe,
  walletSetupCall,
  walletSetupExecutionData,
  type WalletSetupIntent,
} from "../shared/walletSetup";
import { appendAudit } from "./audit";
import { readProspectiveAccountAuthority } from "./lib/accountAuthority";

const scope = { orgId: v.id("orgs"), sessionToken: v.string() };
const identity = { setupId: v.id("walletSetups"), sessionToken: v.string() };
const prepareArgs = {
  ...scope,
  chainId: v.number(),
  owners: v.array(v.string()),
  threshold: v.number(),
  deposit: v.string(),
  requestId: v.string(),
};
const proxyEvent = parseAbiItem(
  "event ProxyCreation(address indexed proxy, address singleton)",
);

export const current = query({
  args: scope,
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, ["admin"]);
    const pending = await ctx.db
      .query("walletSetups")
      .withIndex("by_org_open", (q) =>
        q.eq("orgId", args.orgId).eq("open", true),
      )
      .unique();
    if (pending) return pending;
    // Completion may reach the database before its response reaches the browser.
    // Reloading onboarding must offer the connected account, not a second deposit.
    const completed = await ctx.db
      .query("walletSetups")
      .withIndex("by_org_stage", (q) =>
        q.eq("orgId", args.orgId).eq("stage", "complete"),
      )
      .order("desc")
      .first();
    return completed?.safeId && (await ctx.db.get(completed.safeId))?.isActive
      ? completed
      : null;
  },
});
export const get = query({
  args: identity,
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) throw new Error("The saved account setup could not be found.");
    const { user } = await requireOrgAccess(
      ctx,
      setup.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (user._id !== setup.userId)
      throw new Error("Reconnect the wallet that started this account setup.");
    return setup;
  },
});
export const preparation = internalQuery({
  args: prepareArgs,
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId))
      throw new Error("The setup request identifier is invalid.");
    const salt = keccak256(
      toHex(`${args.orgId}:wallet-setup:${args.requestId}`),
    );
    const intent = {
      chainId: args.chainId,
      payer: user.walletAddress.toLowerCase() as Address,
      owners: args.owners as Address[],
      threshold: args.threshold,
      salt,
      deposit: args.deposit,
    };
    walletSetupCall(intent);
    const existing =
      (await ctx.db
        .query("walletSetups")
        .withIndex("by_org_open", (q) =>
          q.eq("orgId", args.orgId).eq("open", true),
        )
        .unique()) ??
      (await ctx.db
        .query("walletSetups")
        .withIndex("by_request", (q) =>
          q.eq("orgId", args.orgId).eq("requestId", args.requestId),
        )
        .unique());
    if (
      existing &&
      (existing.userId !== user._id ||
        existing.chainId !== args.chainId ||
        existing.deposit !== args.deposit ||
        existing.threshold !== args.threshold ||
        existing.owners.map((o) => o.toLowerCase()).join(":") !==
          args.owners.map((o) => o.toLowerCase()).join(":"))
    )
      throw new Error(
        "Finish the saved account setup before changing its instructions.",
      );
    const earlier = await ctx.db
      .query("customerOperations")
      .withIndex("by_payer_state", (q) =>
        q
          .eq("walletAddress", intent.payer)
          .eq("chainId", args.chainId)
          .eq("state", "pending"),
      )
      .first();
    if (earlier)
      throw new Error(
        "Check the earlier provider request before starting another account setup.",
      );
    const other = await ctx.db
      .query("walletSetups")
      .withIndex("by_payer_open", (q) =>
        q
          .eq("payer", intent.payer)
          .eq("chainId", args.chainId)
          .eq("open", true),
      )
      .unique();
    if (other && other._id !== existing?._id)
      throw new Error(
        "Finish this wallet’s saved account setup in the other organization first.",
      );
    return { intent, userId: user._id, existing };
  },
});

export const prepare = action({
  args: prepareArgs,
  handler: async (ctx, args): Promise<Id<"walletSetups">> => {
    const { intent, existing } = await ctx.runQuery(
      internal.walletSetups.preparation,
      args,
    );
    if (existing) return existing._id;
    const client = getChainClient(args.chainId),
      call = walletSetupCall(intent),
      token = circleConfiguration(args.chainId).token;
    if ((await client.getChainId()) !== args.chainId)
      throw new Error("The account network is unavailable. Try again shortly.");
    const startBlock = await client.getBlockNumber();
    for (const expected of call.code) {
      const code = await client.getCode({
        address: expected.address,
        blockNumber: startBlock,
      });
      if (!code || keccak256(code) !== expected.hash)
        throw new Error(
          "The published account creation contracts could not be verified.",
        );
    }
    const [proxyCode, balance] = await Promise.all([
      client.readContract({
        address: call.to,
        abi: parseAbi(["function proxyCreationCode() view returns(bytes)"]),
        functionName: "proxyCreationCode",
        blockNumber: startBlock,
      }),
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [intent.payer],
        blockNumber: startBlock,
      }),
    ]);
    if (balance <= BigInt(args.deposit))
      throw new Error(
        "Your wallet needs enough USDC for the deposit and the setup fee. Add USDC or lower the deposit.",
      );
    const address = predictedWalletSafe(intent, proxyCode);
    await readProspectiveAccountAuthority(
      args.chainId,
      address,
      args.owners,
      args.threshold,
      startBlock,
    );
    return ctx.runMutation(internal.walletSetups.persist, {
      ...args,
      address: address.toLowerCase(),
      startBlock: String(startBlock),
    });
  },
});

export const validate = action({
  args: identity,
  handler: async (ctx, args): Promise<void> => {
    const setup = await ctx.runQuery(internal.walletSetups.context, args);
    if (setup.stage !== "prepared")
      throw new Error(
        "Check the original wallet setup request before continuing.",
      );
    const client = getChainClient(setup.chainId),
      block = await client.getBlockNumber();
    await readProspectiveAccountAuthority(
      setup.chainId,
      setup.address,
      setup.owners,
      setup.threshold,
      block,
    );
    const balance = await client.readContract({
      address: circleConfiguration(setup.chainId).token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [setup.payer as Address],
      blockNumber: block,
    });
    if (balance <= BigInt(setup.deposit))
      throw new Error(
        "Your wallet needs enough USDC for the deposit and the setup fee. Add USDC or lower the deposit.",
      );
  },
});

export const persist = internalMutation({
  args: { ...prepareArgs, address: v.string(), startBlock: v.string() },
  handler: async (ctx, args) => {
    // Repeat identity and open-request checks in this atomic write, not just the
    // action's earlier read, so two browser tabs cannot save different setups.
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    const existing =
      (await ctx.db
        .query("walletSetups")
        .withIndex("by_org_open", (q) =>
          q.eq("orgId", args.orgId).eq("open", true),
        )
        .unique()) ??
      (await ctx.db
        .query("walletSetups")
        .withIndex("by_request", (q) =>
          q.eq("orgId", args.orgId).eq("requestId", args.requestId),
        )
        .unique());
    if (existing) {
      if (
        existing.userId !== user._id ||
        existing.address !== args.address ||
        existing.chainId !== args.chainId ||
        existing.deposit !== args.deposit ||
        existing.threshold !== args.threshold ||
        existing.owners.join(":") !==
          args.owners.map((o) => o.toLowerCase()).join(":")
      )
        throw new Error(
          "Another account setup was saved. Review that request first.",
        );
      return existing._id;
    }
    const payer = user.walletAddress.toLowerCase(),
      salt = keccak256(toHex(`${args.orgId}:wallet-setup:${args.requestId}`));
    const other = await ctx.db
      .query("walletSetups")
      .withIndex("by_payer_open", (q) =>
        q.eq("payer", payer).eq("chainId", args.chainId).eq("open", true),
      )
      .first();
    const old = await ctx.db
      .query("customerOperations")
      .withIndex("by_payer_state", (q) =>
        q
          .eq("walletAddress", payer)
          .eq("chainId", args.chainId)
          .eq("state", "pending"),
      )
      .first();
    if (other || old)
      throw new Error(
        "Check this wallet’s earlier account setup before starting another.",
      );
    walletSetupCall({
      ...args,
      payer: payer as Address,
      owners: args.owners as Address[],
      salt,
    });
    const id = await ctx.db.insert("walletSetups", {
      orgId: args.orgId,
      userId: user._id,
      chainId: args.chainId,
      payer,
      owners: args.owners.map((o) => o.toLowerCase()),
      threshold: args.threshold,
      salt,
      address: args.address,
      deposit: args.deposit,
      requestId: args.requestId,
      batchId: keccak256(toHex(`${args.orgId}:${args.requestId}:0`)),
      attempt: 0,
      stage: "prepared",
      open: true,
      startBlock: args.startBlock,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "account.wallet_setup_prepared",
      objectType: "wallet_setup",
      objectId: id,
    });
    return id;
  },
});

export const context = internalQuery({
  args: identity,
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) throw new Error("The saved account setup could not be found.");
    const { user } = await requireOrgAccess(
      ctx,
      setup.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (user._id !== setup.userId)
      throw new Error("Reconnect the wallet that started this account setup.");
    return setup;
  },
});
export const begin = mutation({
  args: { ...identity, claimId: v.string() },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) throw new Error("The saved account setup could not be found.");
    const { user } = await requireOrgAccess(
      ctx,
      setup.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (
      user._id !== setup.userId ||
      setup.stage !== "prepared" ||
      !setup.open ||
      !/^[\da-f-]{36}$/i.test(args.claimId)
    )
      throw new Error(
        "Check the original wallet setup request before continuing.",
      );
    await ctx.db.patch(setup._id, {
      stage: "requested",
      claimId: args.claimId,
      recoveryAt: Date.now() + 30_000,
      scanFrom: setup.startBlock,
      updatedAt: Date.now(),
    });
    return setup.batchId;
  },
});

// Only an explicit pre-submission wallet rejection permits another prompt.
// Network errors, malformed replies and pending/failed wallet statuses do not.
export const declined = mutation({
  args: {
    ...identity,
    batchId: v.string(),
    claimId: v.string(),
    reason: v.union(v.literal("declined"), v.literal("not_sent")),
  },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) throw new Error("The saved account setup could not be found.");
    const { user } = await requireOrgAccess(
      ctx,
      setup.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (
      user._id !== setup.userId ||
      setup.stage !== "requested" ||
      setup.batchId !== args.batchId ||
      setup.claimId !== args.claimId
    )
      throw new Error(
        "The saved wallet setup changed. Check its original status.",
      );
    const attempt = setup.attempt + 1;
    await ctx.db.patch(setup._id, {
      stage: "prepared",
      claimId: undefined,
      recoveryAt: undefined,
      scanFrom: undefined,
      scanHash: undefined,
      attempt,
      batchId: keccak256(toHex(`${setup.orgId}:${setup.requestId}:${attempt}`)),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: setup.orgId,
      actorUserId: user._id,
      action: "account.wallet_setup_not_submitted",
      objectType: "wallet_setup",
      objectId: setup._id,
      metadata: { batchId: args.batchId, reason: args.reason },
    });
  },
});

export const complete = action({
  args: { ...identity, txHash: v.string() },
  handler: async (ctx, args): Promise<"complete" | "failed"> => {
    const setup = await ctx.runQuery(internal.walletSetups.context, {
      setupId: args.setupId,
      sessionToken: args.sessionToken,
    });
    if (setup.stage === "complete") return "complete";
    if (setup.stage !== "requested" || !/^0x[\da-f]{64}$/i.test(args.txHash))
      throw new Error(
        "Check the original wallet setup request before continuing.",
      );
    return verifyWalletSetup(ctx, setup, args.txHash as Hex);
  },
});
async function verifyWalletSetup(
  ctx: ActionCtx,
  setup: Doc<"walletSetups">,
  txHash: Hex,
): Promise<"complete" | "failed"> {
  const intent = setup as WalletSetupIntent,
    client = getChainClient(setup.chainId),
    call = walletSetupCall(intent);
  const receipt = await client.getTransactionReceipt({
      hash: txHash as Hex,
    }),
    head = await client.getBlockNumber();
  if (
    (await client.getChainId()) !== setup.chainId ||
    head < receipt.blockNumber + 2n ||
    receipt.blockNumber < BigInt(setup.startBlock) ||
    (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
      receipt.blockHash
  )
    throw new Error(
      "Account setup is awaiting confirmed network evidence. Check again shortly.",
    );
  if (receipt.logs.some((log) => log.removed))
    throw new Error(
      "The network changed its setup evidence. Check the original request again.",
    );
  if (receipt.status !== "success") {
    const transaction = await client.getTransaction({
      hash: receipt.transactionHash,
    });
    if (
      transaction.from.toLowerCase() !== setup.payer ||
      transaction.to?.toLowerCase() !== setup.payer ||
      transaction.input.toLowerCase() !==
        walletSetupExecutionData(intent).toLowerCase()
    )
      throw new Error(
        "The failed receipt could not be matched to your setup. Keep the original request for recovery.",
      );
    await ctx.runMutation(internal.walletSetups.failed, {
      setupId: setup._id,
      batchId: setup.batchId,
      txHash: receipt.transactionHash,
    });
    return "failed";
  }
  const creations = parseEventLogs({
    abi: [proxyEvent],
    logs: receipt.logs,
    strict: true,
  }).filter(
    (log) =>
      log.address.toLowerCase() === call.to.toLowerCase() &&
      log.args.proxy.toLowerCase() === setup.address &&
      log.args.singleton.toLowerCase() === call.code[1].address.toLowerCase(),
  );
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs,
    strict: true,
  }).filter(
    (log) =>
      log.address.toLowerCase() ===
        circleConfiguration(setup.chainId).token.toLowerCase() &&
      log.args.from.toLowerCase() === setup.payer &&
      log.args.to.toLowerCase() === setup.address,
  );
  if (
    creations.length !== 1 ||
    (BigInt(setup.deposit) > 0n
      ? transfers.length !== 1 ||
        transfers[0].args.value !== BigInt(setup.deposit)
      : transfers.length !== 0)
  )
    throw new Error(
      "The receipt does not confirm the reviewed account setup and full deposit.",
    );
  const verified = await verifySafeOwnership(
    setup.address,
    setup.chainId,
    setup.payer,
  );
  const normalized = (owners: string[]) =>
    owners
      .map((o) => o.toLowerCase())
      .sort()
      .join(":");
  if (
    verified.threshold !== setup.threshold ||
    normalized(verified.owners) !== normalized(setup.owners)
  )
    throw new Error(
      "The deployed account has different approval requirements.",
    );
  await assertCustomerPaidAccount(
    client,
    setup.address as Address,
    setup.chainId,
    head,
  );
  await ctx.runMutation(internal.walletSetups.finish, {
    setupId: setup._id,
    txHash: receipt.transactionHash,
  });
  return "complete";
}

export const recoveryContext = internalQuery({
  args: { setupId: v.id("walletSetups") },
  handler: (ctx, args) => ctx.db.get(args.setupId),
});

// The factory event identifies this exact predicted account even when MetaMask
// never returns a transaction hash. This queue only reads chain evidence. It
// never asks the wallet or a provider to repeat the deployment or deposit.
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("walletSetups")
      .withIndex("by_recovery", (q) =>
        q.eq("stage", "requested").lte("recoveryAt", Date.now()),
      )
      .take(20);
    for (const setup of due) {
      await ctx.db.patch(setup._id, { recoveryAt: Date.now() + 60_000 });
      await ctx.scheduler.runAfter(0, internal.walletSetups.reconcile, {
        setupId: setup._id,
      });
    }
  },
});

export const reconcile = internalAction({
  args: { setupId: v.id("walletSetups") },
  handler: async (ctx, args) => {
    const setup = await ctx.runQuery(
      internal.walletSetups.recoveryContext,
      args,
    );
    if (!setup || setup.stage !== "requested") return;
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
      ) {
        fromBlock = BigInt(setup.startBlock);
      }
      if (fromBlock > head - 2n) return;
      const toBlock =
        fromBlock + 1999n < head - 2n ? fromBlock + 1999n : head - 2n;
      const checkpoint = await client.getBlock({ blockNumber: toBlock });
      const logs = await client.getLogs({
        address: walletSetupCall(setup as WalletSetupIntent).to,
        event: proxyEvent,
        args: { proxy: setup.address as Address },
        fromBlock,
        toBlock,
        strict: true,
      });
      if (logs.length) {
        if (logs.length !== 1 || logs[0].removed || !logs[0].transactionHash)
          return;
        await verifyWalletSetup(ctx, setup, logs[0].transactionHash);
        return;
      }
      if (
        (await client.getBlock({ blockNumber: toBlock })).hash !==
        checkpoint.hash
      )
        return;
      await ctx.runMutation(internal.walletSetups.checkpoint, {
        setupId: setup._id,
        batchId: setup.batchId,
        expectedFrom: setup.scanFrom,
        nextBlock: String(toBlock + 1n),
        blockHash: checkpoint.hash,
      });
    } catch {
      // Keep the same cursor and request on RPC outages, incomplete receipts or
      // changed authority. The next queue run can verify it without a new send.
    }
  },
});

export const checkpoint = internalMutation({
  args: {
    setupId: v.id("walletSetups"),
    batchId: v.string(),
    expectedFrom: v.optional(v.string()),
    nextBlock: v.string(),
    blockHash: v.string(),
  },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (
      !setup ||
      setup.stage !== "requested" ||
      setup.batchId !== args.batchId ||
      setup.scanFrom !== args.expectedFrom
    )
      return;
    await ctx.db.patch(setup._id, {
      scanFrom: args.nextBlock,
      scanHash: args.blockHash,
      recoveryAt: Date.now() + 60_000,
    });
  },
});

export const failed = internalMutation({
  args: {
    setupId: v.id("walletSetups"),
    batchId: v.string(),
    txHash: v.string(),
  },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup || setup.stage !== "requested" || setup.batchId !== args.batchId)
      return;
    const txHash = args.txHash.toLowerCase();
    const previous = await ctx.db
      .query("walletSetupFailures")
      .withIndex("by_setup_hash", (q) =>
        q.eq("setupId", setup._id).eq("txHash", txHash),
      )
      .unique();
    if (previous)
      throw new Error(
        "This receipt belongs to an earlier setup attempt. Check the current wallet request.",
      );
    await ctx.db.insert("walletSetupFailures", {
      setupId: setup._id,
      batchId: setup.batchId,
      txHash,
      createdAt: Date.now(),
    });
    const attempt = setup.attempt + 1;
    await ctx.db.patch(setup._id, {
      stage: "prepared",
      claimId: undefined,
      recoveryAt: undefined,
      scanFrom: undefined,
      scanHash: undefined,
      attempt,
      batchId: keccak256(toHex(`${setup.orgId}:${setup.requestId}:${attempt}`)),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: setup.orgId,
      actorUserId: setup.userId,
      action: "account.wallet_setup_failed",
      objectType: "wallet_setup",
      objectId: setup._id,
      metadata: { batchId: args.batchId, txHash: args.txHash },
    });
  },
});
export const finish = internalMutation({
  args: { setupId: v.id("walletSetups"), txHash: v.string() },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup || setup.stage === "complete") return;
    if (setup.stage !== "requested")
      throw new Error("The original setup request changed before completion.");
    const existing = await ctx.db
      .query("safes")
      .withIndex("by_org_chain_address", (q) =>
        q
          .eq("orgId", setup.orgId)
          .eq("chainId", setup.chainId)
          .eq("safeAddress", setup.address),
      )
      .unique();
    const fields = {
      orgId: setup.orgId,
      chainId: setup.chainId,
      safeAddress: setup.address,
      owners: setup.owners,
      threshold: setup.threshold,
      name: existing?.name ?? "Main account",
      isActive: true,
      verifiedAt: Date.now(),
    };
    const safeId =
      existing?._id ??
      (await ctx.db.insert("safes", { ...fields, createdAt: Date.now() }));
    if (existing) await ctx.db.patch(existing._id, fields);
    await ctx.db.patch(setup._id, {
      stage: "complete",
      open: false,
      recoveryAt: undefined,
      scanFrom: undefined,
      scanHash: undefined,
      safeId,
      txHash: args.txHash,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: setup.orgId,
      actorUserId: setup.userId,
      action: "account.wallet_setup_complete",
      objectType: "wallet_setup",
      objectId: setup._id,
      metadata: { safeId, txHash: args.txHash },
    });
  },
});

export const discard = mutation({
  args: identity,
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) throw new Error("The saved account setup could not be found.");
    const { user } = await requireOrgAccess(
      ctx,
      setup.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (setup.userId !== user._id || setup.stage !== "prepared")
      throw new Error(
        "Check the original wallet request before discarding this setup.",
      );
    await ctx.db.patch(setup._id, {
      stage: "cancelled",
      open: false,
      updatedAt: Date.now(),
    });
  },
});
