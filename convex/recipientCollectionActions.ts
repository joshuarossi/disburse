"use node";
import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const create = action({
  args: {
    beneficiaryId: v.id("beneficiaries"),
    sessionToken: v.string(),
    environment: v.union(v.literal("production"), v.literal("test")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    token: string;
    expiresAt: number;
    requestId: Id<"recipientCollections">;
  }> => {
    const token = randomBytes(32).toString("hex");
    const registered: {
      expiresAt: number;
      requestId: Id<"recipientCollections">;
    } = await ctx.runMutation(internal.recipientCollections.register, {
      ...args,
      token,
    });
    // The bearer token is returned once. Only its digest is persisted.
    return { token, ...registered };
  },
});
