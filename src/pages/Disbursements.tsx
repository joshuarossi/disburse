import { useState, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { 
  Plus, Send, ArrowUpRight, Loader2, Play, CheckCircle, X, Rocket,
  Search, Filter, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Calendar, RefreshCw
} from 'lucide-react';
import {
  createTransferTx,
  proposeTransaction,
  executeTransaction,
} from '@/lib/safe';

// Status and token options will be translated in component

const PAGE_SIZE = 10;

export default function Disbursements() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  
  const STATUS_OPTIONS = [
    { value: 'draft', label: t('status.draft') },
    { value: 'pending', label: t('status.pending') },
    { value: 'proposed', label: t('status.proposed') },
    { value: 'executed', label: t('status.executed') },
    { value: 'failed', label: t('status.failed') },
    { value: 'cancelled', label: t('status.cancelled') },
  ];

  const TOKEN_OPTIONS = [
    { value: '', label: t('disbursements.filters.allTokens') },
    { value: 'USDC', label: 'USDC' },
    { value: 'USDT', label: 'USDT' },
  ];
  const [selectedBeneficiary, setSelectedBeneficiary] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('USDC');
  const [memo, setMemo] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter & search state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tokenFilter, setTokenFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Sorting state
  const [sortBy, setSortBy] = useState<'createdAt' | 'amount' | 'status'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [cursors, setCursors] = useState<(string | null)[]>([null]); // Stack of cursors for each page
  const [currentPage, setCurrentPage] = useState(0);

  // Build query args
  const queryArgs = useMemo(() => {
    if (!orgId || !address) return null;
    
    return {
      orgId: orgId as Id<'orgs'>,
      walletAddress: address,
      search: search.trim() || undefined,
      status: statusFilter.length > 0 ? statusFilter : undefined,
      token: tokenFilter || undefined,
      dateFrom: dateFrom ? new Date(dateFrom).getTime() : undefined,
      dateTo: dateTo ? new Date(dateTo).getTime() : undefined,
      sortBy,
      sortOrder,
      cursor: cursors[currentPage] ?? undefined,
      limit: PAGE_SIZE,
    };
  }, [orgId, address, search, statusFilter, tokenFilter, dateFrom, dateTo, sortBy, sortOrder, cursors, currentPage]);

  const disbursementsResult = useQuery(
    api.disbursements.list,
    queryArgs ?? 'skip'
  );

  // Keep previous data while loading to prevent flicker during sort/filter changes
  const lastValidResultRef = useRef(disbursementsResult);
  if (disbursementsResult !== undefined) {
    lastValidResultRef.current = disbursementsResult;
  }
  const displayedResult = disbursementsResult ?? lastValidResultRef.current;
  const isRefreshing = disbursementsResult === undefined && lastValidResultRef.current !== undefined;

  const beneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address, activeOnly: true }
      : 'skip'
  );

  const safe = useQuery(
    api.safes.getForOrg,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const createDisbursement = useMutation(api.disbursements.create);
  const updateStatus = useMutation(api.disbursements.updateStatus);

  // Helper to reset pagination when filters change
  const resetPagination = () => {
    setCursors([null]);
    setCurrentPage(0);
  };

  // Handler for search input
  const handleSearchChange = (value: string) => {
    setSearch(value);
    resetPagination();
  };

  // Handler for status toggle
  const toggleStatus = (status: string) => {
    setStatusFilter(prev => 
      prev.includes(status) 
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
    resetPagination();
  };

  // Handler for token filter
  const handleTokenFilterChange = (value: string) => {
    setTokenFilter(value);
    resetPagination();
  };

  // Handler for date changes
  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    resetPagination();
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    resetPagination();
  };

  // Handler for sort
  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    resetPagination();
  };

  // Pagination handlers
  const goToNextPage = () => {
    if (displayedResult?.nextCursor) {
      setCursors(prev => [...prev.slice(0, currentPage + 1), displayedResult.nextCursor]);
      setCurrentPage(prev => prev + 1);
    }
  };

  const goToPrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(prev => prev - 1);
    }
  };

  // Clear all filters
  const clearFilters = () => {
    setSearch('');
    setStatusFilter([]);
    setTokenFilter('');
    setDateFrom('');
    setDateTo('');
    resetPagination();
  };

  const hasActiveFilters = search || statusFilter.length > 0 || tokenFilter || dateFrom || dateTo;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !address || !selectedBeneficiary || !amount) return;

    try {
      await createDisbursement({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        beneficiaryId: selectedBeneficiary as Id<'beneficiaries'>,
        token,
        amount,
        memo: memo.trim() || undefined,
      });
      setSelectedBeneficiary('');
      setAmount('');
      setToken('USDC');
      setMemo('');
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create disbursement:', error);
    }
  };

  const handlePropose = async (disbursement: {
    _id: Id<'disbursements'>;
    beneficiary: { walletAddress: string } | null;
    token: string;
    amount: string;
  }) => {
    if (!safe || !address || !disbursement.beneficiary) return;

    setProcessingId(disbursement._id);
    setError(null);

    try {
      // Update status to pending
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'pending',
      });

      // Create the transfer transaction
      const transferTx = createTransferTx(
        disbursement.token as 'USDC' | 'USDT',
        disbursement.beneficiary.walletAddress,
        disbursement.amount
      );

      // Propose to Safe
      const safeTxHash = await proposeTransaction(
        safe.safeAddress,
        address,
        [transferTx]
      );

      // Update status to proposed with safeTxHash
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'proposed',
        safeTxHash,
      });
    } catch (err) {
      console.error('Failed to propose transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to propose transaction');
      
      // Revert status to draft on failure
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'draft',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleExecute = async (disbursement: {
    _id: Id<'disbursements'>;
    safeTxHash?: string;
  }) => {
    if (!safe || !address || !disbursement.safeTxHash) return;

    setProcessingId(disbursement._id);
    setError(null);

    try {
      // Execute the transaction
      const txHash = await executeTransaction(
        safe.safeAddress,
        address,
        disbursement.safeTxHash
      );

      // Update status to executed with txHash
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'executed',
        txHash,
      });
    } catch (err) {
      console.error('Failed to execute transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to execute transaction');
      
      // Mark as failed
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'failed',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (disbursementId: Id<'disbursements'>) => {
    if (!address) return;
    
    if (!confirm(t('disbursements.actions.cancelConfirm'))) return;

    try {
      await updateStatus({
        disbursementId,
        walletAddress: address,
        status: 'cancelled',
      });
    } catch (err) {
      console.error('Failed to cancel disbursement:', err);
      setError(err instanceof Error ? err.message : 'Failed to cancel disbursement');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'executed':
        return 'bg-green-500/10 text-green-400';
      case 'failed':
      case 'cancelled':
        return 'bg-red-500/10 text-red-400';
      case 'pending':
      case 'proposed':
        return 'bg-yellow-500/10 text-yellow-400';
      default:
        return 'bg-slate-500/10 text-slate-400';
    }
  };

  const renderActionButton = (disbursement: NonNullable<typeof disbursementsResult>['items'][number]) => {
    const isProcessing = processingId === disbursement._id;

    if (isProcessing) {
      return (
        <Button variant="ghost" size="sm" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      );
    }

    switch (disbursement.status) {
      case 'draft':
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePropose(disbursement)}
              title={t('disbursements.actions.propose')}
            >
              <Play className="h-4 w-4 text-accent-400" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCancel(disbursement._id)}
              title="Cancel"
            >
              <X className="h-4 w-4 text-slate-400 hover:text-red-400" />
            </Button>
          </div>
        );
      case 'pending':
        return (
          <div className="flex items-center gap-1">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCancel(disbursement._id)}
              title="Cancel"
            >
              <X className="h-4 w-4 text-slate-400 hover:text-red-400" />
            </Button>
          </div>
        );
      case 'proposed':
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleExecute(disbursement)}
            title={t('disbursements.actions.execute')}
          >
            <Rocket className="h-4 w-4 text-yellow-400" />
          </Button>
        );
      case 'executed':
        return (
          <CheckCircle className="h-4 w-4 text-green-400" />
        );
      case 'failed':
      case 'cancelled':
        return null;
      default:
        return null;
    }
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('disbursements.title')}</h1>
            <p className="mt-1 text-slate-400">
              {t('disbursements.subtitle')}
              {displayedResult && (
                <span className="ml-2 text-slate-500">
                  ({t('disbursements.total', { count: displayedResult.totalCount })})
                  {isRefreshing && (
                    <RefreshCw className="ml-2 inline h-3 w-3 animate-spin" />
                  )}
                </span>
              )}
            </p>
          </div>
          <Button onClick={() => setIsCreating(true)} disabled={!safe}>
            <Plus className="h-4 w-4" />
            {t('disbursements.newDisbursement')}
          </Button>
        </div>

        {/* Search & Filter Bar */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t('disbursements.searchPlaceholder')}
                className="w-full rounded-lg border border-white/10 bg-navy-800 pl-10 pr-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
            </div>

            {/* Filter Toggle */}
            <Button
              variant="secondary"
              onClick={() => setShowFilters(!showFilters)}
              className={hasActiveFilters ? 'border-accent-500' : ''}
            >
              <Filter className="h-4 w-4" />
              {t('common.filters')}
              {hasActiveFilters && (
                <span className="ml-1 rounded-full bg-accent-500 px-1.5 py-0.5 text-xs text-white">
                  {(statusFilter.length > 0 ? 1 : 0) + (tokenFilter ? 1 : 0) + (dateFrom || dateTo ? 1 : 0)}
                </span>
              )}
            </Button>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button variant="ghost" onClick={clearFilters} className="text-slate-400 hover:text-white">
                {t('common.clearAll')}
              </Button>
            )}
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
                    {STATUS_OPTIONS.map((option) => (
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
                    {TOKEN_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
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

        {safe === null && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-400">
            {t('disbursements.noSafeWarning')}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-300 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create Form */}
        {isCreating && (
          <div className="rounded-2xl border border-accent-500/30 bg-navy-900/50 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">
              {t('disbursements.createDisbursement')}
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('disbursements.form.beneficiary')}
                </label>
                <select
                  value={selectedBeneficiary}
                  onChange={(e) => setSelectedBeneficiary(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                >
                  <option value="">{t('disbursements.form.selectBeneficiary')}</option>
                  {beneficiaries?.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.name} ({b.walletAddress.slice(0, 6)}...{b.walletAddress.slice(-4)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    {t('disbursements.form.amount')}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    required
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Token
                  </label>
                  <select
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  >
                    <option value="USDC">USDC</option>
                    <option value="USDT">USDT</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('disbursements.form.memo')} ({t('common.optional')})
                </label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder={t('disbursements.form.memoPlaceholder')}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit">{t('disbursements.createDisbursement')}</Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsCreating(false)}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Disbursements List */}
        {displayedResult?.items.length === 0 && !hasActiveFilters ? (
          <div className="rounded-2xl border border-dashed border-white/20 bg-navy-900/30 p-8 text-center">
            <Send className="mx-auto h-12 w-12 text-slate-500" />
            <h3 className="mt-4 text-lg font-medium text-white">
              {t('disbursements.noDisbursements.title')}
            </h3>
            <p className="mt-2 text-slate-400">
              {t('disbursements.noDisbursements.description')}
            </p>
          </div>
        ) : displayedResult?.items.length === 0 && hasActiveFilters ? (
          <div className="rounded-2xl border border-dashed border-white/20 bg-navy-900/30 p-8 text-center">
            <Search className="mx-auto h-12 w-12 text-slate-500" />
            <h3 className="mt-4 text-lg font-medium text-white">
              {t('disbursements.noResults.title')}
            </h3>
            <p className="mt-2 text-slate-400">
              {t('disbursements.noResults.description')}
            </p>
            <Button variant="secondary" onClick={clearFilters} className="mt-4">
              {t('common.clearFilters')}
            </Button>
          </div>
        ) : (
          <div className={`rounded-2xl border border-white/10 bg-navy-900/50 overflow-hidden transition-opacity ${isRefreshing ? 'opacity-70' : ''}`}>
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-navy-800/50">
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    {t('disbursements.table.beneficiary')}
                  </th>
                  <th 
                    className="px-6 py-4 text-left text-sm font-medium text-slate-400 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('amount')}
                  >
                    <span className="flex items-center gap-1">
                      {t('disbursements.table.amount')}
                      {sortBy === 'amount' && (
                        sortOrder === 'desc' ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />
                      )}
                    </span>
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    {t('disbursements.table.memo')}
                  </th>
                  <th 
                    className="px-6 py-4 text-left text-sm font-medium text-slate-400 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('status')}
                  >
                    <span className="flex items-center gap-1">
                      {t('disbursements.table.status')}
                      {sortBy === 'status' && (
                        sortOrder === 'desc' ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />
                      )}
                    </span>
                  </th>
                  <th 
                    className="px-6 py-4 text-left text-sm font-medium text-slate-400 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('createdAt')}
                  >
                    <span className="flex items-center gap-1">
                      {t('disbursements.table.date')}
                      {sortBy === 'createdAt' && (
                        sortOrder === 'desc' ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />
                      )}
                    </span>
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-medium text-slate-400">
                    {t('disbursements.table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {displayedResult?.items.map((disbursement) => (
                  <tr key={disbursement._id} className="hover:bg-navy-800/30">
                    <td className="px-6 py-4">
                      <p className="font-medium text-white">
                        {disbursement.beneficiary?.name || 'Unknown'}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-white">
                        {disbursement.amount} {disbursement.token}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-400 max-w-xs truncate" title={disbursement.memo || undefined}>
                      {disbursement.memo || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium capitalize ${getStatusColor(
                          disbursement.status
                        )}`}
                      >
                        {t(`status.${disbursement.status}`)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {new Date(disbursement.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        {renderActionButton(disbursement)}
                        {disbursement.txHash && (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${disbursement.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-accent-400 hover:underline"
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {displayedResult && displayedResult.totalCount > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-white/10 bg-navy-800/30 px-6 py-4">
                <div className="text-sm text-slate-400">
                  {t('disbursements.pagination.showing', {
                    from: currentPage * PAGE_SIZE + 1,
                    to: Math.min((currentPage + 1) * PAGE_SIZE, displayedResult.totalCount),
                    total: displayedResult.totalCount
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={goToPrevPage}
                    disabled={currentPage === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t('common.previous')}
                  </Button>
                  <span className="px-3 py-1 text-sm text-slate-400">
                    {t('disbursements.pagination.page', {
                      current: currentPage + 1,
                      total: Math.ceil(displayedResult.totalCount / PAGE_SIZE)
                    })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={goToNextPage}
                    disabled={!displayedResult.hasMore}
                  >
                    {t('common.next')}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
