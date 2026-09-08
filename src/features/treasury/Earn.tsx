import { useRef, useState } from "react";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import {
  useQuery as useRemoteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ExternalLink, RefreshCw } from "lucide-react";
import { formatUnits } from "viem";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  decodeLendingQuote,
  lendingAvailability,
  lendingMarket,
  LENDING_CHAINS,
  type LendingQuote,
} from "../../../shared/lending";
import { circleConfiguration } from "../../../shared/circleExecution";
import { TREASURY_OPERATOR_ROLES } from "../../../shared/roles";
import { amountToBaseUnits } from "../../../shared/validation";
import { chainEnvironment } from "../../../shared/assets";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { CustomerPaidExecution } from "@/features/payments/CustomerPaidExecution";
import { Dialog } from "@/components/ui/Dialog";
import {
  LoadingRows,
  Notice,
} from "@/components/workspace/WorkspacePrimitives";
import { useSessionToken } from "@/lib/session";
import { getBlockExplorerTxUrl, getChainName } from "@/lib/chains";
import { userErrorMessage } from "@/lib/userErrors";
import { scheduleDateTime } from "@/lib/formatMoney";

const statuses = {
  quoted: "Ready for review",
  approving: "Needs approval",
  processing: "Processing",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Review expired",
  failed: "Not completed",
};
const units = (raw: string) => formatUnits(BigInt(raw), 6);
const apr = (raw: string) => `${(Number(raw) / 1e25).toFixed(2)}%`;

export function Earn({
  orgId,
  accounts,
}: {
  orgId: Id<"orgs">;
  accounts: Doc<"safes">[];
}) {
  const sessionToken = useSessionToken(),
    { address } = useAccount(),
    { environment } = useActivityEnvironment();
  const queryClient = useQueryClient();
  const members = useQuery(
    api.orgs.listMembers,
    sessionToken ? { orgId, sessionToken } : "skip",
  );
  const member = members?.find(
    (m) => m?.walletAddress.toLowerCase() === address?.toLowerCase(),
  );
  const canWrite = !!member && TREASURY_OPERATOR_ROLES.includes(member.role);
  const { results, status, loadMore } = usePaginatedQuery(
    api.treasuryServices.list,
    sessionToken && environment !== "unclassified"
      ? { orgId, sessionToken, environment }
      : "skip",
    { initialNumItems: 10 },
  );
  const [show, setShow] = useState(false),
    [accountId, setAccountId] = useState("");
  const [selected, setSelected] = useState<Id<"treasuryServices">>();
  const [kind, setKind] = useState<"supply" | "withdraw">("supply"),
    [amount, setAmount] = useState("");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [consent, setConsent] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [executing, setExecuting] = useState(false);
  const lock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const position = useAction(api.treasuryServiceActions.position),
    prepare = useAction(api.treasuryServiceActions.prepare),
    stop = useMutation(api.treasuryServices.stop);
  const sources = accounts.filter(
    (a) =>
      a.isActive !== false &&
      chainEnvironment(a.chainId) === environment &&
      (LENDING_CHAINS as readonly number[]).includes(a.chainId),
  );
  const account = sources.find((a) => a._id === accountId) ?? sources[0];
  const snapshot = useRemoteQuery({
    queryKey: ["lending-position", account?._id, sessionToken],
    queryFn: () =>
      position({ safeId: account!._id, sessionToken: sessionToken! }),
    enabled: show && !selected && !!account && !!sessionToken,
    staleTime: 30_000,
    retry: 1,
  });
  const saved = useQuery(
    api.treasuryServices.get,
    selected && sessionToken
      ? { treasuryServiceId: selected, sessionToken }
      : "skip",
  );
  const cancellation = useQuery(
    api.circlePayments.get,
    saved?.cancellationRequestedAt && saved.circleExecutionId && sessionToken
      ? { cancelExecutionId: saved.circleExecutionId, sessionToken }
      : "skip",
  );
  let quote: LendingQuote | undefined,
    quoteError = "";
  if (saved)
    try {
      quote = decodeLendingQuote(saved.quote);
    } catch {
      quoteError =
        "The saved review could not be read. Check the original request before creating another.";
    }
  const accountName = (id: string) =>
    accounts.find((a) => a._id === id)?.name ?? "Company account";
  const memberName = (wallet: string) =>
    members?.find(
      (m) => m?.walletAddress.toLowerCase() === wallet.toLowerCase(),
    )?.name || "Account owner";
  const run = async (work: () => Promise<unknown>) => {
    if (lock.current || executing) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        userErrorMessage(
          e,
          "This step could not be completed. Your account and saved instructions are unchanged. Try again shortly.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const issue = snapshot.data
    ? lendingAvailability(kind, snapshot.data, Date.now())
    : undefined;
  const open = (id?: Id<"treasuryServices">) => {
    setSelected(id);
    setConsent("");
    setError("");
    setAmount("");
    setWithdrawAll(false);
    requestId.current = crypto.randomUUID();
    setShow(true);
  };
  return (
    <section className="workspace-panel mt-6" aria-label="Earn with Aave">
      <div className="workspace-panel-heading flex flex-wrap gap-4">
        <div>
          <h2>Earn</h2>
          <p>
            Lend idle funds through Aave. Keep upcoming bills and payroll in
            your payment accounts.
          </p>
        </div>
        <button className="workspace-button" onClick={() => open()}>
          View lending
        </button>
      </div>
      {status === "LoadingFirstPage" ? (
        <LoadingRows />
      ) : results.length ? (
        <div className="divide-y divide-[var(--ws-border)]">
          {results.map((row) => {
            let q;
            try {
              q = decodeLendingQuote(row.quote);
            } catch {
              /* Retain access to the saved error and receipt. */
            }
            return (
              <button
                key={row._id}
                data-service-id={row._id}
                className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left hover:bg-[var(--ws-hover)]"
                onClick={() => open(row._id)}
              >
                <span>
                  <strong className="block text-sm">
                    {row.kind === "supply" ? "Lending deposit" : "Withdrawal"} ·{" "}
                    {accountName(row.safeId)}
                  </strong>
                  <span className="text-xs text-[var(--ws-muted)]">
                    Aave · {scheduleDateTime(row.createdAt)}
                  </span>
                </span>
                <span className="text-right">
                  <strong className="block text-sm">
                    {q
                      ? `${q.withdrawAll && !row.settledAmount ? "Est. " : ""}${units(row.settledAmount ?? q.amount)} ${lendingMarket(q.chainId).assetLabel}`
                      : "Review details"}
                  </strong>
                  <span className="text-xs text-[var(--ws-muted)]">
                    {statuses[row.status]}
                  </span>
                </span>
              </button>
            );
          })}
          {status === "CanLoadMore" && (
            <div className="p-4">
              <button className="workspace-button" onClick={() => loadMore(10)}>
                Load more requests
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="p-6 text-sm text-[var(--ws-muted)]">
          Your lending activity will appear here. Funds stay under your
          account's control; the provider's lending terms and risks apply.
        </p>
      )}
      {show && (
        <Dialog
          title={selected ? "Lending request" : "Earn with Aave"}
          onClose={() => {
            if (!busy && !executing) setShow(false);
          }}
        >
          <div className="space-y-5 p-6">
            {error && <Notice>{error}</Notice>}
            {selected ? (
              saved === undefined ? (
                <LoadingRows />
              ) : !saved ? (
                <Notice>
                  This request could not be found. Refresh the page before
                  continuing.
                </Notice>
              ) : quoteError || !quote ? (
                <Notice>{quoteError}</Notice>
              ) : (
                <>
                  <div className="rounded-lg border border-[var(--ws-border)] p-5">
                    <p className="finance-label">
                      {quote.kind === "supply"
                        ? "Lending deposit"
                        : "Withdrawal to your account"}
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {quote.withdrawAll && !saved.settledAmount
                        ? "Estimated "
                        : ""}
                      {units(saved.settledAmount ?? quote.amount)}{" "}
                      {lendingMarket(quote.chainId).assetLabel}
                    </p>
                    <p className="mt-2 text-sm text-[var(--ws-muted)]">
                      {accountName(saved.safeId)} ·{" "}
                      {getChainName(quote.chainId)}
                    </p>
                    <p className="mt-3 text-sm">{statuses[saved.status]}</p>
                  </div>
                  {quote.kind === "supply" && (
                    <p className="text-sm text-[var(--ws-muted)]">
                      Variable supply APR at review: {apr(quote.rateRay)}. Your
                      lending position stays separate from funds available for
                      payments.
                    </p>
                  )}
                  {saved.sourceTxHash && (
                    <a
                      className="workspace-action-link"
                      href={getBlockExplorerTxUrl(
                        quote.chainId,
                        saved.sourceTxHash,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View confirmed transaction <ExternalLink size={13} />
                    </a>
                  )}
                  {saved.status === "processing" && (
                    <Notice tone="info">
                      Your original request is being checked. You can close this
                      window while it completes. Do not create a replacement.
                    </Notice>
                  )}
                  {saved.status === "failed" && (
                    <Notice>
                      The lending operation did not complete. Any execution fee
                      charged is shown below. Refresh the account position
                      before reviewing another request.
                    </Notice>
                  )}
                  {saved.status === "expired" && (
                    <Notice tone="info">
                      The approval window ended. Review a fresh amount after
                      refreshing your account's current position.
                    </Notice>
                  )}
                  {saved.open &&
                    ["quoted", "approving"].includes(saved.status) &&
                    !saved.cancellationRequestedAt && (
                      <>
                        <p className="text-sm text-[var(--ws-muted)]">
                          This review expires{" "}
                          {scheduleDateTime(quote.expiresAt)}.{" "}
                          {quote.kind === "withdraw"
                            ? quote.withdrawAll
                              ? "Aave will return the full position to this account. The final amount depends on its balance and accrued interest at execution."
                              : "Aave will return this amount to the same company account."
                            : "The amount goes directly to Aave's lending pool. This flow does not borrow or enable the position as collateral."}{" "}
                          You pay the execution cost in USDC.
                        </p>
                        <label className="flex items-start gap-3 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={consent === saved.hash}
                            disabled={busy || executing || !canWrite}
                            onChange={(e) =>
                              setConsent(e.target.checked ? saved.hash : "")
                            }
                          />
                          <span>
                            I reviewed the company account, amount and Aave's
                            lending and withdrawal terms.
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
                      !saved.cancellationRequestedAt &&
                      quote.expiresAt > Date.now() &&
                      ["quoted", "approving"].includes(saved.status)
                    }
                    blocked={
                      busy || !canWrite || !!saved.cancellationRequestedAt
                    }
                    memberName={memberName}
                    onBusyChange={setExecuting}
                    actionLabel={
                      quote.kind === "supply"
                        ? "Deposit with Aave"
                        : "Withdraw to account"
                    }
                    principalUSDC={
                      quote.kind === "supply" &&
                      lendingMarket(quote.chainId).asset.toLowerCase() ===
                        circleConfiguration(quote.chainId).token.toLowerCase()
                        ? quote.amount
                        : undefined
                    }
                  />
                  {saved.cancellationRequestedAt && saved.circleExecutionId && (
                    <>
                      {saved.open && (
                        <Notice tone="info">
                          An approval may already exist. Confirm cancellation to
                          invalidate it before preparing another request. You
                          pay its execution cost in USDC.
                        </Notice>
                      )}
                      {(saved.open || cancellation) && (
                        <CustomerPaidExecution
                          source={{
                            cancelExecutionId: saved.circleExecutionId,
                          }}
                          ready={saved.open && canWrite}
                          blocked={busy || !canWrite}
                          memberName={memberName}
                          onBusyChange={setExecuting}
                        />
                      )}
                    </>
                  )}
                  {canWrite &&
                    saved.open &&
                    !saved.cancellationRequestedAt &&
                    ["quoted", "approving"].includes(saved.status) && (
                      <button
                        className="workspace-button"
                        disabled={busy || executing}
                        onClick={() =>
                          void run(() =>
                            stop({
                              treasuryServiceId: saved._id,
                              sessionToken: sessionToken!,
                            }),
                          )
                        }
                      >
                        Stop this request
                      </button>
                    )}
                  {!saved.open && (
                    <button
                      className="workspace-button"
                      onClick={() => {
                        setSelected(undefined);
                        setConsent("");
                        setWithdrawAll(false);
                        setAmount("");
                        requestId.current = crypto.randomUUID();
                        void queryClient.invalidateQueries({
                          queryKey: ["lending-position"],
                        });
                        void queryClient.invalidateQueries({
                          queryKey: ["account-readiness"],
                        });
                      }}
                    >
                      Review current position
                    </button>
                  )}
                </>
              )
            ) : !account ? (
              <Notice tone="info">
                Lending is available for connected accounts on Base and
                Arbitrum, and for test accounts on Base Sepolia. Connect a
                supported account in Settings to review it here.
              </Notice>
            ) : (
              <>
                <label className="block">
                  <span className="finance-label">Company account</span>
                  <select
                    className="finance-field"
                    value={account._id}
                    disabled={busy}
                    onChange={(e) => {
                      setAccountId(e.target.value);
                      setWithdrawAll(false);
                      setAmount("");
                      setError("");
                      requestId.current = crypto.randomUUID();
                    }}
                  >
                    {sources.map((a) => (
                      <option key={a._id} value={a._id}>
                        {a.name ?? "Company account"} ·{" "}
                        {getChainName(a.chainId)}
                      </option>
                    ))}
                  </select>
                </label>
                {snapshot.isPending ? (
                  <LoadingRows />
                ) : (
                  <>
                    {snapshot.isError && (
                      <Notice>
                        {userErrorMessage(
                          snapshot.error,
                          "Aave's current position could not be loaded. Refresh before reviewing an amount.",
                        )}
                      </Notice>
                    )}
                    <button
                      className="workspace-action-link"
                      disabled={snapshot.isFetching || busy}
                      onClick={() => void snapshot.refetch()}
                    >
                      <RefreshCw
                        size={13}
                        className={snapshot.isFetching ? "animate-spin" : ""}
                      />
                      {snapshot.isFetching
                        ? "Refreshing position…"
                        : "Refresh position"}
                    </button>
                    {snapshot.data && (
                      <>
                        <div className="grid gap-4 rounded-lg border border-[var(--ws-border)] p-5 sm:grid-cols-2">
                          <div>
                            <p className="finance-label">In this account</p>
                            <p className="mt-1 text-xl font-semibold">
                              {units(snapshot.data.available)}{" "}
                              {snapshot.data.assetLabel}
                            </p>
                          </div>
                          <div>
                            <p className="finance-label">Lent through Aave</p>
                            <p className="mt-1 text-xl font-semibold">
                              {units(snapshot.data.supplied)}{" "}
                              {snapshot.data.assetLabel}
                            </p>
                          </div>
                          <div>
                            <p className="finance-label">Variable supply APR</p>
                            <p className="mt-1 text-lg">
                              {apr(snapshot.data.rateRay)}
                            </p>
                          </div>
                          <div>
                            <p className="finance-label">
                              USDC available for fees
                            </p>
                            <p className="mt-1 text-lg">
                              {units(snapshot.data.feeBalance)}
                            </p>
                          </div>
                        </div>
                        <p className="text-xs text-[var(--ws-muted)]">
                          Position checked{" "}
                          {scheduleDateTime(snapshot.data.checkedAt)}. It
                          includes accrued lending interest and activity
                          performed outside Disburse. It is not immediately
                          available for payments.
                        </p>
                        {account.chainId === 84532 && (
                          <Notice tone="info">
                            Aave test USDC is a separate test asset. Circle USDC
                            in your account pays execution fees. Neither has
                            real value.
                          </Notice>
                        )}
                        <div className="flex gap-2" aria-label="Lending action">
                          {(["supply", "withdraw"] as const).map((value) => (
                            <button
                              key={value}
                              className={`workspace-button ${kind === value ? "workspace-button-primary" : ""}`}
                              aria-pressed={kind === value}
                              disabled={busy}
                              onClick={() => {
                                setKind(value);
                                setWithdrawAll(false);
                                setAmount("");
                                setError("");
                                requestId.current = crypto.randomUUID();
                              }}
                            >
                              {value === "supply"
                                ? "Lend funds"
                                : "Withdraw funds"}
                            </button>
                          ))}
                        </div>
                        {issue && <Notice tone="info">{issue}</Notice>}
                        <form
                          className="space-y-4"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (
                              !canWrite ||
                              !sessionToken ||
                              busy ||
                              issue ||
                              snapshot.isError
                            )
                              return;
                            void run(async () => {
                              const raw = amountToBaseUnits(
                                amount,
                                "USDC",
                              ).toString();
                              const id = await prepare({
                                orgId,
                                safeId: account._id,
                                kind,
                                amount: raw,
                                withdrawAll:
                                  kind === "withdraw" && withdrawAll
                                    ? true
                                    : undefined,
                                requestId: requestId.current,
                                sessionToken,
                              });
                              setSelected(id);
                              setConsent("");
                            });
                          }}
                        >
                          {kind === "withdraw" && (
                            <label className="flex items-start gap-3 text-sm">
                              <input
                                type="checkbox"
                                checked={withdrawAll}
                                disabled={busy || !canWrite}
                                onChange={(e) => {
                                  setWithdrawAll(e.target.checked);
                                  if (e.target.checked)
                                    setAmount(units(snapshot.data.supplied));
                                  requestId.current = crypto.randomUUID();
                                }}
                              />
                              <span>
                                Withdraw the full position, including interest
                                accrued before execution.
                              </span>
                            </label>
                          )}
                          <label className="block">
                            <span className="finance-label">
                              Amount to{" "}
                              {kind === "supply" ? "lend" : "withdraw"} ·{" "}
                              {snapshot.data.assetLabel}
                            </span>
                            <input
                              className="finance-field"
                              inputMode="decimal"
                              value={amount}
                              required
                              disabled={busy || !canWrite || withdrawAll}
                              placeholder="0.00"
                              onChange={(e) => {
                                setAmount(e.target.value);
                                setError("");
                                requestId.current = crypto.randomUUID();
                              }}
                            />
                          </label>
                          <p className="text-sm text-[var(--ws-muted)]">
                            {kind === "supply"
                              ? "Keep enough cash for upcoming payments and USDC execution fees. Your account owns the lending position."
                              : "Withdrawals return to this company account. Availability depends on Aave's liquidity and reserve status; there is no fixed withdrawal date."}
                          </p>
                          <button
                            className="workspace-button workspace-button-primary"
                            disabled={
                              busy ||
                              !canWrite ||
                              !!issue ||
                              snapshot.isError ||
                              !amount
                            }
                          >
                            {busy ? "Checking amount…" : "Review amount"}
                          </button>
                          {!canWrite && (
                            <p className="text-sm text-[var(--ws-muted)]">
                              An admin or approver can prepare lending requests.
                              The account's required owners approve execution.
                            </p>
                          )}
                        </form>
                      </>
                    )}
                  </>
                )}
                <details className="text-sm text-[var(--ws-muted)]">
                  <summary className="cursor-pointer">
                    Provider terms and risks
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p>
                      Aave lends supplied assets to borrowers. Its supply rate
                      varies and is not guaranteed. Position balances can differ
                      by a small rounding amount from the deposited quantity.
                      USDC can lose value, contracts can fail, and withdrawals
                      can be delayed by low liquidity or a paused reserve.
                    </p>
                    <p>
                      Disburse does not hold your funds, operate the lending
                      pool or cover transaction costs. Aave's published supply
                      rate reflects its reserve factor. Disburse adds no lending
                      fee.
                    </p>
                    <a
                      className="workspace-action-link"
                      href="https://aave.com/help/supplying/withdraw-tokens"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Aave withdrawal terms <ExternalLink size={13} />
                    </a>
                  </div>
                </details>
              </>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
