import { ReactNode, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useTranslation } from 'react-i18next';
import '../lib/i18n'; // Initialize i18n

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { address } = useAccount();
  const { i18n } = useTranslation();
  
  const session = useQuery(
    api.auth.getSession,
    address ? { walletAddress: address } : 'skip'
  );

  useEffect(() => {
    if (session?.preferredLanguage) {
      // Set language from user preference
      i18n.changeLanguage(session.preferredLanguage);
    } else if (!i18n.language || !['en', 'es', 'pt-BR'].includes(i18n.language)) {
      // Fallback to browser language or English
      const browserLang = navigator.language;
      if (browserLang.startsWith('es')) {
        i18n.changeLanguage('es');
      } else if (browserLang.startsWith('pt')) {
        i18n.changeLanguage('pt-BR');
      } else {
        i18n.changeLanguage('en');
      }
    }
  }, [session?.preferredLanguage, i18n]);

  return <>{children}</>;
}
