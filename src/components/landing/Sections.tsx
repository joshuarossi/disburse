import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, ChevronDown, History, Lock, ShieldCheck, UsersRound } from 'lucide-react'
import { tx } from '@/lib/workspaceI18n'
import { getPlanFeatures, PLANS as PLAN_META, type PlanKey } from '@/lib/billingPlans'
import { AVAILABLE_PAID_PLANS } from '../../../shared/billing'
import { BRAND, useLandingContent } from './content'
import { CountUp, EASE, Reveal, Stagger, StaggerItem } from './motion'
import { ImportMock, ReconcileMock, ScheduleMock } from './Mocks'

const pad = (n: number) => String(n).padStart(2, '0')

export function SectionHead({ n, label, title, lede }: { n: string; label: string; title: ReactNode; lede?: string }) {
  const reduce = useReducedMotion()
  return (
    <div className="mk-head">
      <motion.hr
        className="mk-head__rule"
        initial={reduce ? false : { scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.9, ease: EASE }}
      />
      <Reveal y={14} className="mk-head__inner">
        <span className="mk-caps mk-caps--accent">
          {n} · {label}
        </span>
        <h2 className="mk-serif">{title}</h2>
        {lede && <p>{lede}</p>}
      </Reveal>
    </div>
  )
}

const PILLAR_ICONS = [Lock, UsersRound, ShieldCheck, History]

export function Principles() {
  const { principles } = useLandingContent()
  return (
    <section className="mk-section">
      <div className="mk-wrap">
        <SectionHead n="02" label={principles.label} title={principles.title} lede={principles.lede} />
        <Stagger className="mk-pillars" stagger={0.08}>
          {principles.items.map((p, i) => {
            const Icon = PILLAR_ICONS[i]
            return (
              <StaggerItem key={p.title} className="mk-pillar">
                <div className="mk-pillar__top">
                  <span className="mk-mono mk-muted">{pad(i + 1)}</span>
                  <Icon size={18} strokeWidth={1.5} className="mk-pillar__icon" aria-hidden />
                </div>
                <h3 className="mk-serif">{p.title}</h3>
                <p className="mk-muted">{p.body}</p>
              </StaggerItem>
            )
          })}
        </Stagger>
      </div>
    </section>
  )
}

const MOCKS = { schedule: ScheduleMock, import: ImportMock, reconcile: ReconcileMock }

export function Spotlights() {
  const { practice } = useLandingContent()
  return (
    <section className="mk-section mk-section--tight">
      <div className="mk-wrap">
        <SectionHead n="03" label={practice.label} title={practice.title} />
        {practice.spotlights.map((s, i) => {
          const Mock = MOCKS[s.mock]
          return (
            <div key={s.title} className={`mk-spot${i % 2 ? ' mk-spot--flip' : ''}`}>
              <Reveal className="mk-spot__text">
                <span className="mk-mono mk-caps--accent">{pad(i + 1)}</span>
                <h3 className="mk-serif">{s.title}</h3>
                <p className="mk-muted">{s.body}</p>
                <ul>
                  {s.extras.map(f => (
                    <li key={f.title}>
                      <Check size={14} strokeWidth={2.5} aria-hidden />
                      <span>
                        <strong>{f.title}.</strong> {f.body}
                      </span>
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal className="mk-spot__mock" delay={0.1} y={32}>
                <Mock />
              </Reveal>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function HowItWorks() {
  const { how } = useLandingContent()
  return (
    <section id="how" className="mk-section mk-section--surface">
      <div className="mk-wrap">
        <SectionHead n="04" label={how.label} title={how.title} lede={how.lede} />
        <Stagger className="mk-steps" stagger={0.1}>
          {how.steps.map(s => (
            <StaggerItem key={s.n} className="mk-step">
              <span className="mk-mono mk-caps--accent">{s.n}</span>
              <h3 className="mk-serif">{s.title}</h3>
              <p className="mk-muted">{s.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}

export function Comparison() {
  const { compare } = useLandingContent()
  const last = compare.columns.length - 1
  return (
    <section className="mk-section">
      <div className="mk-wrap">
        <SectionHead n="05" label={compare.label} title={compare.title} lede={compare.lede} />
        <Reveal y={20} className="mk-compare-wrap" tabIndex={0} aria-label={compare.title}>
          <table className="mk-compare">
            <thead>
              <tr>
                <th scope="col">
                  <span className="mk-caps">{compare.question}</span>
                </th>
                {compare.columns.map((c, i) => (
                  <th key={c} scope="col" className={i === last ? 'is-us' : undefined}>
                    <span className="mk-serif">{c}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compare.rows.map(r => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {r.cells.map((cell, i) => (
                    <td key={i} className={i === last ? 'is-us' : undefined}>
                      {i === last && <Check size={13} strokeWidth={2.5} aria-hidden />}
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
  )
}

export function Stats() {
  const { stats } = useLandingContent()
  return (
    <section className="mk-section mk-section--tight">
      <div className="mk-wrap">
        <Stagger className="mk-stats" stagger={0.08}>
          {stats.map(s => (
            <StaggerItem key={s.label} className="mk-stat" y={12}>
              <div className="mk-serif mk-stat__value">
                <CountUp value={s.value} />
              </div>
              <div className="mk-muted">{s.label}</div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}

export function Idea() {
  const { idea } = useLandingContent()
  return (
    <section className="mk-section">
      <div className="mk-wrap">
        <Reveal className="mk-quote">
          <span className="mk-caps mk-caps--accent">{idea.label}</span>
          <p className="mk-quote__text">{idea.text}</p>
          <span className="mk-muted">{idea.sub}</span>
        </Reveal>
      </div>
    </section>
  )
}

export function Pricing() {
  const { pricing } = useLandingContent()
  const { t } = useTranslation()
  const plans = (['free', ...AVAILABLE_PAID_PLANS] as const).map(key => {
    const meta = key === 'free' ? { ...PLAN_META.starter, price: 0, popular: false } : PLAN_META[key]
    return { key, price: meta.price, highlight: meta.popular, features: getPlanFeatures(key === 'free' ? 'starter' : (key as PlanKey)) }
  })
  return (
    <section id="pricing" className="mk-section mk-section--tight">
      <div className="mk-wrap">
        <SectionHead n="06" label={pricing.label} title={pricing.title} lede={pricing.lede} />
        <Stagger className="mk-plans" stagger={0.1}>
          {plans.map(p => {
            const name = t(`settings.billing.plans.${p.key}.name`)
            return (
              <StaggerItem key={p.key} className="mk-plan__slot" y={16}>
                <div className={`mk-plan${p.highlight ? ' is-highlight' : ''}`}>
                  <div className="mk-plan__head">
                    <span className="mk-serif">{name}</span>
                    {p.highlight && <span className="mk-chip mk-chip--green">{pricing.recommended}</span>}
                  </div>
                  <small className="mk-muted">{t(`settings.billing.plans.${p.key}.description`)}</small>
                  <div className="mk-plan__price">
                    <span className="mk-serif">${p.price}</span>
                    <em className="mk-muted">{p.price === 0 ? pricing.forever : pricing.per30}</em>
                  </div>
                  <Link to="/login" className={`mk-btn mk-btn--block ${p.highlight ? 'mk-btn--ink' : 'mk-btn--ghost'}`}>
                    {p.price === 0 ? pricing.startFree : tx('Try {{plan}} free', { plan: name })}
                  </Link>
                  <ul>
                    {p.features.map(f => (
                      <li key={f.key}>
                        <Check size={14} strokeWidth={2.5} aria-hidden />
                        <span>{t(`settings.billing.features.${f.key}`, { defaultValue: f.text, count: f.count })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
        <Reveal as="p" y={10} className="mk-plans__note mk-muted">
          {pricing.note}
        </Reveal>
      </div>
    </section>
  )
}

export function Faq() {
  const { faq } = useLandingContent()
  return (
    <section id="faq" className="mk-section">
      <div className="mk-wrap">
        <SectionHead n="07" label={faq.label} title={faq.title} />
        <Stagger className="mk-faq" stagger={0.06}>
          {faq.items.map(f => (
            <StaggerItem key={f.q} y={10}>
              <details className="mk-faq__item">
                <summary>
                  <span className="mk-serif">{f.q}</span>
                  <ChevronDown size={16} strokeWidth={1.8} aria-hidden />
                </summary>
                <div className="mk-faq__body">
                  <p className="mk-muted">{f.a}</p>
                </div>
              </details>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}

export function FinalCta() {
  const { cta } = useLandingContent()
  return (
    <section className="mk-section mk-section--tight">
      <div className="mk-wrap">
        <Reveal className="mk-panel marketing-cta" y={32}>
          <span className="mk-caps">§ {cta.eyebrow}</span>
          <h2 className="mk-display">
            {cta.titleBefore} <em>{cta.titleEm}</em>.
          </h2>
          <p>{cta.body}</p>
          <Link to="/login" className="mk-btn mk-btn--paper">
            {cta.button} <ArrowRight size={16} aria-hidden />
          </Link>
          <small>{cta.note}</small>
        </Reveal>
      </div>
    </section>
  )
}

export { BRAND }
