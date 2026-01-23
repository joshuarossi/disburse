import { useState } from 'react';
import { Sun, Moon, Check } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { Button } from './button';
import { cn } from '@/lib/utils';

const themes = [
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
] as const;

export function ThemeSwitcher({ variant = 'ghost', size = 'sm' }: { variant?: 'default' | 'ghost' | 'secondary', size?: 'sm' | 'md' | 'lg' }) {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const currentTheme = themes.find(t => t.value === theme) || themes[1];

  const handleThemeChange = async (themeValue: 'dark' | 'light') => {
    setTheme(themeValue);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <Button
        variant={variant}
        size={size}
        onClick={() => setIsOpen(!isOpen)}
        className="gap-2 w-full justify-start"
      >
        {theme === 'light' ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
        <span>{currentTheme.label}</span>
      </Button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[46]"
            onClick={() => setIsOpen(false)}
          />
          <div 
            className="absolute right-0 top-full mt-2 z-[60] w-48 rounded-lg border shadow-xl overflow-hidden"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-bg-secondary)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {themes.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.value}
                  onClick={() => handleThemeChange(t.value)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                    theme === t.value
                      ? 'bg-accent-500/10 text-accent-400'
                      : ''
                  )}
                  style={{
                    color: theme === t.value ? undefined : 'var(--color-text-secondary)',
                    backgroundColor: theme === t.value ? undefined : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (theme !== t.value) {
                      e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (theme !== t.value) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{t.label}</span>
                  {theme === t.value && (
                    <Check className="h-4 w-4" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
