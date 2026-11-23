import type { ValleyQuality } from '@/lib/valley'
import { WALK_DETAIL } from './evoDetail'
import { PRIORITY, requestCreature } from './useCreature'

/**
 * Asks for the long walk's meshes long before the walk is built: the rock
 * of the cave and the people by its fire first, then the herd and the people
 * of the city. They are a few seconds of arithmetic in the workers, and done
 * as soon as the page has finished its own, they are in by the time anybody
 * has scrolled to them — where, asked for when the walk was built, its first
 * people came into the cave seconds after it.
 *
 * Imported dynamically by `Evolution.tsx`, which stays three-free; nothing
 * here is drawn, and the walk's own requests for the same meshes find them
 * waiting in the cache.
 */
export function prefetchWalk(quality: ValleyQuality): void {
  const { people, beasts } = WALK_DETAIL[quality]
  // As long as a worker needs: these are built ahead of being seen.
  const patience = 30000
  void requestCreature('crag', people, { patience, priority: PRIORITY.soon })
  void requestCreature('early', people, { patience, priority: PRIORITY.soon })
  void requestCreature('mammoth', beasts, { patience, priority: PRIORITY.later })
  void requestCreature('modern', people, { patience, priority: PRIORITY.later })
}
