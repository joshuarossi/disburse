import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'

export default function Privacy() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.privacy.title')}
      subtitle={t('marketingPages.privacy.subtitle')}
    >
      <section>
        <h2>
          {t('marketingPages.privacy.sections.collection.title')}
        </h2>
        <p>
          {t('marketingPages.privacy.sections.collection.body')}
        </p>
      </section>

      <section>
        <h2>
          {t('marketingPages.privacy.sections.usage.title')}
        </h2>
        <p>
          {t('marketingPages.privacy.sections.usage.body')}
        </p>
      </section>
    </MarketingShell>
  )
}
