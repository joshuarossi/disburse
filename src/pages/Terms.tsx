import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'

export default function Terms() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.terms.title')}
      subtitle={t('marketingPages.terms.subtitle')}
    >
      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.terms.sections.service.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.terms.sections.service.body')}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.terms.sections.billing.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.terms.sections.billing.body')}
        </p>
      </section>
    </MarketingShell>
  )
}
