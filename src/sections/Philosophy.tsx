import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useRef, useState } from 'react'
import { useI18n } from '@/i18n/context'
import { SECTION_IDS } from '@/config/sections'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'
import { Reveal } from '@/components/ui/Reveal'

interface WordProps {
  text: string
  index: number
  total: number
  progress: MotionValue<number>
  accent?: boolean
}

function Word({ text, index, total, progress, accent }: WordProps) {
  const span = 1 / total
  const start = index * span
  const first = index === 0
  const last = index === total - 1

  // Function transforms (not keyframe arrays): each word owns a [start, start+span]
  // window of the pinned scroll; it fades in over the first 30% and out over the
  // last 28% of its window. The first word starts visible, the last stays visible.
  const local = (v: number) => (v - start) / span
  const opacity = useTransform(progress, (v) => {
    const l = local(v)
    if (l <= 0) return first ? 1 : 0
    if (l >= 1) return last ? 1 : 0
    const fadeIn = first ? 1 : Math.min(1, l / 0.3)
    const fadeOut = last ? 1 : Math.min(1, (1 - l) / 0.28)
    return Math.min(fadeIn, fadeOut)
  })
  const y = useTransform(progress, (v) => {
    const l = Math.min(1, Math.max(0, local(v)))
    const from = first ? 0 : 70
    const to = last ? 0 : -70
    return from + (to - from) * l
  })
  const scale = useTransform(progress, (v) => {
    const l = Math.min(1, Math.max(0, local(v)))
    const from = first ? 1 : 0.96
    const to = last ? 1 : 1.03
    return from + (to - from) * l
  })

  return (
    <motion.p
      style={{ opacity, y, scale }}
      className={cn(
        'display-tight absolute inset-x-0 text-center text-[clamp(3.2rem,12.5vw,11.5rem)] text-balance',
        accent ? 'text-accent' : 'text-fg',
      )}
      aria-hidden
    >
      {text}
    </motion.p>
  )
}

/**
 * Cinematic typography: the page pins while the five verbs rise through the
 * viewport one by one, closing on "and again". Reduced motion gets a static list.
 */
export function Philosophy() {
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const ref = useRef<HTMLElement>(null)
  const words = t.philosophy.words
  const total = words.length + 1
  const [activeIndex, setActiveIndex] = useState(0)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const i = Math.min(total - 1, Math.floor(v * total))
    if (i !== activeIndex) setActiveIndex(i)
  })

  const srText = `${words.join(' ')} ${t.philosophy.closing}`

  if (reduced) {
    return (
      <section id={SECTION_IDS.philosophy} aria-labelledby="philosophy-title" className="section-y">
        <div className="container-x">
          <p className="eyebrow" id="philosophy-title">
            {t.philosophy.label}
          </p>
          <ul className="mt-10 flex flex-col gap-2">
            {words.map((w) => (
              <li key={w} className="display-tight text-[clamp(3rem,10vw,9rem)]">
                {w}
              </li>
            ))}
            <li className="display-tight text-[clamp(3rem,10vw,9rem)] text-accent">{t.philosophy.closing}</li>
          </ul>
          <p className="mt-8 max-w-[46ch] text-lg text-fg-2">{t.philosophy.note}</p>
        </div>
      </section>
    )
  }

  return (
    <section
      id={SECTION_IDS.philosophy}
      ref={ref}
      aria-labelledby="philosophy-title"
      className="relative"
      style={{ height: `${total * 72}vh` }}
    >
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden">
        <div className="container-x flex flex-1 flex-col">
          <div className="flex items-center justify-between pt-28">
            <Reveal className="flex items-center gap-3" y={10}>
              <span className="h-px w-8 bg-accent/80" aria-hidden />
              <h2 id="philosophy-title" className="eyebrow">
                {t.philosophy.label}
              </h2>
            </Reveal>
            <ol className="flex items-center gap-3 font-mono text-[0.68rem] tracking-[0.16em]" aria-hidden>
              {Array.from({ length: total }).map((_, i) => (
                <li
                  key={i}
                  className={cn(
                    'transition-colors duration-500',
                    i === activeIndex ? 'text-fg' : i < activeIndex ? 'text-fg-3' : 'text-fg-3/40',
                  )}
                >
                  0{i + 1}
                </li>
              ))}
            </ol>
          </div>

          <div className="relative flex flex-1 items-center">
            <span className="sr-only">{srText}</span>
            <div className="relative h-[1.2em] w-full text-[clamp(3.2rem,12.5vw,11.5rem)]">
              {words.map((w, i) => (
                <Word key={`${w}-${i}`} text={w} index={i} total={total} progress={scrollYProgress} />
              ))}
              <Word text={t.philosophy.closing} index={words.length} total={total} progress={scrollYProgress} accent />
            </div>
          </div>

          <div className="flex items-end justify-between gap-6 pb-10">
            <p className="max-w-[44ch] text-[0.95rem] leading-relaxed text-fg-2 md:text-base">{t.philosophy.note}</p>
            <motion.div className="hidden h-px flex-1 origin-left bg-border-2 md:block" style={{ scaleX: scrollYProgress }} aria-hidden />
          </div>
        </div>
      </div>
    </section>
  )
}
