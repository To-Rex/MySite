import type { DeviceTier } from '@/hooks/useDeviceTier'
import { prewarmCreatures } from './useCreature'
import { VALLEY_DETAIL, VALLEY_SPECIES } from './valleyCast'
import { prepareLand } from './valleyLand'
import { prepareFlora } from './valleyForest'

/**
 * Builds everything the valley needs before anyone asks for it.
 *
 * Imported dynamically by `Valley.tsx` a few seconds after load, so the gate
 * itself stays three-free and the work lands when the page is already idle.
 *
 * The click used to do all of this at once — fetch the chunk, mesh five
 * species, sample sixteen thousand heights, scatter a thousand plants, merge
 * the tree geometries — and the page stood still for most of a second before
 * the valley appeared. Now the chunk is fetched here, the cast is meshed here,
 * and the land and the forest are built here in slices between idle frames.
 * Resolves once all of it is in place, which is when the scene itself can be
 * mounted and parked; its shaders are the one thing left, and it compiles
 * those off the main thread on its own.
 */
export function warmValley(tier: DeviceTier): Promise<void> {
  const chunk = import('./ValleyScene').then(
    () => undefined,
    () => undefined,
  )
  const cast = prewarmCreatures(VALLEY_SPECIES, VALLEY_DETAIL)
  const ground = new Promise<void>((done) => {
    idle(() => {
      prepareLand()
      done()
    })
  }).then(() => prepareFlora(tier, idle))
  return Promise.all([chunk, cast, ground]).then(() => undefined)
}

/** A slice of work for when the page has nothing else to do. */
function idle(fn: () => void): void {
  if (typeof window === 'undefined') return
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => fn(), { timeout: 3000 })
  } else {
    window.setTimeout(fn, 300)
  }
}
