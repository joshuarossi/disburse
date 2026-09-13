import { motion, useReducedMotion } from 'framer-motion'
import { Check } from 'lucide-react'
import { tx, workspaceLocale } from '@/lib/workspaceI18n'
import { useSampleBatch } from './content'
import { EASE } from './motion'
import { useSequence } from './hooks'

const useTiming = () => {
  const reduce = useReducedMotion()
  return (delay: number, duration = 0.4) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE })
}

/* September 2026 starts on a Tuesday and has 30 days. Pay date is Friday the 25th. */
const MONTH = { year: 2026, month: 8, firstWeekday: 1, days: 30 } // firstWeekday: 0 = Monday

export function ScheduleMock() {
  const b = useSampleBatch()
  const { ref, play } = useSequence<HTMLDivElement>()
  const t = useTiming()
  const locale = workspaceLocale()
  const monthLabel = new Date(MONTH.year, MONTH.month, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const dow = Array.from({ length: 7 }, (_, i) => new Date(2026, 8, 7 + i).toLocaleDateString(locale, { weekday: 'narrow' }))
  const cells = [...Array(MONTH.firstWeekday).fill(null), ...Array.from({ length: MONTH.days }, (_, i) => i + 1)]
  const day = (d: number) => new Date(MONTH.year, MONTH.month, d).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  const steps = [
    { label: tx('Draft prepared'), d: 22 },
    { label: tx('Approvals collected'), d: 23 },
    { label: tx('Screening re-checked'), d: 24 },
    { label: tx('Pay date'), d: b.payDay, pay: true },
  ]
  const description = tx('A monthly recurring schedule: draft on the 22nd, approvals on the 23rd, screening re-checked on the 24th, paid on Friday the 25th.')
  return (
    <div className="mk-mock" ref={ref} role="img" aria-label={description}>
      <div className="mk-mock__head">
        <span className="mk-serif">{monthLabel}</span>
        <span className="mk-chip mk-chip--green mk-mono">{tx('Recurring · monthly')}</span>
      </div>
      <div className="mk-cal">
        {dow.map((d, i) => (
          <span key={i} className="mk-cal__dow mk-caps">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} className="mk-cal__day is-empty" />
          const pay = d === b.payDay
          const win = d >= 22 && d < b.payDay
          return (
            <span key={d} className="mk-cal__day mk-mono">
              {d}
              {(pay || win) && (
                <motion.i className={pay ? 'is-pay' : 'is-window'} initial={{ opacity: 0, scale: 0.6 }} animate={play ? { opacity: 1, scale: 1 } : undefined} transition={t(pay ? 0.8 : 0.25 + (d - 22) * 0.14, 0.35)}>
                  {d}
                </motion.i>
              )}
            </span>
          )
        })}
      </div>
      <div className="mk-timeline">
        {steps.map(s => (
          <div key={s.label} className={`mk-timeline__step ${s.pay ? 'is-pay' : 'is-done'}`}>
            {s.pay ? <motion.i initial={{ scale: 0.4, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : undefined} transition={t(1.1, 0.35)} /> : <i />}
            <span>{s.label}</span>
            <small className="mk-mono">{day(s.d)}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ImportMock() {
  const map = [
    ['full_name', tx('Recipient name')],
    ['email', tx('Email')],
    ['wallet', tx('Payout address')],
    ['monthly_usd', tx('Amount')],
  ]
  const { ref, play } = useSequence<HTMLDivElement>()
  const t = useTiming()
  const description = tx('A spreadsheet import: four columns mapped to Disburse fields, with two possible duplicates flagged for review.')
  return (
    <div className="mk-mock" ref={ref} role="img" aria-label={description}>
      <div className="mk-mock__head">
        <span className="mk-mono">{'contractors-sept.csv'}</span>
        <span className="mk-chip mk-mono">{tx('{{count}} rows', { count: 42 })}</span>
      </div>
      <div className="mk-map">
        <div className="mk-map__col">
          <small className="mk-caps">{tx('Your column')}</small>
          <small className="mk-caps">{tx('Disburse field')}</small>
        </div>
        {map.map(([from, to], i) => {
          const d = 0.2 + i * 0.16
          return (
            <div key={from} className="mk-map__row">
              <code className="mk-mono">{from}</code>
              <span className="mk-map__arrow" aria-hidden>
                <svg viewBox="0 0 24 12" width="24" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <motion.path d="M2 6h18" initial={{ pathLength: 0 }} animate={play ? { pathLength: 1 } : undefined} transition={t(d, 0.4)} />
                  <motion.path d="M15 1.5l4.5 4.5-4.5 4.5" initial={{ pathLength: 0 }} animate={play ? { pathLength: 1 } : undefined} transition={t(d + 0.3, 0.25)} />
                </svg>
              </span>
              <motion.span className="mk-map__field" initial={{ opacity: 0.35 }} animate={play ? { opacity: 1 } : undefined} transition={t(d + 0.35, 0.3)}>
                {to}
                <motion.span initial={{ scale: 0, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : undefined} transition={t(d + 0.5, 0.3)}>
                  <Check size={12} strokeWidth={2.5} aria-hidden />
                </motion.span>
              </motion.span>
            </div>
          )
        })}
      </div>
      <div className="mk-map__foot">
        <motion.span className="mk-chip mk-chip--amber" initial={{ scale: 0.6, opacity: 0 }} animate={play ? { scale: 1, opacity: 1 } : undefined} transition={t(1.15, 0.4)}>
          {tx('{{count}} possible duplicates', { count: 2 })}
        </motion.span>
        <span className="mk-muted">{tx('Review before saving')}</span>
      </div>
    </div>
  )
}

export function ReconcileMock() {
  const bars = [38, 52, 44, 70, 58, 82]
  const { ref, play } = useSequence<HTMLDivElement>()
  const t = useTiming()
  const description = tx('Six months of outgoing USDC as a bar chart, with incoming, outgoing and fee totals and an export button.')
  return (
    <div className="mk-mock" ref={ref} role="img" aria-label={description}>
      <div className="mk-mock__head">
        <span className="mk-serif">{`${tx('Outgoing by month')} · USDC`}</span>
        <span className="mk-chip mk-mono">{tx('Export CSV')}</span>
      </div>
      <div className="mk-bars">
        {bars.map((h, i) => (
          <motion.span key={i} className={i === bars.length - 1 ? 'is-current' : ''} initial={{ height: '0%' }} animate={play ? { height: `${h}%` } : undefined} transition={t(0.15 + i * 0.1, 0.7)} />
        ))}
      </div>
      <div className="mk-summary">
        <div>
          <small className="mk-caps">{tx('Incoming')}</small>
          <strong className="mk-mono">+120,000.00</strong>
        </div>
        <div>
          <small className="mk-caps">{tx('Outgoing')}</small>
          <strong className="mk-mono">−48,254.80</strong>
        </div>
        <div>
          <small className="mk-caps">{tx('Fees')}</small>
          <strong className="mk-mono">−4.80</strong>
        </div>
      </div>
    </div>
  )
}
