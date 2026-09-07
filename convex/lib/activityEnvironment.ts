import { v } from "convex/values";
export const environmentValidator = v.union(
  v.literal("production"),
  v.literal("test"),
  v.literal("unclassified"),
);
