import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import { useTranslation } from 'react-i18next';
import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion, Loader2 } from 'lucide-react';

interface ScreeningBadgeProps {
  beneficiaryId: Id<'beneficiaries'>;
  walletAddress: string;
  onClick?: () => void;
}

export function ScreeningBadge({ beneficiaryId, walletAddress, onClick }: ScreeningBadgeProps) {
  const { t } = useTranslation();

  const result = useQuery(
    api.screeningQueries.getScreeningResult,
    { beneficiaryId, walletAddress }
  );

  // Loading state
  if (result === undefined) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-slate-500/10 text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('screening.checking')}
      </span>
    );
  }

  // No screening result yet (pending)
  if (result === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-slate-500/10 text-slate-400">
        <ShieldQuestion className="h-3 w-3" />
        {t('screening.pending')}
      </span>
    );
  }

  const statusConfig = {
    clear: {
      icon: ShieldCheck,
      className: 'bg-green-500/10 text-green-400',
      label: t('screening.clear'),
    },
    potential_match: {
      icon: ShieldAlert,
      className: 'bg-amber-500/10 text-amber-400',
      label: t('screening.potentialMatch'),
    },
    confirmed_match: {
      icon: ShieldAlert,
      className: 'bg-red-500/10 text-red-400',
      label: t('screening.confirmedMatch'),
    },
    false_positive: {
      icon: Shield,
      className: 'bg-blue-500/10 text-blue-400',
      label: t('screening.falsePositive'),
    },
  };

  const config = statusConfig[result.status as keyof typeof statusConfig];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${config.className} ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </button>
  );
}
