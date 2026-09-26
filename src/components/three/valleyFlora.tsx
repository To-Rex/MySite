import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import {
  Color,
  DoubleSide,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type InstancedMesh,
} from 'three'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { smoothstep, type Spot } from './valleyLand'
import { foliageProgram } from './valleyMaterials'
import { geometryFor, leaf, spotsFor } from './valleyForest'

/**
 * The forest, planted. Each kind in `valleyForest.ts` becomes one
 * `InstancedMesh` here, so the whole forest is four draw calls; the plants
 * sway on their own phase and the ones within reach of the impact go over as
 * the blast front passes.
 */

export interface Blast {
  /** 0 before the impact, 1 once the blast front has passed. */
  blast: number
}

interface PlantedProps {
  geometry: BufferGeometry
  spots: Spot[]
  shadows: boolean
  /** Per-instance tint from the spot's own 0..1 value. */
  tint: (t: number) => Color
  /** Which trees the blast can put down, and from where. */
  knock?: { x: number; z: number; reach: number; beat: RefObject<Blast> }
  children: ReactNode
}

const M = new Matrix4()
const Q = new Quaternion()
const V = new Vector3()
const S = new Vector3()
const UP = new Vector3(0, 1, 0)
const AXIS = new Vector3()
const TILT = new Quaternion()
const C = new Color()

function Planted({ geometry, spots, shadows, tint, knock, children }: PlantedProps) {
  const mesh = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    spots.forEach((s, i) => {
      Q.setFromAxisAngle(UP, s.yaw)
      M.compose(V.set(s.x, s.y - 0.05, s.z), Q, S.setScalar(s.scale))
      m.setMatrixAt(i, M)
      m.setColorAt(i, tint(s.tint))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [spots, tint])

  // The trees the blast front reaches, found once. Each gets a delay and a
  // strength from its distance, so the front visibly travels outward.
  const felled = useMemo(() => {
    if (!knock) return []
    return spots
      .map((s, i) => ({ i, d: Math.hypot(s.x - knock.x, s.z - knock.z) }))
      .filter(({ d }) => d < knock.reach)
      .map(({ i, d }) => ({ i, delay: d / knock.reach, force: 1 - (d / knock.reach) * 0.55 }))
  }, [spots, knock])

  useFrame(() => {
    const m = mesh.current
    if (!m || !knock || felled.length === 0) return
    const blast = knock.beat.current.blast
    if (blast <= 0) return
    for (const { i, delay, force } of felled) {
      const s = spots[i]
      if (!s) continue
      const k = smoothstep(delay * 0.7, delay * 0.7 + 0.3, blast) * force
      AXIS.set(-(s.z - knock.z), 0, s.x - knock.x).normalize()
      TILT.setFromAxisAngle(AXIS, k * 1.3)
      Q.setFromAxisAngle(UP, s.yaw).premultiply(TILT)
      M.compose(V.set(s.x, s.y - 0.05 - k * 0.4, s.z), Q, S.setScalar(s.scale))
      m.setMatrixAt(i, M)
      // Scorched on the side that faced it.
      m.setColorAt(i, C.copy(tint(s.tint)).multiplyScalar(1 - k * 0.55))
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, spots.length]}
      geometry={geometry}
      castShadow={shadows}
      receiveShadow={shadows}
      frustumCulled={false}
    >
      {children}
    </instancedMesh>
  )
}

export interface FloraProps {
  tier: DeviceTier
  shadows: boolean
  groundZero: readonly [number, number]
  beat: RefObject<Blast>
}

const coniferTint = (t: number) => new Color(0.85 + t * 0.3, 0.9 + t * 0.2, 0.85 + t * 0.2)
const fernTint = (t: number) => new Color(0.8 + t * 0.4, 0.9 + t * 0.2, 0.75 + t * 0.25)

export function Flora({ tier, shadows, groundZero, beat }: FloraProps) {
  const geometries = useMemo(
    () => ({
      umbrella: geometryFor('umbrella'),
      tiered: geometryFor('tiered'),
      treeFern: geometryFor('treeFern'),
      fern: geometryFor('fern'),
    }),
    [],
  )
  const map = useMemo(() => leaf(), [])
  const spots = useMemo(
    () => ({
      umbrella: spotsFor(tier, 'umbrella'),
      tiered: spotsFor(tier, 'tiered'),
      treeFern: spotsFor(tier, 'treeFern'),
      fern: spotsFor(tier, 'fern'),
    }),
    [tier],
  )

  const programs = useMemo(
    () => ({
      conifer: foliageProgram(17),
      treeFern: foliageProgram(5),
      fern: foliageProgram(2),
    }),
    [],
  )
  const keys = useMemo(
    () => ({ conifer: () => 'valley-conifer', treeFern: () => 'valley-fern', fern: () => 'valley-fern' }),
    [],
  )
  const knock = useMemo(
    () => ({ x: groundZero[0], z: groundZero[1], reach: 85, beat }),
    [groundZero, beat],
  )

  return (
    <>
      <Planted geometry={geometries.umbrella} spots={spots.umbrella} shadows={shadows} tint={coniferTint} knock={knock}>
        <meshStandardMaterial vertexColors roughness={0.92} envMapIntensity={0.3} onBeforeCompile={programs.conifer} customProgramCacheKey={keys.conifer} />
      </Planted>
      <Planted geometry={geometries.tiered} spots={spots.tiered} shadows={shadows} tint={coniferTint} knock={knock}>
        <meshStandardMaterial vertexColors roughness={0.92} envMapIntensity={0.3} onBeforeCompile={programs.conifer} customProgramCacheKey={keys.conifer} />
      </Planted>
      <Planted geometry={geometries.treeFern} spots={spots.treeFern} shadows={shadows} tint={fernTint} knock={knock}>
        <meshStandardMaterial
          map={map}
          alphaTest={0.32}
          alphaToCoverage
          side={DoubleSide}
          roughness={0.8}
          envMapIntensity={0.3}
          onBeforeCompile={programs.treeFern}
          customProgramCacheKey={keys.treeFern}
        />
      </Planted>
      <Planted geometry={geometries.fern} spots={spots.fern} shadows={shadows} tint={fernTint}>
        <meshStandardMaterial
          map={map}
          alphaTest={0.32}
          alphaToCoverage
          side={DoubleSide}
          roughness={0.8}
          envMapIntensity={0.3}
          onBeforeCompile={programs.fern}
          customProgramCacheKey={keys.fern}
        />
      </Planted>
    </>
  )
}
