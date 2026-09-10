import { tx, useWorkspaceLanguage, workspaceLocale } from "@/lib/workspaceI18n";
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
  accountName,
}: {
  safeId: Id<"safes">;
  chainId: number;
  payments: Array<{ token: string; amount: string | null }>;
  children?: ReactNode;
  className?: string;
  accountName?: string;
}) {
  useWorkspaceLanguage();
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
      aria-label={tx("{{value1}} funding check", {
        value1: getChainName(chainId),
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {account?.name ?? accountName ?? getChainName(chainId)}
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            {tx("Funding account ·")} {getChainName(chainId)}
          </p>
        </div>
        <button
          type="button"
          className="workspace-action-link"
          aria-label={tx("Refresh {{value1}} funding check", {
            value1: getChainName(chainId),
          })}
          disabled={check.isFetching}
          onClick={() => void check.refetch()}
        >
          <RefreshCw
            size={14}
            className={check.isFetching ? "animate-spin" : ""}
          />
          {tx("Refresh")}
        </button>
      </div>
      {check.isPending ? (
        <p role="status" className="mt-3 text-sm text-slate-400">
          {tx("Checking balances and account approvals…")}
        </p>
      ) : check.isError || !account ? (
        <p role="status" className="mt-3 text-sm workspace-funding-warning">
          {tx(
            "The account check is unavailable. You can save a draft; refresh before preparing it for approval.",
          )}
        </p>
      ) : (
        <>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="finance-label">{tx("Current balances")}</dt>
              {account.assets.map((asset) => (
                <dd key={asset.token} className="font-semibold tabular-nums">
                  {asset.balance == null
                    ? tx("{{value1}} balance unavailable", {
                        value1: asset.token,
                      })
                    : `${formatAssetAmount(asset.balance, asset.token)} ${asset.token}`}
                </dd>
              ))}
            </div>
            <div>
              <dt className="finance-label">{tx("Account approvals")}</dt>
              <dd className="text-sm">
                {account.threshold
                  ? tx("{{value1}} of {{value2}} owners required", {
                      value1: account.threshold,
                      value2: account.owners.length,
                    })
                  : tx("Could not verify")}
              </dd>
              <dd className="mt-1 text-xs text-slate-400">
                {account.canPrepare
                  ? tx("You can prepare payments")
                  : tx("Your role has view access")}
                {account.isOwner ? tx(" · Your wallet is an owner") : ""}
                {!account.isOwner && account.approvalPaths?.length
                  ? tx(" · You can approve through an owning account")
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
                  .join(" · ") || tx("No verified approvers in this workspace")}
              </dd>
            </div>
          </dl>
          {!!assessment?.debits.length && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <span className="finance-label">
                {tx("Required from this account")}
                {RELAY_FEATURE_ENABLED && account.managed.fee
                  ? tx(" including payment service fee")
                  : ""}
              </span>
              {assessment.debits.map((d) => (
                <p key={d.token} className="text-sm tabular-nums">
                  {formatAssetAmount(d.amount, d.token)} {d.token}
                  {d.shortfall
                    ? tx(" · {{value1}} {{value2}} short", {
                        value1: formatAssetAmount(d.shortfall, d.token),
                        value2: d.token,
                      })
                    : ""}
                </p>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs leading-5 text-slate-400">
            {account.managed.service === "circle"
              ? tx(
                  "Execution fees are paid from this account in USDC. The amounts above cover recipients; review and approve the separate fee limit before sending.",
                )
              : RELAY_FEATURE_ENABLED
                ? account.managed.fee
                  ? tx(
                      "Payment service fee: {{value1}} {{value2}} per batch. Confirm the current fee when approving.",
                      {
                        value1: formatAssetAmount(
                          account.managed.fee.amount,
                          account.managed.fee.token,
                        ),
                        value2: account.managed.fee.token,
                      },
                    )
                  : tx(
                      "Stablecoin payment fees are currently unavailable on this account.",
                    )
                : tx(
                    "{{value1}}The sending wallet pays network fees in {{value2}}{{value3}}. Wallet balance: {{value4}} {{value5}}. The exact fee is checked when sending.",
                    {
                      value1:
                        account.environment === "test"
                          ? tx("Test network") + " · "
                          : "",
                      value2:
                        account.environment === "test" ? tx("test") + " " : "",
                      value3: account.native.symbol,
                      value4: account.native.balance ?? tx("Unavailable"),
                      value5: account.native.symbol,
                    },
                  )}
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
              {tx(account.error)}
            </p>
          )}
          {account.blockNumber && (
            <p className="mt-3 text-xs text-slate-500">
              {tx("Checked")}{" "}
              {new Date(account.checkedAt).toLocaleTimeString(
                workspaceLocale(),
                {
                  hour: "2-digit",
                  minute: "2-digit",
                },
              )}
              {tx(". Balances can change before payment.")}
            </p>
          )}
        </>
      )}
      {children}
    </section>
  );
}
