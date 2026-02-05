import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'
import { LANDING_CONTACT } from '@/lib/landingLinks'

export default function Contact() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.contact.title')}
      subtitle={t('marketingPages.contact.subtitle')}
    >
      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.contact.sections.sales.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.contact.sections.sales.body', {
            salesEmail: LANDING_CONTACT.salesEmail,
          })}
        </p>
        <a
          href={`mailto:${LANDING_CONTACT.salesEmail}`}
          className="mt-4 inline-flex text-sm font-medium text-accent-400 hover:text-accent-300"
        >
          {LANDING_CONTACT.salesEmail}
        </a>
      </section>

      <section className="rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">
          {t('marketingPages.contact.sections.support.title')}
        </h2>
        <p className="mt-3 text-slate-400">
          {t('marketingPages.contact.sections.support.body', {
            supportEmail: LANDING_CONTACT.supportEmail,
          })}
        </p>
        <a
          href={`mailto:${LANDING_CONTACT.supportEmail}`}
          className="mt-4 inline-flex text-sm font-medium text-accent-400 hover:text-accent-300"
        >
          {LANDING_CONTACT.supportEmail}
        </a>
      </section>
    </MarketingShell>
  )
}
