import type { PlanKey } from "@/lib/billingPlans";

export type PendingBilling = {
  plan: PlanKey;
  checkoutId?: string;
  hash?: string;
  attemptId?: string;
  startedAt?: number;
  payer?: string;
  chainId?: number;
};
const key = (orgId: string) => `disburse:pending-billing:${orgId}`;

// Local recovery hints never establish payment or activate a subscription.
export function readPendingBilling(orgId?: string): PendingBilling | null {
  if (!orgId) return null;
  try {
    const raw = localStorage.getItem(key(orgId));
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (
      value &&
      ["starter", "team", "pro"].includes(value.plan) &&
      ((typeof value.hash === "string" &&
        /^0x[0-9a-f]{64}$/i.test(value.hash)) ||
        (value.hash === undefined &&
          typeof value.attemptId === "string" &&
          Number.isFinite(value.startedAt) &&
          value.startedAt > 0))
    )
      return value;
  } catch {
    /* Unreadable recovery state must not permit another send. */
  }
  throw new Error(
    "The earlier billing request could not be read. Check your wallet payment history before starting another checkout.",
  );
}

export function writePendingBilling(
  orgId: string | undefined,
  value: PendingBilling | null,
) {
  if (!orgId) throw new Error("Open a workspace before starting checkout.");
  try {
    if (value) localStorage.setItem(key(orgId), JSON.stringify(value));
    else localStorage.removeItem(key(orgId));
  } catch {
    throw new Error(
      "Could not save billing recovery in this browser. Keep the payment receipt and verify it before trying again.",
    );
  }
}

export async function withBillingLock<T>(
  orgId: string,
  action: () => Promise<T>,
) {
  if (!navigator.locks)
    throw new Error(
      "This browser cannot coordinate checkout safely. Use a current browser, or verify an existing payment receipt.",
    );
  return navigator.locks.request(
    `disburse:billing-checkout:${orgId}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          "Subscription checkout is already open in another tab. Finish or check that payment first.",
        );
      return action();
    },
  );
}
