import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'

export default function Privacy() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.privacy.title')}
      subtitle={t('marketingPages.privacy.subtitle')}
    >
      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.privacy.sections.collection.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.privacy.sections.collection.body')}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.privacy.sections.usage.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.privacy.sections.usage.body')}
        </p>
      </section>
    </MarketingShell>
  )
}
