import type { ValleyQuality } from '@/lib/valley'
import type { CreatureDetail } from './creatures'
import { prewarmCreatures } from './useCreature'
import { VALLEY_SPECIES, castDetail } from './valleyCast'
import { prepareLand } from './valleyLand'
import { prepareFlora } from './valleyForest'
import { buildRange } from './valleyMountains'

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
 * and the land, the forest and the ranges beyond are built here in slices
 * between idle frames.
 * Resolves once all of it is in place, which is when the scene itself can be
 * mounted and parked; its shaders are the one thing left, and it compiles
 * those off the main thread on its own.
 */
export function warmValley(quality: ValleyQuality): Promise<void> {
  // The forest only knows three levels.
  const tier = quality === 'ultra' ? 'high' : quality
  const chunk = import('./ValleyScene').then(
    () => undefined,
    () => undefined,
  )
  // One species at a time, each at the detail it is shown at (see `castDetail`).
  const cast = VALLEY_SPECIES.reduce<Promise<void>>(
    (before, kind) => before.then(() => prewarmCreatures([kind], castDetail(kind, quality) satisfies CreatureDetail)),
    Promise.resolve(),
  )
  const ground = new Promise<void>((done) => {
    idle(() => {
      prepareLand()
      done()
    })
  })
    .then(() => prepareFlora(tier, idle))
    .then(
      () =>
        new Promise<void>((done) => {
          idle(() => {
            buildRange()
            done()
          })
        }),
    )
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
