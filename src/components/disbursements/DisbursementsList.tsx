import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getChainName } from '@/lib/chains';
import { Id } from '../../../convex/_generated/dataModel';
import { getStatusColor } from './statusColors';

// Extracted verbatim from src/pages/Disbursements.tsx (M-04 decomposition).

type SortField = 'createdAt' | 'amount' | 'status' | 'scheduledAt';

export type DisbursementListItem = {
  _id: Id<'disbursements'>;
  chainId?: number;
  status: string;
  token: string;
  amount?: string;
  totalAmount?: string;
  displayAmount?: string;
  memo?: string;
  createdAt: number;
  scheduledAt?: number;
  type?: 'single' | 'batch';
  beneficiary?: { name?: string; walletAddress?: string } | null;
};

interface DisbursementsListProps<T extends DisbursementListItem> {
  displayedResult:
    | {
        items: T[];
        totalCount: number;
        hasMore: boolean;
      }
    | undefined;
  isRefreshing: boolean;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  handleSort: (field: SortField) => void;
  renderActionButton: (disbursement: T) => React.ReactNode;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  currentPage: number;
  pageSize: number;
  hasActiveFilters: boolean;
  clearFilters: () => void;
  setSelectedDisbursementId: (id: Id<'disbursements'>) => void;
}

export function DisbursementsList<T extends DisbursementListItem>({
  displayedResult,
  isRefreshing,
  sortBy,
  sortOrder,
  handleSort,
  renderActionButton,
  goToNextPage,
  goToPrevPage,
  currentPage,
  pageSize,
  hasActiveFilters,
  clearFilters,
  setSelectedDisbursementId,
}: DisbursementsListProps<T>) {
  const { t } = useTranslation();

  return (
    <>
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
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
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
                      {t('disbursements.table.chain', { defaultValue: 'Chain' })}
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
                      onClick={() => handleSort('scheduledAt')}
                    >
                      <span className="flex items-center gap-1">
                        {t('disbursements.table.scheduledFor')}
                        {sortBy === 'scheduledAt' && (
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
                  {displayedResult?.items.map((disbursement) => {
                    const isBatch = disbursement.type === 'batch';
                    const displayAmount = isBatch ? (disbursement.totalAmount || disbursement.amount || '0') : (disbursement.amount || '0');
                    return (
                      <tr key={disbursement._id} className="hover:bg-navy-800/30">
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedDisbursementId(disbursement._id)}
                          className="font-medium text-white hover:text-accent-400 transition-colors text-left"
                        >
                          {disbursement.beneficiary?.name || 'Unknown'}
                        </button>
                      </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-white">
                            {displayAmount} {disbursement.token}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {disbursement.chainId != null ? (
                            <span className="rounded-full bg-navy-700 px-2 py-0.5 text-xs text-slate-400">
                              {getChainName(disbursement.chainId)}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
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
                        <td className="px-6 py-4 text-slate-400 text-xs whitespace-nowrap">
                          {disbursement.scheduledAt
                            ? new Date(disbursement.scheduledAt).toLocaleString()
                            : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="px-6 py-4 text-slate-400">
                          {new Date(disbursement.createdAt).toLocaleDateString()}
                        </td>
                      <td className="px-6 py-4">
                        {renderActionButton(disbursement)}
                      </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="lg:hidden divide-y divide-white/5">
              {displayedResult?.items.map((disbursement) => {
                const isBatch = disbursement.type === 'batch';
                const displayAmount = isBatch ? (disbursement.totalAmount || disbursement.amount || '0') : (disbursement.amount || '0');
                return (
                  <div key={disbursement._id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => setSelectedDisbursementId(disbursement._id)}
                          className="font-medium text-white hover:text-accent-400 transition-colors text-left"
                        >
                          {disbursement.beneficiary?.name || 'Unknown'}
                        </button>
                        <span className="font-mono text-sm text-slate-400 mt-1 block">
                          {displayAmount} {disbursement.token}
                          {disbursement.chainId != null && (
                            <span className="ml-2 rounded-full bg-navy-700 px-2 py-0.5 text-xs text-slate-500">
                              {getChainName(disbursement.chainId)}
                            </span>
                          )}
                        </span>
                      </div>
                      <span
                        className={`ml-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize shrink-0 ${getStatusColor(
                          disbursement.status
                        )}`}
                      >
                        {t(`status.${disbursement.status}`)}
                      </span>
                      {disbursement.status === 'scheduled' && disbursement.scheduledAt && (
                        <span className="ml-2 text-xs text-slate-500">
                          {new Date(disbursement.scheduledAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    
                    {disbursement.memo && (
                      <div>
                        <p className="text-xs text-slate-500 mb-1">{t('disbursements.table.memo')}</p>
                        <p className="text-sm text-slate-400">{disbursement.memo}</p>
                      </div>
                    )}

                    {disbursement.scheduledAt && (
                      <div>
                        <p className="text-xs text-slate-500 mb-0.5">
                          {t('disbursements.table.scheduledFor')}
                        </p>
                        <p className="text-sm text-yellow-400">
                          {new Date(disbursement.scheduledAt).toLocaleString()}
                        </p>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <div className="text-sm text-slate-400">
                        {new Date(disbursement.createdAt).toLocaleDateString()}
                      </div>
                      <div>
                        {renderActionButton(disbursement)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {displayedResult && displayedResult.totalCount > pageSize && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-white/10 bg-navy-800/30 px-4 sm:px-6 py-4">
                <div className="text-sm text-slate-400 text-center sm:text-left">
                  {t('disbursements.pagination.showing', {
                    from: currentPage * pageSize + 1,
                    to: Math.min((currentPage + 1) * pageSize, displayedResult.totalCount),
                    total: displayedResult.totalCount
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={goToPrevPage}
                    disabled={currentPage === 0}
                    className="h-11"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('common.previous')}</span>
                  </Button>
                  <span className="px-3 py-1 text-sm text-slate-400">
                    {t('disbursements.pagination.page', {
                      current: currentPage + 1,
                      total: Math.ceil(displayedResult.totalCount / pageSize)
                    })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={goToNextPage}
                    disabled={!displayedResult.hasMore}
                    className="h-11"
                  >
                    <span className="hidden sm:inline">{t('common.next')}</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
    </>
  );
}
