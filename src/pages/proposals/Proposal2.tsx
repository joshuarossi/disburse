import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, History, KeyRound, ShieldCheck, Users } from 'lucide-react'
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

const PILLAR_ICONS = [KeyRound, Users, ShieldCheck, History]

/* Hero entrance: eyebrow → headline lines → lead → CTAs → hint, then the mock. */
const heroItem = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}
const heroGroup = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}

/* Boot sequence for the console mock. Each stage adds an `is-sN` class; CSS does the rest. */
const BOOT_STAGES = [0, 250, 520, 1900, 2150, 2600, 2850] // bar, side, rows, signed, flash, clear, pulse
const BOOT_DONE = BOOT_STAGES.length

function SectionLabel({ n, text }: { n: string; text: string }) {
  return (
    <div className="lp2-label">
      <span className="lp2-label__slash">//</span> {n} {text}
    </div>
  )
}

function Logo() {
  return (
    <Link to="/" className="lp2-logo" aria-label={BRAND}>
      <span className="lp2-logo__mark" />
      {BRAND.toLowerCase()}
    </Link>
  )
}

function Console() {
  const b = SAMPLE_BATCH
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const [stage, setStage] = useState(reduce ? BOOT_DONE : 0)

  useEffect(() => {
    if (!inView || reduce) return
    const timers = BOOT_STAGES.map((ms, i) => window.setTimeout(() => setStage(i + 1), ms + 350))
    return () => timers.forEach(t => window.clearTimeout(t))
  }, [inView, reduce])

  const signed = stage >= 4
  const flashing = stage === 5
  const clear = stage >= 6
  const stageClasses = BOOT_STAGES.map((_, i) => (stage > i ? `is-s${i + 1}` : '')).join(' ')
  const have = signed ? b.approvals.need : b.approvals.have

  return (
    <div ref={ref} className={`lp2-console ${stageClasses}`}>
      <div className="lp2-console__bar">
        <span className="lp2-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="lp2-mono lp2-console__title">disburse — approvals / {b.name.toLowerCase()}</span>
        <span className="lp2-kbd">⌘K</span>
      </div>
      <div className="lp2-console__body">
        <aside className="lp2-console__side">
          <div className="lp2-mono lp2-side__head">Accounts</div>
          <div className="lp2-side__item is-active" style={{ '--i': 0 } as CSSProperties}>
            <span className="lp2-dot lp2-dot--live" /> Acme Ops <span className="lp2-mono lp2-side__meta">Safe 2/3</span>
          </div>
          <div className="lp2-side__item" style={{ '--i': 1 } as CSSProperties}>
            <span className="lp2-dot" /> Acme Treasury <span className="lp2-mono lp2-side__meta">Safe 3/5</span>
          </div>
          <div className="lp2-side__item" style={{ '--i': 2 } as CSSProperties}>
            <span className="lp2-dot" /> Payroll EU <span className="lp2-mono lp2-side__meta">Safe 2/2</span>
          </div>
          <div className="lp2-mono lp2-side__head mt-5">Batches</div>
          <div className="lp2-side__item" style={{ '--i': 3 } as CSSProperties}>
            Drafts <span className="lp2-mono lp2-side__meta">2</span>
          </div>
          <div className="lp2-side__item is-active" style={{ '--i': 4 } as CSSProperties}>
            Awaiting signatures <span className="lp2-mono lp2-side__meta lp2-accent">1</span>
          </div>
          <div className="lp2-side__item" style={{ '--i': 5 } as CSSProperties}>
            Settled <span className="lp2-mono lp2-side__meta">38</span>
          </div>
        </aside>

        <div className="lp2-console__main">
          <div className="lp2-main__head">
            <div>
              <div className="lp2-main__name">{b.name}</div>
              <div className="lp2-mono lp2-main__sub">
                {b.rows.length} recipients · {b.total} {b.currency} · {b.network}
              </div>
            </div>
            <span className={`lp2-badge ${signed ? 'lp2-badge--ok' : 'lp2-badge--wait'}`}>
              <span className="lp2-dot lp2-dot--live" /> {signed ? 'ready' : 'awaiting'} {have}/{b.approvals.need}
            </span>
          </div>
          <table className="lp2-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th className="lp2-hide-sm">Role</th>
                <th className="lp2-right">Amount</th>
                <th className="lp2-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => {
                const review = r.status === 'Screened' && !clear
                return (
                  <tr key={r.name} className="lp2-row" style={{ '--i': i } as CSSProperties}>
                    <td>
                      <span className="lp2-type">{r.name}</span>
                    </td>
                    <td className="lp2-hide-sm lp2-muted">{r.role}</td>
                    <td className="lp2-right lp2-mono">
                      {r.amount} <span className="lp2-muted lp2-cur">{b.currency}</span>
                    </td>
                    <td className="lp2-right">
                      <span className={`lp2-badge ${review ? 'lp2-badge--review' : 'lp2-badge--ok'}`}>
                        {review ? 'review' : r.status === 'Screened' ? 'clear' : 'ready'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="lp2-row" style={{ '--i': b.rows.length } as CSSProperties}>
                <td className="lp2-mono lp2-muted">TOTAL</td>
                <td className="lp2-hide-sm" />
                <td className="lp2-right lp2-mono">
                  {b.total} <span className="lp2-muted lp2-cur">{b.currency}</span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <aside className="lp2-console__panel">
          <div className="lp2-panel__row">
            <span>Signatures</span>
            <span className="lp2-mono">
              {have}/{b.approvals.need}
            </span>
          </div>
          <div className="lp2-progress">
            <i className="is-on" />
            <i className={signed ? 'is-on' : ''} />
          </div>
          <div className="lp2-signer">
            <span className="lp2-dot lp2-dot--live" />
            <span className="lp2-mono">0x3f8a…c1d2</span>
            <span className="lp2-mono lp2-accent ml-auto">signed</span>
          </div>
          <div className="lp2-signer">
            <span className={`lp2-dot ${signed ? 'lp2-dot--live' : ''}`} />
            <span className="lp2-mono">0x9b04…77e0</span>
            <span className={`lp2-mono ml-auto lp2-flip ${signed ? 'lp2-accent is-flipped' : 'lp2-muted'}`}>
              {signed ? 'signed' : 'pending'}
            </span>
          </div>
          <div className="lp2-panel__sep" />
          <div className="lp2-panel__row">
            <span>Screening</span>
            <span className={`lp2-badge ${clear ? 'lp2-badge--ok' : 'lp2-badge--review'} ${flashing ? 'is-flash' : ''}`}>
              {clear ? 'clear' : '1 review'}
            </span>
          </div>
          <div className="lp2-panel__row">
            <span>Network</span>
            <span className="lp2-mono">{b.network} · fee 0.42 USDC</span>
          </div>
          <div className="lp2-panel__sep" />
          <button type="button" className={`lp2-btn lp2-btn--primary w-full ${stage >= 7 ? 'is-pulse' : ''}`}>
            Sign &amp; execute <ArrowRight size={14} />
          </button>
          <div className="lp2-mono lp2-panel__foot">
            {signed ? '2 of 2 signed · ready to execute' : 'Executes when 2 of 2 have signed'}
          </div>
        </aside>
      </div>
    </div>
  )
}

function ScheduleMock() {
  const cycles = [
    { d: 'Sep 30', s: 'signed', on: true },
    { d: 'Oct 31', s: 'draft', on: false },
    { d: 'Nov 30', s: 'queued', on: false },
  ]
  return (
    <div className="lp2-mini">
      <div className="lp2-mini__head">
        <span className="lp2-mono">RECURRING · monthly</span>
        <span className="lp2-mono lp2-accent">on</span>
      </div>
      {cycles.map(c => (
        <div key={c.d} className="lp2-mini__row">
          <span className={`lp2-dot ${c.on ? 'lp2-dot--live' : ''}`} />
          <span className="lp2-mono">{c.d}</span>
          <span className="lp2-muted">Contractor payroll</span>
          <span className={`lp2-mono ml-auto ${c.on ? 'lp2-accent' : 'lp2-muted'}`}>{c.s}</span>
        </div>
      ))}
    </div>
  )
}

function CsvMock() {
  const map = [
    ['full_name', 'Recipient'],
    ['wallet', 'Address'],
    ['amt_usd', 'Amount'],
    ['net', 'Network'],
  ]
  return (
    <div className="lp2-mini">
      <div className="lp2-mini__head">
        <span className="lp2-mono">payroll_sep.csv · 142 rows</span>
        <span className="lp2-mono lp2-muted">3 duplicates</span>
      </div>
      {map.map(([from, to]) => (
        <div key={from} className="lp2-mini__row">
          <span className="lp2-mono lp2-chip">{from}</span>
          <ArrowRight size={12} className="lp2-muted" />
          <span className="lp2-mono">{to}</span>
          <Check size={12} className="lp2-accent ml-auto" />
        </div>
      ))}
    </div>
  )
}

function RolesMock() {
  const roles = [
    ['Preparer', 'drafts, imports'],
    ['Approver', 'signs up to threshold'],
    ['Member', 'allowance 2,000 USDC / mo'],
  ]
  return (
    <div className="lp2-mini">
      {roles.map(([r, d]) => (
        <div key={r} className="lp2-mini__row">
          <span className="lp2-mono lp2-chip">{r}</span>
          <span className="lp2-muted">{d}</span>
        </div>
      ))}
    </div>
  )
}

function FeeMock() {
  const lines = [
    ['Payout', '48,250.00 USDC'],
    ['Execution fee', '0.42 USDC'],
    ['Total to sign', '48,250.42 USDC'],
  ]
  return (
    <div className="lp2-mini">
      {lines.map(([k, v], i) => (
        <div key={k} className={`lp2-mini__row ${i === 2 ? 'lp2-mini__row--total' : ''}`}>
          <span className={i === 2 ? '' : 'lp2-muted'}>{k}</span>
          <span className={`lp2-mono ml-auto ${i === 2 ? 'lp2-accent' : ''}`}>{v}</span>
        </div>
      ))}
    </div>
  )
}

const BENTO: Array<{ idx: number; span: 1 | 2; mock?: ComponentType }> = [
  { idx: 0, span: 2, mock: ScheduleMock },
  { idx: 1, span: 1 },
  { idx: 3, span: 1 },
  { idx: 2, span: 2, mock: CsvMock },
  { idx: 4, span: 2, mock: RolesMock },
  { idx: 5, span: 1 },
  { idx: 6, span: 1 },
  { idx: 7, span: 2, mock: FeeMock },
]

function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}

export default function Proposal2() {
  const scrolled = useScrolled()
  const reduce = useReducedMotion()

  return (
    <div className="lp lp-2">
      <header className={`lp2-header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="lp2-wrap flex items-center gap-6 h-14">
          <Logo />
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {NAV.map(n =>
              n.href.startsWith('#') ? (
                <a key={n.href} href={n.href} className="lp2-nav">
                  {n.label}
                </a>
              ) : (
                <Link key={n.href} to={n.href} className="lp2-nav">
                  {n.label}
                </Link>
              ),
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link to="/login" className="lp2-btn lp2-btn--ghost hidden sm:inline-flex">
              Log in
            </Link>
            <Link to="/login" className="lp2-btn lp2-btn--primary">
              {HERO.primaryCta}
            </Link>
          </div>
        </div>
      </header>

      <section className="lp2-hero">
        <div className="lp2-wrap text-center">
          <motion.div variants={heroGroup} initial={reduce ? false : 'hidden'} animate="visible">
            <motion.div variants={heroItem} className="lp2-mono lp2-eyebrow">
              <span className="lp2-dot lp2-dot--live" /> {HERO.eyebrow}
            </motion.div>
            <h1 className="lp2-h1">
              <motion.span variants={heroItem} className="lp2-h1__line">
                Pay your people.
              </motion.span>{' '}
              <motion.span variants={heroItem} className="lp2-h1__line lp2-accent">
                Stay in control.
              </motion.span>
            </h1>
            <motion.p variants={heroItem} className="lp2-lead">
              {HERO.subtitle}
            </motion.p>
            <motion.div variants={heroItem} className="flex flex-wrap justify-center gap-3 mt-8">
              <Link to="/login" className="lp2-btn lp2-btn--primary lp2-btn--lg">
                {HERO.primaryCta} <ArrowRight size={16} />
              </Link>
              <a href="#how" className="lp2-btn lp2-btn--outline lp2-btn--lg">
                {HERO.secondaryCta}
              </a>
            </motion.div>
            <motion.div variants={heroItem} className="lp2-mono lp2-hint">
              <span className="lp2-kbd">⌘</span>
              <span className="lp2-kbd">K</span> to search recipients
              <span className="lp2-caret" aria-hidden />
            </motion.div>
          </motion.div>

          <motion.div
            className="lp2-hero__mock"
            initial={reduce ? false : { opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.5, ease: EASE }}
          >
            <div className="lp2-glow" aria-hidden />
            <Console />
          </motion.div>

          <Reveal className="lp2-trust" delay={0.1}>
            <span className="lp2-mono lp2-muted">{HERO.trust}</span>
            <div className="flex flex-wrap justify-center gap-2">
              {HERO.trustLogos.map(l => (
                <span key={l} className="lp2-mono lp2-chip">
                  {l}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section id="product" className="lp2-section">
        <div className="lp2-wrap">
          <Reveal>
            <SectionLabel n="01" text="PRODUCT" />
            <h2 className="lp2-h2">Built for the finance team that signs.</h2>
          </Reveal>
          <Stagger className="grid gap-px mt-10 lp2-pillars" stagger={0.07}>
            {PILLARS.map((p, i) => {
              const Icon = PILLAR_ICONS[i]
              return (
                <StaggerItem key={p.title} className="lp2-pillar">
                  <Icon size={18} className="lp2-accent" strokeWidth={1.75} />
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </StaggerItem>
              )
            })}
          </Stagger>
        </div>
      </section>

      <section className="lp2-section pt-0">
        <div className="lp2-wrap">
          <Reveal>
            <SectionLabel n="02" text="FEATURES" />
            <h2 className="lp2-h2">Everything a pay run needs. Nothing it doesn't.</h2>
          </Reveal>
          <Stagger className="lp2-bento mt-10" stagger={0.06}>
            {BENTO.map(({ idx, span, mock: Mock }) => {
              const f = FEATURES[idx]
              return (
                <StaggerItem key={f.title} className={`lp2-card ${span === 2 ? 'lp2-card--wide' : ''}`}>
                  <div className="lp2-card__text">
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                  </div>
                  {Mock ? <Mock /> : null}
                </StaggerItem>
              )
            })}
          </Stagger>
        </div>
      </section>

      <section id="how" className="lp2-section lp2-section--line">
        <div className="lp2-wrap grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <Reveal>
            <SectionLabel n="03" text="HOW IT WORKS" />
            <h2 className="lp2-h2">From spreadsheet to settled in three steps.</h2>
            <p className="lp2-p mt-4">
              Your Safe keeps its owners and threshold. Disburse prepares, screens and collects signatures.
            </p>
          </Reveal>
          <Stagger as="div" className="lp2-steps" stagger={0.1}>
            {STEPS.map(s => (
              <StaggerItem key={s.n} as="div" className="lp2-step">
                <span className="lp2-mono lp2-steps__n">{s.n}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="lp2-stats">
        <Stagger className="lp2-wrap grid grid-cols-2 lg:grid-cols-4" stagger={0.08}>
          {STATS.map(s => (
            <StaggerItem key={s.label} className="lp2-stat">
              <div className="lp2-mono lp2-stat__v">
                <CountUp value={s.value} />
              </div>
              <div className="lp2-stat__l">{s.label}</div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section id="pricing" className="lp2-section">
        <div className="lp2-wrap">
          <Reveal>
            <SectionLabel n="04" text="PRICING" />
            <h2 className="lp2-h2">Simple plans. No auto-renew.</h2>
          </Reveal>
          <Stagger className="grid gap-4 mt-10 md:grid-cols-3" stagger={0.08}>
            {PLANS.map(p => (
              <StaggerItem key={p.key} className={`lp2-plan ${p.highlight ? 'is-hot' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="lp2-mono lp2-plan__name">{p.name}</span>
                  {p.highlight ? <span className="lp2-badge lp2-badge--ok">most teams</span> : null}
                </div>
                <div className="lp2-plan__price">
                  <CountUp value={`$${p.price}`} className="lp2-mono" />
                  <span className="lp2-mono lp2-muted"> / {p.period}</span>
                </div>
                <div className="lp2-muted text-sm">{p.blurb}</div>
                <ul className="lp2-plan__list">
                  {p.features.map(f => (
                    <li key={f}>
                      <Check size={14} className="lp2-accent shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <Link to="/login" className={`lp2-btn ${p.highlight ? 'lp2-btn--primary' : 'lp2-btn--outline'} w-full mt-auto`}>
                  {p.price === 0 ? 'Start free' : 'Start 30-day trial'}
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
          <Reveal as="p" className="lp2-mono lp2-note" y={12}>
            {PRICING_NOTE}
          </Reveal>
        </div>
      </section>

      <section className="lp2-section pt-0">
        <div className="lp2-wrap">
          <Reveal className="lp2-cta">
            <div className="lp2-mono lp2-eyebrow justify-start">
              <span className="lp2-dot lp2-dot--live" /> {CTA.eyebrow}
            </div>
            <h2 className="lp2-h2 mt-3">{CTA.title}</h2>
            <p className="lp2-p mt-3 max-w-xl">{CTA.body}</p>
            <div className="flex flex-wrap items-center gap-4 mt-8">
              <Link to="/login" className="lp2-btn lp2-btn--primary lp2-btn--lg">
                {CTA.button} <ArrowRight size={16} />
              </Link>
              <span className="lp2-mono lp2-muted text-xs">{CTA.note}</span>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="lp2-footer">
        <Stagger className="lp2-wrap grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]" stagger={0.08}>
          <StaggerItem>
            <Logo />
            <p className="lp2-muted text-sm mt-4 max-w-xs">{FOOTER.tagline}</p>
            <div className="lp2-mono lp2-muted text-xs mt-6 flex items-center gap-2">
              <span className="lp2-dot lp2-dot--live" /> all systems operational
            </div>
          </StaggerItem>
          {FOOTER.columns.map(c => (
            <StaggerItem key={c.title}>
              <div className="lp2-mono lp2-footer__h">{c.title}</div>
              <ul className="space-y-2">
                {c.links.map(l => (
                  <li key={l.href}>
                    {l.href.startsWith('#') ? (
                      <a href={l.href} className="lp2-footer__a">
                        {l.label}
                      </a>
                    ) : (
                      <Link to={l.href} className="lp2-footer__a">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </StaggerItem>
          ))}
        </Stagger>
        <div className="lp2-wrap lp2-footer__bottom lp2-mono">
          <span>© {new Date().getFullYear()} {BRAND}</span>
          <span className="lp2-muted">Non-custodial · Safe approvals · Recipient screening</span>
        </div>
      </footer>
    </div>
  )
}
