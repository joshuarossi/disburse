import { paymentDebits, type ExecutionFee } from "./executionFee";
import { amountToBaseUnits, formatBaseUnits } from "./validation";
import type { ActivityEnvironment } from "./assets";

export type AccountReadiness = {
  safeId: string;
  safeAddress: string;
  name: string;
  chainId: number;
  network: string;
  environment: ActivityEnvironment;
  checkedAt: number;
  blockNumber: string | null;
  error: string | null;
  assets: Array<{ token: string; address: string; balance: string | null }>;
  owners: Array<{
    address: string;
    name: string | null;
    canApproveInApp: boolean;
  }>;
  threshold: number | null;
  canPrepare: boolean;
  isOwner: boolean;
  approvalPaths?: string[][];
  allApprovalsAvailable?: boolean;
  native: { symbol: string; payerAddress: string; balance: string | null };
  managed: { fee: ExecutionFee | null; error: string | null };
};

export function assessAccount(
  readiness: AccountReadiness,
  token: string,
  amount: string,
  managed: boolean,
  now = Date.now(),
) {
  return assessPayments(readiness, [{ token, amount }], managed, now);
}

/** Include every currency group and its fee against the same account balance. */
export function assessPayments(
  readiness: AccountReadiness,
  payments: Array<{ token: string; amount: string }>,
  managed: boolean,
  now = Date.now(),
) {
  const issues: string[] = [];
  const totals = new Map<string, bigint>();
  for (const payment of payments) {
    for (const debit of paymentDebits(
      payment.token,
      payment.amount,
      managed ? (readiness.managed.fee ?? undefined) : undefined,
    )) {
      totals.set(
        debit.token,
        (totals.get(debit.token) ?? 0n) +
          amountToBaseUnits(debit.amount, debit.token),
      );
    }
  }
  const debits = [...totals].map(([token, total]) => {
    const debit = { token, amount: formatBaseUnits(total, token) };
    const balance =
      readiness.assets.find((a) => a.token === debit.token)?.balance ?? null;
    const shortfall =
      balance === null
        ? null
        : amountToBaseUnits(debit.amount, debit.token) -
          (balance === "0" ? 0n : amountToBaseUnits(balance, debit.token));
    return {
      ...debit,
      available: balance,
      shortfall:
        shortfall !== null && shortfall > 0n
          ? formatBaseUnits(shortfall, debit.token)
          : null,
    };
  });
  if (readiness.error) issues.push(readiness.error);
  if (now - readiness.checkedAt > 60_000)
    issues.push(
      "The account check is out of date. Refresh before relying on these balances.",
    );
  if (!readiness.canPrepare)
    issues.push(
      "Your workspace role cannot prepare payments. Ask a team member with payment access.",
    );
  for (const debit of debits) {
    if (debit.available === null)
      issues.push(`The ${debit.token} balance could not be checked.`);
    else if (debit.shortfall)
      issues.push(
        `Add ${debit.shortfall} ${debit.token} to this account before sending.`,
      );
  }
  if (managed && !readiness.managed.fee)
    issues.push(
      readiness.managed.error ??
        "Stablecoin payment fees are unavailable for this account.",
    );
  if (
    !managed &&
    (readiness.native.balance === null || readiness.native.balance === "0")
  )
    issues.push(
      `The sending wallet needs ${readiness.environment === "test" ? "test " : ""}${readiness.native.symbol} for the network fee.`,
    );
  if (
    readiness.threshold &&
    !(readiness.allApprovalsAvailable ?? readiness.owners.filter((o) => o.canApproveInApp).length >= readiness.threshold)
  )
    issues.push(
      "Not enough account owners have payment access in this workspace to collect all approvals here.",
    );
  return {
    debits,
    issues,
    current: !readiness.error && now - readiness.checkedAt <= 60_000,
  };
}
