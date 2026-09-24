import { useEffect, useLayoutEffect, useMemo, type RefObject } from 'react'
import { Bone, Matrix4, Skeleton, type SkinnedMesh } from 'three'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import type { BoneSpec, CreatureDetail } from './creatures'
import type { AnyCreatureKind } from './mascots'
import { useCreatureGeometry } from './useCreature'

/**
 * Everything needed to put a generated creature on screen: its skeleton, the
 * fittings that cannot live in the SDF (eyes, teeth), and the idle swim.
 *
 * Shared because the hero scene and the scroll companion drive the same turtle —
 * one cached geometry, one skeleton per instance. Components live in
 * `creatureFittings.tsx` so this module stays free of JSX.
 */

/**
 * Mesh detail per device tier. Shared so the hero and the companion ask for the
 * same turtle: geometry is cached by (kind, detail), and two different details
 * would mean meshing the same animal twice.
 */
export const DETAIL_BY_TIER: Record<DeviceTier, CreatureDetail> = { high: 'high', medium: 'medium', low: 'low' }

/** Realises a bone spec tree as three.js Bones plus the Skeleton that drives them. */
export function buildSkeleton(specs: BoneSpec[]) {
  const byName = new Map<string, Bone>()
  const bones = specs.map((spec) => {
    const bone = new Bone()
    bone.name = spec.name
    byName.set(spec.name, bone)
    return bone
  })

  specs.forEach((spec, i) => {
    const bone = bones[i]!
    const [x, y, z] = spec.head
    const parentSpec = spec.parent ? specs.find((s) => s.name === spec.parent) : undefined
    if (parentSpec) {
      byName.get(parentSpec.name)!.add(bone)
      bone.position.set(x - parentSpec.head[0], y - parentSpec.head[1], z - parentSpec.head[2])
    } else {
      bone.position.set(x, y, z)
    }
  })

  const root = bones[0]!
  // Skeleton derives its bind inverses from world matrices, so they must be current.
  root.updateMatrixWorld(true)
  return { root, skeleton: new Skeleton(bones), byName }
}

/**
 * Resolves a creature's shared geometry (generated in a worker) and gives this
 * instance its own skeleton, so several creatures animate independently off one
 * cached mesh. Returns null until the geometry arrives.
 */
export function useCreature(kind: AnyCreatureKind, detail: CreatureDetail) {
  const resolved = useCreatureGeometry(kind, detail)
  const rigged = useMemo(() => (resolved ? buildSkeleton(resolved.bones) : null), [resolved])
  useEffect(() => () => rigged?.skeleton.dispose(), [rigged])
  return resolved && rigged
    ? { geometry: resolved.geometry, eyeBone: resolved.eyeBone, eyes: resolved.eyes, teeth: resolved.teeth, ...rigged }
    : null
}

export type Rig = NonNullable<ReturnType<typeof useCreature>>

/** Binds a skinned mesh in its own local space, where geometry and bones agree. */
export function useBind(mesh: RefObject<SkinnedMesh | null>, skeleton: Skeleton) {
  useLayoutEffect(() => {
    mesh.current?.bind(skeleton, new Matrix4())
  }, [mesh, skeleton])
}

/**
 * The sea-turtle swim: front flippers rowing together, rear ones steering a beat
 * behind, head reaching and looking around. Shared so the hero's orbiting
 * turtles and the scroll companion move the same way.
 */
export function animateTurtleSwim(byName: Map<string, Bone>, t: number, phase: number) {
  const stroke = Math.sin(t * 1.45 + phase)
  const glide = Math.sin(t * 1.45 + phase - 0.9)
  byName.get('flipperFL')!.rotation.x = stroke * 0.55
  byName.get('flipperFR')!.rotation.x = -stroke * 0.55
  byName.get('flipperFL')!.rotation.y = glide * 0.22
  byName.get('flipperFR')!.rotation.y = -glide * 0.22

  const rear = Math.sin(t * 1.45 + phase - 1.8)
  byName.get('flipperRL')!.rotation.x = rear * 0.28
  byName.get('flipperRR')!.rotation.x = -rear * 0.28

  byName.get('neck')!.rotation.z = Math.sin(t * 0.7 + phase) * 0.12 - 0.04
  const head = byName.get('head')!
  head.rotation.y = Math.sin(t * 0.33 + phase) * 0.3
  head.rotation.z = Math.sin(t * 0.6 + phase) * 0.08
  byName.get('tail')!.rotation.y = Math.sin(t * 1.1 + phase) * 0.18
}
