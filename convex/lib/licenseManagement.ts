import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireUser } from "./rbac";
import { DAY, LICENSE_TIERS, type LicenseTier } from "../../shared/billing";

export function isLicenseOperator(wallet: string) {
  return (process.env.DISBURSE_LICENSE_OPERATORS ?? "")
    .split(/[\s,]+/)
    .filter((value) => /^0x[\da-f]{40}$/i.test(value))
    .some((value) => value.toLowerCase() === wallet.toLowerCase());
}
export async function requireLicenseOperator(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
) {
  const { user } = await requireUser(ctx, sessionToken);
  if (!isLicenseOperator(user.walletAddress))
    throw new Error("License operator access is required.");
  return user;
}
export async function resolveLicenseTier(
  ctx: QueryCtx,
  key: string,
): Promise<LicenseTier> {
  const standard = Object.prototype.hasOwnProperty.call(LICENSE_TIERS, key)
    ? LICENSE_TIERS[key]
    : undefined;
  if (standard) return standard;
  const id = ctx.db.normalizeId("licenseTiers", key);
  const tier = id ? await ctx.db.get(id) : null;
  if (!tier) throw new Error("Choose an available license tier.");
  return {
    key: tier._id,
    name: tier.name,
    maxUsers: tier.maxUsers,
    maxBeneficiaries: tier.maxBeneficiaries,
  };
}
export async function initialBilling(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  now: number,
) {
  const program = await ctx.db
    .query("licensePrograms")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();
  return {
    orgId,
    plan: "trial" as const,
    status: "trial" as const,
    trialEndsAt: now + (program?.trialDays ?? 30) * DAY,
    trialTier: program?.trialTier ?? LICENSE_TIERS.trial,
    fallbackTier: program?.fallbackTier ?? LICENSE_TIERS.free,
    createdAt: now,
    updatedAt: now,
  };
}
