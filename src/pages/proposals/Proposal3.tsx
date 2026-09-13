import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  CalendarClock,
  Check,
  FileSpreadsheet,
  History,
  Layers,
  Lock,
  Menu,
  Receipt,
  ScanSearch,
  Users,
  UsersRound,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BRAND, CTA, FEATURES, FOOTER, HERO, NAV, PILLARS, PLANS, PRICING_NOTE, SAMPLE_BATCH, STATS, STEPS } from './content'
import { CountUp, EASE, Reveal, Stagger, StaggerItem, ThemeToggle } from './kit'

function Wordmark({ light }: { light?: boolean }) {
  return (
    <Link to="/" className={`c3-wordmark ${light ? 'c3-wordmark--light' : ''}`} aria-label={`${BRAND} home`}>
      <span className="c3-wordmark__dot" />
      {BRAND}
    </Link>
  )
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith('#') ? <a href={href}>{children}</a> : <Link to={href}>{children}</Link>
}

function Header() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header className={`c3-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="c3-wrap flex h-[76px] items-center justify-between gap-6">
        <Wordmark light />
        <nav className="c3-nav hidden items-center gap-2 md:flex" aria-label="Primary">
          {NAV.map(item => (
            <NavLink key={item.label} href={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Link to="/login" className="c3-btn c3-btn--ghost c3-btn--sm">
            Log in
          </Link>
          <Link to="/login" className="c3-btn c3-btn--cream c3-btn--sm">
            {HERO.primaryCta}
          </Link>
        </div>
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            className="c3-menu"
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(v => !v)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <div className="c3-mobile md:hidden">
          {NAV.map(item => (
            <NavLink key={item.label} href={item.href}>
              {item.label}
            </NavLink>
          ))}
          <div className="mt-3 flex flex-col gap-2">
            <Link to="/login" className="c3-btn c3-btn--outline">
              Log in
            </Link>
            <Link to="/login" className="c3-btn c3-btn--cream">
              {HERO.primaryCta}
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}

/* Hero mock timeline (seconds after mount). Cards deal in, then the
   approval completes and the screening chip flips to "clear". */
const T = { deal: [0.55, 0.75, 0.95], signer: 2.0, count: 2.2, signed: 2.5, chip: 2.9 }
const DEAL_SPRING = { type: 'spring', stiffness: 170, damping: 19, mass: 0.9 } as const

function HeroMock() {
  const reduce = useReducedMotion()
  const initials = ['AL', 'TR', 'PN', 'NS', 'KS', 'MK']
  // 0 idle, 1 second signer lit, 2 count ticked, 3 signed, 4 screening clear
  const [phase, setPhase] = useState(reduce ? 4 : 0)
  useEffect(() => {
    if (reduce) return
    const ids = [
      window.setTimeout(() => setPhase(1), T.signer * 1000),
      window.setTimeout(() => setPhase(2), T.count * 1000),
      window.setTimeout(() => setPhase(3), T.signed * 1000),
      window.setTimeout(() => setPhase(4), T.chip * 1000),
    ]
    return () => ids.forEach(clearTimeout)
  }, [reduce])

  const deal = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 56, rotate: i === 1 ? -9 : 7, scale: 0.94 },
    animate: { opacity: 1, y: 0, rotate: 0, scale: 1 },
    transition: { ...DEAL_SPRING, delay: T.deal[i] },
  })
  const signed = phase >= 2
  const clear = phase >= 4

  return (
    <div className="c3-stack" aria-hidden="true">
      <div className="c3-slot c3-slot--batch">
        <motion.div className="c3-card c3-card--batch" {...deal(0)}>
          <div className="flex items-center justify-between">
            <span className="c3-tag c3-tag--cobalt">Batch</span>
            <span className="c3-card__meta">{signed ? 'Approved' : 'Ready for approval'}</span>
          </div>
          <h3 className="c3-card__title">{SAMPLE_BATCH.name}</h3>
          <div className="c3-amount">
            <span>{SAMPLE_BATCH.total}</span>
            <small>{SAMPLE_BATCH.currency}</small>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 c3-card__meta">
            <span className="flex items-center gap-2">
              <span className="c3-avatars">
                {initials.slice(0, 4).map(i => (
                  <span key={i}>{i}</span>
                ))}
              </span>
              {SAMPLE_BATCH.rows.length} recipients
            </span>
            <span>
              <b>Network</b> {SAMPLE_BATCH.network}
            </span>
          </div>
          <ul className="c3-rows">
            {SAMPLE_BATCH.rows.slice(0, 3).map(r => (
              <li key={r.name}>
                <span>{r.name}</span>
                <span className="c3-mono">{r.amount}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      <div className="c3-slot c3-slot--approval">
        <motion.div className="c3-card c3-card--approval" {...deal(1)}>
          <div className="flex items-center justify-between">
            <span className="c3-tag c3-tag--coral">Approval</span>
            <span className="c3-card__meta">Threshold {SAMPLE_BATCH.approvals.need}</span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="c3-signer c3-signer--done">
              <Check size={16} strokeWidth={3} />
            </span>
            <span className={`c3-signer ${phase >= 1 ? 'c3-signer--done' : ''}`}>
              <motion.span
                className="inline-flex"
                initial={false}
                animate={phase >= 1 ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
              >
                <Check size={16} strokeWidth={3} />
              </motion.span>
            </span>
            <span className="text-[15px] font-semibold">
              {signed ? SAMPLE_BATCH.approvals.need : SAMPLE_BATCH.approvals.have} of {SAMPLE_BATCH.approvals.need} signed
            </span>
          </div>
          <div className="c3-progress">
            <motion.span initial={false} animate={{ width: signed ? '100%' : '50%' }} transition={{ duration: 0.5, ease: EASE }} />
          </div>
          <button type="button" className={`c3-btn c3-btn--sm mt-4 w-full ${phase >= 3 ? 'c3-btn--signed' : 'c3-btn--coral'}`}>
            {phase >= 3 ? (
              <>
                Signed <Check size={16} strokeWidth={3} />
              </>
            ) : (
              'Sign'
            )}
          </button>
        </motion.div>
      </div>

      <div className="c3-slot c3-slot--chip">
        <motion.div className="c3-card c3-card--chip" {...deal(2)}>
          <motion.div
            className="contents"
            initial={false}
            animate={clear && !reduce ? { scale: [1, 1.07, 1] } : { scale: 1 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <span className={`c3-chip__icon ${clear ? 'is-clear' : ''}`}>
              {clear ? <Check size={16} strokeWidth={3} /> : <ScanSearch size={16} strokeWidth={2.5} />}
            </span>
            <span>
              <b>{clear ? 'Screening clear' : 'Screening…'}</b>
              <small>{clear ? '6 of 6' : '4 of 6'} recipients checked</small>
            </span>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

function ScheduleMock() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  return (
    <div className="c3-mock" aria-hidden="true">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-semibold">Recurring · monthly</span>
        <span className="c3-tag c3-tag--cobalt">Next: 30 Sep</span>
      </div>
      <div className="c3-cal">
        {days.map((d, i) => (
          <span key={i} className={i === 1 ? 'is-pay' : i === 4 ? 'is-approve' : ''}>
            <small>{d}</small>
            {23 + i}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-[12px]">
        <span className="flex items-center gap-1.5">
          <i className="c3-dot" style={{ background: 'var(--lp-coral)' }} /> Approvals due
        </span>
        <span className="flex items-center gap-1.5">
          <i className="c3-dot" style={{ background: 'var(--lp-accent)' }} /> Pay date
        </span>
      </div>
    </div>
  )
}

function CsvMock() {
  const map = [
    ['full_name', 'Recipient name'],
    ['wallet', 'Address'],
    ['amt_usd', 'Amount'],
    ['chain', 'Network'],
  ]
  return (
    <div className="c3-mock" aria-hidden="true">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-semibold">payroll_sep.csv</span>
        <span className="c3-tag c3-tag--cobalt">6 rows · 0 duplicates</span>
      </div>
      <div className="c3-map">
        {map.map(([from, to]) => (
          <div key={from}>
            <span className="c3-mono">{from}</span>
            <ArrowRight size={14} />
            <span className="c3-map__to">{to}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const PILLAR_ICONS = [Lock, Users, ScanSearch, History]
const PILLAR_TONES = ['cobalt', 'coral', 'navy', 'sky']
const SMALL_FEATURES = [
  { ...FEATURES[1], Icon: Layers },
  { ...FEATURES[3], Icon: UsersRound },
  { ...FEATURES[4], Icon: Users },
  { ...FEATURES[5], Icon: Receipt },
]

/** Hero entrance: eyebrow → headline lines → lede → CTAs, then the mock. */
function HeroLine({ children, i, className }: { children: ReactNode; i: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, ease: EASE, delay: 0.08 + i * 0.09 }}
    >
      {children}
    </motion.div>
  )
}

export default function Proposal3() {
  const reduce = useReducedMotion()
  const drift = (from: { x: number; y: number }, delay: number) => ({
    initial: reduce ? false : { ...from, opacity: 0 },
    animate: { x: 0, y: 0, opacity: 1 },
    transition: { duration: 1.1, ease: EASE, delay },
  })
  return (
    <div className="lp lp-3">
      <Header />

      {/* Hero */}
      <section className="c3-hero">
        <motion.span className="c3-shape c3-shape--quarter" aria-hidden="true" {...drift({ x: 160, y: 160 }, 0.2)} />
        <motion.span className="c3-shape c3-shape--ring" aria-hidden="true" {...drift({ x: -140, y: -140 }, 0.1)} />
        <div className="c3-wrap relative grid items-center gap-14 py-16 md:py-24 lg:grid-cols-[1.2fr_1fr] lg:gap-12">
          <div>
            <HeroLine i={0} className="inline-block">
              <span className="c3-tag c3-tag--coral c3-tag--lg">{HERO.eyebrow}</span>
            </HeroLine>
            <h1 className="c3-h1">
              <HeroLine i={1}>Pay your people.</HeroLine>
              <HeroLine i={2}>Stay in control.</HeroLine>
            </h1>
            <HeroLine i={3}>
              <p className="c3-lede">{HERO.subtitle}</p>
            </HeroLine>
            <HeroLine i={4} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/login" className="c3-btn c3-btn--cream c3-btn--lg">
                {HERO.primaryCta} <ArrowRight size={18} className="c3-arrow" />
              </Link>
              <a href="#how" className="c3-btn c3-btn--outline c3-btn--lg">
                {HERO.secondaryCta}
              </a>
            </HeroLine>
          </div>
          <HeroMock />
        </div>
      </section>

      {/* Trust row */}
      <section className="c3-trust">
        <div className="c3-wrap flex flex-col items-center gap-5 py-10 md:flex-row md:justify-between">
          <Reveal as="p" y={12} className="text-[14px] font-medium text-(--lp-muted)">
            {HERO.trust}
          </Reveal>
          <Stagger as="div" stagger={0.06} className="flex flex-wrap items-center justify-center gap-x-9 gap-y-3">
            {HERO.trustLogos.map(l => (
              <StaggerItem key={l} y={10} className="c3-logo">
                {l}
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Pillars */}
      <section id="product" className="c3-white">
        <div className="c3-wrap py-20 md:py-28">
          <Reveal className="max-w-2xl">
            <span className="c3-kicker">Why Disburse</span>
            <h2 className="c3-h2">Built for teams that move real money.</h2>
          </Reveal>
          <Stagger className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((p, i) => {
              const Icon = PILLAR_ICONS[i]
              return (
                <StaggerItem key={p.title} className="c3-pillar">
                  <span className={`c3-icon c3-icon--${PILLAR_TONES[i]}`}>
                    <Icon size={28} strokeWidth={2.2} />
                  </span>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </StaggerItem>
              )
            })}
          </Stagger>
        </div>
      </section>

      {/* Features bento */}
      <section className="c3-cream">
        <div className="c3-wrap py-20 md:py-28">
          <Reveal className="max-w-2xl">
            <span className="c3-kicker">Features</span>
            <h2 className="c3-h2">Everything a pay run needs. Nothing it doesn't.</h2>
          </Reveal>
          <Stagger className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <StaggerItem className="c3-tile c3-tile--lg lg:col-span-2">
              <span className="c3-icon c3-icon--cobalt c3-icon--sm">
                <CalendarClock size={22} strokeWidth={2.2} />
              </span>
              <h3>{FEATURES[0].title}</h3>
              <p>{FEATURES[0].body}</p>
              <ScheduleMock />
            </StaggerItem>
            <StaggerItem className="c3-tile c3-tile--lg lg:col-span-2">
              <span className="c3-icon c3-icon--coral c3-icon--sm">
                <FileSpreadsheet size={22} strokeWidth={2.2} />
              </span>
              <h3>{FEATURES[2].title}</h3>
              <p>{FEATURES[2].body}</p>
              <CsvMock />
            </StaggerItem>
            {SMALL_FEATURES.map(({ title, body, Icon }) => (
              <StaggerItem key={title} className="c3-tile">
                <span className="c3-icon c3-icon--navy c3-icon--sm">
                  <Icon size={22} strokeWidth={2.2} />
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="c3-navy">
        <div className="c3-wrap py-20 md:py-28">
          <Reveal className="max-w-2xl">
            <span className="c3-kicker c3-kicker--coral">How it works</span>
            <h2 className="c3-h2">Three steps to your first run.</h2>
          </Reveal>
          <Stagger as="div" className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map(s => (
              <StaggerItem key={s.n} as="div" className="c3-step">
                <span className="c3-step__n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Stats */}
      <section className="c3-cream">
        <div className="c3-wrap py-14 md:py-20">
          <Stagger className="c3-stats">
            {STATS.map(s => (
              <StaggerItem key={s.label}>
                <div className="c3-stats__v">
                  <CountUp value={s.value} />
                </div>
                <div className="c3-stats__l">{s.label}</div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="c3-white">
        <div className="c3-wrap py-20 md:py-28">
          <Reveal className="mx-auto max-w-3xl text-center">
            <span className="c3-kicker">Pricing</span>
            <h2 className="c3-h2">Simple plans. No auto-renew.</h2>
          </Reveal>
          <Stagger className="mt-12 grid gap-5 lg:grid-cols-3">
            {PLANS.map(plan => (
              <StaggerItem key={plan.key} className={`c3-plan ${plan.highlight ? 'c3-plan--hot' : ''}`}>
                <div className="flex items-center justify-between">
                  <h3>{plan.name}</h3>
                  {plan.highlight && <span className="c3-tag c3-tag--coral">Most popular</span>}
                </div>
                <p className="c3-plan__blurb">{plan.blurb}</p>
                <div className="c3-plan__price">
                  <CountUp value={`$${plan.price}`} />
                  <small>/ {plan.period}</small>
                </div>
                <ul>
                  {plan.features.map(f => (
                    <li key={f}>
                      <Check size={16} strokeWidth={3} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/login" className={`c3-btn ${plan.highlight ? 'c3-btn--cream' : 'c3-btn--cobalt'} mt-auto w-full`}>
                  {plan.price === 0 ? 'Start free' : 'Start 30-day trial'}
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
          <Reveal as="p" y={12} className="mx-auto mt-8 max-w-2xl text-center text-[14px] leading-relaxed text-(--lp-muted)">
            {PRICING_NOTE}
          </Reveal>
        </div>
      </section>

      {/* Final CTA */}
      <section className="c3-cream">
        <div className="c3-wrap pb-20 pt-6 md:pb-28 md:pt-10">
          <Reveal y={32} className="c3-cta">
            <span className="c3-shape c3-shape--cta" aria-hidden="true" />
            <div className="relative">
              <span className="c3-tag c3-tag--cream">{CTA.eyebrow}</span>
              <h2 className="c3-h2 mt-5 max-w-xl">{CTA.title}</h2>
              <p className="mt-4 max-w-lg text-[17px] leading-relaxed opacity-90">{CTA.body}</p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link to="/login" className="c3-btn c3-btn--coral c3-btn--lg">
                  {CTA.button} <ArrowRight size={18} className="c3-arrow" />
                </Link>
                <span className="text-[14px] opacity-80">{CTA.note}</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="c3-footer">
        <Stagger className="c3-wrap grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <StaggerItem>
            <Wordmark light />
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed opacity-75">{FOOTER.tagline}</p>
          </StaggerItem>
          {FOOTER.columns.map(col => (
            <StaggerItem key={col.title}>
              <h4>{col.title}</h4>
              <ul>
                {col.links.map(l => (
                  <li key={l.label}>
                    <NavLink href={l.href}>{l.label}</NavLink>
                  </li>
                ))}
              </ul>
            </StaggerItem>
          ))}
        </Stagger>
        <div className="c3-wrap border-t border-(--lp-line) py-6 text-[13px] opacity-60">
          © {new Date().getFullYear()} {BRAND}. Non-custodial. Your keys, your funds.
        </div>
      </footer>
    </div>
  )
}
