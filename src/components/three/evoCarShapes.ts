/**
 * What the traffic of the long walk is made of: five bodies, as numbers.
 *
 * A car is not sculpted and not downloaded. It is *lofted*: its side view and
 * its plan are a handful of points each, a cross-section is worked out from
 * them at sixty-odd places along its length, and a skin is stretched over the
 * sections. A cross-section always has the same thirty points in the same
 * order — under the floor, round the sill, up the door, the crease of the
 * belt line, the glass, the roof rail, over the roof and down the other side —
 * so that a bonnet is only a cabin whose roof has come down to its belt line,
 * and one function makes a saloon, a van and a bus.
 *
 * What a face is made of goes by where it is in that order and how far along:
 * the faces between the belt and the rail are glass where the windows are, and
 * paint where a pillar is. The sections are put exactly where those change, so
 * a window's edge is the edge of a face and is sharp at any distance.
 *
 * What is too small to be a face is not in the mesh at all. Lamps, a grille,
 * the lines where doors shut, the seats behind the glass: each is a few
 * numbers here, and `evoCars.ts` draws it on the skin from them.
 *
 * No three.js: the tests measure these meshes, and `evoCars.ts` draws them.
 */

export type VehicleKind = 'saloon' | 'hatch' | 'van' | 'crossover' | 'bus'
export const VEHICLE_KINDS: readonly VehicleKind[] = ['saloon', 'hatch', 'van', 'crossover', 'bus']

/** What a face of a body is made of. The shader has them in this order. */
export const PART = { paint: 0, glass: 1, trim: 2, under: 3, second: 4 } as const

type Key = readonly [number, number]

/** A lamp or a pane on an end of a body: where its middle is on the +z side, and how big. */
export interface Lens {
  x: number
  y: number
  z: number
  /** Across the car, and up it. */
  wide: number
  tall: number
}

export interface VehicleShape {
  kind: VehicleKind
  length: number
  width: number
  height: number
  /** The floor above the road. */
  clearance: number
  /** Where the axles are, from the middle of the car: the front one, then the rear. */
  axles: readonly [number, number]
  wheel: { radius: number; width: number }
  /** The line along the top of it, down the middle: [x, y] from tail to nose. */
  top: readonly Key[]
  /** The belt line, where the body side stops and the glass begins. */
  belt: readonly Key[]
  /** Half its width at the belt, in plan. */
  plan: readonly Key[]
  /** Half the width of the roof: what the sides lean in to. */
  roof: number
  /** How far the roof's middle stands above its edges. */
  crown: number
  /** Where the side glass stops, if lower than the roof rail: a bus's panel over its windows. */
  glassTop?: number
  /** How far back from each end the corners start to come round, and how much of the width is left at the very end. */
  nose: number
  tail: number
  blunt: number
  glass: {
    /** The windscreen: where its foot and its head are along the car. */
    front: readonly [number, number]
    /** The rear screen: head, then foot. Left out for a tail that is upright: that gets a pane of its own. */
    rear?: readonly [number, number]
    /** The side windows, from the front of them to the back. */
    side: readonly [number, number]
    /** Pillars between them. */
    pillars: readonly number[]
  }
  /** Where the doors shut, along the side. */
  doors: readonly number[]
  /** Black plastic round the arches and along the sills. */
  cladding: boolean
  /** Doors of glass in the kerb side, each from one x to another. */
  kerbDoors?: readonly (readonly [number, number])[]
  /** A headlamp and a tail lamp: drawn on the skin where it comes round each corner. */
  head: Lens
  rear: Lens
  /** The mouth between the headlamps and the intake under the plate: how high the middle of each is, how tall, how wide. */
  grille: readonly [number, number, number]
  intake: readonly [number, number, number]
  /** A pane of glass in an upright tail. */
  backPane?: Lens
  /** Number plates: how high the middle of each is. */
  plates: { front: number; back: number }
  /** Door mirrors: where one is, on the +z side. */
  mirror: readonly [number, number, number]
  /** What is behind the glass. */
  cabin: Cabin
}

/** The inside of a body, as far as it shows through the windows. */
export interface Cabin {
  /** The sill of the windows and their head. */
  belt: number
  top: number
  /** Half the width inside, and how far forward and back the inside goes. */
  half: number
  front: number
  rear: number
  /** Where the backs of the front seats and of the rear seat are; none in something with rows of them. */
  seats?: readonly [number, number]
  /** Lit inside after dark. */
  lit: boolean
}

/** How far the middle of each end stands proud of its edges. */
export const BULGE = 0.03

/** How far along a body a number plate is: just clear of the middle of an end. */
export function plateAt(shape: VehicleShape, end: 1 | -1): number {
  return end * (shape.length / 2 + BULGE + 0.012)
}

/**
 * The five. Lengths are metres; x runs from the tail (negative) to the nose,
 * y up from the road, z out to the car's right.
 */
export const VEHICLE_SHAPES: Record<VehicleKind, VehicleShape> = {
  // Three boxes: a bonnet, a cabin, a boot. The commonest thing on the street.
  saloon: {
    kind: 'saloon',
    length: 4.48,
    width: 1.74,
    height: 1.5,
    clearance: 0.17,
    axles: [1.36, -1.26],
    wheel: { radius: 0.315, width: 0.2 },
    top: [[-2.24, 0.93], [-2.08, 0.985], [-1.56, 1.01], [-0.98, 1.4], [-0.3, 1.5], [0.26, 1.465], [1.03, 1.02], [1.7, 0.915], [2.08, 0.8], [2.24, 0.72]],
    belt: [[-2.24, 0.9], [-1.5, 0.965], [0, 0.94], [1.0, 0.905], [1.7, 0.85], [2.24, 0.7]],
    plan: [[-2.24, 0.8], [-1.9, 0.86], [0, 0.87], [1.6, 0.862], [2.0, 0.83], [2.24, 0.77]],
    roof: 0.6,
    crown: 0.04,
    nose: 0.24,
    tail: 0.2,
    blunt: 0.74,
    glass: { front: [1.03, 0.26], rear: [-0.98, -1.56], side: [0.97, -1.3], pillars: [-0.12] },
    doors: [0.98, -0.12, -1.16],
    cladding: false,
    head: { x: 2.2, y: 0.61, z: 0.57, wide: 0.4, tall: 0.13 },
    rear: { x: -2.215, y: 0.77, z: 0.56, wide: 0.44, tall: 0.13 },
    grille: [0.59, 0.07, 0.6],
    intake: [0.285, 0.075, 1.0],
    plates: { front: 0.42, back: 0.6 },
    mirror: [0.9, 0.99, 0.93],
    cabin: { belt: 0.95, top: 1.4, half: 0.76, front: 1.0, rear: -1.5, seats: [0.02, -1.02], lit: false },
  },
  // Two boxes, short and tall: the small car a city is full of.
  hatch: {
    kind: 'hatch',
    length: 3.62,
    width: 1.6,
    height: 1.52,
    clearance: 0.16,
    axles: [1.13, -1.22],
    wheel: { radius: 0.285, width: 0.18 },
    top: [[-1.81, 0.98], [-1.72, 1.1], [-1.4, 1.46], [-0.4, 1.52], [0.36, 1.485], [1.02, 1.02], [1.46, 0.92], [1.72, 0.8], [1.81, 0.72]],
    belt: [[-1.81, 0.96], [-1.0, 0.97], [0.3, 0.94], [1.0, 0.905], [1.5, 0.84], [1.81, 0.7]],
    plan: [[-1.81, 0.74], [-1.5, 0.79], [0, 0.8], [1.3, 0.79], [1.62, 0.75], [1.81, 0.7]],
    roof: 0.57,
    crown: 0.04,
    nose: 0.2,
    tail: 0.13,
    blunt: 0.76,
    glass: { front: [1.02, 0.36], rear: [-1.4, -1.72], side: [0.96, -1.42], pillars: [-0.2] },
    doors: [0.95, -0.2, -1.1],
    cladding: false,
    head: { x: 1.775, y: 0.64, z: 0.53, wide: 0.3, tall: 0.19 },
    rear: { x: -1.79, y: 0.86, z: 0.62, wide: 0.17, tall: 0.3 },
    grille: [0.6, 0.055, 0.5],
    intake: [0.275, 0.07, 0.86],
    plates: { front: 0.42, back: 0.6 },
    mirror: [0.86, 0.99, 0.86],
    cabin: { belt: 0.96, top: 1.42, half: 0.7, front: 1.0, rear: -1.68, seats: [0.0, -0.96], lit: false },
  },
  // One box: the driver sits over the front wheels. Narrow, upright, everywhere.
  van: {
    kind: 'van',
    length: 3.5,
    width: 1.42,
    height: 1.9,
    clearance: 0.17,
    axles: [1.0, -0.84],
    wheel: { radius: 0.26, width: 0.15 },
    top: [[-1.75, 1.82], [-1.62, 1.885], [0.5, 1.9], [1.14, 1.85], [1.6, 1.06], [1.72, 0.9], [1.75, 0.8]],
    belt: [[-1.75, 1.0], [1.2, 1.0], [1.6, 0.985], [1.75, 0.82]],
    plan: [[-1.75, 0.68], [-1.6, 0.705], [1.3, 0.71], [1.62, 0.69], [1.75, 0.64]],
    roof: 0.63,
    crown: 0.03,
    nose: 0.11,
    tail: 0.07,
    blunt: 0.84,
    glass: { front: [1.6, 1.14], side: [1.52, -1.6], pillars: [0.62, -0.55] },
    doors: [1.5, 0.62, -0.55],
    cladding: false,
    head: { x: 1.735, y: 0.72, z: 0.47, wide: 0.26, tall: 0.17 },
    rear: { x: -1.752, y: 0.84, z: 0.56, wide: 0.13, tall: 0.3 },
    grille: [0.565, 0.05, 0.5],
    intake: [0.3, 0.07, 0.8],
    backPane: { x: -1.756, y: 1.42, z: 0, wide: 1.0, tall: 0.5 },
    plates: { front: 0.44, back: 0.6 },
    mirror: [1.4, 1.12, 0.77],
    cabin: { belt: 1.01, top: 1.8, half: 0.62, front: 1.56, rear: -1.72, seats: [0.74, -0.38], lit: false },
  },
  // A hatch that stands taller on bigger wheels, with black plastic round its skirts.
  crossover: {
    kind: 'crossover',
    length: 4.27,
    width: 1.79,
    height: 1.63,
    clearance: 0.21,
    axles: [1.3, -1.27],
    wheel: { radius: 0.345, width: 0.22 },
    top: [[-2.135, 1.08], [-2.04, 1.22], [-1.62, 1.56], [-0.4, 1.63], [0.4, 1.585], [1.12, 1.13], [1.8, 1.02], [2.03, 0.9], [2.135, 0.8]],
    belt: [[-2.135, 1.07], [-1.2, 1.085], [0.2, 1.04], [1.1, 1.005], [1.8, 0.955], [2.135, 0.78]],
    plan: [[-2.135, 0.8], [-1.8, 0.88], [0, 0.895], [1.6, 0.887], [1.98, 0.85], [2.135, 0.78]],
    roof: 0.63,
    crown: 0.04,
    nose: 0.24,
    tail: 0.14,
    blunt: 0.76,
    glass: { front: [1.12, 0.4], rear: [-1.62, -2.03], side: [1.06, -1.7], pillars: [-0.1, -1.08] },
    doors: [1.05, -0.1, -1.1],
    cladding: true,
    head: { x: 2.085, y: 0.7, z: 0.59, wide: 0.42, tall: 0.11 },
    rear: { x: -2.1, y: 0.94, z: 0.62, wide: 0.4, tall: 0.12 },
    grille: [0.66, 0.085, 0.62],
    intake: [0.34, 0.08, 1.04],
    plates: { front: 0.5, back: 0.72 },
    mirror: [0.98, 1.1, 0.96],
    cabin: { belt: 1.06, top: 1.52, half: 0.78, front: 1.08, rear: -1.98, seats: [0.06, -0.98], lit: false },
  },
  // Twelve metres of low floor: a band of glass, doors down the kerb side.
  bus: {
    kind: 'bus',
    length: 11.9,
    width: 2.5,
    height: 3.05,
    clearance: 0.3,
    axles: [3.25, -2.65],
    wheel: { radius: 0.48, width: 0.32 },
    top: [[-5.95, 2.9], [-5.8, 3.02], [5.3, 3.05], [5.74, 2.96], [5.92, 1.32], [5.95, 1.05]],
    belt: [[-5.95, 1.12], [5.7, 1.12], [5.95, 1.0]],
    plan: [[-5.95, 1.2], [-5.6, 1.25], [5.6, 1.25], [5.95, 1.19]],
    roof: 1.19,
    crown: 0.05,
    glassTop: 2.44,
    nose: 0.2,
    tail: 0.12,
    blunt: 0.86,
    glass: { front: [5.92, 5.74], side: [5.62, -5.5], pillars: [4.0, 2.6, 1.9, 0.0, -1.4, -2.9, -4.6] },
    doors: [],
    cladding: false,
    kerbDoors: [
      [4.12, 5.36],
      [0.16, 1.74],
      [-4.44, -3.06],
    ],
    head: { x: 5.935, y: 0.74, z: 0.9, wide: 0.42, tall: 0.17 },
    rear: { x: -5.955, y: 1.0, z: 1.0, wide: 0.2, tall: 0.4 },
    grille: [0.0, 0.0, 0.0],
    intake: [0.42, 0.1, 2.0],
    backPane: { x: -5.958, y: 2.0, z: 0, wide: 1.9, tall: 0.8 },
    plates: { front: 0.6, back: 0.66 },
    mirror: [5.5, 2.25, 1.38],
    cabin: { belt: 1.13, top: 2.43, half: 1.19, front: 5.7, rear: -5.9, lit: true },
  },
}

// ------------------------------------------------------------------ curves

/**
 * A curve through points that never goes past them (Fritsch and Carlson): a
 * spline that swings beyond its keys puts a dip in a roof that was flat.
 */
function curve(keys: readonly Key[]): (x: number) => number {
  const n = keys.length
  const xs = keys.map((k) => k[0])
  const ys = keys.map((k) => k[1])
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!))
  const m: number[] = new Array<number>(n).fill(0)
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i]! / d[i]!
    const b = m[i + 1]! / d[i]!
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]!
      m[i + 1] = t * b * d[i]!
    }
  }
  return (x) => {
    if (x <= xs[0]!) return ys[0]!
    if (x >= xs[n - 1]!) return ys[n - 1]!
    let i = 0
    while (i < n - 2 && x > xs[i + 1]!) i++
    const h = xs[i + 1]! - xs[i]!
    const t = (x - xs[i]!) / h
    const t2 = t * t
    const t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth = (t: number): number => {
  const u = clamp01(t)
  return u * u * (3 - 2 * u)
}

// ----------------------------------------------------------------- lofting

/** The points of half a cross-section, from under the middle of the floor to the middle of the roof. */
const HALF = 16
/** And of a whole one: both halves, sharing the two in the middle. */
export const RING = HALF * 2 - 2

/** Which strip of a cross-section a face is in, by the first of its two points. */
const ROLE = { floor: 0, sill: 2, door: 4, belt: 7, glass: 8, rail: 10, top: 12 } as const

interface Section {
  x: number
  /** [z, y] for each of the half's points. */
  half: [number, number][]
  /** Whether this is inside a wheel arch. */
  arch: boolean
}

/** How far a wheel arch stands clear of the tyre. */
export const ARCH_GAP = 0.055

function sectionAt(shape: VehicleShape, x: number, fns: { top: (x: number) => number; belt: (x: number) => number; plan: (x: number) => number }): Section {
  const half = shape.length / 2
  // How far round the corner of an end this is: 0 at the very end, 1 clear of it.
  const fromNose = half - x
  const fromTail = x + half
  const near = fromNose < fromTail ? clamp01(fromNose / shape.nose) : clamp01(fromTail / shape.tail)
  // A blunt end: nearly all of the turning is in the last few centimetres.
  const round = Math.pow(1 - Math.pow(1 - near, 2.6), 1 / 2.6)

  const cabinRise = shape.height - shape.crown - fns.belt(0)
  let yTop = fns.top(x)
  let yBelt = Math.min(fns.belt(x), yTop - 0.02)
  const w = fns.plan(x) * mix(shape.blunt, 1, round)
  let floor = shape.clearance
  // The ends are drawn in: the lip of a bonnet rolls over, an air dam comes up.
  const drawn = 1 - round
  yTop -= 0.07 * drawn
  yBelt -= 0.07 * drawn
  floor += 0.05 * drawn

  // A wheel arch: the floor is lifted clear of the tyre, from one side to the other.
  let arch = false
  for (const axle of shape.axles) {
    const reach = shape.wheel.radius + ARCH_GAP
    const dx = x - axle
    if (Math.abs(dx) < reach) {
      floor = Math.max(floor, shape.wheel.radius + Math.sqrt(reach * reach - dx * dx))
      arch = true
    }
  }
  floor = Math.min(floor, yBelt - 0.14)

  const sill = 0.07
  const wBelt = w - 0.02
  // The rail: where the side turns into the roof — or, over a bonnet, where the wing turns into the bonnet.
  const yRail = Math.max(yBelt + 0.014, yTop - shape.crown)
  const up = clamp01((yRail - yBelt) / cabinRise)
  const wRail = mix(wBelt - 0.04, Math.min(shape.roof, wBelt - 0.04), smooth(up))
  const yGlass = Math.max(yBelt + 0.008, Math.min(yRail - 0.03, shape.glassTop ?? Infinity))
  const zGlass = mix(wBelt - 0.012, wRail + 0.012, clamp01((yGlass - yBelt) / Math.max(yRail - yBelt, 1e-3)))
  const lower = floor + sill

  const points: [number, number][] = [
    [0, floor],
    [w * 0.55, floor],
    [w - sill, floor],
    [w - sill * 0.3, floor + sill * 0.3],
    [w - 0.012, lower],
    [w, mix(lower, yBelt, 0.4)],
    [w - 0.005, mix(lower, yBelt, 0.74)],
    [wBelt, yBelt - 0.012],
    [wBelt - 0.012, yBelt + 0.004],
    [mix(wBelt - 0.012, zGlass, 0.5) + 0.006 * up, mix(yBelt + 0.004, yGlass, 0.5)],
    [zGlass, yGlass],
    [wRail, yRail - 0.008],
    [wRail - 0.035, yRail + 0.012],
    [wRail * 0.66, yRail + (yTop - yRail) * (1 - Math.pow(0.66, 2.2))],
    [wRail * 0.33, yRail + (yTop - yRail) * (1 - Math.pow(0.33, 2.2))],
    [0, yTop],
  ]
  return { x, half: points, arch }
}

/** Where along a body its sections go: at every place something changes, and often enough between. */
function stations(shape: VehicleShape): number[] {
  const half = shape.length / 2
  const marks: number[] = []
  // The ends, closely: that is where a body turns fastest.
  for (const d of [0, 0.01, 0.03, 0.06, 0.1, 0.15, 0.21]) {
    if (d <= shape.nose + 0.02) marks.push(half - d)
    if (d <= shape.tail + 0.02) marks.push(-half + d)
  }
  marks.push(half - shape.nose, -half + shape.tail)
  // The glass, the pillars, the doors.
  const g = shape.glass
  marks.push(g.front[0], g.front[1], g.side[0], g.side[1])
  if (g.rear) marks.push(g.rear[0], g.rear[1])
  for (const pillar of g.pillars) marks.push(pillar - PILLAR, pillar + PILLAR)
  marks.push(...shape.doors)
  for (const [from, until] of shape.kerbDoors ?? []) {
    const middle = (from + until) / 2
    marks.push(from, from + FRAME, middle - FRAME / 2, middle + FRAME / 2, until - FRAME, until)
  }
  for (const key of shape.top) marks.push(key[0])
  // Round each wheel, evenly by angle, and a hair either side of the arch.
  const reach = shape.wheel.radius + ARCH_GAP
  for (const axle of shape.axles) {
    for (let k = 1; k < 12; k++) marks.push(axle + reach * Math.cos((Math.PI * k) / 12))
    marks.push(axle - reach - 0.004, axle + reach + 0.004, axle - reach + 0.004, axle + reach - 0.004)
  }
  marks.sort((a, b) => a - b)
  const out: number[] = []
  for (const mark of marks) {
    if (mark < -half - 1e-6 || mark > half + 1e-6) continue
    const last = out[out.length - 1]
    if (last !== undefined && mark - last < 0.003) continue
    // Never further apart than this: a skin is only as smooth as its sections are close.
    if (last !== undefined) {
      const gaps = Math.ceil((mark - last) / STEP)
      for (let k = 1; k < gaps; k++) out.push(last + ((mark - last) * k) / gaps)
    }
    out.push(mark)
  }
  return out
}

/** Half the width of a pillar, and the most that two sections may be apart. */
const PILLAR = 0.04
const STEP = 0.16
/** The width of the frame of a door of glass, and of the post between its two leaves. */
const FRAME = 0.06

/** A body, two ways. */
export interface VehicleMesh {
  /** As one closed surface, each point of it once: for measuring, and for casting a shadow. */
  positions: Float32Array
  indices: Uint32Array
  /**
   * And as it is drawn: every face with corners of its own, so that a face is
   * one material however its neighbours are painted. `body` is two numbers for
   * the shader to draw doors with: 1 on the painted side of the body between
   * sill and glass and 0 elsewhere, and how far up that side a corner is.
   */
  draw: {
    position: Float32Array
    normal: Float32Array
    part: Float32Array
    body: Float32Array
    index: Uint32Array
  }
}

const built = new Map<VehicleKind, VehicleMesh>()

/** The mesh of one of the five. Made once; plain arithmetic. */
export function vehicleMesh(kind: VehicleKind): VehicleMesh {
  const ready = built.get(kind)
  if (ready) return ready
  const mesh = loft(VEHICLE_SHAPES[kind])
  built.set(kind, mesh)
  return mesh
}

function loft(shape: VehicleShape): VehicleMesh {
  const fns = { top: curve(shape.top), belt: curve(shape.belt), plan: curve(shape.plan) }
  const xs = stations(shape)
  const sections = xs.map((x) => sectionAt(shape, x, fns))

  // ---- the points: a ring to a section, and one in the middle of each end ---
  const points: number[] = []
  for (const section of sections) {
    for (let j = 0; j < HALF; j++) points.push(section.x, section.half[j]![1], section.half[j]![0])
    for (let j = HALF - 2; j >= 1; j--) points.push(section.x, section.half[j]![1], -section.half[j]![0])
  }
  const ringAt = (i: number, j: number) => i * RING + (((j % RING) + RING) % RING)
  const first = sections[0]!
  const last = sections[sections.length - 1]!
  const middle = (s: Section) => (s.half[0]![1] + s.half[HALF - 1]![1]) / 2
  // An end is not quite flat: its middle stands a little proud, and catches the light differently for it.
  const tailHub = points.length / 3
  points.push(first.x - BULGE, middle(first), 0)
  const noseHub = points.length / 3
  points.push(last.x + BULGE, middle(last), 0)

  // ---- the faces, each with what it is made of ------------------------------
  interface Face {
    corners: number[]
    part: number
    /** Whether this is the painted side of the body, between the sill and the glass: where doors are. */
    side: boolean
  }
  const faces: Face[] = []
  const g = shape.glass
  const inside = (x: number, a: number, b: number) => x > Math.min(a, b) - 1e-6 && x < Math.max(a, b) + 1e-6
  /** A door of glass in the kerb side: 0 clear of one, 1 in its glass, 2 in its frame or the post between its leaves. */
  const kerbDoor = (x: number): number => {
    for (const [from, until] of shape.kerbDoors ?? []) {
      if (!inside(x, from, until)) continue
      const middle = (from + until) / 2
      return x < from + FRAME || x > until - FRAME || Math.abs(x - middle) < FRAME / 2 ? 2 : 1
    }
    return 0
  }

  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i]!
    const b = sections[i + 1]!
    const x = (a.x + b.x) / 2
    const arch = a.arch && b.arch
    for (let j = 0; j < RING; j++) {
      // The strip this face is in, whichever side of the car it is on.
      const role = j < HALF - 1 ? j : RING - 1 - j
      const right = j < HALF - 1
      // A door of glass, on the kerb side only: glass from the sill up, in a frame.
      const door = right ? kerbDoor(x) : 0
      let part: number = PART.paint
      if (role < ROLE.sill) part = PART.under
      // The sill: a black strip along the foot of the doors, and painted where it is the lip of an arch.
      else if (role < ROLE.door) part = arch ? PART.paint : PART.trim
      else if (role < ROLE.belt) {
        part = door === 1 ? PART.glass : door === 2 ? PART.trim : PART.paint
      } else if (role < ROLE.glass) {
        // The crease of the belt line: a black strip under the glass, where there is glass.
        part = door === 1 ? PART.glass : inside(x, g.side[0], g.side[1]) ? PART.trim : PART.paint
      } else if (role < ROLE.rail) {
        const pillar = g.pillars.some((at) => Math.abs(x - at) < PILLAR)
        part = door === 2 ? PART.trim : inside(x, g.side[0], g.side[1]) && (!pillar || door === 1) ? PART.glass : PART.paint
      } else if (role < ROLE.top) {
        part = shape.glassTop !== undefined && inside(x, g.side[0], g.side[1]) ? PART.second : PART.paint
      } else {
        const screen = inside(x, g.front[0], g.front[1]) || (g.rear !== undefined && inside(x, g.rear[0], g.rear[1]))
        part = screen ? PART.glass : shape.glassTop !== undefined ? PART.second : PART.paint
      }
      faces.push({
        corners: [ringAt(i, j), ringAt(i + 1, j), ringAt(i + 1, j + 1), ringAt(i, j + 1)],
        part,
        side: role >= ROLE.door && role < ROLE.belt && part === PART.paint,
      })
    }
  }
  // The two ends, closed with a fan each: paint, for the shader to put lamps and a grille on.
  for (let j = 0; j < RING; j++) {
    faces.push({ corners: [tailHub, ringAt(0, j), ringAt(0, j + 1)], part: PART.paint, side: false })
    const end = sections.length - 1
    faces.push({ corners: [noseHub, ringAt(end, j + 1), ringAt(end, j)], part: PART.paint, side: false })
  }

  // ---- mirrors: a pod on a stalk either side ---------------------------------
  const pods: { centre: [number, number, number]; radii: [number, number, number] }[] = []
  for (const side of [1, -1]) {
    const [mx, my, mz] = shape.mirror
    const big = shape.kind === 'bus' ? 1.7 : 1
    pods.push({ centre: [mx, my, side * mz], radii: [0.055 * big, 0.07 * big, 0.1 * big] })
  }
  for (const pod of pods) {
    const base = points.length / 3
    const rows = 5
    const cols = 8
    points.push(pod.centre[0], pod.centre[1] - pod.radii[1], pod.centre[2])
    for (let r = 1; r < rows; r++) {
      const lat = -Math.PI / 2 + (Math.PI * r) / rows
      for (let c = 0; c < cols; c++) {
        const lon = (Math.PI * 2 * c) / cols
        points.push(pod.centre[0] + pod.radii[0] * Math.cos(lat) * Math.cos(lon), pod.centre[1] + pod.radii[1] * Math.sin(lat), pod.centre[2] + pod.radii[2] * Math.cos(lat) * Math.sin(lon))
      }
    }
    const tip = points.length / 3
    points.push(pod.centre[0], pod.centre[1] + pod.radii[1], pod.centre[2])
    const at = (r: number, c: number) => base + 1 + (r - 1) * cols + (c % cols)
    for (let c = 0; c < cols; c++) {
      faces.push({ corners: [base, at(1, c), at(1, c + 1)], part: PART.trim, side: false })
      for (let r = 1; r < rows - 1; r++) faces.push({ corners: [at(r, c), at(r + 1, c), at(r + 1, c + 1), at(r, c + 1)], part: PART.paint, side: false })
      faces.push({ corners: [at(rows - 1, c), tip, at(rows - 1, c + 1)], part: PART.paint, side: false })
    }
  }

  // ---- how each face lies -----------------------------------------------------
  // (They are all wound to look outwards as they were made: the rings go up
  // the right-hand side and down the left, and the sections from tail to nose.)
  const positions = new Float32Array(points)
  const normalOf = (face: Face): [number, number, number, number] => {
    // Newell's method: right for a quad that is not quite flat.
    let nx = 0
    let ny = 0
    let nz = 0
    const n = face.corners.length
    for (let k = 0; k < n; k++) {
      const p = face.corners[k]! * 3
      const q = face.corners[(k + 1) % n]! * 3
      nx += (positions[p + 1]! - positions[q + 1]!) * (positions[p + 2]! + positions[q + 2]!)
      ny += (positions[p + 2]! - positions[q + 2]!) * (positions[p]! + positions[q]!)
      nz += (positions[p]! - positions[q]!) * (positions[p + 1]! + positions[q + 1]!)
    }
    const length = Math.hypot(nx, ny, nz)
    return length > 1e-12 ? [nx / length, ny / length, nz / length, length / 2] : [0, 0, 0, 0]
  }
  const indices: number[] = []
  const normals: [number, number, number, number][] = []
  for (const face of faces) {
    normals.push(normalOf(face))
    const c = face.corners
    if (c.length === 3) indices.push(c[0]!, c[1]!, c[2]!)
    else indices.push(c[0]!, c[1]!, c[2]!, c[0]!, c[2]!, c[3]!)
  }

  // ---- as it is drawn: corners of its own for every face ---------------------
  // A corner takes the average of the faces round its point that face nearly
  // the way its own face does, so a door is smooth and the edge of a boot is
  // an edge.
  const around: number[][] = Array.from({ length: positions.length / 3 }, () => [])
  faces.forEach((face, f) => {
    for (const corner of face.corners) around[corner]!.push(f)
  })
  const CREASE = Math.cos((46 * Math.PI) / 180)
  const position: number[] = []
  const normal: number[] = []
  const part: number[] = []
  const body: number[] = []
  const index: number[] = []
  const heightOf = (role: number): number => clamp01((role - ROLE.door) / (ROLE.belt - ROLE.door))
  faces.forEach((face, f) => {
    const own = normals[f]!
    if (own[3] === 0) return
    const start = position.length / 3
    face.corners.forEach((corner) => {
      let nx = 0
      let ny = 0
      let nz = 0
      for (const other of around[corner]!) {
        const n = normals[other]!
        if (n[0] * own[0] + n[1] * own[1] + n[2] * own[2] < CREASE) continue
        nx += n[0] * n[3]
        ny += n[1] * n[3]
        nz += n[2] * n[3]
      }
      const length = Math.hypot(nx, ny, nz) || 1
      position.push(positions[corner * 3]!, positions[corner * 3 + 1]!, positions[corner * 3 + 2]!)
      normal.push(nx / length, ny / length, nz / length)
      part.push(face.part)
      if (face.side) {
        const j = corner % RING
        body.push(1, heightOf(j < HALF ? j : RING - j))
      } else {
        body.push(0, 0)
      }
    })
    if (face.corners.length === 3) index.push(start, start + 1, start + 2)
    else index.push(start, start + 1, start + 2, start, start + 2, start + 3)
  })

  return {
    positions,
    indices: new Uint32Array(indices),
    draw: {
      position: new Float32Array(position),
      normal: new Float32Array(normal),
      part: new Float32Array(part),
      body: new Float32Array(body),
      index: new Uint32Array(index),
    },
  }
}
