import { type ReactNode } from 'react'
import { Header } from './Header'
import { Footer } from './Footer'

type MarketingShellProps = {
  title: string
  subtitle?: string
  children?: ReactNode
}

export function MarketingShell({ title, subtitle, children }: MarketingShellProps) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <Header />
      <main className="pt-24 pb-24">
        <section className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="rounded-3xl border border-white/10 bg-navy-900/50 p-8 sm:p-10">
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-4 text-lg text-slate-400">
                {subtitle}
              </p>
            ) : null}
          </div>

          {children ? (
            <div className="mt-10 space-y-8">
              {children}
            </div>
          ) : null}
        </section>
      </main>
      <Footer />
    </div>
  )
}
