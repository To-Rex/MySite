import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
} from 'three'
import { AIR_PARS, EVO_NOISE, type Air } from './evoAir'
import { CITY_LIGHT_GLSL, FLAG, FOUNTAIN, HOTEL, LAMP_GAP, MOSQUE, ROAD, STREET_GLSL, STREET_Z, TV_TOWER, crossingHeld } from './evoStreet'
import type { Beat, Part } from './evoWalk'

/**
 * What makes the street at the end of the walk a street in Tashkent.
 *
 * The blocks either side of it could be in a good many cities. These could
 * not: the television tower on its three legs, a white mosque with a
 * turquoise dome at the back of a square, the flag, a fountain, and the name
 * on the roof of the hotel. It is a Tashkent put together out of its
 * landmarks, not a map of it — they do not stand this close to one another.
 *
 * Everything that stands still is one mesh and one program. Each surface
 * carries what kind of thing it is and where on itself a point lies, in
 * metres, and the fragment shader draws marble, tilework, lattices and lit
 * windows from that — the same way `evoCity.ts` draws a block of flats from a
 * box. Nothing here takes one of three's lights: the sun, the sky, the
 * street's lamps and the floodlights are all worked out in the shader, so
 * there is one program however the walk is lit and nothing to rehearse.
 */

type Tint = readonly [number, number, number]
type Profile = readonly (readonly [number, number])[]

/** A colour written the way it is seen, as the linear light the shader works in. */
const lin = (r: number, g: number, b: number): Tint => [r ** 2.2, g ** 2.2, b ** 2.2]
const glsl = ([r, g, b]: Tint): string => `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`

const MARBLE = lin(0.93, 0.915, 0.87)
const GRANITE = lin(0.5, 0.49, 0.47)
const PAVING = lin(0.62, 0.6, 0.55)
const ROOF = lin(0.6, 0.59, 0.56)
const STEEL = lin(0.74, 0.76, 0.78)
const CONCRETE = lin(0.62, 0.61, 0.58)
const GOLD = lin(0.86, 0.64, 0.2)
const POLE = lin(0.8, 0.81, 0.83)
const CASE = lin(0.1, 0.1, 0.11)
const TURQUOISE = lin(0.13, 0.62, 0.66)
const RED = lin(0.8, 0.12, 0.08)

/** What a surface is: the fragment shader draws each its own way. */
export const SURFACE = { stone: 0, hall: 1, portal: 2, dome: 3, drum: 4, minaret: 5, shaft: 6, beacon: 7, signal: 8 } as const
/** What lights a thing after dark: the street and the square's lanterns, the mosque's floodlights, the tower's. */
export const FLOOD = { street: 0, mosque: 1, tower: 2 } as const

/**
 * A pile of surfaces, put up in the world's own coordinates.
 *
 * Every vertex carries what it is (`surface`: kind, then where on that surface
 * it is — metres along and up for a wall, the way round and metres up for
 * anything turned — and one number more), how big the surface is (`dim`), a
 * colour, and when it rises out of the ground as the city is built.
 */
export class Mass {
  readonly position: number[] = []
  readonly normal: number[] = []
  readonly surface: number[] = []
  readonly dim: number[] = []
  readonly tint: number[] = []
  readonly grow: number[] = []
  readonly index: number[] = []
  private base = 0
  private height = 1
  private delay = 0
  private span = 0.3
  private flood: number = FLOOD.street

  /**
   * Whatever is put up after this comes up out of the ground at `base` —
   * `height` of it, all told — between `delay` and `delay + span` of the
   * city's own rising.
   */
  rising(base: number, height: number, delay: number, span: number, flood: number): this {
    this.base = base
    this.height = height
    this.delay = delay
    this.span = span
    this.flood = flood
    return this
  }

  private put(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: number, u: number, v: number, extra: number, wide: number, high: number, tint: Tint): number {
    const n = this.position.length / 3
    this.position.push(x, y, z)
    this.normal.push(nx, ny, nz)
    this.surface.push(kind, u, v, extra)
    this.dim.push(wide, high, this.flood)
    this.tint.push(tint[0], tint[1], tint[2])
    this.grow.push(this.base, this.height, this.delay, this.span)
    return n
  }

  /** An upright wall from one point of the ground to another; it faces the left of that line, seen from above with +x right and +z down. */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, kind: number, tint: Tint, extra = 0): void {
    const dx = x1 - x0
    const dz = z1 - z0
    const length = Math.hypot(dx, dz) || 1
    const nx = -dz / length
    const nz = dx / length
    const high = y1 - y0
    const a = this.put(x0, y0, z0, nx, 0, nz, kind, 0, 0, extra, length, high, tint)
    const b = this.put(x1, y0, z1, nx, 0, nz, kind, length, 0, extra, length, high, tint)
    const c = this.put(x1, y1, z1, nx, 0, nz, kind, length, high, extra, length, high, tint)
    const d = this.put(x0, y1, z0, nx, 0, nz, kind, 0, high, extra, length, high, tint)
    this.index.push(a, b, c, a, c, d)
  }

  /** A level surface, facing up. */
  slab(x0: number, z0: number, x1: number, z1: number, y: number, tint: Tint, extra = 0): void {
    const wide = x1 - x0
    const deep = z1 - z0
    const a = this.put(x0, y, z1, 0, 1, 0, SURFACE.stone, 0, 0, extra, wide, deep, tint)
    const b = this.put(x1, y, z1, 0, 1, 0, SURFACE.stone, wide, 0, extra, wide, deep, tint)
    const c = this.put(x1, y, z0, 0, 1, 0, SURFACE.stone, wide, deep, extra, wide, deep, tint)
    const d = this.put(x0, y, z0, 0, 1, 0, SURFACE.stone, 0, deep, extra, wide, deep, tint)
    this.index.push(a, b, c, a, c, d)
  }

  /** Four walls and a roof. `front` is what the wall towards +z is, if not what the others are. */
  box(cx: number, cz: number, wide: number, deep: number, y0: number, y1: number, kind: number, tint: Tint, roof: Tint, front: number = kind, extra = 0): void {
    const x0 = cx - wide / 2
    const x1 = cx + wide / 2
    const z0 = cz - deep / 2
    const z1 = cz + deep / 2
    this.wall(x0, z1, x1, z1, y0, y1, front, tint, extra)
    this.wall(x1, z1, x1, z0, y0, y1, kind, tint, extra)
    this.wall(x1, z0, x0, z0, y0, y1, kind, tint, extra)
    this.wall(x0, z0, x0, z1, y0, y1, kind, tint, extra)
    this.slab(x0, z0, x1, z1, y1, roof)
  }

  /**
   * A profile turned about an upright axis: `[radius, height]` pairs from the
   * bottom up, heights from `y0`. `crisp` keeps every corner of the profile a
   * corner; without it the surface is one curve, as a dome is.
   */
  lathe(cx: number, cz: number, y0: number, profile: Profile, segments: number, kind: number, tint: Tint, options: { crisp?: boolean; extra?: number } = {}): void {
    const extra = options.extra ?? 0
    const last = profile.length - 1
    const high = profile[last]![1] - profile[0]![1]
    const widest = Math.max(...profile.map(([r]) => r))
    const ring = (r: number, y: number, nr: number, ny: number): number => {
      const first = this.position.length / 3
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2
        const c = Math.cos(a)
        const s = Math.sin(a)
        this.put(cx + r * c, y0 + y, cz + r * s, nr * c, ny, nr * s, kind, i / segments, y, extra, widest, high, tint)
      }
      return first
    }
    const join = (lo: number, hi: number): void => {
      for (let i = 0; i < segments; i++) this.index.push(lo + i, hi + i, hi + i + 1, lo + i, hi + i + 1, lo + i + 1)
    }
    if (options.crisp) {
      for (let j = 0; j < last; j++) {
        const [r0, ya] = profile[j]!
        const [r1, yb] = profile[j + 1]!
        const length = Math.hypot(r1 - r0, yb - ya) || 1
        const nr = (yb - ya) / length
        const ny = -(r1 - r0) / length
        join(ring(r0, ya, nr, ny), ring(r1, yb, nr, ny))
      }
      return
    }
    const rings = profile.map(([r, y], j) => {
      const [ra, ya] = profile[Math.max(0, j - 1)]!
      const [rb, yb] = profile[Math.min(last, j + 1)]!
      const length = Math.hypot(rb - ra, yb - ya) || 1
      return ring(r, y, (yb - ya) / length, -(rb - ra) / length)
    })
    for (let j = 0; j < last; j++) join(rings[j]!, rings[j + 1]!)
  }

  /** A round bar from one point to another, as thick as `ra` at the first and `rb` at the second. */
  tube(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number, segments: number, tint: Tint, extra = 0): void {
    const axis = new Vector3(bx - ax, by - ay, bz - az)
    const length = axis.length() || 1
    axis.divideScalar(length)
    const e1 = new Vector3(0, 1, 0).cross(axis)
    if (e1.lengthSq() < 1e-8) e1.set(1, 0, 0)
    e1.normalize()
    const e2 = e1.clone().cross(axis)
    const ring = (x: number, y: number, z: number, r: number, along: number): number => {
      const first = this.position.length / 3
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2
        const nx = Math.cos(a) * e1.x + Math.sin(a) * e2.x
        const ny = Math.cos(a) * e1.y + Math.sin(a) * e2.y
        const nz = Math.cos(a) * e1.z + Math.sin(a) * e2.z
        this.put(x + nx * r, y + ny * r, z + nz * r, nx, ny, nz, SURFACE.stone, i / segments, along, extra, Math.max(ra, rb), length, tint)
      }
      return first
    }
    const lo = ring(ax, ay, az, ra, 0)
    const hi = ring(bx, by, bz, rb, length)
    for (let i = 0; i < segments; i++) this.index.push(lo + i, hi + i, hi + i + 1, lo + i, hi + i + 1, lo + i + 1)
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.position), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normal), 3))
    geometry.setAttribute('aSurface', new BufferAttribute(new Float32Array(this.surface), 4))
    geometry.setAttribute('aDim', new BufferAttribute(new Float32Array(this.dim), 3))
    geometry.setAttribute('aTint', new BufferAttribute(new Float32Array(this.tint), 3))
    geometry.setAttribute('aGrow', new BufferAttribute(new Float32Array(this.grow), 4))
    geometry.setIndex(new BufferAttribute(new Uint32Array(this.index), 1))
    geometry.computeBoundingSphere()
    return geometry
  }
}

// ------------------------------------------------------------------ shapes

/** The ground the tower stands on: the level skirt of the ranges, below the plain. */
const TOWER_FOOT = -6
/** Its shaft from the ground to the tip, as built: radius and height in metres, for a tower of 375. */
export const TOWER_PROFILE: Profile = [
  [9.5, TOWER_FOOT],
  [8.4, 30],
  [7.0, 92],
  [7.0, 94],
  [11.6, 97],
  [12.6, 100],
  [12.6, 112],
  [10.6, 116],
  [6.4, 118.5],
  [5.7, 160],
  [5.0, 208],
  [5.0, 210],
  [7.4, 212.5],
  [7.4, 221],
  [5.6, 224.5],
  [3.2, 226.5],
  [2.7, 228],
  [2.3, 290],
  [1.5, 292],
  [1.2, 340],
  [0.75, 342],
  [0.5, 372],
  [0, 375],
]
/** Where its red lights are: how far out from the axis, and how high. */
const TOWER_LIGHTS: Profile = [
  [12.2, 117],
  [7.2, 225],
  [2.9, 292],
  [1.8, 342],
  [0, 376],
]

/** A dome's outline, as shares of its radius and height: a little wider above its foot than at it, and drawn to a point. */
const DOME: Profile = [
  [0.93, 0],
  [0.985, 0.08],
  [1, 0.18],
  [0.97, 0.32],
  [0.9, 0.46],
  [0.78, 0.6],
  [0.62, 0.73],
  [0.44, 0.84],
  [0.26, 0.92],
  [0.1, 0.975],
  [0, 1],
]
/** A minaret: a foot, a shaft that narrows, a gallery held out on a corbel, a lantern, a cornice. */
const MINARET: Profile = [
  [1.9, 0],
  [1.9, 2.6],
  [1.5, 3.0],
  [1.22, 22.6],
  [1.45, 23.2],
  [2.0, 24.3],
  [2.0, 25.3],
  [1.2, 25.3],
  [1.2, 28.2],
  [1.5, 28.4],
  [1.5, 28.8],
  [1.28, 28.8],
]
/** And the little dome on top of it. */
const MINARET_CAP: Profile = [
  [1.28, 28.8],
  [1.36, 29.5],
  [1.15, 30.2],
  [0.75, 30.9],
  [0.3, 31.3],
  [0, MOSQUE.minaret],
]
const FINIAL: Profile = [
  [0.16, 0],
  [0.5, 0.45],
  [0.16, 0.9],
  [0.36, 1.25],
  [0.12, 1.6],
  [0.07, 2.2],
  [0, 2.9],
]

const scaled = (profile: Profile, r: number, y: number): Profile => profile.map(([a, b]) => [a * r, b * y] as const)
/** A ball, as a profile. */
const ball = (r: number): Profile => [-1, -0.6, 0, 0.6, 1].map((s) => [Math.sqrt(Math.max(0, 1 - s * s)) * r, s * r + r] as const)

function tower(m: Mass): void {
  const { x, z, height } = TV_TOWER
  const k = height / 375
  m.rising(TOWER_FOOT, height + 3 - TOWER_FOOT, 0.42, 0.5, FLOOD.tower)
  // The three legs, leaning in to hold the shaft a quarter of the way up.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5
    m.tube(x + Math.cos(a) * 44 * k, TOWER_FOOT, z + Math.sin(a) * 44 * k, x + Math.cos(a) * 6.2 * k, 93 * k, z + Math.sin(a) * 6.2 * k, 3.4 * k, 2.3 * k, 8, CONCRETE, 0.15)
  }
  m.lathe(x, z, 0, scaled(TOWER_PROFILE, k, k), 20, SURFACE.shaft, STEEL, { crisp: true })
  // Red lights, for whatever flies: a ring of three at each change of width and one on the tip.
  TOWER_LIGHTS.forEach(([out, y], n) => {
    const count = out > 0 ? 3 : 1
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + n
      m.lathe(x + Math.cos(a) * out * k, z + Math.sin(a) * out * k, y * k - 1.0, ball(1.0), 6, SURFACE.beacon, RED, { extra: n * 1.7 })
    }
  })
}

function mosque(m: Mass): void {
  const { x, z, step, hall, wall, portal, wing, dome, minarets } = MOSQUE
  const front = z + hall / 2
  m.rising(0, MOSQUE.minaret + 2, 0.7, 0.26, FLOOD.mosque)
  // What it stands on: two steps, wider than all of it and out in front of the portal.
  const across = hall + wing.width * 2
  m.box(x, z + 2.6, across + 6.4, hall + 11.2, 0, step / 2, SURFACE.stone, GRANITE, PAVING)
  m.box(x, z + 2.2, across + 4.6, hall + 9.2, step / 2, step, SURFACE.stone, GRANITE, PAVING)
  // A low wing either side, set back a little from the hall's front.
  for (const side of [-1, 1]) {
    m.box(x + side * (hall / 2 + wing.width / 2), front - 2.4 - wing.depth / 2, wing.width, wing.depth, step, step + wing.height, SURFACE.hall, MARBLE, ROOF)
  }
  m.box(x, z, hall, hall, step, step + wall, SURFACE.hall, MARBLE, ROOF)
  // The portal: taller than the hall, and all of its front one arch.
  m.box(x, front + portal.depth / 2, portal.width, portal.depth, step, step + portal.height, SURFACE.hall, MARBLE, ROOF, SURFACE.portal)
  // The drum on the roof, and the dome on the drum.
  const roof = step + wall
  const d = dome.drum
  m.lathe(x, z, roof, [[d + 0.5, 0], [d + 0.5, 0.35], [d, 0.35], [d, dome.drumHeight - 0.4], [d + 0.35, dome.drumHeight - 0.25], [d + 0.35, dome.drumHeight], [d - 0.3, dome.drumHeight]], 32, SURFACE.drum, MARBLE, { crisp: true })
  m.lathe(x, z, roof + dome.drumHeight, scaled(DOME, dome.r, dome.height), 40, SURFACE.dome, TURQUOISE)
  m.lathe(x, z, roof + dome.drumHeight + dome.height - 0.2, FINIAL, 10, SURFACE.stone, GOLD, { extra: 0.9 })
  for (const [mx, mz] of minarets) {
    m.lathe(mx, mz, 0, MINARET, 16, SURFACE.minaret, MARBLE, { crisp: true })
    m.lathe(mx, mz, 0, MINARET_CAP, 16, SURFACE.minaret, TURQUOISE)
    m.lathe(mx, mz, MOSQUE.minaret - 0.12, scaled(FINIAL, 0.5, 0.5), 8, SURFACE.stone, GOLD, { extra: 0.9 })
  }
}

function fountain(m: Mass): void {
  const { x, z, r } = FOUNTAIN
  m.rising(0, 2, 0.82, 0.14, FLOOD.street)
  // The rim of the basin, and inside it a bowl on a stem that the jets fall into.
  m.lathe(x, z, 0, [[r + 0.6, 0], [r + 0.6, 0.42], [r + 0.42, 0.56], [r + 0.06, 0.56], [r, 0.44], [r, 0.1]], 48, SURFACE.stone, MARBLE, { crisp: true, extra: 0.4 })
  m.lathe(x, z, 0, [[1.0, 0.1], [0.7, 0.7], [0.55, 1.1], [1.9, 1.52], [2.2, 1.74], [2.04, 1.74], [1.9, 1.6]], 32, SURFACE.stone, MARBLE, { crisp: true, extra: 0.4 })
}

function flagpole(m: Mass): void {
  m.rising(0, FLAG.pole + 1, 0.8, 0.18, FLOOD.street)
  m.lathe(FLAG.x, FLAG.z, 0, [[0.95, 0], [0.95, 0.5], [0.62, 0.5], [0.62, 0.9], [0.2, 0.9], [0.17, 1.2], [0.1, FLAG.pole]], 12, SURFACE.stone, POLE, { crisp: true, extra: 0.6 })
  m.lathe(FLAG.x, FLAG.z, FLAG.pole - 0.04, ball(0.24), 10, SURFACE.stone, GOLD, { extra: 0.9 })
}

/** The lamp posts the crossing's lights hang on: the one on the far kerb before the square, the one on the near kerb past it. */
export const SIGNAL_POSTS = {
  far: { x: Math.floor(390 / LAMP_GAP) * LAMP_GAP, z: STREET_Z - ROAD - 0.5 },
  near: { x: Math.floor(390 / LAMP_GAP) * LAMP_GAP + LAMP_GAP / 2, z: STREET_Z + ROAD + 0.5 },
} as const

function signals(m: Mass): void {
  m.rising(0, 4.2, 0.86, 0.1, FLOOD.street)
  const head = (cx: number, cz: number, y0: number, wide: number, high: number, facing: 'east' | 'west' | 'south', extra: number): void => {
    const x0 = cx - wide / 2
    const x1 = cx + wide / 2
    const z0 = cz - wide / 2
    const z1 = cz + wide / 2
    const y1 = y0 + high
    const kindOf = (side: string) => (side === facing ? SURFACE.signal : SURFACE.stone)
    m.wall(x0, z1, x1, z1, y0, y1, kindOf('south'), CASE, extra)
    m.wall(x1, z1, x1, z0, y0, y1, kindOf('east'), CASE, extra)
    m.wall(x1, z0, x0, z0, y0, y1, SURFACE.stone, CASE, extra)
    m.wall(x0, z0, x0, z1, y0, y1, kindOf('west'), CASE, extra)
    m.slab(x0, z0, x1, z1, y1, CASE)
  }
  const { far, near } = SIGNAL_POSTS
  // For the traffic coming each way, three lamps; for whoever is waiting to cross, two.
  head(far.x, far.z + 0.34, 3.1, 0.34, 0.96, 'east', 0)
  head(near.x, near.z - 0.34, 3.1, 0.34, 0.96, 'west', 0)
  head(far.x + 0.34, far.z, 2.3, 0.3, 0.62, 'south', 1)
}

/** Everything of the square and the skyline that stands still, as one pile. */
export function buildTashkent(): Mass {
  const m = new Mass()
  tower(m)
  mosque(m)
  fountain(m)
  flagpole(m)
  signals(m)
  return m
}

// ----------------------------------------------------------------- shaders

const LIGHT_PARS = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uLightDir;
  uniform vec3 uAmbient;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform float uLamps;
  uniform float uTime;
  ${EVO_NOISE}
  ${STREET_GLSL}
  ${CITY_LIGHT_GLSL}

  // How much of the light that falls on these comes back, set by eye against
  // the ground they stand on and the blocks they stand among.
  const float DAY = 0.52;

  vec3 evoSkyAt(vec3 dir) {
    return mix(uHorizon, uZenith, clamp(dir.y * 1.4 + 0.15, 0.0, 1.0));
  }

  // The sun or the moon and the sky on a surface, and what a polished one shows of both.
  vec3 evoDaylight(vec3 albedo, vec3 n, vec3 view, float gloss, float occ) {
    float sunward = max(dot(n, uLightDir), 0.0);
    vec3 sky = uAmbient * (0.4 + 0.6 * (0.5 + 0.5 * n.y)) * occ;
    vec3 lit = albedo * DAY * (sky + uLight * sunward);
    vec3 halfway = normalize(uLightDir - view);
    lit += uLight * pow(max(dot(n, halfway), 0.0), mix(18.0, 260.0, gloss)) * gloss * 0.4 * step(0.001, sunward);
    float fresnel = pow(1.0 - max(dot(-view, n), 0.0), 4.0);
    lit += evoSkyAt(reflect(view, n)) * fresnel * gloss * 0.4 * occ;
    return lit;
  }
`

const MASS_VERT = /* glsl */ `
  attribute vec4 aSurface;
  attribute vec3 aDim;
  attribute vec3 aTint;
  attribute vec4 aGrow;
  uniform float uCity;
  varying vec3 vEvoWorld;
  varying vec3 vNormal;
  varying vec4 vSurface;
  varying vec3 vDim;
  varying vec3 vTint;
  varying float vRise;
  void main() {
    // Up out of the ground on its own beat, top first, as the blocks' roofs
    // come: lifted whole and not stretched, or a dome on its way up is a dish.
    float rise = smoothstep(aGrow.z, aGrow.z + aGrow.w, uCity);
    vec3 at = position;
    at.y -= (1.0 - rise) * aGrow.y;
    vRise = at.y - aGrow.x;
    vEvoWorld = at;
    vNormal = normal;
    vSurface = aSurface;
    vDim = aDim;
    vTint = aTint;
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`

const MASS_FRAG = /* glsl */ `
  uniform float uHeld;
  varying vec3 vNormal;
  varying vec4 vSurface;
  varying vec3 vDim;
  varying vec3 vTint;
  varying float vRise;
  ${LIGHT_PARS}

  const vec3 MARBLE = ${glsl(MARBLE)};
  const vec3 GRANITE = ${glsl(GRANITE)};
  const vec3 WHITE = ${glsl(lin(0.94, 0.93, 0.89))};
  const vec3 TURQ = ${glsl(TURQUOISE)};
  const vec3 TURQ_DEEP = ${glsl(lin(0.05, 0.47, 0.55))};
  const vec3 TURQ_PALE = ${glsl(lin(0.2, 0.74, 0.76))};
  const vec3 COBALT = ${glsl(lin(0.08, 0.2, 0.55))};
  const vec3 OCHRE = ${glsl(lin(0.85, 0.66, 0.24))};
  const vec3 GLASS = ${glsl(lin(0.08, 0.11, 0.16))};
  const vec3 WALNUT = ${glsl(lin(0.3, 0.17, 0.09))};
  const vec3 STEEL = ${glsl(STEEL)};
  const vec3 MAST_RED = ${glsl(RED)};
  const vec3 WARM = vec3(1.0, 0.72, 0.38);
  const vec3 COOL = vec3(0.8, 0.92, 1.0);

  // Under a pointed arch, negative: 'p' from the middle of its sill, 'a' half
  // its width, 's' the height it springs from. Its point is 1.38 'a' above that.
  float evoArch(vec2 p, float a, float s) {
    p.x = abs(p.x);
    float r = a * 1.45;
    return p.y < s ? p.x - a : length(p - vec2(a - r, s)) - r;
  }

  // Tilework: an eight-pointed star in every tile and white strapwork between
  // them. 'p' in tiles; 'px' how much of a tile one pixel covers.
  vec3 evoTiles(vec2 p, float px) {
    vec2 q = abs(fract(p) - 0.5);
    float star = min(max(q.x, q.y), (q.x + q.y) * 0.70710678);
    float w = 0.02 + px;
    float strap = 1.0 - smoothstep(0.035, 0.035 + w, abs(star - 0.31));
    float eye = 1.0 - smoothstep(0.1, 0.1 + w, star);
    vec3 c = mix(TURQ, COBALT, 1.0 - smoothstep(0.31, 0.31 + w, star));
    c = mix(c, OCHRE, eye * 0.85);
    c = mix(c, WHITE, strap);
    // Too far off to be read: the one colour all of it comes to.
    return mix(c, mix(TURQ, COBALT, 0.4) * 1.1, smoothstep(0.3, 0.9, px));
  }

  // Marble in courses: 'uv' in metres, 'px' the metres one pixel covers.
  vec3 evoMarble(vec2 uv, float px) {
    vec3 c = MARBLE * (0.9 + 0.14 * evoFbm(uv * vec2(0.4, 1.1) + 3.0));
    vec2 block = vec2(uv.x / 1.3 + 0.5 * floor(uv.y / 0.65), uv.y / 0.65);
    float close = 1.0 - smoothstep(0.015, 0.07, px);
    float joint = max(step(0.985, fract(block.x)), step(0.965, fract(block.y)));
    return c * (1.0 - 0.14 * joint * close) * (1.0 + 0.06 * (evoHash(floor(block)) - 0.5) * close);
  }

  // A pierced screen: how open it is at a point, 'p' in its cells.
  float evoLattice(vec2 p, float px) {
    vec2 q = abs(fract(p) - 0.5);
    float star = min(max(q.x, q.y), (q.x + q.y) * 0.70710678);
    float bar = 1.0 - smoothstep(0.05, 0.07 + px, abs(star - 0.3));
    return 1.0 - mix(bar, 0.42, smoothstep(0.25, 0.8, px));
  }

  // The walls of the hall and its wings: an arcade of pointed niches, each
  // with a lattice in it, under a frieze of tile.
  void evoHall(vec2 uv, vec2 dim, inout vec3 albedo, inout float gloss, inout vec3 emit, inout float occ) {
    float px = fwidth(uv.x) + fwidth(uv.y);
    float top = dim.y;
    albedo = evoMarble(uv, px);
    gloss = 0.22;
    albedo = mix(GRANITE * (0.9 + 0.2 * evoNoise(uv * 3.0)), albedo, smoothstep(0.78, 0.82, uv.y));
    float tall = min(1.4, top * 0.13);
    float foot = top - 0.32 - tall;
    if (uv.y > foot && uv.y < foot + tall) {
      float tile = tall / 3.0;
      albedo = evoTiles(vec2(uv.x, uv.y - foot) / tile, px / tile);
      gloss = 0.6;
    }
    float trim = max(1.0 - smoothstep(0.035, 0.055 + px, abs(uv.y - foot + 0.1)), 1.0 - smoothstep(0.035, 0.055 + px, abs(uv.y - foot - tall - 0.1)));
    albedo = mix(albedo, COBALT, trim);

    float bays = max(1.0, floor(dim.x / 4.7 + 0.5));
    float bay = dim.x / bays;
    float x = (fract(uv.x / bay) - 0.5) * bay;
    float a = min(bay * 0.31, top * 0.2);
    float s = top * 0.5 - 0.82;
    float y = uv.y - 0.82;
    if (y > 0.0) {
      float d = evoArch(vec2(x, y), a, s);
      if (d < 0.0) {
        // Set back: in its own shade under the arch and down its sides.
        occ *= mix(0.5, 0.86, smoothstep(0.0, 0.55, -d));
        albedo *= 0.97;
        float dw = evoArch(vec2(x, y), a - 0.34, s);
        if (dw < 0.0 && y > s * 0.34) {
          float open = evoLattice(vec2(x, y) / 0.38, px / 0.38);
          float lit = 0.7 + 0.3 * evoHash(vec2(floor(uv.x / bay), dim.x));
          albedo = mix(albedo, GLASS, open);
          gloss = mix(gloss, 0.8, open);
          emit += WARM * open * uLamps * 1.5 * lit;
        } else if (dw < 0.07 && y > s * 0.34 - 0.07) {
          albedo = mix(albedo, COBALT, 0.85);
        }
      } else if (d < 0.15) {
        // A line of turquoise round the niche.
        albedo = d < 0.04 ? COBALT : TURQ;
        gloss = 0.55;
      }
    }
  }

  // The portal: a frame of tile round one great arch, and at the back of the
  // arch, in its shade, the door.
  void evoPortal(vec2 uv, vec2 dim, inout vec3 albedo, inout float gloss, inout vec3 emit, inout float occ) {
    float px = fwidth(uv.x) + fwidth(uv.y);
    float x = uv.x - dim.x * 0.5;
    float y = uv.y;
    albedo = evoMarble(uv, px);
    gloss = 0.25;
    albedo = mix(GRANITE * (0.9 + 0.2 * evoNoise(uv * 3.0)), albedo, smoothstep(0.78, 0.82, y));
    float edge = min(dim.x * 0.5 - abs(x), dim.y - y);
    float inset = 0.5;
    float band = 0.95;
    if (edge > inset && edge < inset + band && y > 0.82) {
      float tile = band / 2.0;
      albedo = evoTiles(uv / tile, px / tile);
      gloss = 0.6;
    }
    float trim = max(1.0 - smoothstep(0.035, 0.055 + px, abs(edge - inset + 0.09)), 1.0 - smoothstep(0.035, 0.055 + px, abs(edge - inset - band - 0.09)));
    albedo = mix(albedo, COBALT, trim * step(0.82, y));

    float a = dim.x * 0.5 - (inset + band + 0.62);
    float s = dim.y * 0.46;
    float apex = s + a * 1.378;
    float d = evoArch(vec2(x, y), a, s);
    if (d < 0.0) {
      // The iwan: deep, its vault in shadow, the door at the back of it.
      float deep = smoothstep(0.0, 1.5, -d);
      occ *= mix(0.42, 0.76, deep);
      albedo = evoMarble(uv * 1.3 + 7.0, px);
      gloss = 0.2;
      if (y > s - 0.4) {
        // The vault is cut into cells, and each catches the light its own way.
        vec2 from = vec2(x, y - s + 2.0);
        vec2 cell = abs(fract(vec2(atan(from.x, from.y) * 7.0, length(from) * 1.9)) - 0.5);
        float facet = smoothstep(0.5, 0.15, max(cell.x, cell.y));
        float fine = 1.0 - smoothstep(0.1, 0.5, px);
        albedo *= 0.8 + 0.26 * mix(0.5, facet, fine);
        albedo = mix(albedo, TURQ, 0.24 * (1.0 - facet) * fine);
      }
      float door = evoArch(vec2(x, y - 0.0), 1.4, 3.4);
      float light = evoArch(vec2(x, y - 6.3), 0.95, 1.15);
      if (door < 0.0) {
        // Two leaves of carved walnut.
        vec2 panel = abs(fract(vec2(abs(x) / 0.7, y / 1.05)) - 0.5);
        float star = min(max(panel.x, panel.y), (panel.x + panel.y) * 0.70710678);
        float fine = 1.0 - smoothstep(0.03, 0.2, px);
        albedo = WALNUT * (0.75 + 0.5 * evoNoise(vec2(x * 9.0, y * 1.3)));
        albedo *= 1.0 + 0.45 * fine * (smoothstep(0.34, 0.3, star) - 0.5);
        albedo *= 1.0 - 0.7 * (1.0 - smoothstep(0.012, 0.03 + px, abs(x)));
        gloss = 0.4;
      } else if (door < 0.17) {
        albedo = COBALT;
        gloss = 0.6;
      } else if (light < 0.0) {
        float open = evoLattice(vec2(x, y) / 0.3, px / 0.3);
        albedo = mix(albedo, GLASS, open);
        emit += WARM * open * uLamps * 1.8;
      } else if (light < 0.1) {
        albedo = COBALT;
      }
      // There are lamps in there, and they are the first thing lit.
      emit += albedo * WARM * uLamps * 0.75 * deep;
    } else if (d < 0.26) {
      albedo = d < 0.06 || d > 0.2 ? COBALT : TURQ;
      gloss = 0.55;
    } else if (y > s - 0.3 && y < apex + 0.9 && edge > inset + band + 0.22) {
      // The corners over the arch, in tile set on the diagonal.
      albedo = evoTiles(vec2(x + y, x - y) * 0.70710678 / 0.44, px / 0.44);
      gloss = 0.6;
    }
  }

  // The dome: glazed, ribbed from its foot to its point, a band of tile round the foot.
  void evoDome(vec2 uv, vec2 dim, inout vec3 albedo, inout float gloss, inout vec3 emit) {
    float t = uv.y / dim.y;
    float ribs = 32.0;
    float crest = 1.0 - abs(fract(uv.x * ribs) - 0.5) * 2.0;
    crest = mix(crest, 0.5, smoothstep(0.35, 1.1, fwidth(uv.x) * ribs));
    albedo = mix(TURQ_DEEP, TURQ_PALE, crest);
    float course = fwidth(uv.y) * 4.0;
    albedo *= 0.93 + 0.1 * mix(evoHash(floor(vec2(uv.x * ribs * 3.0, uv.y * 4.0))), 0.5, smoothstep(0.3, 1.0, course));
    if (t < 0.1) {
      float tile = dim.y * 0.1 / 3.0;
      float round = uv.x * 6.2831853 * dim.x;
      albedo = evoTiles(vec2(round, uv.y) / tile, (fwidth(round) + fwidth(uv.y)) / tile);
    }
    gloss = 0.78;
    // Lit from the roof round it, so brightest at the foot.
    emit += albedo * COOL * uLamps * (0.52 - 0.24 * t);
  }

  void evoDrum(vec2 uv, vec2 dim, inout vec3 albedo, inout float gloss, inout vec3 emit) {
    float round = uv.x * 6.2831853 * dim.x;
    float px = fwidth(round) + fwidth(uv.y);
    albedo = evoMarble(vec2(round, uv.y), px);
    gloss = 0.22;
    float bay = 6.2831853 * dim.x / 16.0;
    float x = (fract(uv.x * 16.0) - 0.5) * bay;
    float y = uv.y - 0.75;
    float d = evoArch(vec2(x, y), 0.5, 1.4);
    if (y > 0.0 && d < 0.0) {
      float open = evoLattice(vec2(x, y) / 0.26, px / 0.26);
      albedo = mix(albedo, GLASS, open);
      gloss = mix(gloss, 0.8, open);
      emit += WARM * open * uLamps * 1.5;
    } else if (y > -0.08 && d < 0.09) {
      albedo = COBALT;
    }
    if (uv.y > dim.y - 1.1 && uv.y < dim.y - 0.45) {
      float tile = 0.325;
      albedo = evoTiles(vec2(round, uv.y - dim.y + 1.1) / tile, px / tile);
      gloss = 0.6;
    }
    emit += albedo * COOL * uLamps * 0.22;
  }

  void evoMinaret(vec2 uv, inout vec3 albedo, inout float gloss, inout vec3 emit) {
    float y = uv.y;
    float round = uv.x * 6.2831853 * 1.3;
    float px = fwidth(round) + fwidth(y);
    albedo = evoMarble(vec2(round, y), px);
    gloss = 0.22;
    if (y < 2.6) albedo = mix(GRANITE, albedo, smoothstep(0.5, 0.56, y));
    // Two bands of tile on the shaft, each between two lines of blue.
    float band = min(abs(y - 9.2), abs(y - 17.4));
    if (band < 0.62) {
      albedo = evoTiles(vec2(round, y) / 0.4133, px / 0.4133);
      gloss = 0.6;
    } else if (band < 0.75) {
      albedo = COBALT;
    }
    if (y > 22.6 && y < 24.3) {
      // The corbel that holds the gallery out, fluted in two colours.
      float flute = step(0.5, fract(uv.x * 20.0));
      albedo = mix(TURQ, WHITE, mix(flute, 0.5, smoothstep(0.3, 1.0, fwidth(uv.x) * 20.0)));
      gloss = 0.5;
    } else if (y >= 24.3 && y < 25.3) {
      // The gallery's parapet, pierced.
      vec2 q = abs(fract(vec2(uv.x * 26.0, (y - 24.3) / 0.5)) - 0.5);
      float hole = 1.0 - smoothstep(0.2, 0.27, max(q.x, q.y));
      albedo *= 1.0 - 0.65 * mix(hole, 0.3, smoothstep(0.3, 1.0, fwidth(uv.x) * 26.0));
    } else if (y >= 25.3 && y < 28.2) {
      // The lantern: eight openings, dark by day and lit by night.
      float bay = 6.2831853 * 1.2 / 8.0;
      float x = (fract(uv.x * 8.0) - 0.5) * bay;
      if (y > 25.55 && evoArch(vec2(x, y - 25.55), 0.28, 1.5) < 0.0) {
        albedo = vec3(0.012);
        gloss = 0.0;
        emit += WARM * uLamps * 2.6;
      }
    } else if (y >= 28.79) {
      float crest = 1.0 - abs(fract(uv.x * 16.0) - 0.5) * 2.0;
      albedo = mix(TURQ_DEEP, TURQ_PALE, mix(crest, 0.5, smoothstep(0.35, 1.1, fwidth(uv.x) * 16.0)));
      gloss = 0.78;
      emit += albedo * COOL * uLamps * 0.42;
    }
  }

  // The tower's shaft: steel in facets, two pods with their rows of windows,
  // and above them the mast in the red and white anything that tall is painted.
  void evoShaft(vec2 uv, inout vec3 albedo, inout float gloss, inout vec3 emit) {
    float y = uv.y;
    float face = abs(fract(uv.x * 12.0) - 0.5) * 2.0;
    albedo = STEEL * (0.86 + 0.14 * face) * (0.92 + 0.08 * step(0.1, fract(y / 9.0)));
    gloss = 0.3;
    bool lower = y > 96.5 && y < 113.0;
    bool upper = y > 213.5 && y < 220.5;
    if (lower || upper) {
      float row = lower ? (y - 96.5) / 4.125 : (y - 213.5) / 3.5;
      float pane = step(0.22, fract(row)) * step(fract(row), 0.78) * step(0.12, fract(uv.x * 60.0));
      float lit = step(0.3, evoHash(vec2(floor(uv.x * 60.0), floor(row) + (lower ? 0.0 : 9.0))));
      albedo = mix(albedo, GLASS, pane);
      gloss = mix(gloss, 0.85, pane);
      emit += WARM * pane * uLamps * (0.5 + 1.5 * lit);
    }
    if (y > 228.0) {
      albedo = mod(floor((y - 228.0) / 14.7), 2.0) < 0.5 ? MAST_RED : WHITE;
      gloss = 0.3;
    }
  }

  // A lamp head at the crossing: three lamps for the traffic, two for whoever is on foot.
  void evoSignal(vec2 uv, vec2 dim, float walk, inout vec3 albedo, inout float gloss, inout vec3 emit) {
    albedo = vec3(0.012);
    gloss = 0.3;
    float count = walk > 0.5 ? 2.0 : 3.0;
    float cell = dim.y / count;
    float i = floor(uv.y / cell);
    vec2 c = vec2(uv.x - dim.x * 0.5, uv.y - (i + 0.5) * cell);
    float disc = 1.0 - smoothstep(0.34, 0.42, length(c) / cell);
    vec3 red = vec3(1.0, 0.07, 0.04);
    vec3 amber = vec3(1.0, 0.55, 0.05);
    vec3 green = vec3(0.08, 1.0, 0.35);
    float stop = smoothstep(0.5, 0.6, uHeld);
    float warn = smoothstep(0.06, 0.12, uHeld) * (1.0 - stop);
    float cross = smoothstep(0.7, 0.78, uHeld);
    vec3 lamp;
    float on;
    if (walk > 0.5) {
      lamp = i > 0.5 ? red : green;
      on = i > 0.5 ? 1.0 - cross : cross;
    } else {
      lamp = i > 1.5 ? red : i > 0.5 ? amber : green;
      on = i > 1.5 ? stop : i > 0.5 ? warn : (1.0 - stop) * (1.0 - warn);
    }
    albedo = mix(albedo, lamp * 0.04, disc);
    emit += lamp * disc * on * 3.4;
  }

  void main() {
    // Whatever of it has not come up yet is under the ground.
    if (vRise < -2.2) discard;
    float kind = vSurface.x;
    vec2 uv = vSurface.yz;
    vec3 n = normalize(vNormal);
    vec3 view = normalize(vEvoWorld - cameraPosition);
    vec3 albedo = vTint;
    float gloss = vSurface.w;
    vec3 emit = vec3(0.0);
    float occ = 1.0;
    if (kind < 0.5) {
      albedo *= 0.93 + 0.12 * evoNoise(vEvoWorld.xz * 1.7 + vEvoWorld.y * 2.3);
    } else if (kind < 1.5) {
      evoHall(uv, vDim.xy, albedo, gloss, emit, occ);
    } else if (kind < 2.5) {
      evoPortal(uv, vDim.xy, albedo, gloss, emit, occ);
    } else if (kind < 3.5) {
      evoDome(uv, vDim.xy, albedo, gloss, emit);
    } else if (kind < 4.5) {
      evoDrum(uv, vDim.xy, albedo, gloss, emit);
    } else if (kind < 5.5) {
      evoMinaret(uv, albedo, gloss, emit);
    } else if (kind < 6.5) {
      evoShaft(uv, albedo, gloss, emit);
    } else if (kind < 7.5) {
      // A red light that comes and goes, and is never quite out.
      albedo = vec3(0.02);
      gloss = 0.0;
      emit += vTint * (0.25 + 0.75 * (0.5 + 0.5 * sin(uTime * 2.2 + vSurface.w))) * (0.3 + 0.7 * uLamps) * 9.0;
    } else {
      evoSignal(uv, vDim.xy, vSurface.w, albedo, gloss, emit);
    }

    vec3 lit = evoDaylight(albedo, n, view, gloss, occ);
    if (uLamps > 0.001) {
      vec3 night;
      float up = max(vEvoWorld.y, 0.0);
      if (vDim.z < 0.5) {
        night = (evoStreetLight(vEvoWorld, n, 0.2) + evoLanternLight(vEvoWorld, n, 0.2)) * 0.42;
      } else if (vDim.z < 1.5) {
        // Floodlights at its foot: warm, and thinner the higher they have to reach.
        night = vec3(1.0, 0.9, 0.74) * (0.2 + 0.8 * exp(-up / 10.0));
      } else {
        night = vec3(0.74, 0.86, 1.0) * (0.06 + 0.5 * exp(-up / 110.0));
      }
      lit += albedo * night * uLamps * occ;
    }
    lit += emit;
    gl_FragColor = vec4(evoAir(lit), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const FLAG_HEIGHT = FLAG.length / 2
/** How many flat pieces the curtain of water round the fountain's bowl is made of. */
const CURTAIN = 28

const FLAG_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uCity;
  varying vec3 vEvoWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    float s = uv.x;
    // Run up the pole once the pole is there.
    float hoisted = smoothstep(0.93, 1.0, uCity);
    vec3 at = position;
    at.y -= (1.0 - hoisted) * ${(FLAG.pole - FLAG_HEIGHT - 1.4).toFixed(2)};
    // Waves that run out from the hoist and grow as they go.
    float a = s * 7.6 - uTime * 4.4 + uv.y * 1.3;
    float b = s * 13.0 - uTime * 7.3 + uv.y * 2.9 + 1.7;
    float wave = sin(a) * 0.5 + sin(b) * 0.22;
    float slope = cos(a) * 3.8 + cos(b) * 2.86;
    float reach = 0.42 * pow(s, 0.8);
    at.z += wave * reach;
    at.y -= s * s * 0.45 + wave * 0.07 * s;
    at.x -= s * s * 0.3;
    vNormal = normalize(vec3(-(slope * reach + wave * 0.34 * pow(max(s, 0.02), -0.2)) / ${FLAG.length.toFixed(2)}, 0.0, 1.0));
    vEvoWorld = at;
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`

/**
 * The flag of Uzbekistan, to its own measure: blue, white and green in equal
 * bands with a red line between each, and in the blue by the hoist a crescent
 * and twelve stars in rows of three, four and five, lined up at their fly end.
 */
const FLAG_FRAG = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  ${LIGHT_PARS}

  // A five-pointed star, negative inside.
  float evoStar5(vec2 p, float r) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = 0.382 * vec2(0.587785252292, 0.809016994375) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
  }

  void main() {
    // In the flag's own units: 250 high and 500 long, from the top of the hoist.
    vec2 p = vec2(vUv.x * 500.0, (1.0 - vUv.y) * 250.0);
    float px = fwidth(p.x) + fwidth(p.y);
    vec3 blue = ${glsl(lin(0, 0.6, 0.71))};
    vec3 white = ${glsl(lin(0.97, 0.97, 0.97))};
    vec3 green = ${glsl(lin(0.118, 0.71, 0.227))};
    vec3 red = ${glsl(lin(0.808, 0.067, 0.149))};
    vec3 c = p.y < 80.0 ? blue : p.y < 85.0 ? red : p.y < 165.0 ? white : p.y < 170.0 ? red : green;
    if (p.y < 80.0) {
      float moon = max(length(p - vec2(70.0, 40.0)) - 30.0, 25.0 - length(p - vec2(79.0, 40.0)));
      float mark = moon;
      for (int row = 0; row < 3; row++) {
        for (int col = 0; col < 5; col++) {
          if (col < 2 - row) continue;
          vec2 q = p - vec2(114.0 + float(col) * 24.0, 16.0 + float(row) * 24.0);
          mark = min(mark, evoStar5(vec2(q.x, -q.y), 6.0));
        }
      }
      c = mix(c, white, 1.0 - smoothstep(-px * 0.5, px * 0.5, mark));
    }
    vec3 n = normalize(vNormal);
    vec3 view = normalize(vEvoWorld - cameraPosition);
    if (dot(n, view) > 0.0) n = -n;
    // Cloth: the light comes through it as well as off it.
    float through = max(dot(-n, uLightDir), 0.0) * 0.55;
    vec3 sky = uAmbient * (0.55 + 0.25 * n.y);
    vec3 lit = c * DAY * (sky + uLight * (max(dot(n, uLightDir), 0.0) + through));
    // And after dark a lamp at the foot of the pole is turned up at it.
    lit += c * vec3(1.0, 0.95, 0.86) * uLamps * (0.5 + 0.3 * abs(n.z));
    gl_FragColor = vec4(evoAir(lit), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const WATER_VERT = /* glsl */ `
  varying vec3 vEvoWorld;
  void main() {
    vEvoWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vEvoWorld, 1.0);
  }
`

const WATER_FRAG = /* glsl */ `
  uniform float uFlow;
  ${LIGHT_PARS}
  void main() {
    if (uFlow < 0.02) discard;
    vec3 at = vEvoWorld;
    vec2 c = at.xz - vec2(${FOUNTAIN.x.toFixed(1)}, ${FOUNTAIN.z.toFixed(1)});
    float r = length(c);
    // Rings going out from where the jets come down, and the wind's own chop.
    vec2 g = vec2(evoNoise(at.xz * 3.1 + vec2(uTime * 0.7, 0.0)), evoNoise(at.xz * 3.1 + vec2(7.3, uTime * 0.6))) - 0.5;
    g = g * 0.5 + (c / max(r, 0.01)) * sin(r * 9.0 - uTime * 5.0) * 0.13;
    vec3 n = normalize(vec3(g.x, 1.0, g.y));
    vec3 view = normalize(at - cameraPosition);
    float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(-view, n), 0.0), 5.0);
    // The basin is tiled, and that is the colour of the water in it.
    vec3 deep = ${glsl(lin(0.08, 0.42, 0.46))} * DAY * (uAmbient + uLight * max(uLightDir.y, 0.0));
    vec3 lit = mix(deep, evoSkyAt(reflect(view, n)), fresnel);
    lit += uLight * pow(max(dot(n, normalize(uLightDir - view)), 0.0), 320.0) * 1.6;
    // Lit from under after dark, brightest round each jet.
    float ring = exp(-pow((r - 4.5) / 0.8, 2.0)) + exp(-r * r / 3.0);
    lit += ${glsl(lin(0.3, 0.86, 0.92))} * uLamps * (0.16 + 0.6 * ring) * (0.85 + 0.6 * g.x);
    gl_FragColor = vec4(evoAir(lit), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const JET_VERT = /* glsl */ `
  attribute vec4 aJet;
  uniform float uFlow;
  varying vec3 vEvoWorld;
  varying vec4 vJet;
  void main() {
    vJet = aJet;
    vec3 at = position;
    // Turned on from nothing: the arcs grow from their nozzles.
    at.y = 0.5 + (at.y - 0.5) * uFlow;
    vEvoWorld = at;
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`

const JET_FRAG = /* glsl */ `
  uniform float uFlow;
  varying vec4 vJet;
  ${LIGHT_PARS}
  void main() {
    float along = vJet.x;
    float across = vJet.y;
    float which = vJet.z;
    float body = 1.0 - across * across;
    float alpha;
    if (vJet.w < 0.5) {
      // An arc: a solid thread where it leaves the nozzle, broken into drops by the time it lands.
      float thread = 0.45 + 0.55 * evoNoise(vec2(across * 2.0 + which * 3.1, along * 9.0 - uTime * 3.4));
      float drops = step(0.42, evoNoise(vec2(across * 5.0 + which, along * 34.0 - uTime * 7.0)));
      alpha = body * thread * mix(1.0, drops, smoothstep(0.45, 1.0, along)) * smoothstep(0.0, 0.05, along);
    } else if (vJet.w < 1.5) {
      // The plume in the middle: thick at the foot, torn at the top.
      float torn = evoNoise(vec2(across * 1.6 + which * 5.0, along * 5.0 - uTime * 2.6));
      alpha = body * body * (0.28 + 0.5 * torn) * (1.0 - smoothstep(0.5, 1.0, along));
    } else {
      // What runs over the rim of the bowl: threads of it, with air between.
      float thread = evoNoise(vec2((which * ${CURTAIN}.0 + across * 0.5) * 7.0, along * 2.5 - uTime * 3.5));
      alpha = 0.04 + 0.5 * thread * thread * thread;
    }
    alpha *= uFlow;
    if (alpha < 0.01) discard;
    vec3 view = normalize(vEvoWorld - cameraPosition);
    // Water in the air is white, and whiter looked at towards the light.
    float towards = pow(max(dot(view, uLightDir), 0.0), 4.0);
    vec3 lit = vec3(0.9) * DAY * (uAmbient * 1.25 + uLight * (0.45 + 1.4 * towards));
    float high = clamp((vEvoWorld.y - 0.5) / 5.0, 0.0, 1.0);
    lit += ${glsl(lin(0.62, 0.92, 1.0))} * uLamps * (0.5 - 0.26 * high);
    gl_FragColor = vec4(evoAir(lit), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const SIGN_VERT = /* glsl */ `
  varying vec3 vEvoWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vEvoWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vEvoWorld, 1.0);
  }
`

const SIGN_FRAG = /* glsl */ `
  uniform sampler2D uWord;
  uniform vec3 uFacing;
  varying vec2 vUv;
  ${LIGHT_PARS}
  void main() {
    float ink = texture2D(uWord, vUv).a;
    if (ink < 0.04) discard;
    // Letters that are white by day and lit from inside by night.
    vec3 lit = vec3(0.86) * DAY * (uAmbient + uLight * max(dot(uFacing, uLightDir), 0.0));
    lit += vec3(0.5, 0.8, 1.0) * uLamps * 2.6;
    gl_FragColor = vec4(evoAir(lit), ink);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// -------------------------------------------------------------------- parts

/** The name on the hotel's roof. */
export const HOTEL_NAME = 'OʻZBEKISTON'
/**
 * Where it stands: along the top of the hotel's end wall, the one the walk
 * comes towards. A name set along the street would be read by nobody walking
 * down it, and one set back from the edge of a roof sixty metres up is hidden
 * by that edge from anyone on the ground.
 */
export const SIGN = (() => {
  const third = HOTEL.length / 3
  // The wing at that end, as `towers()` lays it: turned in by the hotel's bend.
  const cx = HOTEL.x - third * Math.cos(HOTEL.bend * 0.5)
  const cz = HOTEL.z + third * Math.sin(HOTEL.bend) * 0.5
  const half = (third + 0.8) / 2
  return {
    x: cx - Math.cos(HOTEL.bend) * (half + 0.15),
    z: cz + Math.sin(HOTEL.bend) * (half + 0.15),
    width: HOTEL.depth - 1.4,
    height: 2.3,
    turn: -(Math.PI / 2 - HOTEL.bend),
  }
})()

function drawName(canvas: HTMLCanvasElement): void {
  canvas.width = 1024
  canvas.height = Math.round((1024 * SIGN.height) / SIGN.width)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  let size = 112
  do {
    ctx.font = `800 ${size}px Manrope, "Manrope Variable", system-ui, sans-serif`
    size -= 2
  } while (size > 40 && ctx.measureText(HOTEL_NAME).width > canvas.width - 40)
  ctx.fillText(HOTEL_NAME, canvas.width / 2, canvas.height / 2 + 4)
}

/** The fountain's water in the air: arcs from the rim to the bowl, a plume out of the bowl, and what runs over its edge. */
function jets(): BufferGeometry {
  const position: number[] = []
  const jet: number[] = []
  const index: number[] = []
  const { x, z } = FOUNTAIN
  const put = (px: number, py: number, pz: number, along: number, across: number, which: number, kind: number): number => {
    position.push(px, py, pz)
    jet.push(along, across, which, kind)
    return position.length / 3 - 1
  }
  const strip = (count: number, at: (s: number, side: number) => readonly [number, number, number], which: number, kind: number): void => {
    let before = -1
    for (let i = 0; i <= count; i++) {
      const s = i / count
      const a = at(s, -1)
      const b = at(s, 1)
      const left = put(a[0], a[1], a[2], s, -1, which, kind)
      put(b[0], b[1], b[2], s, 1, which, kind)
      if (before >= 0) index.push(before, before + 1, left + 1, before, left + 1, left)
      before = left
    }
  }
  // The arcs: from nozzles inside the rim, up and over into the bowl.
  const arcs = 14
  for (let j = 0; j < arcs; j++) {
    const a = (j / arcs) * Math.PI * 2
    const c = Math.cos(a)
    const s0 = Math.sin(a)
    const path = (s: number): readonly [number, number] => [4.5 - 2.6 * s, 0.5 + 1.2 * s + 9.6 * s * (1 - s)]
    // Two ribbons to each, at right angles, so that it has some width from any side.
    strip(12, (s, side) => {
      const [r, y] = path(s)
      const w = 0.07 + 0.06 * s
      return [x + c * r - s0 * side * w, y, z + s0 * r + c * side * w]
    }, j, 0)
    strip(12, (s, side) => {
      const [r, y] = path(s)
      const [r2, y2] = path(Math.min(1, s + 0.02))
      const [r1, y1] = path(Math.max(0, s - 0.02))
      const length = Math.hypot(r2 - r1, y2 - y1) || 1
      const w = (0.07 + 0.06 * s) * side
      const nr = (-(y2 - y1) / length) * w
      const ny = ((r2 - r1) / length) * w
      return [x + c * (r + nr), y + ny, z + s0 * (r + nr)]
    }, j + 0.5, 0)
  }
  // The plume: three sheets through the axis.
  for (let j = 0; j < 3; j++) {
    const a = (j / 3) * Math.PI
    strip(8, (s, side) => {
      const w = (0.1 + 0.34 * s * s) * side
      return [x + Math.cos(a) * w, 1.7 + s * 3.9, z + Math.sin(a) * w]
    }, j, 1)
  }
  // And the curtain off the bowl's rim, all the way round.
  const round = CURTAIN
  for (let j = 0; j < round; j++) {
    const at = (k: number): readonly [number, number] => {
      const a = (k / round) * Math.PI * 2
      return [x + Math.cos(a) * 2.22, z + Math.sin(a) * 2.22]
    }
    const [ax, az] = at(j)
    const [bx, bz] = at(j + 1)
    strip(1, (s, side) => (side < 0 ? [ax, 1.74 - s * 1.3, az] : [bx, 1.74 - s * 1.3, bz]), j / round, 2)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('aJet', new BufferAttribute(new Float32Array(jet), 4))
  geometry.setIndex(new BufferAttribute(new Uint16Array(index), 1))
  geometry.computeBoundingSphere()
  return geometry
}

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)

export function createTashkent(air: Air): Part {
  const root = new Group()
  const disposers: (() => void)[] = []
  const shared = {
    uCity: { value: 0 },
    uLamps: { value: 0 },
    uTime: { value: 0 },
    uLight: { value: new Color() },
    uLightDir: { value: new Vector3(0, 1, 0) },
    uAmbient: { value: new Color() },
    uHaze: air.uHaze,
    uGlow: air.uGlow,
    uSunDir: air.uSunDir,
    uAir: air.uAir,
    uZenith: air.uZenith,
    uHorizon: air.uHorizon,
  }
  const held = { value: 0 }
  const flow = { value: 0 }
  const keep = <T extends { dispose(): void }>(thing: T): T => {
    disposers.push(() => thing.dispose())
    return thing
  }
  const add = (mesh: Mesh): Mesh => {
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    root.add(mesh)
    return mesh
  }

  // ---- what stands still ---------------------------------------------------
  const massMaterial = keep(new ShaderMaterial({ uniforms: { ...shared, uHeld: held }, vertexShader: MASS_VERT, fragmentShader: `${AIR_PARS}\n${MASS_FRAG}` }))
  add(new Mesh(keep(buildTashkent().geometry()), massMaterial))

  // ---- the flag ------------------------------------------------------------
  const cloth = keep(new PlaneGeometry(FLAG.length, FLAG_HEIGHT, 36, 10))
  cloth.translate(FLAG.x + 0.12 + FLAG.length / 2, FLAG.pole - 0.5 - FLAG_HEIGHT / 2, FLAG.z)
  const flag = add(new Mesh(cloth, keep(new ShaderMaterial({ uniforms: shared, vertexShader: FLAG_VERT, fragmentShader: `${AIR_PARS}\n${FLAG_FRAG}`, side: DoubleSide }))))

  // ---- the fountain's water ------------------------------------------------
  const waterMaterial = keep(new ShaderMaterial({ uniforms: { ...shared, uFlow: flow }, vertexShader: WATER_VERT, fragmentShader: `${AIR_PARS}\n${WATER_FRAG}` }))
  const basin = keep(new CircleGeometry(FOUNTAIN.r, 48))
  basin.rotateX(-Math.PI / 2)
  basin.translate(FOUNTAIN.x, 0.36, FOUNTAIN.z)
  const bowl = keep(new CircleGeometry(2.05, 32))
  bowl.rotateX(-Math.PI / 2)
  bowl.translate(FOUNTAIN.x, 1.68, FOUNTAIN.z)
  const water = [add(new Mesh(basin, waterMaterial)), add(new Mesh(bowl, waterMaterial))]
  const spray = add(
    new Mesh(
      keep(jets()),
      keep(new ShaderMaterial({ uniforms: { ...shared, uFlow: flow }, vertexShader: JET_VERT, fragmentShader: `${AIR_PARS}\n${JET_FRAG}`, side: DoubleSide, transparent: true, depthWrite: false })),
    ),
  )
  spray.renderOrder = 2

  // ---- the name on the hotel -----------------------------------------------
  const canvas = document.createElement('canvas')
  drawName(canvas)
  const word = keep(new CanvasTexture(canvas))
  word.colorSpace = SRGBColorSpace
  word.generateMipmaps = false
  word.minFilter = LinearFilter
  word.magFilter = LinearFilter
  const board = keep(new PlaneGeometry(SIGN.width, SIGN.height))
  board.rotateY(SIGN.turn)
  board.translate(SIGN.x, HOTEL.height + 0.5 + SIGN.height / 2, SIGN.z)
  const facing = new Vector3(Math.sin(SIGN.turn), 0, Math.cos(SIGN.turn))
  const name = add(
    new Mesh(
      board,
      keep(new ShaderMaterial({ uniforms: { ...shared, uWord: { value: word }, uFacing: { value: facing } }, vertexShader: SIGN_VERT, fragmentShader: `${AIR_PARS}\n${SIGN_FRAG}`, alphaToCoverage: true })),
    ),
  )

  const toLight = new Vector3()

  function update(beat: Beat): void {
    const city = finite(beat.stage.city)
    const seen = city > 0.4
    root.visible = seen
    if (!seen) return
    shared.uCity.value = city
    shared.uLamps.value = finite(beat.lamps)
    shared.uTime.value = finite(beat.t)
    shared.uLight.value.copy(beat.light)
    shared.uAmbient.value.copy(beat.ambient)
    // Lit by whichever of the two is up, as the rest of the walk is.
    const { sky } = beat
    const bySun = sky.elevation > -3
    toLight.set(finite(bySun ? sky.sx : sky.mx), Math.max(finite(bySun ? sky.sy : sky.my), 0.06), finite(bySun ? sky.sz : sky.mz))
    if (toLight.lengthSq() > 1e-8) shared.uLightDir.value.copy(toLight.normalize())
    held.value = crossingHeld(beat.p)
    // The water is turned on last of all, when the square is finished.
    flow.value = Math.min(1, Math.max(0, (city - 0.955) / 0.045))
    const wet = flow.value > 0
    for (const mesh of water) mesh.visible = wet
    spray.visible = wet
    flag.visible = city > 0.9
    name.visible = city > 0.8
  }

  return {
    object: root,
    update,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}
