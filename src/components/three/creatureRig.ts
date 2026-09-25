import { useEffect, useLayoutEffect, useMemo, type RefObject } from 'react'
import { Bone, Matrix4, Skeleton, type SkinnedMesh } from 'three'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import type { BoneSpec, CreatureDetail } from './creatures'
import type { AnyCreatureKind, MascotKind } from './mascots'
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

/** Skin tuning per mascot: pattern frequency, countershading, scales vs plates. */
export const MASCOT_SKIN: Record<MascotKind, { texScale: number; halfHeight: number; plateMix: number }> = {
  python: { texScale: 5.2, halfHeight: 0.14, plateMix: 0.15 },
  elephant: { texScale: 3.4, halfHeight: 0.3, plateMix: 0.85 },
  gopher: { texScale: 4.6, halfHeight: 0.34, plateMix: 0 },
  crab: { texScale: 3.8, halfHeight: 0.16, plateMix: 0.9 },
  swift: { texScale: 4.8, halfHeight: 0.12, plateMix: 0 },
  camel: { texScale: 3.6, halfHeight: 0.38, plateMix: 0.1 },
}

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

/**
 * Poses one leg for a phase of a stride.
 *
 * Bones sit unrotated in bind pose, so their local axes are the creature's:
 * +Z rotation swings a downward-pointing bone forward, −Z folds the knee back
 * the way a digitigrade leg actually folds.
 */
export function poseLeg(thigh: Bone, shin: Bone, foot: Bone, phase: number, gait: number) {
  const a = phase * Math.PI * 2
  // Hip reaches furthest forward a quarter into the cycle, furthest back at three quarters.
  const hip = Math.sin(a) * 0.44 * gait
  // The knee folds hardest just after toe-off, with a smaller dip absorbing weight at mid-stance.
  const swing = -0.85 * (0.5 + 0.5 * Math.cos(a - 0.5)) * gait
  const absorb = -0.16 * (0.5 - 0.5 * Math.cos(2 * a)) * gait
  const knee = swing + absorb
  // Ankle keeps the sole roughly level, then pushes off as the leg passes behind.
  const ankle = -(hip + knee) * 0.6 + 0.26 * Math.sin(a + 1.2) * gait
  thigh.rotation.z = hip
  shin.rotation.z = knee
  foot.rotation.z = ankle
}

/**
 * A tyrannosaur at a flat run: legs half a stride apart, tail streamed out
 * behind as a counterweight, head punched forward and low.
 *
 * Deliberately compact. The hero's tyrannosaur has a much richer idle of its
 * own — breathing, accents, a horizon scan — and owns its own animation; this is
 * for the cameos, where the creature is on screen for three seconds and all that
 * has to read is *running*.
 */
export function animateDinoRun(byName: Map<string, Bone>, cycle: number, gait: number): number {
  const beat = cycle * Math.PI * 2
  poseLeg(byName.get('thighL')!, byName.get('shinL')!, byName.get('footL')!, cycle, gait)
  poseLeg(byName.get('thighR')!, byName.get('shinR')!, byName.get('footR')!, cycle + 0.5, gait)

  byName.get('neck1')!.rotation.z = -0.12 * gait + Math.sin(beat * 2) * 0.05 * gait
  byName.get('neck2')!.rotation.z = -0.08 * gait
  const head = byName.get('head')!
  head.rotation.z = 0.16 * gait + Math.sin(beat * 2 + 0.6) * 0.07 * gait
  head.rotation.y = Math.sin(beat * 0.5) * 0.06

  for (let i = 1; i <= 5; i++) {
    const bone = byName.get(`tail${i}`)
    if (!bone) continue
    bone.rotation.y = Math.sin(beat - i * 0.5) * (0.05 + i * 0.022) * gait
    bone.rotation.z = -0.06 * gait * (i / 5) + Math.sin(beat * 2 - i * 0.4) * 0.02 * gait
  }

  byName.get('armL')!.rotation.z = -0.3 + Math.sin(beat) * 0.12 * gait
  byName.get('armR')!.rotation.z = -0.28 - Math.sin(beat) * 0.12 * gait

  // Hips rise twice a stride; the caller lifts the whole creature by this.
  return Math.sin(beat * 2 - 0.6) * 0.055 * gait
}

/**
 * Whatever the animal has, moved. Each mascot is rigged with only the bones its
 * anatomy needed, so this poses the ones that exist and ignores the rest — one
 * animator for six very different bodies. `fear` from 0 to 1 speeds everything
 * up and widens it.
 */
export function animateMascot(byName: Map<string, Bone>, t: number, fear: number): void {
  const pose = (name: string, x: number, y: number, z: number) => {
    const bone = byName.get(name)
    if (bone) bone.rotation.set(x, y, z)
  }
  const quick = 1 + fear * 3

  pose('head', 0, Math.sin(t * 2.1 * quick) * (0.2 + fear * 0.5), Math.sin(t * 1.4) * 0.1)
  pose('tail', 0, Math.sin(t * 2.6 * quick) * (0.18 + fear * 0.4), 0)
  pose('neck', 0, Math.sin(t * 1.7 * quick) * (0.12 + fear * 0.35), Math.sin(t * 1.1) * 0.08)
  // Snake: a wave travelling down the body.
  for (let i = 1; i <= 3; i++) {
    pose(`body${i}`, 0, Math.sin(t * 2.4 * quick - i * 0.8) * (0.1 + fear * 0.3), 0)
  }
  // Bird: wingbeats, which get frantic.
  const wing = Math.sin(t * 6 * quick)
  pose('wingL', wing * (0.25 + fear * 0.8), 0, 0)
  pose('wingR', -wing * (0.25 + fear * 0.8), 0, 0)
  // Crab: claws waving.
  pose('clawL', 0, Math.sin(t * 3.4 * quick) * (0.2 + fear * 0.6), 0)
  pose('clawR', 0, -Math.sin(t * 3.4 * quick + 0.7) * (0.2 + fear * 0.6), 0)
  // Elephant: the trunk curls and uncurls.
  pose('trunk1', 0, 0, Math.sin(t * 1.6) * 0.18 - fear * 0.3)
  pose('trunk2', 0, 0, Math.sin(t * 1.9 + 0.6) * 0.22 - fear * 0.35)
}
