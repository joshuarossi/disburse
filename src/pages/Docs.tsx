import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'

export default function Docs() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.docs.title')}
      subtitle={t('marketingPages.docs.subtitle')}
    >
      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.docs.sections.gettingStarted.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.docs.sections.gettingStarted.body')}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.docs.sections.workflows.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.docs.sections.workflows.body')}
        </p>
      </section>
    </MarketingShell>
  )
}
