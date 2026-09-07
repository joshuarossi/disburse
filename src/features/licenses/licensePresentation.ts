import type { LicenseTier } from "../../../shared/billing";

export function tierLimits(tier: LicenseTier) {
  return `${tier.maxUsers === null ? "Unlimited" : tier.maxUsers} member seats · ${tier.maxBeneficiaries === null ? "unlimited" : tier.maxBeneficiaries} saved recipients`;
}
