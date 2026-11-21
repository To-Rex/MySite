import { describe, expect, it } from 'vitest'
import { BufferAttribute } from 'three'
import { GRASS_DENSITY, bladeCount, fanFor } from '@/components/three/valleyGrass'
import { LAKE, WATER_LEVEL, groundAt, groundNormalAt, heightAt } from '@/components/three/valleyLand'
import { geometryFor, spotsFor } from '@/components/three/valleyForest'
import { RANGE, buildRange, rangeHeight } from '@/components/three/valleyMountains'

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
