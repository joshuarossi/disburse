import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function PageLoading() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex min-h-screen items-center justify-center gap-3 bg-navy-950 text-slate-400"
    >
      <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin" />
      <span>{t('common.loading', { defaultValue: 'Loading...' })}</span>
    </div>
  );
}
