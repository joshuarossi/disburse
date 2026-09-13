import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { PROPOSALS } from './content'
import { useTheme } from '@/lib/theme'
import { Moon, Sun } from 'lucide-react'
import './proposals.css'

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400..800&family=JetBrains+Mono:wght@400..700&family=Space+Grotesk:wght@500..700&family=DM+Sans:opsz,wght@9..40,400..700&display=swap'

function useProposalFonts() {
  useEffect(() => {
    if (document.querySelector('link[data-proposal-fonts]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = FONTS_HREF
    link.setAttribute('data-proposal-fonts', '')
    document.head.appendChild(link)
  }, [])
}

export function ProposalSwitcher() {
  const { pathname } = useLocation()
  const current = Number(pathname.replace('/', '')) || 1
  const info = PROPOSALS.find(p => p.id === current)
  const { theme, toggleTheme } = useTheme()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return
      const n = Number(event.key)
      if (n >= 1 && n <= PROPOSALS.length) window.location.assign(`/${n}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="proposal-switcher" role="navigation" aria-label="Landing page proposals">
      <span className="proposal-switcher__label">
        <strong>{current}. {info?.name}</strong>
        <span>{info?.note}</span>
      </span>
      <div className="proposal-switcher__buttons">
        {PROPOSALS.map(p => (
          <Link
            key={p.id}
            to={`/${p.id}`}
            className={p.id === current ? 'is-active' : undefined}
            aria-current={p.id === current ? 'page' : undefined}
            title={`${p.name} — ${p.note}`}
          >
            {p.id}
          </Link>
        ))}
      </div>
      <button
        type="button"
        className="proposal-switcher__theme"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
      <Link to="/" className="proposal-switcher__current" title="Back to the current landing page">
        Live
      </Link>
    </div>
  )
}

export default function ProposalLayout() {
  useProposalFonts()
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <>
      <Outlet />
      <ProposalSwitcher />
    </>
  )
}
