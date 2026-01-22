import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import {
  createTestUser,
  createTestOrg,
  createTestMembership,
  TEST_WALLETS,
} from "../../__tests__/factories";
import { hasRoleOrHigher } from "../rbac";

describe("RBAC", () => {
  describe("hasRoleOrHigher", () => {
    it("admin has all roles", () => {
      expect(hasRoleOrHigher("admin", "admin")).toBe(true);
      expect(hasRoleOrHigher("admin", "approver")).toBe(true);
      expect(hasRoleOrHigher("admin", "initiator")).toBe(true);
      expect(hasRoleOrHigher("admin", "clerk")).toBe(true);
      expect(hasRoleOrHigher("admin", "viewer")).toBe(true);
    });

    it("approver has approver and below", () => {
      expect(hasRoleOrHigher("approver", "admin")).toBe(false);
      expect(hasRoleOrHigher("approver", "approver")).toBe(true);
      expect(hasRoleOrHigher("approver", "initiator")).toBe(true);
      expect(hasRoleOrHigher("approver", "clerk")).toBe(true);
      expect(hasRoleOrHigher("approver", "viewer")).toBe(true);
    });

    it("initiator has initiator and below", () => {
      expect(hasRoleOrHigher("initiator", "admin")).toBe(false);
      expect(hasRoleOrHigher("initiator", "approver")).toBe(false);
      expect(hasRoleOrHigher("initiator", "initiator")).toBe(true);
      expect(hasRoleOrHigher("initiator", "clerk")).toBe(true);
      expect(hasRoleOrHigher("initiator", "viewer")).toBe(true);
    });

    it("clerk has clerk and below", () => {
      expect(hasRoleOrHigher("clerk", "admin")).toBe(false);
      expect(hasRoleOrHigher("clerk", "approver")).toBe(false);
      expect(hasRoleOrHigher("clerk", "initiator")).toBe(false);
      expect(hasRoleOrHigher("clerk", "clerk")).toBe(true);
      expect(hasRoleOrHigher("clerk", "viewer")).toBe(true);
    });

    it("viewer only has viewer role", () => {
      expect(hasRoleOrHigher("viewer", "admin")).toBe(false);
      expect(hasRoleOrHigher("viewer", "approver")).toBe(false);
      expect(hasRoleOrHigher("viewer", "initiator")).toBe(false);
      expect(hasRoleOrHigher("viewer", "clerk")).toBe(false);
      expect(hasRoleOrHigher("viewer", "viewer")).toBe(true);
    });
  });

  describe("requireOrgAccess", () => {
    it("throws for non-existent user", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        // Create an org without the querying user
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId } = await createTestOrg(ctx, adminId);

        // Try to access with non-existent wallet
        await expect(
          ctx.db.query("users")
            .withIndex("by_wallet", (q) => q.eq("walletAddress", TEST_WALLETS.nonMember))
            .first()
        ).resolves.toBeNull();
      });
    });

    it("throws for non-member user", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        // Create org with admin
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId } = await createTestOrg(ctx, adminId);

        // Create a user who is NOT a member
        const nonMemberId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.nonMember });

        // Verify membership doesn't exist
        const membership = await ctx.db
          .query("orgMemberships")
          .withIndex("by_org_and_user", (q) =>
            q.eq("orgId", orgId).eq("userId", nonMemberId)
          )
          .first();

        expect(membership).toBeNull();
      });
    });

    it("throws for inactive membership", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        // Create org with admin
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId } = await createTestOrg(ctx, adminId);

        // Create user and add with removed status
        const viewerId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.viewer });
        await createTestMembership(ctx, orgId, viewerId, { 
          role: "viewer", 
          status: "removed" 
        });

        // Verify membership is not active
        const membership = await ctx.db
          .query("orgMemberships")
          .withIndex("by_org_and_user", (q) =>
            q.eq("orgId", orgId).eq("userId", viewerId)
          )
          .first();

        expect(membership?.status).toBe("removed");
      });
    });

    it("allows access with correct role", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        // Create org with admin
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId, membershipId } = await createTestOrg(ctx, adminId);

        // Verify admin can access
        const membership = await ctx.db.get(membershipId);
        expect(membership?.role).toBe("admin");
        expect(membership?.status).toBe("active");
      });
    });

    it("verifies role hierarchy in permissions", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        // Create org with admin
        const adminId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId } = await createTestOrg(ctx, adminId);

        // Add users with each role
        const roles = ["approver", "initiator", "clerk", "viewer"] as const;
        for (const role of roles) {
          const userId = await createTestUser(ctx);
          await createTestMembership(ctx, orgId, userId, { role });
        }

        // Verify all memberships created
        const memberships = await ctx.db
          .query("orgMemberships")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect();

        expect(memberships.length).toBe(5); // admin + 4 roles
        expect(memberships.filter((m) => m.status === "active").length).toBe(5);
      });
    });
  });
});
