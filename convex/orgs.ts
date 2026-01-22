import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOrgLimits } from "./billing";

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
              email: memberUser.email,
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
      });
      
      // Audit log
      await ctx.db.insert("auditLog", {
        orgId: args.orgId,
        actorUserId: user._id,
        action: "member.reactivated",
        objectType: "orgMembership",
        objectId: existingMembership._id,
        metadata: { memberWalletAddress, role: args.role, name: args.memberName },
        timestamp: now,
      });

      return { membershipId: existingMembership._id };
    }

    // Create new membership
    const membershipId = await ctx.db.insert("orgMemberships", {
      orgId: args.orgId,
      userId: memberUser._id,
      name: args.memberName,
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
      metadata: { memberWalletAddress, role: args.role, name: args.memberName },
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
