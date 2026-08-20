import { Canvas, useFrame } from '@react-three/fiber'
import { PerformanceMonitor, Sparkles } from '@react-three/drei'
import type { MotionValue } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MathUtils, type BufferGeometry, type Group, type Mesh } from 'three'
import { pointer } from '@/lib/pointer'
import type { Theme } from '@/theme/context'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { qualityFor } from '@/hooks/useDeviceTier'
import { createDinosaurGeometry, createTurtleGeometry, type CreatureDetail } from './creatures'
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
 * Surface treatment per theme. Dark reads as machined, dark-chrome metal;
 * light as a glazed ceramic figurine.
 */
const MATERIAL = {
  dark: {
    color: '#17171b',
    metalness: 0.9,
    roughness: 0.18,
    clearcoat: 0.9,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.9,
    sheen: 0,
  },
  light: {
    color: '#f2eee7',
    metalness: 0.06,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.24,
    envMapIntensity: 1.15,
    sheen: 0.45,
  },
} as const

const DETAIL_BY_TIER: Record<DeviceTier, CreatureDetail> = { high: 'high', medium: 'medium', low: 'low' }

/** Each turtle rides one of the orbit rings. */
interface TurtleOrbit {
  /** Index of the ring it travels along. */
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
  { ring: 0, phase: 2.5, speed: 0.05, scale: 0.66, facing: -0.5 },
  { ring: 0, phase: 5.6, speed: 0.05, scale: 0.46, facing: 0.7 },
  { ring: 1, phase: 3.4, speed: -0.036, scale: 0.56, facing: 2.4 },
]

/** Nudges the arrangement up and right so the head clears the headline. */
const BASE_OFFSET: [number, number] = [0.2, 0.5]

/** World-space width the arrangement needs before it starts getting cropped. */
const ARRANGEMENT_SPAN = 3.7

/** Orbit planes are yawed around Y only: that gives depth while leaving world
 * "up" untouched, so the turtles stay upright as they drift. */
const ORBIT_YAW = [0.55, -0.95]
/** Orbits are wide, flat ellipses [x, y] so the turtles glide across frame
 * instead of spending most of the loop above and below the viewport. */
const ORBIT_RADIUS: [number, number][] = [
  [3.05, 1.45],
  [3.6, 1.75],
]

function useCreatureGeometry(make: (detail: CreatureDetail) => BufferGeometry, detail: CreatureDetail) {
  const geometry = useMemo(() => make(detail), [make, detail])
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

function SharedMaterial({ theme }: { theme: Theme }) {
  const m = MATERIAL[theme]
  return (
    <meshPhysicalMaterial
      color={m.color}
      metalness={m.metalness}
      roughness={m.roughness}
      clearcoat={m.clearcoat}
      clearcoatRoughness={m.clearcoatRoughness}
      envMapIntensity={m.envMapIntensity}
      sheen={m.sheen}
      sheenColor="#ffffff"
    />
  )
}

/** The tyrannosaur centrepiece — a still sculpture with a slow breathing sway. */
function Dinosaur({ theme, detail, reducedMotion }: { theme: Theme; detail: CreatureDetail; reducedMotion: boolean }) {
  const mesh = useRef<Mesh>(null)
  const geometry = useCreatureGeometry(createDinosaurGeometry, detail)

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m || reducedMotion) return
    const t = clock.elapsedTime
    // Weight shifting from foot to foot, plus a slow head-height drift.
    m.position.y = Math.sin(t * 0.55) * 0.05
    m.rotation.z = Math.sin(t * 0.4) * 0.022
    m.rotation.x = Math.sin(t * 0.31 + 1.2) * 0.018
  })

  return (
    <mesh ref={mesh} geometry={geometry} scale={3.4} rotation={[0, -0.42, 0]}>
      <SharedMaterial theme={theme} />
    </mesh>
  )
}

/** A turtle drifting along one of the orbit rings, tilting as it "swims". */
function Turtle({
  orbit,
  theme,
  detail,
  reducedMotion,
}: {
  orbit: TurtleOrbit
  theme: Theme
  detail: CreatureDetail
  reducedMotion: boolean
}) {
  const group = useRef<Group>(null)
  const geometry = useCreatureGeometry(createTurtleGeometry, detail)
  const [rx, ry] = ORBIT_RADIUS[orbit.ring] ?? [3, 1.5]

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const t = reducedMotion ? 0 : clock.elapsedTime
    const angle = orbit.phase + t * orbit.speed * Math.PI * 2
    g.position.set(Math.cos(angle) * rx, Math.sin(angle) * ry, 0)
    // Stay upright — only a slow paddling drift, never tumbling along the orbit.
    g.rotation.y = orbit.facing + Math.sin(t * 0.45 + orbit.phase) * 0.3
    g.rotation.z = Math.sin(t * 0.38 + orbit.phase) * 0.1
    g.rotation.x = Math.sin(t * 0.31 + orbit.phase) * 0.12
  })

  return (
    <group ref={group}>
      <mesh geometry={geometry} scale={orbit.scale}>
        <SharedMaterial theme={theme} />
      </mesh>
    </group>
  )
}

/** An invisible orbit plane carrying the turtles assigned to it. */
function Orbit({
  index,
  theme,
  detail,
  reducedMotion,
}: {
  index: 0 | 1
  theme: Theme
  detail: CreatureDetail
  reducedMotion: boolean
}) {
  const group = useRef<Group>(null)
  const yaw = ORBIT_YAW[index] ?? 0

  useFrame(({ clock }) => {
    const g = group.current
    if (!g || reducedMotion) return
    const t = clock.elapsedTime
    // The whole orbit plane breathes very slightly, so the rings never look static.
    g.rotation.y = yaw + Math.cos(t * 0.15 + index) * 0.08
    g.rotation.x = Math.sin(t * 0.18 + index) * 0.03
  })

  return (
    <group ref={group} rotation={[0, yaw, 0]}>
      {TURTLES.filter((o) => o.ring === index).map((o, i) => (
        <Turtle key={i} orbit={o} theme={theme} detail={detail} reducedMotion={reducedMotion} />
      ))}
    </group>
  )
}

/** Holds the whole arrangement and maps pointer / scroll / intro onto it. */
function Arrangement({ theme, tier, progress, introDone, reducedMotion }: Omit<HeroSceneProps, 'active'>) {
  const group = useRef<Group>(null)
  const entrance = useRef(reducedMotion ? 1 : 0)
  const detail = DETAIL_BY_TIER[tier]

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
      <Dinosaur theme={theme} detail={detail} reducedMotion={reducedMotion} />
      <Orbit index={0} theme={theme} detail={detail} reducedMotion={reducedMotion} />
      <Orbit index={1} theme={theme} detail={detail} reducedMotion={reducedMotion} />
    </group>
  )
}

/**
 * The hero identity sculpture: a tyrannosaur ("To-Rex") circled by turtles from
 * Dilshodjon's avatar — dark chrome at night, glazed ceramic by day, reacting to
 * pointer, scroll and theme.
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
