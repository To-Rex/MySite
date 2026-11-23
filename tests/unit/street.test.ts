import { describe, expect, it } from 'vitest'
import { towers } from '@/components/three/evoCity'
import { cameraAt, type Shot } from '@/components/three/evoScript'
import {
  ARIQ,
  BENCHES,
  BINS,
  BUS_STOP,
  CROSSWALK,
  FENCE,
  FRONT_FAR,
  LANTERNS,
  LAWNS,
  METRO,
  PASSER_LANES,
  PAVEMENT,
  PLAZA,
  ROAD,
  SHELTER,
  STREET_Z,
  TREE_INSET,
  TREE_PIT,
  FLAG,
  ariqSlabs,
  inTheAriq,
  lampsAlong,
  pavementAt,
  shopDoors,
  treesAlong,
} from '@/components/three/evoStreet'

/**
 * The street at the height of somebody walking on it: the ariq along each
 * kerb and the slabs over it, and what stands about — the bus shelter, the
 * metro's pylon, benches, bins, the fence down the middle of the road. What
 * is tested is that nobody, the walk least of all, has to step into water or
 * walk through any of it.
 */

const blocks = towers()
const slabs = ariqSlabs(blocks)
const steps = (from: number, to: number, n: number) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n)

/** Where the walk is, at eye height and on its feet: every step of the city's part of it. */
const walking: { p: number; x: number; z: number }[] = []
{
  const shot: Shot = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 45 }
  for (const p of steps(0.5, 1, 4000)) {
    cameraAt(p, shot)
    if (shot.y < 3) walking.push({ p, x: shot.x, z: shot.z })
  }
}

/** A lamp post stands this far out from its kerb (`evoCity.ts`), and is about this thick. */
const LAMP_OUT = 0.5
const LAMP_RADIUS = 0.1
/** A trunk at the foot, root flare and all, at the biggest a tree is drawn. */
const TRUNK_RADIUS = 0.62

const zAt = (side: 'far' | 'near', past: number) => (side === 'far' ? STREET_Z - ROAD - past : STREET_Z + ROAD + past)

describe('the ariq', () => {
  it('runs between the trees and the pavement people walk on', () => {
    // The trees, their earth and the lamp posts are on the road's side of it.
    expect(TREE_INSET + TREE_PIT).toBeLessThan(ARIQ.inner - ARIQ.lip)
    expect(LAMP_OUT + LAMP_RADIUS).toBeLessThan(ARIQ.inner - ARIQ.lip)
    // And there is a pavement beyond it worth the name.
    expect(PAVEMENT - (ARIQ.outer + ARIQ.lip)).toBeGreaterThan(2.2)
    expect(ARIQ.outer - ARIQ.inner).toBeGreaterThan(0.35)
    expect(ARIQ.water).toBeGreaterThan(0.15)
  })

  it('is only ever crossed by the walk on a slab', () => {
    let over = { far: 0, near: 0 }
    for (const step of walking) {
      expect(inTheAriq(step.x, step.z, slabs), `in the water at ${step.p.toFixed(4)} (${step.x.toFixed(2)}, ${step.z.toFixed(2)})`).toBe(false)
      const { side, past } = pavementAt(step.z)
      if (past > ARIQ.inner && past < ARIQ.outer) over = { ...over, [side]: over[side] + 1 }
    }
    // It does go over it, both sides, or there is nothing here to test.
    expect(over.near).toBeGreaterThan(5)
    expect(over.far).toBeGreaterThan(5)
  })

  it('is never walked in by the people on the pavement', () => {
    for (const lane of PASSER_LANES) {
      expect(lane).toBeGreaterThan(ARIQ.outer + ARIQ.lip + 0.25)
      expect(lane).toBeLessThan(PAVEMENT - 0.45)
    }
    const lanes = [...PASSER_LANES].sort((a, b) => a - b)
    for (let i = 1; i < lanes.length; i++) expect(lanes[i]! - lanes[i - 1]!).toBeGreaterThanOrEqual(0.44)
  })

  it('has its slabs where a way crosses it, and none on top of another', () => {
    const crossing = slabs.filter((s) => s.for === 'crossing')
    expect(crossing.map((s) => s.side).sort()).toEqual(['far', 'near'])
    for (const s of crossing) {
      expect(s.x0).toBeLessThanOrEqual(CROSSWALK.x - CROSSWALK.half)
      expect(s.x1).toBeGreaterThanOrEqual(CROSSWALK.x + CROSSWALK.half)
    }
    const stop = slabs.find((s) => s.for === 'stop')!
    expect(stop.side).toBe(BUS_STOP.side)
    expect(stop.x0).toBeLessThanOrEqual(SHELTER.x - SHELTER.half)
    expect(stop.x1).toBeGreaterThanOrEqual(SHELTER.x + SHELTER.half)
    // Now and then at a door: some, and each in front of one.
    const doors = slabs.filter((s) => s.for === 'door')
    expect(doors.length).toBeGreaterThan(5)
    for (const s of doors) {
      const middle = (s.x0 + s.x1) / 2
      expect(shopDoors(blocks, s.side).some((d) => Math.abs(d - middle) < 1e-6), `no door at ${middle}`).toBe(true)
      expect(treesAlong(s.side).every((t) => Math.abs(t - middle) >= 1.9)).toBe(true)
      expect(lampsAlong(s.side).every((l) => Math.abs(l - middle) >= 1.4)).toBe(true)
    }
    for (const a of slabs) {
      expect(a.x1).toBeGreaterThan(a.x0)
      for (const b of slabs) if (a !== b && a.side === b.side) expect(a.x1 < b.x0 || b.x1 < a.x0, `slabs at ${a.x0} and ${b.x0}`).toBe(true)
    }
  })
})

describe('what stands on the street', () => {
  /** Everything that stands, as circles on the ground: where, and how big. */
  const furniture = [
    ...BINS.map(([x, z]) => ({ name: `the bin at ${x}`, x, z, r: 0.24 })),
    ...BENCHES.map((b) => ({ name: `the bench at ${b.x}`, x: b.x, z: b.z, r: 0.95 })),
    { name: 'the metro', x: METRO.x, z: METRO.z, r: METRO.width * 0.72 },
  ]
  const trunks = (['far', 'near'] as const).flatMap((side) => treesAlong(side).map((x) => ({ x, z: zAt(side, TREE_INSET) })))
  const posts = (['far', 'near'] as const).flatMap((side) => lampsAlong(side).map((x) => ({ x, z: zAt(side, LAMP_OUT) })))

  it('keeps the shelter on its slabs, clear of the trees, the lamps, the crossing and the people', () => {
    expect(SHELTER.front).toBeGreaterThan(0.3)
    expect(SHELTER.back).toBeGreaterThan(ARIQ.outer + ARIQ.lip)
    expect(Math.min(...PASSER_LANES) - SHELTER.back).toBeGreaterThan(0.25)
    const x0 = SHELTER.x - SHELTER.half - 0.15
    const x1 = SHELTER.x + SHELTER.half + 0.15
    for (const x of treesAlong('far')) expect(x < x0 - TRUNK_RADIUS || x > x1 + TRUNK_RADIUS, `a tree in the shelter at ${x}`).toBe(true)
    for (const x of lampsAlong('far')) expect(x < x0 - 0.5 || x > x1 + 0.5, `a lamp in the shelter at ${x}`).toBe(true)
    expect(x1 < CROSSWALK.x - CROSSWALK.half - CROSSWALK.stop || x0 > CROSSWALK.x + CROSSWALK.half + CROSSWALK.stop).toBe(true)
  })

  it('keeps every bin, bench and the pylon clear of trunks, lamps, the crossing, the people and the walk', () => {
    for (const thing of furniture) {
      for (const t of trunks) expect(Math.hypot(thing.x - t.x, thing.z - t.z), `${thing.name} by a tree`).toBeGreaterThan(thing.r + TRUNK_RADIUS + 0.3)
      for (const l of posts) expect(Math.hypot(thing.x - l.x, thing.z - l.z), `${thing.name} by a lamp`).toBeGreaterThan(thing.r + LAMP_RADIUS + 0.3)
      // Not on the crossing, or in the way to it.
      if (Math.abs(thing.z - STREET_Z) < ROAD + PAVEMENT) expect(Math.abs(thing.x - CROSSWALK.x), `${thing.name} at the crossing`).toBeGreaterThan(CROSSWALK.half + thing.r + 0.4)
      // On the far pavement, not where the people walk: between the kerb and the ariq, or on the square.
      if (thing.z < STREET_Z && thing.z > FRONT_FAR) {
        const { past } = pavementAt(thing.z)
        expect(past + thing.r, `${thing.name} in the people's way`).toBeLessThan(ARIQ.inner - ARIQ.lip)
      }
      // Never in the water.
      const { past } = pavementAt(thing.z)
      if (Math.abs(thing.z - STREET_Z) < ROAD + PAVEMENT) expect(past + thing.r < ARIQ.inner - ARIQ.lip || past - thing.r > ARIQ.outer + ARIQ.lip).toBe(true)
      // Nor where the walk goes.
      for (const step of walking) expect(Math.hypot(thing.x - step.x, thing.z - step.z), `${thing.name} in the walk's way at ${step.p}`).toBeGreaterThan(thing.r + 0.6)
    }
  })

  it('puts the benches and the pylon on the square, clear of what is on it', () => {
    for (const thing of [...BENCHES.map((b) => ({ x: b.x, z: b.z, r: 0.95 })), { x: METRO.x, z: METRO.z, r: METRO.width }]) {
      expect(thing.x).toBeGreaterThan(PLAZA.x0 + 1)
      expect(thing.x).toBeLessThan(PLAZA.x1 - 1)
      expect(thing.z).toBeLessThan(PLAZA.front - 1)
      for (const [lx, lz] of LANTERNS) expect(Math.hypot(thing.x - lx, thing.z - lz)).toBeGreaterThan(thing.r + 0.6)
      expect(Math.hypot(thing.x - FLAG.x, thing.z - FLAG.z)).toBeGreaterThan(thing.r + 1)
      for (const lawn of LAWNS) expect(thing.x < lawn.x0 - thing.r || thing.x > lawn.x1 + thing.r || thing.z < lawn.z0 - thing.r || thing.z > lawn.z1 + thing.r).toBe(true)
    }
  })

  it('leaves a gap in the fence where the crossing is, and the walk goes through it', () => {
    expect(FENCE.gap[0]).toBeLessThan(CROSSWALK.x - CROSSWALK.half - CROSSWALK.stop)
    expect(FENCE.gap[1]).toBeGreaterThan(CROSSWALK.x + CROSSWALK.half + CROSSWALK.stop)
    let through = 0
    for (const step of walking) {
      if (Math.abs(step.z - STREET_Z) > 0.4) continue
      through++
      expect(step.x > FENCE.gap[0] + 0.5 && step.x < FENCE.gap[1] - 0.5, `over the fence at ${step.p}`).toBe(true)
    }
    expect(through).toBeGreaterThan(3)
  })
})
