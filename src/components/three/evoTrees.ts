import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Mesh,
  Object3D,
  OneFactor,
  ShaderMaterial,
  SrcColorFactor,
  Vector3,
  ZeroFactor,
} from 'three'
import { AIR_PARS, EVO_NOISE, type Air } from './evoAir'
import { SUN_SHADOW_GLSL, createSunShadow } from './evoSunShadow'
import { hash2 } from './evoLand'
import { CITY_FROM, CITY_LIGHT_GLSL, CITY_UNTIL, STREET_GLSL, STREET_Z, TREE_CROWN, TREE_PIT, treeSpots, type TreeSpot } from './evoStreet'
import type { Beat, Part } from './evoWalk'

/**
 * The street's trees: old planes, the *chinor* Tashkent is planted with. A
 * stout trunk, limed white to the height of a man's chest; the bark above it
 * coming off in plates, cream and olive and grey; three to five boughs going
 * up out of a fork, and a crown.
 *
 * The crown is cards — flat squares with a handful of leaves drawn on each —
 * hung round some twenty rough balls that carry the same leaves, darker. The cards
 * are what is seen; the balls are what stops the sky being seen through them
 * from a distance, where there are too few cards a pixel to close the crown by
 * themselves. A ball of plain green would do that too, and show through the
 * cards as a boulder.
 *
 * Nothing here is lit by three's lights. A material that is has a program for
 * each number of lamps in the scene, and the walk has three of those; these
 * have one, take the sun and the sky as two colours, and work out the street
 * lamps from where the street says they are.
 *
 * One pattern tree is round. A tree on a kerb has its crown pressed narrower
 * across the street, where the fronts are, and pushed out over the road: that
 * is done to each tree as it is drawn, so the same three patterns stand on a
 * kerb or in the open.
 *
 * And a tree brings its ground with it: the square of earth it stands in, and
 * the shade of its crown, both laid over whatever is paved there. The street
 * does not know where the trees are; plant one anywhere `treeSpots()` says
 * and it has both.
 */

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)
const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

type V3 = [number, number, number]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const times = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V3): V3 => {
  const length = Math.hypot(a[0], a[1], a[2])
  return length > 1e-9 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 1, 0]
}

/** A small seeded generator: the same trees every visit. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ----------------------------------------------------------------- pattern

/** One tree to copy: where it forks, and into how many boughs besides the one that goes on up. */
export interface TreePattern {
  seed: number
  fork: number
  boughs: number
}

export const TREE_PATTERNS: readonly TreePattern[] = [
  { seed: 11, fork: 3.7, boughs: 4 },
  { seed: 23, fork: 4.3, boughs: 5 },
  { seed: 37, fork: 4.0, boughs: 3 },
]

/** Leaf cards on a tree with all of its leaves. */
export const TREE_CARDS = 1300

/**
 * The room a crown has, as the pattern has it: round, `TREE_CROWN.along` out
 * from the trunk every way, and widest two fifths of the way up — a dome, not
 * a ball on a stick.
 */
const REACH = TREE_CROWN.along
const BASE = TREE_CROWN.from
const TOP = TREE_CROWN.top
const WAIST = BASE + (TOP - BASE) * 0.42
/** How much narrower a kerb tree's crown is across the street than along it. */
export const KERB_SQUASH = TREE_CROWN.across / TREE_CROWN.along

/**
 * How far out of the middle of that room a point is: 1 on its edge. `squash`
 * narrows the room along z. Below its waist the room is nearly a drum, with a
 * flat underside at the height the street needs clear; above, a dome.
 */
const within = (x: number, y: number, z: number, squash = 1): number => {
  const v = Math.abs(y - WAIST) / (y < WAIST ? WAIST - BASE : TOP - WAIST)
  const h = Math.hypot(x / REACH, z / (REACH * squash))
  const power = y < WAIST ? 6 : 2.2
  return (h ** power + v ** power) ** (1 / power)
}

export interface TreeMesh {
  fork: number
  /** How many cards of leaves. */
  leaves: number
  wood: { positions: Float32Array; normals: Float32Array; indices: Uint16Array }
  crown: {
    /** Where a card is — all four of its corners say the same — or a point of the mass inside. */
    positions: Float32Array
    /** Which way the crown faces there, which is what the card is lit by. */
    normals: Float32Array
    /** A card's two half sides. For the mass, the way out of its ball, and its place on the map its leaves are set out by. */
    across: Float32Array
    up: Float32Array
    corners: Float32Array
    /** A seed; how open to the sky, 0 to 1; 1 for a card and 0 for the mass; a tone. */
    cards: Float32Array
    indices: Uint16Array
  }
}

interface Wood {
  positions: number[]
  indices: number[]
}

/**
 * A limb: rings of `sides` points round a path, each ring as big as `radii`
 * says. The frame is carried from one ring to the next, so it never twists.
 */
function tube(wood: Wood, path: readonly V3[], radii: readonly number[], sides: number, swell?: (ring: number, angle: number) => number): void {
  const first = wood.positions.length / 3
  let normal: V3 = [1, 0, 0]
  for (let i = 0; i < path.length; i++) {
    const here = path[i]!
    const along = unit(sub(path[Math.min(path.length - 1, i + 1)]!, path[Math.max(0, i - 1)]!))
    normal = i === 0 ? unit(cross(Math.abs(along[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], along)) : unit(sub(normal, times(along, dot(normal, along))))
    const side = cross(along, normal)
    for (let j = 0; j < sides; j++) {
      const angle = (j / sides) * Math.PI * 2
      const r = radii[i]! * (swell ? swell(i, angle) : 1)
      const c = Math.cos(angle) * r
      const s = Math.sin(angle) * r
      wood.positions.push(here[0] + normal[0] * c + side[0] * s, here[1] + normal[1] * c + side[1] * s, here[2] + normal[2] * c + side[2] * s)
    }
  }
  for (let i = 0; i < path.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = first + i * sides + j
      const b = first + i * sides + ((j + 1) % sides)
      wood.indices.push(a, b, a + sides, b, b + sides, a + sides)
    }
  }
}

/** Normals from the faces round each point, weighted by their size. */
function smoothNormals(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const normals = new Float32Array(positions.length)
  const at = (i: number): V3 => [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!]
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!
    const b = indices[i + 1]!
    const c = indices[i + 2]!
    const pa = at(a)
    const face = cross(sub(at(b), pa), sub(at(c), pa))
    for (const v of [a, b, c]) {
      normals[v * 3] = normals[v * 3]! + face[0]
      normals[v * 3 + 1] = normals[v * 3 + 1]! + face[1]
      normals[v * 3 + 2] = normals[v * 3 + 2]! + face[2]
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const n = unit([normals[i]!, normals[i + 1]!, normals[i + 2]!])
    normals[i] = n[0]
    normals[i + 1] = n[1]
    normals[i + 2] = n[2]
  }
  return normals
}

const bezier = (a: V3, b: V3, c: V3, count: number): V3[] =>
  Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const u = 1 - t
    return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1], u * u * a[2] + 2 * u * t * b[2] + t * t * c[2]]
  })

/** A point a share of the way along a path. */
function along(path: readonly V3[], share: number): V3 {
  const at = clamp01(share) * (path.length - 1)
  const i = Math.min(path.length - 2, Math.floor(at))
  const a = path[i]!
  const b = path[i + 1]!
  const t = at - i
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
}

const anyWay = (rand: () => number): V3 => {
  const y = rand() * 2 - 1
  const turn = rand() * Math.PI * 2
  const r = Math.sqrt(1 - y * y)
  return [r * Math.cos(turn), y, r * Math.sin(turn)]
}

/** A lump of the crown: a ball of leaves, a little flatter than it is wide. */
interface Lobe {
  c: V3
  r: number
  flat: number
}

/**
 * Grows one pattern: its wood, and its crown as cards round an inner mass.
 * `share` is how many of its leaf cards it gets; with fewer, each is bigger,
 * so the crown is as closed with a third of them as with all.
 *
 * Plain arrays, no three.js: the tests measure what comes out.
 */
export function growTree(pattern: TreePattern, share = 1): TreeMesh {
  const rand = random(pattern.seed * 7919 + 13)
  const fork = pattern.fork
  const wood: Wood = { positions: [], indices: [] }
  const lobes: Lobe[] = []

  // ---- the crown's lumps -----------------------------------------------------
  // A dome of them, each overlapping the next: set round the middle of the
  // crown's room at three fifths of the way to its wall, from below the waist
  // to the top, a golden angle apart so that no two courses line up. The wood
  // is then grown to where they are.
  const count = pattern.boughs
  const turn = rand() * Math.PI * 2
  const lumps = 7 + 3 * count
  for (let i = 0; i < lumps; i++) {
    const rise = -0.5 + (1.5 * (i + 0.5 + (rand() - 0.5) * 0.6)) / lumps
    const bearing = turn + i * 2.39996 + (rand() - 0.5) * 0.5
    const level = Math.sqrt(Math.max(0, 1 - rise * rise))
    const way: V3 = [Math.cos(bearing) * level, rise, Math.sin(bearing) * level]
    // How far it is to the wall that way.
    let near = 0
    let far: number = TOP
    for (let step = 0; step < 18; step++) {
      const t = (near + far) / 2
      if (within(way[0] * t, WAIST + way[1] * t, way[2] * t) < 1) near = t
      else far = t
    }
    const lobe: Lobe = { c: [0, 0, 0], r: Math.min(REACH * (0.34 + 0.1 * rand()), near * 0.46), flat: 0.8 + 0.12 * rand() }
    let out = near * (0.58 + 0.08 * rand())
    // And all of it inside the room.
    for (let fit = 0; fit < 12; fit++) {
      lobe.c = [way[0] * out, WAIST + way[1] * out, way[2] * out]
      const beyond = Math.max(
        within(lobe.c[0] + way[0] * lobe.r, lobe.c[1] + way[1] * lobe.r * lobe.flat, lobe.c[2] + way[2] * lobe.r),
        within(lobe.c[0], lobe.c[1] + lobe.r * lobe.flat, lobe.c[2]),
        within(lobe.c[0], lobe.c[1] - lobe.r * lobe.flat, lobe.c[2]),
        within(lobe.c[0] + Math.cos(bearing) * lobe.r, lobe.c[1], lobe.c[2] + Math.sin(bearing) * lobe.r),
      )
      if (beyond <= 1) break
      out *= 0.95
      lobe.r *= 0.96
    }
    lobes.push(lobe)
  }
  // One in the middle, which is mostly what is seen through the others.
  lobes.push({ c: [0, WAIST + 0.6, 0], r: REACH * 0.4, flat: 0.9 })
  const byHeight = [...lobes].sort((a, b) => b.c[1] - a.c[1])
  const cap = byHeight[0]!

  // ---- the trunk, and the leader it goes on up as ---------------------------
  const drift: V3 = [(rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5]
  const phase = rand() * Math.PI * 2
  // Never quite straight.
  const axis = (y: number): V3 => {
    const t = y / fork
    return [
      drift[0] * t * t + 0.07 * (Math.sin(y * 0.9 + phase) - Math.sin(phase)),
      y,
      drift[2] * t * t + 0.07 * (Math.cos(y * 0.75 + phase) - Math.cos(phase)),
    ]
  }
  const foot = 0.32 + 0.03 * rand()
  const heights = [0, 0.1, 0.24, 0.5, 0.9, 1.5, 2.2, 3.0, fork - 0.4, fork + 0.1]
  const trunk = heights.map(axis)
  // Tapering a little, spread at the foot, and swollen where the boughs leave it.
  const girth = heights.map((y) => foot * (1 - 0.17 * Math.min(1, y / fork)) * (1 + 0.62 * Math.exp(-y / 0.17)) * (1 + 0.1 * Math.exp(-((y - fork + 0.3) ** 2) / 0.12)))
  const crotch = axis(fork + 0.1)
  const tip: V3 = [cap.c[0], cap.c[1] - 0.3, cap.c[2]]
  const leader: V3[] = [crotch]
  const wander = rand() * Math.PI * 2
  for (let i = 1; i <= 6; i++) {
    const t = i / 6
    const sway = 0.45 * Math.sin(t * Math.PI) * Math.sin(t * 2.6 + wander)
    leader.push([mix(crotch[0], tip[0], t) + sway * Math.cos(wander), mix(crotch[1], tip[1], t), mix(crotch[2], tip[2], t) + sway * Math.sin(wander)])
    trunk.push(leader[i]!)
    girth.push(foot * mix(0.58, 0.1, t ** 0.8))
  }
  // Roots: the foot is not round.
  tube(wood, trunk, girth, 10, (ring, angle) => {
    const y = ring < heights.length ? heights[ring]! : 99
    return 1 + 0.17 * Math.exp(-y / 0.22) * (0.6 * Math.cos(3 * angle + phase) + 0.4 * Math.cos(5 * angle + 2 * phase))
  })
  const limbs: V3[][] = [leader]

  // ---- the boughs --------------------------------------------------------------
  // To lumps of the upper crown, as nearly evenly round the trunk as there are
  // lumps to go to.
  const upper = byHeight.slice(1, 1 + Math.max(count, Math.floor(lumps * 0.45)))
  const bearingOf = (lobe: Lobe): number => Math.atan2(lobe.c[2], lobe.c[0])
  const apart = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
  const carried = new Set<Lobe>([cap])
  for (let k = 0; k < count; k++) {
    const want = turn + (k / count) * Math.PI * 2
    let lump = upper[0]!
    let closest = 9
    for (const lobe of upper) {
      if (carried.has(lobe)) continue
      const off = apart(bearingOf(lobe), want)
      if (off < closest) {
        closest = off
        lump = lobe
      }
    }
    carried.add(lump)
    const start = axis(fork - 0.3 + rand() * 0.55)
    const end: V3 = [lump.c[0], lump.c[1] - lump.r * 0.35, lump.c[2]]
    // Out of the trunk at something like half a right angle, and turning up.
    const elbow: V3 = [mix(start[0], end[0], 0.7), mix(start[1], end[1], 0.34), mix(start[2], end[2], 0.7)]
    const path = bezier(start, elbow, end, 8)
    const thick = foot * 0.6 * Math.sqrt(4 / count)
    tube(
      wood,
      path,
      path.map((_, i) => mix(thick, 0.035, (i / 7) ** 0.85)),
      7,
    )
    limbs.push(path)
  }

  // ---- and a branch to every other lump, from whichever limb passes nearest ----
  for (const lump of lobes) {
    if (carried.has(lump) || lump === lobes[lobes.length - 1]) continue
    const end: V3 = [lump.c[0], lump.c[1] - lump.r * 0.3, lump.c[2]]
    let from = along(limbs[0]!, 0.4)
    let closest = Infinity
    for (const limb of limbs) {
      for (const where of [0.3, 0.42, 0.54, 0.66, 0.78, 0.9]) {
        const at = along(limb, where)
        // A branch goes out and up; one that would have to come down is a poor fit.
        const length = Math.hypot(end[0] - at[0], end[1] - at[1], end[2] - at[2]) + Math.max(0, at[1] - end[1]) * 2
        if (length < closest) {
          closest = length
          from = at
        }
      }
    }
    const middle: V3 = [mix(from[0], end[0], 0.5), mix(from[1], end[1], 0.5) - 0.1 * Math.hypot(end[0] - from[0], end[2] - from[2]), mix(from[2], end[2], 0.5)]
    tube(wood, bezier(from, middle, end, 4), [0.075, 0.058, 0.038, 0.014], 5)
  }

  const positions = new Float32Array(wood.positions)
  const woodIndices = new Uint16Array(wood.indices)

  // ---- the crown ---------------------------------------------------------------
  const part = clamp01(finite(share, 1))
  const leaves = Math.max(60, Math.round(TREE_CARDS * part))
  // Fewer cards are bigger ones, by enough to cover what the missing ones did.
  const widen = (leaves / TREE_CARDS) ** -0.42
  const centres: number[] = []
  const normals: number[] = []
  const across: number[] = []
  const up: number[] = []
  const corners: number[] = []
  const cards: number[] = []
  const indices: number[] = []
  const middle: V3 = [0, WAIST, 0]
  /** Which way the crown as a whole faces at a point: out from low on its axis, so its underside faces down. */
  const outOf = (p: V3): V3 => unit([p[0], (p[1] - WAIST + 1.2) * 0.8, p[2]])
  const facing = (p: V3, lobe: Lobe): V3 => unit(add(times(unit(sub(p, lobe.c)), 0.55), times(outOf(p), 0.45)))
  const onLobe = (lobe: Lobe, way: V3, reach: number): V3 => [lobe.c[0] + way[0] * lobe.r * reach, lobe.c[1] + way[1] * lobe.r * lobe.flat * reach, lobe.c[2] + way[2] * lobe.r * reach]
  const insideLobe = (p: V3, lobe: Lobe, share: number): boolean => Math.hypot(p[0] - lobe.c[0], (p[1] - lobe.c[1]) / lobe.flat, p[2] - lobe.c[2]) < lobe.r * share
  const weights = lobes.map((lobe) => lobe.r * lobe.r)
  const total = weights.reduce((sum, w) => sum + w, 0)
  const pick = (): Lobe => {
    let at = rand() * total
    for (let i = 0; i < lobes.length; i++) {
      at -= weights[i]!
      if (at <= 0) return lobes[i]!
    }
    return lobes[lobes.length - 1]!
  }
  /** Whether a card fits in the crown's room, on a kerb and in the open both, corners and all. */
  const fits = (c: V3, u: V3, v: V3): boolean => {
    for (const [a, b] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const ox = u[0] * a + v[0] * b
      const oy = u[1] * a + v[1] * b
      const oz = u[2] * a + v[2] * b
      if (within(c[0] + ox, c[1] + oy, c[2] + oz) > 1) return false
      // On a kerb the card is moved in with the crown but is no smaller.
      if (within(c[0] + ox, c[1] + oy, c[2] * KERB_SQUASH + oz, KERB_SQUASH) > 1) return false
    }
    return true
  }

  interface Card {
    p: V3
    normal: V3
    us: V3
    vs: V3
    open: number
  }
  const hung: Card[] = []
  for (let i = 0; i < leaves; i++) {
    let lobe = lobes[0]!
    let p: V3 = lobe.c
    let reach = 1
    // One card in seven is a spray standing out of its lump: what makes the
    // outline of a crown ragged, and not the outline of so many balls.
    const spray = rand() < 0.15
    for (let attempt = 0; attempt < 12; attempt++) {
      lobe = pick()
      const way = anyWay(rand)
      reach = spray ? 1.0 + 0.16 * rand() : 0.7 + 0.36 * rand()
      p = onLobe(lobe, way, reach)
      // Not buried in the lump next door, and mostly on the side that shows.
      // Few right underneath, and no spray there at all.
      const buried = lobes.some((other) => other !== lobe && insideLobe(p, other, 0.62))
      const under = way[1] < -0.45 ? (spray ? 0 : 0.14) : 1
      if (!buried && rand() < (0.3 + 0.7 * Math.max(0, dot(way, outOf(p)))) * under) break
    }
    const normal = facing(p, lobe)
    const face = unit(add(normal, times(anyWay(rand), 0.9)))
    const u = unit(cross(face, anyWay(rand)))
    const v = cross(face, u)
    const size = (spray ? 0.38 + 0.12 * rand() : 0.5 + 0.18 * rand()) * widen
    const us = times(u, size)
    const vs = times(v, size)
    for (let pull = 0; pull < 24 && !fits(p, us, vs); pull++) p = add(middle, times(sub(p, middle), 0.95))
    // Open to the sky near the skin of the crown, shut in towards its middle.
    const open = smooth(0.35, 0.9, within(p[0], p[1], p[2])) * (0.55 + 0.45 * smooth(0.7, 1.0, reach))
    hung.push({ p, normal, us, vs, open })
  }
  // A card with nothing near it hangs in the air like a plate. Any that has
  // ended up alone is moved next to one that has not.
  const close = (1.15 * widen) ** 2
  const COMPANY = 4
  const company = hung.map((card) => {
    let near = 0
    for (const other of hung) {
      const dx = card.p[0] - other.p[0]
      const dy = card.p[1] - other.p[1]
      const dz = card.p[2] - other.p[2]
      // Four is company; there is no need to count the rest.
      if (dx * dx + dy * dy + dz * dz < close && other !== card && ++near >= COMPANY) break
    }
    return near
  })
  const settled = hung.filter((_, i) => company[i]! >= COMPANY)
  hung.forEach((card, i) => {
    if (company[i]! >= COMPANY || settled.length === 0) return
    const beside = settled[Math.floor(rand() * settled.length)]!
    card.p = add(beside.p, times(anyWay(rand), 0.35))
    card.normal = beside.normal
    card.open = beside.open
    for (let pull = 0; pull < 24 && !fits(card.p, card.us, card.vs); pull++) card.p = add(middle, times(sub(card.p, middle), 0.95))
  })
  for (const card of hung) {
    const seed = rand()
    const tone = rand()
    const first = centres.length / 3
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      centres.push(card.p[0], card.p[1], card.p[2])
      normals.push(card.normal[0], card.normal[1], card.normal[2])
      across.push(card.us[0], card.us[1], card.us[2])
      up.push(card.vs[0], card.vs[1], card.vs[2])
      corners.push(a, b)
      cards.push(seed, card.open, 1, tone)
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3)
  }

  // The mass inside: a rough ball in each lump, well back from the cards, and
  // drawn as leaves too — a ball of plain green shows through the cards as a
  // boulder. So each point of it carries a place on a map of the ball, for the
  // leaves to be set out by, and the way out of the ball, for the shader to
  // fray its outline with.
  const SEGMENTS = 7
  const RINGS = 3
  for (const lobe of lobes) {
    const first = centres.length / 3
    const seed = rand()
    // Leaves on it as big as on a card: so many of them round, and so many from top to bottom.
    const round = Math.max(8, Math.round((Math.PI * 2 * lobe.r * 0.5) / 0.3))
    const down = Math.max(4, Math.round((Math.PI * lobe.r * lobe.flat * 0.5) / 0.3))
    const point = (way: V3, reach: number, u: number, v: number): void => {
      let p = onLobe(lobe, way, 0.5 * reach)
      const out = Math.max(within(p[0], p[1], p[2]), within(p[0], p[1], p[2] * KERB_SQUASH, KERB_SQUASH))
      if (out > 0.8) p = add(middle, times(sub(p, middle), 0.8 / out))
      const normal = facing(p, lobe)
      centres.push(p[0], p[1], p[2])
      normals.push(normal[0], normal[1], normal[2])
      across.push(way[0], way[1], way[2])
      up.push(u * round, v * down, 0)
      corners.push(0, 0)
      cards.push(seed, 0.3 * smooth(0.3, 0.8, within(p[0], p[1], p[2])), 0, rand())
    }
    // A point for every segment at each pole, and one more round each ring
    // than there are segments, so the map has no seam run backwards across it.
    const top = 0.88 + 0.24 * rand()
    const bottom = 0.88 + 0.24 * rand()
    for (let seg = 0; seg < SEGMENTS; seg++) point([0, 1, 0], top, (seg + 0.5) / SEGMENTS, 0)
    for (let ring = 1; ring <= RINGS; ring++) {
      const tilt = (ring / (RINGS + 1)) * Math.PI
      const reaches = Array.from({ length: SEGMENTS }, () => 0.88 + 0.24 * rand())
      for (let seg = 0; seg <= SEGMENTS; seg++) {
        const turnBy = (seg / SEGMENTS) * Math.PI * 2
        point([Math.sin(tilt) * Math.cos(turnBy), Math.cos(tilt), Math.sin(tilt) * Math.sin(turnBy)], reaches[seg % SEGMENTS]!, seg / SEGMENTS, ring / (RINGS + 1))
      }
    }
    for (let seg = 0; seg < SEGMENTS; seg++) point([0, -1, 0], bottom, (seg + 0.5) / SEGMENTS, 1)
    const ringAt = (ring: number): number => first + SEGMENTS + ring * (SEGMENTS + 1)
    const last = ringAt(RINGS)
    for (let seg = 0; seg < SEGMENTS; seg++) {
      indices.push(first + seg, ringAt(0) + seg, ringAt(0) + seg + 1)
      for (let ring = 0; ring < RINGS - 1; ring++) {
        const a = ringAt(ring) + seg
        const below = ringAt(ring + 1) + seg
        indices.push(a, below, a + 1, a + 1, below, below + 1)
      }
      indices.push(last + seg, ringAt(RINGS - 1) + seg + 1, ringAt(RINGS - 1) + seg)
    }
  }

  return {
    fork,
    leaves,
    wood: { positions, normals: smoothNormals(positions, woodIndices), indices: woodIndices },
    crown: {
      positions: new Float32Array(centres),
      normals: new Float32Array(normals),
      across: new Float32Array(across),
      up: new Float32Array(up),
      corners: new Float32Array(corners),
      cards: new Float32Array(cards),
      indices: new Uint16Array(indices),
    },
  }
}

/** Triangles in one pattern, for the README's table and the tests' ceiling. */
export const trianglesIn = (mesh: TreeMesh): number => (mesh.wood.indices.length + mesh.crown.indices.length) / 3

/**
 * When a tree comes up, as the city is built (`stage.city`, 0 to 1): later
 * than the fronts, along the street as it is laid, no two at quite the same
 * moment, and each taking `takes` of the city's building to do it.
 */
export const TREE_GROWS = { from: 0.6, along: 0.2, each: 0.05, takes: 0.12 } as const

/**
 * Which pattern a spot gets, how it is turned, and when in the building of
 * the city it starts to come up. `index` is its place in the list of spots:
 * the patterns are dealt out in turn, so no two neighbours in a row are the
 * same tree.
 */
export function treeAt(spot: TreeSpot, index: number): { pattern: number; yaw: number; seed: number; delay: number } {
  const x = finite(spot.x)
  const ix = Math.round(x * 4)
  const iz = Math.round(finite(spot.z) * 4)
  const seed = hash2(ix, iz + 17)
  return {
    pattern: Math.abs(Math.round(finite(index))) % TREE_PATTERNS.length,
    yaw: hash2(ix + 29, iz) * Math.PI * 2,
    seed,
    delay: TREE_GROWS.from + TREE_GROWS.along * clamp01((x - CITY_FROM) / (CITY_UNTIL - CITY_FROM)) + TREE_GROWS.each * seed,
  }
}

// ----------------------------------------------------------------- shaders

const TREE_VERT = /* glsl */ `
  // A seed; when it comes up; how narrow its crown is across the street (1 is
  // round); and how far that crown is pushed out along z.
  attribute vec4 aTree;
  uniform float uCity;
  uniform float uTime;
  uniform float uFork;
  uniform float uLamps;
  uniform vec3 uLight;
  uniform vec3 uAmbient;
  uniform vec3 uToLight;
  uniform vec3 uSunDir;
  varying vec3 vEvoWorld;
  ${STREET_GLSL}
  ${CITY_LIGHT_GLSL}
  ${SUN_SHADOW_GLSL}

  // How far a tree has come, 0 to 1: each has its own moment to start.
  float evoGrown() {
    float g = clamp((uCity - aTree.y) / ${TREE_GROWS.takes.toFixed(2)}, 0.0, 1.0);
    return g * g * (3.0 - 2.0 * g);
  }
  // A sapling first, and nothing at all before that.
  float evoSize(float grown) {
    return mix(0.08, 1.0, smoothstep(0.0, 0.8, grown)) * step(0.0005, grown);
  }
  // How much a point of the pattern belongs to the crown rather than the trunk.
  float evoCrown(float y) {
    return smoothstep(uFork - 1.2, uFork + 2.6, y);
  }
  // A point of the pattern, stood in the world: as big as the tree has grown,
  // turned its own way, the crown pressed narrow and pushed out over the road
  // if it is on a kerb, and moved by the wind — the more the higher.
  vec3 evoStand(vec3 p, float size) {
    vec3 o = mat3(instanceMatrix) * (p * size);
    float crown = evoCrown(p.y);
    o.z = o.z * mix(1.0, aTree.z, crown) + aTree.w * crown * size;
    vec3 at = (modelMatrix * vec4(instanceMatrix[3].xyz + o, 1.0)).xyz;
    float lift = max(o.y, 0.0) / ${TOP.toFixed(1)};
    float sway = lift * lift;
    float gust = sin(uTime * 0.83 + aTree.x * 6.28 + at.x * 0.045) + 0.45 * sin(uTime * 1.9 + at.x * 0.31 + at.z * 0.23 + aTree.x * 17.0);
    at.x += gust * sway * 0.09;
    at.z += (gust * 0.6 + 0.5 * sin(uTime * 1.31 + aTree.x * 9.0 + at.x * 0.2)) * sway * 0.07;
    return at;
  }
  // Which way a face of the pattern points once the tree is stood.
  vec3 evoFacing(vec3 n, float y) {
    vec3 turned = mat3(instanceMatrix) * n;
    turned.z /= mix(1.0, aTree.z, evoCrown(y));
    return normalize(turned);
  }
  // What the lamps do: the street's, the square's lanterns, and for a tree on
  // a kerb what comes out of the shop fronts behind it, low down.
  vec3 evoLampsOn(vec3 at, vec3 n, float wrap) {
    vec3 sum = evoStreetLight(at, n, wrap) + evoLanternLight(at, n, wrap);
    float front = at.z < STREET_Z ? -1.0 : 1.0;
    float shops = max((n.z * front + wrap) / (1.0 + wrap), 0.0) * (1.0 - smoothstep(1.5, 7.0, at.y)) * step(0.01, abs(aTree.w));
    return (sum + vec3(1.0, 0.8, 0.58) * shops * 0.6) * 0.42 * uLamps;
  }
`

const WOOD_VERT = /* glsl */ `
  ${TREE_VERT}
  varying vec3 vWood;
  varying vec3 vFace;
  varying vec3 vLamps;
  varying float vSeed;

  void main() {
    float size = evoSize(evoGrown());
    vec3 at = evoStand(position, size);
    vec3 n = evoFacing(normal, position.y);
    vWood = position;
    vFace = n;
    vSeed = aTree.x;
    vLamps = uLamps > 0.001 ? evoLampsOn(at, n, 0.12) : vec3(0.0);
    vEvoWorld = at;
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`

const WOOD_FRAG = /* glsl */ `
  #define EVO_FRAGMENT
  ${SUN_SHADOW_GLSL}
  uniform float uFork;
  uniform vec3 uLight;
  uniform vec3 uAmbient;
  uniform vec3 uToLight;
  varying vec3 vWood;
  varying vec3 vFace;
  varying vec3 vLamps;
  varying float vSeed;
  ${EVO_NOISE}

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

  void main() {
    vec3 p = vWood;
    // Plane bark comes off in plates and leaves the trunk a map of them, all
    // of it pale: ivory and cream where it has just shed, pale grey-green and
    // khaki for the plates that have been there a while, now and then one gone
    // grey-brown. A plate is a few cells that happen to be of an age. Its edge
    // is soft, the two colours running into each other, except where an older
    // plate is lifting off a newer one: there it has a thin, darker lip.
    // The plates are smaller on the boughs than on the trunk, as they are.
    float finer = mix(1.0, 1.7, smoothstep(uFork - 0.6, uFork + 0.8, p.y));
    vec3 q = (p - vec3(0.0, uFork, 0.0)) * vec3(16.0, 10.0, 16.0) * finer + vSeed * 37.0;
    float grain = length(fwidth(q));
    // No edge of a plate is straight.
    q += 0.6 * (vec3(evoNoise3(q * 0.9), evoNoise3(q * 0.9 + 21.3), evoNoise3(q * 0.9 + 47.9)) - 0.5);
    vec3 cell = floor(q);
    vec3 f = q - cell;
    float nearest = 9.0;
    float next = 9.0;
    float plate = 0.0;
    float beside = 0.0;
    for (int k = -1; k <= 1; k++) {
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec3 o = vec3(float(i), float(j), float(k));
          float h = evoHash3(cell + o);
          vec3 r = o + fract(h * vec3(1.0, 57.0, 113.0)) - f;
          float d = dot(r, r);
          if (d < nearest) {
            next = nearest;
            beside = plate;
            nearest = d;
            plate = h;
          } else if (d < next) {
            next = d;
            beside = h;
          }
        }
      }
    }
    float seam = sqrt(next) - sqrt(nearest);
    // How old, 0 to 3, and its colour.
    float age = floor(4.0 * pow(fract(plate * 7.13), 2.2));
    float ageBeside = floor(4.0 * pow(fract(beside * 7.13), 2.2));
    vec3 ivory = lin(vec3(0.88, 0.85, 0.73));
    vec3 sage = lin(vec3(0.71, 0.73, 0.6));
    vec3 khaki = lin(vec3(0.77, 0.72, 0.57));
    vec3 dusk = lin(vec3(0.67, 0.63, 0.54));
    vec3 bark = age < 0.5 ? ivory : age < 1.5 ? sage : age < 2.5 ? khaki : dusk;
    vec3 near_ = ageBeside < 0.5 ? ivory : ageBeside < 1.5 ? sage : ageBeside < 2.5 ? khaki : dusk;
    bark *= 0.95 + 0.1 * fract(plate * 23.7);
    near_ *= 0.95 + 0.1 * fract(beside * 23.7);
    // Soft-edged: half way to the next plate's colour at the seam.
    bark = mix(bark, near_, 0.5 * (1.0 - smoothstep(0.0, 0.16, seam)));
    // And a little mottled within, as a plate is.
    bark *= 0.93 + 0.14 * evoNoise3(q * 1.7 + 9.0);
    // Where an older plate lifts off a newer one, its edge.
    float rim = (1.0 - smoothstep(0.015, 0.045, seam)) * step(0.5, age - ageBeside);
    bark *= 1.0 - 0.2 * rim;
    // The old bark low on the trunk has stopped flaking, and is a little greyer.
    float old = 1.0 - smoothstep(0.8, 2.4, p.y);
    bark = mix(bark, khaki * 0.9, old * 0.18);
    // Too far off to see a plate, it is the colour they average to.
    float seen = 1.0 - smoothstep(0.35, 1.1, grain);
    vec3 mean = mix(lin(vec3(0.75, 0.73, 0.61)), khaki * 0.9, old * 0.18);
    vec3 color = mix(mean, bark, seen) * (0.95 + 0.1 * evoNoise3(p * vec3(60.0, 14.0, 60.0)));
    // And close to, the short dark dashes a plane's bark breathes through.
    float dash = smoothstep(0.8, 0.88, evoNoise3(p * vec3(34.0, 120.0, 34.0))) * (1.0 - smoothstep(0.1, 0.3, grain));
    color *= 1.0 - 0.14 * dash;

    // Lime, to chest height, put on with a brush: a ragged upper edge, the
    // plates under it showing only as their edges, a few of them fallen away
    // since, and the street splashed up it low down.
    float round_ = atan(p.z, p.x);
    float brim = 1.12 + 0.06 * sin(round_ * 3.0 + vSeed * 40.0) + 0.05 * (evoNoise3(vec3(round_ * 2.2, p.y * 3.0, vSeed * 9.0)) - 0.5) + 0.03 * (evoNoise3(p * vec3(19.0, 5.0, 19.0)) - 0.5);
    float limed = 1.0 - smoothstep(-0.012, 0.012, p.y - brim);
    limed *= 1.0 - seen * step(0.94, fract(plate * 41.3));
    vec3 lime = lin(vec3(0.9, 0.89, 0.84)) * (0.9 + 0.12 * evoNoise3(p * 9.0)) * (1.0 - 0.1 * rim * seen);
    lime = mix(lime, lin(vec3(0.5, 0.46, 0.4)), (1.0 - smoothstep(0.0, 0.42, p.y)) * (0.35 + 0.5 * evoNoise3(p * vec3(11.0, 4.0, 11.0))));
    color = mix(color, lime, limed);

    vec3 n = normalize(vFace);
    // Up among its own leaves the wood sees little sky and less sun, and when
    // the sun is high the whole trunk stands in the crown's shade.
    float among = smoothstep(uFork - 0.5, uFork + 2.2, p.y);
    float shade = mix(1.0, 0.3, among) * mix(1.0, 0.4, smoothstep(0.35, 0.75, uToLight.y));
    // Where there is a map of the sun's shadow, that says it instead: asked a
    // little way out towards the sun, past the wood's own surface.
    if (uSunShadowInfo.x > 0.5 && uSunDir.y > 0.0) shade = evoSunSeen(vEvoWorld + uToLight * 0.8, n);
    float sky = mix(0.72, 0.26, among) * (0.65 + 0.35 * n.y);
    vec3 lit = color * 0.32 * (uAmbient * sky + uLight * max(dot(n, uToLight), 0.0) * shade + vLamps);
    // Where it meets the ground.
    lit *= 0.55 + 0.45 * smoothstep(0.0, 0.22, p.y);

    gl_FragColor = vec4(evoAir(lit), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const CROWN_VERT = /* glsl */ `
  ${TREE_VERT}
  attribute vec3 aAcross;
  attribute vec3 aUp;
  attribute vec2 aCorner;
  attribute vec4 aCard;
  varying vec2 vCorner;
  varying vec2 vLeaves;
  varying vec4 vCard;
  varying vec3 vLit;
  varying vec3 vThrough;
  varying float vRim;

  void main() {
    float grown = evoGrown();
    float size = evoSize(grown);
    // The crown comes out of the fork, after the wood is up.
    float open = smoothstep(0.25, 1.0, grown);
    vec3 centre = mix(vec3(0.0, uFork, 0.0), position, 0.3 + 0.7 * open);
    vec3 at = evoStand(centre, size);
    vec3 middle = at;
    vec3 n = evoFacing(normal, position.y);
    vec3 view = normalize(at - cameraPosition);

    mat3 turn = mat3(instanceMatrix);
    vec3 u = turn * aAcross;
    vec3 v = turn * aUp;
    vec3 face = normalize(cross(u, v) + vec3(0.0, 1e-6, 0.0));
    // The mass: how squarely this point of its ball is seen, 0 on its outline.
    vRim = aCard.z > 0.5 ? 1.0 : abs(dot(evoFacing(aAcross, position.y), view));
    // A card seen edge on is a line a metre long. It closes up instead.
    float broad = smoothstep(0.06, 0.28, abs(dot(face, view)));
    float flutter = sin(uTime * (2.0 + 2.4 * aCard.x) + aCard.x * 41.0);
    at += (u * aCorner.x + v * aCorner.y) * (open * size * broad);
    at += face * (flutter * 0.025 * aCorner.x * aCorner.y * aCard.z * size);

    // Lit as the crown is, not as the card is: by which way the crown faces
    // here, round into its shaded side, and less the deeper in.
    float sky = aCard.y;
    float towards = dot(n, uToLight);
    // And only where the sun gets to: asked of the map a few metres out
    // towards it, past the leaves nearest, so a crown is not its own shadow
    // but a front across the road is.
    float sunSeen = uSunShadowInfo.x > 0.5 && uSunDir.y > 0.0 ? evoSunSeenLod(middle + uToLight * 3.0, vec3(0.0)) : 1.0;
    vec3 lit = uLight * max((towards + 0.35) / 1.35, 0.0) * mix(0.2, 1.0, sky * sky) * sunSeen;
    lit += uAmbient * mix(0.22, 1.0, sky) * max(0.5 + 0.5 * n.y, 0.14);
    // And the light that comes through a leaf from behind it.
    vec3 through = uLight * pow(max(dot(view, uToLight), 0.0), 2.0) * (0.2 + 0.8 * sky) * clamp(0.65 - 0.5 * towards, 0.0, 1.0) * 0.8 * sunSeen;
    if (uLamps > 0.001) {
      lit += evoLampsOn(at, n, 0.7) * mix(0.4, 1.0, sky);
      through += evoLampsOn(at, -n, 0.7) * 0.55 * sky;
    }
    vLit = lit * 0.32;
    vThrough = through * 0.32;
    vCorner = aCorner;
    // Four leaves by four on a card, and a margin so that none of them is cut
    // off square by its edge; on the mass, wherever its map says.
    vLeaves = aCard.z > 0.5 ? (aCorner * 0.5 + 0.5) * 4.54 - 0.27 : aUp.xy;
    vCard = aCard;
    vEvoWorld = at;
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`

/** The wood as the sun's map sees it: grown as far as it has, and moved by the wind. */
const WOOD_DEPTH_VERT = /* glsl */ `
  ${TREE_VERT}
  void main() {
    vec3 at = evoStand(position, evoSize(evoGrown()));
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`

/**
 * The crown as the sun's map sees it: not its cards — a crown is a few
 * thousand of them, one in front of another, and a shadow map that drew them
 * all would draw every one — but the mass inside it, pushed out to where the
 * leaves are, frayed at its outline as it is for the eye, and with holes in
 * it where the sun gets through: a crown's shadow is dappled.
 */
const CROWN_DEPTH_VERT = /* glsl */ `
  ${TREE_VERT}
  attribute vec3 aAcross;
  attribute vec3 aUp;
  attribute vec4 aCard;
  varying vec2 vLeaves;
  varying vec4 vCard;
  varying float vRim;
  void main() {
    vLeaves = aUp.xy;
    vCard = aCard;
    vRim = 1.0;
    // A card: behind the far plane, so nothing of it is drawn.
    if (aCard.z > 0.5) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    float grown = evoGrown();
    float size = evoSize(grown);
    float open = smoothstep(0.25, 1.0, grown);
    vec3 centre = mix(vec3(0.0, uFork, 0.0), position, 0.3 + 0.7 * open) + normal * 0.85 * open;
    vec3 at = evoStand(centre, size);
    vRim = abs(dot(evoFacing(aAcross, position.y), normalize(at - cameraPosition)));
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`

const CROWN_DEPTH_FRAG = /* glsl */ `
  varying vec2 vLeaves;
  varying vec4 vCard;
  varying float vRim;
  ${EVO_NOISE}
  void main() {
    if (vRim < 0.2 + 0.4 * evoHash(floor(vLeaves * 3.0))) discard;
    if (evoNoise(vLeaves * 1.7 + vCard.x * 13.0) > 0.7) discard;
    gl_FragColor = vec4(1.0);
  }
`

const CROWN_FRAG = /* glsl */ `
  varying vec2 vCorner;
  varying vec2 vLeaves;
  varying vec4 vCard;
  varying vec3 vLit;
  varying vec3 vThrough;
  varying float vRim;
  ${EVO_NOISE}

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

  // A plane leaf, its stalk at the origin and its tip a unit up +y: five
  // pointed lobes, the middle one longest, a tooth on the shoulder of each.
  // How far inside its edge 'p' is, and how near a rib. 'cut' is how deeply
  // it is lobed: 1 as it grows, 0 for the same leaf with its bays filled in.
  float evoLeaf(vec2 p, float cut, out float rib) {
    float r = length(p);
    float a = abs(atan(p.x, p.y));
    vec3 at = vec3(0.0, 0.8, 1.6);
    vec3 reach = vec3(1.0, 0.86, 0.56);
    vec3 wide = vec3(0.33, 0.31, 0.36);
    vec3 s = abs(vec3(a) - at) / wide;
    vec3 lobe = max(1.0 - s, 0.0);
    lobe += 0.14 * max(1.0 - abs(s - 0.56) / 0.2, 0.0) * step(s, vec3(1.0));
    lobe *= reach;
    // The edge is steep along a lobe's side, and a distance measured out from
    // the stalk is not one measured from the edge: 'steep' corrects it.
    float edge = mix(0.66, 0.3, cut) - 0.1 * smoothstep(2.0, 3.14, a);
    float steep = 0.0;
    if (lobe.x > edge) { edge = lobe.x; steep = reach.x / wide.x; }
    if (lobe.y > edge) { edge = lobe.y; steep = reach.y / wide.y; }
    if (lobe.z > edge) { edge = lobe.z; steep = reach.z / wide.z; }
    vec3 off = s * wide * r;
    rib = 1.0 - smoothstep(0.012, 0.04, min(off.x, min(off.y, off.z)));
    return (edge - r) / sqrt(1.0 + steep * steep / max(r * r, 0.02));
  }

  void main() {
    bool card = vCard.z > 0.5;
    vec2 q = vLeaves;
    vec2 across = vec2(length(dFdx(q)), length(dFdy(q)));
    // A pixel's size among the leaves, for their edges; and for what can still
    // be made out, the mean of its two ways — a card seen aslant is fine one way.
    float pixel = max(across.x, across.y);
    float coarse = sqrt(across.x * across.y);
    float r = length(vCorner);
    float rim = fwidth(r);
    float lock = floor(vCard.x * 4096.0);
    // Furthest off of all a card is one mass, and the mass is solid. None of
    // this is done by fading: a card that is evenly half there is what the
    // multisampler draws as a screen door. The leaves swell until they meet.
    float mass = smoothstep(0.5, 1.1, coarse + (vCard.x - 0.5) * 0.2);
    vec2 corner = floor(q - 0.5);
    float cover = 0.0;
    float which = 0.5;
    float ribbed = 0.0;
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        vec2 cell = corner + vec2(float(i), float(j));
        if (card && (cell.x < 0.0 || cell.y < 0.0 || cell.x > 3.0 || cell.y > 3.0)) continue;
        // One roll of the dice for each place on the twig, and the rest cut from it.
        float h1 = evoHash(cell + vec2(lock, lock * 3.0));
        float h2 = fract(h1 * 57.31);
        float h3 = fract(h1 * 113.17);
        // Some places have no leaf, and on a card more of them towards its
        // corners: a spray of leaves has no outline of its own.
        float outer = card ? length(cell - 1.5) / 2.12 : 0.0;
        if (fract(h1 * 211.7) < (card ? 0.1 + 0.6 * smoothstep(0.5, 1.0, outer) : 0.02)) continue;
        float len = 0.5 + 0.25 * h3;
        vec2 d = q - (cell + 0.5 + (vec2(h2, fract(h2 * 31.7)) - 0.5) * 0.5);
        // Too far from this one for any of it to be here.
        if (length(d) > len * (0.8 + mass * 2.0 + (card ? 0.5 : 0.8)) + pixel) continue;
        float turn = h1 * 6.2832;
        float c = cos(turn);
        float s = sin(turn);
        // Into the leaf's own frame, its blade over the middle of the cell.
        vec2 p = vec2(c * d.x + s * d.y, c * d.y - s * d.x) / len + vec2(0.0, 0.36);
        float fine = pixel / len;
        float far = coarse / len;
        // Far enough off for its bays to be less than a pixel or two, a leaf
        // has them filled in — each at its own distance, so the crown never
        // changes at once. A lobed thing a few pixels across is noise.
        float lobed = 1.0 - smoothstep(0.08, 0.24, far + (h2 - 0.5) * 0.05);
        // And further off the leaves run together: a crown of dots is not a crown.
        float run = smoothstep(0.2, 0.55, far);
        float rib;
        // On the mass they lie one over the next: it is there to be a back to the crown.
        float inside = evoLeaf(p, lobed, rib) + run * 0.5 + mass * 2.0 + (card ? 0.0 : 0.3);
        float a = clamp(inside / max(fine, 1e-4) + 0.5, 0.0, 1.0);
        if (a > cover) {
          cover = a;
          which = mix(h1, 0.5, run);
          ribbed = rib * lobed;
        }
      }
    }
    // By then a card is a disc, drawn in from its corners as the leaves swell.
    float alpha = card ? min(cover, clamp((mix(1.9, 0.92, mass) - r) / max(rim, 1e-4) + 0.5, 0.0, 1.0)) : cover;
    // The mass is frayed at its outline, so that it has none.
    if (!card && vRim < 0.16 + 0.4 * evoNoise3(vEvoWorld * 2.6)) discard;
    if (alpha < 0.03) discard;

    vec3 deep = lin(vec3(0.17, 0.27, 0.1));
    vec3 green = lin(vec3(0.25, 0.36, 0.13));
    vec3 pale = lin(vec3(0.36, 0.45, 0.18));
    vec3 gold = lin(vec3(0.6, 0.58, 0.26));
    float tone = mix(which, 0.5, mass);
    vec3 leaf = mix(deep, green, smoothstep(0.0, 0.5, tone));
    leaf = mix(leaf, pale, smoothstep(0.5, 1.0, tone) * 0.8);
    // A few have turned.
    leaf = mix(leaf, gold, step(0.975, fract(which * 7.31)) * 0.5 * (1.0 - mass));
    leaf *= 0.78 + 0.44 * vCard.w;
    leaf = mix(leaf, leaf * 1.5, ribbed * 0.45);
    if (card) {
      // The back of a leaf is paler and duller.
      if (!gl_FrontFacing) leaf = mix(leaf, vec3(dot(leaf, vec3(0.3, 0.5, 0.2))) * 1.25, 0.4);
    } else {
      // Deep in the crown, and deeper still seen through its far side.
      leaf *= gl_FrontFacing ? 0.75 : 0.45;
    }
    // What comes through a leaf is yellower than what comes off it.
    vec3 color = leaf * vLit + leaf * vec3(1.3, 1.45, 0.55) * vThrough;
    gl_FragColor = vec4(evoAir(color), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * The ground under a tree, as two flat squares laid over the paving: the
 * earth it stands in, and its shade. The shade is not a colour but a share,
 * and is multiplied into whatever is under it.
 */
const GROUND_VERT = /* glsl */ `
  // Where it stands (x, z); its seed; when it comes up.
  attribute vec4 aSpot;
  // Its size; 1 in the open, 0 on a kerb; how narrow its crown is across the
  // street; how far that crown is pushed out along z.
  attribute vec4 aShape;
  uniform float uCity;
  varying vec3 vEvoWorld;
  varying vec2 vCorner;
  varying vec4 vShape;

  float evoGrown() {
    float g = clamp((uCity - aSpot.w) / ${TREE_GROWS.takes.toFixed(2)}, 0.0, 1.0);
    return g * g * (3.0 - 2.0 * g);
  }
`

const PIT_VERT = /* glsl */ `
  ${GROUND_VERT}
  varying float vSeed;
  void main() {
    // Dug as the sapling goes in.
    float side = ${TREE_PIT.toFixed(2)} * smoothstep(0.0, 0.4, evoGrown());
    vec3 at = vec3(aSpot.x + position.x * side, 0.072, aSpot.y + position.z * side);
    vCorner = position.xz;
    vShape = aShape;
    vSeed = aSpot.z;
    vEvoWorld = at;
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`

const PIT_FRAG = /* glsl */ `
  uniform float uLamps;
  uniform vec3 uLight;
  uniform vec3 uAmbient;
  varying vec2 vCorner;
  varying vec4 vShape;
  varying float vSeed;
  ${EVO_NOISE}
  ${STREET_GLSL}
  ${CITY_LIGHT_GLSL}

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

  void main() {
    vec3 at = vEvoWorld;
    bool park = vShape.y > 0.5;
    // Square on a pavement, with a rim of stone; round in the open.
    float m = park ? length(vCorner) : max(abs(vCorner.x), abs(vCorner.y));
    if (m > 1.0) discard;
    // A kerb's tree is near enough to it for its square to run out into the road. It stops at the kerb.
    if (!park && abs(at.z - STREET_Z) < ROAD + 0.02) discard;
    vec3 earth = lin(vec3(0.13, 0.1, 0.08)) * (0.7 + 0.6 * evoNoise(at.xz * 6.0));
    // And what has come down off the tree and stayed there.
    float fallen = step(0.84, evoNoise(at.xz * 21.0 + vSeed * 50.0)) * step(0.45, evoNoise(at.xz * 2.7 + vSeed * 9.0));
    earth = mix(earth, lin(vec3(0.46, 0.4, 0.17)), fallen * 0.75);
    vec3 color = m < 0.88 ? earth : lin(vec3(0.5, 0.49, 0.46));
    // Lit as the paving round it is.
    vec3 lit = color * (uAmbient + uLight * max(uSunDir.y, 0.0));
    if (uLamps > 0.001) lit += color * (evoStreetLight(at, vec3(0.0, 1.0, 0.0), 0.0) + evoLanternLight(at, vec3(0.0, 1.0, 0.0), 0.0)) * 0.42 * uLamps;
    gl_FragColor = vec4(evoAir(lit), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const SHADE_VERT = /* glsl */ `
  ${GROUND_VERT}
  uniform vec3 uSunDir;
  varying vec2 vCrown;
  varying vec2 vFoot;
  varying vec2 vOpen;
  void main() {
    float grown = evoGrown();
    float size = aShape.x * mix(0.08, 1.0, smoothstep(0.0, 0.8, grown)) * step(0.0005, grown);
    // The middle of the crown, over the ground; and how far from under it the
    // sun throws its shadow — the lower the sun, the further.
    vec2 crown = aSpot.xy + vec2(0.0, aShape.w);
    vec2 thrown = -uSunDir.xz / max(uSunDir.y, 0.3) * 12.5 * size;
    float far = length(thrown);
    vec2 along = far > 0.01 ? thrown / far : vec2(1.0, 0.0);
    float reach = ${TREE_CROWN.along.toFixed(2)} * 1.25 * size;
    // One square for both: from under the crown out to the end of the shadow.
    vec2 flat_ = crown + thrown * 0.5 + along * position.x * (far * 0.5 + reach) + vec2(-along.y, along.x) * position.z * reach;
    vec3 at = vec3(flat_.x, 0.085, flat_.y);
    vCorner = position.xz;
    vShape = aShape;
    vCrown = crown;
    vFoot = aSpot.xy;
    vOpen = vec2(smoothstep(0.25, 1.0, grown), size);
    vEvoWorld = at;
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`

const SHADE_FRAG = /* glsl */ `
  // Whether the sun's shadow has a map: then the crowns cast their own, into it.
  uniform vec4 uSunShadowInfo;
  uniform float uLamps;
  uniform float uTime;
  uniform vec3 uLight;
  uniform vec3 uAmbient;
  uniform vec3 uSunDir;
  varying vec3 vEvoWorld;
  varying vec4 vShape;
  varying vec2 vCrown;
  varying vec2 vFoot;
  varying vec2 vOpen;
  ${EVO_NOISE}

  // How much of a crown is over a point, 0 to 1: 'off' from under its middle,
  // and solid as far out from there as 'core' of the way to its edge.
  float evoOver(vec2 off, vec2 radii, float core) {
    return 1.0 - smoothstep(core, 1.02, length(off / radii));
  }

  void main() {
    vec3 at = vEvoWorld;
    vec2 radii = vec2(${TREE_CROWN.along.toFixed(2)}, ${TREE_CROWN.along.toFixed(2)} * vShape.z) * max(vOpen.y, 0.01);
    vec2 off = at.xz - vCrown;
    // Straight below a crown half the sky is hidden.
    float under = evoOver(off, radii, 0.5);
    // Its shadow is somewhere else, and further off the lower the sun: the
    // crown's, a long shape made of the crown at three heights, and the
    // trunk's, a strip from its foot to where the crown's begins. In it there
    // are the flecks of sun the leaves let past, moving a little as they do,
    // and more of them towards its edge.
    vec2 slant = uSunDir.xz / max(uSunDir.y, 0.3) * vOpen.y;
    float crown = max(evoOver(off + slant * 6.5, radii * 1.1, 0.45), max(evoOver(off + slant * 9.5, radii * 1.15, 0.45), evoOver(off + slant * 12.5, radii, 0.45)));
    // A fleck is a hand across. Further off than a fleck is a few pixels it is
    // what they average to: a speckle that small reads as dirt, not as sun.
    float pixel = length(fwidth(at.xz));
    float fleck = smoothstep(0.42, 0.7, evoNoise(at.xz * 0.9 + slant * 2.0) * 0.6 + evoNoise(at.xz * 2.3 + vec2(sin(uTime * 0.6), cos(uTime * 0.47)) * 0.12) * 0.4);
    fleck = mix(fleck, 0.3, smoothstep(0.08, 0.25, pixel));
    // Nothing else in the street throws a shadow on it, so a tree's is no darker than shade under trees is.
    float shadow = crown * (0.62 - 0.4 * fleck * (1.0 - 0.5 * crown));
    vec2 from = at.xz - vFoot;
    vec2 lies = -slant * 7.0;
    float way = clamp(dot(from, lies) / max(dot(lies, lies), 1e-4), 0.0, 1.0);
    shadow = max(shadow, 0.6 * (1.0 - smoothstep(0.2, 0.4, length(from - lies * way) / max(vOpen.y, 0.01))));
    // How much of the light on the ground here is the sun's, and so can be shaded.
    vec3 weigh = vec3(0.3, 0.55, 0.15);
    float sun = dot(uLight, weigh) * max(uSunDir.y, 0.0);
    float share = sun / max(sun + dot(uAmbient, weigh), 1e-4);
    float shade = shadow * share * step(uSunShadowInfo.x, 0.5) + under * 0.32 * (1.0 - share);
    // By night a crown stands between the ground under it and some of the lamps.
    shade = shade * (1.0 - 0.6 * uLamps) + under * (0.42 - 0.3 * fleck) * 0.8 * uLamps;
    shade *= vOpen.x * (1.0 - smoothstep(150.0, 280.0, length(at - cameraPosition)));
    gl_FragColor = vec4(vec3(1.0 - clamp(shade, 0.0, 0.9)), 1.0);
    #include <colorspace_fragment>
  }
`

// -------------------------------------------------------------------- part

export interface TreeOptions {
  /** How many of its leaf cards each tree gets, 0 to 1. */
  leaves: number
}

/** The plane trees, wherever `treeSpots()` puts one. */
export function createTrees(air: Air, options: TreeOptions): Part {
  const root = new Group()
  const disposers: (() => void)[] = []
  const shared = {
    uCity: { value: 0 },
    uLamps: { value: 0 },
    uTime: { value: 0 },
    uLight: { value: new Color() },
    uAmbient: { value: new Color() },
    uToLight: { value: new Vector3(0, 1, 0) },
    uHaze: air.uHaze,
    uGlow: air.uGlow,
    uSunDir: air.uSunDir,
    uAir: air.uAir,
  }
  // Lit by the sun only where it gets to them, and casting their own shadows into its map.
  const sunShadow = createSunShadow()
  Object.assign(shared, sunShadow.uniforms)
  disposers.push(() => sunShadow.dispose())
  const spots = treeSpots().map((spot, index) => ({ spot, as: treeAt(spot, index) }))
  const dummy = new Object3D()
  const casters: Object3D[] = []

  TREE_PATTERNS.forEach((pattern, index) => {
    const here = spots.filter((tree) => tree.as.pattern === index)
    if (here.length === 0) return
    const mesh = growTree(pattern, options.leaves)

    const trees = new Float32Array(here.length * 4)
    here.forEach(({ spot, as }, i) => {
      const size = Math.max(0.2, finite(spot.scale, 1))
      // Out over the road, which is the way to the middle of the street.
      const lean = spot.park ? 0 : TREE_CROWN.lean * size * (finite(spot.z) < STREET_Z ? 1 : -1)
      trees.set([as.seed, as.delay, spot.park ? 1 : KERB_SQUASH, lean], i * 4)
    })
    const each = new InstancedBufferAttribute(trees, 4)
    const uniforms = { ...shared, uFork: { value: pattern.fork } }

    const woodGeometry = new BufferGeometry()
    woodGeometry.setAttribute('position', new BufferAttribute(mesh.wood.positions, 3))
    woodGeometry.setAttribute('normal', new BufferAttribute(mesh.wood.normals, 3))
    woodGeometry.setIndex(new BufferAttribute(mesh.wood.indices, 1))
    woodGeometry.setAttribute('aTree', each)
    const woodMaterial = new ShaderMaterial({ uniforms, vertexShader: WOOD_VERT, fragmentShader: `${AIR_PARS}\n${WOOD_FRAG}` })

    const crownGeometry = new BufferGeometry()
    crownGeometry.setAttribute('position', new BufferAttribute(mesh.crown.positions, 3))
    crownGeometry.setAttribute('normal', new BufferAttribute(mesh.crown.normals, 3))
    crownGeometry.setAttribute('aAcross', new BufferAttribute(mesh.crown.across, 3))
    crownGeometry.setAttribute('aUp', new BufferAttribute(mesh.crown.up, 3))
    crownGeometry.setAttribute('aCorner', new BufferAttribute(mesh.crown.corners, 2))
    crownGeometry.setAttribute('aCard', new BufferAttribute(mesh.crown.cards, 4))
    crownGeometry.setIndex(new BufferAttribute(mesh.crown.indices, 1))
    crownGeometry.setAttribute('aTree', each)
    // The edges of the leaves go to the multisampler, as the hair's do: no
    // blending, so nothing to sort, and no hard cut-out either.
    const crownMaterial = new ShaderMaterial({
      uniforms,
      vertexShader: CROWN_VERT,
      fragmentShader: `${AIR_PARS}\n${CROWN_FRAG}`,
      side: DoubleSide,
      alphaToCoverage: true,
    })

    const wood = new InstancedMesh(woodGeometry, woodMaterial, here.length)
    const crown = new InstancedMesh(crownGeometry, crownMaterial, here.length)
    here.forEach(({ spot, as }, i) => {
      const size = Math.max(0.2, finite(spot.scale, 1))
      dummy.position.set(finite(spot.x), 0.03, finite(spot.z))
      dummy.rotation.set(0, finite(as.yaw), 0)
      dummy.scale.setScalar(size)
      dummy.updateMatrix()
      wood.setMatrixAt(i, dummy.matrix)
      crown.setMatrixAt(i, dummy.matrix)
    })
    const woodDepth = new ShaderMaterial({ uniforms, vertexShader: WOOD_DEPTH_VERT, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' })
    const crownDepth = new ShaderMaterial({ uniforms, vertexShader: CROWN_DEPTH_VERT, fragmentShader: CROWN_DEPTH_FRAG, side: DoubleSide })
    wood.customDepthMaterial = woodDepth
    crown.customDepthMaterial = crownDepth
    for (const drawn of [wood, crown]) {
      drawn.instanceMatrix.needsUpdate = true
      // They stand the length of the street: there is no one sphere to cull them by.
      drawn.frustumCulled = false
      drawn.castShadow = true
      casters.push(drawn)
      sunShadow.bind(drawn)
      root.add(drawn)
    }
    disposers.push(
      () => woodGeometry.dispose(),
      () => woodMaterial.dispose(),
      () => crownGeometry.dispose(),
      () => crownMaterial.dispose(),
      () => woodDepth.dispose(),
      () => crownDepth.dispose(),
    )
  })

  // ---- the ground they stand on: earth, and shade ----------------------------
  const square = new InstancedBufferGeometry()
  square.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3))
  square.setIndex([0, 2, 1, 0, 3, 2])
  const where = new Float32Array(spots.length * 4)
  const shapes = new Float32Array(spots.length * 4)
  spots.forEach(({ spot, as }, i) => {
    const size = Math.max(0.2, finite(spot.scale, 1))
    where.set([finite(spot.x), finite(spot.z), as.seed, as.delay], i * 4)
    shapes.set([size, spot.park ? 1 : 0, spot.park ? 1 : KERB_SQUASH, spot.park ? 0 : TREE_CROWN.lean * size * (finite(spot.z) < STREET_Z ? 1 : -1)], i * 4)
  })
  square.setAttribute('aSpot', new InstancedBufferAttribute(where, 4))
  square.setAttribute('aShape', new InstancedBufferAttribute(shapes, 4))
  square.instanceCount = spots.length
  // Both are a hair above the paving; pushed towards the eye as well, so that
  // far off, where a hair is less than the depth buffer can tell, they still win.
  const pitMaterial = new ShaderMaterial({
    uniforms: shared,
    vertexShader: PIT_VERT,
    fragmentShader: `${AIR_PARS}\n${PIT_FRAG}`,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })
  const shadeMaterial = new ShaderMaterial({
    uniforms: shared,
    vertexShader: SHADE_VERT,
    fragmentShader: SHADE_FRAG,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    // What is there already, times what the shader says is left of it.
    blending: CustomBlending,
    blendSrc: ZeroFactor,
    blendDst: SrcColorFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -6,
  })
  const pits = new Mesh(square, pitMaterial)
  const shade = new Mesh(square, shadeMaterial)
  sunShadow.bind(shade)
  // Before anything else that is drawn over the ground: a lamp's glow is not in its shade.
  shade.renderOrder = -1
  for (const laid of [pits, shade]) {
    laid.frustumCulled = false
    root.add(laid)
  }
  disposers.push(
    () => square.dispose(),
    () => pitMaterial.dispose(),
    () => shadeMaterial.dispose(),
  )

  function update(beat: Beat): void {
    // A shadow only while the sun is up to throw one: what lights the street
    // by night is its lamps, and the map is drawn every frame whether or not.
    const strong = beat.sky.elevation > 0 && beat.light.r + beat.light.g + beat.light.b > 0.3
    for (const drawn of casters) drawn.castShadow = strong
    // Nothing of them before the street is laid.
    const seen = beat.stage.city > 0.58
    root.visible = seen
    if (!seen) return
    shared.uCity.value = finite(beat.stage.city)
    shared.uLamps.value = finite(beat.lamps)
    shared.uTime.value = finite(beat.t)
    shared.uLight.value.copy(beat.light)
    shared.uAmbient.value.copy(beat.ambient)
    // Whichever of the two is up, as the scene's own lamp has it — and never from below.
    const bySun = beat.sky.elevation > -3
    shared.uToLight.value
      .set(finite(bySun ? beat.sky.sx : beat.sky.mx), Math.max(finite(bySun ? beat.sky.sy : beat.sky.my), 0.06), finite(bySun ? beat.sky.sz : beat.sky.mz))
      .normalize()
  }

  return {
    object: root,
    update,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}
