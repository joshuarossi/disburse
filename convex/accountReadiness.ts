import { v } from "convex/values";
import { formatUnits, parseAbi, type Address } from "viem";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import { getChainClient } from "./lib/safeVerification";
import { assertSafeIdentity } from "./lib/safeIdentity";
import { approvalPaths, availableAccountApprovals, readAccountAuthority } from './lib/accountAuthority';
import { relayConfiguration } from "./lib/relayConfiguration";
import {
  CHAIN_TOKENS,
  CHAIN_NAMES,
  type SupportedChainId,
} from "../shared/chains";
import { chainEnvironment } from "../shared/assets";
import type { AccountReadiness } from "../shared/accountReadiness";

const args = { safeId: v.id("safes"), sessionToken: v.string() };
const writers = ["admin", "approver", "initiator"];
const abi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const context = internalQuery({
  args,
  handler: async (ctx, args) => {
    const safe = await ctx.db.get(args.safeId);
    if (!safe || safe.isActive === false)
      throw new Error("This funding account is no longer active");
    const { user, membership } = await requireOrgAccess(
      ctx,
      safe.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator", "clerk", "viewer"],
    );
    const org = await ctx.db.get(safe.orgId);
    const accountNames = await ctx.db.query('safes').withIndex('by_org', q => q.eq('orgId', safe.orgId)).collect();
    const members = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q) => q.eq("orgId", safe.orgId))
      .collect();
    const people = await Promise.all(
      members
        .filter((m) => m.status === "active")
        .map(async (m) => ({
          wallet: (await ctx.db.get(m.userId))?.walletAddress.toLowerCase(),
          name: m.name ?? null,
          canApprove: writers.includes(m.role),
        })),
    );
    let fee: AccountReadiness["managed"]["fee"] = null;
    let error: string | null = null;
    try {
      fee = relayConfiguration(
        safe.chainId,
        org?.relayFeeTokenSymbol ?? "USDC",
      ).fee;
    } catch {
      error =
        "Stablecoin payment fees are unavailable for this account. You can save a draft and finish it when the payment service is available.";
    }
    return {
      safe,
      accountNames: accountNames.filter(a => a.chainId === safe.chainId).map(a => ({ address: a.safeAddress.toLowerCase(), name: a.name })),
      people,
      userWallet: user.walletAddress,
      canPrepare: writers.includes(membership.role),
      managed: { fee, error },
    };
  },
});

export const get = action({
  args,
  handler: async (ctx, args): Promise<AccountReadiness> => {
    const source = await ctx.runQuery(internal.accountReadiness.context, args);
    const { safe } = source;
    const tokens = Object.values(
      CHAIN_TOKENS[safe.chainId as SupportedChainId] ?? {},
    );
    const result: AccountReadiness = {
      safeId: safe._id,
      safeAddress: safe.safeAddress,
      name:
        safe.name ??
        `${CHAIN_NAMES[safe.chainId as SupportedChainId] ?? "Funding"} account`,
      chainId: safe.chainId,
      network:
        CHAIN_NAMES[safe.chainId as SupportedChainId] ?? "Unsupported network",
      environment: chainEnvironment(safe.chainId),
      checkedAt: Date.now(),
      blockNumber: null,
      error: null,
      assets: tokens.map((t) => ({
        token: t.symbol,
        address: t.address,
        balance: null,
      })),
      owners: [],
      threshold: null,
      canPrepare: source.canPrepare,
      isOwner: false,
      native: {
        symbol: safe.chainId === 137 ? "POL" : "ETH",
        payerAddress: source.userWallet,
        balance: null,
      },
      managed: source.managed,
    };
    try {
      const client = getChainClient(safe.chainId);
      const blockNumber = await client.getBlockNumber();
      const address = safe.safeAddress as Address;
      await assertSafeIdentity(client, address, safe.chainId, blockNumber);
      const [owners, threshold, balances, native] = await Promise.all([
        client.readContract({
          address,
          abi,
          functionName: "getOwners",
          blockNumber,
        }),
        client.readContract({
          address,
          abi,
          functionName: "getThreshold",
          blockNumber,
        }),
        Promise.allSettled(
          tokens.map((token) =>
            client.readContract({
              address: token.address,
              abi,
              functionName: "balanceOf",
              args: [address],
              blockNumber,
            }),
          ),
        ),
        client
          .getBalance({ address: source.userWallet as Address, blockNumber })
          .catch(() => null),
      ]);
      if (threshold < 1n || threshold > BigInt(owners.length))
        throw new Error("Invalid account approval threshold");
      result.owners = owners.map((address) => {
        const member = source.people.find(
          (p) => p.wallet === address.toLowerCase(),
        );
        return {
          address: address.toLowerCase(),
          name: member?.name ?? null,
          canApproveInApp: member?.canApprove ?? false,
        };
      });
      result.threshold = Number(threshold);
      result.isOwner = owners.some(
        (o) => o.toLowerCase() === source.userWallet.toLowerCase(),
      );
      const ownerCode = await Promise.all(owners.map(owner => client.getCode({ address: owner, blockNumber })));
      if (ownerCode.some(code => code && code !== '0x')) {
        const authority = await readAccountAuthority(safe.chainId, safe.safeAddress, blockNumber);
        result.approvalPaths = approvalPaths(authority, source.userWallet);
        const members = source.people.filter(p => p.canApprove && p.wallet).map(p => p.wallet!);
        result.allApprovalsAvailable = availableAccountApprovals(authority, members);
        result.owners = result.owners.map(owner => authority.nodes.some(n => n.address === owner.address) ? { ...owner, name: source.accountNames.find(a => a.address === owner.address)?.name ?? 'Owning account', canApproveInApp: availableAccountApprovals({ ...authority, root: owner.address }, members) } : owner);
      }
      result.assets = tokens.map((token, i) => ({
        token: token.symbol,
        address: token.address,
        balance:
          balances[i].status === "fulfilled"
            ? formatUnits(balances[i].value, token.decimals)
            : null,
      }));
      result.native.balance = native === null ? null : formatUnits(native, 18);
      result.blockNumber = blockNumber.toString();
      result.checkedAt = Date.now();
    } catch {
      result.error =
        "The funding account could not be verified on its network. Refresh the check before preparing a payment for approval.";
    }
    return result;
  },
});
