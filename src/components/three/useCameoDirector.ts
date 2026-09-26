import { useFrame } from '@react-three/fiber'
import { useCallback, useRef, useState } from 'react'
import { MathUtils } from 'three'
import { MASCOT_KINDS, type MascotKind } from './mascots'

/**
 * Decides when something crosses the page, and what.
 *
 * Its own module so `Cameo.tsx` exports nothing but components, which is what
 * keeps fast refresh working there.
 */

export type CameoKind = 'chase' | 'flock' | 'sky'

export interface CameoPlan {
  kind: CameoKind
  mascot: MascotKind
  /** +1 crosses left to right, −1 right to left. */
  way: 1 | -1
  /** Height of the crossing, in normalised screen units. */
  lane: number
  /** Distinct per run, so React remounts cleanly for a repeat. */
  id: number
}

/** Seconds before another cameo may start. Rare is the whole point. */
const COOLDOWN = 16

/** Longest any cameo may hold the stage before it is cleared out. */
const WATCHDOG = 14

/**
 * Decides when something crosses, and what.
 *
 * Tied to the reader passing a third of the page rather than to a timer, so a
 * cameo always arrives as part of getting somewhere and never while they sit
 * still reading one paragraph.
 */
export function useCameoDirector(enabled: boolean, allowChase: boolean): [CameoPlan | null, () => void] {
  const [plan, setPlan] = useState<CameoPlan | null>(null)
  const clock = useRef(0)
  const next = useRef(6)
  const startedAt = useRef(0)
  const firedAt = useRef(0)
  const third = useRef(-1)
  const turn = useRef(0)
  const lastScroll = useRef(0)

  useFrame((_, dt) => {
    clock.current += Math.min(dt, 0.25)
    const scroll = Number.isFinite(window.scrollY) ? window.scrollY : 0
    const down = scroll > lastScroll.current + 2
    lastScroll.current = scroll

    if (plan) {
      // A cameo is supposed to clear itself when it reaches the end of its run.
      // This is the watchdog for when it cannot: waiting on a mesh that never
      // arrives, or parked off-screen mid-crossing. Without it one stuck cameo
      // silently ends every cameo for the rest of the visit.
      if (clock.current - startedAt.current > WATCHDOG) setPlan(null)
      return
    }
    if (!enabled) return

    const span = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    const step = Math.floor(MathUtils.clamp(scroll / span, 0, 0.999) * 3)
    const crossed = third.current >= 0 && step !== third.current
    third.current = step
    // Either the reader has passed a third of the page, or they have simply
    // covered a lot of ground since the last one — the thirds alone go quiet on
    // a short page, where two of them can sit inside one flick of the wheel.
    const far = Math.abs(scroll - firedAt.current) > window.innerHeight * 2.4
    if (!(crossed || far) || !down || clock.current < next.current) return

    const n = turn.current++
    // Round-robin, so the same thing never crosses twice running. A chase is the
    // only one heavy enough to skip on a weak device.
    const wheel: CameoKind[] = allowChase ? ['chase', 'sky', 'flock'] : ['sky', 'flock']
    const kind = wheel[n % wheel.length]!
    setPlan({
      kind,
      mascot: MASCOT_KINDS[Math.floor(Math.random() * MASCOT_KINDS.length)] ?? 'gopher',
      way: n % 4 < 2 ? -1 : 1,
      // The flyers cross the sky above the reading; everything else runs along
      // the bottom of it.
      lane: kind === 'sky' ? 0.47 + (n % 3) * 0.07 : -0.34 - (n % 3) * 0.11,
      id: n,
    })
    startedAt.current = clock.current
    firedAt.current = scroll
    next.current = clock.current + COOLDOWN
  })

  const done = useCallback(() => setPlan(null), [])
  return [plan, done]
}
