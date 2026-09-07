import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export function StatusBadge({ status }: { status: string }) {
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

export function DirectionBadge({ direction }: { direction: 'inflow' | 'outflow' }) {
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
