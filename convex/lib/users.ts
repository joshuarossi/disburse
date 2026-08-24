import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

/**
 * M-03: race-safe user lookup/creation.
 *
 * Convex has no unique indexes, so two concurrent transactions can both see
 * "no user" and insert duplicates for the same wallet. This helper heals that
 * deterministically:
 *   1. Return the existing user when one is visible.
 *   2. Otherwise insert, then re-query. If duplicates exist, the canonical
 *      row is the earliest-created (tie-break: lowest _id). Rows created
 *      after the canonical one are deleted.
 *
 * Residual risk: a concurrent transaction may still write a reference (e.g.
 * session.userId) to a duplicate that loses the race. Such references fail
 * closed — requireUser throws and the client simply signs in again. Identity
 * is always resolved by walletAddress lookup, never by trusting stale ids.
 */
export async function getOrCreateUser(
  ctx: MutationCtx,
  walletAddress: string
): Promise<Doc<"users">> {
  const findUsers = () =>
    ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .collect();

  const existing = await findUsers();
  if (existing.length > 0) {
    // Heal historical duplicates opportunistically
    if (existing.length > 1) {
      const canonical = pickCanonical(existing);
      for (const dup of existing) {
        if (dup._id !== canonical._id && isNewer(dup, canonical)) {
          await ctx.db.delete(dup._id);
        }
      }
    }
    const canonical = pickCanonical(existing);
    const doc = await ctx.db.get(canonical._id);
    if (!doc) throw new Error("Failed to load user");
    return doc;
  }

  const newId = await ctx.db.insert("users", {
    walletAddress,
    createdAt: Date.now(),
  });

  const all = await findUsers();
  if (all.length > 1) {
    const canonical = pickCanonical(all);
    if (canonical._id !== newId) {
      // We lost the race; remove our duplicate and use the winner
      await ctx.db.delete(newId);
      const winner = await ctx.db.get(canonical._id);
      if (!winner) throw new Error("Failed to load user");
      return winner;
    }
  }

  const created = await ctx.db.get(newId);
  if (!created) {
    throw new Error("Failed to create user");
  }
  return created;
}

function pickCanonical(users: Array<Pick<Doc<"users">, "_id" | "createdAt">>): Pick<Doc<"users">, "_id" | "createdAt"> {
  return users.reduce((best, u) =>
    u.createdAt < best.createdAt ||
    (u.createdAt === best.createdAt && u._id < best._id)
      ? u
      : best
  );
}

function isNewer(
  candidate: Pick<Doc<"users">, "_id" | "createdAt">,
  canonical: Pick<Doc<"users">, "_id" | "createdAt">
): boolean {
  return (
    candidate.createdAt > canonical.createdAt ||
    (candidate.createdAt === canonical.createdAt && candidate._id > canonical._id)
  );
}

// Referenced by auth flow docs; keeps Id import meaningful for future use.
export type UserId = Id<"users">;
