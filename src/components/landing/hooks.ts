import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'framer-motion'

/** Runs an eased count from `from` to `to`, starting after `delay` ms once `play` is true. */
export function useCount(play: boolean, to: number, { from = 0, delay = 0, ms = 800 }: { from?: number; delay?: number; ms?: number }) {
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

/** Flips to true `ms` after `play` becomes true. Final state under reduced motion. */
export function useLater(play: boolean, ms: number) {
  const reduce = useReducedMotion()
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!play || reduce) return
    const id = window.setTimeout(() => setOn(true), ms)
    return () => window.clearTimeout(id)
  }, [play, reduce, ms])
  return reduce ? true : on
}

export function useSequence<T extends HTMLElement>(margin: `${number}px` = '-80px') {
  const ref = useRef<T>(null)
  const inView = useInView(ref, { once: true, margin })
  const reduce = useReducedMotion()
  return { ref, play: inView || !!reduce, reduce: !!reduce }
}

