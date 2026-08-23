import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  createTestUser,
  createTestSession,
  signIn,
  TEST_WALLETS,
} from "./factories";

// NOTE: These tests exercise the REAL cryptographic auth path — messages are
// signed by deterministic viem accounts and verified server-side.

describe("Auth", () => {
  describe("generateNonce", () => {
    it("creates user if not exists", async () => {
      const t = convexTest(schema);

      const result = await t.mutation(api.auth.generateNonce, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.nonce).toBeDefined();
      expect(typeof result.nonce).toBe("string");
      expect(result.nonce.length).toBeGreaterThanOrEqual(32);

      // Server-authored SIWE message must embed the nonce
      expect(result.message).toContain(`Nonce: ${result.nonce}`);

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

    it("clears stale pending nonces but keeps live sessions", async () => {
      const t = convexTest(schema);

      // Create user with an existing authenticated session
      await t.run(async (ctx) => {
        const userId = await createTestUser(ctx, { walletAddress: TEST_WALLETS.admin });
        await createTestSession(ctx, userId, TEST_WALLETS.admin);
      });

      await t.mutation(api.auth.generateNonce, {
        walletAddress: TEST_WALLETS.admin,
      });

      await t.run(async (ctx) => {
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_wallet", (q) => q.eq("walletAddress", TEST_WALLETS.admin.toLowerCase()))
          .collect();

        // One pending nonce row + the pre-existing authenticated session
        expect(sessions.filter((s) => s.nonce && !s.tokenHash).length).toBe(1);
        expect(sessions.filter((s) => s.tokenHash).length).toBe(1);
      });
    });

    it("returns a high-entropy hex nonce", async () => {
      const t = convexTest(schema);

      const result = await t.mutation(api.auth.generateNonce, {
        walletAddress: TEST_WALLETS.admin,
      });

      expect(result.nonce).toMatch(/^[0-9a-f]{63,64}$/);
    });

    it("rejects malformed wallet addresses", async () => {
      const t = convexTest(schema);

      await expect(
        t.mutation(api.auth.generateNonce, { walletAddress: "0x123" })
      ).rejects.toThrow();
    });
  });

  describe("verifySignature (cryptographic)", () => {
    it("issues a session token for a correctly signed SIWE message", async () => {
      const t = convexTest(schema);

      const { sessionToken, userId } = await signIn(t, "admin");

      expect(sessionToken).toBeDefined();
      expect(sessionToken.length).toBeGreaterThanOrEqual(64);
      expect(userId).toBeDefined();
    });

    it("rejects a signature that does not match the claimed wallet", async () => {
      const t = convexTest(schema);

      const { message } = await t.mutation(api.auth.generateNonce, {
        walletAddress: TEST_WALLETS.admin,
      });

      // Sign with the WRONG account (nonMember) but claim admin's address
      const wrongAccount = (await import("./factories")).TEST_ACCOUNTS.nonMember;
      const signature = await wrongAccount.signMessage({ message });

      await expect(
        t.mutation(api.auth.verifySignature, {
          walletAddress: TEST_WALLETS.admin,
          signature,
          message,
        })
      ).rejects.toThrow(/verification failed/i);
    });

    it("consumes the nonce exactly once (replay rejected)", async () => {
      const t = convexTest(schema);

      const account = (await import("./factories")).TEST_ACCOUNTS.admin;
      const { message } = await t.mutation(api.auth.generateNonce, {
        walletAddress: account.address,
      });
      const signature = await account.signMessage({ message });

      const first = await t.mutation(api.auth.verifySignature, {
        walletAddress: account.address,
        signature,
        message,
      });
      expect(first.token).toBeDefined();

      // Replay of the same signed message must fail
      await expect(
        t.mutation(api.auth.verifySignature, {
          walletAddress: account.address,
          signature,
          message,
        })
      ).rejects.toThrow(/nonce/i);
    });

    it("rejects a message whose address line differs from the claimed wallet", async () => {
      const t = convexTest(schema);

      const account = (await import("./factories")).TEST_ACCOUNTS.admin;
      const { message } = await t.mutation(api.auth.generateNonce, {
        walletAddress: account.address,
      });
      const forgedMessage = message.replace(account.address, TEST_WALLETS.nonMember);
      const signature = await account.signMessage({ message: forgedMessage });

      await expect(
        t.mutation(api.auth.verifySignature, {
          walletAddress: TEST_WALLETS.nonMember,
          signature,
          message: forgedMessage,
        })
      ).rejects.toThrow(/does not match|malformed|invalid/i);
    });

    it("rejects structurally malformed messages", async () => {
      const t = convexTest(schema);

      await t.mutation(api.auth.generateNonce, { walletAddress: TEST_WALLETS.admin });

      await expect(
        t.mutation(api.auth.verifySignature, {
          walletAddress: TEST_WALLETS.admin,
          signature:
            "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001b",
          message: "Sign in",
        })
      ).rejects.toThrow(/malformed/i);
    });
  });

  describe("validateSession", () => {
    it("returns null for unknown tokens", async () => {
      const t = convexTest(schema);

      const result = await t.query(api.auth.validateSession, {
        token: "0".repeat(64),
      });

      expect(result).toBeNull();
    });

    it("returns null for short garbage input", async () => {
      const t = convexTest(schema);

      const result = await t.query(api.auth.validateSession, { token: "abc" });
      expect(result).toBeNull();
    });

    it("returns session data for a token obtained via real sign-in", async () => {
      const t = convexTest(schema);

      await t.run(async (ctx) => {
        await createTestUser(ctx, {
          walletAddress: TEST_WALLETS.admin,
          email: "test@example.com",
        });
      });

      const { sessionToken } = await signIn(t, "admin");

      const result = await t.query(api.auth.validateSession, {
        token: sessionToken,
      });

      expect(result).not.toBeNull();
      expect(result?.walletAddress).toBe(TEST_WALLETS.admin.toLowerCase());
      expect(result?.email).toBe("test@example.com");
      expect(result?.sessionId).toBeDefined();
      expect(result?.userId).toBeDefined();
    });

    it("returns null after logout invalidates the token", async () => {
      const t = convexTest(schema);

      const { sessionToken } = await signIn(t, "admin");

      await t.mutation(api.auth.logout, { token: sessionToken });

      const result = await t.query(api.auth.validateSession, {
        token: sessionToken,
      });
      expect(result).toBeNull();
    });
  });

  describe("logout", () => {
    it("deletes only the session matching the provided token", async () => {
      const t = convexTest(schema);

      const adminSession = await signIn(t, "admin");
      const approverSession = await signIn(t, "approver");

      await t.mutation(api.auth.logout, { token: adminSession.sessionToken });

      // Admin's token is dead...
      expect(
        await t.query(api.auth.validateSession, { token: adminSession.sessionToken })
      ).toBeNull();

      // ...but approver's unrelated session survives
      expect(
        await t.query(api.auth.validateSession, { token: approverSession.sessionToken })
      ).not.toBeNull();
    });

    it("succeeds even with no sessions", async () => {
      const t = convexTest(schema);

      const result = await t.mutation(api.auth.logout, {
        token: "f".repeat(64),
      });

      expect(result.success).toBe(true);
    });
  });
});
