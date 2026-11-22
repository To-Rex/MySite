import { useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { countAt, countDuration } from '@/lib/count'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'

interface CountUpProps {
  /** The number it lands on. */
  value: number
  /** How a number on the way is written — and the last one, the same way. */
  format: (value: number) => string
  /** Where it starts. A year is counted back to from this one, not up from nought. */
  from?: number
  /** Seconds after it comes into view before it moves. */
  delay?: number
  /** Seconds it takes. Left out, it goes by how far the count has to go. */
  duration?: number
  className?: string
}

/**
 * A number that counts to its value the first time it is seen.
 *
 * Only what is drawn counts. The value itself is in the page from the start,
 * for a screen reader and for anything else that reads the document rather
 * than watches it; the figure on its way there is `aria-hidden`. It runs once:
 * a change of language rewrites the number where it stands, and a reader who
 * asked for less motion gets it standing from the first frame.
 */
export function CountUp({ value, format, from = 0, delay = 0, duration, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const [shown, setShown] = useState<number | null>(null)

  useEffect(() => {
    if (reduced || !inView) return
    const start = performance.now() + delay * 1000
    const length = (duration ?? countDuration(from, value)) * 1000
    let frame = requestAnimationFrame(function tick(now) {
      const t = length > 0 ? (now - start) / length : 1
      setShown(countAt(from, value, t))
      if (t < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [inView, reduced, value, from, delay, duration])

  const current = reduced ? value : (shown ?? from)
  const state = reduced || (shown !== null && current === value) ? 'done' : shown === null ? 'waiting' : 'counting'

  return (
    <span ref={ref} className={cn('count', className)} data-count={state}>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden>{format(current)}</span>
    </span>
  )
}
