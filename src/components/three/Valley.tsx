import { Suspense, lazy, useEffect } from 'react'
import { useTheme } from '@/theme/context'
import { useDeviceTier, supportsWebGL } from '@/hooks/useDeviceTier'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useValley } from '@/lib/valley'

/**
 * Decides *whether* the extinction cinematic exists; the valley itself lives in
 * a lazily imported chunk. Like `Companion`, this file must stay free of
 * three.js imports — pulling them in here would drag the whole renderer into the
 * entry bundle for something most visitors never open.
 */
const ValleyScene = lazy(() => import('./ValleyScene'))

export function Valley() {
  const { act, run } = useValley()
  const { theme } = useTheme()
  const tier = useDeviceTier()
  const reduced = useReducedMotion()

  // The cast, meshed while the page is idle. Five species have to exist before
  // there is a valley to show, and built on demand that was a twenty-second hold
  // on an empty establishing shot the first time anyone clicked the name. It
  // starts well after the companion's own prebuild and leaves a gap between each
  // species, because there is one creature worker and the turtle someone is
  // about to scroll past matters more than a valley nobody has asked for. The
  // import is dynamic so this file stays clear of three.js.
  useEffect(() => {
    if (reduced || !supportsWebGL()) return
    const warm = window.setTimeout(() => {
      void import('./valleyWarm').then((m) => {
        m.warmValley()
      })
    }, 9000)
    return () => {
      window.clearTimeout(warm)
    }
  }, [reduced])

  if (reduced || act === 'idle' || !supportsWebGL()) return null

  // Faded up as it mounts and back down over the tail of the last act, with a CSS
  // animation rather than state: the page underneath should never be revealed
  // abruptly, and nothing here needs React to re-render to do it.
  const leaving = act === 'return'
  return (
    <div
      aria-hidden
      data-valley={act}
      className="pointer-events-none fixed inset-0 z-[40]"
      style={{ animation: leaving ? 'valley-out 1200ms ease-in 1400ms forwards' : 'valley-in 900ms ease-out both' }}
    >
      <Suspense fallback={null}>
        <ValleyScene key={run} theme={theme} tier={tier} />
      </Suspense>
    </div>
  )
}
