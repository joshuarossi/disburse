import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { buttonVariants } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher'
import { cn } from '@/lib/utils'

export function Header() {
  const { t } = useTranslation();
  return (
    <header 
      className="fixed top-0 left-0 right-0 z-50 border-b backdrop-blur-xl"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-bg-secondary)',
        opacity: 0.95,
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <nav className="flex h-16 items-center justify-between gap-3">
          {/* Logo */}
          <Link to="/" aria-label="Disburse" className="flex shrink-0 items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-400">
              <svg
                className="h-5 w-5 text-navy-950"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <span className="hidden text-xl font-bold tracking-tight sm:inline" style={{ color: 'var(--color-text-primary)' }}>
              Disburse
            </span>
          </Link>

          {/* Navigation */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <ThemeSwitcher variant="ghost" size="sm" compactOnSmallScreens />
            <LanguageSwitcher variant="ghost" size="sm" compactOnSmallScreens />
            <Link to="/login" className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'hidden sm:inline-flex')}>
                {t('landing.header.login')}
              </Link>
            <Link to="/login" className={buttonVariants({ size: 'sm' })}>{t('landing.header.tryForFree')}</Link>
          </div>
        </nav>
      </div>
    </header>
  )
}
