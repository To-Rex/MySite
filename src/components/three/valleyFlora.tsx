import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import {
  Color,
  DoubleSide,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type InstancedMesh,
  type PerspectiveCamera,
} from 'three'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import type { ValleyQuality } from '@/lib/valley'
import { GRASS_DENSITY, bakeGrass, canBake, disposeGrass, grassDraws, grassHeights, holdHeights, layGrass, setGrassPixel } from './valleyGrass'
import { smoothstep, type Spot } from './valleyLand'
import { foliageProgram } from './valleyMaterials'
import { geometryFor, leaf, needles, spotsFor } from './valleyForest'

/**
 * What grows, planted. Each kind in `valleyForest.ts` becomes one
 * `InstancedMesh` here, so the whole forest is four draw calls; the plants
 * lean and rock in the same gusting wind the meadow does, and the ones within
 * reach of the impact go over as the blast front passes. The meadow itself is
 * two more draws (see `Grass` below and `valleyGrass.ts`).
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
  const needleMap = useMemo(() => needles(), [])
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
      conifer: foliageProgram(17, 0.013),
      treeFern: foliageProgram(5, 0.03),
      fern: foliageProgram(2, 0.035),
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
      {(['umbrella', 'tiered'] as const).map((kind) => (
        <Planted key={kind} geometry={geometries[kind]} spots={spots[kind]} shadows={shadows} tint={coniferTint} knock={knock}>
          <meshStandardMaterial
            map={needleMap}
            vertexColors
            alphaTest={0.45}
            alphaToCoverage
            side={DoubleSide}
            roughness={0.9}
            envMapIntensity={0.25}
            onBeforeCompile={programs.conifer}
            customProgramCacheKey={keys.conifer}
          />
        </Planted>
      ))}
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

/**
 * The meadow (see `valleyGrass.ts`): two instanced draws of one blade each,
 * the near one curling, the far one a single triangle. Drawn before the
 * ground, so the ground's fragments behind the blades are never shaded.
 */
export function Grass({ quality, shadows }: { quality: ValleyQuality; shadows: boolean }) {
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const gl = useThree((state) => state.gl)
  const draws = useMemo(() => grassDraws(canBake(gl)), [gl])
  const heights = useMemo(() => grassHeights(), [])

  useLayoutEffect(() => holdHeights(heights), [heights])
  useEffect(() => () => disposeGrass(draws), [draws])
  useLayoutEffect(() => {
    layGrass(draws, quality, camera.fov, width / Math.max(1, height))
    bakeGrass(gl)
  }, [draws, quality, camera, width, height, gl])
  // In device pixels, so a sharper screen gets finer blades.
  useFrame((state) => setGrassPixel(camera.fov, state.gl.domElement.height))

  if (!GRASS_DENSITY[quality]) return null
  return (
    <>
      <mesh geometry={draws.near.geometry} material={draws.near.material} frustumCulled={false} receiveShadow={shadows} renderOrder={-1} />
      <mesh geometry={draws.far.geometry} material={draws.far.material} frustumCulled={false} receiveShadow={shadows} renderOrder={-1} />
    </>
  )
}
