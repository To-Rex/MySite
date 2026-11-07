import { describe, expect, it } from 'vitest'
import type { CreaturePayload } from '@/components/three/creatures'
import { MASCOT_KINDS, createAnyCreature, isBeastKind, type AnyCreatureKind } from '@/components/three/mascots'
import { allFinite, bounds, edgeUse, volume } from './mesh'

/**
 * Every animal on the site, meshed the way the worker meshes it.
 *
 * These are the checks that used to be done by eye, after the fact: a creature
 * that never appeared (a NaN), one that rendered inside-out, a limb that tore
 * when the skeleton moved (weights that do not sum to one), eyes hung on a bone
 * that was renamed. Each is a property of the payload, so each can be asserted
 * before anything is drawn.
 */

const KINDS: AnyCreatureKind[] = ['dino', 'turtle', ...MASCOT_KINDS, 'pterosaur', 'sauropod', 'stegosaur']

/** Triangles per connected piece, largest first. */
function pieces({ positions, indices }: CreaturePayload): number[] {
  const parent = Int32Array.from({ length: positions.length / 3 }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]!)
    parent[find(indices[t + 1]!)] = a
    parent[find(indices[t + 2]!)] = a
  }
  const sizes = new Map<number, number>()
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]!)
    sizes.set(root, (sizes.get(root) ?? 0) + 1)
  }
  return [...sizes.values()].sort((a, b) => b - a)
}

describe.each(KINDS)('%s', (kind) => {
  const creature = createAnyCreature(kind, 'low')
  const vertices = creature.positions.length / 3
  const triangles = creature.indices.length / 3

  it('has buffers that agree with each other and contain no NaN', () => {
    // One NaN in a transform makes three draw nothing at all, with no error.
    expect(vertices).toBeGreaterThan(1000)
    expect(Number.isInteger(vertices) && Number.isInteger(triangles)).toBe(true)
    expect(creature.normals.length).toBe(vertices * 3)
    expect(creature.ao.length).toBe(vertices)
    expect(creature.skinIndices.length).toBe(vertices * 4)
    expect(creature.skinWeights.length).toBe(vertices * 4)
    for (const buffer of [creature.positions, creature.normals, creature.ao, creature.skinWeights]) {
      expect(allFinite(buffer)).toBe(true)
    }
    let highest = 0
    for (const index of creature.indices) highest = Math.max(highest, index)
    expect(highest).toBe(vertices - 1)
  })

  it('is watertight and faces outward', () => {
    // No edge may belong to a single triangle: that is a hole in the hide.
    let holes = 0
    for (const count of edgeUse(creature).values()) if (count === 1) holes++
    expect(holes).toBe(0)
    expect(volume(creature)).toBeGreaterThan(0)
  })

  it('is one body, not a body and loose parts', () => {
    // A sliver thinner than the sampling grid can come out as a few detached
    // triangles — a spike tip, or a carve too small to break the surface. That
    // is sub-pixel. A limb floating beside the animal is not, and would be
    // hundreds of triangles; so the body must hold all but a fraction of them.
    const [body = 0, ...rest] = pieces(creature)
    expect(body / triangles).toBeGreaterThan(0.99)
    expect(rest.length).toBeLessThanOrEqual(2)
  })

  it('is centred and normalised to one unit along its longest axis', () => {
    const { min, max } = bounds(creature.positions)
    const extent = max.map((value, axis) => value - min[axis]!)
    expect(Math.max(...extent)).toBeCloseTo(1, 3)
    for (let axis = 0; axis < 3; axis++) expect(min[axis]! + max[axis]!).toBeCloseTo(0, 3)
  })

  it('has unit normals and occlusion in range', () => {
    for (let i = 0; i < vertices; i++) {
      expect(Math.hypot(creature.normals[i * 3]!, creature.normals[i * 3 + 1]!, creature.normals[i * 3 + 2]!)).toBeCloseTo(1, 2)
    }
    for (const value of creature.ao) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('binds every vertex fully to bones that exist', () => {
    for (let i = 0; i < vertices; i++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        const weight = creature.skinWeights[i * 4 + k]!
        expect(weight).toBeGreaterThanOrEqual(0)
        expect(creature.skinIndices[i * 4 + k]!).toBeLessThan(creature.bones.length)
        sum += weight
      }
      // Anything else and the vertex is partly left behind when the bones move.
      expect(sum).toBeCloseTo(1, 4)
    }
  })

  it('has a skeleton that is a single tree', () => {
    const names = creature.bones.map((bone) => bone.name)
    expect(new Set(names).size).toBe(names.length)
    expect(creature.bones.filter((bone) => bone.parent === null)).toHaveLength(1)
    for (const bone of creature.bones) {
      expect(allFinite(bone.head)).toBe(true)
      if (bone.tip) expect(allFinite(bone.tip)).toBe(true)
      // Walk up to the root; a cycle or a missing parent never gets there.
      let current = bone
      for (let hops = 0; current.parent !== null; hops++) {
        expect(hops).toBeLessThan(names.length)
        const parent = creature.bones.find((candidate) => candidate.name === current.parent)
        expect(parent, `${current.name} → ${current.parent}`).toBeDefined()
        current = parent!
      }
    }
  })

  it('hangs its eyes and teeth on a real bone, at a real size', () => {
    expect(creature.bones.map((bone) => bone.name)).toContain(creature.eyeBone)
    for (const eye of creature.eyes) {
      expect(allFinite(eye.offset)).toBe(true)
      expect(eye.radius).toBeGreaterThan(0)
    }
    for (const tooth of creature.teeth) {
      expect(allFinite(tooth.offset)).toBe(true)
      expect(tooth.radius).toBeGreaterThan(0)
      expect(tooth.length).toBeGreaterThan(0)
    }
  })
})

describe('creature generation', () => {
  it('is deterministic, so the cache and every instance agree', () => {
    const a = createAnyCreature('turtle', 'low')
    const b = createAnyCreature('turtle', 'low')
    expect(Buffer.from(a.positions.buffer).equals(Buffer.from(b.positions.buffer))).toBe(true)
    expect(Buffer.from(a.skinWeights.buffer).equals(Buffer.from(b.skinWeights.buffer))).toBe(true)
  })

  it('spends more vertices at a higher detail level', () => {
    const low = createAnyCreature('turtle', 'low').positions.length
    const medium = createAnyCreature('turtle', 'medium').positions.length
    expect(medium).toBeGreaterThan(low * 1.3)
  })

  it('tells brand creatures from the authored beasts', () => {
    expect(isBeastKind('dino')).toBe(false)
    expect(isBeastKind('turtle')).toBe(false)
    for (const kind of MASCOT_KINDS) expect(isBeastKind(kind)).toBe(true)
    expect(isBeastKind('pterosaur')).toBe(true)
  })
})
