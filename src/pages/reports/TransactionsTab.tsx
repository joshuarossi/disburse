import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Id } from '../../../convex/_generated/dataModel';
import { api } from '../../../convex/_generated/api';
import { getSessionToken } from '@/lib/session';
import { getChainName, getBlockExplorerTxUrl, CHAINS_LIST } from '@/lib/chains';
import { exportToCsv, generateFilename } from '@/lib/csv';
import { useQuery, useAction } from 'convex/react';
import { ArrowUpRight, Download, FileText, Filter, Loader2, X } from 'lucide-react';
import { StatusBadge, DirectionBadge } from './badges';

interface TransactionsTabProps {
  orgId: string | undefined;
  address: string | undefined;
}

export function TransactionsTab({ orgId, address }: TransactionsTabProps) {
  const { t } = useTranslation();
  const syncDeposits = useAction(api.deposits.syncForOrg);
  const hasSyncedDeposits = useRef(false);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tokenFilter, setTokenFilter] = useState<string[]>([]);
  const [chainFilter, setChainFilter] = useState<number | ''>('');
  const [beneficiaryFilter, setBeneficiaryFilter] = useState('');

  const STATUS_OPTIONS = [
    { value: 'executed', label: t('status.executed') },
    { value: 'received', label: t('status.received', { defaultValue: 'Received' }) },
  ];

  const TOKEN_OPTIONS = [
    { value: 'USDC', label: 'USDC' },
    { value: 'USDT', label: 'USDT' },
  ];

  // Query args
  const queryArgs = useMemo(() => {
    if (!orgId || !address) return null;
    return {
      orgId: orgId as Id<'orgs'>,
      sessionToken: getSessionToken() ?? "",
      startDate: dateFrom ? new Date(dateFrom).getTime() : undefined,
      endDate: dateTo ? new Date(dateTo).getTime() : undefined,
      status: statusFilter.length > 0 ? statusFilter : undefined,
      token: tokenFilter.length > 0 ? tokenFilter : undefined,
      chainId: chainFilter !== '' ? chainFilter : undefined,
      beneficiaryId: beneficiaryFilter ? beneficiaryFilter as Id<'beneficiaries'> : undefined,
    };
  }, [orgId, address, dateFrom, dateTo, statusFilter, tokenFilter, chainFilter, beneficiaryFilter]);

  const reportData = useQuery(
    api.reports.getTransactionReport,
    queryArgs ?? 'skip'
  );

  const beneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<'orgs'>, sessionToken: getSessionToken() ?? "", activeOnly: false }
      : 'skip'
  );

  useEffect(() => {
    if (!orgId || !address) return;
    if (hasSyncedDeposits.current) return;
    hasSyncedDeposits.current = true;
    void syncDeposits({ orgId: orgId as Id<'orgs'>, sessionToken: getSessionToken() ?? "" }).catch(() => {
      hasSyncedDeposits.current = true;
    });
  }, [address, orgId, syncDeposits]);

  const isLoading = reportData === undefined;
  const activeFilterCount = [
    dateFrom || dateTo,
    statusFilter.length > 0,
    tokenFilter.length > 0,
    chainFilter !== '',
    beneficiaryFilter,
  ].filter(Boolean).length;

  const toggleStatus = (status: string) => {
    setStatusFilter((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  const toggleToken = (token: string) => {
    setTokenFilter((prev) =>
      prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token]
    );
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setStatusFilter([]);
    setTokenFilter([]);
    setChainFilter('');
    setBeneficiaryFilter('');
  };

  const handleExport = () => {
    if (!reportData?.items) return;

    const columns = [
      { key: 'date', label: t('reports.export.date') },
      { key: 'direction', label: t('reports.export.direction', { defaultValue: 'Direction' }) },
      { key: 'beneficiary', label: t('reports.export.beneficiary', { defaultValue: 'Counterparty' }) },
      { key: 'walletAddress', label: t('reports.export.walletAddress', { defaultValue: 'Wallet Address' }) },
      { key: 'amount', label: t('reports.export.amount') },
      { key: 'token', label: t('reports.export.token') },
      { key: 'chain', label: t('reports.export.chain') },
      { key: 'status', label: t('reports.export.status') },
      { key: 'memo', label: t('reports.export.memo') },
      { key: 'txHash', label: t('reports.export.txHash') },
    ];

    const rows = reportData.items.map((item) => ({
      date: new Date(item.createdAt).toLocaleDateString(),
      direction: item.direction === 'inflow' ? t('reports.direction.inflow', { defaultValue: 'Inflow' }) : t('reports.direction.outflow', { defaultValue: 'Outflow' }),
      beneficiary: item.beneficiaryName,
      walletAddress: item.beneficiaryWallet,
      amount: item.amount,
      token: item.token,
      chain: item.chainId != null ? getChainName(item.chainId) : '',
      status: item.status,
      memo: item.memo || '',
      txHash: item.txHash || '',
    }));

    exportToCsv(generateFilename('transactions'), rows, columns);
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
            disabled={isLoading || !reportData?.items?.length}
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
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            {/* Date Range - spans 2 columns on larger screens to accommodate two inputs */}
            <div className="space-y-2 md:col-span-2 lg:col-span-2">
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
                <span className="text-slate-500 whitespace-nowrap">{t('disbursements.filters.to')}</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t('reports.filters.status')}
              </label>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleStatus(opt.value)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      statusFilter.includes(opt.value)
                        ? 'bg-accent-500/20 text-accent-400'
                        : 'bg-navy-800 text-slate-400 hover:text-white'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Token */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t('reports.filters.token')}
              </label>
              <div className="flex gap-2">
                {TOKEN_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleToken(opt.value)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      tokenFilter.includes(opt.value)
                        ? 'bg-accent-500/20 text-accent-400'
                        : 'bg-navy-800 text-slate-400 hover:text-white'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
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

            {/* Beneficiary */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t('reports.filters.beneficiary')}
              </label>
              <select
                value={beneficiaryFilter}
                onChange={(e) => setBeneficiaryFilter(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
              >
                <option value="">{t('reports.filters.allBeneficiaries')}</option>
                {beneficiaries?.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
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
          <h3 className="mt-4 text-lg font-medium text-white">{t('reports.empty.transactions.title')}</h3>
          <p className="mt-2 text-slate-400">{t('reports.empty.transactions.description')}</p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-hidden rounded-xl border border-white/10">
            <table className="w-full">
              <thead className="bg-navy-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.date')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.direction', { defaultValue: 'Direction' })}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.counterparty', { defaultValue: 'Counterparty' })}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.amount')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.token')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.chain')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.status')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.memo')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.tx')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reportData.items.map((item) => (
                  <tr key={item._id} className="hover:bg-navy-800/50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-white">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <DirectionBadge direction={item.direction} />
                    </td>
                    <td className="px-4 py-3 text-sm text-white">
                      <div>
                        <p className="text-white">{item.beneficiaryName}</p>
                        {item.beneficiaryWallet && (
                          <p className="text-xs text-slate-500 font-mono">
                            {item.beneficiaryWallet.slice(0, 6)}...{item.beneficiaryWallet.slice(-4)}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-white">
                      {Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-300">{item.token}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-400">
                      {item.chainId != null ? getChainName(item.chainId) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-sm text-slate-400" title={item.memo || ''}>
                      {item.memo || '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {item.txHash ? (
                        <a
                          href={item.chainId != null ? getBlockExplorerTxUrl(item.chainId, item.txHash) : `https://etherscan.io/tx/${item.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-accent-400 hover:text-accent-300"
                        >
                          {t('reports.table.view')}
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
              <div key={item._id} className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-white">{item.beneficiaryName}</p>
                    {item.beneficiaryWallet && (
                      <p className="text-xs text-slate-500 font-mono">
                        {item.beneficiaryWallet.slice(0, 6)}...{item.beneficiaryWallet.slice(-4)}
                      </p>
                    )}
                    <p className="text-sm text-slate-400">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <DirectionBadge direction={item.direction} />
                    <StatusBadge status={item.status} />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-bold text-white">
                    {Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {item.token}
                    {item.chainId != null && (
                      <span className="ml-2 rounded-full bg-navy-700 px-2 py-0.5 text-xs text-slate-500">
                        {getChainName(item.chainId)}
                      </span>
                    )}
                  </span>
                  {item.txHash && (
                    <a
                      href={item.chainId != null ? getBlockExplorerTxUrl(item.chainId, item.txHash) : `https://etherscan.io/tx/${item.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-accent-400"
                    >
                      {t('reports.table.view')}
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
                {t('reports.summary.showing', { count: reportData.items.length })}
              </span>
              <span className="text-slate-600">|</span>
              {reportData.totals.map((total, idx) => (
                <span key={total.token} className="font-medium text-white">
                  {idx > 0 && <span className="text-slate-600 mr-4">|</span>}
                  {t('reports.summary.total')}: {Number(total.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {total.token}
                </span>
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

