import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Get user by wallet address
export const getByWallet = query({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    return await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();
  },
});

// Update user email
export const updateEmail = mutation({
  args: {
    walletAddress: v.string(),
    email: v.string(),
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

    await ctx.db.patch(user._id, { email: args.email });

    return { success: true };
  },
});

// Update user preferred language
export const updatePreferredLanguage = mutation({
  args: {
    walletAddress: v.string(),
    preferredLanguage: v.union(
      v.literal("en"),
      v.literal("es"),
      v.literal("pt-BR")
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

    await ctx.db.patch(user._id, { preferredLanguage: args.preferredLanguage });

    return { success: true };
  },
});
