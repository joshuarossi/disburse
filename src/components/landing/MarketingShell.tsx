import { type ReactNode } from 'react'
import { Header } from './Header'
import { Footer } from './Footer'
import { Reveal } from './motion'

type MarketingShellProps = {
  title: string
  subtitle?: string
  children?: ReactNode
}

/** Frame for the secondary public pages (docs, about, legal) in the landing identity. */
export function MarketingShell({ title, subtitle, children }: MarketingShellProps) {
  return (
    <div className="mk mk-shell">
      <Header />
      <main className="mk-shell__main">
        <div className="mk-wrap">
          <Reveal className="mk-shell__head" y={16}>
            <h1 className="mk-display">{title}</h1>
            {subtitle ? <p className="mk-muted">{subtitle}</p> : null}
          </Reveal>
          {children ? <div className="mk-shell__body">{children}</div> : null}
        </div>
      </main>
      <Footer />
    </div>
  )
}
