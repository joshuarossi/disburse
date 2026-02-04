import { ReactNode } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { X, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAccount } from 'wagmi';

interface DisbursementDetail {
  _id: Id<'disbursements'>;
  status: string;
  chainId?: number;
  token: string;
  amount?: string;
  totalAmount?: string;
  type?: 'single' | 'batch';
  memo?: string;
  txHash?: string;
  safeTxHash?: string;
  scheduledAt?: number;
  createdAt: number;
  beneficiary?: { name: string; walletAddress: string } | null;
  recipients?: Array<{
    _id: Id<'disbursementRecipients'>;
    recipientAddress: string;
    amount: string;
    beneficiary?: { name: string; walletAddress: string } | null;
  }>;
}

interface BatchDetailModalProps {
  disbursementId: Id<'disbursements'>;
  onClose: () => void;
  renderActions?: (disbursement: DisbursementDetail) => ReactNode;
}

export function BatchDetailModal({ disbursementId, onClose, renderActions }: BatchDetailModalProps) {
  const { address } = useAccount();
  const { t } = useTranslation();

  const disbursement = useQuery(
    api.disbursements.getWithRecipients,
    address && disbursementId
      ? { disbursementId, walletAddress: address }
      : 'skip'
  );

  if (!disbursement) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="rounded-2xl border border-white/10 bg-navy-900 p-6 max-w-2xl w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">{t('disbursements.batch.batchLabel')}</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="text-center py-8 text-slate-400">
            {t('common.loading')}
          </div>
        </div>
      </div>
    );
  }

  const isBatch = disbursement.type === 'batch';
  const recipients = disbursement.recipients || [];
  const actions = renderActions ? renderActions(disbursement as DisbursementDetail) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="rounded-2xl border border-white/10 bg-navy-900 p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {isBatch ? t('disbursements.batch.batchLabel') : (disbursement.beneficiary?.name || 'Unknown')}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {new Date(disbursement.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary Card */}
        <div className="rounded-lg border border-white/10 bg-navy-800/50 p-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-slate-400 mb-1">{t('disbursements.table.token')}</p>
              <p className="text-sm font-medium text-white">{disbursement.token}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">{t('disbursements.table.amount')}</p>
              <p className="text-sm font-medium text-white font-mono">
                {isBatch ? (disbursement.totalAmount || '0') : (disbursement.amount || '0')} {disbursement.token}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">{t('disbursements.table.status')}</p>
              <p className="text-sm font-medium text-white capitalize">{t(`status.${disbursement.status}`)}</p>
            </div>
            {disbursement.txHash && (
              <div>
                <p className="text-xs text-slate-400 mb-1">{t('reports.table.tx')}</p>
                <a
                  href={`https://sepolia.etherscan.io/tx/${disbursement.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent-400 hover:underline"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  {t('common.view')}
                </a>
              </div>
            )}
          </div>
          {disbursement.memo && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-xs text-slate-400 mb-1">{t('disbursements.table.memo')}</p>
              <p className="text-sm text-white">{disbursement.memo}</p>
            </div>
          )}
        </div>

        {/* Recipients Table */}
        {isBatch && recipients.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">
              {t('disbursements.batch.recipients')} ({recipients.length})
            </h3>
            <div className="rounded-lg border border-white/10 bg-navy-800/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-navy-900/50">
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                        {t('disbursements.table.beneficiary')}
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                        {t('common.walletAddress')}
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                        {t('disbursements.table.amount')}
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                        {t('disbursements.table.status')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {recipients.map((recipient) => (
                      <tr key={recipient._id} className="hover:bg-navy-800/30">
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-white">
                            {recipient.beneficiary?.name || 'Unknown'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-mono text-slate-400">
                            {recipient.recipientAddress.slice(0, 6)}...{recipient.recipientAddress.slice(-4)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-mono text-white">
                            {recipient.amount} {disbursement.token}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize text-slate-400">
                            {t(`status.${disbursement.status}`)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Single disbursement view */}
        {!isBatch && disbursement.beneficiary && (
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">
              {t('disbursements.table.beneficiary')}
            </h3>
            <div className="rounded-lg border border-white/10 bg-navy-800/50 p-4">
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-slate-400 mb-1">{t('common.name')}</p>
                  <p className="text-sm font-medium text-white">{disbursement.beneficiary.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">{t('common.walletAddress')}</p>
                  <p className="text-sm font-mono text-white">{disbursement.beneficiary.walletAddress}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">{t('disbursements.table.amount')}</p>
                  <p className="text-sm font-mono text-white">
                    {disbursement.amount} {disbursement.token}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions + Close */}
        <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
          {actions}
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
