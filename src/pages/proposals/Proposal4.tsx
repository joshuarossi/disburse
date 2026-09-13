import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  BarChart3,
  Check,
  CreditCard,
  FileText,
  History,
  LayoutDashboard,
  Lock,
  Search,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react'
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

const SIDEBAR = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Recipients', icon: UsersRound },
  { label: 'Payments', icon: CreditCard, active: true },
  { label: 'Invoices', icon: FileText },
  { label: 'Treasury', icon: Wallet },
  { label: 'Reports', icon: BarChart3 },
  { label: 'Team', icon: Users },
  { label: 'Settings', icon: Settings },
]

const PILLAR_ICONS = [Lock, UsersRound, ShieldCheck, History]
const PILLAR_TINTS = ['violet', 'sky', 'mint', 'amber']

const SPOTLIGHTS = [
  { feature: FEATURES[0], mock: 'schedule' },
  { feature: FEATURES[2], mock: 'import' },
  { feature: FEATURES[5], mock: 'reconcile' },
] as const

const initials = (name: string) =>
  name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')

/** Transition helper: honours reduced motion by collapsing to an instant change. */
const useTiming = () => {
  const reduce = useReducedMotion()
  return (delay: number, duration = 0.4) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE })
}

/** Runs a one-shot sequence when the element scrolls into view. */
function useSequence<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const reduce = useReducedMotion()
  return { ref, play: inView || !!reduce }
}

function Logo() {
  return (
    <Link to="/" className="c4-logo" aria-label={BRAND}>
      <span className="c4-logo__mark" aria-hidden>
        <span />
      </span>
      {BRAND}
    </Link>
  )
}

function NavLinks({ onClick }: { onClick?: () => void }) {
  return (
    <>
      {NAV.map(n =>
        n.href.startsWith('#') ? (
          <a key={n.label} href={n.href} onClick={onClick}>
            {n.label}
          </a>
        ) : (
          <Link key={n.label} to={n.href} onClick={onClick}>
            {n.label}
          </Link>
        ),
      )}
    </>
  )
}

/* Timeline (seconds after the window settles):
   0.1 sidebar highlight · 0.3+ rows fade in, pills flip Draft → Ready ·
   1.3 drawer slides in · 1.9 approvals fill to 2 of 2 · 2.1 second signer ticks · 2.5 Approve glows */
const SEQ = { side: 0.1, rows: 0.3, rowGap: 0.11, pill: 0.45, drawer: 1.3, fill: 1.9, sign: 2.1, glow: 2.5 }

function AppWindow({ start }: { start: number }) {
  const b = SAMPLE_BATCH
  const t = useTiming()
  const reduce = useReducedMotion()
  const [signed, setSigned] = useState(!!reduce)
  const at = (s: number) => start + s

  useEffect(() => {
    if (reduce) return
    const id = window.setTimeout(() => setSigned(true), at(SEQ.fill) * 1000)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, [reduce])

  const have = signed ? b.approvals.need : b.approvals.have

  return (
    <div className="c4-window" role="img" aria-label="Disburse app: review and approve a payment batch">
      <div className="c4-window__chrome">
        <span className="c4-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="c4-window__url">app.disburse.io / payments / new-batch</span>
      </div>
      <div className="c4-window__body">
        <aside className="c4-side">
          <div className="c4-side__org">
            <span className="c4-side__avatar">NS</span>
            <span>Northwind Studio</span>
          </div>
          {SIDEBAR.map(({ label, icon: Icon, active }) => (
            <div key={label} className={`c4-side__item${active ? ' is-active' : ''}`}>
              {active && (
                <motion.i className="c4-side__hl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(at(SEQ.side), 0.35)} />
              )}
              <Icon size={14} strokeWidth={1.8} />
              {label}
            </div>
          ))}
        </aside>

        <main className="c4-main">
          <div className="c4-main__head">
            <div>
              <div className="c4-main__crumb">Payments / New batch</div>
              <h3>{b.name}</h3>
            </div>
            <span className="c4-pill c4-pill--grey">
              {b.currency} · {b.network}
            </span>
          </div>
          <table className="c4-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Role</th>
                <th className="c4-num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => {
                const rowAt = at(SEQ.rows + i * SEQ.rowGap)
                return (
                  <motion.tr key={r.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={t(rowAt, 0.4)}>
                    <td>
                      <span className="c4-avatar">{initials(r.name)}</span>
                      {r.name}
                    </td>
                    <td>
                      <span className="c4-tag">{r.role}</span>
                    </td>
                    <td className="c4-num">
                      {r.amount} <small>{b.currency}</small>
                    </td>
                    <td>
                      <span className="c4-pill-stack">
                        <motion.span
                          className="c4-pill c4-pill--grey"
                          initial={{ opacity: 1 }}
                          animate={{ opacity: 0 }}
                          transition={t(rowAt + SEQ.pill, 0.2)}
                        >
                          Draft
                        </motion.span>
                        <motion.span
                          className={`c4-pill ${r.status === 'Screened' ? 'c4-pill--green' : 'c4-pill--violet'}`}
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={t(rowAt + SEQ.pill, 0.35)}
                        >
                          {r.status === 'Screened' ? <ShieldCheck size={11} /> : <Check size={11} />}
                          {r.status}
                        </motion.span>
                      </span>
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </main>

        <motion.aside className="c4-drawer" initial={{ opacity: 0, x: 48 }} animate={{ opacity: 1, x: 0 }} transition={t(at(SEQ.drawer), 0.6)}>
          <h4>Review & approve</h4>
          <div className="c4-drawer__row">
            <span>Recipients</span>
            <strong>{b.rows.length}</strong>
          </div>
          <div className="c4-drawer__row">
            <span>Total</span>
            <strong className="c4-num">
              {b.total} {b.currency}
            </strong>
          </div>
          <div className="c4-drawer__row">
            <span>Network fee</span>
            <strong className="c4-num">4.80 {b.currency}</strong>
          </div>
          <div className="c4-drawer__row c4-drawer__row--muted">
            <span>Screening</span>
            <span className="c4-pill c4-pill--green">
              <ShieldCheck size={11} /> No matches
            </span>
          </div>
          <div className="c4-approvals">
            <div className="c4-approvals__label">
              <span>Approvals</span>
              <strong>
                {have} of {b.approvals.need}
              </strong>
            </div>
            <div className="c4-approvals__bar">
              <motion.i
                initial={{ width: `${(b.approvals.have / b.approvals.need) * 100}%` }}
                animate={{ width: '100%' }}
                transition={t(at(SEQ.fill), 0.6)}
              />
            </div>
            <div className="c4-approvals__people">
              <span className="c4-avatar c4-avatar--signed">
                MK <Check size={9} />
              </span>
              <span className={`c4-avatar ${signed ? 'c4-avatar--signed' : 'c4-avatar--pending'}`}>
                KS
                <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={t(at(SEQ.sign), 0.3)}>
                  <Check size={9} />
                </motion.span>
              </span>
              <small>{signed ? 'Ready to execute' : 'Waiting on Kenji'}</small>
            </div>
          </div>
          <button type="button" className="c4-btn c4-btn--primary c4-btn--block c4-btn--approve" tabIndex={-1}>
            Approve
            {!reduce && (
              <motion.span
                className="c4-approve__glow"
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 1.2, delay: at(SEQ.glow), ease: 'easeInOut', times: [0, 0.4, 1] }}
              />
            )}
          </button>
          <p className="c4-drawer__note">Signed with your Safe account. Funds never leave your control.</p>
        </motion.aside>
      </div>
    </div>
  )
}

function ScheduleMock() {
  const days = Array.from({ length: 28 }, (_, i) => i + 1)
  const { ref, play } = useSequence<HTMLDivElement>()
  const t = useTiming()
  return (
    <div className="c4-mock" ref={ref}>
      <div className="c4-mock__head">
        <span>September 2026</span>
        <span className="c4-pill c4-pill--violet">Recurring · monthly</span>
      </div>
      <div className="c4-cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="c4-cal__dow">
            {d}
          </span>
        ))}
        {days.map(d => {
          const pay = d === 25
          const win = d >= 22 && d < 25
          return (
            <span key={d} className="c4-cal__day">
              {d}
              {(pay || win) && (
                <motion.i
                  className={pay ? 'is-pay' : 'is-window'}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={play ? { opacity: 1, scale: 1 } : {}}
                  transition={t(pay ? 0.75 : 0.25 + (d - 22) * 0.12, 0.35)}
                >
                  {d}
                </motion.i>
              )}
            </span>
          )
        })}
      </div>
      <div className="c4-timeline">
        <div className="c4-timeline__step is-done">
          <i />
          <span>Draft prepared</span>
          <small>Sep 22</small>
        </div>
        <div className="c4-timeline__step is-done">
          <i />
          <span>Approvals collected</span>
          <small>Sep 23</small>
        </div>
        <div className="c4-timeline__step is-pay">
          <motion.i initial={{ scale: 0.4, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : {}} transition={t(1.05, 0.35)} />
          <span>Pay date</span>
          <small>Sep 25</small>
        </div>
      </div>
    </div>
  )
}

function ImportMock() {
  const map = [
    ['full_name', 'Recipient name'],
    ['email', 'Email'],
    ['wallet', 'Payout address'],
    ['monthly_usd', 'Amount'],
  ]
  const { ref, play } = useSequence<HTMLDivElement>()
  const t = useTiming()
  return (
    <div className="c4-mock" ref={ref}>
      <div className="c4-mock__head">
        <span>contractors-sept.csv</span>
        <span className="c4-pill c4-pill--grey">42 rows</span>
      </div>
      <div className="c4-map">
        <div className="c4-map__col">
          <small>Your column</small>
          <small>Disburse field</small>
        </div>
        {map.map(([from, to], i) => {
          const d = 0.2 + i * 0.16
          return (
            <div key={from} className="c4-map__row">
              <code>{from}</code>
              <span className="c4-map__arrow" aria-hidden>
                <svg viewBox="0 0 24 12" width="24" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <motion.path d="M2 6h18" initial={{ pathLength: 0 }} animate={play ? { pathLength: 1 } : {}} transition={t(d, 0.4)} />
                  <motion.path d="M15 1.5l4.5 4.5-4.5 4.5" initial={{ pathLength: 0 }} animate={play ? { pathLength: 1 } : {}} transition={t(d + 0.3, 0.25)} />
                </svg>
              </span>
              <motion.span className="c4-map__field" initial={{ opacity: 0.35 }} animate={play ? { opacity: 1 } : {}} transition={t(d + 0.35, 0.3)}>
                {to}
                <motion.span initial={{ scale: 0, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : {}} transition={t(d + 0.5, 0.3)}>
                  <Check size={12} />
                </motion.span>
              </motion.span>
            </div>
          )
        })}
      </div>
      <div className="c4-map__foot">
        <motion.span className="c4-pill c4-pill--amber" initial={{ scale: 0.6, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : {}} transition={t(1.15, 0.4)}>
          2 possible duplicates
        </motion.span>
        <span>Review before saving</span>
      </div>
    </div>
  )
}

function ReconcileMock() {
  const bars = [38, 52, 44, 70, 58, 82]
  const { ref, play } = useSequence<HTMLDivElement>()
  const t = useTiming()
  return (
    <div className="c4-mock" ref={ref}>
      <div className="c4-mock__head">
        <span>Outgoing by month · USDC</span>
        <span className="c4-pill c4-pill--grey">Export CSV</span>
      </div>
      <div className="c4-bars">
        {bars.map((h, i) => (
          <motion.span
            key={i}
            className={i === bars.length - 1 ? 'is-current' : ''}
            initial={{ height: '0%' }}
            animate={play ? { height: `${h}%` } : {}}
            transition={t(0.15 + i * 0.1, 0.7)}
          />
        ))}
      </div>
      <div className="c4-summary">
        <div>
          <small>Incoming</small>
          <strong className="c4-num">+120,000.00</strong>
        </div>
        <div>
          <small>Outgoing</small>
          <strong className="c4-num">−48,250.00</strong>
        </div>
        <div>
          <small>Fees</small>
          <strong className="c4-num">−4.80</strong>
        </div>
      </div>
    </div>
  )
}

const MOCKS = { schedule: ScheduleMock, import: ImportMock, reconcile: ReconcileMock }

function HeroItem({ children, delay, className, as = 'div' }: { children: ReactNode; delay: number; className?: string; as?: 'div' | 'span' }) {
  const reduce = useReducedMotion()
  const Tag = as === 'span' ? motion.span : motion.div
  return (
    <Tag
      className={className}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, delay, ease: EASE }}
    >
      {children}
    </Tag>
  )
}

const MOCK_DELAY = 0.45
const MOCK_SETTLE = MOCK_DELAY + 0.75

export default function Proposal4() {
  const reduce = useReducedMotion()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const titleWords = HERO.title.split(' ')
  const lines = [titleWords.slice(0, 3).join(' '), titleWords.slice(3).join(' ')]

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="lp lp-4">
      <div className="c4-glow" aria-hidden />

      <header className={`c4-header${scrolled ? ' is-scrolled' : ''}${menuOpen ? ' is-open' : ''}`}>
        <div className="c4-container c4-header__inner">
          <Logo />
          <nav className="c4-nav">
            <NavLinks />
          </nav>
          <div className="c4-header__actions">
            <ThemeToggle />
            <Link to="/login" className="c4-btn c4-btn--ghost c4-header__login">
              Log in
            </Link>
            <Link to="/login" className="c4-btn c4-btn--primary c4-header__cta">
              {HERO.primaryCta}
            </Link>
            <button
              type="button"
              className="c4-burger"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(o => !o)}
            >
              <i />
              <i />
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="c4-menu">
            <nav className="c4-menu__nav">
              <NavLinks onClick={() => setMenuOpen(false)} />
            </nav>
            <div className="c4-menu__actions">
              <Link to="/login" className="c4-btn c4-btn--secondary c4-btn--block">
                Log in
              </Link>
              <Link to="/login" className="c4-btn c4-btn--primary c4-btn--block">
                {HERO.primaryCta}
              </Link>
            </div>
          </div>
        )}
      </header>

      <section className="c4-hero">
        <div className="c4-container">
          <div className="c4-hero__copy">
            <HeroItem delay={0}>
              <span className="c4-eyebrow">{HERO.eyebrow}</span>
            </HeroItem>
            <h1>
              {lines.map((line, i) => (
                <HeroItem key={line} as="span" delay={0.08 + i * 0.08} className="c4-hero__line">
                  {line}
                </HeroItem>
              ))}
            </h1>
            <HeroItem delay={0.26}>
              <p>{HERO.subtitle}</p>
            </HeroItem>
            <HeroItem delay={0.34} className="c4-hero__actions">
              <Link to="/login" className="c4-btn c4-btn--primary c4-btn--lg">
                {HERO.primaryCta} <ArrowRight size={16} />
              </Link>
              <a href="#how" className="c4-btn c4-btn--secondary c4-btn--lg">
                {HERO.secondaryCta}
              </a>
            </HeroItem>
          </div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: MOCK_DELAY, ease: EASE }}
            className="c4-hero__mock"
          >
            <AppWindow start={reduce ? 0 : MOCK_SETTLE} />
          </motion.div>
          <Reveal className="c4-trust" delay={0.1}>
            <span>{HERO.trust}</span>
            <div className="c4-trust__logos">
              {HERO.trustLogos.map(l => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section id="product" className="c4-section">
        <div className="c4-container">
          <Reveal className="c4-section__head">
            <h2>Built so nobody has to trust a middleman</h2>
            <p>Disburse organises the work around your own Safe account. It never holds the money.</p>
          </Reveal>
          <Stagger className="c4-pillars" stagger={0.08}>
            {PILLARS.map((p, i) => {
              const Icon = PILLAR_ICONS[i]
              return (
                <StaggerItem key={p.title} className="c4-card c4-pillar">
                  <span className={`c4-icon c4-icon--${PILLAR_TINTS[i]}`}>
                    <Icon size={18} strokeWidth={1.9} />
                  </span>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </StaggerItem>
              )
            })}
          </Stagger>
        </div>
      </section>

      <section className="c4-section c4-section--tight">
        <div className="c4-container">
          {SPOTLIGHTS.map(({ feature, mock }, i) => {
            const Mock = MOCKS[mock]
            return (
              <div key={feature.title} className={`c4-spot${i % 2 ? ' c4-spot--flip' : ''}`}>
                <Reveal className="c4-spot__text">
                  <span className="c4-eyebrow c4-eyebrow--plain">0{i + 1}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                  <ul>
                    {(i === 0
                      ? [FEATURES[1], FEATURES[6]]
                      : i === 1
                        ? [FEATURES[3], FEATURES[4]]
                        : [FEATURES[7]]
                    ).map(f => (
                      <li key={f.title}>
                        <Check size={14} />
                        <span>
                          <strong>{f.title}.</strong> {f.body}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Reveal>
                <Reveal className="c4-spot__mock" delay={0.1} y={32}>
                  <Mock />
                </Reveal>
              </div>
            )
          })}
        </div>
      </section>

      <section id="how" className="c4-section">
        <div className="c4-container">
          <Reveal className="c4-section__head">
            <h2>Up and running in an afternoon</h2>
            <p>No new wallet, no migration. Start from the account and the spreadsheet you already have.</p>
          </Reveal>
          <Stagger className="c4-steps" stagger={0.1}>
            {STEPS.map(s => (
              <StaggerItem key={s.n} className="c4-card c4-step">
                <span className="c4-step__n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="c4-section c4-section--tight">
        <div className="c4-container">
          <Stagger className="c4-stats" stagger={0.08}>
            {STATS.map(s => (
              <StaggerItem key={s.label} className="c4-stat">
                <CountUp value={s.value} className="c4-stat__value c4-num" />
                <span>{s.label}</span>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="c4-section c4-section--tight">
        <div className="c4-container">
          <Reveal>
            <figure className="c4-quote">
              <blockquote>
                “We used to chase two founders for signatures over chat. Now the batch sits in one place, screening runs before anyone signs, and the export matches our books to the cent.”
              </blockquote>
              <figcaption>
                <span className="c4-avatar c4-avatar--lg">FL</span>
                <div>
                  <strong>Finance lead, 40-person studio</strong>
                  <small>Sample quote for illustration</small>
                </div>
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </section>

      <section id="pricing" className="c4-section">
        <div className="c4-container">
          <Reveal className="c4-section__head">
            <h2>Simple pricing, no surprises</h2>
            <p>{PRICING_NOTE}</p>
          </Reveal>
          <Stagger className="c4-plans" stagger={0.08}>
            {PLANS.map(p => (
              <StaggerItem key={p.key} className={`c4-card c4-plan${p.highlight ? ' is-highlight' : ''}`}>
                {p.highlight && <span className="c4-plan__badge">Most popular</span>}
                <h3>{p.name}</h3>
                <small>{p.blurb}</small>
                <div className="c4-plan__price">
                  <CountUp value={`$${p.price}`} className="c4-num" />
                  <em>/ {p.period}</em>
                </div>
                <ul>
                  {p.features.map(f => (
                    <li key={f}>
                      <Check size={14} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/login" className={`c4-btn c4-btn--block ${p.highlight ? 'c4-btn--primary' : 'c4-btn--secondary'}`}>
                  {p.price === 0 ? 'Start free' : 'Start 30-day trial'}
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="c4-section c4-section--tight">
        <div className="c4-container">
          <Reveal className="c4-cta" y={32}>
            <span className="c4-eyebrow">{CTA.eyebrow}</span>
            <h2>{CTA.title}</h2>
            <p>{CTA.body}</p>
            <Link to="/login" className="c4-btn c4-btn--primary c4-btn--lg">
              {CTA.button} <ArrowRight size={16} />
            </Link>
            <small>{CTA.note}</small>
          </Reveal>
        </div>
      </section>

      <footer className="c4-footer">
        <Stagger className="c4-container c4-footer__inner" stagger={0.07}>
          <StaggerItem className="c4-footer__brand" y={12}>
            <Logo />
            <p>{FOOTER.tagline}</p>
          </StaggerItem>
          {FOOTER.columns.map(col => (
            <StaggerItem key={col.title} className="c4-footer__col" y={12}>
              <h4>{col.title}</h4>
              {col.links.map(l =>
                l.href.startsWith('#') ? (
                  <a key={l.label} href={l.href}>
                    {l.label}
                  </a>
                ) : (
                  <Link key={l.label} to={l.href}>
                    {l.label}
                  </Link>
                ),
              )}
            </StaggerItem>
          ))}
        </Stagger>
        <div className="c4-container c4-footer__legal">
          <span>© {new Date().getFullYear()} {BRAND}</span>
          <span>
            <Search size={12} /> Recipient screening on every batch
          </span>
        </div>
      </footer>
    </div>
  )
}
