import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { X, ShieldAlert, ShieldCheck, Shield, RefreshCw } from 'lucide-react';
import { useState } from 'react';

interface ScreeningDetailModalProps {
  beneficiaryId: Id<'beneficiaries'>;
  beneficiaryName: string;
  walletAddress: string;
  onClose: () => void;
}

export function ScreeningDetailModal({
  beneficiaryId,
  beneficiaryName,
  walletAddress,
  onClose,
}: ScreeningDetailModalProps) {
  const { t } = useTranslation();
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  const result = useQuery(
    api.screeningQueries.getScreeningResult,
    { beneficiaryId, walletAddress }
  );

  const reviewResult = useMutation(api.screeningMutations.reviewScreeningResult);
  const rerunScreening = useAction(api.screening.rerunScreening);

  const handleReview = async (status: 'confirmed_match' | 'false_positive') => {
    if (!result?._id) return;
    setReviewError(null);
    try {
      await reviewResult({
        screeningResultId: result._id,
        walletAddress,
        status,
      });
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Failed to update review');
    }
  };

  const handleRerun = async () => {
    setRerunError(null);
    setIsRerunning(true);
    try {
      await rerunScreening({
        beneficiaryId,
        walletAddress,
      });
      // The query will automatically refresh to show the new result
    } catch (error) {
      setRerunError(error instanceof Error ? error.message : 'Failed to rerun screening');
    } finally {
      setIsRerunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-navy-900 p-6 my-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">{t('screening.detailTitle')}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white h-11 w-11 flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Beneficiary info */}
          <div className="rounded-lg bg-navy-800/50 p-4">
            <p className="text-sm text-slate-400">{t('screening.beneficiary')}</p>
            <p className="text-white font-medium">{beneficiaryName}</p>
          </div>

          {/* Status */}
          {result && (
            <div className="rounded-lg bg-navy-800/50 p-4">
              <p className="text-sm text-slate-400 mb-2">{t('screening.status')}</p>
              <StatusDisplay status={result.status} />
              <p className="text-xs text-slate-500 mt-2">
                {t('screening.screenedAt')}: {new Date(result.screenedAt).toLocaleString()}
              </p>
              {result.reviewedAt && (
                <p className="text-xs text-slate-500">
                  {t('screening.reviewedAt')}: {new Date(result.reviewedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* Matches */}
          {result?.matches && result.matches.length > 0 && (
            <div className="rounded-lg bg-navy-800/50 p-4">
              <p className="text-sm text-slate-400 mb-3">{t('screening.matches')}</p>
              <div className="space-y-3">
                {result.matches.map((match: { matchedName: string; matchScore: number; sdnId: number }, idx: number) => (
                  <div key={idx} className="rounded-lg border border-white/5 bg-navy-900/50 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-white font-medium">{match.matchedName}</p>
                      <span className="text-xs text-slate-400">
                        {Math.round(match.matchScore * 100)}% {t('screening.matchScore')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      SDN ID: {match.sdnId}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No result */}
          {result === null && (
            <div className="text-center py-6">
              <Shield className="mx-auto h-10 w-10 text-slate-500" />
              <p className="mt-2 text-slate-400">{t('screening.noResults')}</p>
            </div>
          )}

          {/* Review error */}
          {reviewError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              {reviewError}
            </div>
          )}

          {/* Rerun error */}
          {rerunError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              {rerunError}
            </div>
          )}

          {/* Review actions */}
          {result &&
            (result.status === 'potential_match') && (
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => handleReview('false_positive')}
                  className="flex-1 h-11"
                >
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  {t('screening.markFalsePositive')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleReview('confirmed_match')}
                  className="flex-1 h-11 text-red-400 border-red-500/30 hover:bg-red-500/10"
                >
                  <ShieldAlert className="h-4 w-4 mr-2" />
                  {t('screening.confirmMatch')}
                </Button>
              </div>
            )}

          {/* Run/Rerun screening button */}
          <div className="pt-2">
            <Button
              variant="secondary"
              onClick={handleRerun}
              disabled={isRerunning}
              className="w-full h-11"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRerunning ? 'animate-spin' : ''}`} />
              {isRerunning 
                ? (result === null ? t('screening.running') : t('screening.rerunning'))
                : (result === null ? t('screening.run') : t('screening.rerun'))
              }
            </Button>
          </div>

          <Button variant="secondary" onClick={onClose} className="w-full h-11">
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatusDisplay({ status }: { status: string }) {
  const { t } = useTranslation();
  const configs: Record<string, { icon: typeof Shield; className: string; label: string }> = {
    clear: { icon: ShieldCheck, className: 'text-green-400', label: t('screening.clear') },
    potential_match: { icon: ShieldAlert, className: 'text-amber-400', label: t('screening.potentialMatch') },
    confirmed_match: { icon: ShieldAlert, className: 'text-red-400', label: t('screening.confirmedMatch') },
    false_positive: { icon: Shield, className: 'text-blue-400', label: t('screening.falsePositive') },
  };
  const config = configs[status];
  if (!config) return null;
  const Icon = config.icon;
  return (
    <div className={`flex items-center gap-2 ${config.className}`}>
      <Icon className="h-5 w-5" />
      <span className="font-medium">{config.label}</span>
    </div>
  );
}
