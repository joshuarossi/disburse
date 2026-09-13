import { useTranslation } from 'react-i18next'
import { MarketingShell } from '@/components/landing'

export default function Blog() {
  const { t } = useTranslation()

  return (
    <MarketingShell
      title={t('marketingPages.blog.title')}
      subtitle={t('marketingPages.blog.subtitle')}
    >
      <section>
        <h2>
          {t('marketingPages.blog.sections.updates.title')}
        </h2>
        <p>
          {t('marketingPages.blog.sections.updates.body')}
        </p>
      </section>

      <section>
        <h2>
          {t('marketingPages.blog.sections.insights.title')}
        </h2>
        <p>
          {t('marketingPages.blog.sections.insights.body')}
        </p>
      </section>
    </MarketingShell>
  )
}
