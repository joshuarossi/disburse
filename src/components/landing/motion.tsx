// Motion primitives for the public marketing pages: scroll reveal, stagger
// groups, a count-up for stats and the theme toggle. All respect
// prefers-reduced-motion.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { tx } from '@/lib/workspaceI18n'

// eslint-disable-next-line react-refresh/only-export-components -- shared kit
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

type RevealProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  tabIndex?: number
  'aria-label'?: string
  delay?: number
  /** Distance to travel in px. */
  y?: number
  as?: 'div' | 'section' | 'li' | 'article' | 'header' | 'footer' | 'p' | 'h1' | 'h2' | 'h3'
  once?: boolean
}

/** Fade + rise when the element scrolls into view. */
export function Reveal({ children, className, style, delay = 0, y = 24, as = 'div', once = true, tabIndex, 'aria-label': ariaLabel }: RevealProps) {
  const reduce = useReducedMotion()
  const Tag = motion[as]
  return (
    <Tag
      className={className}
      style={style}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-80px' }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </Tag>
  )
}

/** Wrap a list; children using <StaggerItem> rise in one after another. */
export function Stagger({ children, className, style, as = 'div', stagger = 0.09 }: RevealProps & { stagger?: number }) {
  const reduce = useReducedMotion()
  const Tag = motion[as]
  return (
    <Tag
      className={className}
      style={style}
      initial={reduce ? false : 'hidden'}
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: stagger, delayChildren: 0.05 } } }}
    >
      {children}
    </Tag>
  )
}

export function StaggerItem({ children, className, style, as = 'div', y = 20 }: RevealProps) {
  const Tag = motion[as]
  return (
    <Tag
      className={className}
      style={style}
      variants={{ hidden: { opacity: 0, y }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }}
    >
      {children}
    </Tag>
  )
}

/** Counts up to the number inside `value` once in view (keeps prefix/suffix like "30d" or "$50").
 *  Renders the final value by default, so an element that never intersects still shows the right number. */
export function CountUp({ value, duration = 1.2, className, from = 0 }: { value: string; duration?: number; className?: string; from?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const match = value.match(/^([^\d]*)(\d[\d,]*)(.*)$/)
  const target = match ? Number(match[2].replace(/,/g, '')) : NaN
  const [n, setN] = useState(target)

  useEffect(() => {
    if (!inView || reduce || Number.isNaN(target) || target === 0) return
    let raf = 0
    const start = performance.now()
    const base = target * from
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / (duration * 1000))
      const eased = 1 - Math.pow(1 - p, 3)
      setN(Math.round(base + (target - base) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, reduce, target, duration, from])

  if (!match) return <span className={className}>{value}</span>
  const formatted = match[2].includes(',') ? n.toLocaleString('en-US') : String(n)
  return (
    <span ref={ref} className={className}>
      {match[1]}{formatted}{match[3]}
    </span>
  )
}

/** Sun/moon toggle wired to the site's ThemeProvider. Style via `.lp-theme-toggle`. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`mk-theme-toggle ${className}`}
      aria-label={dark ? tx('Switch to light theme') : tx('Switch to dark theme')}
      title={dark ? tx('Light theme') : tx('Dark theme')}
      data-theme-state={theme}
    >
      <span className="mk-theme-toggle__icon" aria-hidden>
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </span>
    </button>
  )
}
