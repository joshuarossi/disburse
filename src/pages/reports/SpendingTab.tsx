import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Id } from '../../../convex/_generated/dataModel';
import { api } from '../../../convex/_generated/api';
import { getSessionToken } from '@/lib/session';
import { CHAINS_LIST } from '@/lib/chains';
import { exportToCsv, generateFilename } from '@/lib/csv';
import { ChevronDown, ChevronUp, Download, Filter, Loader2, Users, X } from 'lucide-react';

interface SpendingTabProps {
  orgId: string | undefined;
  address: string | undefined;
}

export function SpendingTab({ orgId, address }: SpendingTabProps) {
  const { t } = useTranslation();

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [chainFilter, setChainFilter] = useState<number | ''>('');

  // Sort state
  const [sortBy, setSortBy] = useState<'name' | 'totalPaid' | 'transactionCount'>('totalPaid');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const TYPE_OPTIONS = [
    { value: '', label: t('common.all') },
    { value: 'individual', label: t('beneficiaries.individual') },
    { value: 'business', label: t('beneficiaries.business') },
  ];

  // Query args
  const queryArgs = useMemo(() => {
    if (!orgId || !address) return null;
    const type: 'individual' | 'business' | undefined = 
      typeFilter === 'individual' || typeFilter === 'business' ? typeFilter : undefined;
    return {
      orgId: orgId as Id<'orgs'>,
      sessionToken: getSessionToken() ?? "",
      startDate: dateFrom ? new Date(dateFrom).getTime() : undefined,
      endDate: dateTo ? new Date(dateTo).getTime() : undefined,
      type,
      chainId: chainFilter !== '' ? chainFilter : undefined,
    };
  }, [orgId, address, dateFrom, dateTo, typeFilter, chainFilter]);

  const reportData = useQuery(
    api.reports.getSpendingByBeneficiary,
    queryArgs ?? 'skip'
  );

  const isLoading = reportData === undefined;
  const activeFilterCount = [dateFrom || dateTo, typeFilter, chainFilter !== ''].filter(Boolean).length;

  const aggregatedData = useMemo(() => {
    if (!reportData) return [];

    const grouped = new Map<string, {
      beneficiaryId: string;
      beneficiaryName: string;
      beneficiaryType: string;
      beneficiaryWallet: string;
      transactionCount: number;
      totalsByToken: Map<string, number>;
    }>();

    reportData.forEach((item) => {
      const key = item.beneficiaryId;
      const existing = grouped.get(key);
      if (existing) {
        existing.transactionCount += item.transactionCount;
        const currentTotal = existing.totalsByToken.get(item.token) || 0;
        existing.totalsByToken.set(item.token, currentTotal + Number(item.totalPaid));
      } else {
        const totalsByToken = new Map<string, number>();
        totalsByToken.set(item.token, Number(item.totalPaid));
        grouped.set(key, {
          beneficiaryId: item.beneficiaryId,
          beneficiaryName: item.beneficiaryName,
          beneficiaryType: item.beneficiaryType,
          beneficiaryWallet: item.beneficiaryWallet,
          transactionCount: item.transactionCount,
          totalsByToken,
        });
      }
    });

    return Array.from(grouped.values()).map((group) => {
      const totals = Array.from(group.totalsByToken.entries()).map(([token, amount]) => ({
        token,
        amount,
      }));
      const totalPaidNumeric = totals.reduce((sum, entry) => sum + entry.amount, 0);
      const totalPaidDisplay = totals
        .map((entry) => `${entry.amount.toFixed(2)} ${entry.token}`)
        .join(' · ');

      return {
        beneficiaryId: group.beneficiaryId,
        beneficiaryName: group.beneficiaryName,
        beneficiaryType: group.beneficiaryType,
        beneficiaryWallet: group.beneficiaryWallet,
        transactionCount: group.transactionCount,
        totals,
        totalPaidNumeric,
        totalPaidDisplay,
        tokensDisplay: totals.map((entry) => entry.token).join(', '),
      };
    });
  }, [reportData]);

  // Sort data client-side
  const sortedData = useMemo(() => {
    if (!aggregatedData.length) return [];
    const sorted = [...aggregatedData];
    sorted.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.beneficiaryName.localeCompare(b.beneficiaryName);
      } else if (sortBy === 'totalPaid') {
        comparison = a.totalPaidNumeric - b.totalPaidNumeric;
      } else if (sortBy === 'transactionCount') {
        comparison = a.transactionCount - b.transactionCount;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [aggregatedData, sortBy, sortOrder]);

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setTypeFilter('');
    setChainFilter('');
  };

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const handleExport = () => {
    if (!sortedData.length) return;

    const columns = [
      { key: 'beneficiary', label: t('reports.export.beneficiary') },
      { key: 'type', label: t('reports.export.type') },
      { key: 'walletAddress', label: t('reports.export.walletAddress') },
      { key: 'transactions', label: t('reports.export.transactions') },
      { key: 'totalPaid', label: t('reports.export.totalPaid') },
      { key: 'token', label: t('reports.export.token') },
    ];

    const rows = sortedData.map((item) => ({
      beneficiary: item.beneficiaryName,
      type: item.beneficiaryType,
      walletAddress: item.beneficiaryWallet,
      transactions: item.transactionCount,
      totalPaid: item.totalPaidDisplay,
      token: item.tokensDisplay,
    }));

    exportToCsv(generateFilename('spending_by_beneficiary'), rows, columns);
  };

  const SortIcon = ({ field }: { field: typeof sortBy }) => {
    if (sortBy !== field) return null;
    return sortOrder === 'asc' ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
            activeFilterCount > 0
              ? 'border-accent-500/50 bg-accent-500/10 text-accent-400'
              : 'border-white/10 text-slate-400 hover:bg-navy-800 hover:text-white'
          )}
        >
          <Filter className="h-4 w-4" />
          {t('common.filters')}
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
            {t('common.clearAll')}
          </button>
        )}

        <div className="ml-auto">
          <Button
            onClick={handleExport}
            disabled={isLoading || !sortedData.length}
            variant="secondary"
            size="sm"
          >
            <Download className="mr-2 h-4 w-4" />
            {t('reports.export.csv')}
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
                {t('reports.filters.dateRange')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
                />
                <span className="text-slate-500">{t('disbursements.filters.to')}</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            {/* Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t('reports.filters.type')}
              </label>
              <select
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
                {t('reports.filters.chain')}
              </label>
              <select
                value={chainFilter === '' ? '' : chainFilter}
                onChange={(e) => setChainFilter(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
              >
                <option value="">{t('common.all')}</option>
                {CHAINS_LIST.map((c) => (
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
          <h3 className="mt-4 text-lg font-medium text-white">{t('reports.empty.spending.title')}</h3>
          <p className="mt-2 text-slate-400">{t('reports.empty.spending.description')}</p>
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
                    onClick={() => handleSort('name')}
                  >
                    <span className="flex items-center gap-1">
                      {t('reports.table.beneficiary')}
                      <SortIcon field="name" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.type')}
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400 hover:text-white"
                    onClick={() => handleSort('transactionCount')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      {t('reports.table.transactions')}
                      <SortIcon field="transactionCount" />
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400 hover:text-white"
                    onClick={() => handleSort('totalPaid')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      {t('reports.table.totalPaid')}
                      <SortIcon field="totalPaid" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sortedData.map((item) => (
                  <tr key={item.beneficiaryId} className="hover:bg-navy-800/50">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-white">{item.beneficiaryName}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          {item.beneficiaryWallet.slice(0, 6)}...{item.beneficiaryWallet.slice(-4)}
                        </p>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        item.beneficiaryType === 'individual'
                          ? 'bg-blue-500/10 text-blue-400'
                          : 'bg-purple-500/10 text-purple-400'
                      )}>
                        {item.beneficiaryType === 'individual'
                          ? t('beneficiaries.individual')
                          : t('beneficiaries.business')}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-slate-300">
                      {item.transactionCount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-white">
                      {item.totalPaidDisplay}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden space-y-3">
            {sortedData.map((item) => (
              <div key={item.beneficiaryId} className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-white">{item.beneficiaryName}</p>
                    <p className="text-xs text-slate-500 font-mono">
                      {item.beneficiaryWallet.slice(0, 6)}...{item.beneficiaryWallet.slice(-4)}
                    </p>
                  </div>
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                    item.beneficiaryType === 'individual'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-purple-500/10 text-purple-400'
                  )}>
                    {item.beneficiaryType === 'individual'
                      ? t('beneficiaries.individual')
                      : t('beneficiaries.business')}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-slate-400">
                    {item.transactionCount} {t('reports.table.transactions').toLowerCase()}
                  </span>
                  <span className="text-lg font-bold text-white">
                    {item.totalPaidDisplay}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
            <p className="text-sm text-slate-400">
              {t('reports.summary.beneficiaries', { count: sortedData.length })}
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

