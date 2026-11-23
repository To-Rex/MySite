import { motion, useInView } from 'motion/react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { EASE } from '@/lib/motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { wordsOf } from '@/i18n/morph'
import { useWriter } from '@/i18n/useWriter'

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

/** Where a word or a letter waits, under its mask, before it rises. */
const UNDER = { y: '115%', rotate: 1.5 }
const RISEN = { y: '0%', rotate: 0 }

/**
 * Masked text reveal rendered as a span (nest inside any heading or paragraph).
 * Each word (or character) rises out of its own overflow mask. Screen readers
 * get the full string once via aria-label; the animated copy is aria-hidden.
 *
 * It rises once. When the text changes afterwards — a change of language — the
 * words stay where they are and what they say is walked to the new text letter
 * by letter (`useWriter`): a word or a letter is the one in its place, whatever
 * it says, so nothing is made again to make its entrance again. What the new
 * text adds to a heading that has risen is simply there; added to one still on
 * its way up, it comes up with the rest. The label is the new text from the
 * first moment.
 *
 * While that is on its way the text is told where its lines break (`begins`:
 * for each word, whether it begins one) and breaks nowhere else.
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
  const { text: written, begins, rewritten } = useWriter(ref, text, visible)

  const words = useMemo(() => wordsOf(written), [written])
  const unitCount = mode === 'chars' ? words.reduce((sum, word) => sum + Array.from(word).length, 0) : words.length

  // Whether it is up: shown, and for long enough that the last of it has risen.
  const [risen, setRisen] = useState(false)
  const [wasVisible, setWasVisible] = useState(visible)
  if (wasVisible !== visible) {
    setWasVisible(visible)
    setRisen(false)
  }
  const rise = delay + Math.max(0, unitCount - 1) * stagger + duration
  useEffect(() => {
    if (!visible || risen) return
    const timer = window.setTimeout(() => setRisen(true), rise * 1000)
    return () => window.clearTimeout(timer)
  }, [visible, risen, rise])

  // What a change of text adds to a heading already up is simply there.
  const initial = reduced || (rewritten && visible && risen) ? false : UNDER
  let unitIndex = 0

  return (
    <span ref={ref} id={id} className={cn('inline', begins && 'whitespace-nowrap', className)} aria-label={text} data-morph="own">
      {words.map((word, wi) => {
        const units = mode === 'chars' ? Array.from(word) : [word]
        return (
          <Fragment key={wi}>
            {begins?.[wi] ? <br /> : null}
            <span className="inline-block whitespace-nowrap" aria-hidden>
              {units.map((unit, ui) => {
                const i = unitIndex++
                return (
                  <span
                    key={ui}
                    className="inline-block overflow-hidden align-bottom"
                    style={{ padding: '0.08em 0.04em 0.14em', margin: '-0.08em -0.04em -0.14em' }}
                  >
                    <motion.span
                      className="inline-block will-change-transform"
                      initial={initial}
                      animate={visible || reduced ? RISEN : UNDER}
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
