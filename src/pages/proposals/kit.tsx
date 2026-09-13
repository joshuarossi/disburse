// Shared building blocks for the landing page proposals: theme toggle,
// scroll reveal, stagger groups and a count-up for stats. Every proposal
// uses these so motion feels consistent; each adds its own mock-up motion.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { motion, useInView, useReducedMotion, type Variants } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'

// eslint-disable-next-line react-refresh/only-export-components -- shared kit
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

// eslint-disable-next-line react-refresh/only-export-components -- shared kit
export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

// eslint-disable-next-line react-refresh/only-export-components -- shared kit
export const staggerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}

type RevealProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  delay?: number
  /** Distance to travel in px. */
  y?: number
  as?: 'div' | 'section' | 'li' | 'article' | 'header' | 'footer' | 'p' | 'h1' | 'h2' | 'h3'
  once?: boolean
}

/** Fade + rise when the element scrolls into view. */
export function Reveal({ children, className, style, delay = 0, y = 24, as = 'div', once = true }: RevealProps) {
  const reduce = useReducedMotion()
  const Tag = motion[as]
  return (
    <Tag
      className={className}
      style={style}
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

/** Counts from 0 to the number inside `value` (keeps prefix/suffix like "30d" or "$50"). */
export function CountUp({ value, duration = 1.2, className }: { value: string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const match = value.match(/^([^\d]*)(\d[\d,]*)(.*)$/)
  const target = match ? Number(match[2].replace(/,/g, '')) : NaN
  const [n, setN] = useState(reduce || Number.isNaN(target) ? target : 0)

  useEffect(() => {
    if (!inView || reduce || Number.isNaN(target)) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / (duration * 1000))
      const eased = 1 - Math.pow(1 - p, 3)
      setN(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, reduce, target, duration])

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
      className={`lp-theme-toggle ${className}`}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      data-theme-state={theme}
    >
      <span className="lp-theme-toggle__icon" aria-hidden>
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </span>
    </button>
  )
}

/** True when the document is in dark mode; re-renders on change. */
// eslint-disable-next-line react-refresh/only-export-components -- shared kit
export function useIsDark() {
  const { theme } = useTheme()
  return theme === 'dark'
}
