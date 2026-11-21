import { BufferAttribute, CanvasTexture, CylinderGeometry, MathUtils, PlaneGeometry, SRGBColorSpace, type BufferGeometry } from 'three'
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
 * fern's frond and the conifers' needles are drawn on canvases. (The grass
 * between them is not planted at all; see `valleyGrass.ts`.)
 *
 * Everything here is built once and kept. The warm-up fills the caches while
 * the page is idle; the scene reads them on the click and mounts in a frame.
 */

/* -------------------------------------------------------------------------- */
/* Conifers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The conifers are built the way real-time trees are: a trunk, and branches
 * that are cards — crossed pairs of quads carrying a spray of needles drawn on
 * a canvas, alpha-tested, so the crown has a ragged edge and sky through it
 * rather than the stacked cones it used to be, which read as plastic
 * lampshades from any distance. Three things make a heap of cards read as one
 * crown: every card takes the crown's own outward normal instead of its flat
 * one, so the mass shades from lit to shadowed side the way foliage does;
 * vertex colour darkens towards the trunk and the bottom of the crown, where
 * little light gets in; and each branch is a little lighter or darker than
 * the next.
 */

/**
 * Where things are on the needle texture, along u. Bark on the left, the spray
 * from a little past it to the right-hand edge: as a card shrinks with
 * distance its texture is read from coarser and coarser mips, where
 * neighbouring regions run together, and with the bark beside the tip every
 * distant branch ended in a brown smudge. Beside the base, where the branch
 * meets the trunk deep in the crown's shade, nobody can see it.
 */
const SPRAY_U = [0.22, 1] as const
const BARK_U = [0.01, 0.14] as const

/** A grey per vertex: the vertex colour multiplies the texture, so this is light and shade. */
function grey(geometry: BufferGeometry, value: (x: number, y: number, z: number, i: number) => number): BufferGeometry {
  const pos = geometry.attributes.position as BufferAttribute
  const out = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) out.fill(value(pos.getX(i), pos.getY(i), pos.getZ(i), i), i * 3, i * 3 + 3)
  geometry.setAttribute('color', new BufferAttribute(out, 3))
  return geometry
}

/** Maps a geometry's u onto the bark strip of the needle texture. */
function onBark(geometry: BufferGeometry): BufferGeometry {
  const uv = geometry.attributes.uv as BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setX(i, BARK_U[0] + uv.getX(i) * (BARK_U[1] - BARK_U[0]))
  return geometry
}

/**
 * One spray of needles on a card that runs out along +x from the trunk.
 * `upright` stands it on edge, so a crossed pair reads from the side as well
 * as from below. It droops along its length and curls up at the tip, and it
 * is darker where it meets the trunk.
 */
function card(length: number, width: number, droop: number, curl: number, upright: boolean, tone: number): BufferGeometry {
  const g = new PlaneGeometry(length, width, 3, 1)
  g.translate(length / 2, 0, 0)
  if (!upright) g.rotateX(-Math.PI / 2)
  const pos = g.attributes.position as BufferAttribute
  const uv = g.attributes.uv as BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getX(i) / length
    pos.setY(i, pos.getY(i) + length * (curl * s * s * s - droop * s * s))
    uv.setX(i, SPRAY_U[0] + s * (SPRAY_U[1] - SPRAY_U[0]))
  }
  return grey(g, (x) => tone * (0.42 + 0.58 * Math.pow(Math.max(0, x / length), 0.7)))
}

/** The wood of a branch, out along +x and thinning, in the shade of its own needles. */
function limb(length: number, radius: number, tone: number): BufferGeometry {
  const g = new CylinderGeometry(radius * 0.4, radius, length, 5, 1, true)
  g.rotateZ(-Math.PI / 2)
  g.translate(length / 2, 0, 0)
  return grey(onBark(g), () => tone * 0.6)
}

/** Every vertex's normal pointing out of the crown — an ellipsoid round the trunk — and a little up. */
function crownNormals(geometry: BufferGeometry, centre: number, squash: number): void {
  const pos = geometry.attributes.position as BufferAttribute
  const nor = geometry.attributes.normal as BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = (pos.getY(i) - centre) * squash
    const z = pos.getZ(i)
    const len = Math.hypot(x, y, z) || 1
    const nx = x / len
    const ny = y / len + 0.35
    const nz = z / len
    const l = Math.hypot(nx, ny, nz) || 1
    nor.setXYZ(i, nx / l, ny / l, nz / l)
  }
}

interface BranchSpec {
  length: number
  width: number
  droop: number
  curl: number
  /** Up from level, in radians. */
  pitch: number
  /** Round the trunk, in radians. */
  yaw: number
  y: number
  tone: number
  /** Radius of the wood at the trunk; 0 for none. */
  limb: number
}

function branch(spec: BranchSpec, crown: { centre: number; squash: number }): BufferGeometry[] {
  const leaves = [
    card(spec.length, spec.width, spec.droop, spec.curl, false, spec.tone),
    card(spec.length, spec.width * 0.62, spec.droop, spec.curl, true, spec.tone),
  ]
  const parts = spec.limb > 0 ? [...leaves, limb(spec.length * 0.7, spec.limb, spec.tone)] : leaves
  for (const part of parts) {
    part.rotateZ(spec.pitch)
    part.rotateY(spec.yaw)
    part.translate(0, spec.y, 0)
  }
  for (const leaf of leaves) crownNormals(leaf, crown.centre, crown.squash)
  return parts
}

function bole(top: number, base: number, height: number, crownFrom: number): BufferGeometry {
  const g = new CylinderGeometry(top, base, height, 8, 4, true)
  g.translate(0, height / 2, 0)
  // In the crown's shade above where the branches start.
  return grey(onBark(g), (_x, y) => 0.6 + 0.4 * (1 - smoothstep(crownFrom - 2, crownFrom + 3, y)))
}

/**
 * The araucaria: a tall bare trunk and a flat-topped crown of horizontal
 * whorls, the branches turned up at the ends — the silhouette that reads as
 * that period to anyone.
 */
function araucaria(): BufferGeometry {
  const crown = { centre: 14, squash: 1.8 }
  const parts: BufferGeometry[] = [bole(0.2, 0.62, 17.8, 10.4)]
  const whorls = 7
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1)
    const n = w < 2 ? 7 : w > 4 ? 5 : 6
    for (let b = 0; b < n; b++) {
      const seed = w * 17 + b
      const length = MathUtils.lerp(6.8, 2.2, Math.pow(t, 1.1)) * (0.86 + 0.28 * hash2(seed, 901))
      parts.push(
        ...branch(
          {
            length,
            width: length * 0.42 + 0.7,
            droop: 0.1,
            curl: 0.16,
            pitch: MathUtils.lerp(0.02, 0.34, t) + (hash2(seed, 902) - 0.5) * 0.14,
            yaw: (b / n) * Math.PI * 2 + w * 0.55 + (hash2(seed, 903) - 0.5) * 0.35,
            y: 10.4 + t * 6.8,
            tone: (0.78 + 0.22 * t) * (0.88 + 0.24 * hash2(seed, 904)),
            limb: 0.12,
          },
          crown,
        ),
      )
    }
  }
  // The leader: a few short sprays turned up at the very top.
  for (let b = 0; b < 4; b++) {
    parts.push(...branch({ length: 1.8, width: 1.3, droop: 0, curl: 0.1, pitch: 0.95, yaw: b * 1.57 + 0.4, y: 17.3, tone: 1, limb: 0 }, crown))
  }
  return mergeGeometries(parts, false) as BufferGeometry
}

/**
 * A conical conifer: whorls all the way down a shorter trunk, the lower
 * branches long and sweeping down, the upper ones short and reaching up.
 */
function spire(): BufferGeometry {
  const crown = { centre: 6.5, squash: 0.7 }
  const parts: BufferGeometry[] = [bole(0.16, 0.5, 13.9, 2.3)]
  const whorls = 11
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1)
    const n = t > 0.75 ? 5 : 6
    for (let b = 0; b < n; b++) {
      const seed = 500 + w * 13 + b
      const length = MathUtils.lerp(4.5, 0.8, Math.pow(t, 0.85)) * (0.85 + 0.3 * hash2(seed, 911))
      parts.push(
        ...branch(
          {
            length,
            width: length * 0.5 + 0.45,
            droop: MathUtils.lerp(0.2, 0.03, t),
            curl: 0.07,
            pitch: MathUtils.lerp(-0.24, 0.42, t) + (hash2(seed, 912) - 0.5) * 0.1,
            yaw: (b / n) * Math.PI * 2 + w * 0.9 + (hash2(seed, 913) - 0.5) * 0.4,
            y: 2.3 + t * 10.8,
            tone: (0.72 + 0.28 * t) * (0.88 + 0.24 * hash2(seed, 914)),
            limb: 0,
          },
          crown,
        ),
      )
    }
  }
  for (let b = 0; b < 3; b++) {
    parts.push(...branch({ length: 1.5, width: 1.1, droop: 0, curl: 0.05, pitch: 1.25, yaw: b * 2.1, y: 13.3, tone: 1, limb: 0 }, crown))
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

/**
 * Fronds take the crown's normal, out and up from where they spring, like the
 * conifers' cards: a bent plane's own normal faces down on half of every
 * frond, and lit by it a field of ferns was black.
 */
function fronds(parts: BufferGeometry[], centre: number, squash: number): BufferGeometry[] {
  for (const part of parts) crownNormals(part, centre, squash)
  return parts
}

function treeFern(): BufferGeometry {
  const stem = new CylinderGeometry(0.22, 0.36, 3.6, 7, 1, false)
  stem.translate(0, 1.8, 0)
  const parts = [barkUv(stem), ...fronds([...crown(9, 3.3, 0.95, 1.6, 0.95, 3.5, 900), ...crown(4, 2.2, 0.8, 1.2, 0.4, 3.6, 950)], 3.1, 1.2)]
  return mergeGeometries(parts, false) as BufferGeometry
}

function groundFern(): BufferGeometry {
  const parts = fronds([...crown(7, 1.8, 0.6, 1.5, 0.85, 0.05, 1200), ...crown(3, 1.2, 0.5, 1.2, 0.45, 0.08, 1250)], -0.8, 1)
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
    const lit = 26 + hash2(k, 5) * 11
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

let needleTexture: CanvasTexture | null = null

/**
 * A spray of conifer needles, drawn along the texture's width the way a card
 * runs along a branch: a twig, branchlets either side angled forward and
 * shortening towards the tip, and needles both sides of every branchlet — old
 * and dark in towards the twig, fresh and lighter at the ends. Bark at the far
 * end of the texture, with the rings of scars an araucaria trunk has, so the
 * trunks share the material.
 */
export function needles(): CanvasTexture | null {
  if (needleTexture) return needleTexture
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, 512, 256)
  const left = 512 * SPRAY_U[0]
  const right = 512 * SPRAY_U[1]
  const cy = 128
  ctx.save()
  ctx.beginPath()
  ctx.rect(left, 0, right - left, 256)
  ctx.clip()
  ctx.lineCap = 'round'

  // The twig.
  ctx.strokeStyle = 'rgb(62, 50, 34)'
  for (let i = 0; i < 12; i++) {
    const a = i / 12
    const b = (i + 1) / 12
    ctx.lineWidth = 5 - 3 * a
    ctx.beginPath()
    ctx.moveTo(left + a * (right - left - 40), cy + Math.sin(a * 3) * 4)
    ctx.lineTo(left + b * (right - left - 40), cy + Math.sin(b * 3) * 4)
    ctx.stroke()
  }

  const count = 30
  for (let i = 0; i < count; i++) {
    const s = (i + 0.5) / count
    const x0 = left + 2 + s * (right - left - 44)
    const y0 = cy + Math.sin(s * 3) * 4
    for (const side of [-1, 1]) {
      const k = i * 2 + (side > 0 ? 1 : 0)
      const width = (0.45 + 0.55 * Math.min(1, s / 0.3)) * (1 - 0.6 * Math.pow(s, 1.5))
      const reach = 116 * width * (0.8 + 0.35 * hash2(k, 11))
      const angle = (0.85 + 0.3 * hash2(k, 12)) * side
      // The branchlet, bending forward towards its end.
      const steps = Math.max(3, Math.round(reach / 4.5))
      let px = x0
      let py = y0
      for (let j = 0; j < steps; j++) {
        const f = j / steps
        const bend = f * 0.5 * side
        const ux = Math.cos(angle - bend)
        const uy = Math.sin(angle - bend)
        const nx = px + ux * (reach / steps)
        const ny = py + uy * (reach / steps)
        ctx.strokeStyle = `rgb(${54 + f * 20}, ${58 + f * 26}, 30)`
        ctx.lineWidth = 2.4 - f
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(nx, ny)
        ctx.stroke()
        // Needles both sides, swept forward along the branchlet.
        const len = (13 - 5 * f) * (0.85 + 0.3 * hash2(k * 40 + j, 13))
        const light = 15 + f * 17 + hash2(k * 40 + j, 14) * 6
        ctx.strokeStyle = `hsl(${96 + f * 10 + hash2(k * 40 + j, 15) * 10}, ${38 + f * 10}%, ${light}%)`
        ctx.lineWidth = 2
        for (const s2 of [-1, 1]) {
          ctx.beginPath()
          ctx.moveTo(nx, ny)
          ctx.lineTo(nx + (ux * 0.55 - uy * 0.83 * s2) * len, ny + (uy * 0.55 + ux * 0.83 * s2) * len)
          ctx.stroke()
        }
        px = nx
        py = ny
      }
    }
  }
  ctx.restore()

  // Bark: grey-brown, fissured, ringed with old branch scars.
  const bark = 512 * BARK_U[1] + 4
  ctx.fillStyle = 'rgb(82, 72, 62)'
  ctx.fillRect(0, 0, bark, 256)
  for (let i = 0; i < 46; i++) {
    ctx.fillStyle = `rgba(${26 + hash2(i, 31) * 30}, ${20 + hash2(i, 32) * 22}, 14, ${0.35 + hash2(i, 33) * 0.4})`
    ctx.fillRect(hash2(i, 34) * bark, hash2(i, 35) * 256, 1 + hash2(i, 36) * 2, 12 + hash2(i, 37) * 46)
  }
  for (let y = 6; y < 256; y += 14 + hash2(y, 38) * 8) {
    ctx.fillStyle = `rgba(36, 28, 20, ${0.35 + hash2(y, 39) * 0.25})`
    ctx.fillRect(0, y, bark, 2)
    ctx.fillStyle = 'rgba(150, 130, 110, 0.18)'
    ctx.fillRect(0, y + 2, bark, 1)
  }

  needleTexture = new CanvasTexture(canvas)
  needleTexture.colorSpace = SRGBColorSpace
  needleTexture.anisotropy = 4
  return needleTexture
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
    kind === 'umbrella' ? araucaria() : kind === 'tiered' ? spire() : kind === 'treeFern' ? treeFern() : groundFern()
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
    needles()
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

