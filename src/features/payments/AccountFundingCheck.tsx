import { RefreshCw } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAccountReadiness } from "@/features/treasury/useAccountReadiness";
import { assessPayments } from "../../../shared/accountReadiness";
import { formatAssetAmount } from "@/lib/formatMoney";
import { RELAY_FEATURE_ENABLED } from "@/lib/relayConfig";
import { getChainName } from "@/lib/chains";
import type { ReactNode } from "react";

export function AccountFundingCheck({
  safeId,
  chainId,
  payments,
  children,
  className,
}: {
  safeId: Id<"safes">;
  chainId: number;
  payments: Array<{ token: string; amount: string | null }>;
  children?: ReactNode;
  className?: string;
}) {
  const check = useAccountReadiness(safeId);
  const account = check.data;
  const assessment = account
    ? assessPayments(
        account,
        payments.every((p) => p.amount && p.amount !== "0")
          ? (payments as Array<{ token: string; amount: string }>)
          : [],
        RELAY_FEATURE_ENABLED,
      )
    : null;
  return (
    <section
      className={className ?? "rounded-xl border border-white/10 p-4"}
      aria-label={`${getChainName(chainId)} funding check`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {account?.name ?? getChainName(chainId)}
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Funding account · {getChainName(chainId)}
          </p>
        </div>
        <button
          type="button"
          className="workspace-action-link"
          aria-label={`Refresh ${getChainName(chainId)} funding check`}
          disabled={check.isFetching}
          onClick={() => void check.refetch()}
        >
          <RefreshCw
            size={14}
            className={check.isFetching ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </div>
      {check.isPending ? (
        <p role="status" className="mt-3 text-sm text-slate-400">
          Checking balances and account approvals…
        </p>
      ) : check.isError || !account ? (
        <p role="status" className="mt-3 text-sm workspace-funding-warning">
          The account check is unavailable. You can save a draft; refresh before
          preparing it for approval.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="finance-label">Current balances</dt>
              {account.assets.map((asset) => (
                <dd key={asset.token} className="font-semibold tabular-nums">
                  {asset.balance == null
                    ? `${asset.token} balance unavailable`
                    : `${formatAssetAmount(asset.balance, asset.token)} ${asset.token}`}
                </dd>
              ))}
            </div>
            <div>
              <dt className="finance-label">Account approvals</dt>
              <dd className="text-sm">
                {account.threshold
                  ? `${account.threshold} of ${account.owners.length} owners required`
                  : "Could not verify"}
              </dd>
              <dd className="mt-1 text-xs text-slate-400">
                {account.canPrepare
                  ? "You can prepare payments"
                  : "Your role has view access"}
                {account.isOwner ? " · Your wallet is an owner" : ""}
                {!account.isOwner && account.approvalPaths?.length
                  ? " · You can approve through an owning account"
                  : ""}
              </dd>
              <dd className="mt-2 text-xs text-slate-400">
                {account.owners
                  .filter((o) => o.canApproveInApp)
                  .map(
                    (o) =>
                      o.name ??
                      `${o.address.slice(0, 6)}…${o.address.slice(-4)}`,
                  )
                  .join(" · ") || "No verified approvers in this workspace"}
              </dd>
            </div>
          </dl>
          {!!assessment?.debits.length && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <span className="finance-label">
                Required from this account
                {RELAY_FEATURE_ENABLED && account.managed.fee
                  ? " including payment service fee"
                  : ""}
              </span>
              {assessment.debits.map((d) => (
                <p key={d.token} className="text-sm tabular-nums">
                  {formatAssetAmount(d.amount, d.token)} {d.token}
                  {d.shortfall
                    ? ` · ${formatAssetAmount(d.shortfall, d.token)} ${d.token} short`
                    : ""}
                </p>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs leading-5 text-slate-400">
            {account.managed.service === "circle"
              ? "Execution fees are paid from this account in USDC. The amounts above cover recipients; review and approve the separate fee limit before sending."
              : RELAY_FEATURE_ENABLED
                ? account.managed.fee
                  ? `Payment service fee: ${formatAssetAmount(account.managed.fee.amount, account.managed.fee.token)} ${account.managed.fee.token} per batch. Confirm the current fee when approving.`
                  : "Stablecoin payment fees are currently unavailable on this account."
                : `${account.environment === "test" ? "Test network · " : ""}The sending wallet pays network fees in ${account.environment === "test" ? "test " : ""}${account.native.symbol}. Wallet balance: ${account.native.balance ?? "unavailable"} ${account.native.symbol}. The exact fee is checked when sending.`}
          </p>
          {!!assessment?.issues.length && (
            <ul
              aria-live="polite"
              className="mt-3 space-y-1 text-sm leading-6 workspace-funding-warning"
            >
              {assessment.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {!assessment && account.error && (
            <p role="status" className="mt-3 text-sm workspace-funding-warning">
              {account.error}
            </p>
          )}
          {account.blockNumber && (
            <p className="mt-3 text-xs text-slate-500">
              Checked{" "}
              {new Date(account.checkedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
              . Balances can change before payment.
            </p>
          )}
        </>
      )}
      {children}
    </section>
  );
}
