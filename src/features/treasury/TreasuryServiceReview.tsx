import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink } from "lucide-react";
import { treasuryRequestStatuses, treasuryUnits } from "./treasuryPresentation";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  decodeTreasuryServiceQuote,
  treasuryServicePrincipalUSDC,
  type TreasuryServiceQuote,
} from "../../../shared/treasuryService";
import { conversionAssets } from "../../../shared/conversion";
import { lendingMarket } from "../../../shared/lending";
import { CustomerPaidExecution } from "@/features/payments/CustomerPaidExecution";
import {
  LoadingRows,
  Notice,
} from "@/components/workspace/WorkspacePrimitives";
import { useSessionToken } from "@/lib/session";
import { getBlockExplorerTxUrl, getChainName } from "@/lib/chains";
import { scheduleDateTime } from "@/lib/formatMoney";
import { userErrorMessage } from "@/lib/userErrors";

export function TreasuryServiceReview({
  id,
  accountName,
  memberName,
  canWrite,
  onBusyChange,
  onNew,
  refreshLabel,
}: {
  id: Id<"treasuryServices">;
  accountName: (id: string) => string;
  memberName: (wallet: string) => string;
  canWrite: boolean;
  onBusyChange: (busy: boolean) => void;
  onNew: () => void;
  refreshLabel: string;
}) {
  useWorkspaceLanguage();
  const sessionToken = useSessionToken();
  const saved = useQuery(
    api.treasuryServices.get,
    sessionToken ? { treasuryServiceId: id, sessionToken } : "skip",
  );
  const cancellation = useQuery(
    api.circlePayments.get,
    saved?.cancellationRequestedAt && saved.circleExecutionId && sessionToken
      ? { cancelExecutionId: saved.circleExecutionId, sessionToken }
      : "skip",
  );
  const stop = useMutation(api.treasuryServices.stop),
    lock = useRef(false);
  const [error, setError] = useState(""),
    [consent, setConsent] = useState(""),
    [busy, setBusy] = useState(false),
    [executing, setExecuting] = useState(false);
  if (saved === undefined) return <LoadingRows />;
  if (!saved)
    return (
      <Notice>
        {tx(
          "This request could not be found. Refresh the page before continuing.",
        )}
      </Notice>
    );
  let quote: TreasuryServiceQuote;
  try {
    quote = decodeTreasuryServiceQuote(saved.quote);
  } catch {
    return (
      <Notice>
        {tx(
          "The saved review could not be read. Check the original request before creating another.",
        )}
      </Notice>
    );
  }
  const q = quote,
    conversion = q.provider === "uniswap_v3" ? q : undefined,
    lending = q.provider === "aave_v3" ? q : undefined;
  const assets = conversion
    ? conversionAssets(q.chainId, conversion.tokenIn)
    : undefined;
  const pending =
    saved.open &&
    ["quoted", "approving"].includes(saved.status) &&
    !saved.cancellationRequestedAt;
  const actionLabel = conversion
    ? "Convert currencies"
    : lending?.kind === "supply"
      ? "Deposit with Aave"
      : "Withdraw to account";
  const principal = treasuryServicePrincipalUSDC(q);
  const executingChange = (value: boolean) => {
    setExecuting(value);
    onBusyChange(value || busy);
  };
  return (
    <div className="space-y-5">
      {error && <Notice>{tx(error)}</Notice>}
      <div className="rounded-lg border border-[var(--ws-border)] p-5">
        <p className="finance-label">
          {conversion
            ? tx("Receive in your account")
            : lending?.kind === "supply"
              ? tx("Lending deposit")
              : tx("Withdrawal to your account")}
        </p>
        <p className="mt-1 text-2xl font-semibold">
          {lending?.withdrawAll && !saved.settledAmount ? tx("Estimated ") : ""}
          {treasuryUnits(
            conversion ? q.amount : (saved.settledAmount ?? q.amount),
          )}{" "}
          {conversion
            ? assets!.output.symbol
            : lendingMarket(q.chainId).assetLabel}
        </p>
        <p className="mt-2 text-sm text-[var(--ws-muted)]">
          {accountName(saved.safeId)} · {getChainName(q.chainId)}
        </p>
        <p className="mt-3 text-sm">
          {tx(treasuryRequestStatuses[saved.status])}
        </p>
      </div>
      {conversion && (
        <dl className="space-y-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt>
              {saved.settledAmount
                ? tx("Actual amount paid")
                : tx("Expected amount to pay")}
            </dt>
            <dd>
              {treasuryUnits(saved.settledAmount ?? conversion.expectedInput)}{" "}
              {assets!.input.symbol}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt>{tx("Maximum conversion cost")}</dt>
            <dd>
              {treasuryUnits(conversion.maximumInput)} {assets!.input.symbol}
            </dd>
          </div>
        </dl>
      )}
      {conversion && (
        <details className="text-sm text-[var(--ws-muted)]">
          <summary className="cursor-pointer">
            {tx("Rate and price protection")}
          </summary>
          <dl className="mt-3 space-y-3">
            <div className="flex flex-wrap justify-between gap-2">
              <dt>{tx("Price tolerance")}</dt>
              <dd>{conversion.slippageBps / 100}%</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>{tx("Pool fee included in quote")}</dt>
              <dd>{conversion.poolFee / 10000}%</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>{tx("Quoted price impact")}</dt>
              <dd>{conversion.priceImpactBps / 100}%</dd>
            </div>
          </dl>
          <p className="mt-3">
            {tx(
              "This quote uses one Uniswap pool. The reviewed maximum includes the pool fee and protects against a worse exchange rate.",
            )}
          </p>
        </details>
      )}
      {lending?.kind === "supply" && (
        <p className="text-sm text-[var(--ws-muted)]">
          {tx("Variable supply APR at review:")}{" "}
          {(Number(lending.rateRay) / 1e25).toFixed(2)}
          {tx(
            "%. Your lending position stays separate from funds available for payments.",
          )}
        </p>
      )}
      {saved.sourceTxHash && (
        <a
          className="workspace-action-link"
          href={getBlockExplorerTxUrl(q.chainId, saved.sourceTxHash)}
          target="_blank"
          rel="noreferrer"
        >
          {tx("View confirmed transaction")} <ExternalLink size={13} />
        </a>
      )}
      {saved.status === "processing" && (
        <Notice tone="info">
          {tx(
            "Your original request is being checked. You can close this window while it completes. Do not create a replacement.",
          )}
        </Notice>
      )}
      {saved.status === "failed" && (
        <Notice>
          {tx("The")} {conversion ? tx("conversion") : tx("lending operation")}{" "}
          {tx(
            "did not complete. Any execution fee charged is shown below. Refresh the account",
          )}{" "}
          {conversion ? tx("balances") : tx("position")}{" "}
          {tx("before reviewing another request.")}
        </Notice>
      )}
      {saved.status === "expired" && (
        <Notice tone="info">
          {tx(
            "The approval window ended. Review a fresh amount after refreshing your account's current",
          )}{" "}
          {conversion ? tx("balances") : tx("position")}.
        </Notice>
      )}
      {pending && (
        <>
          <p className="text-sm text-[var(--ws-muted)]">
            {tx("This review expires")} {scheduleDateTime(q.expiresAt)}.{" "}
            {conversion
              ? tx(
                  "Uniswap must deliver the exact receiving amount to this account without exceeding the maximum conversion cost. The pool fee is included in the quote; the execution fee is separate.",
                )
              : lending?.kind === "withdraw"
                ? lending.withdrawAll
                  ? tx(
                      "Aave will return the full position to this account. The final amount depends on its balance and accrued interest at execution.",
                    )
                  : tx(
                      "Aave will return this amount to the same company account.",
                    )
                : tx(
                    "The amount goes directly to Aave's lending pool. This flow does not borrow or enable the position as collateral.",
                  )}{" "}
            {tx("You pay the execution cost in USDC.")}
          </p>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={consent === saved.hash}
              disabled={busy || executing || !canWrite}
              onChange={(e) => setConsent(e.target.checked ? saved.hash : "")}
            />
            <span>
              {conversion
                ? tx(
                    "I reviewed the company account, currencies, exact receipt and maximum conversion cost.",
                  )
                : tx(
                    "I reviewed the company account, amount and Aave's lending and withdrawal terms.",
                  )}
            </span>
          </label>
        </>
      )}
      <CustomerPaidExecution
        key={saved._id}
        source={{ treasuryServiceId: saved._id }}
        ready={
          canWrite &&
          consent === saved.hash &&
          pending &&
          q.expiresAt > Date.now()
        }
        blocked={busy || !canWrite || !!saved.cancellationRequestedAt}
        memberName={memberName}
        onBusyChange={executingChange}
        actionLabel={actionLabel}
        principalUSDC={principal === "0" ? undefined : principal}
      />
      {saved.cancellationRequestedAt && saved.circleExecutionId && (
        <>
          {saved.open && (
            <Notice tone="info">
              {tx(
                "An approval may already exist. Confirm cancellation to invalidate it before preparing another request. You pay its execution cost in USDC.",
              )}
            </Notice>
          )}
          {(saved.open || cancellation) && (
            <CustomerPaidExecution
              source={{ cancelExecutionId: saved.circleExecutionId }}
              ready={saved.open && canWrite}
              blocked={busy || !canWrite}
              memberName={memberName}
              onBusyChange={executingChange}
            />
          )}
        </>
      )}
      {canWrite && pending && (
        <button
          className="workspace-button"
          disabled={busy || executing}
          onClick={() => {
            if (lock.current || !sessionToken) return;
            lock.current = true;
            setBusy(true);
            onBusyChange(true);
            setError("");
            void stop({ treasuryServiceId: saved._id, sessionToken })
              .catch((e) =>
                setError(
                  userErrorMessage(
                    e,
                    "This request could not be stopped. Check its status before trying again.",
                  ),
                ),
              )
              .finally(() => {
                lock.current = false;
                setBusy(false);
                onBusyChange(false);
              });
          }}
        >
          {tx("Stop this request")}
        </button>
      )}
      {!saved.open && (
        <button className="workspace-button" onClick={onNew}>
          {refreshLabel}
        </button>
      )}
    </div>
  );
}
