import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery, useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { exportToCsv, generateFilename } from '@/lib/csv';
import { CHAINS_LIST, getChainName, getBlockExplorerTxUrl } from '@/lib/chains';
import {
  FileText,
  Download,
  Users,
  ClipboardList,
  Filter,
  ChevronDown,
  ChevronUp,
  Loader2,
  ArrowUpRight,
  X,
} from 'lucide-react';

type TabType = 'transactions' | 'spending' | 'audit';

export default function Reports() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('transactions');

  const tabs = [
    { id: 'transactions' as const, label: t('reports.tabs.transactions'), icon: FileText },
    { id: 'spending' as const, label: t('reports.tabs.spending'), icon: Users },
    { id: 'audit' as const, label: t('reports.tabs.audit'), icon: ClipboardList },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">{t('reports.title')}</h1>
          <p className="mt-1 text-slate-400">{t('reports.subtitle')}</p>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-white/10">
          <nav className="flex gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                    activeTab === tab.id
                      ? 'border-accent-500 text-accent-400'
                      : 'border-transparent text-slate-400 hover:text-white hover:border-white/20'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'transactions' && (
            <TransactionsTab orgId={orgId} address={address} />
          )}
          {activeTab === 'spending' && (
            <SpendingTab orgId={orgId} address={address} />
          )}
          {activeTab === 'audit' && (
            <AuditLogTab orgId={orgId} address={address} />
          )}
        </div>
      </div>
    </AppLayout>
  );
}

// ============================================================================
// Transactions Tab
// ============================================================================

interface TransactionsTabProps {
  orgId: string | undefined;
  address: string | undefined;
}

function TransactionsTab({ orgId, address }: TransactionsTabProps) {
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
      walletAddress: address,
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
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address, activeOnly: false }
      : 'skip'
  );

  useEffect(() => {
    if (!orgId || !address) return;
    if (hasSyncedDeposits.current) return;
    hasSyncedDeposits.current = true;
    void syncDeposits({ orgId: orgId as Id<'orgs'>, walletAddress: address }).catch(() => {
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

interface SpendingTabProps {
  orgId: string | undefined;
  address: string | undefined;
}

function SpendingTab({ orgId, address }: SpendingTabProps) {
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
      walletAddress: address,
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

interface AuditLogTabProps {
  orgId: string | undefined;
  address: string | undefined;
}

function AuditLogTab({ orgId, address }: AuditLogTabProps) {
  const { t } = useTranslation();

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<string[]>([]);

  const ACTION_CATEGORIES = [
    { category: t('reports.auditActions.disbursement'), actions: ['disbursement.created', 'disbursement.pending', 'disbursement.proposed', 'disbursement.executed', 'disbursement.failed', 'disbursement.cancelled'] },
    { category: t('reports.auditActions.beneficiary'), actions: ['beneficiary.created', 'beneficiary.updated'] },
    { category: t('reports.auditActions.team'), actions: ['member.invited', 'member.roleUpdated', 'member.removed'] },
    { category: t('reports.auditActions.safe'), actions: ['safe.linked', 'safe.unlinked'] },
    { category: t('reports.auditActions.org'), actions: ['org.created', 'org.updated'] },
  ];

  // Query args
  const queryArgs = useMemo(() => {
    if (!orgId || !address) return null;
    return {
      orgId: orgId as Id<'orgs'>,
      walletAddress: address,
      startDate: dateFrom ? new Date(dateFrom).getTime() : undefined,
      endDate: dateTo ? new Date(dateTo).getTime() : undefined,
      userId: userFilter ? userFilter as Id<'users'> : undefined,
      actionType: actionFilter.length > 0 ? actionFilter : undefined,
    };
  }, [orgId, address, dateFrom, dateTo, userFilter, actionFilter]);

  const reportData = useQuery(
    api.audit.list,
    queryArgs ?? 'skip'
  );

  const members = useQuery(
    api.orgs.listMembers,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const isLoading = reportData === undefined;
  const activeFilterCount = [dateFrom || dateTo, userFilter, actionFilter.length > 0].filter(Boolean).length;

  const toggleAction = (action: string) => {
    setActionFilter((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    );
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setUserFilter('');
    setActionFilter([]);
  };

  const handleExport = () => {
    if (!reportData?.length) return;

    const columns = [
      { key: 'timestamp', label: t('reports.export.timestamp') },
      { key: 'user', label: t('reports.export.user') },
      { key: 'wallet', label: t('reports.export.wallet') },
      { key: 'action', label: t('reports.export.action') },
      { key: 'details', label: t('reports.export.details') },
    ];

    const rows = reportData.map((item) => ({
      timestamp: new Date(item.timestamp).toLocaleString(),
      user: item.actor?.walletAddress || 'System',
      wallet: item.actor?.walletAddress || '',
      action: formatAction(item.action),
      details: formatDetails(item),
    }));

    exportToCsv(generateFilename('audit_log'), rows, columns);
  };

  const formatAction = (action: string): string => {
    const parts = action.split('.');
    if (parts.length === 2) {
      return `${parts[0].charAt(0).toUpperCase() + parts[0].slice(1)} ${parts[1].charAt(0).toUpperCase() + parts[1].slice(1)}`;
    }
    return action;
  };

  const formatDetails = (item: { objectType: string; objectId: string; metadata?: unknown }): string => {
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
            disabled={isLoading || !reportData?.length}
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

            {/* User */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                {t('reports.filters.user')}
              </label>
              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white"
              >
                <option value="">{t('reports.filters.allUsers')}</option>
                {members?.map((m) => {
                  if (!m) return null;
                  return (
                    <option key={m.userId} value={m.userId}>
                      {m.name || m.walletAddress?.slice(0, 10) + '...'}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Action Type */}
            <div className="space-y-2 sm:col-span-2 lg:col-span-1">
              <label className="text-sm font-medium text-slate-300">
                {t('reports.filters.actionType')}
              </label>
              <div className="space-y-2">
                {ACTION_CATEGORIES.map((cat) => (
                  <div key={cat.category}>
                    <p className="text-xs text-slate-500 mb-1">{cat.category}</p>
                    <div className="flex flex-wrap gap-1">
                      {cat.actions.map((action) => (
                        <button
                          key={action}
                          onClick={() => toggleAction(action)}
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                            actionFilter.includes(action)
                              ? 'bg-accent-500/20 text-accent-400'
                              : 'bg-navy-800 text-slate-400 hover:text-white'
                          )}
                        >
                          {action.split('.')[1]}
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
          <h3 className="mt-4 text-lg font-medium text-white">{t('reports.empty.audit.title')}</h3>
          <p className="mt-2 text-slate-400">{t('reports.empty.audit.description')}</p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-hidden rounded-xl border border-white/10">
            <table className="w-full">
              <thead className="bg-navy-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.timestamp')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.user')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.action')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('reports.table.details')}
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
                          : 'System'}
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
              <div key={item._id} className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
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
                      : 'System'}
                  </span>
                  <span>{new Date(item.timestamp).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-white/10 bg-navy-900/50 p-4">
            <p className="text-sm text-slate-400">
              {t('reports.summary.events', { count: reportData.length })}
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

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'received':
        return 'bg-emerald-500/10 text-emerald-400';
      case 'executed':
        return 'bg-green-500/10 text-green-400';
      case 'failed':
        return 'bg-red-500/10 text-red-400';
      case 'cancelled':
        return 'bg-slate-500/10 text-slate-400';
      case 'pending':
      case 'proposed':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'draft':
      default:
        return 'bg-blue-500/10 text-blue-400';
    }
  };

  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      getStatusStyles(status)
    )}>
      {status === 'received' ? t('status.received', { defaultValue: 'Received' }) : t(`status.${status}`)}
    </span>
  );
}

function DirectionBadge({ direction }: { direction: 'inflow' | 'outflow' }) {
  const { t } = useTranslation();
  const label =
    direction === 'inflow'
      ? t('reports.direction.inflow', { defaultValue: 'Inflow' })
      : t('reports.direction.outflow', { defaultValue: 'Outflow' });
  const style =
    direction === 'inflow'
      ? 'bg-emerald-500/10 text-emerald-400'
      : 'bg-rose-500/10 text-rose-400';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', style)}>
      {label}
    </span>
  );
}
