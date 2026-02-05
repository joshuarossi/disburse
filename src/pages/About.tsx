import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'

export default function About() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.about.title')}
      subtitle={t('marketingPages.about.subtitle')}
    >
      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.about.sections.mission.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.about.sections.mission.body')}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.about.sections.principles.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.about.sections.principles.body')}
        </p>
      </section>
    </MarketingShell>
  )
}
