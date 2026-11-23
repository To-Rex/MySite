import { describe, expect, it } from 'vitest'
import { meshSdf, nearestFields, type SdfPrimitive } from '@/components/three/sdf'
import { allFinite, components, edgeUse, openEdges, volume } from './mesh'

/**
 * The surface extractor, against shapes whose answers are known in advance.
 * A unit sphere has a radius, a volume and an Euler characteristic; if the
 * mesher gets those right, the creatures built from the same primitives are
 * wrong only where their anatomy is.
 */

const sphere = (at: [number, number, number], r: number, negative = false): SdfPrimitive => ({
  kind: 'ellipsoid',
  at,
  radii: [r, r, r],
  negative,
})

const OPTIONS = { spacing: 0.1, blend: 0.1 }
const UNIT_SPHERE = (4 / 3) * Math.PI

describe('meshSdf on a unit sphere', () => {
  const mesh = meshSdf([sphere([0, 0, 0], 1)], OPTIONS)
  const vertices = mesh.positions.length / 3

  it('returns consistent, finite buffers', () => {
    expect(vertices).toBeGreaterThan(500)
    expect(mesh.normals.length).toBe(mesh.positions.length)
    expect(mesh.ao.length).toBe(vertices)
    expect(mesh.indices.length % 3).toBe(0)
    expect(allFinite(mesh.positions) && allFinite(mesh.normals) && allFinite(mesh.ao)).toBe(true)
    expect(Math.max(...mesh.indices)).toBeLessThan(vertices)
  })

  it('is one closed surface with the topology of a sphere', () => {
    expect(openEdges(mesh)).toBe(0)
    expect(components(mesh)).toBe(1)
    // V − E + F = 2 for anything without holes or handles.
    expect(vertices - edgeUse(mesh).size + mesh.indices.length / 3).toBe(2)
  })

  it('puts every vertex on the surface, within a fraction of a cell', () => {
    for (let i = 0; i < vertices; i++) {
      const r = Math.hypot(mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!)
      expect(Math.abs(r - 1)).toBeLessThan(OPTIONS.spacing / 2)
    }
  })

  it('gives unit normals that point outward', () => {
    for (let i = 0; i < vertices; i++) {
      const [x, y, z] = [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!]
      const [nx, ny, nz] = [mesh.normals[i * 3]!, mesh.normals[i * 3 + 1]!, mesh.normals[i * 3 + 2]!]
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 3)
      expect((nx * x + ny * y + nz * z) / Math.hypot(x, y, z)).toBeGreaterThan(0.99)
    }
  })

  it('winds triangles outward and encloses the right volume', () => {
    // Signed volume is negative for an inside-out mesh, which three would then
    // light from the wrong side — so this is the winding check too.
    const enclosed = volume(mesh)
    expect(enclosed).toBeGreaterThan(UNIT_SPHERE * 0.97)
    expect(enclosed).toBeLessThan(UNIT_SPHERE * 1.03)
  })

  it('leaves a convex surface unoccluded', () => {
    for (const value of mesh.ao) {
      expect(value).toBeGreaterThan(0.9)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic', () => {
    const again = meshSdf([sphere([0, 0, 0], 1)], OPTIONS)
    expect(Buffer.from(again.positions.buffer).equals(Buffer.from(mesh.positions.buffer))).toBe(true)
    expect(Buffer.from(again.indices.buffer).equals(Buffer.from(mesh.indices.buffer))).toBe(true)
  })
})

describe('meshSdf combining shapes', () => {
  it('fuses overlapping shapes into one surface instead of two shells', () => {
    const one = volume(meshSdf([sphere([0, 0, 0], 1)], OPTIONS))
    const fused = meshSdf([sphere([-0.6, 0, 0], 1), sphere([0.6, 0, 0], 1)], OPTIONS)
    expect(components(fused)).toBe(1)
    expect(openEdges(fused)).toBe(0)
    // More than one sphere, less than two: the overlap is counted once.
    expect(volume(fused)).toBeGreaterThan(one * 1.3)
    expect(volume(fused)).toBeLessThan(one * 2)
  })

  it('carves a negative shape back out of the union', () => {
    const solid = volume(meshSdf([sphere([0, 0, 0], 1)], OPTIONS))
    const carved = meshSdf([sphere([0, 0, 0], 1), sphere([1, 0, 0], 0.5, true)], OPTIONS)
    expect(openEdges(carved)).toBe(0)
    expect(components(carved)).toBe(1)
    expect(volume(carved)).toBeLessThan(solid - 0.15)
    // The dent is where the carve was: nothing is left out at x ≈ 1 any more.
    let reach = -Infinity
    for (let i = 0; i < carved.positions.length; i += 3) {
      if (Math.abs(carved.positions[i + 1]!) < 0.1 && Math.abs(carved.positions[i + 2]!) < 0.1) reach = Math.max(reach, carved.positions[i]!)
    }
    expect(reach).toBeLessThan(0.75)
  })

  it('occludes the inside of a crease more than open surface', () => {
    const mesh = meshSdf([sphere([-0.9, 0, 0], 1), sphere([0.9, 0, 0], 1)], { spacing: 0.1, blend: 0.05 })
    let crease = 1
    let open = 0
    for (let i = 0; i < mesh.ao.length; i++) {
      const x = mesh.positions[i * 3]!
      if (Math.abs(x) < 0.1) crease = Math.min(crease, mesh.ao[i]!)
      if (Math.abs(x) > 1.7) open = Math.max(open, mesh.ao[i]!)
    }
    expect(crease).toBeLessThan(open - 0.1)
  })

  it('meshes a tapering capsule', () => {
    const mesh = meshSdf([{ kind: 'cone', a: [-1, 0, 0], b: [1, 0, 0], ra: 0.5, rb: 0.25 }], OPTIONS)
    expect(openEdges(mesh)).toBe(0)
    expect(components(mesh)).toBe(1)
    let thickEnd = 0
    let thinEnd = 0
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const radial = Math.hypot(mesh.positions[i + 1]!, mesh.positions[i + 2]!)
      if (Math.abs(mesh.positions[i]! + 1) < 0.1) thickEnd = Math.max(thickEnd, radial)
      if (Math.abs(mesh.positions[i]! - 1) < 0.1) thinEnd = Math.max(thinEnd, radial)
    }
    expect(thickEnd).toBeCloseTo(0.5, 1)
    expect(thinEnd).toBeCloseTo(0.25, 1)
  })
})

describe('meshSdf, exactly', () => {
  const COARSE = { spacing: 0.2, blend: 0.1 }
  const grid = meshSdf([sphere([0, 0, 0], 1)], COARSE)
  const exact = meshSdf([sphere([0, 0, 0], 1)], { ...COARSE, exact: true })
  const off = (mesh: typeof grid): number => {
    let worst = 0
    for (let i = 0; i < mesh.positions.length; i += 3) {
      worst = Math.max(worst, Math.abs(Math.hypot(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!) - 1))
    }
    return worst
  }

  it('is the same mesh as the grid makes, with every vertex moved onto the surface', () => {
    expect(exact.positions.length).toBe(grid.positions.length)
    expect(exact.indices.length).toBe(grid.indices.length)
    expect(components(exact)).toBe(1)
    expect(openEdges(exact)).toBe(0)
    // Surface nets leaves a vertex where the crossings of its cell average
    // out, which on a sphere is inside it. The field's own surface is not.
    expect(off(grid)).toBeGreaterThan(0.004)
    expect(off(exact)).toBeLessThan(0.0005)
    expect(volume(exact)).toBeGreaterThan(volume(grid))
  })

  it('takes its normals from the field and not from two cells of it', () => {
    for (let i = 0; i < exact.positions.length; i += 3) {
      const r = Math.hypot(exact.positions[i]!, exact.positions[i + 1]!, exact.positions[i + 2]!)
      const dot = (exact.positions[i]! * exact.normals[i]! + exact.positions[i + 1]! * exact.normals[i + 1]! + exact.positions[i + 2]! * exact.normals[i + 2]!) / r
      expect(dot).toBeGreaterThan(0.99999)
    }
    expect(allFinite(exact.ao)).toBe(true)
  })

  it('samples only near the surface and still finds all of it', () => {
    // A shell: a sphere with a smaller one carved out of its middle. Both
    // surfaces are there, though most of the grid between them was never asked.
    const shell = meshSdf([sphere([0, 0, 0], 1), sphere([0, 0, 0], 0.5, true)], { spacing: 0.08, blend: 0.05, exact: true })
    expect(components(shell)).toBe(2)
    expect(openEdges(shell)).toBe(0)
  })

  it('halves the triangles where it is asked to, without a crack', () => {
    const refined = meshSdf([sphere([0, 0, 0], 1)], { ...COARSE, exact: true, refine: (x) => (x > 0.3 ? 2 : 0) })
    expect(refined.positions.length).toBeGreaterThan(exact.positions.length * 3)
    expect(components(refined)).toBe(1)
    expect(openEdges(refined)).toBe(0)
    expect(off(refined)).toBeLessThan(0.0005)
    expect(allFinite(refined.normals)).toBe(true)
    expect(allFinite(refined.ao)).toBe(true)
    for (const value of refined.ao) expect(value).toBeGreaterThan(0.9)
    // Finer on the side that was asked for, and as it was on the other.
    const edge = (mesh: typeof grid, keep: (x: number) => boolean): number => {
      let total = 0
      let count = 0
      for (let t = 0; t < mesh.indices.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = mesh.indices[t + e]! * 3
          const b = mesh.indices[t + ((e + 1) % 3)]! * 3
          if (!keep(mesh.positions[a]!) || !keep(mesh.positions[b]!)) continue
          total += Math.hypot(mesh.positions[a]! - mesh.positions[b]!, mesh.positions[a + 1]! - mesh.positions[b + 1]!, mesh.positions[a + 2]! - mesh.positions[b + 2]!)
          count++
        }
      }
      return total / count
    }
    expect(edge(refined, (x) => x > 0.5)).toBeLessThan(edge(exact, (x) => x > 0.5) * 0.3)
    expect(edge(refined, (x) => x < -0.2)).toBeCloseTo(edge(exact, (x) => x < -0.2), 3)
    // And still a sphere's worth of it.
    expect(volume(refined)).toBeGreaterThan(UNIT_SPHERE * 0.985)
    expect(volume(refined)).toBeLessThan(UNIT_SPHERE)
  })

  it('leaves the grid mesh as it has always been when neither is asked for', () => {
    const again = meshSdf([sphere([0, 0, 0], 1)], COARSE)
    expect(Array.from(again.positions)).toEqual(Array.from(grid.positions))
    expect(Array.from(again.normals)).toEqual(Array.from(grid.normals))
  })
})

describe('a shape with a fillet of its own', () => {
  // Two spheres that meet in a crease. How far the crease is filled in is the fillet.
  const waist = (blend: number | undefined): number => {
    const mesh = meshSdf([sphere([-0.6, 0, 0], 1), { ...sphere([0.6, 0, 0], 1), blend }], { spacing: 0.08, blend: 0.5, exact: true })
    let least = Infinity
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (Math.abs(mesh.positions[i]!) < 0.05) least = Math.min(least, Math.hypot(mesh.positions[i + 1]!, mesh.positions[i + 2]!))
    }
    return least
  }
  const sharp = waist(0.02)
  const soft = waist(undefined)

  it('is joined on with that fillet and not the mesh\'s', () => {
    // Where the spheres themselves cross: 0.8 from the axis.
    const crease = Math.sqrt(1 - 0.6 * 0.6)
    expect(sharp).toBeGreaterThan(crease - 0.005)
    expect(sharp).toBeLessThan(crease + 0.04)
    expect(soft).toBeGreaterThan(sharp + 0.08)
  })
})

describe('nearestFields', () => {
  const near = nearestFields([[sphere([0, 0, 0], 1)], [sphere([3, 0, 0], 0.5)], [sphere([0, 5, 0], 1, true)]], 0.6)
  const out = new Float64Array(3)

  it('gives the distance to the nearest shape of each set that is within reach', () => {
    near(1.2, 0, 0, out)
    expect(out[0]).toBeCloseTo(0.2, 6)
    expect(out[1]).toBe(Infinity)
    near(2.2, 0, 0, out)
    expect(out[0]).toBe(Infinity)
    expect(out[1]).toBeCloseTo(0.3, 6)
    // Inside a shape it is negative.
    near(0.5, 0, 0, out)
    expect(out[0]).toBeCloseTo(-0.5, 6)
  })

  it('has nothing to say about what is carved, or about anywhere far from everything', () => {
    near(0, 5, 0, out)
    expect(Array.from(out)).toEqual([Infinity, Infinity, Infinity])
    near(40, 40, 40, out)
    expect(Array.from(out)).toEqual([Infinity, Infinity, Infinity])
  })
})
