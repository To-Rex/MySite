import { Canvas, useFrame } from '@react-three/fiber'
import { PerformanceMonitor, Sparkles } from '@react-three/drei'
import type { MotionValue } from 'motion/react'
import { useMemo, useRef, useState } from 'react'
import { MathUtils, type Group, type SkinnedMesh } from 'three'
import { pointer } from '@/lib/pointer'
import type { Theme } from '@/theme/context'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { qualityFor } from '@/hooks/useDeviceTier'
import type { CreatureDetail } from './creatures'
import { DETAIL_BY_TIER, animateTurtleSwim, poseLeg, useBind, useCreature, type Rig } from './creatureRig'
import { Eyes, Teeth } from './creatureFittings'
import { Spectacle } from './Spectacle'
import { stage } from './stage'
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

/**
 * The hero's own clock, in seconds, shared by everything in this scene.
 *
 * Nothing here may read `state.clock.elapsedTime`, because this canvas is parked
 * with `frameloop="never"` the moment it scrolls off-screen and R3F treats that
 * clock as its own scratch space:
 *
 * - flipping the prop — leaving the hero *and* returning to it — resets
 *   `elapsedTime` to 0;
 * - while parked, any stray frame sets `elapsedTime` to the raw `requestAnimationFrame`
 *   timestamp, which is in *milliseconds*, so a number that should read ~40 arrives
 *   as ~40000.
 *
 * Every pose in this file comes off that number, so the sculpture used to rewind
 * and then bolt: the idle turntable is a target that grows with time, and a
 * millisecond timestamp sent it thousands of radians out before the reset yanked
 * it back, which is the fast multi-turn unwind on the way back to the top. The
 * turtles snapped around their orbits at the same moment for the same reason.
 *
 * This clock only ever moves forward, in clamped steps, so parking the canvas
 * pauses the sculpture instead of rewinding it.
 */
const heroTime = { t: 0 }

/**
 * Advances the hero clock, once per frame, before anything reads it.
 *
 * The negative priority is what puts it first: R3F sorts frame callbacks by
 * priority and only counts positive ones when deciding whether the app has taken
 * over rendering, so this stays ahead of the scene without disabling auto-render.
 */
function HeroClock() {
  useFrame((_, dt) => {
    // The cap is deliberately loose. It only has to reject the nonsense a parked
    // canvas hands over — a frame that claims to have taken forty seconds — and a
    // tight cap would be worse than the bug it guards: clamping to 1/30 makes a
    // device drawing 9 fps run the whole sculpture at a third speed.
    heroTime.t += Math.min(dt, 0.25)
  }, -1)
  return null
}

/**
 * How much each tail joint lifts when the creature squats, base first.
 *
 * Bones sit unrotated in bind pose, so a tail joint's local +x still points
 * *forward*; rotating it about +z therefore drives the tail tip down, and
 * lifting the tail clear is the negative direction.
 */
const TAIL_LIFT = [0.44, 0.32, 0.2, 0.12, 0.07] as const

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

/**
 * Speeds are deliberately all different — sharing one made two turtles hold the
 * same relative angle forever, so they overlapped in projection permanently
 * rather than drifting past each other.
 */
const TURTLES: readonly TurtleOrbit[] = [
  { ring: 0, phase: 2.5, speed: 0.05, scale: 1.15, facing: -0.5 },
  { ring: 1, phase: 5.4, speed: 0.036, scale: 0.85, facing: 0.7 },
  { ring: 0, phase: 5.9, speed: -0.028, scale: 0.98, facing: 2.4 },
]

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

/** Seconds per full two-step stride. Slow enough to read as a walk, not a jog. */
const STRIDE = 1.7

/** Base yaw of the tyrannosaur, kept here because the walk also writes rotation. */
const DINO_YAW = -0.42

/** Deterministic 0..1 value per integer — picks which accent fires, and where. */
function noiseAt(index: number, seed: number): number {
  let h = (Math.imul(index, 374761393) + Math.imul(seed, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function DinosaurBody({ rig, theme, bump, reducedMotion }: Omit<CreatureProps, 'detail'> & { rig: Rig }) {
  const mesh = useRef<SkinnedMesh>(null)
  const body = useRef<Group>(null)
  // The stride is counted, not derived from the clock: a hunt shortens it, and
  // `t / STRIDE` with a changing STRIDE would jump the legs mid-step.
  const pace = useRef(0)
  const { geometry, root, skeleton, byName } = rig
  useBind(mesh, skeleton)

  const tail = useMemo(() => ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'].map((n) => byName.get(n)!), [byName])
  const legs = useMemo(
    () =>
      (['L', 'R'] as const).map((side) => ({
        thigh: byName.get(`thigh${side}`)!,
        shin: byName.get(`shin${side}`)!,
        foot: byName.get(`foot${side}`)!,
      })),
    [byName],
  )

  useFrame((_, dt) => {
    // Published every frame rather than once, so the easter egg always aims at
    // live bones even if this rig is rebuilt at a different quality tier.
    stage.head = byName.get('head')!
    stage.vent = byName.get('tail1')!
    stage.foot = byName.get('footL')!
    if (reducedMotion) return
    const t = heroTime.t
    const step = Math.min(dt, 0.25)

    // ---- Walk cycle ---------------------------------------------------------
    // Legs are half a stride apart; everything else in the body is driven from
    // the same clock so the bob, sway and tail counter-swing stay in step.
    // A hunt shortens the stride and lengthens the reach; at rest this is the
    // same amble it always was.
    const hurried = stage.hurry
    pace.current += step / (STRIDE / (1 + hurried * 1.8))
    const cycle = pace.current
    const beat = cycle * Math.PI * 2
    // Ease the gait in so the creature starts from its rest pose rather than
    // snapping into mid-stride when the geometry lands.
    const gait = Math.min(1, t / 1.6) * (1 + hurried * 0.5)
    legs.forEach((leg, i) => poseLeg(leg.thigh, leg.shin, leg.foot, cycle + i * 0.5, gait))

    // Hips rise twice per stride and roll toward whichever leg is carrying.
    const bob = Math.sin(beat * 2 - 0.6) * 0.058 * gait
    const sway = Math.sin(beat) * 0.055 * gait
    const roll = Math.sin(beat) * 0.045 * gait
    // The easter egg's attack, blended over the idle: the spectacle only says
    // how hard to crouch, lunge, snap and swallow, so the walk keeps ownership
    // of the pose and the hunt eases in and out of it.
    const { crouch, lunge, snap, toss, thrash, gulp, relieve } = stage
    const b = body.current
    if (b) {
      // Travel and heading come from the hunt. The lunge is a step *forward*, so
      // it has to follow wherever the creature is now pointing rather than +x.
      const yaw = DINO_YAW + stage.facing
      const reachX = Math.cos(yaw) * lunge * 0.28
      const reachZ = -Math.sin(yaw) * lunge * 0.28
      // The squat: hips down, with the slight tremble of an animal straining.
      const settle = bob - crouch * 0.06 - relieve * 0.12 + Math.sin(t * 19) * 0.006 * relieve
      b.position.set(stage.travelX + reachX, stage.travelY + settle, stage.travelZ + sway + reachZ)
      b.rotation.set(roll, yaw, Math.sin(beat * 2) * 0.012 * gait)
    }

    // ---- Occasional accents -------------------------------------------------
    // Every few seconds one accent fires — a longer look around, or a heavier
    // tail swish — so the idle never settles into an obvious loop.
    // Head and tail accents alternate rather than being picked at random: pure
    // noise left one of them unused for the first half-minute, which a visitor
    // would simply never see. Noise still sets direction, strength and the
    // occasional slot where both fire together.
    const ACCENT_EVERY = 5.5
    const accentClock = (t - 2) / ACCENT_EVERY
    const slot = Math.floor(accentClock)
    const local = accentClock - slot
    const envelope = slot < 0 || local >= 0.5 ? 0 : Math.sin((local / 0.5) * Math.PI)
    const both = noiseAt(slot, 3) < 0.22
    const strength = envelope * (0.75 + noiseAt(slot, 4) * 0.5)
    const direction = noiseAt(slot, 2) < 0.5 ? -1 : 1
    const headAccent = both || slot % 2 === 0 ? strength * direction : 0
    const tailAccent = both || slot % 2 !== 0 ? strength : 0

    // ---- Tail ---------------------------------------------------------------
    // Idle travelling wave, plus the counter-swing that balances each step, plus
    // the occasional swish. Later joints carry more of everything.
    const counter = Math.sin(beat + Math.PI) * 0.075 * gait
    tail.forEach((bone, i) => {
      const reach = 0.4 + i * 0.16
      bone.rotation.y =
        Math.sin(t * 1.05 - i * 0.72) * (0.045 + i * 0.022) +
        counter * reach +
        tailAccent * Math.sin(t * 2.1 - i * 0.6) * 0.14 * reach
      bone.rotation.z =
        Math.sin(t * 0.72 - i * 0.5) * (0.02 + i * 0.012) + tailAccent * 0.05 * reach - relieve * (TAIL_LIFT[i] ?? 0)
    })

    // ---- Ribcage breathing — a slow swell rather than a bounce --------------
    // Plus, mid-swallow, a lump travelling down the throat: the same trick, a
    // narrow bulge whose centre slides from the jaw to the chest.
    const breath = Math.sin(t * 0.85)
    const lump = (at: number) => (gulp > 0 ? Math.exp(-(((gulp - at) * 3.2) ** 2)) * 0.17 : 0)
    byName.get('spine1')!.scale.set(1, 1 + breath * 0.02, 1 + breath * 0.028)
    byName.get('spine2')!.scale.set(1, 1 + breath * 0.014 + lump(1), 1 + breath * 0.02 + lump(1))
    byName.get('neck1')!.scale.set(1, 1 + lump(0.55), 1 + lump(0.55))
    byName.get('neck2')!.scale.set(1, 1 + lump(0.1), 1 + lump(0.1))

    // ---- Head and neck ------------------------------------------------------
    // Slow horizon scan, a nod locked to the stride, and the accent turn.
    const scan = Math.sin(t * 0.21) + Math.sin(t * 0.37 + 1.7) * 0.4
    const nod = Math.sin(beat * 2 + 0.9) * 0.035 * gait
    // A bone pointing +x rotates +x toward +y about +z, so reaching *down* at
    // the prey is negative z and the head-toss that swallows it is positive.
    const reach = crouch * 0.18 + lunge * 0.42
    const neck1 = byName.get('neck1')!
    neck1.rotation.y = scan * 0.1 - counter * 0.5 + headAccent * 0.16
    neck1.rotation.z = Math.sin(t * 0.45) * 0.03 + nod - reach + toss * 0.3
    byName.get('neck2')!.rotation.y = scan * 0.14 - counter * 0.35 + headAccent * 0.22 + Math.sin(t * 38 + 0.6) * 0.24 * thrash
    byName.get('neck2')!.rotation.z = -lunge * 0.3 + toss * 0.18
    const head = byName.get('head')!
    // The kill: a fast, wide shake with the animal in its jaws.
    head.rotation.x = Math.sin(t * 31) * 0.42 * thrash
    head.rotation.y = scan * 0.2 + headAccent * 0.34 + Math.sin(t * 38) * 0.5 * thrash
    head.rotation.z =
      Math.sin(t * 0.55 + 0.6) * 0.05 -
      0.02 +
      nod * 1.4 -
      Math.abs(headAccent) * 0.12 -
      crouch * 0.1 -
      lunge * 0.2 -
      snap * 0.26 +
      toss * 0.5

    // ---- Arms ---------------------------------------------------------------
    // Small counter-swing with the stride, plus the odd twitch.
    const twitch = Math.sin(t * 1.7) * 0.5 + Math.sin(t * 0.9) * 0.5
    byName.get('armL')!.rotation.z = twitch * 0.06 - Math.sin(beat) * 0.07 * gait
    byName.get('armR')!.rotation.z = twitch * 0.06 + 0.02 + Math.sin(beat) * 0.07 * gait
  })

  return (
    <group ref={body} scale={3.4} rotation={[0, DINO_YAW, 0]}>
      <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
        <SkinMaterial theme={theme} species="dino" texScale={2.6} bump={bump} halfHeight={0.22} />
      </skinnedMesh>
      <primitive object={root} />
      <Eyes rig={rig} theme={theme} />
      <Teeth rig={rig} theme={theme} />
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

  useFrame(() => {
    const g = group.current
    if (!g) return
    const t = reducedMotion ? 0 : heroTime.t

    const angle = orbit.phase + t * orbit.speed * Math.PI * 2
    g.position.set(Math.cos(angle) * rx, Math.sin(angle) * ry, 0)
    // Stay upright — only a slow drift, never tumbling along the orbit.
    g.rotation.y = orbit.facing + Math.sin(t * 0.45 + orbit.phase) * 0.3
    g.rotation.z = Math.sin(t * 0.38 + orbit.phase) * 0.1
    g.rotation.x = Math.sin(t * 0.31 + orbit.phase) * 0.12

    if (reducedMotion) return

    animateTurtleSwim(byName, t, orbit.phase)
  })

  return (
    <group ref={group}>
      <group scale={orbit.scale}>
        <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
          <SkinMaterial theme={theme} species="turtle" texScale={1.7} bump={bump} halfHeight={0.17} plateMix={0.8} />
        </skinnedMesh>
        <primitive object={root} />
        <Eyes rig={rig} theme={theme} />
      </group>
    </group>
  )
}

/** An invisible orbit plane carrying the turtles assigned to it. */
function Orbit({ index, theme, detail, bump, reducedMotion }: CreatureProps & { index: 0 | 1 }) {
  const group = useRef<Group>(null)
  const yaw = ORBIT_YAW[index] ?? 0

  useFrame(() => {
    const g = group.current
    if (!g || reducedMotion) return
    const t = heroTime.t
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
  // The turntable drift is counted rather than read off the clock, so the easter
  // egg can pause it and hand it back without the sculpture swinging to catch up.
  const spin = useRef(0)
  const detail = DETAIL_BY_TIER[tier]
  // Triplanar bump costs three texture fetches plus derivatives per fragment;
  // weak devices get the plain surface instead. The magnitude is small because
  // the height map spans 0..1 over a few pixels, so its screen gradient is large.
  const bump = tier === 'high' ? 0.03 : tier === 'medium' ? 0.022 : 0

  useFrame((state, dt) => {
    const g = group.current
    if (!g) return
    const delta = Math.min(dt, 1 / 30)
    const t = heroTime.t
    const s = progress.get()

    entrance.current = MathUtils.damp(entrance.current, introDone ? 1 : 0, 2.4, delta)

    // While the episode runs the stage squares up to the camera and stops
    // listening to the pointer, then hands both back when it ends.
    const hold = stage.hold
    const mx = (pointer.inside && !pointer.isTouch ? pointer.nx : 0) * (1 - hold)
    const my = (pointer.inside && !pointer.isTouch ? pointer.ny : 0) * (1 - hold)

    if (!reducedMotion) spin.current += delta * 0.055 * (1 - hold)
    g.rotation.y = MathUtils.damp(g.rotation.y, MathUtils.lerp(mx * 0.45 + s * 1.2 + spin.current, 0, hold), 3, delta)
    g.rotation.x = MathUtils.damp(g.rotation.x, MathUtils.lerp(-my * 0.22 + s * 0.4, 0, hold), 3, delta)

    // Shrink to fit narrow viewports: a cropped fragment of a dinosaur reads as nothing.
    const fit = Math.min(1, (state.viewport.width * 0.92) / ARRANGEMENT_SPAN)
    const scale = entrance.current * fit * (1 - s * 0.28)
    g.scale.setScalar(Math.max(0.0001, scale))
    // On wide screens the canvas is the whole viewport but the sculpture keeps
    // to the right of centre, where it clears the headline: the same seven
    // percent the canvas's left edge used to be inset by, in world units.
    const aside = state.size.width >= 1024 ? state.viewport.width * 0.07 : 0
    g.position.x = BASE_OFFSET[0] * fit + aside
    g.position.y = BASE_OFFSET[1] * fit + s * 1.6 + (reducedMotion ? 0 : Math.sin(t * 0.6) * 0.05)

    // The jolt as the jaws close. Applied after the damping so it is a jolt and
    // not something the easing has to chase back.
    if (stage.shake > 0) {
      g.rotation.z += Math.sin(t * 92) * 0.022 * stage.shake
      g.rotation.x += Math.cos(t * 77) * 0.016 * stage.shake
    }

    state.camera.position.x = MathUtils.damp(state.camera.position.x, mx * 0.28, 2, delta)
    state.camera.position.y = MathUtils.damp(state.camera.position.y, my * 0.18, 2, delta)
    state.camera.lookAt(0, 0, 0)
  })

  return (
    <group ref={group} scale={0.0001}>
      <Dinosaur theme={theme} detail={detail} bump={bump} reducedMotion={reducedMotion} />
      {!reducedMotion && <Spectacle theme={theme} tier={tier} bump={bump} />}
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
      <HeroClock />
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
