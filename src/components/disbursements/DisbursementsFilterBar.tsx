import { Button } from '@/components/ui/button';
import { Calendar, Filter, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CHAINS_LIST } from '@/lib/chains';

const STATUS_VALUES = [
  'draft',
  'pending',
  'proposed',
  'scheduled',
  'relaying',
  'executed',
  'failed',
  'cancelled',
] as const;

// Extracted verbatim from src/pages/Disbursements.tsx (M-04 decomposition).

interface DisbursementsFilterBarProps {
  search: string;
  handleSearchChange: (value: string) => void;
  showFilters: boolean;
  setShowFilters: (v: boolean) => void;
  statusFilter: string[];
  toggleStatus: (status: string) => void;
  filterTokenOptions: Array<{ value: string; label: string }>;
  tokenFilter: string;
  handleTokenFilterChange: (value: string) => void;
  chainFilter: number | '';
  handleChainFilterChange: (value: number | '') => void;
  dateFrom: string;
  handleDateFromChange: (value: string) => void;
  dateTo: string;
  handleDateToChange: (value: string) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean | string;
  safes: Array<{ chainId: number }> | undefined;
}

export function DisbursementsFilterBar({
  search,
  handleSearchChange,
  showFilters,
  setShowFilters,
  statusFilter,
  toggleStatus,
  filterTokenOptions,
  tokenFilter,
  handleTokenFilterChange,
  chainFilter,
  handleChainFilterChange,
  dateFrom,
  handleDateFromChange,
  dateTo,
  handleDateToChange,
  clearFilters,
  hasActiveFilters,
  safes,
}: DisbursementsFilterBarProps) {
  const { t } = useTranslation();

  const statusOptions = STATUS_VALUES.map((value) => ({
    value,
    // Same i18n keys the inline STATUS_OPTIONS used before extraction
    label: t(`status.${value}`),
  }));

  return (
    <>
              <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t('disbursements.searchPlaceholder')}
                className="w-full rounded-lg border border-white/10 bg-navy-800 pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
            </div>

            <div className="flex items-center gap-2">
              {/* Filter Toggle */}
              <Button
                variant="secondary"
                onClick={() => setShowFilters(!showFilters)}
                className={cn("h-11", hasActiveFilters ? 'border-accent-500' : '')}
              >
                <Filter className="h-4 w-4" />
                <span className="hidden sm:inline">{t('common.filters')}</span>
                {hasActiveFilters && (
                  <span className="ml-1 rounded-full bg-accent-500 px-1.5 py-0.5 text-xs text-white">
                    {(statusFilter.length > 0 ? 1 : 0) + (tokenFilter ? 1 : 0) + (chainFilter !== '' ? 1 : 0) + (dateFrom || dateTo ? 1 : 0)}
                  </span>
                )}
              </Button>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button variant="ghost" onClick={clearFilters} className="h-11 text-slate-400 hover:text-white">
                  {t('common.clearAll')}
                </Button>
              )}
            </div>
          </div>

          {/* Expanded Filters */}
          {showFilters && (
            <div className="rounded-xl border border-white/10 bg-navy-900/50 p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Status Filter */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    {t('disbursements.filters.status')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {statusOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => toggleStatus(option.value)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          statusFilter.includes(option.value)
                            ? 'bg-accent-500 text-white'
                            : 'bg-navy-800 text-slate-400 hover:bg-navy-700 hover:text-white'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Token Filter */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Token
                  </label>
                  <select
                    value={tokenFilter}
                    onChange={(e) => handleTokenFilterChange(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  >
                    {filterTokenOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Chain Filter */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    {t('disbursements.filters.chain', { defaultValue: 'Chain' })}
                  </label>
                  <select
                    value={chainFilter}
                    onChange={(e) => handleChainFilterChange(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  >
                    <option value="">{t('common.all')}</option>
                    {CHAINS_LIST.map((c) => (
                      <option key={c.chainId} value={c.chainId}>
                        {c.chainName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Range */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    <Calendar className="inline h-4 w-4 mr-1" />
                    {t('disbursements.filters.dateRange')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => handleDateFromChange(e.target.value)}
                      className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    />
                    <span className="text-slate-500">{t('disbursements.filters.to')}</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => handleDateToChange(e.target.value)}
                      className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {safes && safes.length === 0 && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-400">
            {t('disbursements.noSafeWarning')}
          </div>
        )}
    </>
  );
}
