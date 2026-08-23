import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/rbac";

// Get user by wallet address (own profile only)
export const getByWallet = query({
  args: {
    walletAddress: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);

    const requested = args.walletAddress.toLowerCase();
    if (user.walletAddress !== requested) {
      throw new Error("Unauthorized: can only look up your own profile");
    }

    return user;
  },
});

// Update user email
export const updateEmail = mutation({
  args: {
    sessionToken: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    await ctx.db.patch(user._id, { email: args.email });
    return { success: true };
  },
});

// Update user preferred language
export const updatePreferredLanguage = mutation({
  args: {
    sessionToken: v.string(),
    preferredLanguage: v.union(
      v.literal("en"),
      v.literal("es"),
      v.literal("pt-BR")
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    await ctx.db.patch(user._id, { preferredLanguage: args.preferredLanguage });
    return { success: true };
  },
});

// Update user preferred theme
export const updatePreferredTheme = mutation({
  args: {
    sessionToken: v.string(),
    preferredTheme: v.union(
      v.literal("dark"),
      v.literal("light")
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    await ctx.db.patch(user._id, { preferredTheme: args.preferredTheme });
    return { success: true };
  },
});
