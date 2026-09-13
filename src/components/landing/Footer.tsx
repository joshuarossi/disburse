import { Link } from 'react-router-dom'
import { BRAND, useLandingContent } from './content'
import { Stagger, StaggerItem } from './motion'
import { NavLink } from './Header'

export function Footer() {
  const { footer } = useLandingContent()
  return (
    <footer className="mk-footer">
      <div className="mk-wrap">
        <Stagger className="mk-footer__grid" stagger={0.07}>
          <StaggerItem className="mk-footer__brand" y={12}>
            <Link to="/" className="mk-wordmark">
              {BRAND}
            </Link>
            <p className="mk-muted">{footer.tagline}</p>
          </StaggerItem>
          {footer.columns.map(c => (
            <StaggerItem key={c.title} className="mk-footer__col" y={12}>
              <span className="mk-caps mk-caps--ink">{c.title}</span>
              <ul>
                {c.links.map(l => (
                  <li key={l.label}>
                    <NavLink item={l} />
                  </li>
                ))}
              </ul>
            </StaggerItem>
          ))}
        </Stagger>
        <div className="mk-footer__legal mk-muted">
          <span>{footer.legal}</span>
          <span className="mk-mono">{footer.settlement}</span>
        </div>
      </div>
    </footer>
  )
}
