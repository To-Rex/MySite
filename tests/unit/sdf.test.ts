import { describe, expect, it } from 'vitest'
import { meshSdf, type SdfPrimitive } from '@/components/three/sdf'
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
