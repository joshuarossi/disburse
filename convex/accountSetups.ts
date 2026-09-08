import {
  accountSetupMember,
  validateAssignedBalance,
} from "./lib/accountSetupMember";
import { fundedAccountSetup } from "../shared/fundedAccountSetup";
import { assertCircleBatch } from "./lib/circleBatch";
import { decodeCircleRequest } from "../shared/circleRequest";
import { readCircleSettlement } from "../shared/circleSettlement";
import {
  assertSameSettlement,
  readSettlementBlock,
} from "./lib/settlementBlock";
import { parseEventLogs, parseAbiItem } from "viem";
import { circleConfiguration } from "../shared/circleExecution";
import { v } from "convex/values";
import {
  decodeFunctionResult,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import { ORG_READER_ROLES } from "../shared/roles";
import {
  safeAccountDeployment,
  companyFactoryAbi,
} from "../shared/companyAccountSetup";
import { getChainClient } from "./lib/safeVerification";
import { readAccountSetupSource } from "./lib/circleAccountSetup";
import {
  readAccountAuthority,
  type AccountAuthority,
} from "./lib/accountAuthority";
import { assertCustomerPaidAccount } from "./lib/customerPaidAccount";
import { appendAudit } from "./audit";

const scope = { orgId: v.id("orgs"), sessionToken: v.string() };
const preparation = {
  ...scope,
  parentSafeId: v.id("safes"),
  name: v.string(),
  requestId: v.string(),
  memberUserId: v.optional(v.id("users")),
  initialFunding: v.optional(v.string()),
  memberControlAcknowledged: v.optional(v.boolean()),
};
export function assertParentHierarchy(authority: AccountAuthority) {
  if (authority.nodes.length >= 32)
    throw new Error(
      "This parent account already has the maximum supported approval hierarchy. Choose another parent account.",
    );
  const visit = (address: string, path: string[]) => {
    if (path.length >= 3 || path.includes(address))
      throw new Error(
        "This parent account already has the maximum supported approval depth. Choose another parent account.",
      );
    const node = authority.nodes.find(
      (candidate) => candidate.address === address,
    );
    if (!node)
      throw new Error("The parent account approvals could not be verified.");
    for (const owner of node.contracts) visit(owner, [...path, address]);
  };
  visit(authority.root, []);
}
export const current = query({
  args: scope,
  handler: async (ctx, args) => {
    await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ORG_READER_ROLES,
    );
    return ctx.db
      .query("accountSetups")
      .withIndex("by_org_open", (q) =>
        q.eq("orgId", args.orgId).eq("open", true),
      )
      .unique();
  },
});
export const get = query({
  args: { accountSetupId: v.id("accountSetups"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.accountSetupId);
    if (!setup) throw new Error("Company account setup not found.");
    await requireOrgAccess(
      ctx,
      setup.orgId,
      args.sessionToken,
      ORG_READER_ROLES,
    );
    return setup;
  },
});
export const preparationContext = internalQuery({
  args: preparation,
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (
      !args.name.trim() ||
      args.name.trim().length > 80 ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId)
    )
      throw new Error(
        "Use an account name of 1 to 80 characters and a valid setup request.",
      );
    const safe = await ctx.db.get(args.parentSafeId);
    if (!safe || safe.orgId !== args.orgId || safe.isActive === false)
      throw new Error("Choose an active parent company account.");
    const memberAddress = await accountSetupMember(
      ctx,
      args.orgId,
      args.memberUserId,
    );
    validateAssignedBalance(args);
    const existing =
      (await ctx.db
        .query("accountSetups")
        .withIndex("by_request", (q) =>
          q.eq("orgId", args.orgId).eq("requestId", args.requestId),
        )
        .unique()) ??
      (await ctx.db
        .query("accountSetups")
        .withIndex("by_org_open", (q) =>
          q.eq("orgId", args.orgId).eq("open", true),
        )
        .unique());
    if (
      existing &&
      (existing.parentSafeId !== args.parentSafeId ||
        existing.name !== args.name.trim() ||
        existing.memberUserId !== args.memberUserId ||
        existing.initialFunding !== args.initialFunding)
    )
      throw new Error(
        "Finish or discard the saved account setup before starting another.",
      );
    return { safe, userId: user._id, existing, memberAddress };
  },
});
async function verifiedPrediction(
  chainId: number,
  parent: string,
  salt: string,
  memberAddress?: string,
) {
  const call = safeAccountDeployment(
      chainId,
      [(memberAddress ?? parent) as Address],
      1,
      salt as Hex,
    ),
    client = getChainClient(chainId);
  if ((await client.getChainId()) !== chainId)
    throw new Error("The company account network is unavailable.");
  if (!memberAddress)
    assertParentHierarchy(await readAccountAuthority(chainId, parent));
  for (const expected of call.code) {
    const code = await client.getCode({ address: expected.address });
    if (!code || keccak256(code) !== expected.hash)
      throw new Error(
        "The published account creation contracts could not be verified.",
      );
  }
  const result = await client.call({
    account: parent as Address,
    to: call.to,
    data: call.data,
  });
  if (!result.data)
    throw new Error("The new account address could not be verified.");
  return {
    call,
    address: decodeFunctionResult({
      abi: companyFactoryAbi,
      functionName: "createProxyWithNonce",
      data: result.data,
    }).toLowerCase(),
  };
}
export const create = action({
  args: preparation,
  handler: async (ctx, args): Promise<Id<"accountSetups">> => {
    const { existing, safe, memberAddress } = await ctx.runQuery(
      internal.accountSetups.preparationContext,
      args,
    );
    if (existing) return existing._id;
    const salt = keccak256(toHex(`${args.orgId}:${args.requestId}`));
    const { address } = await verifiedPrediction(
      safe.chainId,
      safe.safeAddress,
      salt,
      memberAddress,
    );
    return ctx.runMutation(internal.accountSetups.persist, {
      ...args,
      chainId: safe.chainId,
      parentAddress: safe.safeAddress.toLowerCase(),
      memberAddress,
      address,
      salt,
    });
  },
});
export const persist = internalMutation({
  args: {
    ...preparation,
    chainId: v.number(),
    parentAddress: v.string(),
    memberAddress: v.optional(v.string()),
    address: v.string(),
    salt: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      ["admin"],
    );
    const memberAddress = await accountSetupMember(
      ctx,
      args.orgId,
      args.memberUserId,
    );
    validateAssignedBalance(args);
    if (memberAddress !== args.memberAddress)
      throw new Error("The assigned member’s wallet changed.");
    const safe = await ctx.db.get(args.parentSafeId);
    if (
      !safe ||
      safe.isActive === false ||
      safe.orgId !== args.orgId ||
      safe.chainId !== args.chainId ||
      safe.safeAddress.toLowerCase() !== args.parentAddress ||
      args.salt !== keccak256(toHex(`${args.orgId}:${args.requestId}`))
    )
      throw new Error("The parent account changed during preparation.");
    const existing = await ctx.db
      .query("accountSetups")
      .withIndex("by_org_open", (q) =>
        q.eq("orgId", args.orgId).eq("open", true),
      )
      .unique();
    if (existing) {
      if (
        existing.name === args.name.trim() &&
        existing.parentSafeId === args.parentSafeId &&
        existing.memberUserId === args.memberUserId &&
        existing.initialFunding === args.initialFunding
      )
        return existing._id;
      throw new Error("Another account setup is already saved.");
    }
    const byRequest = await ctx.db
      .query("accountSetups")
      .withIndex("by_request", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", args.requestId),
      )
      .unique();
    if (byRequest) {
      if (
        byRequest.name !== args.name.trim() ||
        byRequest.parentSafeId !== args.parentSafeId ||
        byRequest.address !== args.address ||
        byRequest.salt !== args.salt ||
        byRequest.memberUserId !== args.memberUserId ||
        byRequest.initialFunding !== args.initialFunding
      )
        throw new Error("The saved account setup has different instructions.");
      return byRequest._id;
    }
    const id = await ctx.db.insert("accountSetups", {
      orgId: args.orgId,
      parentSafeId: args.parentSafeId,
      createdBy: user._id,
      requestId: args.requestId,
      name: args.name.trim(),
      chainId: args.chainId,
      parentAddress: args.parentAddress,
      memberUserId: args.memberUserId,
      memberAddress: args.memberAddress,
      initialFunding: args.initialFunding,
      address: args.address,
      salt: args.salt,
      open: true,
      status: "prepared",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "account.setup_prepared",
      objectType: "account_setup",
      objectId: id,
      metadata: {
        parentSafeId: safe._id,
        address: args.address,
        name: args.name.trim(),
        memberUserId: args.memberUserId,
        owner: args.memberAddress ?? args.parentAddress,
        initialFunding: args.initialFunding,
      },
    });
    return id;
  },
});
export const verify = internalAction({
  args: { accountSetupId: v.id("accountSetups"), sessionToken: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ to: string; data: string; operation?: 0 | 1 }> => {
    const data = await ctx.runQuery(
      internal.accountSetups.executionContext,
      args,
    );
    const result = await verifiedPrediction(
      data.safe.chainId,
      data.safe.safeAddress,
      data.setup.salt,
      data.setup.memberAddress,
    );
    if (result.address !== data.setup.address)
      throw new Error("The new company account address changed.");
    const call = fundedAccountSetup(data.setup);
    await assertCircleBatch(data.setup.chainId, call);
    return call;
  },
});
export const executionContext = internalQuery({
  args: { accountSetupId: v.id("accountSetups"), sessionToken: v.string() },
  handler: async (ctx, args) => ({
    ...(await readAccountSetupSource(
      ctx,
      args.accountSetupId,
      args.sessionToken,
      true,
    )),
    setup: (await ctx.db.get(args.accountSetupId))!,
  }),
});
export const completionContext = internalQuery({
  args: { accountSetupId: v.id("accountSetups") },
  handler: async (ctx, args) => ({
    setup: await ctx.db.get(args.accountSetupId),
    execution: await ctx.db
      .query("circleExecutions")
      .withIndex("by_account_setup", (q) =>
        q.eq("accountSetupId", args.accountSetupId),
      )
      .order("desc")
      .first(),
  }),
});
export const complete = internalAction({
  args: { accountSetupId: v.id("accountSetups") },
  handler: async (ctx, args): Promise<void> => {
    const { setup, execution } = await ctx.runQuery(
      internal.accountSetups.completionContext,
      args,
    );
    if (!setup || setup.status === "complete") return;
    if (
      !execution ||
      execution.stage !== "confirmed" ||
      !execution.txHash ||
      !execution.settlement
    )
      throw new Error(
        "Check the saved execution receipt before linking this account.",
      );
    const client = getChainClient(setup.chainId),
      authority = await readAccountAuthority(setup.chainId, setup.address);
    if (
      authority.nodes[0].threshold !== 1 ||
      authority.nodes[0].owners.length !== 1 ||
      authority.nodes[0].owners[0].toLowerCase() !==
        (setup.memberAddress ?? setup.parentAddress)
    )
      throw new Error("The new account has different approval requirements.");
    await assertCustomerPaidAccount(
      client,
      setup.address as Address,
      setup.chainId,
      await client.getBlockNumber(),
    );
    if (setup.initialFunding) {
      const receipt = await client.getTransactionReceipt({
        hash: execution.txHash as Hex,
      });
      assertSameSettlement(
        execution.settlement,
        await readSettlementBlock(client, setup.chainId, receipt),
      );
      const result = readCircleSettlement(
        setup.chainId,
        decodeCircleRequest(execution.record).operation,
        receipt,
      );
      if (result.status !== "confirmed")
        throw new Error("The assigned account deployment did not complete.");
      const transfers = parseEventLogs({
        abi: [
          parseAbiItem(
            "event Transfer(address indexed from,address indexed to,uint256 value)",
          ),
        ],
        logs: receipt.logs,
        strict: true,
      }).filter(
        (l) =>
          !l.removed &&
          l.logIndex !== null &&
          l.logIndex > result.executionStart &&
          l.logIndex < result.executionEnd &&
          l.address.toLowerCase() ===
            circleConfiguration(setup.chainId).token.toLowerCase() &&
          l.args.from.toLowerCase() === setup.parentAddress &&
          l.args.to.toLowerCase() === setup.address,
      );
      if (
        transfers.length !== 1 ||
        transfers[0].args.value !== BigInt(setup.initialFunding)
      )
        throw new Error("The initial member balance has not been verified.");
    }
    await ctx.runMutation(internal.accountSetups.finish, {
      ...args,
      txHash: execution.txHash,
    });
  },
});
export const finish = internalMutation({
  args: { accountSetupId: v.id("accountSetups"), txHash: v.string() },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.accountSetupId);
    if (!setup || setup.status === "complete") return;
    const execution = await ctx.db
      .query("circleExecutions")
      .withIndex("by_account_setup", (q) => q.eq("accountSetupId", setup._id))
      .order("desc")
      .first();
    if (
      setup.status !== "prepared" ||
      execution?.stage !== "confirmed" ||
      execution.txHash !== args.txHash
    )
      throw new Error(
        "The account setup receipt changed before it could be connected.",
      );
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
      name: setup.name,
      chainId: setup.chainId,
      safeAddress: setup.address,
      owners: [setup.memberAddress ?? setup.parentAddress],
      assignedUserId: setup.memberUserId,
      threshold: 1,
      isActive: true,
      verifiedAt: Date.now(),
    };
    const safeId =
      existing?._id ??
      (await ctx.db.insert("safes", { ...fields, createdAt: Date.now() }));
    if (existing?.isActive === false) await ctx.db.patch(existing._id, fields);
    await ctx.db.patch(setup._id, {
      status: "complete",
      open: false,
      safeId,
      txHash: args.txHash,
      recoveryAt: undefined,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: setup.orgId,
      actorUserId: setup.createdBy,
      action: "account.setup_complete",
      objectType: "account_setup",
      objectId: setup._id,
      metadata: {
        safeId,
        txHash: args.txHash,
        parentSafeId: setup.parentSafeId,
      },
    });
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("accountSetups")
      .withIndex("by_due", (q) =>
        q.gt("recoveryAt", 0).lte("recoveryAt", Date.now()),
      )
      .take(20);
    for (const setup of due) {
      await ctx.db.patch(setup._id, {
        recoveryAt:
          setup.status === "prepared" ? Date.now() + 60_000 : undefined,
      });
      if (setup.status === "prepared")
        await ctx.scheduler.runAfter(0, internal.accountSetups.complete, {
          accountSetupId: setup._id,
        });
    }
  },
});
export const recheck = action({
  args: { accountSetupId: v.id("accountSetups"), sessionToken: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const { setup, execution } = await ctx.runQuery(
      internal.accountSetups.completionContext,
      { accountSetupId: args.accountSetupId },
    );
    if (!setup) throw new Error("Company account setup not found.");
    await ctx.runQuery(internal.safes.getLinkIdentity, {
      orgId: setup.orgId,
      sessionToken: args.sessionToken,
    });
    if (execution?.open)
      await ctx.runAction(internal.circlePayments.reconcile, {
        executionId: execution._id,
      });
    await ctx.runAction(internal.accountSetups.complete, {
      accountSetupId: setup._id,
    });
  },
});
export const discard = mutation({
  args: { accountSetupId: v.id("accountSetups"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.accountSetupId);
    if (!setup) throw new Error("Company account setup not found.");
    const { user } = await requireOrgAccess(
      ctx,
      setup.orgId,
      args.sessionToken,
      ["admin"],
    );
    if (setup.status !== "prepared")
      throw new Error("This setup is already complete or cancelled.");
    const execution = await ctx.db
      .query("circleExecutions")
      .withIndex("by_account_setup", (q) => q.eq("accountSetupId", setup._id))
      .order("desc")
      .first();
    if (execution?.open || execution?.stage === "confirmed")
      throw new Error(
        "Check the saved execution before discarding this setup.",
      );
    await ctx.db.patch(setup._id, {
      status: "cancelled",
      open: false,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: setup.orgId,
      actorUserId: user._id,
      action: "account.setup_discarded",
      objectType: "account_setup",
      objectId: setup._id,
    });
  },
});
