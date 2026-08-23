import { Canvas, useFrame } from '@react-three/fiber'
import { PerformanceMonitor, Sparkles } from '@react-three/drei'
import type { MotionValue } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Bone, MathUtils, Matrix4, Skeleton, type Group, type SkinnedMesh } from 'three'
import { pointer } from '@/lib/pointer'
import type { Theme } from '@/theme/context'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { qualityFor } from '@/hooks/useDeviceTier'
import type { BoneSpec, CreatureDetail, CreatureKind } from './creatures'
import { useCreatureGeometry } from './useCreature'
import { SkinMaterial } from './skinMaterial'
import { ThemedEnvironment } from './ThemedEnvironment'

export interface HeroSceneProps {
  theme: Theme
  tier: DeviceTier
  /** 0 at the top of the page → 1 when the hero has scrolled away. */
  progress: MotionValue<number>
  /** Starts the entrance once the preloader is done. */
  introDone: boolean
  reducedMotion: boolean
  /** Pauses rendering when the hero is off-screen. */
  active: boolean
}

const DETAIL_BY_TIER: Record<DeviceTier, CreatureDetail> = { high: 'high', medium: 'medium', low: 'low' }

/** Nudges the arrangement up and right so the head clears the headline. */
const BASE_OFFSET: [number, number] = [0.2, 0.5]

/** World-space width the arrangement needs before it starts getting cropped. */
const ARRANGEMENT_SPAN = 3.7

/**
 * Orbit planes are yawed around Y only: that gives depth while leaving world
 * "up" untouched, so the turtles stay upright as they drift.
 */
const ORBIT_YAW = [0.55, -0.95]

/** Wide, flat ellipses [x, y] so turtles glide across frame instead of above it. */
const ORBIT_RADIUS: [number, number][] = [
  [3.05, 1.45],
  [3.6, 1.75],
]

interface TurtleOrbit {
  ring: 0 | 1
  /** Starting angle in radians. */
  phase: number
  /** Revolutions per second. */
  speed: number
  scale: number
  /** Base heading in radians. */
  facing: number
}

const TURTLES: readonly TurtleOrbit[] = [
  { ring: 0, phase: 2.5, speed: 0.05, scale: 0.82, facing: -0.5 },
  { ring: 0, phase: 5.6, speed: 0.05, scale: 0.58, facing: 0.7 },
  { ring: 1, phase: 3.4, speed: -0.036, scale: 0.7, facing: 2.4 },
]

/** Realises a bone spec tree as three.js Bones plus the Skeleton that drives them. */
function buildSkeleton(specs: BoneSpec[]) {
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
 * instance its own skeleton, so three turtles animate independently off one
 * cached mesh. Returns null until the geometry arrives.
 */
function useCreature(kind: CreatureKind, detail: CreatureDetail) {
  const resolved = useCreatureGeometry(kind, detail)
  const rigged = useMemo(() => (resolved ? buildSkeleton(resolved.bones) : null), [resolved])
  useEffect(() => () => rigged?.skeleton.dispose(), [rigged])
  return resolved && rigged ? { geometry: resolved.geometry, ...rigged } : null
}

/** Binds a skinned mesh in its own local space, where geometry and bones agree. */
function useBind(mesh: RefObject<SkinnedMesh | null>, skeleton: Skeleton) {
  useLayoutEffect(() => {
    mesh.current?.bind(skeleton, new Matrix4())
  }, [mesh, skeleton])
}

type Rig = NonNullable<ReturnType<typeof useCreature>>

interface CreatureProps {
  theme: Theme
  detail: CreatureDetail
  /** Skin bump strength; 0 disables the effect on weak devices. */
  bump: number
  reducedMotion: boolean
}

/**
 * The tyrannosaur centrepiece. Nothing here is a canned clip: the idle is built
 * from a travelling tail wave, a breathing ribcage and a slow head scan on
 * different periods, so it never visibly loops.
 */
function Dinosaur({ theme, detail, bump, reducedMotion }: CreatureProps) {
  const rig = useCreature('dino', detail)
  if (!rig) return null
  return <DinosaurBody rig={rig} theme={theme} bump={bump} reducedMotion={reducedMotion} />
}

function DinosaurBody({ rig, theme, bump, reducedMotion }: Omit<CreatureProps, 'detail'> & { rig: Rig }) {
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton, byName } = rig
  useBind(mesh, skeleton)

  const tail = useMemo(() => ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'].map((n) => byName.get(n)!), [byName])

  useFrame(({ clock }) => {
    if (reducedMotion) return
    const t = clock.elapsedTime

    // Tail: a wave travelling outward, each joint lagging the one before it.
    tail.forEach((bone, i) => {
      bone.rotation.y = Math.sin(t * 1.05 - i * 0.72) * (0.045 + i * 0.022)
      bone.rotation.z = Math.sin(t * 0.72 - i * 0.5) * (0.02 + i * 0.012)
    })

    // Ribcage breathing — a slow swell rather than a bounce.
    const breath = Math.sin(t * 0.85)
    byName.get('spine1')!.scale.set(1, 1 + breath * 0.02, 1 + breath * 0.028)
    byName.get('spine2')!.scale.set(1, 1 + breath * 0.014, 1 + breath * 0.02)

    // Head scanning the horizon, with counter-motion down the neck.
    const scan = Math.sin(t * 0.21) + Math.sin(t * 0.37 + 1.7) * 0.4
    const neck1 = byName.get('neck1')!
    neck1.rotation.y = scan * 0.1
    neck1.rotation.z = Math.sin(t * 0.45) * 0.03
    byName.get('neck2')!.rotation.y = scan * 0.14
    const head = byName.get('head')!
    head.rotation.y = scan * 0.2
    head.rotation.z = Math.sin(t * 0.55 + 0.6) * 0.05 - 0.02

    // Weight shifting between the legs, and the odd small-arm twitch.
    const shift = Math.sin(t * 0.38)
    byName.get('thighL')!.rotation.z = shift * 0.035
    byName.get('thighR')!.rotation.z = -shift * 0.035
    const twitch = Math.sin(t * 1.7) * 0.5 + Math.sin(t * 0.9) * 0.5
    byName.get('armL')!.rotation.z = twitch * 0.06
    byName.get('armR')!.rotation.z = twitch * 0.06 + 0.02
  })

  return (
    <group scale={3.4} rotation={[0, -0.42, 0]}>
      <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
        <SkinMaterial theme={theme} texScale={3.6} bump={bump} />
      </skinnedMesh>
      <primitive object={root} />
    </group>
  )
}

interface TurtleProps extends CreatureProps {
  orbit: TurtleOrbit
}

/** A turtle drifting along an orbit, front flippers rowing like a sea turtle. */
function Turtle({ orbit, theme, detail, bump, reducedMotion }: TurtleProps) {
  const rig = useCreature('turtle', detail)
  if (!rig) return null
  return <TurtleBody rig={rig} orbit={orbit} theme={theme} bump={bump} reducedMotion={reducedMotion} />
}

function TurtleBody({ rig, orbit, theme, bump, reducedMotion }: Omit<TurtleProps, 'detail'> & { rig: Rig }) {
  const group = useRef<Group>(null)
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton, byName } = rig
  useBind(mesh, skeleton)
  const [rx, ry] = ORBIT_RADIUS[orbit.ring] ?? [3, 1.5]

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const t = reducedMotion ? 0 : clock.elapsedTime

    const angle = orbit.phase + t * orbit.speed * Math.PI * 2
    g.position.set(Math.cos(angle) * rx, Math.sin(angle) * ry, 0)
    // Stay upright — only a slow drift, never tumbling along the orbit.
    g.rotation.y = orbit.facing + Math.sin(t * 0.45 + orbit.phase) * 0.3
    g.rotation.z = Math.sin(t * 0.38 + orbit.phase) * 0.1
    g.rotation.x = Math.sin(t * 0.31 + orbit.phase) * 0.12

    if (reducedMotion) return

    // Front flippers row together; the pair mirrors so they beat symmetrically.
    const stroke = Math.sin(t * 1.45 + orbit.phase)
    const glide = Math.sin(t * 1.45 + orbit.phase - 0.9)
    byName.get('flipperFL')!.rotation.x = stroke * 0.55
    byName.get('flipperFR')!.rotation.x = -stroke * 0.55
    byName.get('flipperFL')!.rotation.y = glide * 0.22
    byName.get('flipperFR')!.rotation.y = -glide * 0.22

    // Rear flippers steer, lagging behind the main stroke.
    const rear = Math.sin(t * 1.45 + orbit.phase - 1.8)
    byName.get('flipperRL')!.rotation.x = rear * 0.28
    byName.get('flipperRR')!.rotation.x = -rear * 0.28

    // Head reaching forward and looking around.
    byName.get('neck')!.rotation.z = Math.sin(t * 0.7 + orbit.phase) * 0.12 - 0.04
    const head = byName.get('head')!
    head.rotation.y = Math.sin(t * 0.33 + orbit.phase) * 0.3
    head.rotation.z = Math.sin(t * 0.6 + orbit.phase) * 0.08
    byName.get('tail')!.rotation.y = Math.sin(t * 1.1 + orbit.phase) * 0.18
  })

  return (
    <group ref={group}>
      <group scale={orbit.scale}>
        <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
          <SkinMaterial theme={theme} texScale={2.6} bump={bump} />
        </skinnedMesh>
        <primitive object={root} />
      </group>
    </group>
  )
}

/** An invisible orbit plane carrying the turtles assigned to it. */
function Orbit({ index, theme, detail, bump, reducedMotion }: CreatureProps & { index: 0 | 1 }) {
  const group = useRef<Group>(null)
  const yaw = ORBIT_YAW[index] ?? 0

  useFrame(({ clock }) => {
    const g = group.current
    if (!g || reducedMotion) return
    const t = clock.elapsedTime
    g.rotation.y = yaw + Math.cos(t * 0.15 + index) * 0.08
    g.rotation.x = Math.sin(t * 0.18 + index) * 0.03
  })

  return (
    <group ref={group} rotation={[0, yaw, 0]}>
      {TURTLES.filter((o) => o.ring === index).map((o, i) => (
        <Turtle key={i} orbit={o} theme={theme} detail={detail} bump={bump} reducedMotion={reducedMotion} />
      ))}
    </group>
  )
}

/** Holds the whole arrangement and maps pointer / scroll / intro onto it. */
function Arrangement({ theme, tier, progress, introDone, reducedMotion }: Omit<HeroSceneProps, 'active'>) {
  const group = useRef<Group>(null)
  const entrance = useRef(reducedMotion ? 1 : 0)
  const detail = DETAIL_BY_TIER[tier]
  // Triplanar bump costs three texture fetches plus derivatives per fragment;
  // weak devices get the plain surface instead. The magnitude is small because
  // the height map spans 0..1 over a few pixels, so its screen gradient is large.
  const bump = tier === 'high' ? 0.03 : tier === 'medium' ? 0.022 : 0

  useFrame((state, dt) => {
    const g = group.current
    if (!g) return
    const delta = Math.min(dt, 1 / 30)
    const t = state.clock.elapsedTime
    const s = progress.get()

    entrance.current = MathUtils.damp(entrance.current, introDone ? 1 : 0, 2.4, delta)

    const mx = pointer.inside && !pointer.isTouch ? pointer.nx : 0
    const my = pointer.inside && !pointer.isTouch ? pointer.ny : 0

    const idle = reducedMotion ? 0 : t * 0.055
    g.rotation.y = MathUtils.damp(g.rotation.y, mx * 0.45 + s * 1.2 + idle, 3, delta)
    g.rotation.x = MathUtils.damp(g.rotation.x, -my * 0.22 + s * 0.4, 3, delta)

    // Shrink to fit narrow viewports: a cropped fragment of a dinosaur reads as nothing.
    const fit = Math.min(1, (state.viewport.width * 0.92) / ARRANGEMENT_SPAN)
    const scale = entrance.current * fit * (1 - s * 0.28)
    g.scale.setScalar(Math.max(0.0001, scale))
    g.position.x = BASE_OFFSET[0] * fit
    g.position.y = BASE_OFFSET[1] * fit + s * 1.6 + (reducedMotion ? 0 : Math.sin(t * 0.6) * 0.05)

    state.camera.position.x = MathUtils.damp(state.camera.position.x, mx * 0.28, 2, delta)
    state.camera.position.y = MathUtils.damp(state.camera.position.y, my * 0.18, 2, delta)
    state.camera.lookAt(0, 0, 0)
  })

  return (
    <group ref={group} scale={0.0001}>
      <Dinosaur theme={theme} detail={detail} bump={bump} reducedMotion={reducedMotion} />
      <Orbit index={0} theme={theme} detail={detail} bump={bump} reducedMotion={reducedMotion} />
      <Orbit index={1} theme={theme} detail={detail} bump={bump} reducedMotion={reducedMotion} />
    </group>
  )
}

/**
 * The hero identity sculpture: a living tyrannosaur ("To-Rex") circled by turtles
 * from Dilshodjon's avatar, reacting to pointer, scroll and theme.
 */
export default function HeroScene(props: HeroSceneProps) {
  const { theme, tier, active, reducedMotion } = props
  const q = qualityFor(tier)
  const [dpr, setDpr] = useState<number | [number, number]>(q.dpr)

  return (
    <Canvas
      dpr={dpr}
      frameloop={active ? 'always' : 'never'}
      camera={{ position: [0, 0, 6.2], fov: 34, near: 0.1, far: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false }}
      style={{ background: 'transparent' }}
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} flipflops={2} />
      <ambientLight intensity={theme === 'dark' ? 0.15 : 0.5} />
      <directionalLight
        position={[4, 6, 4]}
        intensity={theme === 'dark' ? 0.6 : 0.9}
        color={theme === 'dark' ? '#ffffff' : '#fff8ee'}
      />
      <ThemedEnvironment theme={theme} resolution={q.env} />
      <Arrangement {...props} />
      {q.particles > 0 && !reducedMotion && (
        <Sparkles
          count={q.particles}
          scale={[11, 7, 5]}
          size={theme === 'dark' ? 1.6 : 1.3}
          speed={0.25}
          opacity={theme === 'dark' ? 0.45 : 0.35}
          color={theme === 'dark' ? '#f4f3f0' : '#3a3834'}
          noise={0.6}
        />
      )}
    </Canvas>
  )
}
