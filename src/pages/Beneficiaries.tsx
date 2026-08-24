import { useState, useMemo } from 'react';
import { getSessionToken } from '@/lib/session';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { BulkImportModal } from '@/components/beneficiaries/BulkImportModal';
import { BeneficiarySection, type Beneficiary, type BeneficiaryType } from '@/components/beneficiaries/BeneficiarySection';
import { TagInput } from '@/components/beneficiaries/TagInput';
import { cn } from '@/lib/utils';
import {
  Plus,
  X,
  User,
  Building2,
  Users,
  Upload,
  AlertCircle,
} from 'lucide-react';
import { CHAINS_LIST } from '@/lib/chains';


interface EditingBeneficiary {
  id: Id<'beneficiaries'>;
  type: BeneficiaryType;
  name: string;
  walletAddress: string;
  notes: string;
  preferredToken: string;
  preferredChainId: number | '';
  tags: string[];
}

const PREFERRED_TOKEN_OPTIONS = ['USDC', 'USDT', 'PYUSD'];

// Section state for search, sort, filter

// Reusable section component for each beneficiary type
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
  const [newPreferredToken, setNewPreferredToken] = useState<string>('');
  const [newPreferredChainId, setNewPreferredChainId] = useState<number | ''>('');
  const [newTags, setNewTags] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    address?: string;
  }>({});
  
  // Edit modal state
  const [editingBeneficiary, setEditingBeneficiary] = useState<EditingBeneficiary | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = useState<{
    name?: string;
    address?: string;
  }>({});
  
  // Bulk import modal state
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);

  const beneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<'orgs'>, sessionToken: getSessionToken() ?? "", includeTags: true }
      : 'skip'
  );

  const availableTags = useQuery(
    api.tags.list,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<'orgs'>, sessionToken: getSessionToken() ?? "" }
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
    if (!orgId || !address) return;

    // Validate fields
    const errors: { name?: string; address?: string } = {};
    
    if (!newName.trim()) {
      errors.name = newType === 'individual' 
        ? t('beneficiaries.validation.nameRequired.individual')
        : t('beneficiaries.validation.nameRequired.business');
    }
    
    if (!newAddress.trim()) {
      errors.address = t('beneficiaries.validation.addressRequired');
    } else if (!newAddress.trim().startsWith('0x') || newAddress.trim().length !== 42) {
      errors.address = t('beneficiaries.validation.addressInvalid');
    }

    setFieldErrors(errors);

    // If there are validation errors, don't submit
    if (Object.keys(errors).length > 0) {
      return;
    }

    setCreateError(null);
    
    try {
      await createBeneficiary({
        orgId: orgId as Id<'orgs'>,
        sessionToken: getSessionToken() ?? "",
        type: newType,
        name: newName.trim(),
        beneficiaryAddress: newAddress.trim(),
        notes: newNotes.trim() || undefined,
        preferredToken: newPreferredToken || undefined,
        preferredChainId: newPreferredChainId !== '' ? newPreferredChainId : undefined,
        tags: newTags,
      });
      setNewType('individual');
      setNewName('');
      setNewAddress('');
      setNewNotes('');
      setNewPreferredToken('');
      setNewPreferredChainId('');
      setNewTags([]);
      setFieldErrors({});
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
      preferredToken: beneficiary.preferredToken ?? '',
      preferredChainId: beneficiary.preferredChainId ?? '',
      tags: beneficiary.tags ?? [],
    });
    setEditError(null);
    setEditFieldErrors({});
  };

  const handleCloseEdit = () => {
    setEditingBeneficiary(null);
    setEditError(null);
    setEditFieldErrors({});
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBeneficiary || !address) return;

    // Validate fields
    const errors: { name?: string; address?: string } = {};
    
    if (!editingBeneficiary.name.trim()) {
      errors.name = editingBeneficiary.type === 'individual' 
        ? t('beneficiaries.validation.nameRequired.individual')
        : t('beneficiaries.validation.nameRequired.business');
    }
    
    if (!editingBeneficiary.walletAddress.trim()) {
      errors.address = t('beneficiaries.validation.addressRequired');
    } else if (!editingBeneficiary.walletAddress.trim().startsWith('0x') || editingBeneficiary.walletAddress.trim().length !== 42) {
      errors.address = t('beneficiaries.validation.addressInvalid');
    }

    setEditFieldErrors(errors);

    // If there are validation errors, don't submit
    if (Object.keys(errors).length > 0) {
      return;
    }

    setEditError(null);

    try {
      await updateBeneficiary({
        beneficiaryId: editingBeneficiary.id,
        sessionToken: getSessionToken() ?? "",
        type: editingBeneficiary.type,
        name: editingBeneficiary.name.trim(),
        beneficiaryAddress: editingBeneficiary.walletAddress.trim(),
        notes: editingBeneficiary.notes.trim() || undefined,
        preferredToken: editingBeneficiary.preferredToken || undefined,
        preferredChainId: editingBeneficiary.preferredChainId !== '' ? editingBeneficiary.preferredChainId : undefined,
        tags: editingBeneficiary.tags,
      });
      setEditingBeneficiary(null);
      setEditFieldErrors({});
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
        sessionToken: getSessionToken() ?? "",
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
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (fieldErrors.name) {
                      setFieldErrors(prev => ({ ...prev, name: undefined }));
                    }
                  }}
                  placeholder={newType === 'individual' ? t('beneficiaries.namePlaceholder.individual') : t('beneficiaries.namePlaceholder.business')}
                  className={cn(
                    "w-full rounded-lg border bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-1 transition-colors",
                    fieldErrors.name
                      ? "border-red-500/50 focus:border-red-500 focus:ring-red-500"
                      : "border-white/10 focus:border-accent-500 focus:ring-accent-500"
                  )}
                />
                {fieldErrors.name && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {fieldErrors.name}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Wallet Address
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => {
                    setNewAddress(e.target.value);
                    if (fieldErrors.address) {
                      setFieldErrors(prev => ({ ...prev, address: undefined }));
                    }
                  }}
                  placeholder="0x..."
                  className={cn(
                    "w-full rounded-lg border bg-navy-800 px-4 py-3 font-mono text-base text-white placeholder-slate-500 focus:outline-none focus:ring-1 transition-colors",
                    fieldErrors.address
                      ? "border-red-500/50 focus:border-red-500 focus:ring-red-500"
                      : "border-white/10 focus:border-accent-500 focus:ring-accent-500"
                  )}
                />
                {fieldErrors.address && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {fieldErrors.address}
                  </p>
                )}
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
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('beneficiaries.tags')} ({t('common.optional')})
                </label>
                <TagInput
                  availableTags={availableTags ?? []}
                  value={newTags}
                  onChange={setNewTags}
                  placeholder={t('beneficiaries.tagsPlaceholder')}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('beneficiaries.preferredToken', { defaultValue: 'Preferred token' })} ({t('common.optional')})
                </label>
                <select
                  value={newPreferredToken}
                  onChange={(e) => setNewPreferredToken(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                >
                  <option value="">—</option>
                  {PREFERRED_TOKEN_OPTIONS.map((sym) => (
                    <option key={sym} value={sym}>{sym}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('beneficiaries.preferredChain', { defaultValue: 'Preferred chain' })} ({t('common.optional')})
                </label>
                <select
                  value={newPreferredChainId}
                  onChange={(e) => setNewPreferredChainId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                >
                  <option value="">—</option>
                  {CHAINS_LIST.map((c) => (
                    <option key={c.chainId} value={c.chainId}>{c.chainName}</option>
                  ))}
                </select>
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
                    setNewPreferredToken('');
                    setNewPreferredChainId('');
                    setNewTags([]);
                    setCreateError(null);
                    setFieldErrors({});
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
            availableTags={availableTags ?? []}
            orgId={orgId}
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
            availableTags={availableTags ?? []}
            orgId={orgId}
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
                  onChange={(e) => {
                    setEditingBeneficiary({ ...editingBeneficiary, name: e.target.value });
                    if (editFieldErrors.name) {
                      setEditFieldErrors(prev => ({ ...prev, name: undefined }));
                    }
                  }}
                  className={cn(
                    "w-full rounded-lg border bg-navy-800 px-4 py-3 text-base text-white focus:outline-none focus:ring-1 transition-colors",
                    editFieldErrors.name
                      ? "border-red-500/50 focus:border-red-500 focus:ring-red-500"
                      : "border-white/10 focus:border-accent-500 focus:ring-accent-500"
                  )}
                />
                {editFieldErrors.name && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {editFieldErrors.name}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Wallet Address
                </label>
                <input
                  type="text"
                  value={editingBeneficiary.walletAddress}
                  onChange={(e) => {
                    setEditingBeneficiary({ ...editingBeneficiary, walletAddress: e.target.value });
                    if (editFieldErrors.address) {
                      setEditFieldErrors(prev => ({ ...prev, address: undefined }));
                    }
                  }}
                  className={cn(
                    "w-full rounded-lg border bg-navy-800 px-4 py-3 font-mono text-base text-white focus:outline-none focus:ring-1 transition-colors",
                    editFieldErrors.address
                      ? "border-red-500/50 focus:border-red-500 focus:ring-red-500"
                      : "border-white/10 focus:border-accent-500 focus:ring-accent-500"
                  )}
                />
                {editFieldErrors.address && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {editFieldErrors.address}
                  </p>
                )}
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
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('beneficiaries.tags')} ({t('common.optional')})
                </label>
                <TagInput
                  availableTags={availableTags ?? []}
                  value={editingBeneficiary.tags}
                  onChange={(tags) =>
                    setEditingBeneficiary((prev) =>
                      prev ? { ...prev, tags } : prev
                    )
                  }
                  placeholder={t('beneficiaries.tagsPlaceholder')}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('beneficiaries.preferredToken', { defaultValue: 'Preferred token' })} (optional)
                </label>
                <select
                  value={editingBeneficiary.preferredToken}
                  onChange={(e) => setEditingBeneficiary({ ...editingBeneficiary, preferredToken: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                >
                  <option value="">—</option>
                  {PREFERRED_TOKEN_OPTIONS.map((sym) => (
                    <option key={sym} value={sym}>{sym}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('beneficiaries.preferredChain', { defaultValue: 'Preferred chain' })} (optional)
                </label>
                <select
                  value={editingBeneficiary.preferredChainId === '' ? '' : editingBeneficiary.preferredChainId}
                  onChange={(e) => setEditingBeneficiary({ ...editingBeneficiary, preferredChainId: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                >
                  <option value="">—</option>
                  {CHAINS_LIST.map((c) => (
                    <option key={c.chainId} value={c.chainId}>{c.chainName}</option>
                  ))}
                </select>
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
