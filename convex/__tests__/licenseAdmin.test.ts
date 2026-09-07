import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  signIn,
  TEST_WALLETS,
} from "./factories";
import {
  billingAccess,
  DAY,
  LICENSE_TIERS,
  renewalEnd,
} from "../../shared/billing";
import { getOrgLimits } from "../billing";
import { isLicenseOperator } from "../lib/licenseManagement";

beforeEach(() =>
  vi.stubEnv("DISBURSE_LICENSE_OPERATORS", TEST_WALLETS.nonMember),
);
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
  );
  const operator = await signIn(t, "nonMember"),
    admin = await signIn(t, "admin");
  const change = {
    orgId: ids.orgId,
    sessionToken: operator.sessionToken,
    requestId: crypto.randomUUID(),
    reason: "Pilot customer complimentary access",
    expectedRevision: 0,
    mode: "complimentary" as const,
    tierKey: "pro",
    fallbackTierKey: "free",
  };
  return { t, ids, operator, admin, change };
}
describe("Operator licensing", () => {
  it("requires an explicitly authorized signed-in operator for every private query and mutation", async () => {
    const s = await setup(),
      args = { sessionToken: s.admin.sessionToken };
    expect(await s.t.query(api.licenseAdmin.access, args)).toEqual({
      allowed: false,
    });
    await expect(s.t.query(api.licenseAdmin.catalog, args)).rejects.toThrow(
      "operator access",
    );
    await expect(
      s.t.query(api.licenseAdmin.companies, {
        ...args,
        paginationOpts: { cursor: null, numItems: 20 },
      }),
    ).rejects.toThrow("operator access");
    await expect(
      s.t.query(api.licenseAdmin.company, { ...args, orgId: s.ids.orgId }),
    ).rejects.toThrow("operator access");
    await expect(
      s.t.mutation(api.licenseAdmin.changeCompany, { ...s.change, ...args }),
    ).rejects.toThrow("operator access");
    await expect(
      s.t.mutation(api.licenseAdmin.createTier, {
        ...args,
        requestId: crypto.randomUUID(),
        reason: "Attempt self upgrade",
        name: "Unauthorized",
        maxUsers: null,
        maxBeneficiaries: null,
      }),
    ).rejects.toThrow("operator access");
    await expect(
      s.t.mutation(api.licenseAdmin.setProgram, {
        ...args,
        requestId: crypto.randomUUID(),
        reason: "Attempt global upgrade",
        expectedRevision: 0,
        trialDays: 30,
        trialTierKey: "pro",
        fallbackTierKey: "free",
      }),
    ).rejects.toThrow("operator access");
    await s.t.mutation(api.auth.logout, { token: s.operator.sessionToken });
    await expect(
      s.t.mutation(api.licenseAdmin.changeCompany, s.change),
    ).rejects.toThrow();
    expect(
      await s.t.run((ctx) => ctx.db.query("licenseEvents").collect()),
    ).toHaveLength(0);
  });
  it("has no default operator and matches complete wallet addresses only", () => {
    vi.stubEnv("DISBURSE_LICENSE_OPERATORS", "");
    expect(isLicenseOperator(TEST_WALLETS.admin)).toBe(false);
    vi.stubEnv(
      "DISBURSE_LICENSE_OPERATORS",
      `bad-value, ${TEST_WALLETS.admin.toUpperCase()}\n${TEST_WALLETS.nonMember}`,
    );
    expect(isLicenseOperator(TEST_WALLETS.admin)).toBe(true);
    expect(isLicenseOperator(TEST_WALLETS.viewer)).toBe(false);
    expect(isLicenseOperator(TEST_WALLETS.admin.slice(0, 12))).toBe(false);
  });
  it("grants lifetime Pro without fabricating a payment and preserves the private reason and public audit", async () => {
    const s = await setup();
    expect(await s.t.mutation(api.licenseAdmin.changeCompany, s.change)).toBe(
      1,
    );
    const result = await s.t.query(api.billing.get, {
      orgId: s.ids.orgId,
      sessionToken: s.admin.sessionToken,
    });
    expect(result).toMatchObject({
      plan: "trial",
      source: "complimentary",
      effectiveTier: { key: "pro" },
      limits: { price: 0 },
      expiresAt: null,
      payments: [],
    });
    expect(result?.limits.maxUsers).toBe(Infinity);
    const company = await s.t.query(api.licenseAdmin.company, {
      orgId: s.ids.orgId,
      sessionToken: s.operator.sessionToken,
    });
    expect(company.changes[0].reason).toBe(s.change.reason);
    const audit = await s.t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(
      audit.filter((e) => e.action === "billing.license_changed"),
    ).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(s.change.reason);
    expect(
      await s.t.run((ctx) => ctx.db.query("billingCheckouts").collect()),
    ).toHaveLength(0);
  });
  it("replays identical requests once and rejects stale revisions or a reused request with different terms", async () => {
    const s = await setup();
    await s.t.mutation(api.licenseAdmin.changeCompany, s.change);
    expect(await s.t.mutation(api.licenseAdmin.changeCompany, s.change)).toBe(
      1,
    );
    await expect(
      s.t.mutation(api.licenseAdmin.changeCompany, {
        ...s.change,
        tierKey: "team",
      }),
    ).rejects.toThrow("another change");
    await expect(
      s.t.mutation(api.licenseAdmin.changeCompany, {
        ...s.change,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("access changed");
    expect(
      await s.t.run((ctx) => ctx.db.query("licenseEvents").collect()),
    ).toHaveLength(1);
  });
  it("creates and reuses a free tier, enforces its directory limits, and rejects malformed tiers", async () => {
    const s = await setup(),
      tierArgs = {
        sessionToken: s.operator.sessionToken,
        requestId: crypto.randomUUID(),
        reason: "Community pilot tier",
        name: "Community",
        maxUsers: 2,
        maxBeneficiaries: 1,
      };
    const key = await s.t.mutation(api.licenseAdmin.createTier, tierArgs);
    expect(await s.t.mutation(api.licenseAdmin.createTier, tierArgs)).toBe(key);
    await expect(
      s.t.mutation(api.licenseAdmin.createTier, {
        ...tierArgs,
        requestId: crypto.randomUUID(),
        name: " community ",
      }),
    ).rejects.toThrow("already exists");
    await expect(
      s.t.mutation(api.licenseAdmin.createTier, {
        ...tierArgs,
        requestId: crypto.randomUUID(),
        name: "Bad limit",
        maxUsers: 0.5,
      }),
    ).rejects.toThrow("whole numbers");
    for (const tierKey of ["__proto__", "toString", "missing"])
      await expect(
        s.t.mutation(api.licenseAdmin.changeCompany, { ...s.change, tierKey }),
      ).rejects.toThrow("available license tier");
    await s.t.mutation(api.licenseAdmin.changeCompany, {
      ...s.change,
      tierKey: key,
      fallbackTierKey: key,
    });
    expect(await s.t.run((ctx) => getOrgLimits(ctx, s.ids.orgId))).toEqual({
      maxUsers: 2,
      maxBeneficiaries: 1,
      price: 0,
    });
    await s.t.run((ctx) => createTestBeneficiary(ctx, s.ids.orgId));
    await expect(
      s.t.mutation(api.beneficiaries.create, {
        orgId: s.ids.orgId,
        sessionToken: s.admin.sessionToken,
        type: "individual",
        name: "Extra recipient",
        beneficiaryAddress: TEST_WALLETS.viewer,
      }),
    ).rejects.toThrow(/maximum|limit/i);
  });
  it("changes a trial end date and falls back to Free at the exact boundary without removing records", async () => {
    const s = await setup(),
      end = Date.now() + 45 * DAY;
    await s.t.run((ctx) => createTestBeneficiary(ctx, s.ids.orgId));
    await s.t.mutation(api.licenseAdmin.changeCompany, {
      ...s.change,
      mode: "trial",
      expiresAt: end,
    });
    const b = await s.t.run((ctx) => ctx.db.get(s.ids.billingId));
    expect(b?.trialEndsAt).toBe(end);
    expect(billingAccess(b, end - 1)).toMatchObject({
      source: "trial",
      effectiveTier: { key: "pro" },
    });
    expect(billingAccess(b, end)).toMatchObject({
      source: "free",
      isActive: true,
      limits: { maxUsers: 1, maxBeneficiaries: 25, price: 0 },
      expiresAt: null,
    });
    expect(
      billingAccess({ ...b!, ...billingAccess(b, end - 1) }, end).source,
    ).toBe("free");
    expect(
      await s.t.run((ctx) => ctx.db.query("beneficiaries").collect()),
    ).toHaveLength(1);
    await expect(
      s.t.mutation(api.licenseAdmin.changeCompany, {
        ...s.change,
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        mode: "trial",
      }),
    ).rejects.toThrow("end date");
  });
  it("does not treat an incomplete trial grant as perpetual Pro or free time as paid credit", () => {
    const billing = {
      plan: "trial" as const,
      status: "trial",
      trialEndsAt: 0,
      licenseGrant: {
        kind: "trial" as const,
        tier: LICENSE_TIERS.pro,
        grantedAt: 0,
      },
    };
    expect(billingAccess(billing, 1)).toMatchObject({
      source: "free",
      effectiveTier: { key: "free" },
    });
    expect(
      renewalEnd(
        {
          ...billing,
          licenseGrant: { ...billing.licenseGrant, kind: "complimentary" },
        },
        "pro",
        DAY,
      ),
    ).toBe(31 * DAY);
  });
  it("applies new signup terms only to future companies, including a no-trial free signup", async () => {
    const s = await setup(),
      args = {
        sessionToken: s.operator.sessionToken,
        requestId: crypto.randomUUID(),
        reason: "Offer Pro trial with permanent free core",
        expectedRevision: 0,
        trialDays: 30,
        trialTierKey: "pro",
        fallbackTierKey: "free",
      };
    const old = await s.t.run((ctx) => ctx.db.get(s.ids.billingId));
    await s.t.mutation(api.licenseAdmin.setProgram, args);
    expect(await s.t.mutation(api.licenseAdmin.setProgram, args)).toBe(1);
    const { orgId } = await s.t.mutation(api.orgs.create, {
      sessionToken: s.admin.sessionToken,
      name: "New company",
    });
    const current = await s.t.query(api.billing.get, {
      orgId,
      sessionToken: s.admin.sessionToken,
    });
    expect(current).toMatchObject({
      source: "trial",
      effectiveTier: { key: "pro" },
      fallbackTier: { key: "free" },
      daysRemaining: 30,
    });
    expect(await s.t.run((ctx) => ctx.db.get(s.ids.billingId))).toEqual(old);
    await s.t.mutation(api.licenseAdmin.setProgram, {
      ...args,
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      trialDays: 0,
    });
    const free = await s.t.mutation(api.orgs.create, {
      sessionToken: s.admin.sessionToken,
      name: "Free signup",
    });
    expect(
      await s.t.query(api.billing.get, {
        ...free,
        sessionToken: s.admin.sessionToken,
      }),
    ).toMatchObject({
      source: "free",
      expiresAt: null,
      effectiveTier: { key: "free" },
    });
    await expect(
      s.t.mutation(api.licenseAdmin.setProgram, {
        ...args,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("program changed");
  });
  it("blocks operator changes during checkout and consumes a paid receipt only once after a grant", async () => {
    const s = await setup();
    await expect(s.t.mutation(api.billingCheckoutData.create, {
      orgId: s.ids.orgId, sessionToken: s.admin.sessionToken, requestId: crypto.randomUUID(), plan: "starter", chainId: 1,
      treasury: TEST_WALLETS.nonMember, tokenAddress: TEST_WALLETS.viewer, amountRaw: "25000000",
    })).rejects.toThrow("included in Free access");
    await s.t.mutation(api.licenseAdmin.changeCompany, s.change);
    const checkoutId = await s.t.run((ctx) =>
      ctx.db.insert("billingCheckouts", {
        orgId: s.ids.orgId,
        createdBy: s.admin.userId,
        requestId: crypto.randomUUID(),
        plan: "starter",
        chainId: 1,
        payer: s.admin.walletAddress.toLowerCase(),
        treasury: TEST_WALLETS.nonMember,
        tokenAddress: TEST_WALLETS.viewer,
        amountRaw: "25000000",
        status: "prepared",
        active: true,
        checks: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      s.t.mutation(api.licenseAdmin.changeCompany, {
        ...s.change,
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
      }),
    ).rejects.toThrow("saved checkout");
    await s.t.run((ctx) =>
      ctx.db.patch(checkoutId, { active: false, status: "cancelled" }),
    );
    const hash = `0x${"bc".repeat(32)}`;
    await expect(
      s.t.mutation(api.billing.subscribe, {
        orgId: s.ids.orgId,
        sessionToken: s.admin.sessionToken,
        plan: "starter",
        txHash: hash,
      }),
    ).rejects.toThrow("not verified");
    expect(
      (await s.t.run((ctx) => ctx.db.get(s.ids.billingId)))?.licenseGrant?.kind,
    ).toBe("complimentary");
    await s.t.run((ctx) =>
      ctx.db.insert("billingPayments", {
        orgId: s.ids.orgId,
        txHash: hash,
        chainId: 1,
        plan: "starter",
        tokenAddress: TEST_WALLETS.viewer,
        amountRaw: "25000000",
        paidThroughAt: 0,
        verifiedAt: Date.now(),
      }),
    );
    const paidArgs = {
      orgId: s.ids.orgId,
      sessionToken: s.admin.sessionToken,
      plan: "starter" as const,
      txHash: hash,
    };
    await s.t.mutation(api.billing.subscribe, paidArgs);
    const billing = await s.t.run((ctx) => ctx.db.get(s.ids.billingId));
    expect(billing?.licenseGrant).toBeUndefined();
    expect(billing?.fallbackTier?.key).toBe("free");
    expect(billing?.licenseRevision).toBe(2);
    await s.t.mutation(api.billing.subscribe, paidArgs);
    expect(await s.t.run((ctx) => ctx.db.get(s.ids.billingId))).toEqual(
      billing,
    );
    expect(billingAccess(billing, billing!.paidThroughAt!).source).toBe("free");
  });
});
