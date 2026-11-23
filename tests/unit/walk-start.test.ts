import { describe, expect, it, vi } from 'vitest'
import { WALK_DETAIL } from '@/components/three/evoDetail'

/**
 * The start of the long walk: its meshes are asked for long before it is
 * built, the cave and the people by its fire first, at the detail the walk
 * itself will ask for them at — or the walk's own requests would miss them
 * and mesh them all over again.
 */

const asked: [string, string, { patience?: number; priority?: number } | undefined][] = []
vi.mock('@/components/three/useCreature', () => ({
  PRIORITY: { now: 0, soon: 1, later: 2, someday: 3 },
  requestCreature: (kind: string, detail: string, options?: { patience?: number; priority?: number }) => {
    asked.push([kind, detail, options])
    return new Promise(() => {})
  },
}))

describe('the start of the walk', () => {
  it('asks for the cave and its people first, then the herd and the city’s people', async () => {
    const { prefetchWalk } = await import('@/components/three/evoPrefetch')
    for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
      asked.length = 0
      prefetchWalk(quality)
      const { people, beasts } = WALK_DETAIL[quality]
      expect(asked.map(([kind, detail]) => [kind, detail])).toEqual([
        ['crag', people],
        ['early', people],
        ['mammoth', beasts],
        ['modern', people],
      ])
      // The first two sooner than the rest, and all of them waited for however long they take.
      const [crag, early, mammoth, modern] = asked.map(([, , options]) => options!)
      expect(crag!.priority).toBe(early!.priority)
      expect(mammoth!.priority).toBeGreaterThan(early!.priority!)
      expect(modern!.priority).toBe(mammoth!.priority)
      for (const options of [crag, early, mammoth, modern]) expect(options!.patience).toBeGreaterThanOrEqual(30000)
    }
  })

  it('asks at the detail the walk itself meshes its people and animals at', async () => {
    const { WALK_QUALITY } = await import('@/components/three/evoWalk')
    for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
      expect(WALK_DETAIL[quality]).toEqual({ people: WALK_QUALITY[quality].people, beasts: WALK_QUALITY[quality].beasts })
    }
  })
})
