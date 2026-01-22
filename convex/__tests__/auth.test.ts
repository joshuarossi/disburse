import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  createTestUser,
  createTestSession,
  TEST_WALLETS,
} from "./factories";

describe("Auth", () => {
  describe("generateNonce", () => {
    it("creates user if not exists", async () => {
      const t = convexTest(schema);

      // Generate nonce for new wallet
      const result = await t.mutation(api.auth.generateNonce, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.nonce).toBeDefined();
      expect(typeof result.nonce).toBe("string");
      expect(result.nonce.length).toBeGreaterThan(0);

      // Verify user was created
      await t.run(async (ctx) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_wallet", (q) => q.eq("walletAddress", TEST_WALLETS.admin.toLowerCase()))
          .first();

        expect(user).not.toBeNull();
        expect(user?.walletAddress).toBe(TEST_WALLETS.admin.toLowerCase());
      });
    });

    it("deletes existing sessions when generating new nonce", async () => {
      const t = convexTest(schema);

      // Create user with existing session
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        await createTestSession(ctx, userId, TEST_WALLETS.admin);
      });

      // Generate new nonce (should delete old session)
      const result = await t.mutation(api.auth.generateNonce, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.nonce).toBeDefined();

      // Verify only one session exists
      await t.run(async (ctx) => {
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_wallet", (q) => q.eq("walletAddress", TEST_WALLETS.admin.toLowerCase()))
          .collect();

        expect(sessions.length).toBe(1);
        expect(sessions[0].nonce).toBe(result.nonce);
      });
    });

    it("returns valid UUID format nonce", async () => {
      const t = convexTest(schema);

      const result = await t.mutation(api.auth.generateNonce, {
        walletAddress: TEST_WALLETS.admin,
      });

      // UUID format: 8-4-4-4-12
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(result.nonce).toMatch(uuidRegex);
    });

    it("normalizes wallet address to lowercase", async () => {
      const t = convexTest(schema);
      const mixedCaseAddress = "0xABCDef1234567890123456789012345678901234";

      await t.mutation(api.auth.generateNonce, {
        walletAddress: mixedCaseAddress,
      });

      await t.run(async (ctx) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_wallet", (q) => q.eq("walletAddress", mixedCaseAddress.toLowerCase()))
          .first();

        expect(user).not.toBeNull();
        expect(user?.walletAddress).toBe(mixedCaseAddress.toLowerCase());
      });
    });
  });

  describe("verifySignature", () => {
    it("throws for missing session", async () => {
      const t = convexTest(schema);

      await expect(
        t.mutation(api.auth.verifySignature, {
          walletAddress: TEST_WALLETS.admin,
          signature: "0xfakesig",
          message: "Sign in",
        })
      ).rejects.toThrow("No pending session found");
    });

    it("throws for expired session", async () => {
      const t = convexTest(schema);

      // Create user with expired session
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        await createTestSession(ctx, userId, TEST_WALLETS.admin, {
          nonce: "test-nonce",
          expiresAt: Date.now() - 1000, // Expired 1 second ago
        });
      });

      await expect(
        t.mutation(api.auth.verifySignature, {
          walletAddress: TEST_WALLETS.admin,
          signature: "0xfakesig",
          message: "Sign in with nonce: test-nonce",
        })
      ).rejects.toThrow("Session expired");
    });

    it("throws for invalid nonce in message", async () => {
      const t = convexTest(schema);

      // Create user with session
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        await createTestSession(ctx, userId, TEST_WALLETS.admin, {
          nonce: "correct-nonce",
          expiresAt: Date.now() + 60000,
        });
      });

      await expect(
        t.mutation(api.auth.verifySignature, {
          walletAddress: TEST_WALLETS.admin,
          signature: "0xfakesig",
          message: "Sign in with nonce: wrong-nonce",
        })
      ).rejects.toThrow("Invalid nonce in message");
    });

    it("extends session on successful verification", async () => {
      const t = convexTest(schema);
      const nonce = "valid-nonce";

      // Create user with session
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        await createTestSession(ctx, userId, TEST_WALLETS.admin, {
          nonce,
          expiresAt: Date.now() + 60000, // 1 minute
        });
      });

      const beforeVerify = Date.now();

      const result = await t.mutation(api.auth.verifySignature, {
        walletAddress: TEST_WALLETS.admin,
        signature: "0xfakesig",
        message: `Sign in with nonce: ${nonce}`,
      });

      expect(result.sessionId).toBeDefined();
      expect(result.userId).toBeDefined();
      expect(result.walletAddress).toBe(TEST_WALLETS.admin.toLowerCase());

      // Verify session was extended to 7 days
      await t.run(async (ctx) => {
        const session = await ctx.db
          .query("sessions")
          .withIndex("by_wallet", (q) => q.eq("walletAddress", TEST_WALLETS.admin.toLowerCase()))
          .first();

        expect(session).not.toBeNull();
        // Session should be extended to ~7 days from now
        const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
        expect(session!.expiresAt).toBeGreaterThan(beforeVerify + sevenDaysInMs - 1000);
      });
    });
  });

  describe("getSession", () => {
    it("returns null for non-existent session", async () => {
      const t = convexTest(schema);

      const result = await t.query(api.auth.getSession, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result).toBeNull();
    });

    it("returns null for expired session", async () => {
      const t = convexTest(schema);

      // Create user with expired session
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        await createTestSession(ctx, userId, TEST_WALLETS.admin, {
          expiresAt: Date.now() - 1000,
        });
      });

      const result = await t.query(api.auth.getSession, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result).toBeNull();
    });

    it("returns session data for valid session", async () => {
      const t = convexTest(schema);

      // Create user with valid session
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { 
          walletAddress: TEST_WALLETS.admin,
          email: "test@example.com",
        });
        await createTestSession(ctx, userId, TEST_WALLETS.admin, {
          expiresAt: Date.now() + 60000,
        });
      });

      const result = await t.query(api.auth.getSession, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result).not.toBeNull();
      expect(result?.walletAddress).toBe(TEST_WALLETS.admin.toLowerCase());
      expect(result?.email).toBe("test@example.com");
      expect(result?.sessionId).toBeDefined();
      expect(result?.userId).toBeDefined();
    });
  });

  describe("logout", () => {
    it("deletes all sessions for wallet", async () => {
      const t = convexTest(schema);

      // Create user with multiple sessions
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        await createTestSession(ctx, userId, TEST_WALLETS.admin);
        await createTestSession(ctx, userId, TEST_WALLETS.admin);
      });

      // Verify sessions exist
      await t.run(async (ctx) => {
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_wallet", (q) => q.eq("walletAddress", TEST_WALLETS.admin.toLowerCase()))
          .collect();
        expect(sessions.length).toBe(2);
      });

      // Logout
      const result = await t.mutation(api.auth.logout, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.success).toBe(true);

      // Verify sessions deleted
      await t.run(async (ctx) => {
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_wallet", (q) => q.eq("walletAddress", TEST_WALLETS.admin.toLowerCase()))
          .collect();
        expect(sessions.length).toBe(0);
      });
    });

    it("succeeds even with no sessions", async () => {
      const t = convexTest(schema);

      const result = await t.mutation(api.auth.logout, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.success).toBe(true);
    });
  });
});
