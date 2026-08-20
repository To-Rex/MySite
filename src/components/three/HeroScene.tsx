import { Canvas, useFrame } from '@react-three/fiber'
import { MeshDistortMaterial, PerformanceMonitor, Sparkles } from '@react-three/drei'
import type { MotionValue } from 'motion/react'
import { useRef, useState, type ComponentRef } from 'react'
import { MathUtils, type Group, type Mesh } from 'three'
import { pointer } from '@/lib/pointer'
import type { Theme } from '@/theme/context'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { qualityFor } from '@/hooks/useDeviceTier'
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

type DistortMaterial = ComponentRef<typeof MeshDistortMaterial>

const MATERIAL = {
  dark: {
    color: '#16161a',
    metalness: 0.92,
    roughness: 0.16,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.9,
    sheen: 0,
    sheenColor: '#ffffff',
  },
  light: {
    color: '#f3efe8',
    metalness: 0.06,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.15,
    sheen: 0.45,
    sheenColor: '#ffffff',
  },
} as const

const RING = {
  dark: { color: '#f4f3f0', opacity: 0.22 },
  light: { color: '#2a2926', opacity: 0.28 },
} as const

function Sculpture({ theme, tier, progress, introDone, reducedMotion }: Omit<HeroSceneProps, 'active'>) {
  const group = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const ringA = useRef<Mesh>(null)
  const ringB = useRef<Mesh>(null)
  const material = useRef<DistortMaterial>(null)
  const entrance = useRef(reducedMotion ? 1 : 0)
  const q = qualityFor(tier)
  const m = MATERIAL[theme]
  const r = RING[theme]

  useFrame((state, dt) => {
    const g = group.current
    if (!g) return
    const delta = Math.min(dt, 1 / 30)
    const t = state.clock.elapsedTime
    const s = progress.get()

    // Entrance: scale in smoothly once the intro releases the hero.
    entrance.current = MathUtils.damp(entrance.current, introDone ? 1 : 0, 2.4, delta)

    // Pointer influence — gentle, always damped, never jumpy.
    const mx = pointer.inside && !pointer.isTouch ? pointer.nx : 0
    const my = pointer.inside && !pointer.isTouch ? pointer.ny : 0

    const idle = reducedMotion ? 0 : t * 0.08
    g.rotation.y = MathUtils.damp(g.rotation.y, mx * 0.5 + s * 1.4 + idle, 3, delta)
    g.rotation.x = MathUtils.damp(g.rotation.x, -my * 0.3 + s * 0.5, 3, delta)

    const scale = entrance.current * (1 - s * 0.28)
    g.scale.setScalar(Math.max(0.0001, scale))
    g.position.y = s * 1.6 + (reducedMotion ? 0 : Math.sin(t * 0.6) * 0.06)

    if (material.current) {
      material.current.distort = reducedMotion ? 0.22 : 0.34 + s * 0.25
    }
    if (!reducedMotion) {
      if (ringA.current) {
        ringA.current.rotation.z = t * 0.12
        ringA.current.rotation.x = Math.PI / 2.6 + Math.sin(t * 0.2) * 0.08
      }
      if (ringB.current) {
        ringB.current.rotation.z = -t * 0.09
        ringB.current.rotation.y = Math.PI / 3 + Math.cos(t * 0.17) * 0.1
      }
    }

    // Camera parallax.
    state.camera.position.x = MathUtils.damp(state.camera.position.x, mx * 0.28, 2, delta)
    state.camera.position.y = MathUtils.damp(state.camera.position.y, my * 0.18, 2, delta)
    state.camera.lookAt(0, 0, 0)
  })

  return (
    <group ref={group} scale={0.0001}>
      <mesh ref={core} castShadow={false} receiveShadow={false}>
        <icosahedronGeometry args={[1.25, q.detail]} />
        <MeshDistortMaterial
          ref={material}
          color={m.color}
          metalness={m.metalness}
          roughness={m.roughness}
          clearcoat={m.clearcoat}
          clearcoatRoughness={m.clearcoatRoughness}
          envMapIntensity={m.envMapIntensity}
          sheen={m.sheen}
          sheenColor={m.sheenColor}
          distort={0.34}
          speed={reducedMotion ? 0 : 1.15}
          radius={1}
        />
      </mesh>

      {/* Orbital rings — thin, metallic, barely there. */}
      <mesh ref={ringA} rotation={[Math.PI / 2.6, 0, 0]}>
        <torusGeometry args={[2.05, 0.006, 8, 220]} />
        <meshStandardMaterial color={r.color} metalness={1} roughness={0.35} transparent opacity={r.opacity} />
      </mesh>
      <mesh ref={ringB} rotation={[0, Math.PI / 3, Math.PI / 5]}>
        <torusGeometry args={[2.45, 0.004, 8, 220]} />
        <meshStandardMaterial color={r.color} metalness={1} roughness={0.35} transparent opacity={r.opacity * 0.7} />
      </mesh>
    </group>
  )
}

/**
 * The identity sculpture. A living, distorting icosahedron — dark metallic glass
 * at night, soft ceramic by day — reacting to the pointer, scroll and theme.
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
      <directionalLight position={[4, 6, 4]} intensity={theme === 'dark' ? 0.6 : 0.9} color={theme === 'dark' ? '#ffffff' : '#fff8ee'} />
      <ThemedEnvironment theme={theme} resolution={q.env} />
      <Sculpture {...props} />
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
