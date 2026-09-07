import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { chainEnvironment } from "../../../shared/assets";
import { useMemo, useState, useEffect, useRef } from "react";
import { parseUnits } from "viem";
import { formatAssetAmount } from "@/lib/formatMoney";
import { useQuery, useConvex } from "convex/react";
import { ReportProgress } from './ReportProgress';
import { useReportPages } from './useReportPages';
import { collectReportExport } from './reportExport';
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { getSessionToken } from "@/lib/session";
import { CHAINS_LIST } from "@/lib/chains";
import { exportToCsv, generateFilename } from "@/lib/csv";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  Loader2,
  Users,
  X,
} from "lucide-react";

interface SpendingTabProps {
  orgId: string | undefined;
  address: string | undefined;
}

export function SpendingTab({ orgId, address }: SpendingTabProps) {
  const { t } = useTranslation();
  const client = useConvex();
  const [exportError, setExportError] = useState('');
  const [exportCount, setExportCount] = useState<number | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const { environment } = useActivityEnvironment();

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [chainFilter, setChainFilter] = useState<number | "">("");

  // Sort state
  const [sortBy, setSortBy] = useState<
    "name" | "totalPaid" | "transactionCount"
  >("totalPaid");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const TYPE_OPTIONS = [
    { value: "", label: t("common.all") },
    { value: "individual", label: t("beneficiaries.individual") },
    { value: "business", label: t("beneficiaries.business") },
  ];

  // Query args
  const queryArgs = useMemo(() => {
    if (!orgId || !address) return null;
    const type: "individual" | "business" | undefined =
      typeFilter === "individual" || typeFilter === "business"
        ? typeFilter
        : undefined;
    return {
      orgId: orgId as Id<"orgs">,
      sessionToken: getSessionToken() ?? "",
      environment,
      startDate: dateFrom ? new Date(dateFrom).getTime() : undefined,
      endDate: dateTo ? new Date(dateTo).getTime() : undefined,
      type,
      chainId: chainFilter !== "" ? chainFilter : undefined,
    };
  }, [orgId, address, dateFrom, dateTo, typeFilter, chainFilter, environment]);

  const pages = useReportPages(queryArgs);
  useEffect(() => () => { exportController.current?.abort(); }, [queryArgs]);
  const reportData = useQuery(
    api.reports.getSpendingByBeneficiary,
    queryArgs ? { ...queryArgs, cursor: pages.cursor } : "skip",
  );

  const isLoading = reportData === undefined;
  const activeFilterCount = [
    dateFrom || dateTo,
    typeFilter,
    chainFilter !== "",
  ].filter(Boolean).length;

  // Keep a separate row per recipient and contract/network, as the server does.
  const aggregatedData = useMemo(
    () =>
      (reportData?.items ?? []).map((item) => ({
        ...item,
        rowId: `${item.beneficiaryId}:${item.assetId}`,
        totalPaidNumeric: parseUnits(item.totalPaid, 18),
        totalPaidDisplay: `${formatAssetAmount(item.totalPaid, item.token, false)} ${item.token}`,
      })),
    [reportData],
  );

  // Sort data client-side
  const sortedData = useMemo(() => {
    if (!aggregatedData.length) return [];
    const sorted = [...aggregatedData];
    sorted.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") {
        comparison = a.beneficiaryName.localeCompare(b.beneficiaryName);
      } else if (sortBy === "totalPaid") {
        comparison =
          a.totalPaidNumeric < b.totalPaidNumeric
            ? -1
            : a.totalPaidNumeric > b.totalPaidNumeric
              ? 1
              : 0;
      } else if (sortBy === "transactionCount") {
        comparison = a.transactionCount - b.transactionCount;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [aggregatedData, sortBy, sortOrder]);

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setTypeFilter("");
    setChainFilter("");
  };

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  const handleExport = async () => {
    if (!queryArgs || exportCount !== null) return;
    const controller = new AbortController(); exportController.current = controller;
    setExportError(''); setExportCount(0);
    try {
    const items = await collectReportExport((cursor, snapshotVersion) => client.query(api.reports.getSpendingByBeneficiary, { ...queryArgs, cursor, snapshotVersion }), { signal: controller.signal, progress: setExportCount });

    const columns = [
      { key: "beneficiary", label: t("reports.export.beneficiary") },
      { key: "type", label: t("reports.export.type") },
      { key: "walletAddress", label: t("reports.export.walletAddress") },
      { key: "transactions", label: t("reports.export.transactions") },
      { key: "totalPaid", label: t("reports.export.totalPaid") },
      { key: "token", label: t("reports.export.token") },
      { key: "network", label: "Network" },
      { key: "chainId", label: "Network ID" },
      { key: "tokenAddress", label: "Token contract" },
      { key: "environment", label: "Environment" },
    ];

    const rows = items.map((item) => ({
      beneficiary: item.beneficiaryName,
      type: item.beneficiaryType,
      walletAddress: item.beneficiaryWallet,
      transactions: item.transactionCount,
      totalPaid: item.totalPaid,
      token: item.token,
      network: item.network,
      chainId: item.chainId ?? "",
      tokenAddress: item.tokenAddress ?? "",
      environment: item.environment,
    }));

    exportToCsv(
      generateFilename(`spending_by_beneficiary_${environment}`),
      rows,
      columns,
    );
    } catch (error) { setExportError(error instanceof Error ? error.message : 'The export could not be completed. Try again.'); }
    finally { setExportCount(null); exportController.current = null; }
  };

  const SortIcon = ({ field }: { field: typeof sortBy }) => {
    if (sortBy !== field) return null;
    return sortOrder === "asc" ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    );
  };

  return (
    <div className="space-y-4">
      <ReportProgress orgId={orgId} data={reportData} page={pages.page} previous={pages.previous} next={pages.next} />
      {exportError && <div className="workspace-notice" role="alert" data-tone="error">{exportError}</div>}
      {exportCount !== null && <div className="workspace-notice" role="status"><span>Preparing export · {exportCount} recipients and currencies</span><button className="workspace-button" onClick={() => exportController.current?.abort()}>Cancel export</button></div>}
      <p className="text-sm text-slate-400">Each recipient’s total covers the selected dates. Sorting applies to this page.</p>
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
            activeFilterCount > 0
              ? "workspace-filter-active"
              : "border-white/10 text-slate-400 hover:bg-navy-800 hover:text-white",
          )}
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
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Date Range */}
            <div className="space-y-2">
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
                <span className="text-slate-500">
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

            {/* Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t("reports.filters.type")}
              </label>
              <select
                aria-label={t("reports.filters.type")}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Chain */}
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
          </div>
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
        </div>
      ) : !sortedData.length ? (
        <div className="rounded-xl border border-dashed border-white/20 bg-navy-900/30 p-12 text-center">
          <Users className="mx-auto h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-white">
            {reportData?.isDone === false ? "No matches on this page" : t("reports.empty.spending.title")}
          </h3>
          <p className="mt-2 text-slate-400">
            {reportData?.isDone === false ? "Continue to the next page or adjust the filters." : t("reports.empty.spending.description")}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-hidden rounded-xl border border-white/10">
            <table className="w-full">
              <thead className="bg-navy-900/50">
                <tr>
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 hover:text-white"
                    onClick={() => handleSort("name")}
                  >
                    <span className="flex items-center gap-1">
                      {t("reports.table.beneficiary")}
                      <SortIcon field="name" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.type")}
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400 hover:text-white"
                    onClick={() => handleSort("transactionCount")}
                  >
                    <span className="flex items-center justify-end gap-1">
                      {t("reports.table.transactions")}
                      <SortIcon field="transactionCount" />
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400 hover:text-white"
                    onClick={() => handleSort("totalPaid")}
                  >
                    <span className="flex items-center justify-end gap-1">
                      {t("reports.table.totalPaid")}
                      <SortIcon field="totalPaid" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sortedData.map((item) => (
                  <tr key={item.rowId} className="hover:bg-navy-800/50">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-white">
                          {item.beneficiaryName}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                          {item.beneficiaryWallet.slice(0, 6)}...
                          {item.beneficiaryWallet.slice(-4)}
                        </p>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                          item.beneficiaryType === "individual"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-purple-500/10 text-purple-400",
                        )}
                      >
                        {item.beneficiaryType === "individual"
                          ? t("beneficiaries.individual")
                          : t("beneficiaries.business")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-slate-300">
                      {item.transactionCount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-white">
                      {item.totalPaidDisplay}
                      <span className="block text-xs font-normal text-slate-400">
                        {item.network}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden space-y-3">
            {sortedData.map((item) => (
              <div
                key={item.rowId}
                className="rounded-xl border border-white/10 bg-navy-900/50 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-white">
                      {item.beneficiaryName}
                    </p>
                    <p className="text-xs text-slate-500 font-mono">
                      {item.beneficiaryWallet.slice(0, 6)}...
                      {item.beneficiaryWallet.slice(-4)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                      item.beneficiaryType === "individual"
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-purple-500/10 text-purple-400",
                    )}
                  >
                    {item.beneficiaryType === "individual"
                      ? t("beneficiaries.individual")
                      : t("beneficiaries.business")}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-slate-400">
                    {item.transactionCount}{" "}
                    {t("reports.table.transactions").toLowerCase()}
                  </span>
                  <span className="text-lg font-bold text-white">
                    {item.totalPaidDisplay}
                    <span className="block text-xs font-normal text-slate-400">
                      {item.network}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
            <p className="text-sm text-slate-400">
              {t("reports.summary.beneficiaries", {
                count: new Set(sortedData.map((item) => item.beneficiaryId))
                  .size,
              })}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Audit Log Tab
// ============================================================================
