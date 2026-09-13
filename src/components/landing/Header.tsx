import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { tx } from '@/lib/workspaceI18n'
import { BRAND, useLandingContent } from './content'
import { ThemeToggle } from './motion'

type NavItem = { label: string; hash?: string; to?: string }

export function NavLink({ item, className, onClick }: { item: NavItem; className?: string; onClick?: () => void }) {
  return (
    <Link to={item.hash ? { pathname: '/', hash: item.hash } : (item.to ?? '/')} className={className} onClick={onClick}>
      {item.label}
    </Link>
  )
}

/** Fixed header. Section links show from tablet up; on phones the footer carries them. */
export function Header() {
  const { nav, hero } = useLandingContent()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setScrolled(window.scrollY > 24))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <header className={`mk-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="mk-wrap mk-header__inner">
        <Link to="/" className="mk-wordmark" aria-label={BRAND}>
          <span className="mk-wordmark__full" aria-hidden>
            {BRAND}
          </span>
          <span className="mk-wordmark__mark" aria-hidden>
            {BRAND[0]}
          </span>
        </Link>
        <nav className="mk-nav" aria-label={tx('Primary')}>
          {nav.map(item => (
            <NavLink key={item.label} item={item} />
          ))}
        </nav>
        <div className="mk-header__actions">
          <Link to="/login" className="mk-textlink mk-header__login">
            {tx('Log in')}
          </Link>
          <span className="mk-lang">
            <LanguageSwitcher variant="ghost" size="sm" compactOnSmallScreens />
          </span>
          <ThemeToggle />
          <Link to="/login" className="mk-btn mk-btn--ink mk-btn--sm mk-header__cta">
            {hero.primary}
          </Link>
        </div>
      </div>
    </header>
  )
}
