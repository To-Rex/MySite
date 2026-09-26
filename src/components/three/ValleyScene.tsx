import { Canvas, useFrame, type RootState } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Fog,
  MathUtils,
  PlaneGeometry,
  Quaternion,
  Sphere,
  Vector3,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
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

/**
 * The extinction cinematic: a valley, a herd, and the thing that ended them.
 *
 * It has its own full-bleed canvas rather than borrowing the hero's, which is
 * inset on wide screens and would leave a seam down the left of the sky. The
 * canvas exists only while the cinematic runs.
 *
 * Everything in here is procedural like the rest of the site: the terrain is a
 * displaced plane, the sky is two colours and a horizon, and the cast is the
 * same rigged creatures the rest of the page uses, at the same detail so the
 * meshes come out of the cache the hero already filled.
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

/** Where the rock comes down, on the valley floor. */
const GROUND_ZERO: readonly [number, number] = [10, -72]

/**
 * The cast is meshed at the cheap detail whatever the device can manage: they
 * stand across a valley, most of them a long way off, and seven creatures at the
 * hero's detail is a lot of triangles for silhouettes.
 */


const easeInOut = (u: number) => u * u * (3 - 2 * u)

/* -------------------------------------------------------------------------- */
/* Terrain                                                                     */
/* -------------------------------------------------------------------------- */

/** Allocation-free integer hash, the same trick the skin texture uses. */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const sx = xf * xf * (3 - 2 * xf)
  const sy = yf * yf * (3 - 2 * yf)
  const a = MathUtils.lerp(hash2(xi, yi), hash2(xi + 1, yi), sx)
  const b = MathUtils.lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), sx)
  return MathUtils.lerp(a, b, sy)
}

/**
 * The shape of the place: a flat floor that lifts into ridges on both sides and
 * closes off in the distance, so the camera is looking *along* a valley rather
 * than across an open field.
 */
function heightAt(x: number, z: number): number {
  // Capped, and pushed well out to the sides. Uncapped they climbed past the top
  // of the frustum long before the plane ran out and the frame became all hill:
  // at the back of the valley the camera can see roughly 75 units up, so 30 and
  // 40 leave the ridge line low in the frame and the upper half to the sky.
  const walls = Math.min(30, Math.pow(Math.abs(x) / 98, 2.2) * 30)
  const far = Math.min(40, Math.pow(Math.max(0, -z - 120) / 105, 2) * 40)
  const rolling =
    (valueNoise(x * 0.021, z * 0.021) - 0.5) * 7 +
    (valueNoise(x * 0.055, z * 0.055) - 0.5) * 2.6 +
    (valueNoise(x * 0.15, z * 0.15) - 0.5) * 0.9 +
    (valueNoise(x * 0.4, z * 0.4) - 0.5) * 0.3
  return walls + far + rolling
}

function useTerrain(detail: number) {
  return useMemo(() => {
    const size = 340
    const geometry = new PlaneGeometry(size, size, detail, detail)
    geometry.rotateX(-Math.PI / 2)
    const pos = geometry.attributes.position as BufferAttribute
    const colours = new Float32Array(pos.count * 3)
    const low = new Color('#6f5f3f')
    const high = new Color('#c4b083')
    const grass = new Color('#5b6437')
    const tint = new Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i) - 70
      const y = heightAt(x, z)
      pos.setY(i, y)
      pos.setZ(i, z)
      // Higher ground catches the light, and scrub breaks up the floor so it
      // reads as ground rather than as a smooth brown sheet.
      tint.copy(low).lerp(high, MathUtils.clamp(y / 20 + valueNoise(x * 0.07, z * 0.07) * 0.5, 0, 1))
      tint.lerp(grass, MathUtils.clamp((valueNoise(x * 0.045 + 31, z * 0.045 - 17) - 0.42) * 2.1, 0, 0.55))
      colours[i * 3] = tint.r
      colours[i * 3 + 1] = tint.g
      colours[i * 3 + 2] = tint.b
    }
    geometry.setAttribute('color', new BufferAttribute(colours, 3))
    geometry.computeVertexNormals()
    return geometry
  }, [detail])
}

/* -------------------------------------------------------------------------- */
/* Sky                                                                         */
/* -------------------------------------------------------------------------- */

const SKY_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAG = /* glsl */ `
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform vec3 uGlow;
  uniform float uSun;
  uniform float uCloud;
  uniform float uTime;
  varying vec3 vPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vPos);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    // Blue well before the zenith: at 0.42/0.95 the whole frame sat in the
    // horizon colour and the sky read as one flat band of haze.
    vec3 col = mix(uLow, uHigh, smoothstep(0.5, 0.82, h));

    // Cloud, projected onto the dome. Fades out with uCloud when the light goes.
    if (uCloud > 0.01 && dir.y > 0.0) {
      vec2 uv = dir.xz / max(dir.y, 0.12) * 0.5 + vec2(uTime * 0.004, 0.0);
      float band = fbm(uv * 0.6);
      float cover = smoothstep(0.48, 0.78, band) * smoothstep(0.0, 0.22, dir.y);
      col = mix(col, mix(uHigh, uGlow, 0.65) + vec3(0.18), cover * uCloud * 0.8);
    }

    // A low sun off to the left, bleeding along the horizon.
    float sun = pow(max(0.0, dot(dir, normalize(vec3(-0.55, 0.1, -1.0)))), 12.0);
    col += uGlow * sun * uSun;
    gl_FragColor = vec4(col, 1.0);
  }
`

/** Sky, fog and sunlight for each act, blended between as the cinematic runs. */
const MOOD = {
  day: { low: '#f0d3a4', high: '#4e86bf', glow: '#ffd9a0', sun: 1, fog: '#cdbb9d', light: 1.9, ambient: 0.85, env: 1, cloud: 1 },
  burn: { low: '#ffa855', high: '#6d4a45', glow: '#fff0c8', sun: 2.6, fog: '#d79a6a', light: 2.2, ambient: 0.8, env: 1.1, cloud: 0.7 },
  ash: { low: '#2b2724', high: '#14120f', glow: '#3a2a20', sun: 0.4, fog: '#211d19', light: 0.16, ambient: 0.1, env: 0.1, cloud: 0.2 },
  night: { low: '#090807', high: '#040404', glow: '#120c08', sun: 0.1, fog: '#070605', light: 0.04, ambient: 0.03, env: 0.02, cloud: 0 },
} as const

type Mood = (typeof MOOD)[keyof typeof MOOD]

/**
 * The sky's uniforms, held at module level for the same reason the hero's stage
 * is: they are written every frame, and a memoised object is not something a
 * render may reach in and change.
 */
const SKY_UNIFORMS = {
  uLow: { value: new Color(MOOD.day.low) },
  uHigh: { value: new Color(MOOD.day.high) },
  uGlow: { value: new Color(MOOD.day.glow) },
  uSun: { value: MOOD.day.sun as number },
  uCloud: { value: MOOD.day.cloud as number },
  uTime: { value: 0 },
}

/** Back to daylight, for a second showing. */
function resetSky(): void {
  SKY_UNIFORMS.uLow.value.set(MOOD.day.low)
  SKY_UNIFORMS.uHigh.value.set(MOOD.day.high)
  SKY_UNIFORMS.uGlow.value.set(MOOD.day.glow)
  SKY_UNIFORMS.uSun.value = MOOD.day.sun
  SKY_UNIFORMS.uCloud.value = MOOD.day.cloud
  SKY_UNIFORMS.uTime.value = 0
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

/**
 * One soft blob, reused by every animal as the patch of shade it stands in.
 *
 * Real shadow maps would cost a pass over a scene that already meshes five
 * species on the way in, and at this distance a contact patch is all that is
 * doing the work: without it the herd looked like it was hovering.
 */
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

/** Where the rock comes in from, and where it stops. */
const ENTRY: readonly [number, number, number] = [-150, 120, -260]

interface CastProps {
  spot: Placed | (typeof FLYERS)[number]
  index: number
  theme: Theme
  bump: number
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
}

function Grazer({ spot, index, theme, bump, beat }: CastProps) {
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
      ;(sh.material as { opacity: number }).opacity = 0.85 - fall * 0.35
    }
  })

  if (!rig) return null
  return (
    <>
      <Body rig={rig} species={place.kind} theme={theme} bump={bump} skin={skin} bodyRef={group} />
      <mesh
        ref={shade}
        position={[place.x, ground + 0.08, place.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-1}
      >
        <planeGeometry args={[place.size * 1.9, place.size * 1.35]} />
        <meshBasicMaterial map={shadowMap} transparent depthWrite={false} opacity={0.85} />
      </mesh>
    </>
  )
}

function Flyer({ spot, index, theme, bump, beat }: CastProps) {
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
    <Body rig={rig} species="pterosaur" theme={theme} bump={bump} skin={MASCOT_SKIN.pterosaur} bodyRef={group} />
  )
}

function Body({
  rig,
  species,
  theme,
  bump,
  skin,
  bodyRef,
}: {
  rig: Rig
  species: AnyCreatureKind
  theme: Theme
  bump: number
  skin: { texScale: number; halfHeight: number; plateMix?: number }
  bodyRef: RefObject<Group | null>
}) {
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton } = rig
  useBind(mesh, skeleton)
  return (
    <group ref={bodyRef} scale={0.0001}>
      <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
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

function Show({ theme, tier }: { theme: Theme; tier: DeviceTier }) {
  const terrain = useTerrain(tier === 'low' ? 48 : tier === 'medium' ? 72 : 96)
  const fleck = useMemo(() => ashFleck(), [])
  const plumeField = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(PLUME_COUNT * 3), 3))
    // It is repositioned from the crater every frame it is visible; without a
    // bounding sphere three culls it while every point still sits at the origin.
    g.boundingSphere = new Sphere(new Vector3(0, 40, -60), 400)
    return g
  }, [])
  const ashField = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(Float32Array.from(ASH_HOME), 3))
    // Same reason as the plume: the flecks climb far above where they start.
    g.boundingSphere = new Sphere(new Vector3(0, 40, -80), 320)
    return g
  }, [])
  /** The rock's heading, and the rotation that lays the trail along it. */
  const [travel, trailTurn] = useMemo(() => {
    const dir = new Vector3(
      GROUND_ZERO[0] - ENTRY[0],
      -ENTRY[1],
      GROUND_ZERO[1] - ENTRY[2],
    ).normalize()
    return [dir, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().negate())]
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
  const beat = useRef<Beat>({ t: 0, act: 'open', u: 0, alarm: 0, dead: 0 })
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

  const rock = useRef<Group>(null)
  const trail = useRef<Mesh>(null)
  const fireball = useRef<Mesh>(null)
  const wave = useRef<Mesh>(null)
  const dust = useRef<Mesh>(null)
  const flash = useRef<Mesh>(null)
  const plume = useRef<Points>(null)
  const ejecta = useRef<Group>(null)
  const ash = useRef<Points>(null)

  useEffect(resetSky, [])

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
    blend(from.low, to.low, mix, SKY_UNIFORMS.uLow.value)
    blend(from.high, to.high, mix, SKY_UNIFORMS.uHigh.value)
    blend(from.glow, to.glow, mix, SKY_UNIFORMS.uGlow.value)
    SKY_UNIFORMS.uSun.value = MathUtils.lerp(from.sun, to.sun, mix)
    SKY_UNIFORMS.uCloud.value = MathUtils.lerp(from.cloud, to.cloud, mix)
    SKY_UNIFORMS.uTime.value = t
    if (state.scene.fog) blend(from.fog, to.fog, mix, (state.scene.fog as Fog).color)
    const key = state.scene.getObjectByName('valley-sun') as { intensity: number } | undefined
    if (key) key.intensity = MathUtils.lerp(from.light, to.light, mix)
    const rim = state.scene.getObjectByName('valley-rim') as { intensity: number } | undefined
    if (rim) rim.intensity = MathUtils.lerp(from.light, to.light, mix) * 0.55
    const fill = state.scene.getObjectByName('valley-fill') as { intensity: number } | undefined
    if (fill) fill.intensity = MathUtils.lerp(from.ambient, to.ambient, mix)
    // The environment is what the hide reflects. Left at full strength it kept
    // the whole valley lit through the dark, sky black over a sunlit floor.
    state.scene.environmentIntensity = MathUtils.lerp(from.env, to.env, mix)

    // --- what the animals know ------------------------------------------------
    beat.current.t = t
    beat.current.act = act
    beat.current.u = u
    beat.current.alarm =
      act === 'streak' ? easeInOut(MathUtils.clamp((u - 0.3) / 0.7, 0, 1)) : act === 'impact' ? 1 : 0
    beat.current.dead =
      act === 'die' ? easeInOut(u) : act === 'dark' || act === 'return' ? 1 : 0

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
    if (r && tr) {
      if (act === 'streak' || (act === 'impact' && u < 0.12)) {
        const fall = act === 'streak' ? easeInOut(u) : 1
        r.position.set(
          MathUtils.lerp(ENTRY[0], GROUND_ZERO[0], fall),
          MathUtils.lerp(ENTRY[1], ground + 2, fall * fall),
          MathUtils.lerp(ENTRY[2], GROUND_ZERO[1], fall),
        )
        r.rotation.set(t * 1.7, t * 2.3, t * 1.1)
        const near = 0.35 + fall * 1.5
        r.scale.setScalar(near)

        // The trail is a cone laid along the flight path with its point at the
        // rock, so it streaks back across the sky instead of hanging where it
        // was authored. Its length is how far the rock has already come.
        const len = 30 + fall * 150
        tr.visible = true
        tr.scale.set(2 + fall * 5, len, 2 + fall * 5)
        tr.quaternion.copy(trailTurn)
        tr.position.copy(r.position).addScaledVector(travel, -len * 0.5)
        ;(tr.material as MeshStandardMaterial).opacity = 0.32 + fall * 0.45
      } else {
        r.scale.setScalar(0.0001)
        tr.visible = false
      }
    }

    // --- what it does when it lands -------------------------------------------
    const fb = fireball.current
    if (fb) {
      const life = act === 'impact' ? u : act === 'die' ? 1 + u * 0.8 : -1
      if (life >= 0 && life < 1.8) {
        const grow = Math.pow(MathUtils.clamp(life, 0, 1.8) / 1.8, 0.55)
        fb.position.set(GROUND_ZERO[0], ground + 3 + grow * 16, GROUND_ZERO[1])
        // Taller than it is wide once it starts climbing, and boiling.
        const boil = 1 + Math.sin(t * 9) * 0.06
        fb.scale.set((3 + grow * 12) * boil, (3 + grow * 21) / boil, 3 + grow * 12)
        fb.rotation.set(t * 0.4, t * 0.6, 0)
        ;(fb.material as MeshBasicMaterial).opacity = Math.max(0, 1 - grow * 1.25)
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
        ;(pl.material as MeshBasicMaterial).opacity = Math.min(0.34, grow * 0.7)
        const pos = pl.geometry.attributes.position as BufferAttribute
        for (let i = 0; i < PLUME_COUNT; i++) {
          const dx = PLUME_SEED[i * 4] ?? 0
          const dz = PLUME_SEED[i * 4 + 1] ?? 0
          const rise = PLUME_SEED[i * 4 + 2] ?? 1
          const age = Math.max(0, grow - (PLUME_SEED[i * 4 + 3] ?? 0))
          // It widens as it climbs, which is the only thing that makes a column
          // of smoke read as one rather than as a puff.
          const spread = 7 + age * 62 * (0.35 + rise * 0.65)
          pos.setXYZ(
            i,
            GROUND_ZERO[0] + dx * spread + Math.sin(t * 0.4 + i) * 2,
            ground + 3 + rise * age * 76,
            GROUND_ZERO[1] + dz * spread,
          )
        }
        pos.needsUpdate = true
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
      {/* Far enough back that the ridge at the end of the valley still reads. */}
      <fog attach="fog" args={[MOOD.day.fog, 95, 400]} />
      {/* The hide is a physical material: with no environment to reflect it goes
          to near-black, and the whole herd came out as silhouettes. */}
      <ThemedEnvironment theme={theme} resolution={64} />
      <hemisphereLight name="valley-fill" args={['#d7e6f4', '#6b573c', MOOD.day.ambient]} />
      {/* Key from the camera's side so the animals are lit rather than backlit,
          with a low warm rim behind for the hour of the day. */}
      <directionalLight name="valley-sun" position={[-42, 34, 26]} intensity={MOOD.day.light} color="#ffe3bc" />
      <directionalLight name="valley-rim" position={[-56, 12, -86]} intensity={MOOD.day.light * 0.55} color="#ffb877" />

      <mesh scale={300}>
        <sphereGeometry args={[1, 32, 24]} />
        <shaderMaterial
          vertexShader={SKY_VERT}
          fragmentShader={SKY_FRAG}
          side={BackSide}
          depthWrite={false}
          uniforms={SKY_UNIFORMS}
        />
      </mesh>

      <mesh geometry={terrain} receiveShadow={false}>
        <meshStandardMaterial vertexColors roughness={0.97} metalness={0} />
      </mesh>

      {cast.map((spot, i) => (
        <Grazer key={i} spot={spot} index={i} theme={theme} bump={bump} beat={beat} />
      ))}
      {wings.map((spot, i) => (
        <Flyer key={i} spot={spot} index={i} theme={theme} bump={bump} beat={beat} />
      ))}

      <group ref={rock} scale={0.0001}>
        <mesh>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color="#3a2f27" roughness={0.9} emissive="#ff7a2a" emissiveIntensity={1.6} flatShading />
        </mesh>
      </group>
      <mesh ref={trail} position={[-70, 60, -170]} rotation={[0, 0, -0.9]} visible={false}>
        <coneGeometry args={[1.2, 1, 12, 1, true]} />
        <meshStandardMaterial
          color="#ffb469"
          emissive="#ff8a3c"
          emissiveIntensity={2.4}
          transparent
          opacity={0.6}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <mesh ref={fireball} visible={false}>
        {/* Low-poly on purpose: additive hides the facets but keeps the
            silhouette from being a perfect egg. */}
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="#ff6a12"
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* The column that goes up after it, and spreads. */}
      <points ref={plume} geometry={plumeField} visible={false}>
        <pointsMaterial
          size={11}
          map={fleck}
          color="#3a3128"
          transparent
          opacity={0}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      <mesh ref={wave} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.82, 1, 96]} />
        <meshBasicMaterial
          color="#e3cda6"
          transparent
          opacity={0}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Thrown out of the crater and back down again. */}
      <group ref={ejecta} visible={false}>
        {EJECTA.map((_, i) => (
          <mesh key={i}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              color="#4a3a2c"
              emissive="#ff7028"
              emissiveIntensity={2.2}
              roughness={0.9}
              flatShading
            />
          </mesh>
        ))}
      </group>

      {/* What is still coming down long after. */}
      <points ref={ash} geometry={ashField} visible={false}>
        <pointsMaterial
          size={1.15}
          map={fleck}
          color="#9c9084"
          transparent
          opacity={0}
          depthWrite={false}
          sizeAttenuation
        />
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
      camera={{ position: [0, 12, 42], fov: 46, near: 0.5, far: 600 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false }}
    >
      <Show theme={theme} tier={tier} />
    </Canvas>
  )
}
