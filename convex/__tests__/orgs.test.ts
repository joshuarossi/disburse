import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import schema from "../schema";
import {
  createTestUser,
  createTestOrg,
  createTestMembership,
  createFullOrgSetup,
  TEST_WALLETS,
} from "./factories";

describe("Orgs", () => {
  describe("create", () => {
    it("creates org with membership and billing", async () => {
      const t = convexTest(schema);

      // First create user via auth
      await t.mutation(api.auth.generateNonce, {
        walletAddress: TEST_WALLETS.admin,
      });

      const result = await t.mutation(api.orgs.create, {
        name: "Test Organization",
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.orgId).toBeDefined();

      // Verify org, membership, and billing were created
      await t.run(async (ctx) => {
        const org = await ctx.db.get(result.orgId as any) as Doc<"orgs"> | null;
        expect(org).not.toBeNull();
        expect(org?.name).toBe("Test Organization");

        // Check membership
        const memberships = await ctx.db
          .query("orgMemberships")
          .withIndex("by_org", (q) => q.eq("orgId", result.orgId as any))
          .collect();
        expect(memberships.length).toBe(1);
        expect(memberships[0].role).toBe("admin");
        expect(memberships[0].status).toBe("active");

        // Check billing (trial)
        const billing = await ctx.db
          .query("billing")
          .withIndex("by_org", (q) => q.eq("orgId", result.orgId as any))
          .first();
        expect(billing).not.toBeNull();
        expect(billing?.plan).toBe("trial");
        expect(billing?.status).toBe("trial");
        expect(billing?.trialEndsAt).toBeDefined();
      });
    });

    it("creates audit log", async () => {
      const t = convexTest(schema);

      await t.mutation(api.auth.generateNonce, {
        walletAddress: TEST_WALLETS.admin,
      });

      const result = await t.mutation(api.orgs.create, {
        name: "Audit Test Org",
        walletAddress: TEST_WALLETS.admin,
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", result.orgId as any))
          .collect();

        const createLog = logs.find((l) => l.action === "org.created");
        expect(createLog).toBeDefined();
      });
    });

    it("throws for non-existent user", async () => {
      const t = convexTest(schema);

      await expect(
        t.mutation(api.orgs.create, {
          name: "Test Org",
          walletAddress: TEST_WALLETS.nonMember, // No user created
        })
      ).rejects.toThrow("User not found");
    });
  });

  describe("listForUser", () => {
    it("returns orgs for user", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        await createTestOrg(ctx, userId, { name: "Org 1" });
        await createTestOrg(ctx, userId, { name: "Org 2" });
      });

      const result = await t.query(api.orgs.listForUser, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.length).toBe(2);
    });

    it("includes role in response", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        await createTestOrg(ctx, userId, { role: "admin" });
      });

      const result = await t.query(api.orgs.listForUser, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result[0]?.role).toBe("admin");
    });

    it("excludes orgs where user is removed", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId } = await createTestOrg(ctx, userId, { name: "Active Org" });

        // Create another org where user is removed
        const otherUserId = await createTestUser(ctx);
        const { orgId: removedOrgId } = await createTestOrg(ctx, otherUserId, { name: "Removed Org" });
        await createTestMembership(ctx, removedOrgId as any, userId, { status: "removed" });
      });

      const result = await t.query(api.orgs.listForUser, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe("Active Org");
    });

    it("returns empty array for non-existent user", async () => {
      const t = convexTest(schema);

      const result = await t.query(api.orgs.listForUser, {
        walletAddress: TEST_WALLETS.nonMember,
      });

      expect(result).toEqual([]);
    });
  });

  describe("get", () => {
    it("returns org by ID", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx);
        const { orgId: id } = await createTestOrg(ctx, userId, { name: "Test Org" });
        orgId = id;
      });

      const result = await t.query(api.orgs.get, {
        orgId: orgId! as any,
      });

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Test Org");
    });
  });

  describe("updateName", () => {
    it("updates org name", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          orgName: "Old Name",
        });
        orgId = setup.orgId;
      });

      await t.mutation(api.orgs.updateName, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        name: "New Name",
      });

      const result = await t.query(api.orgs.get, {
        orgId: orgId! as any,
      });

      expect(result?.name).toBe("New Name");
    });

    it("rejects non-admin", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      await expect(
        t.mutation(api.orgs.updateName, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.viewer,
          name: "Hacked Name",
        })
      ).rejects.toThrow("Not authorized");
    });

    it("creates audit log", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      await t.mutation(api.orgs.updateName, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        name: "Updated Name",
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const updateLog = logs.find((l) => l.action === "org.updated");
        expect(updateLog).toBeDefined();
        expect(updateLog?.metadata?.name).toBe("Updated Name");
      });
    });
  });

  describe("inviteMember", () => {
    it("invites new member with specified role", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          plan: "team", // Allows 5 users
        });
        orgId = setup.orgId;
      });

      const result = await t.mutation(api.orgs.inviteMember, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        memberWalletAddress: TEST_WALLETS.viewer,
        role: "viewer",
      });

      expect(result.membershipId).toBeDefined();

      // Verify member was added
      await t.run(async (ctx) => {
        const membership = await ctx.db.get(result.membershipId as any) as Doc<"orgMemberships"> | null;
        expect(membership?.role).toBe("viewer");
        expect(membership?.status).toBe("active");
      });
    });

    it("creates user if not exists", async () => {
      const t = convexTest(schema);

      let orgId: string;
      const newWallet = "0x9999999999999999999999999999999999999999";
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          plan: "team",
        });
        orgId = setup.orgId;
      });

      await t.mutation(api.orgs.inviteMember, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        memberWalletAddress: newWallet,
        role: "initiator",
      });

      // Verify user was created
      await t.run(async (ctx) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_wallet", (q) => q.eq("walletAddress", newWallet.toLowerCase()))
          .first();

        expect(user).not.toBeNull();
      });
    });

    it("reactivates removed member", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let membershipId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          plan: "team",
        });
        orgId = setup.orgId;

        // Add and remove a member
        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        membershipId = await createTestMembership(ctx, orgId as any, viewerId, {
          role: "viewer",
          status: "removed",
        });
      });

      const result = await t.mutation(api.orgs.inviteMember, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        memberWalletAddress: TEST_WALLETS.viewer,
        role: "approver", // New role
      });

      // Verify member was reactivated with new role
      await t.run(async (ctx) => {
        const membership = await ctx.db.get(result.membershipId as any) as Doc<"orgMemberships"> | null;
        expect(membership?.status).toBe("active");
        expect(membership?.role).toBe("approver");
      });
    });

    it("throws for already active member", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
          plan: "team",
        });
        orgId = setup.orgId;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer", status: "active" });
      });

      await expect(
        t.mutation(api.orgs.inviteMember, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.admin,
          memberWalletAddress: TEST_WALLETS.viewer,
          role: "approver",
        })
      ).rejects.toThrow("already a member");
    });

    it("enforces starter tier limit (1 user)", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "starter",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;
      });

      // Try to add second user (should fail)
      await expect(
        t.mutation(api.orgs.inviteMember, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.admin,
          memberWalletAddress: TEST_WALLETS.viewer,
          role: "viewer",
        })
      ).rejects.toThrow("maximum of 1 user");
    });

    it("enforces team tier limit (5 users)", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "team",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;

        // Add 4 more users (total 5)
        for (let i = 0; i < 4; i++) {
          const memberId = await createTestUser(ctx);
          await createTestMembership(ctx, orgId as any, memberId, { role: "viewer" });
        }
      });

      // 6th user should fail
      await expect(
        t.mutation(api.orgs.inviteMember, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.admin,
          memberWalletAddress: TEST_WALLETS.nonMember,
          role: "viewer",
        })
      ).rejects.toThrow("maximum of 5 user");
    });

    it("allows unlimited users for pro tier", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId, {
          plan: "pro",
          paidThroughAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          billingStatus: "active",
        });
        orgId = id;

        // Add many users
        for (let i = 0; i < 10; i++) {
          const memberId = await createTestUser(ctx);
          await createTestMembership(ctx, orgId as any, memberId, { role: "viewer" });
        }
      });

      // Should still work
      const result = await t.mutation(api.orgs.inviteMember, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        memberWalletAddress: TEST_WALLETS.nonMember,
        role: "viewer",
      });

      expect(result.membershipId).toBeDefined();
    });

    it("rejects non-admin", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId, { plan: "team" });
        orgId = id;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      await expect(
        t.mutation(api.orgs.inviteMember, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.viewer,
          memberWalletAddress: TEST_WALLETS.nonMember,
          role: "clerk",
        })
      ).rejects.toThrow("Only admins");
    });
  });

  describe("updateMemberRole", () => {
    it("updates member role", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let membershipId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        membershipId = await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      await t.mutation(api.orgs.updateMemberRole, {
        orgId: orgId! as any,
        membershipId: membershipId! as any,
        walletAddress: TEST_WALLETS.admin,
        newRole: "approver",
      });

      await t.run(async (ctx) => {
        const membership = await ctx.db.get(membershipId as any) as Doc<"orgMemberships"> | null;
        expect(membership?.role).toBe("approver");
      });
    });

    it("prevents demoting last admin", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let membershipId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        membershipId = setup.membershipId;
      });

      await expect(
        t.mutation(api.orgs.updateMemberRole, {
          orgId: orgId! as any,
          membershipId: membershipId! as any,
          walletAddress: TEST_WALLETS.admin,
          newRole: "viewer",
        })
      ).rejects.toThrow("Cannot demote the last admin");
    });

    it("allows demoting admin if another admin exists", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let firstAdminMembershipId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        firstAdminMembershipId = setup.membershipId;

        // Add second admin
        const secondAdminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.approver });
        await createTestMembership(ctx, orgId as any, secondAdminId, { role: "admin" });
      });

      // Should work now
      await t.mutation(api.orgs.updateMemberRole, {
        orgId: orgId! as any,
        membershipId: firstAdminMembershipId! as any,
        walletAddress: TEST_WALLETS.admin,
        newRole: "viewer",
      });

      await t.run(async (ctx) => {
        const membership = await ctx.db.get(firstAdminMembershipId as any) as Doc<"orgMemberships"> | null;
        expect(membership?.role).toBe("viewer");
      });
    });

    it("creates audit log", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let membershipId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        membershipId = await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      await t.mutation(api.orgs.updateMemberRole, {
        orgId: orgId! as any,
        membershipId: membershipId! as any,
        walletAddress: TEST_WALLETS.admin,
        newRole: "clerk",
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const roleLog = logs.find((l) => l.action === "member.roleUpdated");
        expect(roleLog).toBeDefined();
        expect(roleLog?.metadata?.oldRole).toBe("viewer");
        expect(roleLog?.metadata?.newRole).toBe("clerk");
      });
    });
  });

  describe("removeMember", () => {
    it("removes member", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let membershipId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        membershipId = await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      await t.mutation(api.orgs.removeMember, {
        orgId: orgId! as any,
        membershipId: membershipId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      await t.run(async (ctx) => {
        const membership = await ctx.db.get(membershipId as any) as Doc<"orgMemberships"> | null;
        expect(membership?.status).toBe("removed");
      });
    });

    it("prevents removing last admin", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let membershipId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        membershipId = setup.membershipId;
      });

      await expect(
        t.mutation(api.orgs.removeMember, {
          orgId: orgId! as any,
          membershipId: membershipId! as any,
          walletAddress: TEST_WALLETS.admin,
        })
      ).rejects.toThrow("Cannot remove the last admin");
    });

    it("prevents self-removal", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let membershipId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
        membershipId = setup.membershipId;

        // Add second admin so last admin check doesn't fail first
        const secondAdminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.approver });
        await createTestMembership(ctx, orgId as any, secondAdminId, { role: "admin" });
      });

      await expect(
        t.mutation(api.orgs.removeMember, {
          orgId: orgId! as any,
          membershipId: membershipId! as any,
          walletAddress: TEST_WALLETS.admin,
        })
      ).rejects.toThrow("Cannot remove yourself");
    });

    it("creates audit log", async () => {
      const t = convexTest(schema);

      let orgId: string;
      let membershipId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        membershipId = await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      await t.mutation(api.orgs.removeMember, {
        orgId: orgId! as any,
        membershipId: membershipId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      await t.run(async (ctx) => {
        const logs = await ctx.db
          .query("auditLog")
          .withIndex("by_org", (q) => q.eq("orgId", orgId as any))
          .collect();

        const removeLog = logs.find((l) => l.action === "member.removed");
        expect(removeLog).toBeDefined();
      });
    });
  });

  describe("listMembers", () => {
    it("returns all members with details", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      const result = await t.query(api.orgs.listMembers, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.length).toBe(2);
      expect(result.some((m) => m?.role === "admin")).toBe(true);
      expect(result.some((m) => m?.role === "viewer")).toBe(true);
    });

    it("includes wallet address in response", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const result = await t.query(api.orgs.listMembers, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result[0]?.walletAddress).toBe(TEST_WALLETS.admin.toLowerCase());
    });

    it("allows viewer to list members", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, adminId);
        orgId = id;

        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId as any, viewerId, { role: "viewer" });
      });

      const result = await t.query(api.orgs.listMembers, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.viewer,
      });

      expect(result.length).toBe(2);
    });
  });
});
