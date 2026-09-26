import { Canvas, useFrame, type RootState } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Fog,
  IcosahedronGeometry,
  MathUtils,
  Quaternion,
  Sphere,
  Vector3,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
  type Points,
  type SkinnedMesh,
} from 'three'
import type { Theme } from '@/theme/context'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { setValleyAct, type ValleyAct } from '@/lib/valley'
import { useCreatureGeometry } from './useCreature'
import { MASCOT_SKIN, animateFlap, animateGraze, useBind, useCreature, type Rig } from './creatureRig'
import { Eyes, Teeth } from './creatureFittings'
import { SkinMaterial } from './skinMaterial'
import { ThemedEnvironment } from './ThemedEnvironment'
import type { AnyCreatureKind } from './mascots'
import { VALLEY_DETAIL } from './valleyCast'
import { LAKE, VOLCANO, WATER_LEVEL, buildTerrain, hash2, heightAt } from './valleyLand'
import {
  ATMOS,
  HALO,
  ROCK,
  SKY,
  SKY_FRAG,
  SKY_VERT,
  SMOKE,
  TRAIL,
  makeSmokeMaterial,
  makeTrailMaterial,
  makeWaterMaterial,
  rockProgram,
  terrainProgram,
} from './valleyMaterials'
import { Flora } from './valleyFlora'

/**
 * The extinction cinematic: a valley, a herd, and the thing that ended them.
 *
 * It has its own full-bleed canvas rather than borrowing the hero's, which is
 * inset on wide screens and would leave a seam down the left of the sky. The
 * canvas exists only while the cinematic runs.
 *
 * Everything in here is procedural like the rest of the site. The land is in
 * `valleyLand.ts`, the shaders in `valleyMaterials.ts`, the forest in
 * `valleyFlora.tsx`; this file is the cast, the rock, and the timeline that
 * runs them.
 */

/**
 * How long the opening will hold for the cast before starting without it. The
 * warm-up in `Valley.tsx` normally means there is nothing to wait for at all.
 */
const MESH_PATIENCE = 6000

/** Seconds each act runs for, in order. */
const SCRIPT: readonly (readonly [Exclude<ValleyAct, 'idle'>, number])[] = [
  ['open', 2.4],
  ['graze', 4.2],
  ['streak', 2.6],
  ['impact', 1.8],
  ['die', 3.4],
  ['dark', 3],
  ['return', 2.8],
]

/** When the streak begins and how long it runs — the smoke trail is timed off it. */
const STREAK_AT = SCRIPT.slice(0, 2).reduce((sum, [, len]) => sum + len, 0)
const STREAK_LEN = SCRIPT[2]?.[1] ?? 2.6

/** Where the rock comes down, on the valley floor. */
const GROUND_ZERO: readonly [number, number] = [10, -72]

/** Where the rock comes in from. */
const ENTRY: readonly [number, number, number] = [-150, 120, -260]

const easeInOut = (u: number) => u * u * (3 - 2 * u)

/* -------------------------------------------------------------------------- */
/* Mood                                                                        */
/* -------------------------------------------------------------------------- */

/** Sky, fog and sunlight for each act, blended between as the cinematic runs. */
const MOOD = {
  day: { low: '#f0d3a4', high: '#4e86bf', glow: '#ffd9a0', sun: 1, fog: '#d6ccb8', light: 1.9, ambient: 0.65, env: 1, cloud: 1, mist: 0.32 },
  burn: { low: '#ffa855', high: '#6d4a45', glow: '#fff0c8', sun: 2.6, fog: '#d79a6a', light: 2.2, ambient: 0.6, env: 1.1, cloud: 0.7, mist: 0.28 },
  ash: { low: '#2b2724', high: '#14120f', glow: '#3a2a20', sun: 0.4, fog: '#211d19', light: 0.16, ambient: 0.1, env: 0.1, cloud: 0.2, mist: 0.6 },
  night: { low: '#090807', high: '#040404', glow: '#120c08', sun: 0.1, fog: '#070605', light: 0.04, ambient: 0.03, env: 0.02, cloud: 0, mist: 0.5 },
} as const

type Mood = (typeof MOOD)[keyof typeof MOOD]

/** Back to daylight, for a second showing. */
function resetSky(): void {
  SKY.uLow.value.set(MOOD.day.low)
  SKY.uHigh.value.set(MOOD.day.high)
  SKY.uGlow.value.set(MOOD.day.glow)
  SKY.uSun.value = MOOD.day.sun
  SKY.uCloud.value = MOOD.day.cloud
  SKY.uTime.value = 0
  ATMOS.uMistColor.value.set(MOOD.day.fog)
  ATMOS.uMistAmount.value = MOOD.day.mist
  ATMOS.uLevel.value = 1
  ATMOS.uTime.value = 0
  ROCK.uHeat.value = 0
  TRAIL.uStrength.value = 0
  HALO.uStrength.value = 0
}

/** One scratch colour for the blends, so a frame allocates nothing. */
const MIXER = new Color()
const blend = (a: string, b: string, m: number, out: Color) => out.set(a).lerp(MIXER.set(b), m)

/* -------------------------------------------------------------------------- */
/* The cast                                                                    */
/* -------------------------------------------------------------------------- */

interface Placed {
  kind: AnyCreatureKind
  x: number
  z: number
  size: number
  yaw: number
}

const HERD: readonly Placed[] = [
  { kind: 'sauropod', x: -23, z: -50, size: 13, yaw: 0.7 },
  { kind: 'sauropod', x: 31, z: -78, size: 11.5, yaw: -1.9 },
  { kind: 'stegosaur', x: 17, z: -33, size: 6.6, yaw: -0.8 },
  { kind: 'stegosaur', x: -41, z: -63, size: 6, yaw: 1.4 },
  { kind: 'dino', x: 5, z: -24, size: 7.4, yaw: -0.4 },
  { kind: 'turtle', x: -11, z: -16, size: 2.8, yaw: 0.9 },
  { kind: 'turtle', x: 13, z: -14, size: 2.2, yaw: -0.5 },
]

const FLYERS = [
  { x: -26, y: 22, z: -40, size: 7.5, phase: 0 },
  { x: -4, y: 29, z: -58, size: 6.4, phase: 1.4 },
  { x: 21, y: 18, z: -44, size: 6.8, phase: 2.7 },
] as const

/** Chunks of the crater floor, thrown out on fixed arcs. */
const EJECTA = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + 0.7
  const reach = 34 + hash2(i, 91) * 46
  return {
    vx: Math.cos(a) * reach,
    vz: Math.sin(a) * reach * 0.6,
    vy: 34 + hash2(i, 7) * 30,
    spin: 3 + hash2(i, 41) * 6,
    size: 0.35 + hash2(i, 13) * 0.9,
    delay: hash2(i, 55) * 0.25,
  }
})

const PLUME_COUNT = 460
/** Direction, climb rate and start delay for each puff of the column. */
const PLUME_SEED = (() => {
  const out = new Float32Array(PLUME_COUNT * 4)
  for (let i = 0; i < PLUME_COUNT; i++) {
    const a = hash2(i, 17) * Math.PI * 2
    const r = Math.pow(hash2(i, 23), 0.6)
    out[i * 4] = Math.cos(a) * r
    out[i * 4 + 1] = Math.sin(a) * r * 0.8
    out[i * 4 + 2] = 0.3 + hash2(i, 61)
    out[i * 4 + 3] = hash2(i, 83) * 0.35
  }
  return out
})()

const ASH_COUNT = 340
/**
 * Fixed x, z and the ground under each fleck, so the only thing left to compute
 * per frame is how far it has fallen.
 */
const ASH_HOME = (() => {
  const out = new Float32Array(ASH_COUNT * 3)
  for (let i = 0; i < ASH_COUNT; i++) {
    const x = (hash2(i, 3) - 0.5) * 200
    // In front of the camera but never on top of it: a fleck a few units from
    // the lens is a square the size of a building.
    const z = -18 - hash2(i, 29) * 180
    out[i * 3] = x
    out[i * 3 + 1] = heightAt(x, z)
    out[i * 3 + 2] = z
  }
  return out
})()

/**
 * The smoke the rock leaves behind it, one puff per step of the path. Each puff
 * is born the moment the rock passes its station, which is a fixed time once
 * the streak's easing is inverted — done here, once, by bisection.
 */
const SMOKE_COUNT = 150
const SMOKE_BORN = (() => {
  const out = new Float32Array(SMOKE_COUNT)
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const f = (i + 0.5) / SMOKE_COUNT
    let lo = 0
    let hi = 1
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2
      if (easeInOut(mid) < f) lo = mid
      else hi = mid
    }
    out[i] = STREAK_AT + ((lo + hi) / 2) * STREAK_LEN
  }
  return out
})()

/** The volcano's own smoke, which never stops. */
const VENT_COUNT = 36
const SUMMIT = heightAt(VOLCANO.x, VOLCANO.z) + 9

/** The ball of fire is sprites, not a sphere: a sphere was an egg. */
const FIRE_COUNT = 90
const FIRE_SEED = (() => {
  const out = new Float32Array(FIRE_COUNT * 4)
  for (let i = 0; i < FIRE_COUNT; i++) {
    const a = hash2(i, 121) * Math.PI * 2
    const b = Math.acos(2 * hash2(i, 122) - 1)
    out[i * 4] = Math.sin(b) * Math.cos(a)
    out[i * 4 + 1] = Math.abs(Math.cos(b)) * 0.8 + 0.2
    out[i * 4 + 2] = Math.sin(b) * Math.sin(a)
    out[i * 4 + 3] = hash2(i, 123)
  }
  return out
})()

let fleckTexture: CanvasTexture | null = null
function ashFleck(): CanvasTexture | null {
  if (fleckTexture) return fleckTexture
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 32, 32)
  fleckTexture = new CanvasTexture(canvas)
  return fleckTexture
}

let shadowTexture: CanvasTexture | null = null
/**
 * One soft blob, reused by every animal as the patch of shade it stands in.
 * With real shadow maps on it is the occlusion under the belly that a shadow
 * map is too coarse for; without them it is the only grounding the herd has.
 */
function contactShadow(): CanvasTexture | null {
  if (shadowTexture) return shadowTexture
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(0,0,0,0.62)')
  grad.addColorStop(0.45, 'rgba(0,0,0,0.3)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 64, 64)
  shadowTexture = new CanvasTexture(canvas)
  return shadowTexture
}

/* -------------------------------------------------------------------------- */
/* The rock                                                                    */
/* -------------------------------------------------------------------------- */

function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1103515245)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const fx = x - xi
  const fy = y - yi
  const fz = z - zi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const sz = fz * fz * (3 - 2 * fz)
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz)
  const x00 = MathUtils.lerp(c(0, 0, 0), c(1, 0, 0), sx)
  const x10 = MathUtils.lerp(c(0, 1, 0), c(1, 1, 0), sx)
  const x01 = MathUtils.lerp(c(0, 0, 1), c(1, 0, 1), sx)
  const x11 = MathUtils.lerp(c(0, 1, 1), c(1, 1, 1), sx)
  return MathUtils.lerp(MathUtils.lerp(x00, x10, sy), MathUtils.lerp(x01, x11, sy), sz)
}

/**
 * An asteroid: a sphere pushed in and out by noise at three scales until it
 * is a lump, with the surface left faceted because that is what a rock is.
 */
function rockGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(1, 4)
  const pos = g.attributes.position as BufferAttribute
  const colours = new Float32Array(pos.count * 3)
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
    const big = noise3(v.x * 1.4 + 9, v.y * 1.4, v.z * 1.4)
    const mid = noise3(v.x * 3.2, v.y * 3.2 + 4, v.z * 3.2)
    const fine = noise3(v.x * 7 + 2, v.y * 7, v.z * 7 + 6)
    const r = 0.66 + big * 0.5 + (mid - 0.5) * 0.22 + (fine - 0.5) * 0.08
    v.multiplyScalar(r)
    pos.setXYZ(i, v.x, v.y, v.z)
    const shade = 0.7 + fine * 0.5
    colours[i * 3] = 0.24 * shade
    colours[i * 3 + 1] = 0.2 * shade
    colours[i * 3 + 2] = 0.17 * shade
  }
  g.setAttribute('color', new BufferAttribute(colours, 3))
  g.computeVertexNormals()
  return g
}

/* -------------------------------------------------------------------------- */
/* Cast components                                                             */
/* -------------------------------------------------------------------------- */

interface CastProps {
  spot: Placed | (typeof FLYERS)[number]
  index: number
  theme: Theme
  bump: number
  shadows: boolean
  beat: RefObject<Beat>
}

/** Everything the scene tells its inhabitants, once per frame. */
interface Beat {
  t: number
  act: ValleyAct
  u: number
  /** 0 before the rock is noticed, 1 once every head is up. */
  alarm: number
  /** 0 alive, 1 down. */
  dead: number
  /** 0 before the impact, 1 once the blast front has crossed the valley. */
  blast: number
}

function Grazer({ spot, index, theme, bump, shadows, beat }: CastProps) {
  const place = spot as Placed
  const rig = useCreature(place.kind, VALLEY_DETAIL)
  const group = useRef<Group>(null)
  const shade = useRef<Mesh>(null)
  const shadowMap = useMemo(() => contactShadow(), [])
  const ground = useMemo(() => heightAt(place.x, place.z), [place.x, place.z])
  const skin =
    place.kind === 'dino'
      ? { texScale: 2.6, halfHeight: 0.22, plateMix: undefined as number | undefined }
      : place.kind === 'turtle'
        ? { texScale: 1.7, halfHeight: 0.17, plateMix: 0.8 }
        : MASCOT_SKIN[place.kind as 'sauropod']
  // Whoever stands nearest the impact goes down first.
  const reach = useMemo(
    () => Math.hypot(place.x - GROUND_ZERO[0], place.z - GROUND_ZERO[1]) / 90,
    [place.x, place.z],
  )
  const patch = shadows ? 0.5 : 0.85

  useFrame(() => {
    const g = group.current
    if (!rig || !g) return
    const { t, alarm, dead } = beat.current
    const gone = MathUtils.clamp((dead - reach * 0.35) * 1.6, 0, 1)
    animateGraze(rig.byName, t, index * 1.7, Math.max(alarm, gone))

    const fall = easeInOut(gone)
    // Down onto its side and settled into the ground, not merely leaning: at
    // 1.45 rad the long necks stayed up and the herd read as a row of stakes.
    g.position.set(place.x, ground + Math.sin(t * 0.5 + index) * 0.05 - fall * place.size * 0.34, place.z)
    g.rotation.set(
      fall * (0.5 + (index % 3) * 0.12),
      place.yaw + Math.sin(t * 0.12 + index) * 0.08 + fall * 0.3,
      -fall * (1.62 + (index % 2) * 0.1),
    )
    g.scale.setScalar(place.size)

    // The patch spreads and thins as the body settles onto its side.
    const sh = shade.current
    if (sh) {
      sh.scale.set(1 + fall * 0.5, 1 + fall * 0.3, 1)
      ;(sh.material as { opacity: number }).opacity = patch - fall * 0.35
    }
  })

  if (!rig) return null
  return (
    <>
      <Body rig={rig} species={place.kind} theme={theme} bump={bump} shadows={shadows} skin={skin} bodyRef={group} />
      <mesh
        ref={shade}
        position={[place.x, ground + 0.08, place.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-1}
      >
        <planeGeometry args={[place.size * 1.9, place.size * 1.35]} />
        <meshBasicMaterial map={shadowMap} transparent depthWrite={false} opacity={patch} />
      </mesh>
    </>
  )
}

function Flyer({ spot, index, theme, bump, shadows, beat }: CastProps) {
  const perch = spot as (typeof FLYERS)[number]
  const rig = useCreature('pterosaur', VALLEY_DETAIL)
  const group = useRef<Group>(null)

  useFrame(() => {
    const g = group.current
    if (!rig || !g) return
    const { t, alarm, dead } = beat.current
    // They scatter when it comes, then drop out of the sky.
    const power = 0.34 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.6 + index)) + alarm * 0.5
    const lift = animateFlap(rig.byName, t + perch.phase, 1.25 + alarm * 0.9, power)
    const wheel = t * (0.16 + alarm * 0.22) + perch.phase
    const drop = easeInOut(MathUtils.clamp(dead * 1.3 - index * 0.12, 0, 1))
    g.position.set(
      perch.x + Math.cos(wheel) * 12,
      perch.y + lift * perch.size + Math.sin(t * 0.5 + index) * 1.2 - drop * (perch.y + 6),
      perch.z + Math.sin(wheel) * 12,
    )
    g.rotation.set(0.42 + Math.sin(t * 0.5 + index) * 0.2 + drop * 1.6, -wheel + Math.PI / 2, drop * 0.9)
    g.scale.setScalar(perch.size)
  })

  if (!rig) return null
  return (
    <Body
      rig={rig}
      species="pterosaur"
      theme={theme}
      bump={bump}
      shadows={shadows}
      skin={MASCOT_SKIN.pterosaur}
      bodyRef={group}
    />
  )
}

function Body({
  rig,
  species,
  theme,
  bump,
  shadows,
  skin,
  bodyRef,
}: {
  rig: Rig
  species: AnyCreatureKind
  theme: Theme
  bump: number
  shadows: boolean
  skin: { texScale: number; halfHeight: number; plateMix?: number }
  bodyRef: RefObject<Group | null>
}) {
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton } = rig
  useBind(mesh, skeleton)
  return (
    <group ref={bodyRef} scale={0.0001}>
      <skinnedMesh
        ref={mesh}
        geometry={geometry}
        frustumCulled={false}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <SkinMaterial
          theme={theme}
          species={species}
          texScale={skin.texScale}
          bump={bump}
          halfHeight={skin.halfHeight}
          plateMix={skin.plateMix}
        />
      </skinnedMesh>
      <primitive object={root} />
      <Eyes rig={rig} theme={theme} />
      {rig.teeth.length > 0 ? <Teeth rig={rig} theme={theme} /> : null}
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/* The show                                                                    */
/* -------------------------------------------------------------------------- */

/** A points cloud with a size and an alpha per sprite, positioned every frame. */
function spriteField(count: number, centre: Vector3, radius: number): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(count), 1))
  g.setAttribute('aAlpha', new BufferAttribute(new Float32Array(count), 1))
  // Repositioned far from where the vertices start; without a bounding sphere
  // three culls it while every point still sits at the origin.
  g.boundingSphere = new Sphere(centre, radius)
  return g
}

const HERD_SPOTS = HERD.map(({ x, z }) => ({ x, z }))

function Show({ theme, tier }: { theme: Theme; tier: DeviceTier }) {
  const shadows = tier !== 'low'
  const terrain = useMemo(() => buildTerrain(tier === 'low' ? 64 : tier === 'medium' ? 96 : 128), [tier])
  const fleck = useMemo(() => ashFleck(), [])
  const rockShape = useMemo(() => rockGeometry(), [])
  const water = useMemo(() => makeWaterMaterial(tier === 'low' ? 0.18 : 0.32), [tier])
  const trailMaterial = useMemo(() => makeTrailMaterial(TRAIL.uStrength, 0), [])
  const haloMaterial = useMemo(() => makeTrailMaterial(HALO.uStrength, 1), [])
  const smokeMaterial = useMemo(() => makeSmokeMaterial(fleck, '#2f2823'), [fleck])
  const ventMaterial = useMemo(() => makeSmokeMaterial(fleck, '#5a5350'), [fleck])
  const plumeField = useMemo(() => spriteField(PLUME_COUNT, new Vector3(0, 40, -60), 400), [])
  const ashField = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(Float32Array.from(ASH_HOME), 3))
    g.boundingSphere = new Sphere(new Vector3(0, 40, -80), 320)
    return g
  }, [])
  const smokeField = useMemo(() => spriteField(SMOKE_COUNT, new Vector3(-70, 70, -170), 260), [])
  const ventField = useMemo(() => spriteField(VENT_COUNT, new Vector3(VOLCANO.x, SUMMIT + 30, VOLCANO.z), 120), [])
  const fireField = useMemo(() => spriteField(FIRE_COUNT, new Vector3(GROUND_ZERO[0], 20, GROUND_ZERO[1]), 90), [])
  const fireMaterial = useMemo(() => makeSmokeMaterial(fleck, '#ff7a1e', true), [fleck])
  const plumeMaterial = useMemo(() => makeSmokeMaterial(fleck, '#3a3128'), [fleck])
  const keys = useMemo(
    () => ({ terrain: () => 'valley-terrain', rock: () => 'valley-rock' }),
    [],
  )
  /** The rock's heading, and the rotation that lays the trail along it. */
  const [travel, trailTurn] = useMemo(() => {
    const dir = new Vector3(GROUND_ZERO[0] - ENTRY[0], -ENTRY[1], GROUND_ZERO[1] - ENTRY[2]).normalize()
    return [dir, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir)]
  }, [])
  const bump = tier === 'high' ? 0.03 : tier === 'medium' ? 0.022 : 0
  const cast = tier === 'low' ? HERD.slice(0, 4) : HERD
  const wings = tier === 'low' ? FLYERS.slice(0, 2) : FLYERS

  // Every kind the valley needs, requested up front. The cinematic has a running
  // time and will not wait mid-scene, so it waits here instead: a herd that turns
  // up during the second act is worse than a beat of empty sky.
  // One call per species rather than a loop over VALLEY_SPECIES, because these
  // are hooks; keep the two lists in step.
  const ready = [
    useCreatureGeometry('dino', VALLEY_DETAIL),
    useCreatureGeometry('turtle', VALLEY_DETAIL),
    useCreatureGeometry('pterosaur', VALLEY_DETAIL),
    useCreatureGeometry('sauropod', VALLEY_DETAIL),
    useCreatureGeometry('stegosaur', VALLEY_DETAIL),
  ].every(Boolean)

  const waited = useRef(0)
  const beat = useRef<Beat>({ t: 0, act: 'open', u: 0, alarm: 0, dead: 0, blast: 0 })
  /**
   * Wall clock, not accumulated frame deltas.
   *
   * Everything else on the site counts deltas so that parking a canvas pauses it
   * rather than rewinding it. A cinematic is the opposite case: it has a running
   * time, and on hardware that cannot keep up it should play roughly, not stretch
   * to several minutes — which is exactly what accumulating clamped deltas did
   * when the frame rate fell to a sixth of a frame a second.
   */
  const started = useRef(0)
  /**
   * Frame times over the opening, and one decision from them. The tier says
   * what the CPU is; it says nothing about the GPU, and a nine-year-old card
   * behind eight cores ran this at eight frames a second. If the opening runs
   * slow the shadows, the bump and the extra resolution go, before the herd is
   * even in shot.
   */
  const perf = useRef({ frames: 0, total: 0, last: 0, decided: false })

  const rock = useRef<Group>(null)
  const rockLight = useRef<PointLight>(null)
  const blastLight = useRef<PointLight>(null)
  const trail = useRef<Mesh>(null)
  const halo = useRef<Mesh>(null)
  const smoke = useRef<Points>(null)
  const vent = useRef<Points>(null)
  const fireball = useRef<Points>(null)
  const wave = useRef<Mesh>(null)
  const dust = useRef<Mesh>(null)
  const flash = useRef<Mesh>(null)
  const plume = useRef<Points>(null)
  const ejecta = useRef<Group>(null)
  const ash = useRef<Points>(null)

  useEffect(() => {
    resetSky()
    ROCK.uHeatDir.value.copy(travel)
  }, [travel])

  const ground = useMemo(() => heightAt(GROUND_ZERO[0], GROUND_ZERO[1]), [])

  useFrame((state: RootState) => {
    // Five creature meshes have to exist before there is a valley to show. They
    // are cheap at this detail and usually cached already, but on a cold start the
    // opening holds here rather than playing to an empty field.
    if (!started.current) {
      // Meshing five species takes a moment on a cold start. Hold the wide shot
      // while it happens rather than leaving the default camera pointed at the
      // dirt, which is what the opening used to look like.
      state.camera.position.set(0, 13.5, 30)
      state.camera.lookAt(0, 11, -70)
      if (!ready) {
        if (waited.current === 0) waited.current = performance.now()
        if (performance.now() - waited.current < MESH_PATIENCE) return
      }
      started.current = performance.now()
    }
    const t = (performance.now() - started.current) / 1000

    const pf = perf.current
    if (!pf.decided) {
      const now = performance.now()
      if (pf.last > 0 && t > 0.7 && t < 2.3) {
        pf.frames++
        pf.total += now - pf.last
      }
      pf.last = now
      if (t >= 2.3) {
        pf.decided = true
        const average = pf.frames > 3 ? pf.total / pf.frames : 0
        if (average > 34) {
          const sun = state.scene.getObjectByName('valley-sun') as { castShadow: boolean } | undefined
          if (sun) sun.castShadow = false
          ATMOS.uBump.value = 0
          state.setDpr(1)
        }
      }
    }

    let act: ValleyAct = 'idle'
    let u = 1
    let left = t
    for (const [name, length] of SCRIPT) {
      if (left < length) {
        act = name
        u = left / length
        break
      }
      left -= length
    }
    setValleyAct(act)
    if (act === 'idle') return

    // --- mood ----------------------------------------------------------------
    // Daylight until the rock is most of the way down, then the burn, the ash,
    // and the dark; morning comes back on the way out.
    let from: Mood = MOOD.day
    let to: Mood = MOOD.day
    let mix = 0
    if (act === 'streak') {
      from = MOOD.day
      to = MOOD.burn
      mix = easeInOut(MathUtils.clamp((u - 0.55) / 0.45, 0, 1)) * 0.55
    } else if (act === 'impact') {
      from = MOOD.day
      to = MOOD.burn
      mix = MathUtils.lerp(0.55, 1, easeInOut(u))
    } else if (act === 'die') {
      from = MOOD.burn
      to = MOOD.ash
      mix = easeInOut(u)
    } else if (act === 'dark') {
      from = MOOD.ash
      to = MOOD.night
      mix = easeInOut(u)
    } else if (act === 'return') {
      from = MOOD.night
      to = MOOD.day
      mix = easeInOut(MathUtils.clamp(u * 1.25, 0, 1))
    }
    blend(from.low, to.low, mix, SKY.uLow.value)
    blend(from.high, to.high, mix, SKY.uHigh.value)
    blend(from.glow, to.glow, mix, SKY.uGlow.value)
    SKY.uSun.value = MathUtils.lerp(from.sun, to.sun, mix)
    SKY.uCloud.value = MathUtils.lerp(from.cloud, to.cloud, mix)
    SKY.uTime.value = t
    ATMOS.uTime.value = t
    ATMOS.uMistAmount.value = MathUtils.lerp(from.mist, to.mist, mix)
    blend(from.fog, to.fog, mix, ATMOS.uMistColor.value)
    if (state.scene.fog) blend(from.fog, to.fog, mix, (state.scene.fog as Fog).color)
    const light = MathUtils.lerp(from.light, to.light, mix)
    ATMOS.uLevel.value = MathUtils.clamp(light / MOOD.day.light, 0.02, 1.2)
    const key = state.scene.getObjectByName('valley-sun') as { intensity: number } | undefined
    if (key) key.intensity = light
    const rim = state.scene.getObjectByName('valley-rim') as { intensity: number } | undefined
    if (rim) rim.intensity = light * 0.55
    const fill = state.scene.getObjectByName('valley-fill') as { intensity: number } | undefined
    if (fill) fill.intensity = MathUtils.lerp(from.ambient, to.ambient, mix)
    // The environment is what the hide reflects. Left at full strength it kept
    // the whole valley lit through the dark, sky black over a sunlit floor.
    state.scene.environmentIntensity = MathUtils.lerp(from.env, to.env, mix)
    SMOKE.uScale.value = state.gl.domElement.height * 0.5

    // --- what the animals know ------------------------------------------------
    beat.current.t = t
    beat.current.act = act
    beat.current.u = u
    beat.current.alarm =
      act === 'streak' ? easeInOut(MathUtils.clamp((u - 0.3) / 0.7, 0, 1)) : act === 'impact' ? 1 : 0
    beat.current.dead = act === 'die' ? easeInOut(u) : act === 'dark' || act === 'return' ? 1 : 0
    beat.current.blast =
      act === 'impact'
        ? MathUtils.clamp((u - 0.2) / 0.8, 0, 1) * 0.6
        : act === 'die'
          ? 0.6 + 0.4 * easeInOut(MathUtils.clamp(u * 1.6, 0, 1))
          : act === 'dark' || act === 'return'
            ? 1
            : 0
    // The wind: a breeze until the blast front, which flattens everything.
    ATMOS.uSway.value =
      0.028 + (act === 'impact' ? MathUtils.clamp((u - 0.2) * 4, 0, 1) * 0.12 : act === 'die' ? 0.12 * (1 - u * 0.7) : 0)

    // --- the camera -----------------------------------------------------------
    const dolly = act === 'open' ? 1 - easeInOut(u) : 0
    const shake = act === 'impact' ? Math.max(0, 1 - u * 1.6) : 0
    state.camera.position.set(
      Math.sin(t * 0.09) * 1.8 + Math.sin(t * 31) * shake * 0.9,
      9.5 + dolly * 4 + Math.sin(t * 27) * shake * 0.7,
      16 + dolly * 14,
    )
    state.camera.lookAt(0, 11 + Math.sin(t * 23) * shake * 0.6, -70)

    // --- the rock -------------------------------------------------------------
    const r = rock.current
    const tr = trail.current
    const hl = halo.current
    const rl = rockLight.current
    if (r && tr && hl && rl) {
      if (act === 'streak' || (act === 'impact' && u < 0.12)) {
        const fall = act === 'streak' ? easeInOut(u) : 1
        r.position.set(
          MathUtils.lerp(ENTRY[0], GROUND_ZERO[0], fall),
          MathUtils.lerp(ENTRY[1], ground + 2, fall * fall),
          MathUtils.lerp(ENTRY[2], GROUND_ZERO[1], fall),
        )
        r.rotation.set(t * 1.7, t * 2.3, t * 1.1)
        r.scale.setScalar(1.2 + fall * 4)
        ROCK.uHeat.value = 0.6 + fall * 3.4

        // The plasma: an open cone with its point at the rock, laid back along
        // the path, as long as the distance already flown. A second, fatter and
        // fainter one is the glow around it.
        const len = 40 + fall * 170
        const width = 3 + fall * 9
        tr.visible = true
        hl.visible = true
        tr.scale.set(width, len, width)
        hl.scale.set(width * 2.4, len * 0.9, width * 2.4)
        tr.quaternion.copy(trailTurn)
        hl.quaternion.copy(trailTurn)
        tr.position.copy(r.position).addScaledVector(travel, -len * 0.5)
        hl.position.copy(r.position).addScaledVector(travel, -len * 0.45)
        TRAIL.uStrength.value = 0.5 + fall * 0.6
        HALO.uStrength.value = 0.12 + fall * 0.2

        // And it lights the valley on the way down.
        rl.position.copy(r.position)
        rl.intensity = fall * fall * 9000
      } else {
        r.scale.setScalar(0.0001)
        tr.visible = false
        hl.visible = false
        rl.intensity = 0
        ROCK.uHeat.value = 0
      }
    }

    // The smoke it leaves behind, which stays.
    const sm = smoke.current
    if (sm) {
      const on = act === 'streak' || act === 'impact' || act === 'die' || act === 'dark'
      sm.visible = on
      if (on) {
        const pos = sm.geometry.attributes.position as BufferAttribute
        const size = sm.geometry.attributes.aSize as BufferAttribute
        const alpha = sm.geometry.attributes.aAlpha as BufferAttribute
        for (let i = 0; i < SMOKE_COUNT; i++) {
          const f = (i + 0.5) / SMOKE_COUNT
          const age = t - (SMOKE_BORN[i] ?? 0)
          if (age < 0) {
            alpha.setX(i, 0)
            continue
          }
          const jx = (hash2(i, 401) - 0.5) * 6
          const jy = (hash2(i, 402) - 0.5) * 6
          const jz = (hash2(i, 403) - 0.5) * 6
          pos.setXYZ(
            i,
            MathUtils.lerp(ENTRY[0], GROUND_ZERO[0], f) + jx * (1 + age * 0.4),
            MathUtils.lerp(ENTRY[1], ground + 2, f * f) + jy + age * 1.4,
            MathUtils.lerp(ENTRY[2], GROUND_ZERO[1], f) + jz * (1 + age * 0.4),
          )
          size.setX(i, 5 + age * 9 * (0.6 + hash2(i, 404) * 0.8))
          alpha.setX(i, 0.55 * Math.min(1, age * 3) * Math.exp(-age * 0.26) * (1 - f * 0.3))
        }
        pos.needsUpdate = true
        size.needsUpdate = true
        alpha.needsUpdate = true
      }
    }

    // The volcano, which was doing this before any of it and goes on after.
    const vt = vent.current
    if (vt) {
      const pos = vt.geometry.attributes.position as BufferAttribute
      const size = vt.geometry.attributes.aSize as BufferAttribute
      const alpha = vt.geometry.attributes.aAlpha as BufferAttribute
      for (let i = 0; i < VENT_COUNT; i++) {
        const age = (t * 0.22 + i * 0.31) % 7
        pos.setXYZ(
          i,
          VOLCANO.x + (hash2(i, 501) - 0.5) * 10 + age * 4,
          SUMMIT + age * 9,
          VOLCANO.z + (hash2(i, 502) - 0.5) * 10,
        )
        size.setX(i, 16 + age * 11)
        alpha.setX(i, 0.32 * Math.min(1, age * 2) * (1 - age / 7))
      }
      pos.needsUpdate = true
      size.needsUpdate = true
      alpha.needsUpdate = true
    }

    // --- what it does when it lands -------------------------------------------
    const bl = blastLight.current
    if (bl) {
      bl.intensity =
        act === 'impact'
          ? 26000 * Math.pow(1 - u, 1.4) + 7000
          : act === 'die'
            ? 7000 * (1 - easeInOut(u))
            : 0
    }

    const fb = fireball.current
    if (fb) {
      const life = act === 'impact' ? u : act === 'die' ? 1 + u * 0.6 : -1
      if (life >= 0 && life < 1.6) {
        const grow = Math.pow(MathUtils.clamp(life, 0, 1.6) / 1.6, 0.6)
        const pos = fb.geometry.attributes.position as BufferAttribute
        const size = fb.geometry.attributes.aSize as BufferAttribute
        const alpha = fb.geometry.attributes.aAlpha as BufferAttribute
        for (let i = 0; i < FIRE_COUNT; i++) {
          const dx = FIRE_SEED[i * 4] ?? 0
          const dy = FIRE_SEED[i * 4 + 1] ?? 0
          const dz = FIRE_SEED[i * 4 + 2] ?? 0
          const k = FIRE_SEED[i * 4 + 3] ?? 0
          // Out from the crater, then up: the ball becomes a column of fire.
          const reach = 4 + grow * (14 + k * 10)
          pos.setXYZ(
            i,
            GROUND_ZERO[0] + dx * reach + Math.sin(t * 7 + i) * 0.8,
            ground + 2 + dy * reach + grow * grow * 22,
            GROUND_ZERO[1] + dz * reach,
          )
          size.setX(i, 5 + grow * 9 + k * 5)
          alpha.setX(i, Math.max(0, 0.55 - grow * 0.6) * (0.6 + k * 0.4))
        }
        pos.needsUpdate = true
        size.needsUpdate = true
        alpha.needsUpdate = true
        fb.visible = true
      } else fb.visible = false
    }

    const pl = plume.current
    if (pl) {
      const life =
        act === 'impact'
          ? u * 0.3
          : act === 'die'
            ? 0.3 + u * 0.7
            : act === 'dark'
              ? 1
              : act === 'return'
                ? 1 - easeInOut(MathUtils.clamp(u * 3, 0, 1))
                : -1
      if (life > 0.01) {
        const grow = easeInOut(MathUtils.clamp(life, 0, 1))
        const fade = Math.min(1, grow * 2)
        const pos = pl.geometry.attributes.position as BufferAttribute
        const size = pl.geometry.attributes.aSize as BufferAttribute
        const alpha = pl.geometry.attributes.aAlpha as BufferAttribute
        for (let i = 0; i < PLUME_COUNT; i++) {
          const dx = PLUME_SEED[i * 4] ?? 0
          const dz = PLUME_SEED[i * 4 + 1] ?? 0
          const rise = PLUME_SEED[i * 4 + 2] ?? 1
          const delay = PLUME_SEED[i * 4 + 3] ?? 0
          const age = Math.max(0, grow - delay)
          // It widens as it climbs, which is the only thing that makes a column
          // of smoke read as one rather than as a puff.
          const spread = 9 + age * 62 * (0.35 + rise * 0.65)
          pos.setXYZ(
            i,
            GROUND_ZERO[0] + dx * spread + Math.sin(t * 0.4 + i) * 2,
            ground + 6 + rise * age * 76,
            GROUND_ZERO[1] + dz * spread,
          )
          size.setX(i, 8 + age * 14)
          alpha.setX(i, age > 0 ? 0.11 * fade * (0.5 + rise * 0.5) : 0)
        }
        pos.needsUpdate = true
        size.needsUpdate = true
        alpha.needsUpdate = true
        pl.visible = true
      } else pl.visible = false
    }

    const w = wave.current
    if (w) {
      const life = act === 'impact' ? u : act === 'die' ? 1 + u * 1.4 : -1
      if (life >= 0 && life < 2.4) {
        const grow = MathUtils.clamp(life, 0, 2.4) / 2.4
        w.position.set(GROUND_ZERO[0], ground + 1.2, GROUND_ZERO[1])
        w.scale.setScalar(4 + grow * 150)
        ;(w.material as MeshBasicMaterial).opacity = Math.max(0, 0.26 - grow * 0.3)
        w.visible = true
      } else w.visible = false
    }

    const ej = ejecta.current
    if (ej) {
      const life = act === 'impact' ? u * 0.45 : act === 'die' ? 0.45 + u * 0.55 : -1
      ej.visible = life >= 0
      if (life >= 0) {
        ej.children.forEach((c, i) => {
          const seed = EJECTA[i]
          if (!seed) return
          // A plain ballistic arc, so the chunks slow at the top and come down.
          const age = Math.max(0, life * 1.9 - seed.delay)
          c.position.set(
            GROUND_ZERO[0] + seed.vx * age,
            ground + 1 + seed.vy * age - 26 * age * age,
            GROUND_ZERO[1] + seed.vz * age,
          )
          c.rotation.set(age * seed.spin, age * seed.spin * 1.6, 0)
          c.scale.setScalar(seed.size * MathUtils.clamp(1 - (life - 0.7) * 3, 0, 1))
        })
      }
    }

    const as = ash.current
    if (as) {
      const on = act === 'die' ? easeInOut(u) : act === 'dark' ? 1 : act === 'return' ? 1 - easeInOut(u) : 0
      as.visible = on > 0.02
      ;(as.material as MeshStandardMaterial).opacity = on * 0.8
      const pos = as.geometry.attributes.position as BufferAttribute
      for (let i = 0; i < ASH_COUNT; i++) {
        // Each fleck falls at its own rate and wraps round to the top again.
        const drift = (t * (2.2 + (i % 5) * 0.7) + i * 3.1) % 92
        pos.setY(i, (ASH_HOME[i * 3 + 1] ?? 0) + 90 - drift)
        pos.setX(i, (ASH_HOME[i * 3] ?? 0) + Math.sin(t * 0.5 + i) * 2.4)
      }
      pos.needsUpdate = true
    }

    const d = dust.current
    if (d) {
      const life =
        act === 'impact'
          ? u * 0.12
          : act === 'die'
            ? 0.12 + u * 0.88
            : act === 'dark'
              ? 1
              : act === 'return'
                ? 1 - easeInOut(MathUtils.clamp(u * 1.3, 0, 1))
                : -1
      if (life > 0.01) {
        const grow = easeInOut(MathUtils.clamp(life, 0, 1))
        ;(d.material as MeshBasicMaterial).opacity = grow * 0.82
        d.position.copy(state.camera.position)
        d.quaternion.copy(state.camera.quaternion)
        d.translateZ(-1.4)
        d.visible = true
      } else d.visible = false
    }

    // The white-out, held right in front of the lens.
    const fl = flash.current
    if (fl) {
      const blast = act === 'impact' ? Math.pow(Math.max(0, 1 - u * 3.2), 1.6) : 0
      fl.visible = blast > 0.01
      ;(fl.material as MeshStandardMaterial).opacity = blast
      fl.position.copy(state.camera.position)
      fl.quaternion.copy(state.camera.quaternion)
      fl.translateZ(-1.2)
    }
  })

  return (
    <>
      {/* Far enough back that the ridge at the end of the valley still reads;
          the mist in the materials handles the floor. */}
      <fog attach="fog" args={[MOOD.day.fog, 95, 400]} />
      {/* The hide is a physical material: with no environment to reflect it goes
          to near-black, and the whole herd came out as silhouettes. */}
      <ThemedEnvironment theme={theme} resolution={64} />
      <hemisphereLight name="valley-fill" args={['#c9d9ea', '#5a4a33', MOOD.day.ambient]} />
      {/* Key from the camera's side so the animals are lit rather than backlit,
          with a low warm rim behind for the hour of the day. The key casts:
          one orthographic box over the near valley, where the herd is. */}
      <directionalLight
        name="valley-sun"
        position={[-42, 34, 26]}
        intensity={MOOD.day.light}
        color="#ffe3bc"
        castShadow={shadows}
        shadow-mapSize-width={tier === 'high' ? 2048 : 1024}
        shadow-mapSize-height={tier === 'high' ? 2048 : 1024}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      >
        {/* A camera of its own, because `shadow-camera-left` and friends set
            the numbers but never rebuild the projection: the box stayed at the
            default ten units and there were no shadows anywhere. */}
        <orthographicCamera attach="shadow-camera" args={[-110, 110, 120, -120, 1, 260]} />
      </directionalLight>
      <directionalLight name="valley-rim" position={[-56, 12, -86]} intensity={MOOD.day.light * 0.55} color="#ffb877" />

      <mesh scale={520} renderOrder={-10}>
        <sphereGeometry args={[1, 32, 24]} />
        <shaderMaterial vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} side={BackSide} depthWrite={false} uniforms={SKY} />
      </mesh>

      <mesh geometry={terrain} receiveShadow={shadows}>
        <meshStandardMaterial
          roughness={0.95}
          metalness={0}
          envMapIntensity={0.3}
          onBeforeCompile={terrainProgram}
          customProgramCacheKey={keys.terrain}
        />
      </mesh>

      {/* The lake. Drawn after the ground and before the animals, so its
          transparency sorts against the shore correctly. */}
      <mesh position={[LAKE.x, WATER_LEVEL, LAKE.z]} rotation={[-Math.PI / 2, 0, 0]} material={water} renderOrder={1}>
        <circleGeometry args={[LAKE.r * 1.12, 64]} />
      </mesh>

      {/* The mountain is in the ground; this is what comes out of it. */}
      <points ref={vent} geometry={ventField} material={ventMaterial} />

      <Flora tier={tier} shadows={shadows} herd={HERD_SPOTS} groundZero={GROUND_ZERO} beat={beat} />

      {cast.map((spot, i) => (
        <Grazer key={i} spot={spot} index={i} theme={theme} bump={bump} shadows={shadows} beat={beat} />
      ))}
      {wings.map((spot, i) => (
        <Flyer key={i} spot={spot} index={i} theme={theme} bump={bump} shadows={shadows} beat={beat} />
      ))}

      <group ref={rock} scale={0.0001}>
        <mesh geometry={rockShape}>
          <meshStandardMaterial
            vertexColors
            roughness={1}
            metalness={0}
            envMapIntensity={0.2}
            onBeforeCompile={rockProgram}
            customProgramCacheKey={keys.rock}
          />
        </mesh>
      </group>
      <pointLight ref={rockLight} color="#ffb070" intensity={0} decay={2} />
      <mesh ref={trail} material={trailMaterial} visible={false}>
        <coneGeometry args={[1, 1, 24, 1, true]} />
      </mesh>
      <mesh ref={halo} material={haloMaterial} visible={false}>
        <coneGeometry args={[1, 1, 24, 1, true]} />
      </mesh>
      <points ref={smoke} geometry={smokeField} material={smokeMaterial} visible={false} />

      <pointLight ref={blastLight} position={[GROUND_ZERO[0], ground + 6, GROUND_ZERO[1]]} color="#ff7a30" intensity={0} decay={2} />
      <points ref={fireball} geometry={fireField} material={fireMaterial} visible={false} />
      {/* The column that goes up after it, and spreads. */}
      <points ref={plume} geometry={plumeField} material={plumeMaterial} visible={false} />
      <mesh ref={wave} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.82, 1, 96]} />
        <meshBasicMaterial color="#e3cda6" transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* Thrown out of the crater and back down again. */}
      <group ref={ejecta} visible={false}>
        {EJECTA.map((_, i) => (
          <mesh key={i}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#4a3a2c" emissive="#ff7028" emissiveIntensity={2.2} roughness={0.9} flatShading />
          </mesh>
        ))}
      </group>

      {/* What is still coming down long after. */}
      <points ref={ash} geometry={ashField} visible={false}>
        <pointsMaterial size={1.15} map={fleck} color="#9c9084" transparent opacity={0} depthWrite={false} sizeAttenuation />
      </points>

      {/* Held in front of the lens, like the flash. */}
      {/* Both of these ignore depth, so the order between them is explicit. */}
      <mesh ref={dust} renderOrder={10} visible={false}>
        <planeGeometry args={[7, 4.6]} />
        <meshBasicMaterial color="#241e18" transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>
      <mesh ref={flash} renderOrder={11} visible={false}>
        <planeGeometry args={[7, 4.6]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={4} transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>
    </>
  )
}

export interface ValleySceneProps {
  theme: Theme
  tier: DeviceTier
}

export default function ValleyScene({ theme, tier }: ValleySceneProps) {
  return (
    <Canvas
      dpr={tier === 'high' ? [1, 1.6] : 1}
      shadows={tier === 'low' ? false : 'percentage'}
      camera={{ position: [0, 12, 42], fov: 46, near: 0.5, far: 600 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false }}
    >
      <Show theme={theme} tier={tier} />
    </Canvas>
  )
}
