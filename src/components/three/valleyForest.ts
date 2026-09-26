import {
  BufferAttribute,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  PlaneGeometry,
  SRGBColorSpace,
  type BufferGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { HERD } from './valleyCast'
import { LAKE, fbm, hash2, scatter, smoothstep, type ScatterRule, type Spot } from './valleyLand'

/**
 * What grows in the valley: the shapes, the leaf, and where each kind goes.
 *
 * Jurassic ground cover was ferns and cycads; the trees were conifers, and the
 * ones that read as *that period* to anyone are the araucarias — a bare trunk
 * with an umbrella of branches at the top. There are two conifer shapes, a
 * tree fern and a ground fern, each authored once as a single merged geometry
 * and planted hundreds of times by `valleyFlora.tsx`. Nothing is loaded: the
 * leaf is drawn on a canvas.
 *
 * Everything here is built once and kept. The warm-up fills the caches while
 * the page is idle; the scene reads them on the click and mounts in a frame.
 */

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

function withColour(geometry: BufferGeometry, colour: Color, vary = 0): BufferGeometry {
  const count = geometry.attributes.position?.count ?? 0
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const v = 1 + (hash2(i, 77) - 0.5) * vary
    out[i * 3] = colour.r * v
    out[i * 3 + 1] = colour.g * v
    out[i * 3 + 2] = colour.b * v
  }
  geometry.setAttribute('color', new BufferAttribute(out, 3))
  return geometry
}

/** Breaks the perfect circle of a cone's rim, so the tiers do not read as lampshades. */
function roughen(geometry: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const pos = geometry.attributes.position as BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const r = Math.hypot(x, z)
    if (r < 1e-4) continue
    const k = 1 + (hash2(i, seed) - 0.5) * amount
    pos.setX(i, x * k)
    pos.setZ(i, z * k)
    pos.setY(i, pos.getY(i) + (hash2(i, seed + 1) - 0.5) * amount * 0.6)
  }
  geometry.computeVertexNormals()
  return geometry
}

const BARK = new Color('#4a3626')

function trunk(top: number, base: number, height: number, colour = BARK): BufferGeometry {
  const g = new CylinderGeometry(top, base, height, 7, 1, false)
  g.translate(0, height / 2, 0)
  return withColour(g, colour, 0.25)
}

/** A tall bare trunk with the crown held high — the araucaria silhouette. */
function coniferUmbrella(): BufferGeometry {
  const parts: BufferGeometry[] = [trunk(0.26, 0.62, 17)]
  const crown = new Color('#213d22')
  // A wide crown, or from the valley floor the tree is a matchstick.
  const tiers: [number, number, number][] = [
    [10.6, 6.8, 2.8],
    [12.4, 6.0, 2.7],
    [14.1, 4.9, 2.5],
    [15.7, 3.5, 2.3],
    [17.1, 1.9, 2.0],
  ]
  tiers.forEach(([y, r, h], i) => {
    const c = new ConeGeometry(r, h, 9, 1, false)
    c.translate(0, y + h / 2, 0)
    parts.push(withColour(roughen(c, 0.28, 300 + i * 7), crown.clone().offsetHSL(0, 0, i * 0.02), 0.2))
  })
  return mergeGeometries(parts, false) as BufferGeometry
}

/** The classic stacked cone, darker and denser at the bottom. */
function coniferTiered(): BufferGeometry {
  const parts: BufferGeometry[] = [trunk(0.2, 0.55, 12.5)]
  const low = new Color('#1c3319')
  const high = new Color('#33532b')
  const n = 7
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const y = 3 + i * 1.55
    const r = 3.4 * Math.pow(1 - t, 0.85) + 0.5
    const h = 2.6
    const c = new ConeGeometry(r, h, 9, 1, false)
    c.translate(0, y + h / 2, 0)
    parts.push(withColour(roughen(c, 0.3, 500 + i * 7), low.clone().lerp(high, t), 0.2))
  }
  return mergeGeometries(parts, false) as BufferGeometry
}

/**
 * One frond: a plane bent along its length into an arch that rises and then
 * droops. `u` is squeezed into the left three quarters of the texture, where
 * the leaf is drawn; the right quarter is bark, for trunks that share the map.
 */
function frond(length: number, width: number, arc: number): BufferGeometry {
  const g = new PlaneGeometry(width, length, 1, 7)
  const pos = g.attributes.position as BufferAttribute
  const uv = g.attributes.uv as BufferAttribute
  const R = length / arc
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + length / 2) / length
    const a = t * arc
    pos.setXYZ(i, pos.getX(i) * (1 - t * 0.25), R * Math.sin(a), R * (1 - Math.cos(a)))
    uv.setX(i, uv.getX(i) * 0.75)
  }
  g.computeVertexNormals()
  return g
}

function crown(
  count: number,
  length: number,
  width: number,
  arc: number,
  tilt: number,
  y: number,
  seed: number,
): BufferGeometry[] {
  const out: BufferGeometry[] = []
  for (let k = 0; k < count; k++) {
    const f = frond(length * (0.85 + hash2(k, seed) * 0.3), width, arc)
    f.rotateX(tilt + (hash2(k, seed + 1) - 0.5) * 0.3)
    f.rotateY((k / count) * Math.PI * 2 + (hash2(k, seed + 2) - 0.5) * 0.5)
    f.translate(0, y, 0)
    out.push(f)
  }
  return out
}

/** Bark strip of the shared leaf texture: the right quarter of `u`. */
function barkUv(geometry: BufferGeometry): BufferGeometry {
  const uv = geometry.attributes.uv as BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setX(i, 0.78 + uv.getX(i) * 0.2)
  return geometry
}

function treeFern(): BufferGeometry {
  const stem = new CylinderGeometry(0.22, 0.36, 3.6, 7, 1, false)
  stem.translate(0, 1.8, 0)
  const parts = [barkUv(stem), ...crown(9, 3.3, 0.95, 1.6, 0.95, 3.5, 900), ...crown(4, 2.2, 0.8, 1.2, 0.4, 3.6, 950)]
  return mergeGeometries(parts, false) as BufferGeometry
}

function groundFern(): BufferGeometry {
  const parts = [...crown(7, 1.8, 0.6, 1.5, 0.85, 0.05, 1200), ...crown(3, 1.2, 0.5, 1.2, 0.45, 0.08, 1250)]
  return mergeGeometries(parts, false) as BufferGeometry
}

/* -------------------------------------------------------------------------- */
/* The leaf                                                                    */
/* -------------------------------------------------------------------------- */

let leafTexture: CanvasTexture | null = null

/**
 * A pinnate frond drawn on a canvas: a rachis with leaflets either side that
 * shorten towards the tip. Alpha outside the leaf, so the plane it is mapped
 * onto reads as a leaf rather than as a green rectangle. The right quarter is
 * bark, so a trunk can share the material.
 */
export function leaf(): CanvasTexture | null {
  if (leafTexture) return leafTexture
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, 128, 256)

  const cx = 48
  ctx.strokeStyle = 'rgb(84, 98, 46)'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, 252)
  ctx.lineTo(cx, 6)
  ctx.stroke()

  for (let k = 0; k < 24; k++) {
    const y = 246 - k * 10.2
    const len = 5 + 36 * Math.pow(1 - k / 26, 0.8)
    const lit = 22 + hash2(k, 5) * 10
    ctx.fillStyle = `hsl(${96 + hash2(k, 9) * 10}, 42%, ${lit}%)`
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx, y + 2)
      ctx.lineTo(cx + side * len * 0.55, y - len * 0.42)
      ctx.lineTo(cx + side * len, y - len * 0.62)
      ctx.lineTo(cx + side * len * 0.6, y - len * 0.2)
      ctx.closePath()
      ctx.fill()
    }
  }

  // Bark, streaked.
  ctx.fillStyle = 'rgb(74, 56, 38)'
  ctx.fillRect(98, 0, 30, 256)
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${30 + hash2(i, 31) * 40}, ${22 + hash2(i, 32) * 30}, 14, ${0.35 + hash2(i, 33) * 0.4})`
    const x = 98 + hash2(i, 34) * 30
    ctx.fillRect(x, hash2(i, 35) * 256, 1 + hash2(i, 36) * 2, 10 + hash2(i, 37) * 40)
  }

  leafTexture = new CanvasTexture(canvas)
  leafTexture.colorSpace = SRGBColorSpace
  leafTexture.anisotropy = 4
  return leafTexture
}

/* -------------------------------------------------------------------------- */
/* Planting                                                                    */
/* -------------------------------------------------------------------------- */

export type Kind = 'umbrella' | 'tiered' | 'treeFern' | 'fern'
const KINDS: readonly Kind[] = ['umbrella', 'tiered', 'treeFern', 'fern']

const COUNTS = {
  high: { umbrella: 90, tiered: 95, treeFern: 90, fern: 720 },
  medium: { umbrella: 60, tiered: 65, treeFern: 60, fern: 380 },
  low: { umbrella: 26, tiered: 30, treeFern: 30, fern: 180 },
} as const

/** Nothing grows through an animal. */
const clear = (x: number, z: number, margin: number) => HERD.every((h) => Math.hypot(x - h.x, z - h.z) > margin)

// Conifers keep to the slopes and the head of the valley; the floor stays
// open, which is what makes it a valley.
const conifer = (x: number, z: number, y: number, slope: number) => {
  if (y > 44 || slope > 0.55 || z > 26) return 0
  const side = smoothstep(26, 60, Math.abs(x))
  const back = smoothstep(-100, -150, z)
  const where = Math.max(side, back)
  if (where < 0.05) return 0
  // Thicker in the stands the noise picks out, but never bare.
  return where * (0.3 + 0.7 * smoothstep(0.3, 0.6, fbm(x * 0.02 + 3, z * 0.02 + 1, 2)))
}
const TREE_BOUNDS = { x: [-165, 165] as [number, number], z: [-270, 26] as [number, number] }

const RULES: Record<Kind, (tier: DeviceTier) => ScatterRule> = {
  umbrella: (tier) => ({ count: COUNTS[tier].umbrella, seed: 11, bounds: TREE_BOUNDS, accept: conifer, scale: [0.85, 1.4] }),
  tiered: (tier) => ({ count: COUNTS[tier].tiered, seed: 23, bounds: TREE_BOUNDS, accept: conifer, scale: [0.8, 1.35] }),
  treeFern: (tier) => ({
    count: COUNTS[tier].treeFern,
    seed: 37,
    bounds: { x: [-90, 90], z: [-160, 14] },
    accept: (x, z, y, slope) => {
      if (y > 22 || slope > 0.5 || !clear(x, z, 9)) return 0
      const q = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r
      const shore = q > 1.08 && q < 2.1 ? 1 : 0.2
      const side = smoothstep(18, 42, Math.abs(x)) * 0.6
      return Math.max(shore, side)
    },
    scale: [0.7, 1.3],
  }),
  fern: (tier) => ({
    count: COUNTS[tier].fern,
    seed: 53,
    bounds: { x: [-110, 110], z: [-165, 15] },
    accept: (x, z, y, slope) => {
      if (y > 30 || slope > 0.6 || !clear(x, z, 5)) return 0
      // Thick in the foreground, where they frame the shot.
      const near = smoothstep(-30, 10, z) * 0.9
      return 0.3 + 0.7 * smoothstep(0.3, 0.7, fbm(x * 0.05, z * 0.05, 2)) + near
    },
    scale: [0.9, 2.2],
  }),
}

/**
 * The forest, built once and kept. The warm-up fills these while the page is
 * idle; the scene reads them on the click and mounts in a frame.
 */
const GEOMETRY: Partial<Record<Kind, BufferGeometry>> = {}
const SPOTS = new Map<string, Spot[]>()

export function geometryFor(kind: Kind): BufferGeometry {
  const have = GEOMETRY[kind]
  if (have) return have
  const built =
    kind === 'umbrella' ? coniferUmbrella() : kind === 'tiered' ? coniferTiered() : kind === 'treeFern' ? treeFern() : groundFern()
  GEOMETRY[kind] = built
  return built
}

export function spotsFor(tier: DeviceTier, kind: Kind): Spot[] {
  const key = `${tier}:${kind}`
  const have = SPOTS.get(key)
  if (have) return have
  const built = scatter(RULES[kind](tier))
  SPOTS.set(key, built)
  return built
}

/** One species per slice, so the warm-up never holds the page for long. */
export function prepareFlora(tier: DeviceTier, schedule: (fn: () => void) => void): Promise<void> {
  const slice = (fn: () => void) =>
    new Promise<void>((done) => {
      schedule(() => {
        fn()
        done()
      })
    })
  let chain = slice(() => {
    leaf()
  })
  for (const kind of KINDS) {
    chain = chain.then(() =>
      slice(() => {
        geometryFor(kind)
        spotsFor(tier, kind)
      }),
    )
  }
  return chain
}

