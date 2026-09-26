import { Suspense, lazy, useEffect, useState } from 'react'
import { useTheme } from '@/theme/context'
import { useDeviceTier, supportsWebGL } from '@/hooks/useDeviceTier'
import { useReducedMotion } from '@/hooks/useReducedMotion'

/**
 * Decides *whether* the scroll companion exists; the turtle itself lives in a
 * lazily imported chunk. This file must stay free of three.js imports — pulling
 * them in here would drag the whole renderer into the entry bundle and undo the
 * site's lazy-3D loading.
 */
const load = () => import('./CompanionTurtle')
const CompanionTurtle = lazy(load)

/**
 * Where the canvas is built, and where the turtle is actually shown, as
 * fractions of a viewport.
 *
 * They are deliberately not the same number. Building the canvas, baking its
 * cubemap, rigging the mesh and compiling the skin shader all have to happen
 * before anything can be drawn, and doing that at the moment it is supposed to
 * appear is what made it show up late. It is built well before the line it fades
 * in at, and sits there with its frameloop parked until then.
 */
const WAKE = 0.22
const SHOW = 0.55

/**
 * And built anyway, this long after the page settles, even if nobody has
 * scrolled yet.
 *
 * Thresholds alone are not enough for a reader who flicks the wheel hard: they
 * cross both lines inside one frame, so the canvas still gets built at the exact
 * moment it is wanted, which is the slowest possible time to do it. An idle
 * canvas with its frameloop parked costs nothing per frame.
 */
const PREBUILD = 2500

export function Companion() {
  const { theme } = useTheme()
  const tier = useDeviceTier()
  const reduced = useReducedMotion()
  // Mounted once the hero has been left behind and kept mounted after that:
  // tearing a WebGL context down and rebuilding it on every scroll reversal
  // costs far more than leaving one idle canvas in place.
  const [awake, setAwake] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (reduced) return
    const onScroll = () => {
      const y = window.scrollY
      const h = window.innerHeight
      setVisible(y > h * SHOW)
      if (y > h * WAKE) setAwake(true)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [reduced])

  // Pull the chunk down, then build the canvas, while the reader is still at the
  // top and there is nothing else competing for the main thread.
  useEffect(() => {
    if (reduced) return
    const fetching = window.setTimeout(() => void load(), 1200)
    const building = window.setTimeout(() => setAwake(true), PREBUILD)
    return () => {
      window.clearTimeout(fetching)
      window.clearTimeout(building)
    }
  }, [reduced])

  // A creature that chases the reader is exactly the motion this preference asks
  // us to drop, so it never appears at all.
  if (reduced || !awake || !supportsWebGL()) return null

  return (
    <Suspense fallback={null}>
      <CompanionTurtle theme={theme} tier={tier} visible={visible} />
    </Suspense>
  )
}
