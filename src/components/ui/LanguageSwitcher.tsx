import { useState } from 'react';
import { useAccount } from 'wagmi';
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

type SwitcherProps = { variant?: ButtonProps['variant']; size?: ButtonProps['size'] };

export function LanguageSwitcher({ variant = 'ghost', size = 'sm' }: SwitcherProps) {
  const { i18n } = useTranslation();
  const { address } = useAccount();
  const [isOpen, setIsOpen] = useState(false);
  const updatePreferredLanguage = useMutation(api.users.updatePreferredLanguage);

  const currentLanguage = languages.find(lang => lang.code === i18n.language) || languages[0];

  const handleLanguageChange = async (langCode: string) => {
    i18n.changeLanguage(langCode);
    setIsOpen(false);
    
    if (address) {
      try {
        await updatePreferredLanguage({
          walletAddress: address,
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
        className="gap-2 w-full justify-start"
      >
        <Languages className="h-4 w-4" />
        <span>{currentLanguage.label}</span>
      </Button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[46]"
            onClick={() => setIsOpen(false)}
          />
          <div 
            className="absolute right-0 top-full mt-2 z-[60] w-48 rounded-lg border border-white/10 bg-navy-900 shadow-xl overflow-hidden"
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
