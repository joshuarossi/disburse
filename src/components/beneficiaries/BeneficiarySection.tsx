import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TagInput } from '@/components/beneficiaries/TagInput';
import { ScreeningBadge } from '@/components/beneficiaries/ScreeningBadge';
import { ScreeningDetailModal } from '@/components/beneficiaries/ScreeningDetailModal';
import { Check, ChevronDown, ChevronUp, Copy, Edit, Eye, EyeOff, Filter, RefreshCw, Search, Send, Trash2, User } from 'lucide-react';
import { Id } from '../../../convex/_generated/dataModel';

export type BeneficiaryType = 'individual' | 'business';

export interface Beneficiary {
  _id: Id<'beneficiaries'>;
  type?: BeneficiaryType;
  name: string;
  walletAddress: string;
  notes?: string;
  preferredToken?: string;
  preferredChainId?: number;
  isActive: boolean;
  createdAt: number;
  tags: string[];
}

export type SortField = 'name' | 'createdAt' | 'walletAddress';
export type SortOrder = 'asc' | 'desc';
export type StatusFilter = 'all' | 'active' | 'inactive';
export interface SectionState {
  search: string;
  sortField: SortField;
  sortOrder: SortOrder;
  statusFilter: StatusFilter;
  tagFilter: string[];
  showFilters: boolean;
}

export function BeneficiarySection({
  title,
  icon: Icon,
  iconColor,
  beneficiaries,
  availableTags,
  orgId,
  onEdit,
  onToggleActive,
}: {
  title: string;
  icon: typeof User;
  iconColor: string;
  beneficiaries: Beneficiary[];
  availableTags: { name: string; normalizedName?: string }[];
  orgId?: string;
  onEdit: (b: Beneficiary) => void;
  onToggleActive: (id: Id<'beneficiaries'>, isActive: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [screeningDetailId, setScreeningDetailId] = useState<{ id: Id<'beneficiaries'>; name: string } | null>(null);
  const [copiedId, setCopiedId] = useState<Id<'beneficiaries'> | null>(null);
  const [state, setState] = useState<SectionState>({
    search: '',
    sortField: 'name',
    sortOrder: 'asc',
    statusFilter: 'active',
    tagFilter: [],
    showFilters: false,
  });

  const buildDisbursementLink = (beneficiary: Beneficiary) => {
    if (!orgId) return `/org/`;
    const params = new URLSearchParams();
    params.set('create', '1');
    params.set('beneficiary', beneficiary._id);
    if (beneficiary.preferredToken) {
      params.set('token', beneficiary.preferredToken);
    }
    if (beneficiary.preferredChainId != null) {
      params.set('chainId', String(beneficiary.preferredChainId));
    }
    return `/org/${orgId}/disbursements?${params.toString()}`;
  };

  const handleStartDisbursement = (beneficiary: Beneficiary) => {
    navigate(buildDisbursementLink(beneficiary));
  };

  const handleCopyAddress = async (beneficiary: Beneficiary) => {
    try {
      await navigator.clipboard.writeText(beneficiary.walletAddress);
      setCopiedId(beneficiary._id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopiedId(null);
    }
  };

  // Filter and sort beneficiaries
  const filteredAndSorted = useMemo(() => {
    let result = [...beneficiaries];

    // Search filter
    if (state.search.trim()) {
      const searchLower = state.search.toLowerCase().trim();
      result = result.filter(
        (b) =>
          b.name.toLowerCase().includes(searchLower) ||
          b.walletAddress.toLowerCase().includes(searchLower) ||
          b.notes?.toLowerCase().includes(searchLower)
      );
    }

    // Status filter
    if (state.statusFilter === 'active') {
      result = result.filter((b) => b.isActive);
    } else if (state.statusFilter === 'inactive') {
      result = result.filter((b) => !b.isActive);
    }

    // Tag filter (match any selected tag)
    if (state.tagFilter.length > 0) {
      const selectedTags = new Set(state.tagFilter.map((tag) => tag.toLowerCase()));
      result = result.filter((b) =>
        b.tags?.some((tag) => selectedTags.has(tag.toLowerCase()))
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (state.sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'createdAt':
          comparison = a.createdAt - b.createdAt;
          break;
        case 'walletAddress':
          comparison = a.walletAddress.localeCompare(b.walletAddress);
          break;
      }
      return state.sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [beneficiaries, state.search, state.sortField, state.sortOrder, state.statusFilter, state.tagFilter]);

  const handleSort = (field: SortField) => {
    if (state.sortField === field) {
      setState((s) => ({ ...s, sortOrder: s.sortOrder === 'asc' ? 'desc' : 'asc' }));
    } else {
      setState((s) => ({ ...s, sortField: field, sortOrder: 'asc' }));
    }
  };

  const hasActiveFilters =
    state.search || state.statusFilter !== 'active' || state.tagFilter.length > 0;

  const filterCount =
    (state.statusFilter !== 'active' ? 1 : 0) +
    (state.tagFilter.length > 0 ? 1 : 0);
  const showHidden = state.statusFilter === 'all';

  const clearFilters = () => {
    setState((s) => ({ ...s, search: '', statusFilter: 'active', tagFilter: [] }));
  };

  const activeCount = beneficiaries.filter((b) => b.isActive).length;
  const inactiveCount = beneficiaries.filter((b) => !b.isActive).length;

  return (
    <div className="rounded-2xl border border-white/10 bg-navy-900/50 overflow-hidden">
      {/* Section Header */}
      <div className="border-b border-white/10 bg-navy-800/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconColor}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{title}</h2>
              <p className="text-sm text-slate-400">
                {t('beneficiaries.section.total', { count: beneficiaries.length })} · {t('beneficiaries.section.active', { count: activeCount })} · {t('beneficiaries.section.inactive', { count: inactiveCount })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="border-b border-white/5 bg-navy-800/30 px-4 sm:px-6 py-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={state.search}
              onChange={(e) => setState((s) => ({ ...s, search: e.target.value }))}
              placeholder={t('beneficiaries.searchPlaceholder')}
              className="w-full rounded-lg border border-white/10 bg-navy-800 pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Show hidden toggle */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  statusFilter: s.statusFilter === 'all' ? 'active' : 'all',
                }))
              }
              className={cn("h-11", showHidden ? 'border-accent-500' : '')}
            >
              {showHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              <span className="hidden sm:inline">
                {showHidden ? t('beneficiaries.hideHidden') : t('beneficiaries.showHidden')}
              </span>
            </Button>
            {/* Filter Toggle */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setState((s) => ({ ...s, showFilters: !s.showFilters }))}
              className={cn("h-11", hasActiveFilters ? 'border-accent-500' : '')}
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.filters')}</span>
              {hasActiveFilters && (
                <span className="ml-1 rounded-full bg-accent-500 px-1.5 py-0.5 text-xs text-white">
                  {filterCount}
                </span>
              )}
            </Button>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-11 text-slate-400 hover:text-white">
                {t('common.clear')}
              </Button>
            )}
          </div>
        </div>

        {/* Expanded Filters */}
        {state.showFilters && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-400">Status:</span>
                <div className="flex gap-2">
                  {(['all', 'active', 'inactive'] as StatusFilter[]).map((status) => (
                    <button
                      key={status}
                      onClick={() => setState((s) => ({ ...s, statusFilter: status }))}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        state.statusFilter === status
                          ? 'bg-accent-500 text-white'
                          : 'bg-navy-800 text-slate-400 hover:bg-navy-700 hover:text-white'
                      }`}
                    >
                      {t(`beneficiaries.status.${status}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="mb-2 block text-sm text-slate-400">
                  {t('beneficiaries.tags')}
                </span>
                <TagInput
                  availableTags={availableTags}
                  value={state.tagFilter}
                  onChange={(tags) => setState((s) => ({ ...s, tagFilter: tags }))}
                  placeholder={t('beneficiaries.filterTags')}
                  allowCreate={false}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      {filteredAndSorted.length === 0 ? (
        <div className="p-8 text-center">
          {beneficiaries.length === 0 ? (
            <>
              <Icon className="mx-auto h-10 w-10 text-slate-500" />
              <p className="mt-2 text-slate-400">{t('beneficiaries.section.noResults', { type: title.toLowerCase() })}</p>
            </>
          ) : (
            <>
              <Search className="mx-auto h-10 w-10 text-slate-500" />
              <p className="mt-2 text-slate-400">{t('common.noResults')}</p>
              <Button variant="secondary" size="sm" onClick={clearFilters} className="mt-3">
                {t('common.clearFilters')}
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5 bg-navy-800/20">
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-slate-400 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('name')}
                  >
                    <span className="flex items-center gap-1">
                      {t('common.name')}
                      {state.sortField === 'name' && (
                        state.sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-slate-400 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('walletAddress')}
                  >
                    <span className="flex items-center gap-1">
                      Wallet Address
                      {state.sortField === 'walletAddress' && (
                        state.sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400">
                      {t('common.status')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400">
                      {t('screening.title')}
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-slate-400 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('createdAt')}
                  >
                    <span className="flex items-center gap-1">
                      {t('beneficiaries.table.added')}
                      {state.sortField === 'createdAt' && (
                        state.sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-400">
                      {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredAndSorted.map((beneficiary) => (
                  <tr key={beneficiary._id} className="hover:bg-navy-800/30">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-white">{beneficiary.name}</p>
                        {beneficiary.notes && (
                          <p className="text-sm text-slate-500 truncate max-w-xs" title={beneficiary.notes}>
                            {beneficiary.notes}
                          </p>
                        )}
                        {beneficiary.tags?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {beneficiary.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-navy-700 px-2 py-0.5 text-xs text-slate-300"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => handleCopyAddress(beneficiary)}
                        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
                        title={t('common.copyAddress')}
                      >
                        <code className="font-mono">
                          {beneficiary.walletAddress.slice(0, 6)}...
                          {beneficiary.walletAddress.slice(-4)}
                        </code>
                        {copiedId === beneficiary._id ? (
                          <Check className="h-3.5 w-3.5 text-green-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-slate-500" />
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                          beneficiary.isActive
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-slate-500/10 text-slate-400'
                        }`}
                      >
                        {beneficiary.isActive ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <ScreeningBadge
                        beneficiaryId={beneficiary._id}
                        onClick={() => setScreeningDetailId({ id: beneficiary._id, name: beneficiary.name })}
                      />
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {new Date(beneficiary.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {orgId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleStartDisbursement(beneficiary)}
                            title={t('disbursements.newDisbursement')}
                          >
                            <Send className="h-4 w-4 text-accent-400" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(beneficiary)}
                          title={t('beneficiaries.table.edit')}
                        >
                          <Edit className="h-4 w-4 text-slate-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onToggleActive(beneficiary._id, beneficiary.isActive)}
                          title={beneficiary.isActive ? t('beneficiaries.table.deactivate') : t('beneficiaries.table.reactivate')}
                        >
                          {beneficiary.isActive ? (
                            <Trash2 className="h-4 w-4 text-red-400" />
                          ) : (
                            <RefreshCw className="h-4 w-4 text-green-400" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden space-y-3">
            {filteredAndSorted.map((beneficiary) => (
              <div
                key={beneficiary._id}
                className="rounded-lg border border-white/10 bg-navy-800/50 p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{beneficiary.name}</p>
                    {beneficiary.notes && (
                      <p className="text-sm text-slate-500 mt-1 line-clamp-2" title={beneficiary.notes}>
                        {beneficiary.notes}
                      </p>
                    )}
                    {beneficiary.tags?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {beneficiary.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-navy-700 px-2 py-0.5 text-xs text-slate-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    <ScreeningBadge
                      beneficiaryId={beneficiary._id}
                      onClick={() => setScreeningDetailId({ id: beneficiary._id, name: beneficiary.name })}
                    />
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        beneficiary.isActive
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-slate-500/10 text-slate-400'
                      }`}
                    >
                      {beneficiary.isActive ? t('common.active') : t('common.inactive')}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Wallet Address</p>
                    <button
                      type="button"
                      onClick={() => handleCopyAddress(beneficiary)}
                      className="flex items-center gap-2 text-slate-400 break-all hover:text-white transition-colors text-left"
                      title={t('common.copyAddress')}
                    >
                      <code className="font-mono">{beneficiary.walletAddress}</code>
                      {copiedId === beneficiary._id ? (
                        <Check className="h-3.5 w-3.5 text-green-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-slate-500" />
                      )}
                    </button>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">{t('beneficiaries.table.added')}</p>
                    <p className="text-slate-400">{new Date(beneficiary.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                  {orgId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStartDisbursement(beneficiary)}
                      className="flex-1 h-11 w-full text-accent-400"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {t('disbursements.newDisbursement')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(beneficiary)}
                    className={cn("flex-1 h-11", orgId ? "" : "w-full")}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    {t('beneficiaries.table.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onToggleActive(beneficiary._id, beneficiary.isActive)}
                    className={cn(
                      "flex-1 h-11",
                      beneficiary.isActive ? "text-red-400 hover:text-red-300" : "text-green-400 hover:text-green-300"
                    )}
                  >
                    {beneficiary.isActive ? (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t('beneficiaries.table.deactivate')}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {t('beneficiaries.table.reactivate')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Screening Detail Modal */}
      {screeningDetailId && (
        <ScreeningDetailModal
          beneficiaryId={screeningDetailId.id}
          beneficiaryName={screeningDetailId.name}
          onClose={() => setScreeningDetailId(null)}
        />
      )}
    </div>
  );
}
