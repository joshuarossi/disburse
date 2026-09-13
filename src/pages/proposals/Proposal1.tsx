import { motion, useInView, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BRAND,
  CTA,
  FEATURES,
  FOOTER,
  HERO,
  NAV,
  PILLARS,
  PLANS,
  PRICING_NOTE,
  SAMPLE_BATCH,
  STATS,
  STEPS,
} from './content'
import { CountUp, EASE, Reveal, Stagger, StaggerItem, ThemeToggle } from './kit'

const pad = (n: number) => String(n).padStart(2, '0')

function SectionHead({ n, label, title }: { n: string; label: string; title: ReactNode }) {
  return (
    <Reveal className="l1-section-head" y={16}>
      <span className="l1-caps l1-caps--accent">
        No. {n} · {label}
      </span>
      <h2 className="l1-serif text-[28px] sm:text-[32px] md:text-[38px] md:max-w-[24ch]">{title}</h2>
    </Reveal>
  )
}

function NavLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return href.startsWith('#') ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link to={href} className={className}>
      {children}
    </Link>
  )
}

/* Mock timeline (seconds): rows print 0.25→1.3, subtotal counts 1.3→2.1,
   approvals tick at 2.15, stamp lands at 2.6. One-shot, then still. */
const ROW_START = 0.25
const ROW_GAP = 0.16
const SUBTOTAL_AT = 1.3
const APPROVE_AT = 2150
const STAMP_AT = 2600

function Ledger() {
  const b = SAMPLE_BATCH
  const pending = b.rows.find(r => r.name.startsWith('Priya'))?.name.split(' ')[0] ?? 'Priya'
  const total = Number(b.total.replace(/,/g, ''))

  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const reduce = useReducedMotion()
  const play = inView && !reduce

  const [subtotal, setSubtotal] = useState(reduce ? total : 0)
  const [approved, setApproved] = useState(!!reduce)
  const [stamped, setStamped] = useState(!!reduce)

  useEffect(() => {
    if (!play) return
    const t0 = performance.now() + SUBTOTAL_AT * 1000
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 800)
      if (p >= 0) setSubtotal(Math.round(total * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const a = window.setTimeout(() => setApproved(true), APPROVE_AT)
    const s = window.setTimeout(() => setStamped(true), STAMP_AT)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(a)
      window.clearTimeout(s)
    }
  }, [play, total])

  return (
    <div ref={ref} className="l1-ledger relative">
      <span className="l1-stamp">
        {approved ? 'Ready' : 'Draft'} · {b.rows.length} payouts
      </span>
      <div className="px-6 pt-6 pb-4">
        <div className="l1-caps">Batch</div>
        <div className="l1-serif mt-1 text-[20px] leading-tight pr-32">{b.name}</div>
        <div className="l1-mono mt-1 text-[12px] l1-muted">
          {b.currency} · {b.network} · Pay date 30 Sep
        </div>
      </div>
      <div className="px-6">
        <table>
          <thead>
            <tr className="l1-caps">
              <th>Recipient</th>
              <th className="hidden sm:table-cell">Role</th>
              <th className="l1-num">Amount</th>
              <th className="l1-num">Status</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <motion.tr
                key={r.name}
                initial={reduce ? false : { opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
                animate={play ? { opacity: 1, clipPath: 'inset(0 0% 0 0)' } : undefined}
                transition={{ delay: ROW_START + i * ROW_GAP, duration: 0.32, ease: 'linear' }}
              >
                <td className="font-medium">{r.name}</td>
                <td className="hidden sm:table-cell l1-muted">{r.role}</td>
                <td className="l1-num l1-mono">{r.amount}</td>
                <td className="l1-num">
                  <span className={`l1-chip ${r.status === 'Screened' ? 'l1-chip--green' : ''}`}>
                    {r.status === 'Screened' && <i className="l1-dot" />}
                    {r.status}
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mx-6 mt-2 flex items-baseline justify-between border-t border-(--lp-fg) py-3">
        <span className="l1-caps l1-caps--ink">Subtotal</span>
        <span className="l1-mono text-[15px] font-semibold">
          {subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
          <span className="text-[11px] l1-muted font-medium">{b.currency}</span>
        </span>
      </div>
      <div className="l1-ledger-foot flex flex-wrap items-center justify-between gap-2 border-t border-(--lp-line) px-6 py-3 text-[12px] rounded-b-[6px]">
        <span className="inline-flex items-center gap-2">
          <span className="l1-sig" aria-hidden>
            <span className="is-done" />
            <span className={approved ? 'is-done' : ''} />
          </span>
          <motion.span
            key={approved ? 'ready' : 'awaiting'}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            {approved
              ? `Approvals ${b.approvals.need} of ${b.approvals.need} · ready to execute`
              : `Approvals ${b.approvals.have} of ${b.approvals.need} · awaiting ${pending}`}
          </motion.span>
        </span>
        <span className="l1-chip l1-chip--green">
          <i className="l1-dot" />
          Screened
        </span>
      </div>
      {stamped && (
        <motion.span
          className="l1-approved"
          aria-hidden
          initial={reduce ? false : { opacity: 0, scale: 1.3, rotate: -14 }}
          animate={{ opacity: 1, scale: 1, rotate: -8 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          Approved
        </motion.span>
      )}
    </div>
  )
}

const heroItem = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

export default function Proposal1() {
  const team = PLANS.find(p => p.highlight)
  const reduce = useReducedMotion()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="lp lp-1">
      <header className={`l1-header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="l1-wrap flex h-16 items-center justify-between gap-6">
          <Link to="/" className="l1-wordmark">
            {BRAND}
          </Link>
          <nav className="l1-nav hidden md:flex items-center gap-7">
            {NAV.map(n => (
              <NavLink key={n.href} href={n.href}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link to="/login" className="l1-textlink hidden sm:inline">
              Log in
            </Link>
            <ThemeToggle />
            <Link to="/login" className="l1-btn l1-btn--ink l1-btn--sm">
              {HERO.primaryCta}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="l1-wrap pt-14 pb-12 md:pt-24 md:pb-16">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-10 items-center">
          <motion.div
            className="lg:col-span-6"
            initial={reduce ? false : 'hidden'}
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } }}
          >
            <motion.div variants={heroItem} className="l1-caps l1-caps--accent">
              § {HERO.eyebrow}
            </motion.div>
            <h1 className="l1-display mt-6 text-[44px] sm:text-[56px] md:text-[64px] xl:text-[72px]">
              <motion.span variants={heroItem} className="block">
                Pay your people.
              </motion.span>
              <motion.span variants={heroItem} className="block">
                Stay in <em>control</em>.
              </motion.span>
            </h1>
            <motion.p variants={heroItem} className="mt-6 max-w-[52ch] text-[17px] leading-relaxed l1-muted">
              {HERO.subtitle}
            </motion.p>
            <motion.div variants={heroItem} className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/login" className="l1-btn l1-btn--ink">
                {HERO.primaryCta} <ArrowRight size={16} />
              </Link>
              <a href="#how" className="l1-btn l1-btn--ghost">
                {HERO.secondaryCta}
              </a>
            </motion.div>
            <motion.p variants={heroItem} className="mt-5 text-[13px] l1-muted">
              {CTA.note} · Non-custodial by design
            </motion.p>
          </motion.div>
          <motion.div
            className="lg:col-span-6"
            initial={reduce ? false : { opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.45 }}
          >
            <Ledger />
          </motion.div>
        </div>

        <Reveal
          y={12}
          className="mt-16 md:mt-20 border-t border-(--lp-line) pt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
        >
          <span className="l1-caps">{HERO.trust}</span>
          <div className="l1-trust">
            {HERO.trustLogos.map(l => (
              <span key={l}>{l}</span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Pillars */}
      <section id="product" className="l1-wrap pt-10 pb-16 md:pt-16 md:pb-24 scroll-mt-16">
        <SectionHead n="01" label="Principles" title="Built so the company, not the vendor, holds the keys." />
        <Stagger className="l1-pillars mt-6" stagger={0.08}>
          {PILLARS.map((p, i) => (
            <StaggerItem key={p.title} className="l1-pillar">
              <div className="l1-mono text-[12px] l1-muted">{pad(i + 1)}</div>
              <h3 className="l1-serif mt-3 text-[26px] md:text-[30px]">{p.title}</h3>
              <p className="mt-3 max-w-[44ch] text-[15px] leading-relaxed l1-muted">{p.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Features */}
      <section className="l1-wrap pb-16 md:pb-24">
        <SectionHead n="02" label="In practice" title="Everything a pay run needs, and nothing it doesn't." />
        <Stagger className="l1-features mt-6" stagger={0.06}>
          {FEATURES.map((f, i) => (
            <StaggerItem key={f.title} className="l1-feature" y={14}>
              <span className="l1-mono text-[12px] l1-muted pt-[3px]">{pad(i + 1)}</span>
              <div>
                <h3 className="text-[16px] font-semibold">{f.title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed l1-muted">{f.body}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16 border-y border-(--lp-line) bg-(--lp-surface)">
        <div className="l1-wrap py-16 md:py-24">
          <SectionHead n="03" label="How it works" title="Three steps from spreadsheet to settled." />
          <Stagger className="l1-steps mt-12 md:mt-16" stagger={0.1}>
            {STEPS.map(s => (
              <StaggerItem key={s.n} className="l1-step">
                <div className="l1-mono text-[12px] l1-caps--accent">Step {s.n}</div>
                <h3 className="l1-serif mt-3 text-[22px] md:text-[24px]">{s.title}</h3>
                <p className="mt-3 text-[14px] leading-relaxed l1-muted max-w-[38ch]">{s.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Stats */}
      <section className="l1-wrap pt-16 md:pt-24">
        <Stagger className="l1-stats" stagger={0.08}>
          {STATS.map(s => (
            <StaggerItem key={s.label} className="l1-stat" y={12}>
              <div className="l1-serif text-[44px] md:text-[56px] leading-none">
                <CountUp value={s.value} />
              </div>
              <div className="mt-3 text-[13px] l1-muted">{s.label}</div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Quote */}
      <section className="l1-wrap py-16 md:py-24">
        <Reveal className="mx-auto max-w-[820px] text-center">
          <div className="l1-caps l1-caps--accent">Sample · What we hear from finance teams</div>
          <blockquote className="l1-quote mt-6 text-[26px] sm:text-[34px] md:text-[40px]">
            “We used to chase two signatures over chat and reconcile from screenshots. Now the batch, the approvals and
            the record are the same document.”
          </blockquote>
          <div className="mt-6 text-[13px] l1-muted">Finance operations, 40-person studio · illustrative</div>
        </Reveal>
      </section>

      {/* Pricing */}
      <section id="pricing" className="l1-wrap pb-16 md:pb-24 scroll-mt-16">
        <SectionHead n="04" label="Pricing" title="Simple plans. No auto-renewal." />
        <Stagger className="l1-plans mt-8" stagger={0.1}>
          {PLANS.map(p => (
            <StaggerItem key={p.key} className={`l1-plan ${p.highlight ? 'l1-plan--team' : ''}`} y={16}>
              <div className="flex items-baseline justify-between">
                <span className="l1-serif text-[24px]">{p.name}</span>
                {p.highlight && <span className="l1-chip l1-chip--green">Most teams</span>}
              </div>
              <div className="mt-1 text-[13px] l1-muted">{p.blurb}</div>
              <div className="mt-6 flex items-baseline gap-2">
                <CountUp
                  value={`$${p.price}`}
                  className="l1-mono text-[40px] font-medium leading-none tracking-tight"
                />
                <span className="text-[13px] l1-muted">/ {p.period}</span>
              </div>
              <Link to="/login" className={`l1-btn mt-6 ${p.highlight ? 'l1-btn--ink' : 'l1-btn--ghost'}`}>
                {p.price === 0 ? 'Start free' : `Try ${p.name} free`}
              </Link>
              <ul className="mt-6">
                {p.features.map(f => (
                  <li key={f}>
                    <Check size={14} strokeWidth={2.5} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </StaggerItem>
          ))}
        </Stagger>
        <Reveal as="p" y={10} className="mt-5 max-w-[70ch] text-[13px] leading-relaxed l1-muted">
          {PRICING_NOTE}
          {team ? ` Every new organization starts with a 30-day ${team.name} trial; it does not renew unless you choose a plan.` : ''}
        </Reveal>
      </section>

      {/* Final CTA */}
      <section className="l1-wrap pb-16 md:pb-24">
        <Reveal className="l1-panel px-6 py-12 sm:px-12 md:px-16 md:py-16">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-12 md:items-end">
            <div className="md:col-span-8">
              <div className="l1-caps">§ {CTA.eyebrow}</div>
              <h2 className="l1-display mt-5 text-[36px] sm:text-[44px] md:text-[52px]">
                Make your next pay run <em>easier</em>.
              </h2>
              <p className="l1-panel-muted mt-5 max-w-[50ch] text-[16px] leading-relaxed">{CTA.body}</p>
            </div>
            <div className="md:col-span-4 flex flex-col items-start gap-3 md:items-end">
              <Link to="/login" className="l1-btn l1-btn--paper">
                {CTA.button} <ArrowRight size={16} />
              </Link>
              <span className="l1-panel-muted text-[12px]">{CTA.note}</span>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="l1-footer border-t border-(--lp-line)">
        <div className="l1-wrap py-12">
          <Stagger className="grid grid-cols-2 gap-10 md:grid-cols-12" stagger={0.07}>
            <StaggerItem className="col-span-2 md:col-span-6" y={12}>
              <div className="l1-wordmark">{BRAND}</div>
              <p className="mt-3 max-w-[36ch] text-[14px] l1-muted">{FOOTER.tagline}</p>
            </StaggerItem>
            {FOOTER.columns.map(c => (
              <StaggerItem key={c.title} className="md:col-span-2" y={12}>
                <div className="l1-caps l1-caps--ink">{c.title}</div>
                <ul className="mt-4 space-y-2.5">
                  {c.links.map(l => (
                    <li key={l.href}>
                      <NavLink href={l.href}>{l.label}</NavLink>
                    </li>
                  ))}
                </ul>
              </StaggerItem>
            ))}
          </Stagger>
          <div className="mt-12 flex flex-col gap-2 border-t border-(--lp-line) pt-6 text-[12px] l1-muted sm:flex-row sm:justify-between">
            <span>© {new Date().getFullYear()} {BRAND}. Non-custodial. Your keys, your funds.</span>
            <span className="l1-mono">Settlement on Ethereum, Base and Polygon</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
