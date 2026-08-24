import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getChainName, getTokenSymbolsForChain, getTokensForChain } from '@/lib/chains';
import { Button } from '@/components/ui/button';
import { Plus, Search, X } from 'lucide-react';
import { TagInput } from '@/components/beneficiaries/TagInput';
import { CHAINS_LIST } from '@/lib/chains';
import { Id } from '../../../convex/_generated/dataModel';
import type { Dispatch, SetStateAction } from 'react';

// Extracted verbatim from src/pages/Disbursements.tsx (M-04 decomposition).

type BeneficiaryOption = {
  _id: Id<'beneficiaries'>;
  name: string;
  walletAddress: string;
  type?: 'individual' | 'business';
  preferredToken?: string;
  preferredChainId?: number;
  tags?: string[];
};

interface CreateDisbursementFormProps {
  isCreating: boolean;
  createChainId: number;
  setCreateChainId: Dispatch<SetStateAction<number>>;
  selectedBeneficiary: string;
  amount: string;
  setAmount: Dispatch<SetStateAction<string>>;
  token: string;
  setToken: Dispatch<SetStateAction<string>>;
  memo: string;
  setMemo: Dispatch<SetStateAction<string>>;
  scheduledAt: string;
  setScheduledAt: Dispatch<SetStateAction<string>>;
  scheduledAtError: string | null;
  setScheduledAtError: Dispatch<SetStateAction<string | null>>;
  setBeneficiarySearch: Dispatch<SetStateAction<string>>;
  isBatchMode: boolean;
  beneficiaryTypeFilter: 'all' | 'individual' | 'business';
  setBeneficiaryTypeFilter: Dispatch<SetStateAction<'all' | 'individual' | 'business'>>;
  isBeneficiaryDropdownOpen: boolean;
  setIsBeneficiaryDropdownOpen: Dispatch<SetStateAction<boolean>>;
  setManualPaymentOverride: Dispatch<SetStateAction<boolean>>;
  setPreferredAppliedFor: Dispatch<SetStateAction<string | null>>;
  recipients: Array<{ beneficiaryId: string; amount: string }>;
  selectedTags: string[];
  setSelectedTags: Dispatch<SetStateAction<string[]>>;
  addMode: 'beneficiary' | 'tag';
  setAddMode: Dispatch<SetStateAction<'beneficiary' | 'tag'>>;
  availableBalance: number | null;
  availableTags: Array<{ name: string; normalizedName?: string }>;
  beneficiaries: BeneficiaryOption[] | undefined;
  beneficiariesByTag: BeneficiaryOption[];
  batchTotal: number;
  beneficiaryDropdownRef: React.RefObject<HTMLDivElement | null>;
  beneficiaryInputValue: string;
  beneficiaryOptions: BeneficiaryOption[];
  hasDraftRecipient: boolean;
  recipientCount: number;
  selectedBeneficiaryData: BeneficiaryOption | null | undefined;
  resetForm: () => void;
  handleCreate: (e: React.FormEvent) => void | Promise<void>;
  handleSelectBeneficiary: (beneficiaryId: string) => void;
  addRecipient: () => void;
  addRecipientsByTag: () => void;
  removeRecipient: (index: number) => void;
  updateRecipientAmount: (index: number, newAmount: string) => void;
  validateScheduledAt: (value: string) => string | null;
  safes: Array<{ chainId: number; safeAddress: string }> | undefined;
}

export function CreateDisbursementForm({
  isCreating,
  createChainId,
  setCreateChainId,
  selectedBeneficiary,
  amount,
  setAmount,
  token,
  setToken,
  memo,
  setMemo,
  scheduledAt,
  setScheduledAt,
  scheduledAtError,
  setScheduledAtError,
  beneficiaryTypeFilter,
  setBeneficiaryTypeFilter,
  isBeneficiaryDropdownOpen,
  setIsBeneficiaryDropdownOpen,
  setManualPaymentOverride,
  setPreferredAppliedFor,
  recipients,
  selectedTags,
  setSelectedTags,
  addMode,
  setAddMode,
  availableBalance,
  availableTags,
  beneficiaries,
  beneficiariesByTag,
  batchTotal,
  setBeneficiarySearch,
  isBatchMode,
  beneficiaryDropdownRef,
  beneficiaryInputValue,
  beneficiaryOptions,
  hasDraftRecipient,
  recipientCount,
  selectedBeneficiaryData,
  resetForm,
  handleCreate,
  handleSelectBeneficiary,
  addRecipient,
  addRecipientsByTag,
  removeRecipient,
  updateRecipientAmount,
  validateScheduledAt,
  safes,
}: CreateDisbursementFormProps) {
  const { t } = useTranslation();

  if (!isCreating) return null;

  return (
    <>
          <div className="rounded-2xl border border-accent-500/30 bg-navy-900/50 p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base sm:text-lg font-semibold text-white">
                  {t('disbursements.createDisbursement')}
                </h2>
              </div>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-6">
              <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-navy-900/40 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-white">
                        {t('disbursements.form.recipients', { defaultValue: 'Recipients' })}
                      </h3>
                      <span className="text-xs text-slate-400">
                        {recipientCount} {recipientCount === 1 ? t('disbursements.form.recipient', { defaultValue: 'recipient' }) : t('disbursements.form.recipientsCount', { defaultValue: 'recipients' })}
                      </span>
                    </div>

                    <div className="inline-flex rounded-lg border border-white/10 bg-navy-800/70 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setAddMode('beneficiary')}
                        className={cn(
                          'rounded-md px-3 py-1.5 transition-colors',
                          addMode === 'beneficiary'
                            ? 'bg-accent-500/20 text-accent-200'
                            : 'text-slate-400 hover:text-white'
                        )}
                      >
                        {t('disbursements.form.byBeneficiary', { defaultValue: 'By beneficiary' })}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddMode('tag')}
                        className={cn(
                          'rounded-md px-3 py-1.5 transition-colors',
                          addMode === 'tag'
                            ? 'bg-accent-500/20 text-accent-200'
                            : 'text-slate-400 hover:text-white'
                        )}
                      >
                        {t('disbursements.form.byTag', { defaultValue: 'By tag' })}
                      </button>
                    </div>

                    {addMode === 'beneficiary' ? (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.6fr_0.7fr_auto]">
                        <div ref={beneficiaryDropdownRef} className="relative">
                          <label className="mb-2 block text-sm font-medium text-slate-300">
                            {t('disbursements.form.beneficiary')}
                          </label>
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                            <input
                              type="text"
                              value={beneficiaryInputValue}
                              onChange={(e) => {
                                setBeneficiarySearch(e.target.value);
                                setIsBeneficiaryDropdownOpen(true);
                              }}
                              onFocus={() => {
                                setIsBeneficiaryDropdownOpen(true);
                                if (selectedBeneficiaryData) {
                                  setBeneficiarySearch('');
                                }
                              }}
                              onClick={() => setIsBeneficiaryDropdownOpen(true)}
                              placeholder={t('beneficiaries.searchPlaceholder')}
                              className="h-11 w-full rounded-lg border border-white/10 bg-navy-800 pl-10 pr-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                            />
                            {isBeneficiaryDropdownOpen && (
                              <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-lg border border-white/10 bg-navy-900 shadow-xl">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-navy-800/70 px-3 py-2 text-[11px] text-slate-400">
                                  <span>{t('disbursements.form.filterBy', { defaultValue: 'Filter' })}</span>
                                  <div className="flex rounded-lg border border-white/10 bg-navy-800/70 p-1">
                                    {(['all', 'individual', 'business'] as const).map((type) => (
                                      <button
                                        key={type}
                                        type="button"
                                        onClick={() => setBeneficiaryTypeFilter(type)}
                                        className={cn(
                                          'rounded-md px-2.5 py-1 text-[11px] transition-colors',
                                          beneficiaryTypeFilter === type
                                            ? 'bg-accent-500/20 text-accent-200'
                                            : 'text-slate-400 hover:text-white'
                                        )}
                                      >
                                        {type === 'all'
                                          ? t('common.all')
                                          : type === 'individual'
                                            ? t('beneficiaries.individual')
                                            : t('beneficiaries.business')}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="max-h-64 overflow-auto">
                                  {beneficiaryOptions.length === 0 ? (
                                    <div className="px-4 py-3 text-sm text-slate-500">
                                      {t('common.noResults')}
                                    </div>
                                  ) : (
                                    beneficiaryOptions.map((b) => {
                                      const preferredChainLabel = b.preferredChainId
                                        ? getChainName(b.preferredChainId)
                                        : null;
                                      const preferredLabel = [preferredChainLabel, b.preferredToken]
                                        .filter(Boolean)
                                        .join(' • ');
                                      const isSelected = selectedBeneficiary === b._id;

                                      return (
                                        <button
                                          key={b._id}
                                          type="button"
                                          onClick={() => handleSelectBeneficiary(b._id)}
                                          className={cn(
                                            'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors',
                                            isSelected
                                              ? 'bg-accent-500/15 text-white'
                                              : 'text-slate-300 hover:bg-navy-700/60'
                                          )}
                                        >
                                          <div>
                                            <p className="text-sm font-medium text-white">{b.name}</p>
                                            <p className="text-xs text-slate-500 font-mono">
                                              {b.walletAddress.slice(0, 6)}...{b.walletAddress.slice(-4)}
                                            </p>
                                            {preferredLabel ? (
                                              <p className="mt-1 text-[11px] text-slate-400">
                                                {t('disbursements.form.preferred', { defaultValue: 'Preferred' })}: {preferredLabel}
                                              </p>
                                            ) : null}
                                          </div>
                                          <span
                                            className={cn(
                                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                                              (b.type ?? 'individual') === 'individual'
                                                ? 'bg-blue-500/10 text-blue-400'
                                                : 'bg-purple-500/10 text-purple-400'
                                            )}
                                          >
                                            {(b.type ?? 'individual') === 'individual'
                                              ? t('beneficiaries.individual')
                                              : t('beneficiaries.business')}
                                          </span>
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-300">
                            {t('disbursements.form.amount')}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={availableBalance ?? undefined}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="h-11 w-full rounded-lg border border-white/10 bg-navy-800 px-4 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                            required={!isBatchMode}
                          />
                          <p className={cn(
                            'mt-1 text-xs',
                            availableBalance != null && parseFloat(amount || '0') > availableBalance
                              ? 'text-red-400'
                              : 'text-transparent'
                          )}>
                            {availableBalance != null && parseFloat(amount || '0') > availableBalance
                              ? 'Insufficient balance'
                              : ' '}
                          </p>
                        </div>
                        <div className="flex flex-col">
                          <span className="mb-2 h-5" aria-hidden="true" />
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={addRecipient}
                            disabled={!selectedBeneficiary || !amount || parseFloat(amount) <= 0}
                            className="h-11"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            {recipients.length > 0
                              ? t('disbursements.batch.addAnother', { defaultValue: 'Add another beneficiary' })
                              : t('disbursements.batch.startBatch', { defaultValue: 'Add to batch' })}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <TagInput
                          availableTags={availableTags ?? []}
                          value={selectedTags}
                          onChange={setSelectedTags}
                          placeholder={t('disbursements.form.selectTagsPlaceholder')}
                          allowCreate={false}
                        />
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>
                            {t('disbursements.form.tagMatches', { count: beneficiariesByTag.length })}
                          </span>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={addRecipientsByTag}
                            disabled={selectedTags.length === 0}
                            className="h-9"
                          >
                            {t('disbursements.form.addTaggedBeneficiaries')}
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="rounded-lg border border-white/10 bg-navy-900/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {t('disbursements.form.paymentSettings', { defaultValue: 'Payment settings' })}
                        </h4>
                        {availableBalance != null && (
                          <span className="text-xs text-slate-400">
                            {t('disbursements.form.availableBalance', { defaultValue: 'Available' })}:{' '}
                            <span className="font-mono text-slate-300">
                              {availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {token}
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-300">
                            {t('disbursements.filters.chain', { defaultValue: 'Chain' })}
                          </label>
                          <select
                            value={createChainId}
                            onChange={(e) => {
                              const newChainId = Number(e.target.value);
                              const symbols = getTokenSymbolsForChain(newChainId);
                              setManualPaymentOverride(true);
                              setPreferredAppliedFor(selectedBeneficiaryData?._id ?? null);
                              setCreateChainId(newChainId);
                              setToken(symbols.includes(token) ? token : symbols[0] ?? 'USDC');
                            }}
                            disabled={recipients.length > 0}
                            className={cn(
                              'w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500',
                              recipients.length > 0 && 'cursor-not-allowed opacity-60'
                            )}
                          >
                            {CHAINS_LIST.filter((c) => safes?.some((s) => s.chainId === c.chainId)).map((c) => (
                              <option key={c.chainId} value={c.chainId}>
                                {c.chainName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-300">
                            Token
                          </label>
                          <select
                            value={token}
                            onChange={(e) => {
                              setManualPaymentOverride(true);
                              setPreferredAppliedFor(selectedBeneficiaryData?._id ?? null);
                              setToken(e.target.value);
                            }}
                            disabled={recipients.length > 0}
                            className={cn(
                              'w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500',
                              recipients.length > 0 && 'cursor-not-allowed opacity-60'
                            )}
                          >
                            {Object.keys(getTokensForChain(createChainId)).map((sym) => (
                              <option key={sym} value={sym}>{sym}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {recipients.length > 0 && (
                        <p className="mt-2 text-xs text-slate-500">
                          {t('disbursements.form.paymentLocked', { defaultValue: 'Chain and token are locked to the first recipient in the batch.' })}
                        </p>
                      )}
                    </div>

                    <p className="text-xs text-slate-500">
                      {t('disbursements.form.batchHint', { defaultValue: 'Optional: add more beneficiaries to create a batch.' })}
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-navy-900/40 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">
                      {t('disbursements.form.details', { defaultValue: 'Details' })}
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-300">
                          {t('disbursements.form.memo')} ({t('common.optional')})
                        </label>
                        <input
                          type="text"
                          value={memo}
                          onChange={(e) => setMemo(e.target.value)}
                          placeholder={t('disbursements.form.memoPlaceholder')}
                          className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-300">
                          {t('disbursements.form.scheduleFor')} ({t('common.optional')})
                        </label>
                        <input
                          type="datetime-local"
                          value={scheduledAt}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            setScheduledAt(nextValue);
                            setScheduledAtError(validateScheduledAt(nextValue));
                          }}
                          className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                        />
                        {scheduledAtError ? (
                          <p className="mt-1 text-xs text-red-400">
                            {scheduledAtError}
                          </p>
                        ) : scheduledAt ? (
                          <p className="mt-1 text-xs text-slate-400">
                            {t('disbursements.form.scheduleNote')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-navy-900/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-white">
                        {t('disbursements.form.currentBatch', { defaultValue: 'Current batch' })}
                      </h3>
                      <span className="text-xs text-slate-400">
                        {recipientCount} {recipientCount === 1 ? t('disbursements.form.recipient', { defaultValue: 'recipient' }) : t('disbursements.form.recipientsCount', { defaultValue: 'recipients' })}
                      </span>
                    </div>

                    <div className="rounded-lg border border-accent-500/30 bg-accent-500/10 p-3">
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span>{t('disbursements.form.totalAmount', { defaultValue: 'Total amount' })}</span>
                        <span className="font-mono text-white">{batchTotal.toFixed(2)} {token}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                        <span>{t('disbursements.form.recipientCount', { defaultValue: 'Recipients' })}: {recipientCount}</span>
                        {availableBalance != null && (
                          <span>
                            {t('disbursements.form.availableBalance', { defaultValue: 'Available' })}:{' '}
                            <span className="font-mono text-slate-300">
                              {availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {token}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    {recipients.length === 0 && !hasDraftRecipient && (
                      <div className="rounded-lg border border-dashed border-white/10 bg-navy-900/40 p-3 text-center text-xs text-slate-500">
                        {t('disbursements.form.noRecipients', { defaultValue: 'No recipients added yet.' })}
                      </div>
                    )}

                    {(recipients.length > 0 || hasDraftRecipient) && (
                      <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                        {recipients.map((recipient, index) => {
                          const recipientBeneficiary = beneficiaries?.find(b => b._id === recipient.beneficiaryId);
                          return (
                            <div
                              key={`recipient-${index}-${recipient.beneficiaryId}`}
                              className="flex items-center gap-3 rounded-lg border border-white/10 bg-navy-800/60 p-3"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-white">
                                  {recipientBeneficiary?.name || 'Unknown'}
                                </p>
                                {recipientBeneficiary && (
                                  <p className="text-xs text-slate-500 font-mono">
                                    {recipientBeneficiary.walletAddress.slice(0, 6)}...{recipientBeneficiary.walletAddress.slice(-4)}
                                  </p>
                                )}
                              </div>
                              <div className="w-24">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={availableBalance ?? undefined}
                                  value={recipient.amount}
                                  onChange={(e) => updateRecipientAmount(index, e.target.value)}
                                  placeholder="0.00"
                                  className="h-9 w-full rounded-lg border border-white/10 bg-navy-800 px-2 text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => removeRecipient(index)}
                                className="text-slate-400 hover:text-red-400 transition-colors"
                                title={t('disbursements.batch.remove')}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          );
                        })}
                        {hasDraftRecipient && (
                          <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/10 bg-navy-900/40 p-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-slate-500">
                                {t('disbursements.form.draft', { defaultValue: 'Draft' })}
                              </p>
                              <p className="truncate text-sm font-medium text-white">
                                {beneficiaries?.find(b => b._id === selectedBeneficiary)?.name || 'Unknown'}
                              </p>
                            </div>
                            <span className="text-xs font-mono text-slate-300">
                              {amount} {token}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button type="submit" className="w-full sm:w-auto h-11">{t('disbursements.createDisbursement')}</Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={resetForm}
                  className="w-full sm:w-auto h-11"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
    </>
  );
}
