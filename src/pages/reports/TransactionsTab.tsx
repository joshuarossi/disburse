import { userErrorMessage } from '@/lib/userErrors';
import { AssetDetails } from "./AssetDetails";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import {
  chainEnvironment,
  supportedReportSymbols,
} from "../../../shared/assets";
import { formatAssetAmount } from "@/lib/formatMoney";
import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { getSessionToken } from "@/lib/session";
import { getChainName, getBlockExplorerTxUrl, CHAINS_LIST } from "@/lib/chains";
import { exportToCsv, generateFilename } from "@/lib/csv";
import { useQuery, useAction, useConvex } from "convex/react";
import { ReportProgress } from './ReportProgress';
import { useReportPages } from './useReportPages';
import { collectReportExport } from './reportExport';
import {
  ArrowUpRight,
  Download,
  FileText,
  Filter,
  Loader2,
  X,
} from "lucide-react";
import { StatusBadge, DirectionBadge } from "./badges";

interface TransactionsTabProps {
  orgId: string | undefined;
  address: string | undefined;
}

export function TransactionsTab({ orgId, address }: TransactionsTabProps) {
  const { t } = useTranslation();
  const client = useConvex();
  const [exportError, setExportError] = useState('');
  const [exportCount, setExportCount] = useState<number | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const { environment } = useActivityEnvironment();
  const syncDeposits = useAction(api.deposits.syncForOrg);
  const syncedScope = useRef("");
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const syncStates = useQuery(
    api.depositsData.statusForOrg,
    orgId && address && getSessionToken()
      ? {
          orgId: orgId as Id<"orgs">,
          sessionToken: getSessionToken()!,
          environment,
        }
      : "skip",
  );
  const syncInProgress = syncing || !!syncStates?.some((s) => s.syncing);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tokenFilter, setTokenFilter] = useState<string[]>([]);
  const [otherAsset, setOtherAsset] = useState("");
  const [assetSearch, setAssetSearch] = useState('');
  const [chainFilter, setChainFilter] = useState<number | "">("");
  const [beneficiaryFilter, setBeneficiaryFilter] = useState("");
  useEffect(() => {
    setChainFilter("");
    setOtherAsset("");
    const supported = supportedReportSymbols(environment);
    setTokenFilter((previous) =>
      previous.filter((token) => supported.includes(token)),
    );
  }, [environment]);

  const STATUS_OPTIONS = [
    { value: "executed", label: t("status.executed") },
    {
      value: "received",
      label: t("status.received", { defaultValue: "Received" }),
    },
  ];

  const TOKEN_OPTIONS = supportedReportSymbols(
    environment,
    chainFilter === "" ? undefined : chainFilter,
  ).map((value) => ({ value, label: value }));

  // Query args
  const queryArgs = useMemo(() => {
    if (!orgId || !address) return null;
    return {
      orgId: orgId as Id<"orgs">,
      sessionToken: getSessionToken() ?? "",
      environment,
      startDate: dateFrom ? new Date(dateFrom).getTime() : undefined,
      endDate: dateTo ? new Date(dateTo).getTime() : undefined,
      status: statusFilter.length > 0 ? statusFilter : undefined,
      token: tokenFilter.length > 0 ? tokenFilter : undefined,
      assetIds: otherAsset ? [otherAsset] : undefined,
      assetSearch: /^0x[\da-fA-F]{40}$/.test(assetSearch) ? assetSearch : undefined,
      chainId: chainFilter !== "" ? chainFilter : undefined,
      beneficiaryId: beneficiaryFilter
        ? (beneficiaryFilter as Id<"beneficiaries">)
        : undefined,
    };
  }, [
    orgId,
    address,
    dateFrom,
    dateTo,
    statusFilter,
    tokenFilter,
    otherAsset,
    assetSearch,
    chainFilter,
    beneficiaryFilter,
    environment,
  ]);

  const pages = useReportPages(queryArgs);
  useEffect(() => () => { exportController.current?.abort(); }, [queryArgs]);
  const reportData = useQuery(
    api.reports.getTransactionReport,
    queryArgs ? { ...queryArgs, cursor: pages.cursor } : "skip",
  );
  const otherAssets =
    reportData?.assets?.filter((asset) => !asset.recognized) ?? [];

  const beneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address && getSessionToken()
      ? {
          orgId: orgId as Id<"orgs">,
          sessionToken: getSessionToken() ?? "",
          activeOnly: false,
        }
      : "skip",
  );

  const refreshDeposits = async (force = false) => {
    if (!orgId || !address || syncing) return;
    setSyncing(true);
    setSyncError("");
    try {
      const result = await syncDeposits({
        orgId: orgId as Id<"orgs">,
        sessionToken: getSessionToken() ?? "",
        environment,
        force,
      });
      if (result.errors.length)
        setSyncError(
          result.errors
            .map((e) => `${getChainName(e.chainId)}: ${userErrorMessage({ message: e.message }, "Could not load transactions. Try again shortly.")}`)
            .join(" "),
        );
    } catch {
      setSyncError(
        "Account history could not be refreshed. Previously recorded transactions are still shown.",
      );
    } finally {
      setSyncing(false);
    }
  };
  useEffect(() => {
    const scope = `${orgId}:${environment}`;
    if (!orgId || !address || syncedScope.current === scope) return;
    syncedScope.current = scope;
    void refreshDeposits();
    // Run the initial sync once; the button below explicitly retries it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, address, environment]);

  const isLoading = reportData === undefined;
  const activeFilterCount = [
    dateFrom || dateTo,
    statusFilter.length > 0,
    tokenFilter.length > 0,
    otherAsset,
    chainFilter !== "",
    beneficiaryFilter,
  ].filter(Boolean).length;

  const toggleStatus = (status: string) => {
    setStatusFilter((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status],
    );
  };

  const toggleToken = (token: string) => {
    setOtherAsset("");
    setTokenFilter((prev) =>
      prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token],
    );
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setStatusFilter([]);
    setTokenFilter([]);
    setOtherAsset("");
    setAssetSearch("");
    setChainFilter("");
    setBeneficiaryFilter("");
  };

  const handleExport = async () => {
    if (!queryArgs || exportCount !== null) return;
    const controller = new AbortController(); exportController.current = controller;
    setExportError(''); setExportCount(0);
    try {
    const items = await collectReportExport((cursor, snapshotVersion) => client.query(api.reports.getTransactionReport, { ...queryArgs, cursor, snapshotVersion }), { signal: controller.signal, progress: setExportCount });

    const columns = [
      { key: 'rowId', label: 'Reconciliation ID' },
      { key: 'sourceId', label: 'Source record ID' },
      { key: 'timestamp', label: 'Activity timestamp UTC' },
      { key: 'observedAt', label: 'Observed timestamp UTC' },
      { key: 'dateSource', label: 'Date evidence' },
      { key: 'blockNumber', label: 'Settlement block' },
      { key: 'blockHash', label: 'Block hash' },
      { key: 'transferId', label: 'Chain transfer ID' },
      { key: 'amountRaw', label: 'Raw asset units' },
      { key: 'transferMatch', label: 'Payment transfer match' },
      { key: "kind", label: "Entry type" },
      { key: "environment", label: "Environment" },
      { key: "chainId", label: "Network ID" },
      { key: "tokenAddress", label: "Token contract" },
      { key: "accountAddress", label: "Funding account" },
      { key: "includedInTotals", label: "Included in totals" },
      { key: "date", label: t("reports.export.date") },
      {
        key: "direction",
        label: t("reports.export.direction", { defaultValue: "Direction" }),
      },
      {
        key: "beneficiary",
        label: t("reports.export.beneficiary", {
          defaultValue: "Counterparty",
        }),
      },
      {
        key: "walletAddress",
        label: t("reports.export.walletAddress", {
          defaultValue: "Wallet Address",
        }),
      },
      { key: "amount", label: t("reports.export.amount") },
      { key: "token", label: t("reports.export.token") },
      { key: "chain", label: t("reports.export.chain") },
      { key: "status", label: t("reports.export.status") },
      { key: "memo", label: t("reports.export.memo") },
      { key: "txHash", label: t("reports.export.txHash") },
    ];

    const rows = items.map((item) => ({
      rowId: item.rowId, sourceId: item.sourceId,
      timestamp: new Date(item.createdAt).toISOString(),
      observedAt: item.observedAt ? new Date(item.observedAt).toISOString() : '',
      dateSource: item.dateSource ?? (item.kind === 'deposit' ? 'provider' : 'recorded'),
      blockNumber: item.blockNumber ?? '',
      blockHash: item.blockHash ?? '',
      transferId: item.transferId ?? '',
      amountRaw: item.amountRaw ?? '',
      transferMatch: item.transferMatch ?? '',
      kind: item.kind,
      environment: item.environment,
      chainId: item.chainId ?? "",
      tokenAddress: item.tokenAddress ?? "",
      accountAddress: item.accountAddress,
      includedInTotals: item.includedInTotals ? "yes" : "no",
      date: new Date(item.createdAt).toISOString().slice(0, 10),
      direction:
        item.direction === "inflow"
          ? t("reports.direction.inflow", { defaultValue: "Inflow" })
          : t("reports.direction.outflow", { defaultValue: "Outflow" }),
      beneficiary: item.beneficiaryName,
      walletAddress: item.beneficiaryWallet,
      amount: item.amount,
      token: item.token,
      chain: item.chainId != null ? getChainName(item.chainId) : "",
      status: item.status,
      memo: item.memo || "",
      txHash: item.txHash || "",
    }));

    exportToCsv(generateFilename(`transactions_${environment}`), rows, columns);
    } catch (error) { setExportError(userErrorMessage(error, 'The export could not be completed. Try again.')); }
    finally { setExportCount(null); exportController.current = null; }
  };

  return (
    <div className="space-y-4">
      <ReportProgress orgId={orgId} data={reportData} page={pages.page} previous={pages.previous} next={pages.next} />
      {exportError && <div className="workspace-notice" role="alert" data-tone="error">{exportError}</div>}
      {exportCount !== null && <div className="workspace-notice" role="status"><span>Preparing export · {exportCount} entries</span><button className="workspace-button" onClick={() => exportController.current?.abort()}>Cancel export</button></div>}
      {syncError && (
        <div className="workspace-environment-notice" role="status">
          <span>{syncError}</span>
        </div>
      )}
      {syncStates
        ?.filter((s) => s.error)
        .map((s) => (
          <div
            className="workspace-environment-notice"
            role="status"
            key={s.safeId}
          >
            <span>
              {getChainName(s.chainId)}: {s.error} Last completed refresh:{" "}
              {s.lastSyncedAt
                ? new Date(s.lastSyncedAt).toLocaleString()
                : "Not yet completed"}
              .
              {s.nextAttemptAt && <>{' '}{s.nextAttemptAt > Date.now() ? `Automatic retry: ${new Date(s.nextAttemptAt).toLocaleString()}.` : 'An automatic retry is queued.'}</>}
            </span>
          </div>
        ))}
      {syncStates?.some((s) => s.syncing) && (
        <div className="workspace-environment-notice" role="status">
          <span>
            Refreshing account history in the background. You can leave this
            page; recorded entries remain available.
          </span>
        </div>
      )}
      {!!reportData?.excludedCount && (
        <div className="workspace-environment-notice" role="status">
          <span>
            {reportData.excludedCount}{" "}
            {reportData.excludedCount === 1 ? "entry is" : "entries are"}{" "}
            excluded from totals. Review pending transfer matches and unverified
            assets before reconciling.
          </span>
        </div>
      )}
      <p className="text-sm text-slate-400">Amounts are recorded currency units. This activity report does not apply a book valuation.</p>
      {!!syncStates?.length && <details className="rounded-xl border border-white/10 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">History coverage</summary>
        <p className="mt-3 text-slate-400">Activity includes transfers indexed for your accounts. Check coverage before matching a period to your books.</p>
        <ul className="mt-3 space-y-2">
          {syncStates.map(s => <li key={s.safeId} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <strong>{getChainName(s.chainId)}</strong>
            <span>{s.includesOutgoing && s.completedThrough ? `Incoming and outgoing history checked through ${new Date(s.completedThrough).toISOString().replace('T', ' ').slice(0, 19)} UTC` : 'Complete account history is awaiting refresh'}</span>
          </li>)}
        </ul>
        <p className="mt-3 text-slate-400">These are recorded movements. Opening and closing balances still need to be reconciled.</p>
      </details>}
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          className={cn('workspace-button', activeFilterCount > 0 && 'workspace-filter-active')}
        >
          <Filter className="h-4 w-4" />
          {t("common.filters")}
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-accent-500 px-2 py-0.5 text-xs text-navy-950">
              {activeFilterCount}
            </span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-sm text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
            {t("common.clearAll")}
          </button>
        )}

        <button
          className="workspace-button"
          disabled={syncInProgress}
          onClick={() => void refreshDeposits(true)}
        >
          {syncInProgress ? "Refreshing history…" : "Refresh history"}
        </button>
        <div className="ml-auto">
          <Button
            onClick={() => void handleExport()}
            disabled={isLoading || exportCount !== null || reportData?.indexing || !!reportData?.rangeError}
            variant="secondary"
            size="sm"
          >
            <Download className="mr-2 h-4 w-4" />
            Export all matches
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            {/* Date Range - spans 2 columns on larger screens to accommodate two inputs */}
            <div className="space-y-2 md:col-span-2 lg:col-span-2">
              <label className="text-sm font-medium text-slate-300">
                {t("reports.filters.dateRange")}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="date"
                  aria-label="Start date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
                />
                <span className="text-slate-500 whitespace-nowrap">
                  {t("disbursements.filters.to")}
                </span>
                <input
                  type="date"
                  aria-label="End date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t("reports.filters.status")}
              </label>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleStatus(opt.value)}
                    aria-pressed={statusFilter.includes(opt.value)}
                    className="workspace-filter-chip"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Token */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t("reports.filters.token")}
              </label>
              <div className="flex flex-wrap gap-2">
                {TOKEN_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleToken(opt.value)}
                    aria-pressed={tokenFilter.includes(opt.value)}
                    className="workspace-filter-chip"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chain */}
            <div className="space-y-2">
              <label
                className="block text-sm font-medium text-slate-300"
                htmlFor="report-other-asset"
              >
                Other received assets
              </label>
              <select
                id="report-other-asset"
                className="finance-field w-full"
                value={otherAsset}
                onChange={(e) => {
                  setOtherAsset(e.target.value);
                  setTokenFilter([]);
                }}
              >
                <option value="">
                  {otherAssets.length
                    ? "Choose an unrecognized asset"
                    : "No unrecognized assets in this view"}
                </option>
                {otherAsset &&
                  !otherAssets.some(
                    (asset) => asset.assetId === otherAsset,
                  ) && (
                    <option value={otherAsset}>
                      Selected asset · outside these filters
                    </option>
                  )}
                {otherAssets.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.token} · {asset.network} ·{" "}
                    {asset.tokenAddress ?? "Unresolved contract"}
                  </option>
                ))}
              </select>
              {(reportData?.assetsTruncated || assetSearch) && <label className="block text-xs text-slate-400">Find another asset by full contract
                <input className="finance-field w-full mt-1" value={assetSearch} placeholder="0x…" onChange={e => setAssetSearch(e.target.value.trim())} />
                {reportData?.assetsTruncated && <span>Showing the first 100 received assets. Search to find another contract.</span>}
              </label>}
              {otherAsset && (
                <p className="break-all text-xs leading-5 text-slate-400">
                  {otherAssets.find((asset) => asset.assetId === otherAsset)
                    ?.tokenAddress ?? otherAsset}
                </p>
              )}
              <p className="text-xs leading-5 text-slate-400">
                Currency filters use supported assets. Other received assets can
                be inspected here and are excluded from totals.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t("reports.filters.chain")}
              </label>
              <select
                aria-label={t("reports.filters.chain")}
                value={chainFilter === "" ? "" : chainFilter}
                onChange={(e) =>
                  setChainFilter(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
              >
                <option value="">{t("common.all")}</option>
                {CHAINS_LIST.filter(
                  (c) => chainEnvironment(c.chainId) === environment,
                ).map((c) => (
                  <option key={c.chainId} value={c.chainId}>
                    {c.chainName}
                  </option>
                ))}
              </select>
            </div>

            {/* Beneficiary */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t("reports.filters.beneficiary")}
              </label>
              <select
                aria-label={t("reports.filters.beneficiary")}
                value={beneficiaryFilter}
                onChange={(e) => setBeneficiaryFilter(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
              >
                <option value="">
                  {t("reports.filters.allBeneficiaries")}
                </option>
                {beneficiaries?.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                    {b.isActive === false ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
        </div>
      ) : !reportData?.items?.length ? (
        <div className="rounded-xl border border-dashed border-white/20 bg-navy-900/30 p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-white">
            {reportData?.isDone === false ? "No matches on this page" : t("reports.empty.transactions.title")}
          </h3>
          <p className="mt-2 text-slate-400">
            {reportData?.isDone === false ? "Continue to the next page to check more history, or adjust the filters." : t("reports.empty.transactions.description")}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-hidden rounded-xl border border-white/10">
            <table className="w-full">
              <thead className="bg-navy-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.date")} (UTC)
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.direction", {
                      defaultValue: "Direction",
                    })}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.counterparty", {
                      defaultValue: "Counterparty",
                    })}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.amount")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.token")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.chain")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.status")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.memo")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.tx")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reportData.items.map((item) => (
                  <tr key={item.rowId} className="hover:bg-navy-800/50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-white">
                      {new Date(item.createdAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <DirectionBadge direction={item.direction} />
                    </td>
                    <td className="px-4 py-3 text-sm text-white">
                      <div>
                        <p className="text-white">{item.beneficiaryName}</p>
                        {item.beneficiaryWallet && (
                          <p className="text-xs text-slate-500 font-mono">
                            {item.beneficiaryWallet.slice(0, 6)}...
                            {item.beneficiaryWallet.slice(-4)}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-white">
                      {formatAssetAmount(item.amount, item.token, false)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-300">
                      {item.token}
                      {!item.includedInTotals && (
                        <>
                          <span className="block max-w-[10rem] whitespace-normal text-xs leading-4">
                            {item.transferMatch === 'pending' ? 'Transfer match pending · excluded' : 'Unverified · excluded'}
                          </span>
                          {item.transferMatch !== 'pending' && <AssetDetails
                            tokenAddress={item.tokenAddress}
                            accountAddress={item.accountAddress}
                          />}
                        </>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-400">
                      {item.chainId != null ? getChainName(item.chainId) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td
                      className="max-w-[200px] truncate px-4 py-3 text-sm text-slate-400"
                      title={item.memo || ""}
                    >
                      {item.memo || "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {item.txHash &&
                      chainEnvironment(item.chainId) !== "unclassified" ? (
                        <a
                          href={
                            item.chainId != null
                              ? getBlockExplorerTxUrl(item.chainId, item.txHash)
                              : `https://etherscan.io/tx/${item.txHash}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-accent-400 hover:text-accent-300"
                        >
                          {t("reports.table.view")}
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden space-y-3">
            {reportData.items.map((item) => (
              <div
                key={item.rowId}
                className="rounded-xl border border-white/10 bg-navy-900/50 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-white">
                      {item.beneficiaryName}
                    </p>
                    {item.beneficiaryWallet && (
                      <p className="text-xs text-slate-500 font-mono">
                        {item.beneficiaryWallet.slice(0, 6)}...
                        {item.beneficiaryWallet.slice(-4)}
                      </p>
                    )}
                    <p className="text-sm text-slate-400">
                      {new Date(item.createdAt).toLocaleDateString(undefined, { timeZone: 'UTC' })} UTC
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <DirectionBadge direction={item.direction} />
                    <StatusBadge status={item.status} />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="text-lg font-bold text-white">
                    {formatAssetAmount(item.amount, item.token, false)} {item.token}
                    {!item.includedInTotals && (
                      <>
                        <span className="block text-xs">
                          {item.transferMatch === 'pending' ? 'Transfer match pending · excluded from totals' : 'Unverified · excluded from totals'}
                        </span>
                        {item.transferMatch !== 'pending' && <AssetDetails
                          tokenAddress={item.tokenAddress}
                          accountAddress={item.accountAddress}
                        />}
                      </>
                    )}
                    {item.chainId != null && (
                      <span className="workspace-status ml-2">
                        {getChainName(item.chainId)}
                      </span>
                    )}
                  </div>
                  {item.txHash &&
                    chainEnvironment(item.chainId) !== "unclassified" && (
                      <a
                        href={
                          item.chainId != null
                            ? getBlockExplorerTxUrl(item.chainId, item.txHash)
                            : `https://etherscan.io/tx/${item.txHash}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-accent-400"
                      >
                        {t("reports.table.view")}
                        <ArrowUpRight className="h-3 w-3" />
                      </a>
                    )}
                </div>
                {item.memo && (
                  <p className="mt-2 text-sm text-slate-400">{item.memo}</p>
                )}
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-slate-400">
                {t("reports.summary.showing", {
                  count: reportData.items.length,
                })}
              </span>
              <span className="text-slate-600">|</span>
              <strong className="w-full">{reportData.indexing ? 'Totals are still being prepared' : 'Totals for all matching activity'}</strong>
              {!reportData.indexing && reportData.totals.map((total) => (
                <div
                  key={total.assetId}
                  className="flex flex-wrap gap-x-4 gap-y-2 tabular-nums"
                >
                  <strong className="w-full">
                    {total.token} · {total.network}
                  </strong>
                  <span>
                    Inflow: {formatAssetAmount(total.inflow, total.token, false)}{" "}
                    {total.token}
                  </span>
                  <span>
                    Outflow: {formatAssetAmount(total.outflow, total.token, false)}{" "}
                    {total.token}
                  </span>
                  <span>
                    Net change: {formatAssetAmount(total.net, total.token, false)}{" "}
                    {total.token}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Spending by Beneficiary Tab
// ============================================================================
