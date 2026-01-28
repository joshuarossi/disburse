import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { BulkImportModal } from '@/components/beneficiaries/BulkImportModal';
import { ScreeningBadge } from '@/components/beneficiaries/ScreeningBadge';
import { ScreeningDetailModal } from '@/components/beneficiaries/ScreeningDetailModal';
import { cn } from '@/lib/utils';
import { 
  Plus, 
  Users, 
  Edit, 
  Trash2, 
  User, 
  Building2,
  X,
  AlertCircle,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Filter,
  Upload,
} from 'lucide-react';

type BeneficiaryType = 'individual' | 'business';
type SortField = 'name' | 'createdAt' | 'walletAddress';
type SortOrder = 'asc' | 'desc';
type StatusFilter = 'all' | 'active' | 'inactive';

interface Beneficiary {
  _id: Id<'beneficiaries'>;
  type?: BeneficiaryType;
  name: string;
  walletAddress: string;
  notes?: string;
  isActive: boolean;
  createdAt: number;
}

interface EditingBeneficiary {
  id: Id<'beneficiaries'>;
  type: BeneficiaryType;
  name: string;
  walletAddress: string;
  notes: string;
}

// Section state for search, sort, filter
interface SectionState {
  search: string;
  sortField: SortField;
  sortOrder: SortOrder;
  statusFilter: StatusFilter;
  showFilters: boolean;
}

// Reusable section component for each beneficiary type
function BeneficiarySection({
  title,
  icon: Icon,
  iconColor,
  beneficiaries,
  walletAddress,
  onEdit,
  onToggleActive,
}: {
  title: string;
  icon: typeof User;
  iconColor: string;
  beneficiaries: Beneficiary[];
  walletAddress: string;
  onEdit: (b: Beneficiary) => void;
  onToggleActive: (id: Id<'beneficiaries'>, isActive: boolean) => void;
}) {
  const { t } = useTranslation();
  const [screeningDetailId, setScreeningDetailId] = useState<{ id: Id<'beneficiaries'>; name: string } | null>(null);
  const [state, setState] = useState<SectionState>({
    search: '',
    sortField: 'name',
    sortOrder: 'asc',
    statusFilter: 'all',
    showFilters: false,
  });

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
  }, [beneficiaries, state.search, state.sortField, state.sortOrder, state.statusFilter]);

  const handleSort = (field: SortField) => {
    if (state.sortField === field) {
      setState((s) => ({ ...s, sortOrder: s.sortOrder === 'asc' ? 'desc' : 'asc' }));
    } else {
      setState((s) => ({ ...s, sortField: field, sortOrder: 'asc' }));
    }
  };

  const hasActiveFilters = state.search || state.statusFilter !== 'all';

  const clearFilters = () => {
    setState((s) => ({ ...s, search: '', statusFilter: 'all' }));
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
                  {(state.statusFilter !== 'all' ? 1 : 0)}
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
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-sm text-slate-400">
                        {beneficiary.walletAddress.slice(0, 6)}...
                        {beneficiary.walletAddress.slice(-4)}
                      </code>
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
                        walletAddress={walletAddress}
                        onClick={() => setScreeningDetailId({ id: beneficiary._id, name: beneficiary.name })}
                      />
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {new Date(beneficiary.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
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
                  </div>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    <ScreeningBadge
                      beneficiaryId={beneficiary._id}
                      walletAddress={walletAddress}
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
                    <code className="text-slate-400 break-all">{beneficiary.walletAddress}</code>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">{t('beneficiaries.table.added')}</p>
                    <p className="text-slate-400">{new Date(beneficiary.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(beneficiary)}
                    className="flex-1 h-11"
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
          walletAddress={walletAddress}
          onClose={() => setScreeningDetailId(null)}
        />
      )}
    </div>
  );
}

export default function Beneficiaries() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();
  
  // Create form state
  const [isCreating, setIsCreating] = useState(false);
  const [newType, setNewType] = useState<BeneficiaryType>('individual');
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  
  // Edit modal state
  const [editingBeneficiary, setEditingBeneficiary] = useState<EditingBeneficiary | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  
  // Bulk import modal state
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);

  const beneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const createBeneficiary = useMutation(api.beneficiaries.create);
  const updateBeneficiary = useMutation(api.beneficiaries.update);

  // Split beneficiaries by type
  const individuals = useMemo(
    () => beneficiaries?.filter((b) => !b.type || b.type === 'individual') ?? [],
    [beneficiaries]
  );
  
  const businesses = useMemo(
    () => beneficiaries?.filter((b) => b.type === 'business') ?? [],
    [beneficiaries]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !address || !newName.trim() || !newAddress.trim()) return;

    setCreateError(null);
    
    try {
      await createBeneficiary({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        type: newType,
        name: newName.trim(),
        beneficiaryAddress: newAddress.trim(),
        notes: newNotes.trim() || undefined,
      });
      setNewType('individual');
      setNewName('');
      setNewAddress('');
      setNewNotes('');
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create beneficiary:', error);
      setCreateError(error instanceof Error ? error.message : 'Failed to create beneficiary');
    }
  };

  const handleOpenEdit = (beneficiary: Beneficiary) => {
    setEditingBeneficiary({
      id: beneficiary._id,
      type: beneficiary.type || 'individual',
      name: beneficiary.name,
      walletAddress: beneficiary.walletAddress,
      notes: beneficiary.notes || '',
    });
    setEditError(null);
  };

  const handleCloseEdit = () => {
    setEditingBeneficiary(null);
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBeneficiary || !address) return;

    setEditError(null);

    try {
      await updateBeneficiary({
        beneficiaryId: editingBeneficiary.id,
        walletAddress: address,
        type: editingBeneficiary.type,
        name: editingBeneficiary.name.trim(),
        beneficiaryAddress: editingBeneficiary.walletAddress.trim(),
        notes: editingBeneficiary.notes.trim() || undefined,
      });
      setEditingBeneficiary(null);
    } catch (error) {
      console.error('Failed to update beneficiary:', error);
      setEditError(error instanceof Error ? error.message : 'Failed to update beneficiary');
    }
  };

  const handleToggleActive = async (beneficiaryId: Id<'beneficiaries'>, isActive: boolean) => {
    if (!address) return;
    try {
      await updateBeneficiary({
        beneficiaryId,
        walletAddress: address,
        isActive: !isActive,
      });
    } catch (error) {
      console.error('Failed to update beneficiary:', error);
    }
  };

  const totalCount = (beneficiaries?.length ?? 0);

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-4 lg:pt-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{t('beneficiaries.title')}</h1>
            <p className="mt-1 text-sm sm:text-base text-slate-400">
              {t('beneficiaries.subtitle')}
              {totalCount > 0 && (
                <span className="ml-2 text-slate-500">({t('beneficiaries.total', { count: totalCount })})</span>
              )}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Button
              variant="secondary"
              onClick={() => setIsBulkImportOpen(true)}
              className="w-full sm:w-auto h-11"
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('beneficiaries.bulkImport.button')}
            </Button>
            <Button onClick={() => setIsCreating(true)} className="w-full sm:w-auto h-11">
              <Plus className="h-4 w-4" />
              {t('beneficiaries.addBeneficiary')}
            </Button>
          </div>
        </div>

        {/* Create Form */}
        {isCreating && (
          <div className="rounded-2xl border border-accent-500/30 bg-navy-900/50 p-4 sm:p-6">
            <h2 className="mb-4 text-base sm:text-lg font-semibold text-white">
              {t('beneficiaries.newBeneficiary')}
            </h2>
            
            {createError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {createError}
              </div>
            )}
            
            <form onSubmit={handleCreate} className="space-y-4 sm:space-y-6">
              {/* Type Selector */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Beneficiary Type
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setNewType('individual')}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border p-3 sm:p-4 transition-colors h-11 sm:h-auto ${
                      newType === 'individual'
                        ? 'border-accent-500 bg-accent-500/10 text-white'
                        : 'border-white/10 text-slate-400 hover:border-white/30'
                    }`}
                  >
                    <User className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span className="text-sm sm:text-base font-medium">{t('beneficiaries.individual')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewType('business')}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border p-3 sm:p-4 transition-colors h-11 sm:h-auto ${
                      newType === 'business'
                        ? 'border-accent-500 bg-accent-500/10 text-white'
                        : 'border-white/10 text-slate-400 hover:border-white/30'
                    }`}
                  >
                    <Building2 className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span className="text-sm sm:text-base font-medium">{t('beneficiaries.business')}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {newType === 'individual' ? t('beneficiaries.fullName') : t('beneficiaries.businessName')}
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={newType === 'individual' ? t('beneficiaries.namePlaceholder.individual') : t('beneficiaries.namePlaceholder.business')}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Wallet Address
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 font-mono text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('common.notes')} ({t('common.optional')})
                </label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder={t('beneficiaries.notesPlaceholder')}
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button type="submit" className="w-full sm:w-auto h-11">{t('beneficiaries.createBeneficiary')}</Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIsCreating(false);
                    setNewType('individual');
                    setNewName('');
                    setNewAddress('');
                    setNewNotes('');
                    setCreateError(null);
                  }}
                  className="w-full sm:w-auto h-11"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Empty State */}
        {beneficiaries?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/20 bg-navy-900/30 p-8 text-center">
            <Users className="mx-auto h-12 w-12 text-slate-500" />
            <h3 className="mt-4 text-lg font-medium text-white">
              {t('beneficiaries.noBeneficiaries.title')}
            </h3>
            <p className="mt-2 text-slate-400">
              {t('beneficiaries.noBeneficiaries.description')}
            </p>
          </div>
        )}

        {/* Individuals Section */}
        {(beneficiaries?.length ?? 0) > 0 && (
          <BeneficiarySection
            title={t('beneficiaries.individuals')}
            icon={User}
            iconColor="bg-purple-500/10 text-purple-400"
            beneficiaries={individuals as Beneficiary[]}
            walletAddress={address!}
            onEdit={handleOpenEdit}
            onToggleActive={handleToggleActive}
          />
        )}

        {/* Businesses Section */}
        {(beneficiaries?.length ?? 0) > 0 && (
          <BeneficiarySection
            title={t('beneficiaries.businesses')}
            icon={Building2}
            iconColor="bg-blue-500/10 text-blue-400"
            beneficiaries={businesses as Beneficiary[]}
            walletAddress={address!}
            onEdit={handleOpenEdit}
            onToggleActive={handleToggleActive}
          />
        )}
      </div>

      {/* Edit Modal */}
      {editingBeneficiary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-navy-900 p-4 sm:p-6 my-auto">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-xl font-bold text-white">{t('beneficiaries.editBeneficiary')}</h2>
              <button
                onClick={handleCloseEdit}
                className="text-slate-400 hover:text-white h-11 w-11 flex items-center justify-center"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {editError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4 sm:space-y-6">
              {/* Type Selector */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Beneficiary Type
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingBeneficiary({ ...editingBeneficiary, type: 'individual' })}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border p-3 transition-colors h-11 ${
                      editingBeneficiary.type === 'individual'
                        ? 'border-accent-500 bg-accent-500/10 text-white'
                        : 'border-white/10 text-slate-400 hover:border-white/30'
                    }`}
                  >
                    <User className="h-4 w-4" />
                    <span className="text-sm font-medium">Individual</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingBeneficiary({ ...editingBeneficiary, type: 'business' })}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border p-3 transition-colors h-11 ${
                      editingBeneficiary.type === 'business'
                        ? 'border-accent-500 bg-accent-500/10 text-white'
                        : 'border-white/10 text-slate-400 hover:border-white/30'
                    }`}
                  >
                    <Building2 className="h-4 w-4" />
                    <span className="text-sm font-medium">Business</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {editingBeneficiary.type === 'individual' ? 'Full Name' : 'Business Name'}
                </label>
                <input
                  type="text"
                  value={editingBeneficiary.name}
                  onChange={(e) => setEditingBeneficiary({ ...editingBeneficiary, name: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Wallet Address
                </label>
                <input
                  type="text"
                  value={editingBeneficiary.walletAddress}
                  onChange={(e) => setEditingBeneficiary({ ...editingBeneficiary, walletAddress: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 font-mono text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Notes (optional)
                </label>
                <textarea
                  value={editingBeneficiary.notes}
                  onChange={(e) => setEditingBeneficiary({ ...editingBeneficiary, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button type="submit" className="flex-1 h-11">
                  {t('beneficiaries.saveChanges')}
                </Button>
                <Button type="button" variant="secondary" onClick={handleCloseEdit} className="h-11">
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {isBulkImportOpen && orgId && (
        <BulkImportModal
          orgId={orgId as Id<'orgs'>}
          onClose={() => setIsBulkImportOpen(false)}
          onSuccess={() => {
            setIsBulkImportOpen(false);
            // The beneficiaries list will automatically refresh via useQuery
          }}
        />
      )}
    </AppLayout>
  );
}
