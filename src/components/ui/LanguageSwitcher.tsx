import { useState } from 'react';
import { useSessionToken } from '@/lib/session';
import { useTranslation } from 'react-i18next';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Languages, Check } from 'lucide-react';
import { Button, type ButtonProps } from './button';
import { cn } from '@/lib/utils';

const languages = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'pt-BR', label: 'Português (Brasil)', flag: '🇧🇷' },
] as const;

type SwitcherProps = { variant?: ButtonProps['variant']; size?: ButtonProps['size']; compactOnSmallScreens?: boolean };

export function LanguageSwitcher({ variant = 'ghost', size = 'sm', compactOnSmallScreens = false }: SwitcherProps) {
  const { i18n } = useTranslation();
  const sessionToken = useSessionToken();
  const [isOpen, setIsOpen] = useState(false);
  const updatePreferredLanguage = useMutation(api.users.updatePreferredLanguage);

  const currentLanguage = languages.find(lang => lang.code === i18n.language) || languages[0];

  const handleLanguageChange = async (langCode: string) => {
    i18n.changeLanguage(langCode);
    setIsOpen(false);
    
    if (sessionToken) {
      try {
        await updatePreferredLanguage({
          sessionToken,
          preferredLanguage: langCode as 'en' | 'es' | 'pt-BR',
        });
      } catch (error) {
        console.error('Failed to update language preference:', error);
      }
    }
  };

  return (
    <div className="relative">
      <Button
        variant={variant}
        size={size}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className={cn('gap-2 w-full justify-start', compactOnSmallScreens && 'h-10 w-10 justify-center px-0 md:h-9 md:w-auto md:justify-start md:px-3')}
      >
        <Languages className="h-4 w-4" />
        <span className={compactOnSmallScreens ? 'sr-only md:not-sr-only' : undefined}>{currentLanguage.label}</span>
      </Button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[46]"
            onClick={() => setIsOpen(false)}
          />
          <div 
            className={cn('absolute right-0 top-full mt-2 z-[60] w-48 rounded-lg border border-white/10 bg-navy-900 shadow-xl overflow-hidden', compactOnSmallScreens && 'fixed inset-x-4 top-16 w-auto md:absolute md:left-auto md:right-0 md:top-full md:w-48')}
            onClick={(e) => e.stopPropagation()}
          >
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                  i18n.language === lang.code
                    ? 'bg-accent-500/10 text-accent-400'
                    : 'text-slate-300 hover:bg-navy-800 hover:text-white'
                )}
              >
                <span className="text-lg">{lang.flag}</span>
                <span className="flex-1">{lang.label}</span>
                {i18n.language === lang.code && (
                  <Check className="h-4 w-4" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
