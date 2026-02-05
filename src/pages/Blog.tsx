import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'

export default function Blog() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.blog.title')}
      subtitle={t('marketingPages.blog.subtitle')}
    >
      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.blog.sections.updates.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.blog.sections.updates.body')}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.blog.sections.insights.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.blog.sections.insights.body')}
        </p>
      </section>
    </MarketingShell>
  )
}
