import { motion, useReducedMotion } from 'framer-motion'
import { BarChart3, Check, CreditCard, FileText, LayoutDashboard, Settings, ShieldCheck, Users, UsersRound, Wallet } from 'lucide-react'
import { tx } from '@/lib/workspaceI18n'
import { money, useLandingContent, useSampleBatch } from './content'
import { EASE, Reveal, Stagger, StaggerItem } from './motion'
import { StatusChip } from './Hero'
import { useLater, useSequence } from './hooks'
import { SectionHead } from './Sections'

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

/* The reviewer's view. Rows are already prepared; the drawer and the numbered
   checks are the story. Seconds after in-view: 0.1 sidebar · 0.25+ rows ·
   1.0 drawer · 1.4–2.3 markers 1 to 4 · 2.6 second signer · 3.0 execute */
const W = { side: 0.1, rows: 0.25, rowGap: 0.08, drawer: 1.0, marks: 1.4, markGap: 0.3, sign: 2.6, exec: 3.0 }

function Marker({ n, at, play }: { n: string; at: number; play: boolean }) {
  const t = useTiming()
  return (
    <motion.i className="mk-marker mk-mono" initial={{ opacity: 0, scale: 0.5 }} animate={play ? { opacity: 1, scale: 1 } : undefined} transition={t(at, 0.3)} aria-hidden>
      {n}
    </motion.i>
  )
}

function Window() {
  const b = useSampleBatch()
  const t = useTiming()
  const { ref, play, reduce } = useSequence<HTMLDivElement>('-120px')
  const signed = useLater(play, W.sign * 1000)
  const executable = useLater(play, W.exec * 1000)
  const at = (i: number) => W.marks + i * W.markGap
  const pending = b.approvers.find(a => !a.signed)?.name.split(' ')[0] ?? ''
  const sidebar = [
    { label: tx('Dashboard'), icon: LayoutDashboard },
    { label: tx('Recipients'), icon: UsersRound },
    { label: tx('Payments'), icon: CreditCard, active: true },
    { label: tx('Invoices'), icon: FileText },
    { label: tx('Treasury'), icon: Wallet },
    { label: tx('Reports'), icon: BarChart3 },
    { label: tx('Team'), icon: Users },
    { label: tx('Settings'), icon: Settings },
  ]
  const description = tx('The Disburse review screen for {{name}}: the recipient table, the execution fee, the screening result and the two required signatures.', { name: b.name })

  return (
    <div ref={ref} className="mk-window" role="img" aria-label={description}>
      <div className="mk-window__chrome">
        <span className="mk-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="mk-window__url mk-mono">
          {tx('Payments')} › {b.name}
        </span>
        <span className={`mk-stamp mk-stamp--inline mk-mono${signed ? ' is-ready' : ''}`}>{signed ? tx('Ready') : tx('In review')}</span>
      </div>
      <div className="mk-window__body">
        <div className="mk-side">
          <div className="mk-side__org">
            <span className="mk-side__avatar mk-mono">{initials(b.org)}</span>
            <span className="mk-serif">{b.org}</span>
          </div>
          {sidebar.map(({ label, icon: Icon, active }) => (
            <div key={label} className={`mk-side__item${active ? ' is-active' : ''}`}>
              {active && <motion.i className="mk-side__hl" initial={{ opacity: 0 }} animate={play ? { opacity: 1 } : undefined} transition={t(W.side, 0.35)} />}
              <Icon size={14} strokeWidth={1.7} aria-hidden />
              {label}
            </div>
          ))}
        </div>

        <div className="mk-main">
          <div className="mk-main__head">
            <div>
              <div className="mk-caps">
                {tx('Payments')} · {tx('Review')}
              </div>
              <div className="mk-serif mk-main__title">{b.name}</div>
            </div>
            <span className="mk-chip mk-mono">
              {b.currency} · {b.network}
            </span>
          </div>
          <table className="mk-table">
            <thead>
              <tr className="mk-caps">
                <th>{tx('Recipient')}</th>
                <th className="mk-col-role">{tx('Role')}</th>
                <th className="mk-num">{tx('Amount')}</th>
                <th className="mk-num mk-th-status">
                  {tx('Status')} <Marker n="1" at={at(0)} play={play} />
                </th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <motion.tr key={r.name} initial={reduce ? false : { opacity: 0, y: 6 }} animate={play ? { opacity: 1, y: 0 } : undefined} transition={t(W.rows + i * W.rowGap, 0.4)}>
                  <td>
                    <span className="mk-avatar mk-mono">{initials(r.name)}</span>
                    {r.name}
                  </td>
                  <td className="mk-col-role mk-muted">{r.role}</td>
                  <td className="mk-num mk-mono">{money(r.amount)}</td>
                  <td className="mk-num">
                    <StatusChip screened={r.screened} ready />
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          <div className="mk-totals mk-totals--window">
            <div>
              <span className="mk-caps">{tx('Subtotal')}</span>
              <span className="mk-mono">{money(b.subtotal)}</span>
            </div>
            <div className="mk-totals__total">
              <span className="mk-caps mk-caps--ink">
                {tx('Total')} <Marker n="4" at={at(3)} play={play} />
              </span>
              <span className="mk-mono">
                {money(b.subtotal + b.fee)} <small>{b.currency}</small>
              </span>
            </div>
          </div>
        </div>

        <motion.div className="mk-drawer" initial={reduce ? false : { opacity: 0, x: 36 }} animate={play ? { opacity: 1, x: 0 } : undefined} transition={t(W.drawer, 0.6)}>
          <div className="mk-serif mk-drawer__title">{tx('Review & approve')}</div>
          <div className="mk-drawer__row">
            <span>{tx('Recipients')}</span>
            <strong className="mk-mono">{b.rows.length}</strong>
          </div>
          <div className="mk-drawer__row">
            <span>{tx('Subtotal')}</span>
            <strong className="mk-mono">{money(b.subtotal)}</strong>
          </div>
          <div className="mk-drawer__row">
            <span>
              {tx('Execution fee')} <Marker n="2" at={at(1)} play={play} />
            </span>
            <strong className="mk-mono">{money(b.fee)}</strong>
          </div>
          <div className="mk-drawer__row mk-drawer__row--total">
            <span>{tx('Total')}</span>
            <strong className="mk-mono">
              {money(b.subtotal + b.fee)} <small>{b.currency}</small>
            </strong>
          </div>
          <div className="mk-drawer__row">
            <span>{tx('Screening')}</span>
            <span className="mk-chip">
              <ShieldCheck size={11} strokeWidth={2.2} aria-hidden /> {tx('0 potential matches')}
            </span>
          </div>
          <div className="mk-approvals">
            <div className="mk-drawer__row">
              <span>
                {tx('Approvals')} <Marker n="3" at={at(2)} play={play} />
              </span>
              <strong className="mk-mono">{tx('{{have}} of {{need}}', { have: signed ? 2 : 1, need: 2 })}</strong>
            </div>
            <span className="mk-sig" aria-hidden>
              <span className="is-done" />
              <span className={signed ? 'is-done' : ''} />
            </span>
            <div className="mk-approvals__people">
              {b.approvers.map((a, i) => {
                const done = a.signed || signed
                return (
                  <span key={a.name} className={`mk-avatar mk-mono ${done ? 'mk-avatar--signed' : 'mk-avatar--pending'}`}>
                    {a.initials}
                    {i === 0 ? (
                      <Check size={9} strokeWidth={3} aria-hidden />
                    ) : (
                      <motion.span initial={{ scale: 0, opacity: 0 }} animate={signed ? { scale: 1, opacity: 1 } : undefined} transition={{ duration: 0.3, ease: EASE }}>
                        <Check size={9} strokeWidth={3} aria-hidden />
                      </motion.span>
                    )}
                  </span>
                )
              })}
              <motion.small key={signed ? 'ready' : 'waiting'} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                {signed ? tx('Threshold met') : tx('Waiting on {{name}}', { name: pending })}
              </motion.small>
            </div>
          </div>
          <span className={`mk-btn mk-btn--block mk-btn--static ${executable ? 'mk-btn--accent' : 'mk-btn--ink'}`} aria-hidden>
            {executable ? tx('Execute payment') : tx('Sign approval')}
          </span>
          <p className="mk-drawer__note">{tx('Signed with your Safe account. Funds never leave your control.')}</p>
        </motion.div>
      </div>
    </div>
  )
}

export function ProductSection() {
  const { product } = useLandingContent()
  return (
    <section id="product" className="mk-section">
      <div className="mk-wrap">
        <SectionHead n="01" label={product.label} title={product.title} lede={product.lede} />
        <Reveal y={28} className="mk-product">
          <Window />
        </Reveal>
        <Stagger className="mk-checks" stagger={0.08}>
          {product.checks.map(c => (
            <StaggerItem key={c.n} className="mk-check" y={12}>
              <i className="mk-marker mk-marker--static mk-mono" aria-hidden>
                {c.n}
              </i>
              <div>
                <h3>{c.title}</h3>
                <p className="mk-muted">{c.body}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
