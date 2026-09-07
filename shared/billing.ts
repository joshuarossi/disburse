export const DAY = 86_400_000;
export const AVAILABLE_PAID_PLANS = ["team", "pro"] as const;
export const PLAN_LIMITS = {
  trial: { maxUsers: 5, maxBeneficiaries: 100, price: 0 },
  starter: { maxUsers: 1, maxBeneficiaries: 25, price: 25 },
  team: { maxUsers: 5, maxBeneficiaries: 100, price: 50 },
  pro: { maxUsers: Infinity, maxBeneficiaries: Infinity, price: 99 },
} as const;
export type LicenseTier = {
  key: string;
  name: string;
  maxUsers: number | null;
  maxBeneficiaries: number | null;
};
export const LICENSE_TIERS: Record<string, LicenseTier> = {
  free: { key: "free", name: "Free", maxUsers: 1, maxBeneficiaries: 25 },
  ...Object.fromEntries(
    Object.entries(PLAN_LIMITS).map(([key, value]) => [
      key,
      {
        key,
        name: key[0].toUpperCase() + key.slice(1),
        maxUsers: Number.isFinite(value.maxUsers) ? value.maxUsers : null,
        maxBeneficiaries: Number.isFinite(value.maxBeneficiaries)
          ? value.maxBeneficiaries
          : null,
      },
    ]),
  ),
};
export type LicenseGrant = {
  kind: "trial" | "complimentary";
  tier: LicenseTier;
  expiresAt?: number;
  grantedAt: number;
};
type Billing = {
  plan: keyof typeof PLAN_LIMITS;
  status: string;
  trialEndsAt?: number;
  paidThroughAt?: number;
  billingStatus?: string;
  trialTier?: LicenseTier;
  fallbackTier?: LicenseTier;
  licenseGrant?: LicenseGrant;
};

export function billingAccess(
  billing: Billing | null | undefined,
  now = Date.now(),
) {
  const storedStatus = billing?.billingStatus ?? billing?.status;
  const paidExpiry =
    storedStatus === "trial"
      ? billing?.trialEndsAt
      : storedStatus === "active"
        ? billing?.paidThroughAt
        : undefined;
  const grant = billing?.licenseGrant;
  const grantActive =
    !!grant &&
    (grant.expiresAt === undefined
      ? grant.kind === "complimentary"
      : Number.isFinite(grant.expiresAt) && now < grant.expiresAt);
  const termActive =
    paidExpiry !== undefined && Number.isFinite(paidExpiry) && now < paidExpiry;
  const source = grantActive
    ? grant.kind
    : termActive
      ? storedStatus === "trial"
        ? "trial"
        : "paid"
      : "free";
  const effectiveTier = grantActive
    ? grant.tier
    : termActive
      ? storedStatus === "trial"
        ? (billing?.trialTier ?? LICENSE_TIERS.trial)
        : LICENSE_TIERS[billing!.plan]
      : (billing?.fallbackTier ?? LICENSE_TIERS.free);
  const isActive = true;
  const expiresAt = grantActive
    ? grant.expiresAt
    : termActive
      ? paidExpiry
      : undefined;
  return {
    isActive,
    billingStatus: storedStatus,
    source,
    effectiveTier,
    limits: {
      maxUsers: effectiveTier.maxUsers ?? Infinity,
      maxBeneficiaries: effectiveTier.maxBeneficiaries ?? Infinity,
      price: source === "paid" ? PLAN_LIMITS[billing!.plan].price : 0,
    },
    expiresAt: expiresAt ?? null,
    status: source === "paid" ? ("active" as const) : source,
    daysRemaining:
      isActive && expiresAt !== undefined
        ? Math.ceil((expiresAt - now) / DAY)
        : 0,
  };
}

// Free access never creates paid credit or prevents a later paid downgrade.
export function hasPaidTerm(
  billing: Billing | null | undefined,
  now = Date.now(),
) {
  return (
    !!billing &&
    (billing.billingStatus ?? billing.status) === "active" &&
    billing.plan !== "trial" &&
    Number.isFinite(billing.paidThroughAt) &&
    now < billing.paidThroughAt!
  );
}

// Same-plan renewal preserves unused days. A plan change converts remaining paid
// time into credit at the old rate; trial time has no monetary value.
export function renewalEnd(
  billing: Billing,
  plan: Exclude<Billing["plan"], "trial">,
  now: number,
) {
  const remaining =
    billing.status === "active"
      ? Math.max(0, (billing.paidThroughAt ?? 0) - now)
      : 0;
  const credit = Math.floor(
    (remaining * PLAN_LIMITS[billing.plan].price) / PLAN_LIMITS[plan].price,
  );
  return now + 30 * DAY + credit;
}
