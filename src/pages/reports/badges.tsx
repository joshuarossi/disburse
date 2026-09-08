import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export { StatusBadge } from '@/components/workspace/WorkspacePrimitives';

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
