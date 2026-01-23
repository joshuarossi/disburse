import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'

export function Header() {
  const { t } = useTranslation();
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-navy-950/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <nav className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
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
            <span className="text-xl font-bold tracking-tight text-white">
              Disburse
            </span>
          </Link>

          {/* Navigation */}
          <div className="flex items-center gap-3">
            <LanguageSwitcher variant="ghost" size="sm" />
            <Link to="/login">
              <Button variant="ghost" size="sm">
                {t('landing.header.login')}
              </Button>
            </Link>
            <Link to="/login">
              <Button size="sm">{t('landing.header.tryForFree')}</Button>
            </Link>
          </div>
        </nav>
      </div>
    </header>
  )
}
