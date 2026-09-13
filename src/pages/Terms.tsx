import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'

export default function Terms() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.terms.title')}
      subtitle={t('marketingPages.terms.subtitle')}
    >
      <section>
        <h2>
          {t('marketingPages.terms.sections.service.title')}
        </h2>
        <p>
          {t('marketingPages.terms.sections.service.body')}
        </p>
      </section>

      <section>
        <h2>
          {t('marketingPages.terms.sections.billing.title')}
        </h2>
        <p>
          {t('marketingPages.terms.sections.billing.body')}
        </p>
      </section>
    </MarketingShell>
  )
}
