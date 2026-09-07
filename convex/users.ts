import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireUser } from "./lib/rbac";

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
