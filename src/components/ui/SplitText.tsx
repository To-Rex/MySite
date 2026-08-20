import { motion, useInView } from 'motion/react'
import { Fragment, useMemo, useRef } from 'react'
import { cn } from '@/lib/cn'
import { EASE } from '@/lib/motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'

interface SplitTextProps {
  text: string
  className?: string
  /** Split granularity. `words` is the default; `chars` is for short display lines. */
  mode?: 'words' | 'chars'
  /** Seconds before the first unit starts. */
  delay?: number
  /** Seconds between units. */
  stagger?: number
  duration?: number
  /** `view`: animate when scrolled into view. `manual`: controlled by `show`. */
  trigger?: 'view' | 'manual'
  show?: boolean
  id?: string
}

/**
 * Masked text reveal rendered as a span (nest inside any heading or paragraph).
 * Each word (or character) rises out of its own overflow mask. Screen readers
 * get the full string once via aria-label; the animated copy is aria-hidden.
 */
export function SplitText({
  text,
  className,
  mode = 'words',
  delay = 0,
  stagger = 0.045,
  duration = 1,
  trigger = 'view',
  show = true,
  id,
}: SplitTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const reduced = useReducedMotion()
  const visible = trigger === 'view' ? inView : show

  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text])
  let unitIndex = 0

  return (
    <span ref={ref} id={id} className={cn('inline', className)} aria-label={text}>
      {words.map((word, wi) => {
        const units = mode === 'chars' ? Array.from(word) : [word]
        return (
          <Fragment key={`${word}-${wi}`}>
            <span className="inline-block whitespace-nowrap" aria-hidden>
              {units.map((unit, ui) => {
                const i = unitIndex++
                return (
                  <span
                    key={`${unit}-${ui}`}
                    className="inline-block overflow-hidden align-bottom"
                    style={{ padding: '0.08em 0.04em 0.14em', margin: '-0.08em -0.04em -0.14em' }}
                  >
                    <motion.span
                      className="inline-block will-change-transform"
                      initial={reduced ? false : { y: '115%', rotate: 1.5 }}
                      animate={visible || reduced ? { y: '0%', rotate: 0 } : { y: '115%', rotate: 1.5 }}
                      transition={{ duration, delay: delay + i * stagger, ease: EASE }}
                    >
                      {unit}
                    </motion.span>
                  </span>
                )
              })}
            </span>
            {wi < words.length - 1 ? ' ' : null}
          </Fragment>
        )
      })}
    </span>
  )
}
