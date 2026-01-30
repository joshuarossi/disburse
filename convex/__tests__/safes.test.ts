import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  createFullOrgSetup,
  createTestUser,
  createTestOrg,
  createTestSafe,
  TEST_WALLETS,
} from "./factories";

describe("Safes", () => {
  describe("getForOrg", () => {
    it("returns array of safes (one per chain)", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const safes = await t.query(api.safes.getForOrg, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(Array.isArray(safes)).toBe(true);
      expect(safes.length).toBe(1);
      expect(safes[0]?.chainId).toBe(11155111);
    });
  });

  describe("getForOrgAndChain", () => {
    it("returns safe for org on given chain", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const safe = await t.query(api.safes.getForOrgAndChain, {
        orgId: orgId! as any,
        chainId: 11155111,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(safe).not.toBeNull();
      expect(safe?.chainId).toBe(11155111);
    });

    it("returns null when no safe linked for chain", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      const safe = await t.query(api.safes.getForOrgAndChain, {
        orgId: orgId! as any,
        chainId: 1, // Mainnet - not linked
        walletAddress: TEST_WALLETS.admin,
      });

      expect(safe).toBeNull();
    });
  });

  describe("link (multi-chain)", () => {
    it("allows linking same Safe address on another chain", async () => {
      const t = convexTest(schema);

      let orgId: string;
      const safeAddress = "0xabcdef1234567890abcdef1234567890abcdef12";
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId);
        orgId = id;
        await createTestSafe(ctx, id, { chainId: 11155111, safeAddress });
      });

      const linkResult = await t.mutation(api.safes.link, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
        chainId: 1,
        safeAddress,
      });

      expect(linkResult.safeId).toBeDefined();

      const safes = await t.query(api.safes.getForOrg, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(safes.length).toBe(2);
      expect(safes.every((s) => s?.safeAddress === safeAddress.toLowerCase())).toBe(true);
      expect(safes.map((s) => s?.chainId).sort()).toEqual([1, 11155111]);
    });

    it("throws when linking different address and org already has a safe", async () => {
      const t = convexTest(schema);

      let orgId: string;
      await t.run(async (ctx) => {
        const setup = await createFullOrgSetup(ctx, {
          walletAddress: TEST_WALLETS.admin,
        });
        orgId = setup.orgId;
      });

      await expect(
        t.mutation(api.safes.link, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.admin,
          chainId: 1,
          safeAddress: "0xdifferentaddress123456789012345678901234",
        })
      ).rejects.toThrow(/same across all chains/);
    });

    it("throws when chain already has a safe linked", async () => {
      const t = convexTest(schema);

      let orgId: string;
      const safeAddress = "0xsameaddress12345678901234567890123456";
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId);
        orgId = id;
        await createTestSafe(ctx, id, { chainId: 11155111, safeAddress });
      });

      await expect(
        t.mutation(api.safes.link, {
          orgId: orgId! as any,
          walletAddress: TEST_WALLETS.admin,
          chainId: 11155111,
          safeAddress,
        })
      ).rejects.toThrow(/already linked for this chain/);
    });
  });

  describe("unlink", () => {
    it("removes one chain only; other chains remain", async () => {
      const t = convexTest(schema);

      const safeAddress = "0xunlinktest12345678901234567890123456";
      const { orgId, safeIdSepolia } = await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        const { orgId: id } = await createTestOrg(ctx, userId);
        const safeIdSepolia = await createTestSafe(ctx, id, { chainId: 11155111, safeAddress });
        await createTestSafe(ctx, id, { chainId: 1, safeAddress });
        return { orgId: id, safeIdSepolia };
      });

      await t.mutation(api.safes.unlink, {
        safeId: safeIdSepolia as any,
        walletAddress: TEST_WALLETS.admin,
      });

      const safes = await t.query(api.safes.getForOrg, {
        orgId: orgId! as any,
        walletAddress: TEST_WALLETS.admin,
      });

      expect(safes.length).toBe(1);
      expect(safes[0]?.chainId).toBe(1);

      const forSepolia = await t.query(api.safes.getForOrgAndChain, {
        orgId: orgId! as any,
        chainId: 11155111,
        walletAddress: TEST_WALLETS.admin,
      });
      expect(forSepolia).toBeNull();

      const forMainnet = await t.query(api.safes.getForOrgAndChain, {
        orgId: orgId! as any,
        chainId: 1,
        walletAddress: TEST_WALLETS.admin,
      });
      expect(forMainnet).not.toBeNull();
    });
  });
});
