import { describe, expect, it } from 'vitest'
import { BufferAttribute } from 'three'
import { GRASS_DENSITY, bladeCount, fanFor } from '@/components/three/valleyGrass'
import {
  CRATER,
  LAKE,
  WATER_LEVEL,
  blastArrival,
  blastFront,
  buildCraterPatch,
  craterAt,
  craterProfile,
  fellAt,
  groundAt,
  groundNormalAt,
  heightAt,
  inCrater,
} from '@/components/three/valleyLand'
import { geometryFor, spotsFor } from '@/components/three/valleyForest'
import { RANGE, buildRange, rangeHeight } from '@/components/three/valleyMountains'
import { HERD, castDetail } from '@/components/three/valleyCast'
import { buildFireSmoke, buildFlames } from '@/components/three/valleyFire'
import { CRATER_GLSL, FIRE_GLSL } from '@/components/three/valleyMaterials'

/**
 * The world the extinction cinematic stands in: the meadow's layout, the
 * ranges beyond the valley, the lake's bank and the trees. Each of these was
 * once wrong in a way a screenshot showed and nothing else would have.
 */

/** Where the camera stands through the graze, and its field of view. */
const EYE = { x: 0, y: 9.5, z: 16 }
const FOV = 46

/** Elevation, in degrees, of a point seen from the camera. */
const elevation = (x: number, y: number, z: number) => (Math.atan2(y - EYE.y, Math.hypot(x - EYE.x, z - EYE.z)) * 180) / Math.PI

/** The highest the ground reaches, seen from the camera, along one bearing. */
function skyline(bearing: number): number {
  let best = -90
  for (let d = 5; d < 400; d += 1) {
    const x = EYE.x + Math.sin(bearing) * d
    const z = EYE.z - Math.cos(bearing) * d
    if (Math.abs(x) > 170 || z < -280 || z > 60) break
    best = Math.max(best, elevation(x, heightAt(x, z), z))
  }
  return best
}

/** The highest the ranges reach along the same bearing. */
function rangeTop(bearing: number): number {
  let best = -90
  for (let d = RANGE.inner; d <= RANGE.outer; d += 2) {
    const x = RANGE.x + Math.sin(bearing) * d
    const z = RANGE.z - Math.cos(bearing) * d
    best = Math.max(best, elevation(x, rangeHeight(x, z), z))
  }
  return best
}

const radians = (degrees: number) => (degrees * Math.PI) / 180

describe('the meadow', () => {
  it('opens as wide as the lens takes in, and a little more', () => {
    const across = Math.atan(Math.tan(radians(FOV / 2)) * (16 / 9))
    expect(fanFor(FOV, 16 / 9)).toBeGreaterThan(across)
    expect(fanFor(FOV, 16 / 9)).toBeLessThan(across + 0.2)
    // A phone held upright sees a narrow slice; an ultrawide sees nearly a right angle.
    expect(fanFor(FOV, 390 / 844)).toBeLessThan(0.45)
    expect(fanFor(FOV, 21 / 9)).toBeGreaterThan(fanFor(FOV, 16 / 9))
    expect(fanFor(FOV, 40)).toBeLessThanOrEqual(1.45)
  })

  it('draws more on the levels that can take it, and none on the software renderer', () => {
    expect(GRASS_DENSITY.low).toBeNull()
    expect(bladeCount('low', FOV, 16 / 9)).toBe(0)
    const medium = bladeCount('medium', FOV, 16 / 9)
    const high = bladeCount('high', FOV, 16 / 9)
    const ultra = bladeCount('ultra', FOV, 16 / 9)
    expect(medium).toBeGreaterThan(10_000)
    expect(high).toBeGreaterThan(medium)
    expect(ultra).toBeGreaterThan(high)
    // The tripwire: the bake made this count affordable; ask again before raising it.
    expect(ultra).toBeLessThan(200_000)
  })

  it('fills a narrow screen more densely, without drawing a wide one for it', () => {
    const phone = bladeCount('high', FOV, 390 / 844)
    const laptop = bladeCount('high', FOV, 16 / 9)
    // A third of the width; at the same blades per radian its meadow was thin.
    expect(phone).toBeLessThan(laptop)
    expect(phone).toBeGreaterThan(laptop * 0.6)
  })
})

describe('the ranges beyond the valley', () => {
  it('rise above the valley in the gap down its middle', () => {
    // Between the near ridge and the volcano, where the eye goes.
    for (const bearing of [-10, -5]) expect(rangeTop(radians(bearing)) - skyline(radians(bearing)), `${bearing}°`).toBeGreaterThan(2)
  })

  it('never stand taller than the volcano in front of them', () => {
    const volcano = Math.max(...[8, 12, 16, 20].map((b) => skyline(radians(b))))
    for (let b = -60; b <= 60; b += 4) expect(rangeTop(radians(b)), `${b}°`).toBeLessThan(volcano)
  })

  it('have their feet hidden behind the valley, so nothing floats', () => {
    for (let b = -60; b <= 60; b += 6) {
      const bearing = radians(b)
      const x = RANGE.x + Math.sin(bearing) * RANGE.inner
      const z = RANGE.z - Math.cos(bearing) * RANGE.inner
      expect(elevation(x, rangeHeight(x, z), z), `${b}°`).toBeLessThan(skyline(bearing))
    }
  })

  it('are inside the far plane and face the sky', () => {
    expect(RANGE.outer).toBeLessThan(600)
    const normals = buildRange().attributes.normal as BufferAttribute
    let up = 0
    for (let i = 0; i < normals.count; i++) up += normals.getY(i)
    // Wound the other way, the faces towards the camera were culled.
    expect(up / normals.count).toBeGreaterThan(0.5)
  })
})

describe('the lake', () => {
  it('has a bank, not a cliff, against the valley wall', () => {
    const normal = { y: 1, set(_x: number, y: number) { this.y = y } }
    let steepest = 0
    for (let x = LAKE.x - LAKE.r * 1.8; x <= LAKE.x + LAKE.r * 1.8; x += 2) {
      for (let z = LAKE.z - LAKE.r * 1.8; z <= LAKE.z + LAKE.r * 1.8; z += 2) {
        if (Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r * 1.8) continue
        groundNormalAt(x, z, normal)
        steepest = Math.max(steepest, 1 - normal.y)
      }
    }
    // It was 0.51 on the west shore — sixty degrees, fifteen metres high.
    expect(steepest).toBeLessThan(0.36)
  })

  it('can be seen from the camera over its near bank', () => {
    const target = { x: LAKE.x, y: WATER_LEVEL, z: LAKE.z + LAKE.r * 0.5 }
    for (let f = 0.05; f < 0.97; f += 0.01) {
      const x = EYE.x + (target.x - EYE.x) * f
      const z = EYE.z + (target.z - EYE.z) * f
      const y = EYE.y + (target.y - EYE.y) * f
      expect(groundAt(x, z), `at ${f.toFixed(2)} of the way`).toBeLessThan(y)
    }
  })

  it('keeps everything planted out of the water, while the floor below the waterline grows', () => {
    const ferns = spotsFor('high', 'fern')
    for (const spot of ferns) expect(Math.hypot(spot.x - LAKE.x, spot.z - LAKE.z)).toBeGreaterThan(LAKE.r * 1.12)
    // Most of the valley floor lies below the water line; when the scatter
    // judged the shore by height alone, nothing grew on it at all.
    expect(ferns.filter((spot) => spot.y < WATER_LEVEL).length).toBeGreaterThan(50)
  })
})

describe('the conifers', () => {
  it.each(['umbrella', 'tiered'] as const)('%s is a trunk and cards, shaded as one crown', (kind) => {
    const geometry = geometryFor(kind)
    for (const name of ['position', 'normal', 'uv', 'color']) expect(geometry.attributes[name], name).toBeDefined()
    const normal = geometry.attributes.normal as BufferAttribute
    let up = 0
    for (let i = 0; i < normal.count; i++) {
      expect(Number.isFinite(normal.getY(i))).toBe(true)
      up += normal.getY(i)
    }
    // Crown normals lean outwards and up; a heap of flat cards, half of them
    // facing down, averages to nothing. (The trunk's are level, and count too.)
    expect(up / normal.count).toBeGreaterThan(0.1)
    geometry.computeBoundingBox()
    const height = geometry.boundingBox!.max.y
    expect(height).toBeGreaterThan(kind === 'umbrella' ? 17 : 13)
    expect(height).toBeLessThan(kind === 'umbrella' ? 21 : 16)
  })
})

describe('the herd', () => {
  it('is the size the animals were', () => {
    const size = (kind: string) => Math.max(...HERD.filter((h) => h.kind === kind).map((h) => h.size))
    // Nose to tail, in metres: a tyrannosaur was twelve or thirteen, a
    // sauropod over twenty. At half that they read as toys under the trees.
    expect(size('dino')).toBeGreaterThan(11)
    expect(size('sauropod')).toBeGreaterThan(20)
    expect(size('stegosaur')).toBeGreaterThan(7.5)
  })

  it('stands clear of the crater, its ejecta and the lake', () => {
    for (const h of HERD) {
      const fromCrater = Math.hypot(h.x - CRATER.x, h.z - CRATER.z) - h.size / 2
      expect(fromCrater, h.kind).toBeGreaterThan(CRATER.r * 1.25)
      expect(Math.hypot(h.x - LAKE.x, h.z - LAKE.z), h.kind).toBeGreaterThan(LAKE.r * 1.12)
    }
  })

  it('is meshed finely enough for its size where the card can take it', () => {
    expect(castDetail('dino', 'ultra')).toBe('high')
    expect(castDetail('sauropod', 'high')).toBe('medium')
    for (const kind of ['dino', 'sauropod', 'stegosaur', 'turtle', 'pterosaur'] as const) {
      expect(castDetail(kind, 'low')).toBe('low')
      expect(castDetail(kind, 'medium')).toBe('low')
    }
  })
})

describe('the crater', () => {
  it('is a bowl with a raised rim and a blanket that thins to nothing', () => {
    expect(craterProfile(0)).toBeCloseTo(-CRATER.depth, 5)
    expect(craterProfile(1)).toBeCloseTo(CRATER.rim, 5)
    // No step at the crest, where the bowl meets the blanket.
    expect(Math.abs(craterProfile(0.999) - craterProfile(1.001))).toBeLessThan(0.05)
    for (let q = 1; q < CRATER.reach; q += 0.05) expect(craterProfile(q + 0.05)).toBeLessThanOrEqual(craterProfile(q) + 1e-9)
    expect(craterProfile(CRATER.reach)).toBeCloseTo(0, 5)
  })

  it('opens from a small bowl into the whole one', () => {
    expect(craterAt(CRATER.x, CRATER.z, 0)).toBe(0)
    expect(craterAt(CRATER.x, CRATER.z, 0.5)).toBeCloseTo(-CRATER.depth / 2, 5)
    expect(craterAt(CRATER.x, CRATER.z, 1)).toBeCloseTo(-CRATER.depth, 5)
    // Past the edge of the ejecta the ground is untouched.
    expect(craterAt(CRATER.x + CRATER.r * CRATER.reach + 1, CRATER.z)).toBe(0)
  })

  it('never runs into the lake', () => {
    // The water is a disc a little wider than the lake; the bowl must not reach it.
    expect(Math.hypot(CRATER.x - LAKE.x, CRATER.z - LAKE.z)).toBeGreaterThan(LAKE.r * 1.12 + CRATER.r)
  })

  it('is cut into ground of its own that starts on the ground exactly and faces up', () => {
    const patch = buildCraterPatch()
    const pos = patch.attributes.position as BufferAttribute
    for (let i = 0; i < pos.count; i += 97) expect(pos.getY(i)).toBeCloseTo(groundAt(pos.getX(i), pos.getZ(i)), 4)
    const normals = patch.attributes.normal as BufferAttribute
    let up = 0
    for (let i = 0; i < normals.count; i++) up += normals.getY(i)
    expect(up / normals.count).toBeGreaterThan(0.8)
  })

  it('has the same shape on the card as here', () => {
    // The shaders spell the crater out again; the numbers have to agree.
    expect(CRATER_GLSL).toContain(`VC_DEPTH = ${CRATER.depth}.0`)
    expect(CRATER_GLSL).toContain(`VC_REACH = ${CRATER.reach}`)
    expect(FIRE_GLSL).toContain('if (d <= 79.0) return 0.3 + (d - 4.0) / 50.0;')
  })
})

describe('the blast and the fire', () => {
  it('runs out from the crater and arrives where it says it will', () => {
    for (let t = 0.35; t < 3.9; t += 0.1) expect(blastArrival(blastFront(t)), `${t.toFixed(2)}s`).toBeCloseTo(t, 2)
    for (let t = 0.3; t < 6; t += 0.1) expect(blastFront(t + 0.1)).toBeGreaterThanOrEqual(blastFront(t))
    // It reaches the camera before it dies out.
    expect(blastArrival(Math.hypot(CRATER.x, CRATER.z - 16))).toBeLessThan(2)
  })

  it('puts trees down away from the crater, and none that stood in it', () => {
    for (const kind of ['umbrella', 'tiered', 'treeFern'] as const) {
      for (const spot of spotsFor('high', kind)) {
        const fell = fellAt(spot.x, spot.z)
        if (!fell) continue
        expect((spot.x - CRATER.x) * fell.dx + (spot.z - CRATER.z) * fell.dz).toBeGreaterThan(0)
      }
    }
    expect(inCrater(CRATER.x, CRATER.z)).toBe(true)
    expect(inCrater(CRATER.x + CRATER.r * 2, CRATER.z)).toBe(false)
  })

  it('burns more on the levels that can take it, and nothing where the crater is', () => {
    const count = (g: { attributes: Record<string, unknown> }) => (g.attributes.position as BufferAttribute).count
    const counts = (['low', 'medium', 'high', 'ultra'] as const).map((q) => count(buildFlames(q)))
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]!)
    const flames = buildFlames('ultra')
    const pos = flames.attributes.position as BufferAttribute
    const look = flames.attributes.aFlame as BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      expect(inCrater(pos.getX(i), pos.getZ(i))).toBe(false)
      expect(look.getX(i)).toBeGreaterThan(0)
      expect(Number.isFinite(pos.getY(i))).toBe(true)
    }
    expect(count(buildFireSmoke('low'))).toBe(0)
    expect(count(buildFireSmoke('ultra'))).toBeGreaterThan(400)
  })
})
