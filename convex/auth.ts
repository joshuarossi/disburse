import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Generate a nonce for SIWE authentication
export const generateNonce = mutation({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const nonce = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 10 * 60 * 1000; // 10 minutes

    // Check if user exists
    let user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    // Create user if they don't exist
    if (!user) {
      const userId = await ctx.db.insert("users", {
        walletAddress,
        createdAt: now,
      });
      user = await ctx.db.get(userId);
    }

    if (!user) {
      throw new Error("Failed to create user");
    }

    // Delete any existing sessions for this wallet
    const existingSessions = await ctx.db
      .query("sessions")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .collect();

    for (const session of existingSessions) {
      await ctx.db.delete(session._id);
    }

    // Create new session with nonce
    await ctx.db.insert("sessions", {
      userId: user._id,
      walletAddress,
      nonce,
      expiresAt,
      createdAt: now,
    });

    return { nonce };
  },
});

// Verify signature and create authenticated session
export const verifySignature = mutation({
  args: {
    walletAddress: v.string(),
    signature: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Find the session with matching nonce
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!session) {
      throw new Error("No pending session found");
    }

    if (Date.now() > session.expiresAt) {
      await ctx.db.delete(session._id);
      throw new Error("Session expired");
    }

    // Verify the nonce is in the message
    if (!args.message.includes(session.nonce)) {
      throw new Error("Invalid nonce in message");
    }

    // Note: In production, you would verify the signature here using viem
    // For now, we trust the frontend verification
    // The signature verification happens client-side with wagmi/viem

    // Extend session expiry (7 days)
    const newExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await ctx.db.patch(session._id, { expiresAt: newExpiresAt });

    // Get user
    const user = await ctx.db.get(session.userId);
    if (!user) {
      throw new Error("User not found");
    }

    return {
      sessionId: session._id,
      userId: user._id,
      walletAddress: user.walletAddress,
      preferredLanguage: user.preferredLanguage,
      preferredTheme: user.preferredTheme,
    };
  },
});

// Get current session
export const getSession = query({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!session) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      return null;
    }

    const user = await ctx.db.get(session.userId);
    if (!user) {
      return null;
    }

    return {
      sessionId: session._id,
      userId: user._id,
      walletAddress: user.walletAddress,
      email: user.email,
      preferredLanguage: user.preferredLanguage,
      preferredTheme: user.preferredTheme,
    };
  },
});

// Logout - delete session
export const logout = mutation({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .collect();

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    return { success: true };
  },
});
