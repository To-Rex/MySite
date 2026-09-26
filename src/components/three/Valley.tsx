import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useTheme } from '@/theme/context'
import { useDeviceTier, supportsWebGL } from '@/hooks/useDeviceTier'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useValley } from '@/lib/valley'

/**
 * Decides *whether* the extinction cinematic exists; the valley itself lives in
 * a lazily imported chunk. Like `Companion`, this file must stay free of
 * three.js imports — pulling them in here would drag the whole renderer into the
 * entry bundle for something most visitors never open.
 *
 * The scene is built ahead of the click. Nine seconds after load the warm-up
 * meshes the cast and builds the land and the forest in idle slices; when it
 * is done the scene is mounted here, invisible and with its frameloop parked,
 * and compiles its shaders off the main thread. The click then has nothing
 * left to do but start the loop. A parked canvas costs nothing per frame; what
 * it costs is the memory, which is why after a showing it is torn down and
 * only built again a while later.
 */
const ValleyScene = lazy(() => import('./ValleyScene'))

const WARM_AT = 9000
const REBUILD_AT = 12000

export function Valley() {
  const { act, run } = useValley()
  const { theme } = useTheme()
  const tier = useDeviceTier()
  const reduced = useReducedMotion()
  const usable = !reduced && supportsWebGL()

  /** The showing number the parked scene is built for, once there is one. */
  const [builtFor, setBuiltFor] = useState(0)
  const warmed = useRef(false)
  const runNow = useRef(run)
  useEffect(() => {
    runNow.current = run
  }, [run])

  useEffect(() => {
    if (!usable || warmed.current) return
    const warm = window.setTimeout(() => {
      warmed.current = true
      void import('./valleyWarm')
        .then((m) => m.warmValley(tier))
        .then(() => setBuiltFor(runNow.current + 1))
    }, WARM_AT)
    return () => {
      window.clearTimeout(warm)
    }
  }, [usable, tier])

  // A showing has just ended: build a fresh scene for the next one, later,
  // rather than on the heels of the last with the hero back in view.
  useEffect(() => {
    if (!usable || act !== 'idle' || run === 0) return
    const again = window.setTimeout(() => setBuiltFor(run + 1), REBUILD_AT)
    return () => {
      window.clearTimeout(again)
    }
  }, [usable, act, run])

  if (!usable) return null

  const showing = act !== 'idle'
  const parked = !showing && builtFor === run + 1
  if (!showing && !parked) return null

  // Invisible while parked and while the scene compiles, faded up on its first
  // frame and back down over the tail of the last act — with a CSS animation
  // rather than state: the page underneath should never be revealed abruptly,
  // and nothing here needs React to re-render to do it.
  const hidden = act === 'idle' || act === 'load'
  const leaving = act === 'return'
  return (
    <div
      aria-hidden
      data-valley={act}
      className="pointer-events-none fixed inset-0 z-[40]"
      style={{
        opacity: hidden ? 0 : undefined,
        animation: hidden
          ? 'none'
          : leaving
            ? 'valley-out 1200ms ease-in 1400ms forwards'
            : 'valley-in 900ms ease-out both',
      }}
    >
      <Suspense fallback={null}>
        <ValleyScene key={showing ? run : builtFor} theme={theme} tier={tier} />
      </Suspense>
    </div>
  )
}
