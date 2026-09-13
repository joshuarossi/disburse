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

/* Proposal 6 "Folio": the Canvas layout and content set in the Ledger identity.
   Paper, ink, Fraunces serif, hairlines, mono numerals, one forest-green accent. */

const pad = (n: number) => String(n).padStart(2, '0')

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

const SPOTLIGHTS = [
  { feature: FEATURES[0], mock: 'schedule', extras: [FEATURES[1], FEATURES[6]] },
  { feature: FEATURES[2], mock: 'import', extras: [FEATURES[3], FEATURES[4]] },
  { feature: FEATURES[5], mock: 'reconcile', extras: [FEATURES[7]] },
] as const

const initials = (name: string) =>
  name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')

const useTiming = () => {
  const reduce = useReducedMotion()
  return (delay: number, duration = 0.4) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE })
}

function useSequence<T extends HTMLElement>(margin: `${number}px` = '-80px') {
  const ref = useRef<T>(null)
  const inView = useInView(ref, { once: true, margin })
  const reduce = useReducedMotion()
  return { ref, play: inView || !!reduce, reduce: !!reduce }
}

function NavLink({ href, children, className, onClick }: { href: string; children: ReactNode; className?: string; onClick?: () => void }) {
  return href.startsWith('#') ? (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ) : (
    <Link to={href} className={className} onClick={onClick}>
      {children}
    </Link>
  )
}

/** Centered section head in the ledger idiom: a rule that draws in, a numbered caps label, a serif title. */
function SectionHead({ n, label, title, lede }: { n: string; label: string; title: ReactNode; lede?: string }) {
  const reduce = useReducedMotion()
  return (
    <div className="l6-head">
      <motion.hr
        className="l6-head__rule"
        initial={reduce ? false : { scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.9, ease: EASE }}
      />
      <Reveal y={14} className="l6-head__inner">
        <span className="l6-caps l6-caps--accent">
          No. {n} · {label}
        </span>
        <h2 className="l6-serif">{title}</h2>
        {lede && <p>{lede}</p>}
      </Reveal>
    </div>
  )
}

/* Hero ledger timeline (seconds): rows print 0.25→1.3, subtotal counts 1.3→2.1,
   approvals tick at 2.15, stamp lands at 2.6. One-shot, then still. */
const L = { rowStart: 0.25, rowGap: 0.16, subtotal: 1.3, approve: 2150, stamp: 2600 }

function Ledger() {
  const b = SAMPLE_BATCH
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
    const t0 = performance.now() + L.subtotal * 1000
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 800)
      if (p >= 0) setSubtotal(Math.round(total * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const a = window.setTimeout(() => setApproved(true), L.approve)
    const st = window.setTimeout(() => setStamped(true), L.stamp)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(a)
      window.clearTimeout(st)
    }
  }, [play, total])

  return (
    <div ref={ref} className="l6-ledger">
      <span className="l6-stamp l6-mono">
        {approved ? 'Ready' : 'Draft'} · {b.rows.length} payouts
      </span>
      <div className="l6-ledger__head">
        <div className="l6-caps">Batch</div>
        <div className="l6-serif l6-ledger__title">{b.name}</div>
        <div className="l6-mono l6-muted l6-ledger__meta">
          {b.currency} · {b.network} · Pay date 30 Sep
        </div>
      </div>
      <div className="l6-ledger__table">
        <table className="l6-table">
          <thead>
            <tr className="l6-caps">
              <th>Recipient</th>
              <th className="l6-col-role-sm">Role</th>
              <th className="l6-num">Amount</th>
              <th className="l6-num">Status</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <motion.tr
                key={r.name}
                initial={reduce ? false : { opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
                animate={play ? { opacity: 1, clipPath: 'inset(0 0% 0 0)' } : undefined}
                transition={{ delay: L.rowStart + i * L.rowGap, duration: 0.32, ease: 'linear' }}
              >
                <td>{r.name}</td>
                <td className="l6-col-role-sm l6-muted">{r.role}</td>
                <td className="l6-num l6-mono">{r.amount}</td>
                <td className="l6-num">
                  <span className={`l6-chip ${r.status === 'Screened' ? 'l6-chip--green' : ''}`}>
                    {r.status === 'Screened' && <i className="l6-dot" />}
                    {r.status}
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        <div className="l6-subtotal">
          <span className="l6-caps l6-caps--ink">Subtotal</span>
          <span className="l6-mono">
            {subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <small>{b.currency}</small>
          </span>
        </div>
      </div>
      <div className="l6-ledger__foot">
        <span className="l6-ledger__sig">
          <span className="l6-sig l6-sig--fixed" aria-hidden>
            <span className="is-done" />
            <span className={approved ? 'is-done' : ''} />
          </span>
          <motion.span
            key={approved ? 'ready' : 'awaiting'}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            {approved ? `Approvals ${b.approvals.need} of ${b.approvals.need} · ready to execute` : `Approvals ${b.approvals.have} of ${b.approvals.need} · awaiting Priya`}
          </motion.span>
        </span>
        <span className="l6-chip l6-chip--green">
          <i className="l6-dot" />
          Screened
        </span>
      </div>
      {stamped && (
        <motion.span
          className="l6-approved l6-approved--ledger"
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

/* App window timeline (seconds after the window settles):
   0.1 sidebar highlight · 0.3+ rows print in · 1.25 subtotal counts · 1.4 drawer slides in ·
   2.0 second signature fills · 2.15 status flips to "Ready" · 2.6 Approved stamp presses in */
const SEQ = { side: 0.1, rows: 0.3, rowGap: 0.13, chip: 0.4, count: 1.25, drawer: 1.4, fill: 2.0, stamp: 2.6 }

function AppWindow({ start }: { start: number }) {
  const b = SAMPLE_BATCH
  const t = useTiming()
  const reduce = useReducedMotion()
  const total = Number(b.total.replace(/,/g, ''))
  const [subtotal, setSubtotal] = useState(reduce ? total : 0)
  const [signed, setSigned] = useState(!!reduce)
  const [stamped, setStamped] = useState(!!reduce)
  const at = (s: number) => start + s

  useEffect(() => {
    if (reduce) return
    const t0 = performance.now() + at(SEQ.count) * 1000
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 800)
      if (p >= 0) setSubtotal(Math.round(total * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const a = window.setTimeout(() => setSigned(true), at(SEQ.fill) * 1000)
    const s = window.setTimeout(() => setStamped(true), at(SEQ.stamp) * 1000)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(a)
      window.clearTimeout(s)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, [reduce])

  const have = signed ? b.approvals.need : b.approvals.have

  return (
    <div className="l6-window" role="img" aria-label="Disburse app: review and approve a payment batch">
      <div className="l6-window__chrome">
        <span className="l6-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="l6-window__url l6-mono">app.disburse.io / payments / new-batch</span>
        <span className="l6-window__badge l6-mono">{signed ? 'Ready' : 'Draft'}</span>
      </div>
      <div className="l6-window__body">
        <aside className="l6-side">
          <div className="l6-side__org">
            <span className="l6-side__avatar">NS</span>
            <span className="l6-serif">Northwind Studio</span>
          </div>
          {SIDEBAR.map(({ label, icon: Icon, active }) => (
            <div key={label} className={`l6-side__item${active ? ' is-active' : ''}`}>
              {active && (
                <motion.i className="l6-side__hl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(at(SEQ.side), 0.35)} />
              )}
              <Icon size={14} strokeWidth={1.7} />
              {label}
            </div>
          ))}
        </aside>

        <main className="l6-main">
          <div className="l6-main__head">
            <div>
              <div className="l6-caps">Payments · New batch</div>
              <h3 className="l6-serif">{b.name}</h3>
            </div>
            <span className="l6-chip l6-mono">
              {b.currency} · {b.network}
            </span>
          </div>
          <table className="l6-table">
            <thead>
              <tr className="l6-caps">
                <th>Recipient</th>
                <th className="l6-col-role">Role</th>
                <th className="l6-num">Amount</th>
                <th className="l6-num">Status</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => {
                const rowAt = at(SEQ.rows + i * SEQ.rowGap)
                return (
                  <motion.tr
                    key={r.name}
                    initial={reduce ? false : { opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
                    animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
                    transition={reduce ? { duration: 0 } : { delay: rowAt, duration: 0.34, ease: 'linear' }}
                  >
                    <td>
                      <span className="l6-avatar">{initials(r.name)}</span>
                      {r.name}
                    </td>
                    <td className="l6-col-role l6-muted">{r.role}</td>
                    <td className="l6-num l6-mono">{r.amount}</td>
                    <td className="l6-num">
                      <span className="l6-chip-stack">
                        <motion.span className="l6-chip" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={t(rowAt + SEQ.chip, 0.2)}>
                          Draft
                        </motion.span>
                        <motion.span
                          className={`l6-chip ${r.status === 'Screened' ? 'l6-chip--green' : 'l6-chip--ink'}`}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={t(rowAt + SEQ.chip, 0.3)}
                        >
                          {r.status === 'Screened' && <i className="l6-dot" />}
                          {r.status}
                        </motion.span>
                      </span>
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
          <div className="l6-subtotal">
            <span className="l6-caps l6-caps--ink">Subtotal</span>
            <span className="l6-mono">
              {subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <small>{b.currency}</small>
            </span>
          </div>
        </main>

        <motion.aside className="l6-drawer" initial={reduce ? false : { opacity: 0, x: 36 }} animate={{ opacity: 1, x: 0 }} transition={t(at(SEQ.drawer), 0.6)}>
          <h4 className="l6-serif">Review &amp; approve</h4>
          <div className="l6-drawer__row">
            <span>Recipients</span>
            <strong className="l6-mono">{b.rows.length}</strong>
          </div>
          <div className="l6-drawer__row">
            <span>Total</span>
            <strong className="l6-mono">{b.total}</strong>
          </div>
          <div className="l6-drawer__row">
            <span>Network fee</span>
            <strong className="l6-mono">4.80</strong>
          </div>
          <div className="l6-drawer__row">
            <span>Screening</span>
            <span className="l6-chip l6-chip--green">
              <i className="l6-dot" /> No matches
            </span>
          </div>
          <div className="l6-approvals">
            <div className="l6-drawer__row">
              <span>Approvals</span>
              <strong className="l6-mono">
                {have} of {b.approvals.need}
              </strong>
            </div>
            <span className="l6-sig" aria-hidden>
              <span className="is-done" />
              <span className={signed ? 'is-done' : ''} />
            </span>
            <div className="l6-approvals__people">
              <span className="l6-avatar l6-avatar--signed">
                MK <Check size={9} strokeWidth={3} />
              </span>
              <span className={`l6-avatar ${signed ? 'l6-avatar--signed' : 'l6-avatar--pending'}`}>
                KS
                <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={t(at(SEQ.fill) + 0.15, 0.3)}>
                  <Check size={9} strokeWidth={3} />
                </motion.span>
              </span>
              <motion.small
                key={signed ? 'ready' : 'waiting'}
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                {signed ? 'Ready to execute' : 'Waiting on Kenji'}
              </motion.small>
            </div>
          </div>
          <span className={`l6-btn l6-btn--block ${signed ? 'l6-btn--accent' : 'l6-btn--ink'}`} aria-hidden>
            {signed ? 'Execute payment' : 'Approve'}
          </span>
          <p className="l6-drawer__note">Signed with your Safe account. Funds never leave your control.</p>
          {stamped && (
            <motion.span
              className="l6-approved"
              aria-hidden
              initial={reduce ? false : { opacity: 0, scale: 1.3, rotate: -14 }}
              animate={{ opacity: 1, scale: 1, rotate: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              Approved
            </motion.span>
          )}
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
    <div className="l6-mock" ref={ref}>
      <div className="l6-mock__head">
        <span className="l6-serif">September 2026</span>
        <span className="l6-chip l6-chip--green l6-mono">Recurring · monthly</span>
      </div>
      <div className="l6-cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="l6-cal__dow l6-caps">
            {d}
          </span>
        ))}
        {days.map(d => {
          const pay = d === 25
          const win = d >= 22 && d < 25
          return (
            <span key={d} className="l6-cal__day l6-mono">
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
      <div className="l6-timeline">
        <div className="l6-timeline__step is-done">
          <i />
          <span>Draft prepared</span>
          <small className="l6-mono">Sep 22</small>
        </div>
        <div className="l6-timeline__step is-done">
          <i />
          <span>Approvals collected</span>
          <small className="l6-mono">Sep 23</small>
        </div>
        <div className="l6-timeline__step is-pay">
          <motion.i initial={{ scale: 0.4, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : {}} transition={t(1.05, 0.35)} />
          <span>Pay date</span>
          <small className="l6-mono">Sep 25</small>
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
    <div className="l6-mock" ref={ref}>
      <div className="l6-mock__head">
        <span className="l6-mono">contractors-sept.csv</span>
        <span className="l6-chip l6-mono">42 rows</span>
      </div>
      <div className="l6-map">
        <div className="l6-map__col">
          <small className="l6-caps">Your column</small>
          <small className="l6-caps">Disburse field</small>
        </div>
        {map.map(([from, to], i) => {
          const d = 0.2 + i * 0.16
          return (
            <div key={from} className="l6-map__row">
              <code className="l6-mono">{from}</code>
              <span className="l6-map__arrow" aria-hidden>
                <svg viewBox="0 0 24 12" width="24" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <motion.path d="M2 6h18" initial={{ pathLength: 0 }} animate={play ? { pathLength: 1 } : {}} transition={t(d, 0.4)} />
                  <motion.path d="M15 1.5l4.5 4.5-4.5 4.5" initial={{ pathLength: 0 }} animate={play ? { pathLength: 1 } : {}} transition={t(d + 0.3, 0.25)} />
                </svg>
              </span>
              <motion.span className="l6-map__field" initial={{ opacity: 0.35 }} animate={play ? { opacity: 1 } : {}} transition={t(d + 0.35, 0.3)}>
                {to}
                <motion.span initial={{ scale: 0, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : {}} transition={t(d + 0.5, 0.3)}>
                  <Check size={12} strokeWidth={2.5} />
                </motion.span>
              </motion.span>
            </div>
          )
        })}
      </div>
      <div className="l6-map__foot">
        <motion.span className="l6-chip l6-chip--amber" initial={{ scale: 0.6, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : {}} transition={t(1.15, 0.4)}>
          2 possible duplicates
        </motion.span>
        <span className="l6-muted">Review before saving</span>
      </div>
    </div>
  )
}

function ReconcileMock() {
  const bars = [38, 52, 44, 70, 58, 82]
  const { ref, play } = useSequence<HTMLDivElement>()
  const t = useTiming()
  return (
    <div className="l6-mock" ref={ref}>
      <div className="l6-mock__head">
        <span className="l6-serif">Outgoing by month · USDC</span>
        <span className="l6-chip l6-mono">Export CSV</span>
      </div>
      <div className="l6-bars">
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
      <div className="l6-summary">
        <div>
          <small className="l6-caps">Incoming</small>
          <strong className="l6-mono">+120,000.00</strong>
        </div>
        <div>
          <small className="l6-caps">Outgoing</small>
          <strong className="l6-mono">−48,250.00</strong>
        </div>
        <div>
          <small className="l6-caps">Fees</small>
          <strong className="l6-mono">−4.80</strong>
        </div>
      </div>
    </div>
  )
}

const MOCKS = { schedule: ScheduleMock, import: ImportMock, reconcile: ReconcileMock }

const heroItem = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

/** Mounts the app window once it scrolls into view so its sequence starts on screen. */
function ProductWindow() {
  const { ref, play } = useSequence<HTMLDivElement>('-120px')
  return (
    <div ref={ref} className="l6-product__mock">
      {play ? <AppWindow start={0.25} /> : <div className="l6-window" style={{ minHeight: 462 }} aria-hidden />}
    </div>
  )
}

export default function Proposal6() {
  const reduce = useReducedMotion()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const team = PLANS.find(p => p.highlight)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="lp lp-6">
      <header className={`l6-header${scrolled ? ' is-scrolled' : ''}${menuOpen ? ' is-open' : ''}`}>
        <div className="l6-wrap l6-header__inner">
          <Link to="/" className="l6-wordmark">
            {BRAND}
          </Link>
          <nav className="l6-nav">
            {NAV.map(n => (
              <NavLink key={n.href} href={n.href}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="l6-header__actions">
            <Link to="/login" className="l6-textlink l6-header__login">
              Log in
            </Link>
            <ThemeToggle />
            <Link to="/login" className="l6-btn l6-btn--ink l6-btn--sm l6-header__cta">
              {HERO.primaryCta}
            </Link>
            <button
              type="button"
              className="l6-burger"
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
          <div className="l6-menu">
            <nav className="l6-menu__nav">
              {NAV.map(n => (
                <NavLink key={n.href} href={n.href} onClick={() => setMenuOpen(false)}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="l6-menu__actions">
              <Link to="/login" className="l6-btn l6-btn--ghost l6-btn--block">
                Log in
              </Link>
              <Link to="/login" className="l6-btn l6-btn--ink l6-btn--block">
                {HERO.primaryCta}
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Hero: Ledger composition */}
      <section className="l6-hero">
        <div className="l6-wrap">
          <div className="l6-hero__grid">
            <motion.div
              className="l6-hero__copy"
              initial={reduce ? false : 'hidden'}
              animate="visible"
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } }}
            >
              <motion.span variants={heroItem} className="l6-caps l6-caps--accent">
                § {HERO.eyebrow}
              </motion.span>
              <h1 className="l6-display">
                <motion.span variants={heroItem} className="block">
                  Pay your people.
                </motion.span>
                <motion.span variants={heroItem} className="block">
                  Stay in <em>control</em>.
                </motion.span>
              </h1>
              <motion.p variants={heroItem}>{HERO.subtitle}</motion.p>
              <motion.div variants={heroItem} className="l6-hero__actions">
                <Link to="/login" className="l6-btn l6-btn--ink">
                  {HERO.primaryCta} <ArrowRight size={16} />
                </Link>
                <a href="#product" className="l6-btn l6-btn--ghost">
                  {HERO.secondaryCta}
                </a>
              </motion.div>
              <motion.span variants={heroItem} className="l6-hero__note l6-muted">
                {CTA.note} · Non-custodial by design
              </motion.span>
            </motion.div>
            <motion.div
              className="l6-hero__ledger"
              initial={reduce ? false : { opacity: 0, y: 32, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.45 }}
            >
              <Ledger />
            </motion.div>
          </div>

          <Reveal y={12} className="l6-trust">
            <span className="l6-caps">{HERO.trust}</span>
            <div className="l6-trust__logos">
              {HERO.trustLogos.map(l => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* The product: the full app window */}
      <section id="product" className="l6-section l6-section--product">
        <div className="l6-wrap">
          <SectionHead
            n="01"
            label="In the product"
            title="The whole pay run on one screen."
            lede="Recipients, amounts, screening, fees and approvals sit together, so the person who signs sees exactly what the person who prepared it saw."
          />
          <ProductWindow />
        </div>
      </section>

      {/* Pillars */}
      <section className="l6-section">
        <div className="l6-wrap">
          <SectionHead
            n="02"
            label="Principles"
            title="Built so nobody has to trust a middleman."
            lede="Disburse organises the work around your own Safe account. It never holds the money."
          />
          <Stagger className="l6-pillars" stagger={0.08}>
            {PILLARS.map((p, i) => {
              const Icon = PILLAR_ICONS[i]
              return (
                <StaggerItem key={p.title} className="l6-pillar">
                  <div className="l6-pillar__top">
                    <span className="l6-mono l6-muted">{pad(i + 1)}</span>
                    <span className="l6-icon">
                      <Icon size={16} strokeWidth={1.6} />
                    </span>
                  </div>
                  <h3 className="l6-serif">{p.title}</h3>
                  <p className="l6-muted">{p.body}</p>
                </StaggerItem>
              )
            })}
          </Stagger>
        </div>
      </section>

      {/* Spotlights */}
      <section className="l6-section l6-section--tight">
        <div className="l6-wrap">
          <SectionHead n="03" label="In practice" title="Everything a pay run needs, and nothing it doesn't." />
          {SPOTLIGHTS.map(({ feature, mock, extras }, i) => {
            const Mock = MOCKS[mock]
            return (
              <div key={feature.title} className={`l6-spot${i % 2 ? ' l6-spot--flip' : ''}`}>
                <Reveal className="l6-spot__text">
                  <span className="l6-mono l6-caps--accent">{pad(i + 1)}</span>
                  <h3 className="l6-serif">{feature.title}</h3>
                  <p className="l6-muted">{feature.body}</p>
                  <ul>
                    {extras.map(f => (
                      <li key={f.title}>
                        <Check size={14} strokeWidth={2.5} />
                        <span>
                          <strong>{f.title}.</strong> {f.body}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Reveal>
                <Reveal className="l6-spot__mock" delay={0.1} y={32}>
                  <Mock />
                </Reveal>
              </div>
            )
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="l6-section l6-section--surface">
        <div className="l6-wrap">
          <SectionHead
            n="04"
            label="How it works"
            title="Up and running in an afternoon."
            lede="No new wallet, no migration. Start from the account and the spreadsheet you already have."
          />
          <Stagger className="l6-steps" stagger={0.1}>
            {STEPS.map(s => (
              <StaggerItem key={s.n} className="l6-step">
                <span className="l6-mono l6-caps--accent">Step {s.n}</span>
                <h3 className="l6-serif">{s.title}</h3>
                <p className="l6-muted">{s.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Stats */}
      <section className="l6-section l6-section--tight">
        <div className="l6-wrap">
          <Stagger className="l6-stats" stagger={0.08}>
            {STATS.map(s => (
              <StaggerItem key={s.label} className="l6-stat" y={12}>
                <div className="l6-serif l6-stat__value">
                  <CountUp value={s.value} />
                </div>
                <div className="l6-muted">{s.label}</div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Quote */}
      <section className="l6-section">
        <div className="l6-wrap">
          <Reveal>
            <figure className="l6-quote">
              <span className="l6-caps l6-caps--accent">Sample · What we hear from finance teams</span>
              <blockquote>
                “We used to chase two founders for signatures over chat. Now the batch sits in one place, screening runs before anyone signs, and the export matches our books to the cent.”
              </blockquote>
              <figcaption>
                <span className="l6-avatar l6-avatar--lg">FL</span>
                <div>
                  <strong>Finance lead, 40-person studio</strong>
                  <small className="l6-muted">Sample quote for illustration</small>
                </div>
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="l6-section l6-section--tight">
        <div className="l6-wrap">
          <SectionHead n="05" label="Pricing" title="Simple plans. No auto-renewal." lede={PRICING_NOTE} />
          <Stagger className="l6-plans" stagger={0.1}>
            {PLANS.map(p => (
              <StaggerItem key={p.key} className={`l6-plan${p.highlight ? ' is-highlight' : ''}`} y={16}>
                <div className="l6-plan__head">
                  <span className="l6-serif">{p.name}</span>
                  {p.highlight && <span className="l6-chip l6-chip--green">Most teams</span>}
                </div>
                <small className="l6-muted">{p.blurb}</small>
                <div className="l6-plan__price">
                  <CountUp value={`$${p.price}`} className="l6-mono" />
                  <em className="l6-muted">/ {p.period}</em>
                </div>
                <Link to="/login" className={`l6-btn l6-btn--block ${p.highlight ? 'l6-btn--ink' : 'l6-btn--ghost'}`}>
                  {p.price === 0 ? 'Start free' : `Try ${p.name} free`}
                </Link>
                <ul>
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
          {team && (
            <Reveal as="p" y={10} className="l6-plans__note l6-muted">
              Every new organization starts with a 30-day {team.name} trial. It does not renew unless you choose a plan.
            </Reveal>
          )}
        </div>
      </section>

      {/* Final CTA */}
      <section className="l6-section">
        <div className="l6-wrap">
          <Reveal className="l6-panel" y={32}>
            <span className="l6-caps">§ {CTA.eyebrow}</span>
            <h2 className="l6-display">
              Make your next pay run <em>easier</em>.
            </h2>
            <p>{CTA.body}</p>
            <Link to="/login" className="l6-btn l6-btn--paper">
              {CTA.button} <ArrowRight size={16} />
            </Link>
            <small>{CTA.note}</small>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="l6-footer">
        <div className="l6-wrap">
          <Stagger className="l6-footer__grid" stagger={0.07}>
            <StaggerItem className="l6-footer__brand" y={12}>
              <span className="l6-wordmark">{BRAND}</span>
              <p className="l6-muted">{FOOTER.tagline}</p>
            </StaggerItem>
            {FOOTER.columns.map(c => (
              <StaggerItem key={c.title} className="l6-footer__col" y={12}>
                <span className="l6-caps l6-caps--ink">{c.title}</span>
                <ul>
                  {c.links.map(l => (
                    <li key={l.href}>
                      <NavLink href={l.href}>{l.label}</NavLink>
                    </li>
                  ))}
                </ul>
              </StaggerItem>
            ))}
          </Stagger>
          <div className="l6-footer__legal l6-muted">
            <span>© {new Date().getFullYear()} {BRAND}. Non-custodial. Your keys, your funds.</span>
            <span className="l6-mono">Settlement on Ethereum, Base and Polygon</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
