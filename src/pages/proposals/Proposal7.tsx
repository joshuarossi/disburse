import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
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
  BATCH7,
  BRAND,
  COMPARISON,
  CTA,
  FAQ,
  FEATURES,
  FOOTER,
  HERO,
  NAV,
  PILLARS,
  PLANS,
  PRICING_NOTE,
  REVIEW_CHECKS,
  STATS,
  STEPS,
} from './content'
import { CountUp, EASE, Reveal, Stagger, StaggerItem, ThemeToggle } from './kit'

/* Proposal 7 "Folio II": Proposal 6 after three rounds of review.
   Ledger identity (paper, ink, Fraunces, hairlines, one green) with the Canvas
   product story. Fixed header, no layout shift, honest numbers, real calendar. */

const pad = (n: number) => String(n).padStart(2, '0')
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

const STAT_LABELS: Record<string, string> = { '0': 'funds held by Disburse' }

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

/** Runs an eased count from `from` to `to` over `ms`, starting after `delay` ms, once `play` is true. */
function useCount(play: boolean, to: number, { from = 0, delay = 0, ms = 800 }: { from?: number; delay?: number; ms?: number }) {
  const reduce = useReducedMotion()
  const [v, setV] = useState(to)
  useEffect(() => {
    if (!play || reduce) return
    setV(from)
    const t0 = performance.now() + delay
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / ms))
      setV(from + (to - from) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [play, reduce, to, from, delay, ms])
  return reduce ? to : v
}

/** Flips to true after `ms` once `play` is true. Final state under reduced motion. */
function useLater(play: boolean, ms: number) {
  const reduce = useReducedMotion()
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!play || reduce) return
    const id = window.setTimeout(() => setOn(true), ms)
    return () => window.clearTimeout(id)
  }, [play, reduce, ms])
  return reduce ? true : on
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

function SectionHead({ n, label, title, lede }: { n: string; label: string; title: ReactNode; lede?: string }) {
  const reduce = useReducedMotion()
  return (
    <div className="l7-head">
      <motion.hr
        className="l7-head__rule"
        initial={reduce ? false : { scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.9, ease: EASE }}
      />
      <Reveal y={14} className="l7-head__inner">
        <span className="l7-caps l7-caps--accent">
          No. {n} · {label}
        </span>
        <h2 className="l7-serif">{title}</h2>
        {lede && <p>{lede}</p>}
      </Reveal>
    </div>
  )
}

function StatusChip({ screened, ready }: { screened: boolean; ready: boolean }) {
  if (screened) {
    return (
      <span className="l7-chip l7-chip--ink">
        <ShieldCheck size={11} strokeWidth={2.2} /> Screened
      </span>
    )
  }
  return <span className={`l7-chip ${ready ? 'l7-chip--green' : ''}`}>{ready ? 'Ready' : 'Draft'}</span>
}

/* Hero statement: the preparation view. Rows print, the subtotal settles, the
   first signature is already in, the second arrives, the stamp lands. ~2.4s. */
const L = { rowStart: 0.2, rowGap: 0.1, rowDur: 0.26, count: 900, approve: 1900, stamp: 2300 }

function Ledger() {
  const b = BATCH7
  const { ref, play, reduce } = useSequence<HTMLDivElement>('-60px')
  const subtotal = useCount(play, b.subtotal, { from: b.subtotal * 0.82, delay: L.count, ms: 700 })
  const approved = useLater(play, L.approve)
  const stamped = useLater(play, L.stamp)
  const pending = b.approvers.find(a => !a.signed)?.name.split(' ')[0]

  return (
    <div ref={ref} className="l7-ledger" role="img" aria-label={`A prepared payment batch, ${b.name}: six recipients totalling ${money(b.subtotal)} ${b.currency}, awaiting a second approval.`}>
      <span className={`l7-stamp l7-mono${approved ? ' is-ready' : ''}`}>
        {approved ? 'Ready' : 'Draft'} · {b.rows.length} payouts
      </span>
      <div className="l7-ledger__head">
        <div className="l7-caps">Batch</div>
        <div className="l7-serif l7-ledger__title">{b.name}</div>
        <div className="l7-mono l7-muted l7-ledger__meta">
          {b.currency} · {b.network} · Pay date {b.payDate}
        </div>
      </div>
      <div className="l7-ledger__table">
        <table className="l7-table">
          <thead>
            <tr className="l7-caps">
              <th>Recipient</th>
              <th className="l7-col-role-sm">Role</th>
              <th className="l7-num">Amount</th>
              <th className="l7-num">Status</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <motion.tr
                key={r.name}
                initial={reduce ? false : { opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
                animate={play ? { opacity: 1, clipPath: 'inset(0 0% 0 0)' } : undefined}
                transition={{ delay: L.rowStart + i * L.rowGap, duration: L.rowDur, ease: 'linear' }}
              >
                <td>{r.name}</td>
                <td className="l7-col-role-sm l7-muted">{r.role}</td>
                <td className="l7-num l7-mono">{r.amount}</td>
                <td className="l7-num">
                  <StatusChip screened={r.screened} ready={approved} />
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        <div className="l7-totals">
          <div>
            <span className="l7-caps">Subtotal</span>
            <span className="l7-mono">{money(subtotal)}</span>
          </div>
          <div>
            <span className="l7-caps">Execution fee</span>
            <span className="l7-mono">{money(b.fee)}</span>
          </div>
          <div className="l7-totals__total">
            <span className="l7-caps l7-caps--ink">Total</span>
            <span className="l7-mono">
              {money(subtotal + b.fee)} <small>{b.currency}</small>
            </span>
          </div>
        </div>
      </div>
      <div className="l7-ledger__foot">
        <span className="l7-ledger__sig">
          <span className="l7-sig l7-sig--fixed" aria-hidden>
            <span className="is-done" />
            <span className={approved ? 'is-done' : ''} />
          </span>
          <motion.span
            key={approved ? 'ready' : 'awaiting'}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            {approved ? 'Approvals 2 of 2 · ready to execute' : `Approvals 1 of 2 · awaiting ${pending}`}
          </motion.span>
        </span>
        <span className="l7-chip">
          <ShieldCheck size={11} strokeWidth={2.2} /> 6 of 6 screened
        </span>
      </div>
      {stamped && (
        <motion.span
          className="l7-approved"
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

/* App window: the reviewer's view. Rows are already prepared; the drawer and
   the numbered checks are the story. Timeline after in-view (seconds):
   0.1 sidebar · 0.25+ rows fade · 1.0 drawer · 1.4–2.3 markers 1→4 · 2.6 second signer · 3.0 execute */
const W = { side: 0.1, rows: 0.25, rowGap: 0.08, drawer: 1.0, marks: 1.4, markGap: 0.3, sign: 2.6, exec: 3.0 }

function Marker({ n, at, play }: { n: string; at: number; play: boolean }) {
  const t = useTiming()
  return (
    <motion.i
      className="l7-marker l7-mono"
      initial={{ opacity: 0, scale: 0.5 }}
      animate={play ? { opacity: 1, scale: 1 } : undefined}
      transition={t(at, 0.3)}
      aria-hidden
    >
      {n}
    </motion.i>
  )
}

function AppWindow() {
  const b = BATCH7
  const t = useTiming()
  const { ref, play, reduce } = useSequence<HTMLDivElement>('-120px')
  const signed = useLater(play, W.sign * 1000)
  const executable = useLater(play, W.exec * 1000)
  const at = (i: number) => W.marks + i * W.markGap
  const pending = b.approvers.find(a => !a.signed)?.name.split(' ')[0]

  return (
    <div ref={ref} className="l7-window" role="img" aria-label={`The Disburse review screen for ${b.name}: the recipient table, the execution fee, the screening result and the two required signatures.`}>
      <div className="l7-window__chrome">
        <span className="l7-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="l7-window__url l7-mono">Payments › {b.name}</span>
        <span className={`l7-stamp l7-stamp--inline l7-mono${signed ? ' is-ready' : ''}`}>{signed ? 'Ready' : 'In review'}</span>
      </div>
      <div className="l7-window__body">
        <div className="l7-side">
          <div className="l7-side__org">
            <span className="l7-side__avatar l7-mono">{initials(b.org)}</span>
            <span className="l7-serif">{b.org}</span>
          </div>
          {SIDEBAR.map(({ label, icon: Icon, active }) => (
            <div key={label} className={`l7-side__item${active ? ' is-active' : ''}`}>
              {active && (
                <motion.i className="l7-side__hl" initial={{ opacity: 0 }} animate={play ? { opacity: 1 } : undefined} transition={t(W.side, 0.35)} />
              )}
              <Icon size={14} strokeWidth={1.7} />
              {label}
            </div>
          ))}
        </div>

        <div className="l7-main">
          <div className="l7-main__head">
            <div>
              <div className="l7-caps">Payments · Review</div>
              <div className="l7-serif l7-main__title">{b.name}</div>
            </div>
            <span className="l7-chip l7-mono">
              {b.currency} · {b.network}
            </span>
          </div>
          <table className="l7-table">
            <thead>
              <tr className="l7-caps">
                <th>Recipient</th>
                <th className="l7-col-role">Role</th>
                <th className="l7-num">Amount</th>
                <th className="l7-num l7-th-status">
                  Status <Marker n="1" at={at(0)} play={play} />
                </th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <motion.tr key={r.name} initial={reduce ? false : { opacity: 0, y: 6 }} animate={play ? { opacity: 1, y: 0 } : undefined} transition={t(W.rows + i * W.rowGap, 0.4)}>
                  <td>
                    <span className="l7-avatar l7-mono">{initials(r.name)}</span>
                    {r.name}
                  </td>
                  <td className="l7-col-role l7-muted">{r.role}</td>
                  <td className="l7-num l7-mono">{r.amount}</td>
                  <td className="l7-num">
                    <StatusChip screened={r.screened} ready />
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          <div className="l7-totals l7-totals--window">
            <div>
              <span className="l7-caps">Subtotal</span>
              <span className="l7-mono">{money(b.subtotal)}</span>
            </div>
            <div className="l7-totals__total">
              <span className="l7-caps l7-caps--ink">
                Total <Marker n="4" at={at(3)} play={play} />
              </span>
              <span className="l7-mono">
                {money(b.subtotal + b.fee)} <small>{b.currency}</small>
              </span>
            </div>
          </div>
        </div>

        <motion.div className="l7-drawer" initial={reduce ? false : { opacity: 0, x: 36 }} animate={play ? { opacity: 1, x: 0 } : undefined} transition={t(W.drawer, 0.6)}>
          <div className="l7-serif l7-drawer__title">Review &amp; approve</div>
          <div className="l7-drawer__row">
            <span>Recipients</span>
            <strong className="l7-mono">{b.rows.length}</strong>
          </div>
          <div className="l7-drawer__row">
            <span>Subtotal</span>
            <strong className="l7-mono">{money(b.subtotal)}</strong>
          </div>
          <div className="l7-drawer__row">
            <span>
              Execution fee <Marker n="2" at={at(1)} play={play} />
            </span>
            <strong className="l7-mono">{money(b.fee)}</strong>
          </div>
          <div className="l7-drawer__row l7-drawer__row--total">
            <span>Total</span>
            <strong className="l7-mono">
              {money(b.subtotal + b.fee)} <small>{b.currency}</small>
            </strong>
          </div>
          <div className="l7-drawer__row">
            <span>Screening</span>
            <span className="l7-chip">
              <ShieldCheck size={11} strokeWidth={2.2} /> 0 potential matches
            </span>
          </div>
          <div className="l7-approvals">
            <div className="l7-drawer__row">
              <span>
                Approvals <Marker n="3" at={at(2)} play={play} />
              </span>
              <strong className="l7-mono">{signed ? 2 : 1} of 2</strong>
            </div>
            <span className="l7-sig" aria-hidden>
              <span className="is-done" />
              <span className={signed ? 'is-done' : ''} />
            </span>
            <div className="l7-approvals__people">
              {b.approvers.map((a, i) => {
                const done = a.signed || signed
                return (
                  <span key={a.name} className={`l7-avatar l7-mono ${done ? 'l7-avatar--signed' : 'l7-avatar--pending'}`} title={a.name}>
                    {a.initials}
                    {i === 0 ? (
                      <Check size={9} strokeWidth={3} />
                    ) : (
                      <motion.span initial={{ scale: 0, opacity: 0 }} animate={signed ? { scale: 1, opacity: 1 } : undefined} transition={{ duration: 0.3, ease: EASE }}>
                        <Check size={9} strokeWidth={3} />
                      </motion.span>
                    )}
                  </span>
                )
              })}
              <motion.small key={signed ? 'ready' : 'waiting'} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                {signed ? 'Threshold met' : `Waiting on ${pending}`}
              </motion.small>
            </div>
          </div>
          <span className={`l7-btn l7-btn--block l7-btn--static ${executable ? 'l7-btn--accent' : 'l7-btn--ink'}`} aria-hidden>
            {executable ? 'Execute payment' : 'Sign approval'}
          </span>
          <p className="l7-drawer__note">Signed with your Safe account. Funds never leave your control.</p>
        </motion.div>
      </div>
    </div>
  )
}

/* September 2026: starts on a Tuesday, 30 days. Pay date Friday the 25th. */
const SEPT_2026 = { firstWeekday: 1, days: 30 } // 0 = Monday

function ScheduleMock() {
  const b = BATCH7
  const { ref, play } = useSequence<HTMLDivElement>()
  const t = useTiming()
  const cells = [...Array(SEPT_2026.firstWeekday).fill(null), ...Array.from({ length: SEPT_2026.days }, (_, i) => i + 1)]
  const steps = [
    { label: 'Draft prepared', day: 22 },
    { label: 'Approvals collected', day: 23 },
    { label: 'Screening re-checked', day: 24 },
    { label: 'Pay date', day: b.payDay, pay: true },
  ]
  return (
    <div className="l7-mock" ref={ref} role="img" aria-label="A monthly recurring schedule: draft on the 22nd, approvals on the 23rd, screening re-checked on the 24th, paid on Friday the 25th.">
      <div className="l7-mock__head">
        <span className="l7-serif">September 2026</span>
        <span className="l7-chip l7-chip--green l7-mono">Recurring · monthly</span>
      </div>
      <div className="l7-cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="l7-cal__dow l7-caps">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} className="l7-cal__day is-empty" />
          const pay = d === b.payDay
          const win = d >= 22 && d < b.payDay
          return (
            <span key={d} className="l7-cal__day l7-mono">
              {d}
              {(pay || win) && (
                <motion.i
                  className={pay ? 'is-pay' : 'is-window'}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={play ? { opacity: 1, scale: 1 } : undefined}
                  transition={t(pay ? 0.8 : 0.25 + (d - 22) * 0.14, 0.35)}
                >
                  {d}
                </motion.i>
              )}
            </span>
          )
        })}
      </div>
      <div className="l7-timeline">
        {steps.map((s, i) => (
          <div key={s.label} className={`l7-timeline__step ${s.pay ? 'is-pay' : 'is-done'}`}>
            {s.pay ? <motion.i initial={{ scale: 0.4, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : undefined} transition={t(1.1, 0.35)} /> : <i />}
            <span>{s.label}</span>
            <small className="l7-mono">Sep {s.day}{i === steps.length - 1 ? ' · Fri' : ''}</small>
          </div>
        ))}
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
    <div className="l7-mock" ref={ref} role="img" aria-label="A spreadsheet import: four columns mapped to Disburse fields, with two possible duplicates flagged for review.">
      <div className="l7-mock__head">
        <span className="l7-mono">contractors-sept.csv</span>
        <span className="l7-chip l7-mono">42 rows</span>
      </div>
      <div className="l7-map">
        <div className="l7-map__col">
          <small className="l7-caps">Your column</small>
          <small className="l7-caps">Disburse field</small>
        </div>
        {map.map(([from, to], i) => {
          const d = 0.2 + i * 0.16
          return (
            <div key={from} className="l7-map__row">
              <code className="l7-mono">{from}</code>
              <span className="l7-map__arrow" aria-hidden>
                <svg viewBox="0 0 24 12" width="24" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <motion.path d="M2 6h18" initial={{ pathLength: 0 }} animate={play ? { pathLength: 1 } : undefined} transition={t(d, 0.4)} />
                  <motion.path d="M15 1.5l4.5 4.5-4.5 4.5" initial={{ pathLength: 0 }} animate={play ? { pathLength: 1 } : undefined} transition={t(d + 0.3, 0.25)} />
                </svg>
              </span>
              <motion.span className="l7-map__field" initial={{ opacity: 0.35 }} animate={play ? { opacity: 1 } : undefined} transition={t(d + 0.35, 0.3)}>
                {to}
                <motion.span initial={{ scale: 0, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : undefined} transition={t(d + 0.5, 0.3)}>
                  <Check size={12} strokeWidth={2.5} />
                </motion.span>
              </motion.span>
            </div>
          )
        })}
      </div>
      <div className="l7-map__foot">
        <motion.span className="l7-chip l7-chip--amber" initial={{ scale: 0.6, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : undefined} transition={t(1.15, 0.4)}>
          2 possible duplicates
        </motion.span>
        <span className="l7-muted">Review before saving</span>
      </div>
    </div>
  )
}

function ReconcileMock() {
  const bars = [38, 52, 44, 70, 58, 82]
  const { ref, play } = useSequence<HTMLDivElement>()
  const t = useTiming()
  return (
    <div className="l7-mock" ref={ref} role="img" aria-label="Six months of outgoing USDC as a bar chart, with incoming, outgoing and fee totals and an export button.">
      <div className="l7-mock__head">
        <span className="l7-serif">Outgoing by month · USDC</span>
        <span className="l7-chip l7-mono">Export CSV</span>
      </div>
      <div className="l7-bars">
        {bars.map((h, i) => (
          <motion.span key={i} className={i === bars.length - 1 ? 'is-current' : ''} initial={{ height: '0%' }} animate={play ? { height: `${h}%` } : undefined} transition={t(0.15 + i * 0.1, 0.7)} />
        ))}
      </div>
      <div className="l7-summary">
        <div>
          <small className="l7-caps">Incoming</small>
          <strong className="l7-mono">+120,000.00</strong>
        </div>
        <div>
          <small className="l7-caps">Outgoing</small>
          <strong className="l7-mono">−48,254.80</strong>
        </div>
        <div>
          <small className="l7-caps">Fees</small>
          <strong className="l7-mono">−4.80</strong>
        </div>
      </div>
    </div>
  )
}

const MOCKS = { schedule: ScheduleMock, import: ImportMock, reconcile: ReconcileMock }

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="l7-faq__item">
      <summary>
        <span className="l7-serif">{q}</span>
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden />
      </summary>
      <div className="l7-faq__body">
        <p className="l7-muted">{a}</p>
      </div>
    </details>
  )
}

const heroItem = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

export default function Proposal7() {
  const reduce = useReducedMotion()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const burgerRef = useRef<HTMLButtonElement>(null)
  const team = PLANS.find(p => p.highlight)

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

  // Mobile menu: escape closes, focus stays inside, page does not scroll behind it.
  useEffect(() => {
    if (!menuOpen) return
    const menu = menuRef.current
    const focusables = () => Array.from(menu?.querySelectorAll<HTMLElement>('a, button') ?? [])
    focusables()[0]?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        burgerRef.current?.focus()
        return
      }
      if (e.key !== 'Tab') return
      const items = [burgerRef.current, ...focusables()].filter(Boolean) as HTMLElement[]
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [menuOpen])

  return (
    <div className="lp lp-7">
      <header className={`l7-header${scrolled ? ' is-scrolled' : ''}${menuOpen ? ' is-open' : ''}`}>
        <div className="l7-wrap l7-header__inner">
          <Link to="/" className="l7-wordmark">
            {BRAND}
          </Link>
          <nav className="l7-nav" aria-label="Primary">
            {NAV.map(n => (
              <NavLink key={n.href} href={n.href}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="l7-header__actions">
            <Link to="/login" className="l7-textlink l7-header__login">
              Log in
            </Link>
            <ThemeToggle />
            <Link to="/login" className="l7-btn l7-btn--ink l7-btn--sm l7-header__cta">
              {HERO.primaryCta}
            </Link>
            <button
              ref={burgerRef}
              type="button"
              className="l7-burger"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="l7-menu"
              onClick={() => setMenuOpen(o => !o)}
            >
              <i />
              <i />
            </button>
          </div>
        </div>
        {menuOpen && (
          <div id="l7-menu" ref={menuRef} className="l7-menu">
            <nav className="l7-menu__nav" aria-label="Primary">
              {NAV.map(n => (
                <NavLink key={n.href} href={n.href} onClick={() => setMenuOpen(false)}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="l7-menu__actions">
              <Link to="/login" className="l7-btn l7-btn--ghost l7-btn--block">
                Log in
              </Link>
              <Link to="/login" className="l7-btn l7-btn--ink l7-btn--block">
                {HERO.primaryCta}
              </Link>
            </div>
          </div>
        )}
      </header>
      {menuOpen && <button type="button" className="l7-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <main className="l7-main-landmark">
        {/* Hero */}
        <section className="l7-hero">
          <div className="l7-wrap">
            <div className="l7-hero__grid">
              <motion.div
                className="l7-hero__copy"
                initial={reduce ? false : 'hidden'}
                animate="visible"
                variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } }}
              >
                <motion.span variants={heroItem} className="l7-caps l7-caps--accent">
                  § {HERO.eyebrow}
                </motion.span>
                <h1 className="l7-display">
                  <motion.span variants={heroItem} className="block">
                    Pay your people.
                  </motion.span>
                  <motion.span variants={heroItem} className="block">
                    Stay in <em>control</em>.
                  </motion.span>
                </h1>
                <motion.p variants={heroItem}>{HERO.subtitle}</motion.p>
                <motion.div variants={heroItem} className="l7-hero__actions">
                  <Link to="/login" className="l7-btn l7-btn--ink">
                    {HERO.primaryCta} <ArrowRight size={16} />
                  </Link>
                  <a href="#product" className="l7-btn l7-btn--ghost">
                    {HERO.secondaryCta}
                  </a>
                </motion.div>
                <motion.span variants={heroItem} className="l7-hero__note l7-muted">
                  {CTA.note} · Non-custodial by design
                </motion.span>
              </motion.div>
              <motion.div
                className="l7-hero__ledger"
                initial={reduce ? false : { opacity: 0, y: 32, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.8, ease: EASE, delay: 0.45 }}
              >
                <Ledger />
              </motion.div>
            </div>

            <Reveal y={12} className="l7-trust">
              <span className="l7-caps">Settles in USDC on Ethereum, Base and Polygon</span>
              <span className="l7-caps">Signing through Safe smart accounts</span>
            </Reveal>
          </div>
        </section>

        {/* The product: what the reviewer checks */}
        <section id="product" className="l7-section">
          <div className="l7-wrap">
            <SectionHead
              n="01"
              label="In the product"
              title="What the reviewer checks before signing."
              lede="The approver sees exactly what the preparer saw: every recipient, the screening result, the fee, and the signatures still needed."
            />
            <Reveal y={28} className="l7-product">
              <AppWindow />
            </Reveal>
            <Stagger className="l7-checks" stagger={0.08}>
              {REVIEW_CHECKS.map(c => (
                <StaggerItem key={c.n} className="l7-check" y={12}>
                  <i className="l7-marker l7-marker--static l7-mono" aria-hidden>
                    {c.n}
                  </i>
                  <div>
                    <h3>{c.title}</h3>
                    <p className="l7-muted">{c.body}</p>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* Principles */}
        <section className="l7-section">
          <div className="l7-wrap">
            <SectionHead
              n="02"
              label="Principles"
              title="Built so nobody has to trust a middleman."
              lede="Disburse organises the work around your own Safe account. It never holds the money."
            />
            <Stagger className="l7-pillars" stagger={0.08}>
              {PILLARS.map((p, i) => {
                const Icon = PILLAR_ICONS[i]
                return (
                  <StaggerItem key={p.title} className="l7-pillar">
                    <div className="l7-pillar__top">
                      <span className="l7-mono l7-muted">{pad(i + 1)}</span>
                      <Icon size={18} strokeWidth={1.5} className="l7-pillar__icon" aria-hidden />
                    </div>
                    <h3 className="l7-serif">{p.title}</h3>
                    <p className="l7-muted">{p.body}</p>
                  </StaggerItem>
                )
              })}
            </Stagger>
          </div>
        </section>

        {/* Spotlights */}
        <section className="l7-section l7-section--tight">
          <div className="l7-wrap">
            <SectionHead n="03" label="In practice" title="Everything a pay run needs, and nothing it doesn't." />
            {SPOTLIGHTS.map(({ feature, mock, extras }, i) => {
              const Mock = MOCKS[mock]
              return (
                <div key={feature.title} className={`l7-spot${i % 2 ? ' l7-spot--flip' : ''}`}>
                  <Reveal className="l7-spot__text">
                    <span className="l7-mono l7-caps--accent">{pad(i + 1)}</span>
                    <h3 className="l7-serif">{feature.title}</h3>
                    <p className="l7-muted">{feature.body}</p>
                    <ul>
                      {extras.map(f => (
                        <li key={f.title}>
                          <Check size={14} strokeWidth={2.5} aria-hidden />
                          <span>
                            <strong>{f.title}.</strong> {f.body}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Reveal>
                  <Reveal className="l7-spot__mock" delay={0.1} y={32}>
                    <Mock />
                  </Reveal>
                </div>
              )
            })}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="l7-section l7-section--surface">
          <div className="l7-wrap">
            <SectionHead
              n="04"
              label="How it works"
              title="Up and running in an afternoon."
              lede="No new wallet, no migration. Start from the account and the spreadsheet you already have."
            />
            <Stagger className="l7-steps" stagger={0.1}>
              {STEPS.map(s => (
                <StaggerItem key={s.n} className="l7-step">
                  <span className="l7-mono l7-caps--accent">Step {s.n}</span>
                  <h3 className="l7-serif">{s.title}</h3>
                  <p className="l7-muted">{s.body}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* Comparison */}
        <section className="l7-section">
          <div className="l7-wrap">
            <SectionHead n="05" label="Compared" title="Where the control actually sits." lede="Three ways to pay a team in stablecoins, and who holds what at each step." />
            <Reveal y={20} className="l7-compare-wrap">
              <table className="l7-compare">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="l7-caps">Question</span>
                    </th>
                    {COMPARISON.columns.map((c, i) => (
                      <th key={c} scope="col" className={i === COMPARISON.columns.length - 1 ? 'is-us' : undefined}>
                        <span className="l7-serif">{c}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.rows.map(r => (
                    <tr key={r.label}>
                      <th scope="row">{r.label}</th>
                      {r.cells.map((cell, i) => (
                        <td key={i} className={i === r.cells.length - 1 ? 'is-us' : undefined}>
                          {i === r.cells.length - 1 && <Check size={13} strokeWidth={2.5} aria-hidden />}
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Reveal>
          </div>
        </section>

        {/* Stats */}
        <section className="l7-section l7-section--tight">
          <div className="l7-wrap">
            <Stagger className="l7-stats" stagger={0.08}>
              {STATS.map(s => (
                <StaggerItem key={s.label} className="l7-stat" y={12}>
                  <div className="l7-serif l7-stat__value">
                    <CountUp value={s.value} />
                  </div>
                  <div className="l7-muted">{STAT_LABELS[s.value] ?? s.label}</div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* Principle line (our own words, not a testimonial) */}
        <section className="l7-section">
          <div className="l7-wrap">
            <Reveal className="l7-quote">
              <span className="l7-caps l7-caps--accent">The idea in one line</span>
              <p className="l7-quote__text">The batch, the approvals and the record are the same document.</p>
              <span className="l7-muted">Prepared once. Signed by the people your account requires. Exported exactly as it settled.</span>
            </Reveal>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="l7-section l7-section--tight">
          <div className="l7-wrap">
            <SectionHead n="06" label="Pricing" title="Simple plans. No auto-renewal." lede={PRICING_NOTE} />
            <Stagger className="l7-plans" stagger={0.1}>
              {PLANS.map(p => (
                <StaggerItem key={p.key} className="l7-plan__slot" y={16}>
                  <div className={`l7-plan${p.highlight ? ' is-highlight' : ''}`}>
                    <div className="l7-plan__head">
                      <span className="l7-serif">{p.name}</span>
                      {p.highlight && <span className="l7-chip l7-chip--green">Recommended</span>}
                    </div>
                    <small className="l7-muted">{p.blurb}</small>
                    <div className="l7-plan__price">
                      <span className="l7-serif">${p.price}</span>
                      <em className="l7-muted">{p.price === 0 ? 'forever' : 'per 30 days · charged once'}</em>
                    </div>
                    <Link to="/login" className={`l7-btn l7-btn--block ${p.highlight ? 'l7-btn--ink' : 'l7-btn--ghost'}`}>
                      {p.price === 0 ? 'Start free' : `Try ${p.name} free`}
                    </Link>
                    <ul>
                      {p.features.map(f => (
                        <li key={f}>
                          <Check size={14} strokeWidth={2.5} aria-hidden />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
            {team && (
              <Reveal as="p" y={10} className="l7-plans__note l7-muted">
                Every new organization starts with a 30-day {team.name} trial. It does not renew unless you choose a plan.
              </Reveal>
            )}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="l7-section">
          <div className="l7-wrap">
            <SectionHead n="07" label="Questions" title="The things finance teams ask first." />
            <Stagger className="l7-faq" stagger={0.06}>
              {FAQ.map(f => (
                <StaggerItem key={f.q} y={10}>
                  <FaqItem q={f.q} a={f.a} />
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* Final CTA */}
        <section className="l7-section l7-section--tight">
          <div className="l7-wrap">
            <Reveal className="l7-panel" y={32}>
              <span className="l7-caps">§ {CTA.eyebrow}</span>
              <h2 className="l7-display">
                Make your next pay run <em>easier</em>.
              </h2>
              <p>{CTA.body}</p>
              <Link to="/login" className="l7-btn l7-btn--paper">
                {CTA.button} <ArrowRight size={16} />
              </Link>
              <small>{CTA.note}</small>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="l7-footer">
        <div className="l7-wrap">
          <Stagger className="l7-footer__grid" stagger={0.07}>
            <StaggerItem className="l7-footer__brand" y={12}>
              <span className="l7-wordmark">{BRAND}</span>
              <p className="l7-muted">{FOOTER.tagline}</p>
            </StaggerItem>
            {FOOTER.columns.map(c => (
              <StaggerItem key={c.title} className="l7-footer__col" y={12}>
                <span className="l7-caps l7-caps--ink">{c.title}</span>
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
          <div className="l7-footer__legal l7-muted">
            <span>© {new Date().getFullYear()} {BRAND}. Non-custodial. Your keys, your funds.</span>
            <span className="l7-mono">Settlement on Ethereum, Base and Polygon</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
