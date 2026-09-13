import { useTranslation } from 'react-i18next';
import { MarketingShell } from '@/components/landing';

const sections = ['gettingStarted', 'recipients', 'workflows', 'bills', 'approvals', 'schedules', 'fees', 'recovery', 'billing', 'reports'] as const;

export default function Docs() {
  const { t } = useTranslation();
  return (
    <MarketingShell title={t('marketingPages.docs.title')} subtitle={t('marketingPages.docs.subtitle')}>
      <nav aria-label="Help topics">
        {sections.map(key => <a key={key} href={`#${key}`}>{t(`marketingPages.docs.sections.${key}.title`)}</a>)}
      </nav>
      {sections.map(key => (
        <section id={key} key={key} className="scroll-mt-24">
          <h2>{t(`marketingPages.docs.sections.${key}.title`)}</h2>
          <p>{t(`marketingPages.docs.sections.${key}.body`)}</p>
        </section>
      ))}
    </MarketingShell>
  );
}
