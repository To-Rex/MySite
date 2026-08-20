import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useEffectEvent, useState } from 'react'
import { useI18n } from '@/i18n/context'
import { prefersReducedMotion } from '@/hooks/useReducedMotion'
import { EASE } from '@/lib/motion'

const SESSION_KEY = 'dh.intro.seen'

interface PreloaderProps {
  /** Called as soon as the curtain starts lifting so the hero can begin underneath. */
  onRelease: () => void
}

function seenThisSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    /* ignore */
  }
}

/**
 * Cinematic entrance: counter + wordmark, then the curtain lifts. Full length on the
 * first visit of a session, brief on subsequent loads, skipped with reduced motion.
 */
export function Preloader({ onRelease }: PreloaderProps) {
  const { t } = useI18n()
  const [show, setShow] = useState(() => !prefersReducedMotion())
  const progress = useMotionValue(0)
  const display = useTransform(progress, (v) => String(Math.round(v)).padStart(3, '0'))
  const lineScale = useTransform(progress, [0, 100], [0, 1])
  const release = useEffectEvent(() => onRelease())

  useEffect(() => {
    if (prefersReducedMotion()) {
      release()
      return
    }
    const duration = seenThisSession() ? 0.7 : 1.6
    const controls = animate(progress, 100, { duration, ease: [0.65, 0, 0.35, 1] })
    const timer = window.setTimeout(() => {
      markSeen()
      release()
      setShow(false)
    }, duration * 1000 + 260)
    return () => {
      controls.stop()
      window.clearTimeout(timer)
    }
  }, [progress])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="preloader"
          className="fixed inset-0 z-[1000] flex flex-col justify-between bg-bg px-[var(--gutter)] py-8 text-fg"
          initial={{ clipPath: 'inset(0 0 0% 0)' }}
          exit={{ clipPath: 'inset(0 0 100% 0)', transition: { duration: 1, ease: EASE } }}
          aria-live="polite"
          aria-label={t.common.loading}
        >
          <div className="flex items-center justify-between">
            <motion.span
              className="eyebrow"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
            >
              {t.loader.greeting}
            </motion.span>
            <motion.span
              className="eyebrow"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
            >
              {t.loader.sub}
            </motion.span>
          </div>

          <div className="flex items-end justify-between gap-6">
            <motion.div
              className="display-tight text-[clamp(3rem,10vw,8rem)]"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: EASE, delay: 0.15 }}
            >
              <motion.span className="tabular-nums">{display}</motion.span>
              <span className="text-accent">%</span>
            </motion.div>
            <motion.div className="mb-4 h-px flex-1 origin-left bg-border-2" style={{ scaleX: lineScale }} aria-hidden />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
