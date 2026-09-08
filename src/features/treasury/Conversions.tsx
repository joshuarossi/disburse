import { treasuryRequestStatuses, treasuryUnits } from "./treasuryPresentation";
import { useRef, useState } from "react";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import {
  useQuery as useRemoteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { RefreshCw } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  CONVERSION_CHAINS,
  CONVERSION_SLIPPAGE_BPS,
  conversionAssets,
  conversionMarket,
  decodeConversionQuote,
} from "../../../shared/conversion";
import { TREASURY_OPERATOR_ROLES } from "../../../shared/roles";
import { amountToBaseUnits } from "../../../shared/validation";
import { chainEnvironment } from "../../../shared/assets";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { Dialog } from "@/components/ui/Dialog";
import {
  LoadingRows,
  Notice,
} from "@/components/workspace/WorkspacePrimitives";
import { useSessionToken } from "@/lib/session";
import { getChainName } from "@/lib/chains";
import { userErrorMessage } from "@/lib/userErrors";
import { scheduleDateTime } from "@/lib/formatMoney";
import { TreasuryServiceReview } from "./TreasuryServiceReview";

export function Conversions({
  orgId,
  accounts,
}: {
  orgId: Id<"orgs">;
  accounts: Doc<"safes">[];
}) {
  const sessionToken = useSessionToken(),
    { address } = useAccount(),
    { environment } = useActivityEnvironment(),
    queryClient = useQueryClient();
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
      ? { orgId, sessionToken, environment, provider: "uniswap_v3" }
      : "skip",
    { initialNumItems: 10 },
  );
  const sources = accounts.filter(
    (a) =>
      a.isActive !== false &&
      chainEnvironment(a.chainId) === environment &&
      (CONVERSION_CHAINS as readonly number[]).includes(a.chainId),
  );
  const [show, setShow] = useState(false),
    [accountId, setAccountId] = useState(""),
    [tokenIn, setTokenIn] = useState("");
  const [amount, setAmount] = useState(""),
    [slippageBps, setSlippageBps] = useState(50),
    [selected, setSelected] = useState<Id<"treasuryServices">>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [executing, setExecuting] = useState(false),
    lock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const account = sources.find((a) => a._id === accountId) ?? sources[0],
    market = account ? conversionMarket(account.chainId) : undefined;
  const input =
    market?.assets.find(
      (a) => a.address.toLowerCase() === tokenIn.toLowerCase(),
    ) ?? market?.assets[0];
  const output =
    account && input
      ? conversionAssets(account.chainId, input.address).output
      : undefined;
  const readBalances = useAction(api.conversionActions.balances),
    prepare = useAction(api.conversionActions.prepare);
  const balances = useRemoteQuery({
    queryKey: ["conversion-balances", account?._id, sessionToken],
    queryFn: () =>
      readBalances({ safeId: account!._id, sessionToken: sessionToken! }),
    enabled: show && !selected && !!account && !!sessionToken,
    staleTime: 30_000,
    retry: 1,
  });
  const accountName = (id: string) =>
    accounts.find((a) => a._id === id)?.name ?? "Company account";
  const memberName = (wallet: string) =>
    members?.find(
      (m) => m?.walletAddress.toLowerCase() === wallet.toLowerCase(),
    )?.name || "Account owner";
  const changed = () => {
    setError("");
    requestId.current = crypto.randomUUID();
  };
  const open = (id?: Id<"treasuryServices">) => {
    setSelected(id);
    setAmount("");
    changed();
    setShow(true);
  };
  return (
    <section className="workspace-panel mt-6" aria-label="Currency conversions">
      <div className="workspace-panel-heading flex flex-wrap gap-4">
        <div>
          <h2>Convert currencies</h2>
          <p>
            Exchange funds within a company account. Choose what you receive and
            approve the maximum cost.
          </p>
        </div>
        <button className="workspace-button" onClick={() => open()}>
          New conversion
        </button>
      </div>
      {status === "LoadingFirstPage" ? (
        <LoadingRows />
      ) : results.length ? (
        <div className="divide-y divide-[var(--ws-border)]">
          {results.map((row) => {
            let q;
            try {
              q = decodeConversionQuote(row.quote);
            } catch {
              /* Keep the original request accessible. */
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
                    {q
                      ? `${conversionAssets(q.chainId, q.tokenIn).input.symbol} to ${conversionAssets(q.chainId, q.tokenIn).output.symbol}`
                      : "Conversion"}{" "}
                    · {accountName(row.safeId)}
                  </strong>
                  <span className="text-xs text-[var(--ws-muted)]">
                    Uniswap · {scheduleDateTime(row.createdAt)}
                  </span>
                </span>
                <span className="text-right">
                  <strong className="block text-sm">
                    {q
                      ? `${treasuryUnits(q.amount)} ${conversionAssets(q.chainId, q.tokenIn).output.symbol}`
                      : "Review details"}
                  </strong>
                  <span className="text-xs text-[var(--ws-muted)]">
                    {treasuryRequestStatuses[row.status]}
                  </span>
                </span>
              </button>
            );
          })}
          {status === "CanLoadMore" && (
            <div className="p-4">
              <button className="workspace-button" onClick={() => loadMore(10)}>
                Load more conversions
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="p-6 text-sm text-[var(--ws-muted)]">
          Your conversions will appear here. Recipient payment instructions stay
          as reviewed.
        </p>
      )}
      {show && (
        <Dialog
          title={selected ? "Conversion request" : "Convert currencies"}
          onClose={() => {
            if (!busy && !executing) setShow(false);
          }}
        >
          <div className="space-y-5 p-6">
            {error && <Notice>{error}</Notice>}
            {selected ? (
              <TreasuryServiceReview
                key={selected}
                id={selected}
                accountName={accountName}
                memberName={memberName}
                canWrite={canWrite}
                onBusyChange={setExecuting}
                refreshLabel="Review account balances"
                onNew={() => {
                  setSelected(undefined);
                  setAmount("");
                  changed();
                  void queryClient.invalidateQueries({
                    queryKey: ["conversion-balances"],
                  });
                  void queryClient.invalidateQueries({
                    queryKey: ["account-readiness"],
                  });
                }}
              />
            ) : !account || !input || !output ? (
              <Notice tone="info">
                Connect a company account on Base or Arbitrum to convert USDC
                and USDT. Base Sepolia has an isolated test route.
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
                      setTokenIn("");
                      setAmount("");
                      changed();
                    }}
                  >
                    {sources.map((a) => (
                      <option key={a._id} value={a._id}>
                        {accountName(a._id)} · {getChainName(a.chainId)}
                      </option>
                    ))}
                  </select>
                </label>
                {balances.isPending ? (
                  <LoadingRows />
                ) : (
                  <>
                    {balances.isError && (
                      <Notice>
                        {userErrorMessage(
                          balances.error,
                          "Current conversion balances could not be loaded. Refresh before continuing.",
                        )}
                      </Notice>
                    )}
                    <button
                      className="workspace-action-link"
                      disabled={balances.isFetching || busy}
                      onClick={() => void balances.refetch()}
                    >
                      <RefreshCw
                        size={13}
                        className={balances.isFetching ? "animate-spin" : ""}
                      />
                      {balances.isFetching
                        ? "Refreshing balances…"
                        : "Refresh balances"}
                    </button>
                    {balances.data && (
                      <>
                        <div className="grid gap-4 rounded-lg border border-[var(--ws-border)] p-5 sm:grid-cols-2">
                          {balances.data.balances.map((b) => (
                            <div key={b.address}>
                              <p className="finance-label">
                                Available {b.symbol}
                              </p>
                              <p className="mt-1 text-xl font-semibold">
                                {treasuryUnits(b.amount)}
                              </p>
                            </div>
                          ))}
                        </div>
                        {account.chainId === 84532 && (
                          <Notice tone="info">
                            This route exchanges Circle test USDC and Aave test
                            USDC. Neither has real value. Circle USDC also pays
                            execution fees.
                          </Notice>
                        )}
                        <form
                          className="space-y-4"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (
                              lock.current ||
                              !canWrite ||
                              !sessionToken ||
                              balances.isError
                            )
                              return;
                            lock.current = true;
                            setBusy(true);
                            setError("");
                            void (async () => {
                              const raw = amountToBaseUnits(
                                amount,
                                "USDC",
                              ).toString();
                              const id = await prepare({
                                orgId,
                                safeId: account._id,
                                kind: "conversion",
                                tokenIn: input.address,
                                amount: raw,
                                slippageBps,
                                requestId: requestId.current,
                                sessionToken,
                              });
                              setSelected(id);
                            })()
                              .catch((e) =>
                                setError(
                                  userErrorMessage(
                                    e,
                                    "The conversion quote could not be prepared. Your funds have not moved. Try again shortly.",
                                  ),
                                ),
                              )
                              .finally(() => {
                                lock.current = false;
                                setBusy(false);
                              });
                          }}
                        >
                          <div className="grid gap-4 sm:grid-cols-2">
                            <label>
                              <span className="finance-label">Pay with</span>
                              <select
                                className="finance-field"
                                value={input.address}
                                disabled={busy || !canWrite}
                                onChange={(e) => {
                                  setTokenIn(e.target.value);
                                  setAmount("");
                                  changed();
                                }}
                              >
                                {market!.assets.map((a) => (
                                  <option key={a.address} value={a.address}>
                                    {a.symbol}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span className="finance-label">
                                Amount to receive · {output.symbol}
                              </span>
                              <input
                                className="finance-field"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={amount}
                                required
                                disabled={busy || !canWrite}
                                onChange={(e) => {
                                  setAmount(e.target.value);
                                  changed();
                                }}
                              />
                            </label>
                          </div>
                          <label className="block">
                            <span className="finance-label">
                              Price tolerance
                            </span>
                            <select
                              className="finance-field"
                              value={slippageBps}
                              disabled={busy || !canWrite}
                              onChange={(e) => {
                                setSlippageBps(Number(e.target.value));
                                changed();
                              }}
                            >
                              {CONVERSION_SLIPPAGE_BPS.map((b) => (
                                <option key={b} value={b}>
                                  {b / 100}%{b === 50 ? " · standard" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="text-sm text-[var(--ws-muted)]">
                            Your quote includes the pool fee and a maximum
                            amount of {input.symbol} to spend. Keep some USDC
                            available for the separate execution fee. The
                            converted funds return to this company account.
                          </p>
                          <button
                            className="workspace-button workspace-button-primary"
                            disabled={
                              busy || !canWrite || balances.isError || !amount
                            }
                          >
                            {busy
                              ? "Checking exchange rate…"
                              : "Review conversion"}
                          </button>
                          {!canWrite && (
                            <p className="text-sm text-[var(--ws-muted)]">
                              An admin or approver can prepare conversions. The
                              account's required owners approve execution.
                            </p>
                          )}
                        </form>
                      </>
                    )}
                  </>
                )}
                <details className="text-sm text-[var(--ws-muted)]">
                  <summary className="cursor-pointer">
                    Provider and pricing
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p>
                      Uniswap's pools determine the exchange rate and charge the
                      pool fee included in the quote. The reviewed maximum
                      protects against a worse price. A change beyond that limit
                      stops execution; an attempted execution can still cost a
                      fee.
                    </p>
                    <p>
                      Quotes compare supported direct pools for this currency
                      pair. They are not a claim of the best rate across every
                      exchange. Tokens can lose value and liquidity can change.
                      Disburse adds no conversion fee and does not pay your
                      execution costs.
                    </p>
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
