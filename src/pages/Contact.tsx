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
      <section>
        <h2>
          {t('marketingPages.contact.sections.sales.title')}
        </h2>
        <p>
          {t('marketingPages.contact.sections.sales.body', {
            salesEmail: LANDING_CONTACT.salesEmail,
          })}
        </p>
        <a
          href={`mailto:${LANDING_CONTACT.salesEmail}`}
          className="mk-shell__link"
        >
          {LANDING_CONTACT.salesEmail}
        </a>
      </section>

      <section>
        <h2>
          {t('marketingPages.contact.sections.support.title')}
        </h2>
        <p>
          {t('marketingPages.contact.sections.support.body', {
            supportEmail: LANDING_CONTACT.supportEmail,
          })}
        </p>
        <a
          href={`mailto:${LANDING_CONTACT.supportEmail}`}
          className="mk-shell__link"
        >
          {LANDING_CONTACT.supportEmail}
        </a>
      </section>
    </MarketingShell>
  )
}
