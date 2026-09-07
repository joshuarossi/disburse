import { useTranslation } from 'react-i18next';
import { MarketingShell } from '@/components/landing';

const sections = ['gettingStarted', 'recipients', 'workflows', 'bills', 'approvals', 'schedules', 'fees', 'recovery', 'billing', 'reports'] as const;

export default function Docs() {
  const { t } = useTranslation();
  return (
    <MarketingShell title={t('marketingPages.docs.title')} subtitle={t('marketingPages.docs.subtitle')}>
      <nav aria-label="Help topics" className="flex flex-wrap gap-3">
        {sections.map(key => <a key={key} href={`#${key}`} className="text-sm text-accent-400 underline underline-offset-4">{t(`marketingPages.docs.sections.${key}.title`)}</a>)}
      </nav>
      {sections.map(key => (
        <section id={key} key={key} className="scroll-mt-24 rounded-2xl border border-white/10 bg-navy-900/40 p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-white">{t(`marketingPages.docs.sections.${key}.title`)}</h2>
          <p className="mt-3 leading-7 text-slate-400">{t(`marketingPages.docs.sections.${key}.body`)}</p>
        </section>
      ))}
    </MarketingShell>
  );
}
