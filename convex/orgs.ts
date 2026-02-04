import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgLimits } from "./billing";

const SUPPORTED_RELAY_FEE_TOKENS = ["USDC", "USDT"] as const;
type RelayFeeMode = "stablecoin_preferred" | "stablecoin_only";

const DEFAULT_RELAY_FEE_TOKEN_SYMBOL = (() => {
  const envValue = (process.env.VITE_GELATO_DEFAULT_FEE_TOKEN ?? "USDC")
    .toString()
    .toUpperCase();
  return SUPPORTED_RELAY_FEE_TOKENS.includes(
    envValue as (typeof SUPPORTED_RELAY_FEE_TOKENS)[number]
  )
    ? (envValue as (typeof SUPPORTED_RELAY_FEE_TOKENS)[number])
    : "USDC";
})();

const DEFAULT_RELAY_FEE_MODE: RelayFeeMode =
  process.env.VITE_GELATO_DEFAULT_FEE_MODE === "stablecoin_only"
    ? "stablecoin_only"
    : "stablecoin_preferred";

// Disburse subscription beneficiary — auto-added to every new org.
// All three must be valid for the beneficiary to be created; if any is missing
// the insert is silently skipped and org creation proceeds normally.
const DISBURSE_BENEFICIARY_ADDRESS: string | null = (() => {
  const raw = (process.env.VITE_DISBURSE_BENEFICIARY_ADDRESS ?? "").toString().trim();
  return raw.startsWith("0x") && raw.length === 42 ? raw.toLowerCase() : null;
})();

const DISBURSE_BENEFICIARY_TOKEN: string | null = (() => {
  const raw = (process.env.VITE_DISBURSE_BENEFICIARY_TOKEN ?? "").toString().trim();
  return raw.length > 0 ? raw.toUpperCase() : null;
})();

const DISBURSE_BENEFICIARY_CHAIN_ID: number | null = (() => {
  const raw = (process.env.VITE_DISBURSE_BENEFICIARY_CHAIN_ID ?? "").toString().trim();
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
})();

function normalizeRelayFeeMode(value?: string | null): RelayFeeMode {
  return value === "stablecoin_only" ? "stablecoin_only" : "stablecoin_preferred";
}

function normalizeRelayFeeTokenSymbol(value?: string | null) {
  const normalized = (value ?? DEFAULT_RELAY_FEE_TOKEN_SYMBOL)
    .toString()
    .toUpperCase();
  return SUPPORTED_RELAY_FEE_TOKENS.includes(
    normalized as (typeof SUPPORTED_RELAY_FEE_TOKENS)[number]
  )
    ? (normalized as (typeof SUPPORTED_RELAY_FEE_TOKENS)[number])
    : DEFAULT_RELAY_FEE_TOKEN_SYMBOL;
}

// Create a new organization
export const create = mutation({
  args: {
    name: v.string(),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Get user
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Create org
    const orgId = await ctx.db.insert("orgs", {
      name: args.name,
      createdBy: user._id,
      relayFeeTokenSymbol: DEFAULT_RELAY_FEE_TOKEN_SYMBOL,
      relayFeeMode: DEFAULT_RELAY_FEE_MODE,
      createdAt: now,
    });

    // Create membership for creator as admin
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: user._id,
      role: "admin",
      status: "active",
      createdAt: now,
    });

    // Create trial billing record (30 days)
    await ctx.db.insert("billing", {
      orgId,
      plan: "trial",
      trialEndsAt: now + 30 * 24 * 60 * 60 * 1000,
      status: "trial",
      createdAt: now,
      updatedAt: now,
    });

    // Auto-add Disburse subscription beneficiary (silently skipped if env vars are missing)
    if (DISBURSE_BENEFICIARY_ADDRESS && DISBURSE_BENEFICIARY_TOKEN && DISBURSE_BENEFICIARY_CHAIN_ID) {
      const disburseBeneficiaryId = await ctx.db.insert("beneficiaries", {
        orgId,
        type: "business",
        name: "Disburse",
        walletAddress: DISBURSE_BENEFICIARY_ADDRESS,
        notes: "Subscription payments for Disburse",
        preferredToken: DISBURSE_BENEFICIARY_TOKEN,
        preferredChainId: DISBURSE_BENEFICIARY_CHAIN_ID,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("auditLog", {
        orgId,
        actorUserId: user._id,
        action: "beneficiary.created",
        objectType: "beneficiary",
        objectId: disburseBeneficiaryId,
        metadata: {
          autoCreated: true,
          name: "Disburse",
          walletAddress: DISBURSE_BENEFICIARY_ADDRESS,
        },
        timestamp: now,
      });
    }

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId,
      actorUserId: user._id,
      action: "org.created",
      objectType: "org",
      objectId: orgId,
      timestamp: now,
    });

    return { orgId };
  },
});

// Get orgs for a user
export const listForUser = query({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Get user
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      return [];
    }

    // Get memberships
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    // Get orgs
    const orgs = await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        return org ? { ...org, role: m.role } : null;
      })
    );

    return orgs.filter(Boolean);
  },
});

// Get single org by ID
export const get = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.orgId);
  },
});

// Update org name
export const updateName = mutation({
  args: {
    orgId: v.id("orgs"),
    name: v.string(),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Verify user has admin access
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!membership || membership.role !== "admin") {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.orgId, { name: args.name });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "org.updated",
      objectType: "org",
      objectId: args.orgId,
      metadata: { name: args.name },
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Update org relay fee settings
export const updateRelaySettings = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    relayFeeTokenSymbol: v.string(),
    relayFeeMode: v.union(
      v.literal("stablecoin_preferred"),
      v.literal("stablecoin_only")
    ),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!membership || membership.role !== "admin") {
      throw new Error("Not authorized");
    }

    const relayFeeTokenSymbol = normalizeRelayFeeTokenSymbol(
      args.relayFeeTokenSymbol
    );
    const relayFeeMode = normalizeRelayFeeMode(args.relayFeeMode);

    await ctx.db.patch(args.orgId, {
      relayFeeTokenSymbol,
      relayFeeMode,
    });

    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "org.relaySettingsUpdated",
      objectType: "org",
      objectId: args.orgId,
      metadata: { relayFeeTokenSymbol, relayFeeMode },
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Update the calling user's own membership name and/or email within an org.
// Used during onboarding to persist profile info right after org creation
// without needing to first fetch the membershipId.
export const updateOwnProfile = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!membership || membership.status !== "active") {
      throw new Error("Not a member of this organization");
    }

    const patch: Record<string, string | undefined> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.email !== undefined) patch.email = args.email;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(membership._id, patch);
    }

    return { success: true };
  },
});

// List all members of an org
export const listMembers = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Verify user is a member
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const userMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!userMembership || userMembership.status !== "active") {
      throw new Error("Not a member of this organization");
    }

    // Get all memberships for this org
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    // Get user details for each membership
    const members = await Promise.all(
      memberships.map(async (m) => {
        const memberUser = await ctx.db.get(m.userId);
        return memberUser
          ? {
              membershipId: m._id,
              userId: m.userId,
              walletAddress: memberUser.walletAddress,
              email: m.email, // Use membership email (org-specific)
              name: m.name, // Optional display name
              role: m.role,
              status: m.status,
              createdAt: m.createdAt,
            }
          : null;
      })
    );

    return members.filter(Boolean);
  },
});

// Invite a new member to an org
export const inviteMember = mutation({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    memberWalletAddress: v.string(),
    memberName: v.optional(v.string()), // Optional display name
    memberEmail: v.optional(v.string()), // Optional email
    role: v.union(
      v.literal("admin"),
      v.literal("approver"),
      v.literal("initiator"),
      v.literal("clerk"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const memberWalletAddress = args.memberWalletAddress.toLowerCase();
    const now = Date.now();

    // Verify user has admin access
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const userMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!userMembership || userMembership.role !== "admin") {
      throw new Error("Only admins can invite members");
    }

    // Check tier limits for users
    const limits = await getOrgLimits(ctx, args.orgId);
    const activeMembers = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    if (activeMembers.length >= limits.maxUsers) {
      throw new Error(`Your plan allows a maximum of ${limits.maxUsers} user(s). Please upgrade to add more team members.`);
    }

    // Check if member already exists or create new user
    let memberUser = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", memberWalletAddress))
      .first();

    if (!memberUser) {
      // Create new user for invited member
      const userId = await ctx.db.insert("users", {
        walletAddress: memberWalletAddress,
        createdAt: now,
      });
      memberUser = await ctx.db.get(userId);
    }

    if (!memberUser) {
      throw new Error("Failed to create user");
    }

    // Check if membership already exists
    const existingMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", memberUser._id)
      )
      .first();

    if (existingMembership) {
      if (existingMembership.status === "active") {
        throw new Error("User is already a member of this organization");
      }
      // Reactivate removed member
      await ctx.db.patch(existingMembership._id, {
        role: args.role,
        status: "active",
        name: args.memberName,
        email: args.memberEmail,
      });
      
      // Audit log
      await ctx.db.insert("auditLog", {
        orgId: args.orgId,
        actorUserId: user._id,
        action: "member.reactivated",
        objectType: "orgMembership",
        objectId: existingMembership._id,
        metadata: { memberWalletAddress, role: args.role, name: args.memberName, email: args.memberEmail },
        timestamp: now,
      });

      return { membershipId: existingMembership._id };
    }

    // Create new membership
    const membershipId = await ctx.db.insert("orgMemberships", {
      orgId: args.orgId,
      userId: memberUser._id,
      name: args.memberName,
      email: args.memberEmail,
      role: args.role,
      status: "active",
      createdAt: now,
    });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "member.invited",
      objectType: "orgMembership",
      objectId: membershipId,
      metadata: { memberWalletAddress, role: args.role, name: args.memberName, email: args.memberEmail },
      timestamp: now,
    });

    return { membershipId };
  },
});

// Update a member's role
export const updateMemberRole = mutation({
  args: {
    orgId: v.id("orgs"),
    membershipId: v.id("orgMemberships"),
    walletAddress: v.string(),
    newRole: v.union(
      v.literal("admin"),
      v.literal("approver"),
      v.literal("initiator"),
      v.literal("clerk"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Verify user has admin access
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const userMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!userMembership || userMembership.role !== "admin") {
      throw new Error("Only admins can update member roles");
    }

    // Get target membership
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== args.orgId) {
      throw new Error("Membership not found");
    }

    // Prevent demoting the last admin
    if (membership.role === "admin" && args.newRole !== "admin") {
      const adminCount = await ctx.db
        .query("orgMemberships")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .filter((q) =>
          q.and(q.eq(q.field("role"), "admin"), q.eq(q.field("status"), "active"))
        )
        .collect();

      if (adminCount.length <= 1) {
        throw new Error("Cannot demote the last admin");
      }
    }

    const oldRole = membership.role;
    await ctx.db.patch(args.membershipId, { role: args.newRole });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "member.roleUpdated",
      objectType: "orgMembership",
      objectId: args.membershipId,
      metadata: { oldRole, newRole: args.newRole },
      timestamp: now,
    });

    return { success: true };
  },
});

// Update a member's name
export const updateMemberName = mutation({
  args: {
    orgId: v.id("orgs"),
    membershipId: v.id("orgMemberships"),
    walletAddress: v.string(),
    name: v.optional(v.string()), // Can clear name by passing undefined
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Verify user is a member (any member can update their own name, admins can update anyone's)
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const userMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!userMembership || userMembership.status !== "active") {
      throw new Error("Not a member of this organization");
    }

    // Get target membership
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== args.orgId) {
      throw new Error("Membership not found");
    }

    // Check permissions: admin can update anyone, users can update themselves
    const isAdmin = userMembership.role === "admin";
    const isOwnMembership = membership._id === userMembership._id;
    
    if (!isAdmin && !isOwnMembership) {
      throw new Error("You can only update your own name");
    }

    const oldName = membership.name;
    await ctx.db.patch(args.membershipId, { name: args.name });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "member.nameUpdated",
      objectType: "orgMembership",
      objectId: args.membershipId,
      metadata: { oldName, newName: args.name },
      timestamp: now,
    });

    return { success: true };
  },
});

// Update a member's email
export const updateMemberEmail = mutation({
  args: {
    orgId: v.id("orgs"),
    membershipId: v.id("orgMemberships"),
    walletAddress: v.string(),
    email: v.optional(v.string()), // Can clear email by passing undefined
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Verify user is a member (any member can update their own email, admins can update anyone's)
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const userMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!userMembership || userMembership.status !== "active") {
      throw new Error("Not a member of this organization");
    }

    // Get target membership
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== args.orgId) {
      throw new Error("Membership not found");
    }

    // Check permissions: admin can update anyone, users can update themselves
    const isAdmin = userMembership.role === "admin";
    const isOwnMembership = membership._id === userMembership._id;
    
    if (!isAdmin && !isOwnMembership) {
      throw new Error("You can only update your own email");
    }

    const oldEmail = membership.email;
    await ctx.db.patch(args.membershipId, { email: args.email });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "member.emailUpdated",
      objectType: "orgMembership",
      objectId: args.membershipId,
      metadata: { oldEmail, newEmail: args.email },
      timestamp: now,
    });

    return { success: true };
  },
});

// Remove a member from an org
export const removeMember = mutation({
  args: {
    orgId: v.id("orgs"),
    membershipId: v.id("orgMemberships"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Verify user has admin access
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const userMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id)
      )
      .first();

    if (!userMembership || userMembership.role !== "admin") {
      throw new Error("Only admins can remove members");
    }

    // Get target membership
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== args.orgId) {
      throw new Error("Membership not found");
    }

    // Prevent removing the last admin
    if (membership.role === "admin") {
      const adminCount = await ctx.db
        .query("orgMemberships")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .filter((q) =>
          q.and(q.eq(q.field("role"), "admin"), q.eq(q.field("status"), "active"))
        )
        .collect();

      if (adminCount.length <= 1) {
        throw new Error("Cannot remove the last admin");
      }
    }

    // Prevent self-removal
    if (membership.userId === user._id) {
      throw new Error("Cannot remove yourself");
    }

    await ctx.db.patch(args.membershipId, { status: "removed" });

    // Audit log
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorUserId: user._id,
      action: "member.removed",
      objectType: "orgMembership",
      objectId: args.membershipId,
      metadata: { removedUserId: membership.userId },
      timestamp: now,
    });

    return { success: true };
  },
});
