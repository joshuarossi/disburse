import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { tx } from '@/lib/workspaceI18n'
import { money, useLandingContent, useSampleBatch } from './content'
import { EASE, Reveal } from './motion'
import { useCount, useLater, useSequence } from './hooks'

export function StatusChip({ screened, ready }: { screened: boolean; ready: boolean }) {
  if (screened) {
    return (
      <span className="mk-chip mk-chip--ink">
        <ShieldCheck size={11} strokeWidth={2.2} aria-hidden /> {tx('Screened')}
      </span>
    )
  }
  return <span className={`mk-chip ${ready ? 'mk-chip--green' : ''}`}>{ready ? tx('Ready') : tx('Draft')}</span>
}

/* The preparation view. Rows print, the total settles, the second signature
   arrives, the stamp lands. About 2.4 seconds, once. */
const L = { rowStart: 0.2, rowGap: 0.1, rowDur: 0.26, count: 900, approve: 1900, stamp: 2300 }

function Ledger() {
  const b = useSampleBatch()
  const { ref, play, reduce } = useSequence<HTMLDivElement>('-60px')
  const subtotal = useCount(play, b.subtotal, { from: b.subtotal * 0.82, delay: L.count, ms: 700 })
  const approved = useLater(play, L.approve)
  const stamped = useLater(play, L.stamp)
  const pending = b.approvers.find(a => !a.signed)?.name.split(' ')[0] ?? ''
  const description = tx('A prepared payment batch, {{name}}: six recipients totalling {{total}} {{currency}}, awaiting a second approval.', {
    name: b.name,
    total: money(b.subtotal + b.fee),
    currency: b.currency,
  })

  return (
    <div ref={ref} className="mk-ledger" role="img" aria-label={description}>
      <span className={`mk-stamp mk-mono${approved ? ' is-ready' : ''}`}>
        {approved ? tx('Ready') : tx('Draft')} · {tx('{{count}} payouts', { count: b.rows.length })}
      </span>
      <div className="mk-ledger__head">
        <div className="mk-caps">{tx('Batch')}</div>
        <div className="mk-serif mk-ledger__title">{b.name}</div>
        <div className="mk-mono mk-muted mk-ledger__meta">
          {b.currency} · {b.network} · {tx('Pay date')} {b.payDateLabel}
        </div>
      </div>
      <div className="mk-ledger__table">
        <table className="mk-table">
          <thead>
            <tr className="mk-caps">
              <th>{tx('Recipient')}</th>
              <th className="mk-col-role-sm">{tx('Role')}</th>
              <th className="mk-num">{tx('Amount')}</th>
              <th className="mk-num">{tx('Status')}</th>
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
                <td className="mk-col-role-sm mk-muted">{r.role}</td>
                <td className="mk-num mk-mono">{money(r.amount)}</td>
                <td className="mk-num">
                  <StatusChip screened={r.screened} ready={approved} />
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        <div className="mk-totals">
          <div>
            <span className="mk-caps">{tx('Subtotal')}</span>
            <span className="mk-mono">{money(subtotal)}</span>
          </div>
          <div>
            <span className="mk-caps">{tx('Execution fee')}</span>
            <span className="mk-mono">{money(b.fee)}</span>
          </div>
          <div className="mk-totals__total">
            <span className="mk-caps mk-caps--ink">{tx('Total')}</span>
            <span className="mk-mono">
              {money(subtotal + b.fee)} <small>{b.currency}</small>
            </span>
          </div>
        </div>
      </div>
      <div className="mk-ledger__foot">
        <span className="mk-ledger__sig">
          <span className="mk-sig mk-sig--fixed" aria-hidden>
            <span className="is-done" />
            <span className={approved ? 'is-done' : ''} />
          </span>
          <motion.span
            key={approved ? 'ready' : 'awaiting'}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            {approved ? tx('Approvals 2 of 2 · ready to execute') : tx('Approvals 1 of 2 · awaiting {{name}}', { name: pending })}
          </motion.span>
        </span>
        <span className="mk-chip">
          <ShieldCheck size={11} strokeWidth={2.2} aria-hidden /> {tx('6 of 6 screened')}
        </span>
      </div>
      {stamped && (
        <motion.span
          className="mk-approved"
          aria-hidden
          initial={reduce ? false : { opacity: 0, scale: 1.3, rotate: -14 }}
          animate={{ opacity: 1, scale: 1, rotate: -8 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          {tx('Approved')}
        </motion.span>
      )}
    </div>
  )
}

const heroItem = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

export function Hero() {
  const { hero } = useLandingContent()
  const reduce = useReducedMotion()
  return (
    <section className="mk-hero">
      <div className="mk-wrap">
        <div className="mk-hero__grid">
          <motion.div
            className="mk-hero__copy"
            initial={reduce ? false : 'hidden'}
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } }}
          >
            <motion.span variants={heroItem} className="mk-caps mk-caps--accent">
              § {hero.eyebrow}
            </motion.span>
            <h1 className="mk-display">
              <motion.span variants={heroItem} className="block">
                {hero.line1}
              </motion.span>
              <motion.span variants={heroItem} className="block">
                {hero.line2Before} <em>{hero.line2Em}</em>.
              </motion.span>
            </h1>
            <motion.p variants={heroItem}>{hero.subtitle}</motion.p>
            <motion.div variants={heroItem} className="mk-hero__actions">
              <Link to="/login" className="mk-btn mk-btn--ink">
                {hero.primary} <ArrowRight size={16} aria-hidden />
              </Link>
              <Link to={{ pathname: '/', hash: '#product' }} className="mk-btn mk-btn--ghost">
                {hero.secondary}
              </Link>
            </motion.div>
            <motion.span variants={heroItem} className="mk-hero__note mk-muted">
              {hero.note}
            </motion.span>
          </motion.div>
          <motion.div
            className="mk-hero__ledger"
            initial={reduce ? false : { opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.45 }}
          >
            <Ledger />
          </motion.div>
        </div>
        <Reveal y={12} className="mk-trust">
          <span className="mk-caps">{hero.trustA}</span>
          <span className="mk-caps">{hero.trustB}</span>
        </Reveal>
      </div>
    </section>
  )
}
