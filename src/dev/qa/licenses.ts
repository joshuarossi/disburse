/* eslint-disable @typescript-eslint/no-explicit-any -- browser-only QA data */
import { billingAccess, DAY, LICENSE_TIERS } from "../../../shared/billing";
function read() {
  const raw = sessionStorage.getItem("qa:licenses");
  return raw
    ? JSON.parse(raw)
    : {
        tiers: Object.values(LICENSE_TIERS),
        program: {
          trialDays: 30,
          trialTier: LICENSE_TIERS.trial,
          fallbackTier: LICENSE_TIERS.free,
          revision: 0,
        },
        billing: {
          _id: "qa-billing",
          orgId: "demo",
          plan: "trial",
          status: "trial",
          trialEndsAt: Date.now() + 7 * DAY,
          licenseRevision: 0,
          createdAt: Date.now() - 23 * DAY,
          updatedAt: Date.now(),
        },
        changes: [],
      };
}
export function licenseQueryFixture(
  name: string,
  args: any,
  scenario: string | null,
) {
  if (name === "licenseAdmin:access")
    return { allowed: scenario === "license-operator" };
  const state = read();
  if (name === "licenseAdmin:catalog")
    return { tiers: state.tiers, program: state.program };
  if (name === "licenseAdmin:companies")
    return {
      page:
        !args.search || "northstar studio".includes(args.search.toLowerCase())
          ? [
              {
                id: "demo",
                name: "Northstar Studio",
                createdAt: Date.now() - 90 * DAY,
              },
            ]
          : [],
      isDone: true,
      continueCursor: "",
    };
  if (name === "licenseAdmin:company")
    return {
      org: { id: "demo", name: "Northstar Studio" },
      billing: state.billing,
      access: billingAccess(state.billing),
      changes: state.changes,
    };
}
export function licenseBillingFixture(scenario: string | null) {
  const state = read();
  if (scenario === "license-operator") return state.billing;
  if (scenario === "license-free")
    return { ...state.billing, trialEndsAt: Date.now() - DAY };
  if (scenario === "license-trial")
    return {
      ...state.billing,
      trialTier: LICENSE_TIERS.pro,
      fallbackTier: LICENSE_TIERS.free,
    };
  if (scenario === "license-complimentary")
    return {
      ...state.billing,
      licenseGrant: {
        kind: "complimentary",
        tier: LICENSE_TIERS.pro,
        grantedAt: Date.now(),
      },
    };
}
export async function licenseMutationFixture(name: string, args: any) {
  const state = read();
  sessionStorage.setItem("qa:lastMutation", JSON.stringify({ name, args }));
  let result: string | number;
  if (name === "licenseAdmin:createTier") {
    result = "custom-free-tier";
    state.tiers.push({
      key: result,
      name: args.name,
      maxUsers: args.maxUsers,
      maxBeneficiaries: args.maxBeneficiaries,
    });
  } else if (name === "licenseAdmin:changeCompany") {
    result = args.expectedRevision + 1;
    state.billing = {
      ...state.billing,
      licenseRevision: result,
      licenseGrant:
        args.mode === "standard"
          ? undefined
          : {
              kind: args.mode,
              tier: state.tiers.find((t: any) => t.key === args.tierKey),
              expiresAt: args.expiresAt,
              grantedAt: Date.now(),
            },
      fallbackTier: state.tiers.find(
        (t: any) => t.key === args.fallbackTierKey,
      ),
      ...(args.mode === "trial" ? { trialEndsAt: args.expiresAt } : {}),
    };
    state.changes.unshift({
      _id: `change-${result}`,
      reason: args.reason,
      createdAt: Date.now(),
    });
  } else if (name === "licenseAdmin:setProgram") {
    result = args.expectedRevision + 1;
    state.program = {
      trialDays: args.trialDays,
      trialTier: state.tiers.find((t: any) => t.key === args.trialTierKey),
      fallbackTier: state.tiers.find(
        (t: any) => t.key === args.fallbackTierKey,
      ),
      revision: result,
    };
  } else throw new Error("Unknown QA license mutation");
  sessionStorage.setItem("qa:licenses", JSON.stringify(state));
  return result;
}
