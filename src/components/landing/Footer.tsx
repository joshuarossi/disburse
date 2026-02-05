import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LANDING_FOOTER_LINKS, type LandingLink } from '@/lib/landingLinks'

const HASH_SCROLL_ATTEMPTS = 8

export function Footer() {
  const { t } = useTranslation();
  const location = useLocation()
  const navigate = useNavigate()

  const scrollToHash = (hash: string) => {
    const id = decodeURIComponent(hash.replace('#', ''))
    let attempts = 0

    const tryScroll = () => {
      const element = document.getElementById(id)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }

      attempts += 1
      if (attempts < HASH_SCROLL_ATTEMPTS) {
        window.setTimeout(tryScroll, 150)
      }
    }

    tryScroll()
  }

  const renderLink = (link: LandingLink) => {
    const isExternal = link.external || /^https?:\/\//.test(link.href) || link.href.startsWith('mailto:')

    if (isExternal) {
      return (
        <a
          href={link.href}
          className="text-sm text-slate-400 transition-colors hover:text-white"
          target="_blank"
          rel="noreferrer"
        >
          {t(link.nameKey)}
        </a>
      )
    }

    const hashIndex = link.href.indexOf('#')
    if (hashIndex >= 0) {
      const targetPathRaw = link.href.slice(0, hashIndex)
      const targetPath = targetPathRaw || '/'
      const hash = link.href.slice(hashIndex)
      const fullHref = `${targetPath}${hash}`
      const isOnTarget = location.pathname === targetPath

      return (
        <a
          href={fullHref}
          className="text-sm text-slate-400 transition-colors hover:text-white"
          onClick={(event) => {
            if (isOnTarget) {
              event.preventDefault()
              if (location.hash !== hash) {
                window.location.hash = hash
              }
              window.setTimeout(() => scrollToHash(hash), 0)
              return
            }

            event.preventDefault()
            navigate({ pathname: targetPath, hash })
          }}
        >
          {t(link.nameKey)}
        </a>
      )
    }

    const linkTo = link.href.startsWith('/') ? link.href : `/${link.href}`

    return (
      <Link
        to={linkTo}
        className="text-sm text-slate-400 transition-colors hover:text-white"
      >
        {t(link.nameKey)}
      </Link>
    )
  }
  return (
    <footer className="border-t border-white/5 bg-navy-950">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-400">
                <svg
                  className="h-4 w-4 text-navy-950"
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
              <span className="text-lg font-bold text-white">Disburse</span>
            </Link>
            <p className="mt-4 text-sm text-slate-500">
              {t('landing.footer.tagline')}
            </p>
          </div>

          {/* Product links */}
          <div>
            <h3 className="text-sm font-semibold text-white">{t('landing.footer.product')}</h3>
            <ul className="mt-4 space-y-3">
              {LANDING_FOOTER_LINKS.product.map((link) => (
                <li key={link.nameKey}>
                  {renderLink(link)}
                </li>
              ))}
            </ul>
          </div>

          {/* Company links */}
          <div>
            <h3 className="text-sm font-semibold text-white">{t('landing.footer.company')}</h3>
            <ul className="mt-4 space-y-3">
              {LANDING_FOOTER_LINKS.company.map((link) => (
                <li key={link.nameKey}>
                  {renderLink(link)}
                </li>
              ))}
            </ul>
          </div>

          {/* Legal links */}
          <div>
            <h3 className="text-sm font-semibold text-white">{t('landing.footer.legal')}</h3>
            <ul className="mt-4 space-y-3">
              {LANDING_FOOTER_LINKS.legal.map((link) => (
                <li key={link.nameKey}>
                  {renderLink(link)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 border-t border-white/5 pt-8">
          <p className="text-center text-sm text-slate-500">
            {t('landing.footer.copyright', { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  )
}
