import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { getSessionToken } from "@/lib/session";
import { exportToCsv, generateFilename } from "@/lib/csv";
import { ClipboardList, Download, Filter, Loader2, X } from "lucide-react";

interface AuditLogTabProps {
  orgId: string | undefined;
  address: string | undefined;
}

export function AuditLogTab({ orgId, address }: AuditLogTabProps) {
  const { t } = useTranslation();

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState<string[]>([]);

  const ACTION_CATEGORIES = [
    {
      category: t("reports.auditActions.disbursement"),
      actions: [
        "disbursement.created",
        "disbursement.pending",
        "disbursement.proposed",
        "disbursement.executed",
        "disbursement.failed",
        "disbursement.cancelled",
      ],
    },
    {
      category: t("reports.auditActions.beneficiary"),
      actions: ["beneficiary.created", "beneficiary.updated"],
    },
    {
      category: t("reports.auditActions.team"),
      actions: ["member.invited", "member.roleUpdated", "member.removed"],
    },
    {
      category: t("reports.auditActions.safe"),
      actions: ["safe.linked", "safe.unlinked"],
    },
    {
      category: t("reports.auditActions.org"),
      actions: ["org.created", "org.updated"],
    },
  ];

  // Query args
  const queryArgs = useMemo(() => {
    if (!orgId || !address) return null;
    return {
      orgId: orgId as Id<"orgs">,
      sessionToken: getSessionToken() ?? "",
      startDate: dateFrom ? new Date(dateFrom).getTime() : undefined,
      endDate: dateTo ? new Date(dateTo).getTime() : undefined,
      userId: userFilter ? (userFilter as Id<"users">) : undefined,
      actionType: actionFilter.length > 0 ? actionFilter : undefined,
    };
  }, [orgId, address, dateFrom, dateTo, userFilter, actionFilter]);

  const reportData = useQuery(api.audit.list, queryArgs ?? "skip");

  const members = useQuery(
    api.orgs.listMembers,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<"orgs">, sessionToken: getSessionToken() ?? "" }
      : "skip",
  );

  const isLoading = reportData === undefined;
  const activeFilterCount = [
    dateFrom || dateTo,
    userFilter,
    actionFilter.length > 0,
  ].filter(Boolean).length;

  const toggleAction = (action: string) => {
    setActionFilter((prev) =>
      prev.includes(action)
        ? prev.filter((a) => a !== action)
        : [...prev, action],
    );
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setUserFilter("");
    setActionFilter([]);
  };

  const handleExport = () => {
    if (!reportData?.length) return;

    const columns = [
      { key: "timestamp", label: t("reports.export.timestamp") },
      { key: "user", label: t("reports.export.user") },
      { key: "wallet", label: t("reports.export.wallet") },
      { key: "action", label: t("reports.export.action") },
      { key: "details", label: t("reports.export.details") },
    ];

    const rows = reportData.map((item) => ({
      timestamp: new Date(item.timestamp).toLocaleString(),
      user: item.actor?.walletAddress || "System",
      wallet: item.actor?.walletAddress || "",
      action: formatAction(item.action),
      details: formatDetails(item),
    }));

    exportToCsv(generateFilename("audit_log"), rows, columns);
  };

  const formatAction = (action: string): string => {
    const parts = action.split(".");
    if (parts.length === 2) {
      return `${parts[0].charAt(0).toUpperCase() + parts[0].slice(1)} ${parts[1].charAt(0).toUpperCase() + parts[1].slice(1)}`;
    }
    return action;
  };

  const formatDetails = (item: {
    objectType: string;
    objectId: string;
    metadata?: unknown;
  }): string => {
    const meta = item.metadata as Record<string, unknown> | undefined;
    if (meta?.beneficiaryName) return `Beneficiary: ${meta.beneficiaryName}`;
    if (meta?.memberName) return `Member: ${meta.memberName}`;
    if (meta?.safeAddress) return `Safe: ${meta.safeAddress}`;
    return `${item.objectType}: ${item.objectId}`;
  };

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
            activeFilterCount > 0
              ? "border-accent-500/50 bg-accent-500/10 text-accent-400"
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
            onClick={handleExport}
            disabled={isLoading || !reportData?.length}
            variant="secondary"
            size="sm"
          >
            <Download className="mr-2 h-4 w-4" />
            {t("reports.export.csv")}
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

            {/* User */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t("reports.filters.user")}
              </label>
              <select
                aria-label={t("reports.filters.user")}
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
              >
                <option value="">{t("reports.filters.allUsers")}</option>
                {members?.map((m) => {
                  if (!m) return null;
                  return (
                    <option key={m.userId} value={m.userId}>
                      {m.name || m.walletAddress?.slice(0, 10) + "..."}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Action Type */}
            <div className="space-y-2 sm:col-span-2 lg:col-span-1">
              <label className="text-sm font-medium text-slate-300">
                {t("reports.filters.actionType")}
              </label>
              <div className="space-y-2">
                {ACTION_CATEGORIES.map((cat) => (
                  <div key={cat.category}>
                    <p className="text-xs text-slate-500 mb-1">
                      {cat.category}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {cat.actions.map((action) => (
                        <button
                          key={action}
                          onClick={() => toggleAction(action)}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                            actionFilter.includes(action)
                              ? "bg-accent-500/20 text-accent-400"
                              : "bg-navy-800 text-slate-400 hover:text-white",
                          )}
                        >
                          {action.split(".")[1]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
        </div>
      ) : !reportData?.length ? (
        <div className="rounded-xl border border-dashed border-white/20 bg-navy-900/30 p-12 text-center">
          <ClipboardList className="mx-auto h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-white">
            {t("reports.empty.audit.title")}
          </h3>
          <p className="mt-2 text-slate-400">
            {t("reports.empty.audit.description")}
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
                    {t("reports.table.timestamp")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.user")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.action")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t("reports.table.details")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reportData.map((item) => (
                  <tr key={item._id} className="hover:bg-navy-800/50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-white">
                      {new Date(item.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <p className="font-mono text-xs text-slate-300">
                        {item.actor?.walletAddress
                          ? `${item.actor.walletAddress.slice(0, 6)}...${item.actor.walletAddress.slice(-4)}`
                          : "System"}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-navy-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                        {formatAction(item.action)}
                      </span>
                    </td>
                    <td className="max-w-[300px] truncate px-4 py-3 text-sm text-slate-400">
                      {formatDetails(item)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden space-y-3">
            {reportData.map((item) => (
              <div
                key={item._id}
                className="rounded-xl border border-white/10 bg-navy-900/50 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="inline-flex items-center rounded-full bg-navy-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                      {formatAction(item.action)}
                    </span>
                    <p className="mt-2 text-sm text-slate-400">
                      {formatDetails(item)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono">
                    {item.actor?.walletAddress
                      ? `${item.actor.walletAddress.slice(0, 6)}...${item.actor.walletAddress.slice(-4)}`
                      : "System"}
                  </span>
                  <span>{new Date(item.timestamp).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
            <p className="text-sm text-slate-400">
              {t("reports.summary.events", { count: reportData.length })}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Shared Components
// ============================================================================
