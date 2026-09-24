import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float, Html, PerformanceMonitor } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry, MathUtils, Quaternion, Vector3, type Group, type Mesh, type MeshPhysicalMaterial } from 'three'
import { pointer } from '@/lib/pointer'
import type { Theme } from '@/theme/context'
import { qualityFor, type DeviceTier } from '@/hooks/useDeviceTier'
import { technologies, type Technology } from '@/content/technologies'
import type { TechId } from '@/i18n/types'
import { ThemedEnvironment } from './ThemedEnvironment'

export interface UniverseSceneProps {
  theme: Theme
  tier: DeviceTier
  reducedMotion: boolean
  active: boolean
  compact: boolean
  activeId: TechId | null
  onActivate: (id: TechId) => void
  labels: Record<TechId, string>
}

const PALETTE = {
  dark: { node: '#1b1b20', nodeActive: '#dcc095', core: '#141417', wire: '#f4f3f0', line: '#f4f3f0', label: '#f4f3f0' },
  light: { node: '#f1ede6', nodeActive: '#9a6b2a', core: '#f3efe8', wire: '#121211', line: '#121211', label: '#121211' },
} as const

/** Deterministic, evenly spread positions on a slightly flattened sphere. */
function layoutNodes(items: readonly Technology[], radius: number, compact: boolean) {
  const n = items.length
  const golden = Math.PI * (3 - Math.sqrt(5))
  return items.map((item, i) => {
    const y = 1 - (i / (n - 1)) * 2 // 1 → -1
    const r = Math.sqrt(1 - y * y)
    const theta = golden * i + 0.6
    const spread = item.core ? radius * 0.72 : radius
    const x = Math.cos(theta) * r * spread * (compact ? 0.82 : 1)
    const z = Math.sin(theta) * r * spread * 0.7
    return new Vector3(x, y * spread * 0.78, z)
  })
}

interface NodeProps {
  tech: Technology
  base: Vector3
  label: string
  theme: Theme
  isActive: boolean
  compact: boolean
  reducedMotion: boolean
  onActivate: (id: TechId) => void
  register: (id: TechId, refs: NodeRefs | null) => void
}

interface NodeRefs {
  mesh: Mesh
  holder: Group
}

function TechNode({ tech, base, label, theme, isActive, compact, reducedMotion, onActivate, register }: NodeProps) {
  const mesh = useRef<Mesh>(null)
  const holder = useRef<Group>(null)
  const material = useRef<MeshPhysicalMaterial>(null)
  const button = useRef<HTMLButtonElement>(null)
  const scale = useRef(1)
  const p = PALETTE[theme]
  const size = 0.09 + tech.weight * 0.08

  useEffect(() => {
    if (mesh.current && holder.current) register(tech.id, { mesh: mesh.current, holder: holder.current })
    return () => register(tech.id, null)
  }, [register, tech.id])

  useFrame(({ camera }, dt) => {
    const m = mesh.current
    if (!m) return
    const delta = Math.min(dt, 1 / 30)
    scale.current = MathUtils.damp(scale.current, isActive ? 1.55 : 1, 6, delta)
    m.scale.setScalar(scale.current)

    // Depth cue: nodes further from the camera fade and recede.
    const world = m.getWorldPosition(tmpVec)
    const depth = camera.position.distanceTo(world)
    const near = camera.position.length() - 2.6
    const far = camera.position.length() + 2.6
    const k = MathUtils.clamp(1 - (depth - near) / (far - near), 0, 1)
    const opacity = 0.35 + k * 0.65
    if (material.current) material.current.opacity = isActive ? 1 : opacity
    if (button.current) {
      button.current.style.opacity = String(isActive ? 1 : 0.45 + k * 0.55)
      button.current.dataset.active = isActive ? 'true' : 'false'
    }
  })

  return (
    <group ref={holder} position={base}>
      <Float speed={reducedMotion ? 0 : 1.2} rotationIntensity={0} floatIntensity={reducedMotion ? 0 : 0.5} floatingRange={[-0.08, 0.08]}>
        <mesh ref={mesh} onPointerOver={() => onActivate(tech.id)} onClick={() => onActivate(tech.id)}>
          <icosahedronGeometry args={[size, 3]} />
          <meshPhysicalMaterial
            ref={material}
            color={isActive ? p.nodeActive : p.node}
            emissive={isActive ? p.nodeActive : '#000000'}
            emissiveIntensity={isActive ? 0.35 : 0}
            metalness={theme === 'dark' ? 0.9 : 0.1}
            roughness={theme === 'dark' ? 0.22 : 0.3}
            clearcoat={1}
            clearcoatRoughness={0.2}
            transparent
            envMapIntensity={theme === 'dark' ? 1.6 : 1.1}
          />
        </mesh>
        <Html center position={[0, -(size + 0.26), 0]} distanceFactor={compact ? 6.2 : 7.6} zIndexRange={[40, 0]} style={{ pointerEvents: 'auto' }}>
          <button
            ref={button}
            type="button"
            className="universe-label"
            data-cursor="link"
            data-active={isActive}
            onPointerEnter={() => onActivate(tech.id)}
            onFocus={() => onActivate(tech.id)}
            onClick={() => onActivate(tech.id)}
            aria-pressed={isActive}
          >
            <span className="universe-label__dot" aria-hidden />
            {label}
          </button>
        </Html>
      </Float>
    </group>
  )
}

const tmpVec = new Vector3()
const tmpVec2 = new Vector3()
const tmpQuat = new Quaternion()

function Core({ theme, tier, activeId, reducedMotion }: { theme: Theme; tier: DeviceTier; activeId: TechId | null; reducedMotion: boolean }) {
  const group = useRef<Group>(null)
  const wire = useRef<Mesh>(null)
  const pulse = useRef(1)
  const spin = useRef(0)
  const p = PALETTE[theme]
  const q = qualityFor(tier)

  useEffect(() => {
    if (activeId) pulse.current = 1.12
  }, [activeId])

  useFrame((_, dt) => {
    const delta = Math.min(dt, 1 / 30)
    pulse.current = MathUtils.damp(pulse.current, 1, 4, delta)
    if (group.current) group.current.scale.setScalar(pulse.current)
    if (wire.current && !reducedMotion) {
      // Counted here rather than read from `state.clock`: this canvas is parked
      // with `frameloop="never"` off-screen, and R3F zeroes that clock whenever
      // the prop flips — while a parked frame sets it to the rAF timestamp, in
      // milliseconds. Either one snaps the cage to a different orientation the
      // moment the section scrolls back into view.
      spin.current += Math.min(dt, 0.25)
      wire.current.rotation.y = spin.current * 0.12
      wire.current.rotation.x = spin.current * 0.07
    }
  })

  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[0.82, Math.max(2, q.detail - 2)]} />
        <meshPhysicalMaterial
          color={p.core}
          metalness={theme === 'dark' ? 0.95 : 0.05}
          roughness={theme === 'dark' ? 0.18 : 0.3}
          clearcoat={1}
          clearcoatRoughness={0.15}
          envMapIntensity={theme === 'dark' ? 1.8 : 1.1}
          sheen={theme === 'dark' ? 0 : 0.4}
        />
      </mesh>
      <mesh ref={wire}>
        <icosahedronGeometry args={[1.02, 1]} />
        <meshBasicMaterial color={p.wire} wireframe transparent opacity={theme === 'dark' ? 0.1 : 0.14} />
      </mesh>
    </group>
  )
}

function Constellation({ theme, tier, reducedMotion, compact, activeId, onActivate, labels }: Omit<UniverseSceneProps, 'active'>) {
  const group = useRef<Group>(null)
  const spin = useRef(0)
  const lines = useRef<BufferGeometry>(null)
  const nodes = useRef(new Map<TechId, NodeRefs>())
  const { camera } = useThree()
  const q = qualityFor(tier)
  const p = PALETTE[theme]

  const radius = compact ? 2.05 : 2.7
  const bases = useMemo(() => layoutNodes(technologies, radius, compact), [radius, compact])

  const register = useMemo(
    () => (id: TechId, refs: NodeRefs | null) => {
      if (refs) nodes.current.set(id, refs)
      else nodes.current.delete(id)
    },
    [],
  )

  const linePositions = useMemo(() => new Float32Array(technologies.length * 2 * 3), [])

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const delta = Math.min(dt, 1 / 30)
    const hovering = activeId !== null && pointer.inside && !pointer.isTouch
    const speed = reducedMotion ? 0 : hovering ? 0.015 : 0.07
    spin.current += delta * speed

    const mx = pointer.inside && !pointer.isTouch ? pointer.nx : 0
    const my = pointer.inside && !pointer.isTouch ? pointer.ny : 0
    g.rotation.y = MathUtils.damp(g.rotation.y, spin.current + mx * 0.25, 4, delta)
    g.rotation.x = MathUtils.damp(g.rotation.x, -my * 0.18, 4, delta)

    // Magnetic drift toward the pointer, computed in screen space.
    tmpQuat.copy(g.quaternion).invert()
    technologies.forEach((tech, i) => {
      const refs = nodes.current.get(tech.id)
      const base = bases[i]
      if (!refs || !base) return
      const { holder } = refs
      let ox = 0
      let oy = 0
      if (!reducedMotion && pointer.inside && !pointer.isTouch) {
        holder.getWorldPosition(tmpVec)
        tmpVec2.copy(tmpVec).project(camera)
        const dx = pointer.nx - tmpVec2.x
        const dy = pointer.ny - tmpVec2.y
        const dist = Math.hypot(dx, dy)
        const reach = 0.28
        if (dist < reach && dist > 0.0001) {
          const k = (1 - dist / reach) * 0.22
          ox = (dx / dist) * k
          oy = (dy / dist) * k
        }
      }
      // Screen-space offset → world → local (group) space.
      tmpVec.set(ox, oy, 0).applyQuaternion(camera.quaternion).applyQuaternion(tmpQuat)
      holder.position.x = MathUtils.damp(holder.position.x, base.x + tmpVec.x, 6, delta)
      holder.position.y = MathUtils.damp(holder.position.y, base.y + tmpVec.y, 6, delta)
      holder.position.z = MathUtils.damp(holder.position.z, base.z + tmpVec.z, 6, delta)

      linePositions[i * 6 + 0] = 0
      linePositions[i * 6 + 1] = 0
      linePositions[i * 6 + 2] = 0
      linePositions[i * 6 + 3] = holder.position.x
      linePositions[i * 6 + 4] = holder.position.y
      linePositions[i * 6 + 5] = holder.position.z
    })
    if (lines.current) {
      const attr = lines.current.getAttribute('position') as BufferAttribute | undefined
      if (attr) attr.needsUpdate = true
    }
  })

  return (
    <group ref={group}>
      <Core theme={theme} tier={tier} activeId={activeId} reducedMotion={reducedMotion} />
      {q.lines && (
        <lineSegments>
          <bufferGeometry ref={lines}>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={p.line} transparent opacity={theme === 'dark' ? 0.1 : 0.12} />
        </lineSegments>
      )}
      {technologies.map((tech, i) => (
        <TechNode
          key={tech.id}
          tech={tech}
          base={bases[i] ?? new Vector3()}
          label={labels[tech.id]}
          theme={theme}
          isActive={activeId === tech.id}
          compact={compact}
          reducedMotion={reducedMotion}
          onActivate={onActivate}
          register={register}
        />
      ))}
    </group>
  )
}

/** Interactive technology universe — a calm constellation around a central core. */
export default function UniverseScene(props: UniverseSceneProps) {
  const { theme, tier, active, compact } = props
  const q = qualityFor(tier)
  const [dpr, setDpr] = useState<number | [number, number]>(q.dpr)

  return (
    <Canvas
      dpr={dpr}
      frameloop={active ? 'always' : 'never'}
      camera={{ position: [0, 0, compact ? 9 : 7.6], fov: compact ? 44 : 38, near: 0.1, far: 50 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false }}
      style={{ background: 'transparent' }}
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} flipflops={2} />
      <ambientLight intensity={theme === 'dark' ? 0.2 : 0.55} />
      <directionalLight position={[3, 5, 4]} intensity={theme === 'dark' ? 0.5 : 0.8} />
      <ThemedEnvironment theme={theme} resolution={Math.min(q.env, 128)} />
      <Constellation {...props} />
    </Canvas>
  )
}
