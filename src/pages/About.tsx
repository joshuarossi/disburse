import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'

export default function About() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.about.title')}
      subtitle={t('marketingPages.about.subtitle')}
    >
      <section>
        <h2>
          {t('marketingPages.about.sections.mission.title')}
        </h2>
        <p>
          {t('marketingPages.about.sections.mission.body')}
        </p>
      </section>

      <section>
        <h2>
          {t('marketingPages.about.sections.principles.title')}
        </h2>
        <p>
          {t('marketingPages.about.sections.principles.body')}
        </p>
      </section>
    </MarketingShell>
  )
}
