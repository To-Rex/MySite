/**
 * What the traffic of the long walk is made of: the bodies, as numbers.
 *
 * The street is in Tashkent, so the cars are the ones a street in Tashkent is
 * full of: the tall sedan that is a third of everything on the road, the
 * square three-box from the eighties, the smooth sedan from the two-thousands,
 * the one-box microvan that is half the city's minibuses, the tiny tall
 * hatchback, the boxy Soviet sedan that is still going, the electric crossover
 * that arrived in numbers in 2023, the long sedan, and the lime-green city
 * bus. Identifiers say which car each shape is after; nothing drawn does.
 *
 * Every number here was read off photographs of the real cars, through a
 * camera solved from their wheels and number plates, and the body laid back
 * over the photograph to check it: the published length, width, height and
 * wheelbase, and from the pictures the overhangs, the line of the roof and the
 * bonnet and the boot, the daylight opening of the windows, and the lamps.
 *
 * A car is not sculpted and not downloaded. It is *lofted*: its side view and
 * its plan are a handful of points each, a cross-section is worked out from
 * them at sixty-odd places along its length, and a skin is stretched over the
 * sections. A cross-section always has the same thirty points in the same
 * order — under the floor, round the sill, up the door, the crease of the
 * belt line, the glass, the roof rail, over the roof and down the other side —
 * so that a bonnet is only a cabin whose roof has come down to its belt line,
 * and one function makes a microvan and a sedan.
 *
 * What is too small to be a face is drawn on the skin from a few numbers each:
 * the daylight opening of the side windows and the pillars across it, from an
 * outline in side view; and on each end — lamps, grilles, bumpers, the strips
 * of chrome and black, the shut lines of a boot — from outlines in
 * coordinates unwrapped round the end, so that one outline runs across the
 * front of a car and on round its corner and back along its side.
 *
 * Each body comes twice: as it is seen from close, and with a third of the
 * sections for anything more than a few car lengths away.
 *
 * No three.js: the tests measure these meshes, and `evoCars.ts` draws them.
 */

export type VehicleKind = 'cobalt' | 'nexia' | 'gentra' | 'damas' | 'matiz' | 'zhiguli' | 'byd' | 'malibu' | 'crossover' | 'bus'
export const VEHICLE_KINDS: readonly VehicleKind[] = ['cobalt', 'nexia', 'gentra', 'damas', 'matiz', 'zhiguli', 'byd', 'malibu', 'crossover', 'bus']

/** What a face of a body is made of. The shader has them in this order. `window` is the band the side windows are drawn in. */
export const PART = { paint: 0, glass: 1, trim: 2, under: 3, second: 4, window: 5 } as const

/** How finely a body is meshed: for close, or for far. */
export type BodyDetail = 'near' | 'far'

type Key = readonly [number, number]
/** A point of an outline. */
export type Pt = readonly [number, number]

/**
 * What a decal is made of; the shader has them in this order. A headlamp's
 * clear lens over its reflectors, a tail lamp's red, an indicator's amber, a
 * reversing lamp's white; grilles in slats and in mesh; chrome, piano black,
 * a fog lamp, a running-light strip, a red light bar, the body's own colour
 * (to cut a shape back out of one under it), the blank where a badge would
 * be, a dark lens that is not lit, matt black plastic, a red reflector.
 */
export const DECAL_KINDS = ['head', 'tail', 'amber', 'reverse', 'slats', 'mesh', 'chrome', 'gloss', 'fog', 'led', 'redbar', 'paint', 'blank', 'lens', 'black', 'reflector', 'white'] as const
export type DecalKind = (typeof DECAL_KINDS)[number]

/**
 * Something drawn on an end of a body. Its outline is in coordinates
 * unwrapped round that end: u is |z| across the end, then half the width plus
 * the distance back along the side; y is up from the road. It is drawn on
 * both sides at once. Later decals are drawn over earlier ones.
 */
export interface Decal {
  kind: DecalKind
  /** The nose (1) or the tail (-1). */
  end: 1 | -1
  at: readonly Pt[]
  /** Only on the body's first face (0) or on its other one (1): two faces of one car. Both, if left out. */
  face?: 0 | 1
}

/** The side windows: the daylight opening in side view, and the pillars across it. */
export interface Windows {
  /** [x, y], in order round it. The band of the body it is drawn in is the top and bottom of it where this goes past them. */
  outline: readonly Pt[]
  /** Pillars across it, each [x at the belt, x at the top, half its width, 1 black or 0 the body's colour]. */
  bars: readonly (readonly [number, number, number, number])[]
  /** How wide the frame round the glass is, and whether it is chrome rather than black. */
  frame?: number
  chrome?: boolean
}

/** The most decals a body may have, and the most points in one outline: what the shader has room for. */
export const MAX_DECALS = 28
export const MAX_OUTLINE = 48

/** A pane or a card, on an end or behind the glass: where its middle is, and how big. */
export interface Lens {
  x: number
  y: number
  z: number
  /** Across the car, and up it. */
  wide: number
  tall: number
}

/** How the wheels are dressed; the shader has them in this order. */
export const WHEEL_STYLES = ['steel', 'cover', 'alloy', 'spokes', 'chrome', 'bus', 'twin'] as const
export type WheelStyle = (typeof WHEEL_STYLES)[number]

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

export interface VehicleShape {
  kind: VehicleKind
  length: number
  width: number
  height: number
  /** The floor above the road. */
  clearance: number
  /** Where the axles are, from the middle of the car: the front one, then the rear. */
  axles: readonly [number, number]
  wheel: { radius: number; width: number; style: WheelStyle }
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
  /** Where the side glass stops, if lower than the roof rail: a panel over the windows. */
  glassTop?: number
  /**
   * How far the middle of each end, the front's and then the back's, stands proud of the last
   * cross-section: each end is closed by a shallow dome, which this much of the length is in.
   */
  dome?: readonly [number, number]
  /** How far back from each end's last section the corners start to come round, and how much of the width is left there. */
  nose: number
  tail: number
  blunt: number
  /** How far the top of each end rolls over and down: a little on a square old body, more on a rounded new one. */
  lip?: number
  /** How far the floor rises under each end: the bottom of a bumper is higher than the sills. */
  chin?: number
  /** Or the line of the bottom of the body along its length, [x, y], where it is not the clearance. */
  under?: readonly Key[]
  /** How square the corners of the ends are in plan: higher is squarer. */
  corner?: number
  /** How far in the side tucks from its widest to the belt line; and creases kept sharp, by their place in a cross-section. */
  tuck?: number
  hard?: readonly number[]
  glass: {
    /** The windscreen: where its foot and its head are along the car. */
    front: readonly [number, number]
    /** The rear screen: head, then foot. Left out for a tail that is upright: that gets a pane of its own. */
    rear?: readonly [number, number]
    /** The side windows, from the front of them to the back, and pillars between them: only for what has no `windows`. */
    side?: readonly [number, number]
    pillars?: readonly number[]
  }
  /** The side windows, drawn on the skin. */
  windows?: Windows
  /** Where the doors shut, along the side. */
  doors: readonly number[]
  /** Black plastic round the arches and along the sills. */
  cladding: boolean
  /** Doors of glass in the kerb side, each from one x to another. */
  kerbDoors?: readonly (readonly [number, number])[]
  /** Everything drawn on the ends. */
  decals: readonly Decal[]
  /** Where a headlamp's middle is, on the right: what the halos of a frame with no glow are put on. */
  head: { y: number; z: number }
  /** A strip down the sides, at how far up the doors it is (0 at the sill, 1 at the glass), and chrome rather than black. */
  strip?: number
  stripChrome?: boolean
  /** Door handles that lie flush with the skin. */
  flushHandles?: boolean
  /** A sliding door in the kerb side, from one x to another, and the rail it runs in. */
  slidingDoor?: readonly [number, number]
  /** A pane of glass in an upright tail. */
  backPane?: Lens
  /** Where a route card stands behind the windscreen, for those that carry one. */
  card?: Lens
  /** Number plates: how high the middle of each is. Each goes on the skin there, in the middle. */
  plates: { front: number; back: number }
  /** Door mirrors: where one is, on the +z side. */
  mirror: readonly [number, number, number]
  /** What is behind the glass. */
  cabin: Cabin
}

/** How far the middle of each end stands proud of its last section, where a body says nothing else. */
export const BULGE = 0.03

/** How deep each end's dome is: the front's, then the back's. */
export function domeOf(shape: VehicleShape): readonly [number, number] {
  return shape.dome ?? [BULGE, BULGE]
}

/** How far from the middle the last section at each end is, the front's and the back's: the rest is the dome. */
export function rimOf(shape: VehicleShape): readonly [number, number] {
  const [front, back] = domeOf(shape)
  return [shape.length / 2 - front, shape.length / 2 - back]
}

/** How far out from the middle of a body the middle of each of its wheels is. */
export function wheelReach(shape: VehicleShape): number {
  return shape.width / 2 - shape.wheel.width / 2 - 0.035
}

/**
 * How far an end's skin reaches along the line at height `y`, `z` across: the
 * furthest point of the closed surface there, towards that end.
 */
export function skinAt(mesh: VehicleMesh, y: number, z: number, end: 1 | -1): number {
  const p = mesh.positions
  const ix = mesh.indices
  let best = -Infinity
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]! * 3
    const b = ix[t + 1]! * 3
    const c = ix[t + 2]! * 3
    const y0 = p[a + 1]!
    const z0 = p[a + 2]!
    const d = (p[b + 1]! - y0) * (p[c + 2]! - z0) - (p[c + 1]! - y0) * (p[b + 2]! - z0)
    if (Math.abs(d) < 1e-12) continue
    const u = ((y - y0) * (p[c + 2]! - z0) - (p[c + 1]! - y0) * (z - z0)) / d
    const v = ((p[b + 1]! - y0) * (z - z0) - (y - y0) * (p[b + 2]! - z0)) / d
    if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue
    best = Math.max(best, end * (p[a]! + u * (p[b]! - p[a]!) + v * (p[c]! - p[a]!)))
  }
  return end * best
}

const plates = new Map<string, number>()

/** How far along a body a number plate is: just clear of the skin at the middle of the plate. */
export function plateAt(shape: VehicleShape, end: 1 | -1): number {
  const key = `${shape.kind}:${end}`
  const known = plates.get(key)
  if (known !== undefined) return known
  const skin = skinAt(vehicleMesh(shape.kind, 'near'), end > 0 ? shape.plates.front : shape.plates.back, 0, end)
  const x = Number.isFinite(skin) ? skin + end * 0.012 : end * (shape.length / 2 + 0.012)
  plates.set(key, x)
  return x
}

// ------------------------------------------------------------ drawing outlines

/**
 * How far past the middle of an end an outline that reaches the middle is
 * taken. Each end is drawn as one half and its mirror, so an outline with an
 * edge on the middle line would have every point of that line on its edge,
 * half in and half out: a seam down the middle of a grille.
 */
const ACROSS = 0.06

/** A point on the middle line, taken across it. */
const across = (p: Pt): Pt => (p[0] === 0 ? [-ACROSS, p[1]] : p)

/** A polygon with every corner rounded off by `r` metres, `n` points to a corner — but those on the middle line, which are taken across it. */
export function rounded(points: readonly Pt[], r: number, n = 3): Pt[] {
  if (r <= 0) return points.map(across)
  const out: Pt[] = []
  const count = points.length
  for (let i = 0; i < count; i++) {
    const p = points[i]!
    if (p[0] === 0) {
      out.push(across(p))
      continue
    }
    const a = points[(i - 1 + count) % count]!
    const b = points[(i + 1) % count]!
    const la = Math.hypot(a[0] - p[0], a[1] - p[1])
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1])
    const ra = Math.min(r, la * 0.45)
    const rb = Math.min(r, lb * 0.45)
    const from: Pt = [p[0] + ((a[0] - p[0]) * ra) / la, p[1] + ((a[1] - p[1]) * ra) / la]
    const to: Pt = [p[0] + ((b[0] - p[0]) * rb) / lb, p[1] + ((b[1] - p[1]) * rb) / lb]
    // A quadratic curve from one edge to the next, with the corner as its control point.
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const s = 1 - t
      out.push([s * s * from[0] + 2 * s * t * p[0] + t * t * to[0], s * s * from[1] + 2 * s * t * p[1] + t * t * to[1]])
    }
  }
  return out
}

/** A box from (u0, y0) to (u1, y1), its corners rounded by r. */
export function box(u0: number, y0: number, u1: number, y1: number, r = 0): Pt[] {
  return rounded(
    [
      [u0, y0],
      [u1, y0],
      [u1, y1],
      [u0, y1],
    ],
    r,
  )
}

/** An ellipse round (cu, cy). */
export function oval(cu: number, cy: number, ru: number, ry: number, n = 20): Pt[] {
  const out: Pt[] = []
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    out.push([cu + Math.cos(a) * ru, cy + Math.sin(a) * ry])
  }
  return out
}

/** A thin line between two points, as an outline: a shut line, a strip of chrome. */
export function stroke(from: Pt, to: Pt, width: number): Pt[] {
  const a = across(from)
  const b = across(to)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l = Math.hypot(dx, dy) || 1
  const nx = (-dy / l) * (width / 2)
  const ny = (dx / l) * (width / 2)
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ]
}

const nose = (kind: DecalKind, at: readonly Pt[], face?: 0 | 1): Decal => (face === undefined ? { kind, end: 1, at } : { kind, end: 1, at, face })
const tail = (kind: DecalKind, at: readonly Pt[], face?: 0 | 1): Decal => (face === undefined ? { kind, end: -1, at } : { kind, end: -1, at, face })

/**
 * The bodies. Lengths are metres; x runs from the tail (negative) to the nose,
 * y up from the road, z out to the car's right. Lengths, widths, heights,
 * wheelbases and tracks are the real cars' published ones.
 */
export const VEHICLE_SHAPES: Record<VehicleKind, VehicleShape> = {
  // After the second Chevrolet Cobalt, as it is built in Asaka: the commonest car in
  // the country. A tall body on a long nose and a short tail — the front wheels sit
  // well back, the rear ones nearly under the bumper — a high short boot, big swept
  // headlamps, a slot of a grille over a body-coloured bar and a deep lower one,
  // tall lamps on the rear corners and the plate down on the bumper.
  cobalt: {
    kind: 'cobalt',
    length: 4.479,
    width: 1.735,
    height: 1.514,
    clearance: 0.16,
    // Read off photographs through cameras solved from the wheels and the plates: a short nose
    // (the plate 0.77 m ahead of the front axle) and a long tail over the big boot.
    axles: [1.44, -1.18],
    wheel: { radius: 0.317, width: 0.185, style: 'cover' },
    top: [[-2.2395, 1.0], [-2.19, 1.055], [-2.0, 1.08], [-1.66, 1.1], [-1.06, 1.46], [-0.6, 1.505], [-0.15, 1.514], [0.36, 1.49], [1.02, 1.0], [1.6, 0.955], [2.0, 0.91], [2.12, 0.86], [2.2, 0.76], [2.2395, 0.64]],
    belt: [[-2.2395, 0.98], [-1.5, 1.045], [-0.6, 1.02], [0.5, 0.99], [0.95, 0.965], [1.7, 0.92], [2.1, 0.84], [2.2395, 0.62]],
    plan: [[-2.2395, 0.8], [-1.95, 0.855], [-0.5, 0.8675], [1.2, 0.865], [1.55, 0.855], [1.9, 0.82], [2.1, 0.77], [2.2395, 0.71]],
    roof: 0.57,
    crown: 0.045,
    nose: 0.42,
    tail: 0.24,
    blunt: 0.86,
    dome: [0.08, 0.05],
    lip: 0.02,
    chin: 0.02,
    under: [[-2.2395, 0.33], [-2.05, 0.3], [-1.75, 0.22], [-1.55, 0.17], [1.1, 0.16], [1.75, 0.2], [2.0, 0.24], [2.2395, 0.27]],
    corner: 2.2,
    tuck: 0.035,
    hard: [6],
    glass: { front: [1.02, 0.36], rear: [-1.06, -1.66] },
    windows: {
      outline: rounded([[1.0, 0.9], [0.97, 0.99], [0.36, 1.56], [-1.0, 1.56], [-1.56, 1.06], [-1.56, 0.9]], 0.03),
      bars: [[-0.07, -0.13, 0.045, 1], [-1.17, -1.06, 0.018, 1]],
    },
    doors: [0.98, -0.1, -1.2],
    cladding: false,
    decals: [
      // The front, as the photographs have it: a slot of a grille in a chrome frame over a
      // bigger trapezoid one, the blank where the badge is between them; the plate on the
      // bumper over a mesh intake, fog lamps in black housings on the bumper's corners; and the
      // big headlamps, tall at their outer ends, swept back up the wings to the arches.
      nose('chrome', rounded([[0, 0.812], [0.53, 0.797], [0.5, 0.712], [0, 0.716]], 0.025)),
      nose('slats', rounded([[0, 0.798], [0.505, 0.785], [0.48, 0.726], [0, 0.729]], 0.02)),
      nose('chrome', rounded([[0, 0.705], [0.5, 0.69], [0.47, 0.528], [0, 0.524]], 0.03)),
      nose('mesh', rounded([[0, 0.69], [0.48, 0.676], [0.452, 0.542], [0, 0.538]], 0.025)),
      nose('blank', oval(0, 0.705, 0.075, 0.032)),
      nose('mesh', rounded([[0.3, 0.4], [0.47, 0.4], [0.44, 0.27], [0.3, 0.27]], 0.02)),
      nose('mesh', rounded([[0, 0.33], [0.32, 0.33], [0.32, 0.27], [0, 0.265]], 0.015)),
      nose('black', rounded([[0.68, 0.39], [0.88, 0.4], [0.9, 0.48], [0.7, 0.475]], 0.035)),
      nose('fog', oval(0.79, 0.437, 0.04, 0.034)),
      // Big headlamps, pointed at the grille and tall at their outer ends, wrapping onto the wings.
      nose('chrome', rounded([[0.585, 0.598], [0.65, 0.67], [0.79, 0.768], [0.93, 0.834], [1.04, 0.872], [1.155, 0.895], [1.17, 0.8], [1.135, 0.71], [1.09, 0.662], [0.94, 0.617], [0.8, 0.587], [0.67, 0.575]], 0.025)),
      nose('head', rounded([[0.6, 0.605], [0.66, 0.665], [0.79, 0.758], [0.93, 0.822], [1.04, 0.86], [1.14, 0.882], [1.155, 0.8], [1.12, 0.72], [1.08, 0.675], [0.94, 0.63], [0.8, 0.6], [0.68, 0.588]], 0.02)),
      // The back: tall lamps on the corners, split across the middle with a strip of chrome, a
      // clear lens in each half; the boot lid's shut lines; chrome along the bumper over the
      // plate; the blank on the boot lid; reflectors low in the bumper's corners.
      tail('tail', rounded([[0.6, 0.74], [0.655, 1.0], [0.68, 1.06], [0.84, 1.075], [0.98, 1.055], [1.03, 0.92], [1.0, 0.79], [0.9, 0.74]], 0.06)),
      tail('chrome', stroke([0.625, 0.905], [1.02, 0.905], 0.014)),
      tail('reverse', rounded([[0.645, 0.925], [0.665, 1.03], [0.78, 1.045], [0.78, 0.925]], 0.015)),
      tail('reverse', rounded([[0.612, 0.76], [0.628, 0.89], [0.75, 0.89], [0.75, 0.76]], 0.015)),
      tail('black', stroke([0, 0.762], [0.6, 0.765], 0.006)),
      tail('black', stroke([0.6, 0.765], [0.68, 1.075], 0.006)),
      tail('blank', oval(0, 0.95, 0.06, 0.035)),
      tail('chrome', stroke([0, 0.565], [0.56, 0.555], 0.014)),
      tail('reflector', box(0.66, 0.44, 0.8, 0.47, 0.008)),
    ],
    head: { y: 0.8, z: 0.72 },
    plates: { front: 0.445, back: 0.47 },
    mirror: [0.82, 1.03, 0.92],
    cabin: { belt: 1.0, top: 1.45, half: 0.76, front: 0.92, rear: -1.52, seats: [-0.05, -1.0], lit: false },
  },
  // After the Nexia — the Kadett-E body built here for twenty years, in its 2008
  // face: square and low, a long flat boot behind an upright rear window, thin
  // pillars, rectangular headlamps, a chrome-barred grille, black rubbing strips
  // down the sides and across the bumpers, small wheels.
  nexia: {
    kind: 'nexia',
    length: 4.482,
    width: 1.662,
    height: 1.393,
    clearance: 0.158,
    axles: [1.43, -1.09],
    wheel: { radius: 0.288, width: 0.175, style: 'cover' },
    top: [[-2.241, 0.97], [-2.19, 1.0], [-1.95, 1.008], [-1.4, 1.012], [-0.92, 1.36], [-0.68, 1.393], [0.12, 1.39], [0.25, 1.37], [0.9, 0.96], [1.6, 0.87], [2.08, 0.8], [2.241, 0.755]],
    belt: [[-2.241, 0.92], [-1.4, 0.94], [0, 0.925], [0.9, 0.9], [1.6, 0.835], [2.241, 0.72]],
    plan: [[-2.241, 0.79], [-2.0, 0.825], [-0.4, 0.831], [1.5, 0.829], [2.0, 0.815], [2.241, 0.79]],
    roof: 0.62,
    crown: 0.025,
    nose: 0.16,
    tail: 0.1,
    blunt: 0.84,
    lip: 0.02,
    corner: 2.0,
    tuck: 0.02,
    glass: { front: [0.9, 0.25], rear: [-0.92, -1.4] },
    windows: {
      outline: rounded([[0.95, 0.9], [0.92, 0.94], [0.27, 1.44], [-0.9, 1.44], [-1.36, 1.0], [-1.36, 0.9]], 0.025),
      bars: [[-0.06, -0.1, 0.035, 1], [-0.97, -0.97, 0.014, 1]],
    },
    doors: [0.93, -0.06, -1.02],
    cladding: false,
    strip: 0.42,
    decals: [
      // The 2008 face: almond headlamps, a round projector bowl in each; a chrome-framed
      // trapezoid of a grille with a bar across it and the badge on the bar; the plate on the
      // body-coloured bumper over a wide black slot; fog lamps in black corner housings.
      nose('chrome', rounded([[0, 0.672], [0.282, 0.672], [0.234, 0.554], [0, 0.554]], 0.025)),
      nose('slats', rounded([[0, 0.658], [0.264, 0.658], [0.224, 0.568], [0, 0.568]], 0.018)),
      nose('chrome', box(0, 0.604, 0.248, 0.622)),
      nose('blank', oval(0, 0.614, 0.055, 0.03)),
      nose('chrome', rounded([[0.268, 0.598], [0.3, 0.665], [0.55, 0.69], [0.76, 0.698], [0.87, 0.692], [0.95, 0.672], [0.95, 0.598], [0.79, 0.566], [0.5, 0.554], [0.33, 0.566]], 0.025)),
      nose('head', rounded([[0.28, 0.6], [0.31, 0.658], [0.55, 0.682], [0.76, 0.69], [0.86, 0.684], [0.94, 0.665], [0.94, 0.604], [0.78, 0.574], [0.5, 0.563], [0.34, 0.573]], 0.02)),
      nose('slats', rounded([[0, 0.36], [0.44, 0.358], [0.41, 0.296], [0, 0.296]], 0.015)),
      nose('black', rounded([[0.5, 0.366], [0.7, 0.374], [0.76, 0.27], [0.52, 0.27]], 0.02)),
      nose('fog', oval(0.62, 0.318, 0.042, 0.036)),
      // The back: wide lamps across the corners, a clear inner part with the reversing lamp in
      // it; the plate on the boot lid between them with a strip of chrome over it; the lid's shut
      // line under it; the body-coloured bumper with a crease along it.
      tail('tail', rounded([[0.42, 0.775], [0.41, 0.868], [0.7, 0.888], [0.9, 0.878], [0.93, 0.79], [0.76, 0.766]], 0.02)),
      tail('reverse', rounded([[0.42, 0.778], [0.412, 0.865], [0.53, 0.872], [0.53, 0.772]], 0.012)),
      tail('chrome', stroke([0, 0.885], [0.38, 0.882], 0.012)),
      tail('blank', oval(0, 0.925, 0.05, 0.028)),
      tail('black', stroke([0, 0.742], [0.42, 0.746], 0.005)),
      tail('black', stroke([0, 0.6], [0.9, 0.6], 0.006)),
      tail('reflector', box(0.62, 0.47, 0.8, 0.495, 0.006)),
    ],
    head: { y: 0.63, z: 0.55 },
    plates: { front: 0.427, back: 0.805 },
    mirror: [0.8, 0.97, 0.86],
    cabin: { belt: 0.93, top: 1.33, half: 0.7, front: 0.88, rear: -1.27, seats: [-0.05, -0.95], lit: false },
  },
  // After the Gentra, the sedan once called Lacetti, in its Asaka face: smooth and
  // rounded, big swept headlamps, a wide grille with a bar of chrome across it, a
  // deep lower intake, two-part lamps round the rear corners onto the boot lid.
  gentra: {
    kind: 'gentra',
    length: 4.515,
    width: 1.725,
    height: 1.445,
    clearance: 0.16,
    axles: [1.37, -1.23],
    wheel: { radius: 0.298, width: 0.195, style: 'alloy' },
    top: [[-2.2575, 0.96], [-2.2, 1.015], [-2.0, 1.048], [-1.65, 1.066], [-0.98, 1.4], [-0.3, 1.445], [0.2, 1.42], [1.0, 1.0], [1.7, 0.89], [2.1, 0.83], [2.2575, 0.78]],
    belt: [[-2.2575, 0.93], [-1.6, 0.99], [0, 0.96], [1.0, 0.925], [1.7, 0.86], [2.2575, 0.76]],
    plan: [[-2.2575, 0.78], [-1.9, 0.845], [-0.3, 0.8625], [1.5, 0.855], [2.0, 0.82], [2.2575, 0.75]],
    roof: 0.6,
    crown: 0.04,
    nose: 0.3,
    tail: 0.26,
    blunt: 0.72,
    dome: [0.07, 0.05],
    lip: 0.06,
    glass: { front: [1.0, 0.2], rear: [-0.98, -1.65] },
    windows: {
      outline: rounded([[1.0, 0.9], [0.98, 0.95], [0.22, 1.5], [-0.92, 1.5], [-1.52, 1.02], [-1.52, 0.9]], 0.035),
      bars: [[-0.08, -0.12, 0.04, 1], [-1.2, -1.06, 0.02, 1]],
    },
    doors: [0.98, -0.1, -1.18],
    cladding: false,
    decals: [
      // A horizontal grille in a chrome frame with bars across it, between big headlamps that
      // sweep back up the wings; the plate on the bumper, a wide black intake under it, fog
      // lamps in small black housings at its ends.
      nose('chrome', rounded([[0, 0.742], [0.33, 0.736], [0.3, 0.616], [0, 0.612]], 0.03)),
      nose('slats', rounded([[0, 0.728], [0.31, 0.722], [0.286, 0.628], [0, 0.625]], 0.024)),
      nose('chrome', box(0, 0.66, 0.3, 0.674)),
      nose('chrome', box(0, 0.692, 0.3, 0.704)),
      nose('blank', oval(0, 0.682, 0.058, 0.03)),
      nose('chrome', rounded([[0.33, 0.63], [0.35, 0.75], [0.62, 0.785], [0.9, 0.81], [1.16, 0.85], [1.26, 0.848], [1.14, 0.77], [0.88, 0.685], [0.6, 0.632]], 0.03)),
      nose('head', rounded([[0.345, 0.64], [0.362, 0.742], [0.62, 0.775], [0.9, 0.8], [1.15, 0.838], [1.24, 0.836], [1.12, 0.77], [0.87, 0.692], [0.6, 0.642]], 0.025)),
      nose('mesh', rounded([[0, 0.37], [0.5, 0.37], [0.46, 0.28], [0, 0.28]], 0.03)),
      nose('black', rounded([[0.56, 0.36], [0.76, 0.37], [0.8, 0.3], [0.58, 0.29]], 0.02)),
      nose('fog', oval(0.67, 0.33, 0.045, 0.03)),
      // Lamps round the rear corners, in two: the outer on the body, the inner on the boot lid;
      // the plate on the lid in a recess with chrome over it.
      tail('tail', rounded([[0.45, 0.8], [0.44, 0.97], [0.78, 1.0], [1.05, 0.985], [1.22, 0.95], [1.02, 0.86], [0.76, 0.8]], 0.04)),
      tail('black', stroke([0.56, 0.8], [0.55, 0.995], 0.005)),
      tail('reverse', oval(0.64, 0.88, 0.05, 0.03)),
      tail('chrome', box(0, 0.872, 0.36, 0.886)),
      tail('blank', oval(0, 0.935, 0.055, 0.03)),
      tail('black', stroke([0, 0.715], [0.44, 0.72], 0.005)),
      tail('reflector', box(0.6, 0.47, 0.78, 0.5, 0.008)),
    ],
    head: { y: 0.73, z: 0.62 },
    plates: { front: 0.43, back: 0.8 },
    mirror: [0.9, 1.0, 0.92],
    cabin: { belt: 0.96, top: 1.39, half: 0.75, front: 1.0, rear: -1.58, seats: [0.02, -0.98], lit: false },
  },
  // After the Damas: one box, the driver over the front wheels, a windscreen that is
  // nearly upright over a short flat face, small lamps low on the corners with amber
  // beside them, a black bumper, a sliding door, a deep panel over the windows, tiny
  // wheels at the very corners. Half of them are the city's minibuses, with a route
  // card behind the windscreen.
  damas: {
    kind: 'damas',
    length: 3.485,
    width: 1.4,
    height: 1.91,
    clearance: 0.17,
    // The front wheels well back under the seats, the face nearly a metre ahead of them: read
    // off a photograph through a camera solved from the wheels.
    axles: [0.8225, -1.0175],
    wheel: { radius: 0.276, width: 0.155, style: 'steel' },
    top: [[-1.7425, 1.82], [-1.68, 1.885], [-1.4, 1.91], [1.2, 1.91], [1.38, 1.885], [1.47, 1.835], [1.665, 1.05], [1.72, 1.0], [1.7425, 0.93]],
    belt: [[-1.7425, 1.05], [1.2, 1.05], [1.62, 1.04], [1.7425, 0.93]],
    plan: [[-1.7425, 0.675], [-1.6, 0.695], [1.3, 0.7], [1.62, 0.69], [1.7425, 0.65]],
    roof: 0.62,
    crown: 0.03,
    glassTop: 1.68,
    nose: 0.1,
    tail: 0.07,
    blunt: 0.86,
    lip: 0.03,
    glass: { front: [1.665, 1.47] },
    windows: {
      outline: rounded([[1.64, 1.06], [1.6, 1.16], [1.47, 1.72], [-1.62, 1.72], [-1.62, 1.06]], 0.04),
      bars: [[0.72, 0.74, 0.045, 0], [-0.35, -0.35, 0.04, 0]],
    },
    doors: [1.58, 0.72, -0.35],
    cladding: false,
    strip: 0.55,
    decals: [
      // The later face: a grey panel across the front with a grille in its middle and the badge;
      // round headlamps in square chrome bezels at its ends, the indicators beside them; a black
      // bumper with amber lamps in its corners and the plate in its middle.
      nose('chrome', box(0, 0.625, 0.66, 0.805, 0.012)),
      nose('slats', box(0, 0.65, 0.3, 0.78, 0.01)),
      nose('blank', oval(0, 0.715, 0.05, 0.028)),
      nose('lens', box(0.355, 0.64, 0.585, 0.79, 0.012)),
      nose('head', oval(0.47, 0.715, 0.068, 0.068, 24)),
      nose('amber', box(0.59, 0.645, 0.655, 0.785, 0.008)),
      nose('black', box(0, 0.3, 0.9, 0.53, 0.02)),
      nose('amber', box(0.52, 0.47, 0.64, 0.51, 0.006)),
      tail('tail', box(0.52, 0.64, 0.68, 0.93, 0.012)),
      tail('amber', box(0.52, 0.79, 0.68, 0.86)),
      tail('reverse', box(0.52, 0.64, 0.68, 0.7, 0.008)),
      tail('black', box(0, 0.3, 0.85, 0.52, 0.02)),
      tail('black', stroke([0, 0.565], [0.6, 0.565], 0.006)),
    ],
    head: { y: 0.73, z: 0.48 },
    slidingDoor: [-0.35, 0.72],
    backPane: { x: -1.7535, y: 1.4, z: 0, wide: 1.06, tall: 0.52 },
    card: { x: 1.52, y: 1.2, z: 0.36, wide: 0.3, tall: 0.2 },
    plates: { front: 0.42, back: 0.62 },
    mirror: [1.5, 1.18, 0.76],
    cabin: { belt: 1.06, top: 1.72, half: 0.62, front: 1.6, rear: -1.72, seats: [0.95, -0.15], lit: false },
  },
  // After the first Matiz: a tiny five-door taller than it is wide-looking, a short
  // sloping bonnet under a long raked windscreen, two big round lamps on the front
  // corners, a near-upright tailgate, tall oval lamps either side of it, and the
  // bumpers left in grey plastic.
  matiz: {
    kind: 'matiz',
    length: 3.495,
    width: 1.495,
    height: 1.485,
    clearance: 0.15,
    axles: [1.13, -1.21],
    wheel: { radius: 0.266, width: 0.145, style: 'cover' },
    top: [[-1.7475, 1.38], [-1.72, 1.45], [-1.6, 1.478], [-1.0, 1.485], [0.0, 1.475], [0.38, 1.44], [1.0, 0.96], [1.36, 0.86], [1.62, 0.8], [1.7475, 0.74]],
    belt: [[-1.7475, 0.96], [-1.0, 0.965], [0.3, 0.95], [1.0, 0.9], [1.45, 0.84], [1.7475, 0.74]],
    plan: [[-1.7475, 0.7], [-1.5, 0.735], [0, 0.7475], [1.2, 0.74], [1.55, 0.71], [1.7475, 0.64]],
    roof: 0.56,
    crown: 0.04,
    nose: 0.28,
    tail: 0.12,
    blunt: 0.72,
    lip: 0.07,
    glass: { front: [1.0, 0.4] },
    windows: {
      outline: rounded([[1.0, 0.9], [0.97, 0.95], [0.42, 1.5], [-1.48, 1.5], [-1.64, 1.32], [-1.64, 0.9]], 0.04),
      bars: [[-0.2, -0.22, 0.04, 1], [-1.17, -1.2, 0.022, 1]],
    },
    doors: [0.95, -0.2, -1.1],
    cladding: false,
    strip: 0.32,
    decals: [
      nose('black', rounded([[0, 0.56], [0.86, 0.56], [0.95, 0.5], [0.95, 0.36], [0, 0.33]], 0.04)),
      nose('slats', rounded([[0, 0.5], [0.36, 0.5], [0.34, 0.42], [0, 0.42]], 0.02)),
      nose('amber', oval(0.55, 0.52, 0.035, 0.022)),
      nose('slats', box(0, 0.66, 0.17, 0.7, 0.01)),
      nose('blank', oval(0, 0.68, 0.035, 0.018)),
      nose('head', oval(0.47, 0.745, 0.115, 0.1, 24)),
      tail('tail', oval(0.6, 0.97, 0.085, 0.17, 24)),
      tail('amber', rounded([[0.53, 1.04], [0.54, 1.11], [0.66, 1.11], [0.67, 1.04]], 0.03)),
      tail('reverse', oval(0.6, 0.9, 0.035, 0.035, 16)),
      tail('black', rounded([[0, 0.55], [0.86, 0.55], [0.92, 0.48], [0.92, 0.34], [0, 0.32]], 0.04)),
    ],
    head: { y: 0.745, z: 0.47 },
    backPane: { x: -1.7585, y: 1.2, z: 0, wide: 1.0, tall: 0.36 },
    plates: { front: 0.45, back: 0.45 },
    mirror: [0.88, 1.0, 0.8],
    cabin: { belt: 0.96, top: 1.44, half: 0.66, front: 0.98, rear: -1.6, seats: [-0.05, -0.95], lit: false },
  },
  // After the VAZ-2106 and 2107: the boxy Soviet sedan of the seventies, flat
  // bonnet, flat sides with a crease down them, thin pillars and chrome round the
  // windows. Some wear the 2106's face — four round lamps in a wide grille and
  // chrome bumpers — the rest the 2107's: square lamps, a tall chrome grille.
  zhiguli: {
    kind: 'zhiguli',
    length: 4.166,
    width: 1.611,
    height: 1.44,
    clearance: 0.17,
    axles: [1.305, -1.119],
    wheel: { radius: 0.288, width: 0.165, style: 'chrome' },
    top: [[-2.083, 0.93], [-2.05, 0.965], [-1.9, 0.975], [-1.32, 0.985], [-0.88, 1.4], [-0.7, 1.44], [0.2, 1.44], [0.32, 1.415], [0.85, 0.94], [1.5, 0.9], [1.95, 0.875], [2.083, 0.84]],
    belt: [[-2.083, 0.86], [-1.3, 0.9], [0, 0.9], [0.85, 0.89], [1.6, 0.86], [2.083, 0.8]],
    plan: [[-2.083, 0.79], [-1.95, 0.8], [0, 0.8055], [1.9, 0.8], [2.083, 0.785]],
    roof: 0.65,
    crown: 0.02,
    nose: 0.06,
    tail: 0.06,
    blunt: 0.92,
    lip: 0.02,
    tuck: 0.012,
    hard: [6],
    glass: { front: [0.85, 0.32], rear: [-0.88, -1.32] },
    windows: {
      outline: rounded([[0.88, 0.86], [0.86, 0.91], [0.33, 1.46], [-0.88, 1.46], [-1.3, 0.98], [-1.3, 0.86]], 0.02),
      bars: [[-0.1, -0.12, 0.028, 0], [-0.97, -0.97, 0.012, 0]],
      chrome: true,
      frame: 0.012,
    },
    doors: [0.86, -0.11, -1.0],
    cladding: false,
    strip: 0.78,
    stripChrome: true,
    decals: [
      // The 2106's face: a grille the width of the car with four round lamps in it, a chrome
      // bumper with a rubber strip, and the indicators under the lamps.
      nose('chrome', box(0, 0.6, 0.735, 0.775, 0.012), 0),
      nose('slats', box(0, 0.615, 0.25, 0.76, 0.006), 0),
      nose('lens', box(0.255, 0.612, 0.72, 0.763, 0.01), 0),
      nose('head', oval(0.355, 0.687, 0.068, 0.068, 24), 0),
      nose('head', oval(0.58, 0.687, 0.072, 0.072, 24), 0),
      nose('amber', box(0.48, 0.535, 0.66, 0.575, 0.008), 0),
      nose('chrome', box(0, 0.42, 0.98, 0.505, 0.015), 0),
      nose('black', box(0, 0.452, 0.98, 0.472), 0),
      // The 2107's: square lamps with the indicators in their outer ends, a tall chrome grille
      // with the bonnet stepped up over it, a black bumper with chrome along it.
      nose('chrome', box(0, 0.585, 0.205, 0.81, 0.012), 1),
      nose('slats', box(0, 0.6, 0.185, 0.795, 0.006), 1),
      nose('black', box(0.205, 0.6, 0.79, 0.775, 0.008), 1),
      nose('head', box(0.25, 0.615, 0.66, 0.765, 0.012), 1),
      nose('amber', box(0.66, 0.615, 0.78, 0.765, 0.01), 1),
      nose('black', box(0, 0.41, 0.98, 0.52, 0.02), 1),
      nose('chrome', box(0, 0.468, 0.98, 0.478), 1),
      // The back: big lamps in bands, red, amber and the reversing lamp; the plate on the panel
      // between them; chrome bumpers on the 2106, black on the 2107.
      tail('tail', box(0.36, 0.625, 0.79, 0.8, 0.012)),
      tail('amber', box(0.36, 0.745, 0.79, 0.8, 0.008)),
      tail('reverse', box(0.36, 0.625, 0.47, 0.69, 0.008)),
      tail('chrome', box(0, 0.42, 0.95, 0.5, 0.015), 0),
      tail('black', box(0, 0.452, 0.95, 0.47), 0),
      tail('black', box(0, 0.41, 0.95, 0.52, 0.02), 1),
      tail('chrome', box(0, 0.468, 0.95, 0.478), 1),
      tail('black', stroke([0, 0.82], [0.83, 0.82], 0.005)),
    ],
    head: { y: 0.687, z: 0.47 },
    plates: { front: 0.38, back: 0.7 },
    mirror: [0.72, 0.95, 0.86],
    cabin: { belt: 0.9, top: 1.38, half: 0.72, front: 0.84, rear: -1.27, seats: [-0.05, -0.95], lit: false },
  },
  // After the BYD Song Plus DM-i: a big crossover with a roof that slopes to a coupe's
  // tail, chrome round the windows, black plastic round the arches; in front the thin
  // headlamps run into a big grille, and across the back one light bar joins the
  // lamps from corner to corner.
  byd: {
    kind: 'byd',
    length: 4.705,
    width: 1.89,
    // The body, under its roof rails (the published 1.68 m is over them).
    height: 1.64,
    clearance: 0.19,
    axles: [1.43, -1.335],
    wheel: { radius: 0.359, width: 0.235, style: 'spokes' },
    // Read off a photograph through a camera solved from its wheels: a long bonnet that falls to a
    // low nose, the roof level to the spoiler, and a steep screen under it.
    top: [[-2.3525, 1.1], [-2.3, 1.16], [-2.2, 1.21], [-1.85, 1.52], [-1.4, 1.615], [-0.5, 1.64], [0.3, 1.615], [1.15, 1.13], [1.6, 1.04], [1.95, 0.93], [2.2, 0.83], [2.3525, 0.76]],
    // The windows' foot rises all the way back, to a point at the thick last pillar.
    belt: [[-2.3525, 1.12], [-2.0, 1.22], [-1.6, 1.33], [-1.2, 1.29], [-0.2, 1.165], [0.7, 1.09], [1.15, 1.07], [1.9, 0.93], [2.3525, 0.8]],
    plan: [[-2.3525, 0.85], [-2.0, 0.93], [0, 0.945], [1.7, 0.94], [2.1, 0.9], [2.3525, 0.82]],
    roof: 0.68,
    crown: 0.04,
    nose: 0.3,
    tail: 0.18,
    blunt: 0.76,
    dome: [0.12, 0.06],
    glass: { front: [1.15, 0.33], rear: [-1.82, -2.24] },
    windows: {
      outline: rounded([[0.72, 1.06], [0.5, 1.3], [0.31, 1.5], [0.15, 1.535], [-0.15, 1.55], [-0.95, 1.55], [-1.3, 1.53], [-1.45, 1.49], [-1.55, 1.4], [-1.17, 1.29], [-0.17, 1.165], [0.69, 1.08]], 0.03),
      bars: [[-0.13, -0.12, 0.075, 1], [-0.98, -0.9, 0.022, 1]],
      chrome: true,
      frame: 0.016,
    },
    doors: [0.98, -0.12, -1.0],
    cladding: true,
    flushHandles: true,
    decals: [
      // A big hexagon of a grille, chrome bars across it in a chrome frame; a chrome bar over it
      // from lamp to lamp with the badge's blank on it; slim headlamps from its upper corners back
      // along the wings, a running-light strip along their tops; black vents at the corners and
      // a black lip under the bumper with chrome along it.
      nose('chrome', rounded([[0, 0.745], [0.44, 0.745], [0.54, 0.575], [0.45, 0.375], [0, 0.37]], 0.04)),
      nose('slats', rounded([[0, 0.73], [0.425, 0.73], [0.52, 0.575], [0.435, 0.388], [0, 0.384]], 0.035)),
      nose('chrome', box(0, 0.752, 0.47, 0.778, 0.008)),
      nose('blank', oval(0, 0.765, 0.055, 0.02)),
      nose('black', rounded([[0.6, 0.38], [0.76, 0.4], [0.8, 0.58], [0.64, 0.56]], 0.02)),
      nose('black', box(0, 0.22, 1.2, 0.33, 0.02)),
      nose('chrome', stroke([0, 0.335], [1.0, 0.335], 0.012)),
      nose('chrome', rounded([[0.45, 0.745], [0.48, 0.795], [0.8, 0.82], [1.06, 0.855], [1.01, 0.8], [0.8, 0.77], [0.53, 0.74]], 0.015)),
      nose('head', rounded([[0.47, 0.75], [0.49, 0.788], [0.8, 0.812], [1.04, 0.848], [1.0, 0.805], [0.8, 0.776], [0.54, 0.748]], 0.012)),
      nose('led', rounded([[0.48, 0.783], [0.49, 0.792], [0.8, 0.816], [1.04, 0.85], [1.03, 0.84], [0.8, 0.807], [0.5, 0.779]], 0.004)),
      // One red bar right across the tailgate joining the lamps on the corners, which come to a
      // point round them; the plate low down in a black panel in the bumper, a silver plate under
      // that; a slit of a reflector at each corner and a black vent over it.
      tail('redbar', box(0, 1.0, 0.66, 1.048, 0.006)),
      tail('tail', rounded([[0.6, 0.985], [0.6, 1.06], [0.95, 1.085], [1.2, 1.07], [1.05, 1.0], [0.8, 0.975]], 0.015)),
      tail('blank', oval(0, 0.93, 0.055, 0.025)),
      tail('black', rounded([[0, 0.36], [0.6, 0.36], [0.52, 0.6], [0, 0.6]], 0.03)),
      tail('black', box(0, 0.25, 1.15, 0.36, 0.02)),
      tail('chrome', box(0, 0.28, 0.75, 0.33, 0.012)),
      tail('reflector', stroke([0.66, 0.46], [0.92, 0.47], 0.016)),
      tail('black', rounded([[0.84, 0.52], [0.9, 0.52], [0.92, 0.66], [0.86, 0.66]], 0.01)),
    ],
    head: { y: 0.8, z: 0.72 },
    plates: { front: 0.5, back: 0.48 },
    mirror: [0.8, 1.17, 1.0],
    cabin: { belt: 1.18, top: 1.56, half: 0.82, front: 1.1, rear: -2.1, seats: [0.05, -0.98], lit: false },
  },
  // After the ninth Malibu: the long sedan, low and swept, a roof that runs most of
  // the way to the tail with a sixth window in its pillar, chrome round the windows;
  // slim lamps that run into a grille in two, and slim lamps round the rear corners.
  malibu: {
    kind: 'malibu',
    length: 4.923,
    width: 1.854,
    height: 1.465,
    clearance: 0.14,
    axles: [1.47, -1.359],
    wheel: { radius: 0.334, width: 0.215, style: 'spokes' },
    top: [[-2.4615, 1.0], [-2.4, 1.05], [-2.15, 1.08], [-1.85, 1.1], [-1.05, 1.43], [-0.35, 1.465], [0.3, 1.43], [1.15, 1.0], [1.9, 0.88], [2.3, 0.82], [2.4615, 0.78]],
    belt: [[-2.4615, 0.96], [-1.8, 1.01], [0, 0.96], [1.15, 0.92], [1.9, 0.845], [2.4615, 0.74]],
    plan: [[-2.4615, 0.8], [-2.1, 0.9], [-0.3, 0.927], [1.6, 0.92], [2.2, 0.87], [2.4615, 0.76]],
    roof: 0.64,
    crown: 0.04,
    nose: 0.3,
    tail: 0.24,
    blunt: 0.72,
    lip: 0.06,
    tuck: 0.03,
    hard: [6],
    glass: { front: [1.15, 0.3], rear: [-1.05, -1.85] },
    windows: {
      outline: rounded([[1.15, 0.9], [1.12, 0.98], [0.3, 1.5], [-0.95, 1.5], [-1.62, 1.08], [-1.78, 1.0], [-1.78, 0.9]], 0.04),
      bars: [[-0.15, -0.18, 0.045, 1], [-1.3, -1.2, 0.035, 1]],
      chrome: true,
      frame: 0.014,
    },
    doors: [1.1, -0.15, -1.32],
    cladding: false,
    decals: [
      nose('chrome', rounded([[0, 0.8], [0.4, 0.795], [0.39, 0.72], [0, 0.72]], 0.02)),
      nose('slats', rounded([[0, 0.79], [0.38, 0.785], [0.37, 0.73], [0, 0.73]], 0.015)),
      nose('blank', oval(0, 0.76, 0.06, 0.028)),
      nose('slats', rounded([[0, 0.66], [0.56, 0.65], [0.5, 0.39], [0, 0.38]], 0.05)),
      nose('chrome', stroke([0, 0.58], [0.54, 0.58], 0.012)),
      nose('chrome', stroke([0, 0.5], [0.52, 0.5], 0.012)),
      nose('chrome', rounded([[0.68, 0.37], [0.86, 0.39], [0.88, 0.5], [0.7, 0.48]], 0.02)),
      nose('head', rounded([[0.4, 0.74], [0.43, 0.81], [0.82, 0.83], [1.2, 0.865], [1.1, 0.81], [0.82, 0.76], [0.5, 0.735]], 0.02)),
      nose('led', stroke([0.45, 0.8], [1.15, 0.85], 0.012)),
      tail('tail', rounded([[0.42, 0.9], [0.4, 0.985], [0.85, 1.02], [1.15, 1.0], [1.2, 0.965], [0.9, 0.92]], 0.02)),
      tail('chrome', box(0, 0.95, 0.4, 0.965)),
      tail('blank', oval(0, 0.91, 0.055, 0.028)),
      tail('black', box(0, 0.28, 0.62, 0.4, 0.02)),
      tail('reflector', box(0.68, 0.44, 0.86, 0.465, 0.006)),
    ],
    head: { y: 0.78, z: 0.68 },
    plates: { front: 0.46, back: 0.84 },
    mirror: [0.98, 1.0, 0.98],
    cabin: { belt: 0.97, top: 1.4, half: 0.8, front: 1.1, rear: -1.8, seats: [-0.05, -1.05], lit: false },
  },
  // The rest: a small crossover, black plastic round its skirts.
  crossover: {
    kind: 'crossover',
    length: 4.27,
    width: 1.79,
    height: 1.63,
    clearance: 0.21,
    axles: [1.3, -1.27],
    wheel: { radius: 0.345, width: 0.22, style: 'alloy' },
    top: [[-2.135, 1.1], [-2.04, 1.22], [-1.62, 1.56], [-0.4, 1.63], [0.4, 1.585], [1.12, 1.13], [1.8, 1.02], [2.03, 0.94], [2.135, 0.88]],
    belt: [[-2.135, 1.07], [-1.2, 1.085], [0.2, 1.04], [1.1, 1.005], [1.8, 0.955], [2.135, 0.78]],
    plan: [[-2.135, 0.8], [-1.8, 0.88], [0, 0.895], [1.6, 0.887], [1.98, 0.85], [2.135, 0.78]],
    roof: 0.63,
    crown: 0.04,
    nose: 0.24,
    tail: 0.14,
    blunt: 0.76,
    dome: [0.08, 0.05],
    glass: { front: [1.12, 0.4], rear: [-1.62, -2.03] },
    windows: {
      outline: rounded([[1.08, 1.0], [1.06, 1.05], [0.42, 1.62], [-1.5, 1.62], [-1.72, 1.15], [-1.72, 1.0]], 0.04),
      bars: [[-0.1, -0.13, 0.045, 1], [-1.08, -1.1, 0.045, 1]],
    },
    doors: [1.05, -0.1, -1.1],
    cladding: true,
    decals: [
      nose('slats', rounded([[0, 0.75], [0.33, 0.745], [0.31, 0.63], [0, 0.63]], 0.03)),
      nose('blank', oval(0, 0.69, 0.06, 0.03)),
      nose('mesh', rounded([[0, 0.47], [0.5, 0.46], [0.44, 0.34], [0, 0.34]], 0.03)),
      nose('head', rounded([[0.36, 0.73], [0.38, 0.82], [0.8, 0.84], [1.05, 0.86], [0.98, 0.8], [0.78, 0.74], [0.45, 0.72]], 0.03)),
      tail('tail', rounded([[0.46, 0.95], [0.46, 1.04], [0.82, 1.06], [1.0, 1.04], [0.92, 0.98], [0.72, 0.95]], 0.03)),
      tail('black', box(0, 0.3, 1.0, 0.45, 0.02)),
    ],
    head: { y: 0.78, z: 0.62 },
    plates: { front: 0.5, back: 0.72 },
    mirror: [0.98, 1.1, 0.96],
    cabin: { belt: 1.06, top: 1.52, half: 0.78, front: 1.08, rear: -1.98, seats: [0.06, -0.98], lit: false },
  },
  // Twelve metres of low floor in the city's lime green, after the gas-fuelled MAN Lion's City the
  // city runs: a black band of glass, three doors down the kerb side, the gas tanks in a white pod
  // along the roof, the front's lower half white under a slant, its lamps in the corners of it; at
  // the back a black window, round lamps stacked at the corners and the engine's louvres.
  bus: {
    kind: 'bus',
    length: 11.9,
    width: 2.5,
    height: 3.05,
    clearance: 0.3,
    axles: [3.25, -2.65],
    wheel: { radius: 0.48, width: 0.32, style: 'bus' },
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
    decals: [
      // The white of the front: right across under the windscreen, rising to a point at the
      // corner on the door side and wrapping round onto the flank; the bumper black under it.
      nose('white', [[0, 0.56], [1.4, 0.56], [1.78, 0.6], [1.78, 0.95], [1.3, 1.25], [0, 1.25]]),
      nose('black', box(0, 0.3, 1.4, 0.56, 0.03)),
      nose('slats', box(0, 0.36, 0.95, 0.5, 0.02)),
      nose('head', box(0.74, 0.7, 1.12, 0.84, 0.03)),
      nose('amber', box(1.02, 0.7, 1.12, 0.84, 0.01)),
      nose('fog', oval(0.86, 0.62, 0.045, 0.035)),
      tail('tail', box(0.92, 0.8, 1.1, 1.24, 0.02)),
      tail('amber', box(0.92, 1.12, 1.1, 1.24, 0.01)),
      tail('reverse', box(0.92, 0.72, 1.1, 0.8, 0.01)),
      tail('slats', box(1.25, 0.7, 1.75, 1.5, 0.02)),
      tail('black', box(0, 0.3, 1.4, 0.55, 0.03)),
    ],
    head: { y: 0.745, z: 0.9 },
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

/** How far a wheel arch stands clear of the tyre. */
export const ARCH_GAP = 0.055

interface Curves {
  top: (x: number) => number
  belt: (x: number) => number
  plan: (x: number) => number
  under: ((x: number) => number) | null
}

/** One cross-section's half: [z, y] for each of its points, written into `out` from `at`. */
function sectionAt(shape: VehicleShape, x: number, fns: Curves, out: Float64Array): boolean {
  // How far round the corner of an end this is: 0 at its last section, 1 clear of the corner.
  const [rimF, rimB] = rimOf(shape)
  const fromNose = rimF - x
  const fromTail = x + rimB
  const near = fromNose < fromTail ? clamp01(fromNose / shape.nose) : clamp01(fromTail / shape.tail)
  // A blunt end: nearly all of the turning is in the last few centimetres — or, on a rounder body, more of it.
  const square = shape.corner ?? 2.6
  const round = Math.pow(1 - Math.pow(1 - near, square), 1 / square)

  const cabinRise = shape.height - shape.crown - fns.belt(0)
  let yTop = fns.top(x)
  let yBelt = Math.min(fns.belt(x), yTop - 0.02)
  const w = fns.plan(x) * mix(shape.blunt, 1, round)
  let floor = fns.under ? fns.under(x) : shape.clearance
  // The ends are drawn in: the lip of a bonnet rolls over, an air dam comes up.
  const drawn = 1 - round
  const lip = shape.lip ?? 0.07
  yTop -= lip * drawn
  yBelt -= lip * drawn
  floor += (shape.chin ?? 0.05) * drawn

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
  const wBelt = w - (shape.tuck ?? 0.02)
  // The rail: where the side turns into the roof — or, over a bonnet, where the wing turns into the bonnet.
  const yRail = Math.max(yBelt + 0.014, yTop - shape.crown)
  const up = clamp01((yRail - yBelt) / cabinRise)
  const wRail = mix(wBelt - 0.04, Math.min(shape.roof, wBelt - 0.04), smooth(up))
  const yGlass = Math.max(yBelt + 0.008, Math.min(yRail - 0.03, shape.glassTop ?? Infinity))
  const zGlass = mix(wBelt - 0.012, wRail + 0.012, clamp01((yGlass - yBelt) / Math.max(yRail - yBelt, 1e-3)))
  const lower = floor + sill

  const z = [0, w * 0.55, w - sill, w - sill * 0.3, w - 0.012, w, w - 0.005, wBelt, wBelt - 0.012, mix(wBelt - 0.012, zGlass, 0.5) + 0.006 * up, zGlass, wRail, wRail - 0.035, wRail * 0.66, wRail * 0.33, 0]
  const y = [
    floor,
    floor,
    floor,
    floor + sill * 0.3,
    lower,
    mix(lower, yBelt, 0.4),
    mix(lower, yBelt, 0.74),
    yBelt - 0.012,
    yBelt + 0.004,
    mix(yBelt + 0.004, yGlass, 0.5),
    yGlass,
    yRail - 0.008,
    yRail + 0.012,
    yRail + (yTop - yRail) * (1 - Math.pow(0.66, 2.2)),
    yRail + (yTop - yRail) * (1 - Math.pow(0.33, 2.2)),
    yTop,
  ]
  for (let j = 0; j < HALF; j++) {
    out[j * 2] = z[j]!
    out[j * 2 + 1] = y[j]!
  }
  return arch
}

/** Half the width of a pillar, and the most that two sections may be apart, close up and far off. */
const PILLAR = 0.04
/** How many rings each end's dome has, close up and far off, and how it rounds: flatter in the middle as this is higher. */
const DOME_RINGS = { near: 3, far: 1 } as const
const DOME_ROUND = 2.4

/** Where the side windows start and stop along a body: its daylight opening's, or its glass's. */
function windowSpan(shape: VehicleShape): readonly [number, number] {
  if (shape.windows) {
    const xs = shape.windows.outline.map((p) => p[0])
    return [Math.max(...xs), Math.min(...xs)]
  }
  return shape.glass.side ?? [0, 0]
}
const STEP = { near: 0.16, far: 0.42 } as const
/** The width of the frame of a door of glass, and of the post between its two leaves. */
const FRAME = 0.06

/** Where along a body its sections go: at every place something changes, and often enough between. */
function stations(shape: VehicleShape, detail: BodyDetail): number[] {
  const [rimF, rimB] = rimOf(shape)
  const far = detail === 'far'
  const marks: number[] = []
  // The ends, closely: that is where a body turns fastest.
  for (const d of far ? [0, 0.03, 0.1, 0.21] : [0, 0.01, 0.03, 0.06, 0.1, 0.15, 0.21]) {
    if (d <= shape.nose + 0.02) marks.push(rimF - d)
    if (d <= shape.tail + 0.02) marks.push(-rimB + d)
  }
  marks.push(rimF - shape.nose, -rimB + shape.tail)
  // The glass, the pillars, the doors.
  const g = shape.glass
  const span = windowSpan(shape)
  marks.push(g.front[0], g.front[1], span[0], span[1])
  if (g.rear) marks.push(g.rear[0], g.rear[1])
  for (const at of shape.windows ? [] : (g.pillars ?? [])) marks.push(at - PILLAR, at + PILLAR)
  if (!far) marks.push(...shape.doors)
  for (const [from, until] of shape.kerbDoors ?? []) {
    const middle = (from + until) / 2
    marks.push(from, until)
    if (!far) marks.push(from + FRAME, middle - FRAME / 2, middle + FRAME / 2, until - FRAME)
  }
  for (const key of shape.top) marks.push(key[0])
  // Round each wheel, evenly by angle, and a hair either side of the arch.
  const reach = shape.wheel.radius + ARCH_GAP
  const around = far ? 5 : 12
  for (const axle of shape.axles) {
    for (let k = 1; k < around; k++) marks.push(axle + reach * Math.cos((Math.PI * k) / around))
    marks.push(axle - reach - 0.004, axle + reach + 0.004, axle - reach + 0.004, axle + reach - 0.004)
  }
  marks.sort((a, b) => a - b)
  const step = STEP[detail]
  const out: number[] = []
  for (const mark of marks) {
    if (mark < -rimB - 1e-6 || mark > rimF + 1e-6) continue
    const last = out[out.length - 1]
    if (last !== undefined && mark - last < (far ? 0.012 : 0.003)) continue
    // Never further apart than this: a skin is only as smooth as its sections are close.
    if (last !== undefined) {
      const gaps = Math.ceil((mark - last) / step)
      for (let k = 1; k < gaps; k++) out.push(last + ((mark - last) * k) / gaps)
    }
    out.push(mark)
  }
  return out
}

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

const built = new Map<string, VehicleMesh>()

/** The mesh of one of the bodies, close up or far off. Made once; plain arithmetic. */
export function vehicleMesh(kind: VehicleKind, detail: BodyDetail = 'near'): VehicleMesh {
  const key = `${kind}:${detail}`
  const ready = built.get(key)
  if (ready) return ready
  const mesh = loft(VEHICLE_SHAPES[kind], detail)
  built.set(key, mesh)
  return mesh
}

/** The cosine of the angle past which two faces meet in an edge rather than a curve. */
const CREASE = Math.cos((46 * Math.PI) / 180)

function loft(shape: VehicleShape, detail: BodyDetail): VehicleMesh {
  const fns: Curves = { top: curve(shape.top), belt: curve(shape.belt), plan: curve(shape.plan), under: shape.under ? curve(shape.under) : null }
  const xs = stations(shape, detail)
  const n = xs.length
  const half = new Float64Array(HALF * 2)
  const arches = new Uint8Array(n)
  // Rows of points, from the middle of the back to the middle of the front: the rings of the back's
  // dome, a ring to each section, the rings of the front's dome.
  // (A shallow end needs no more than a ring, or none far off.)
  const [domeF, domeB] = domeOf(shape)
  const domeRings = Math.max(domeF, domeB) >= 0.05 ? DOME_RINGS[detail] : detail === 'near' ? 1 : 0
  const rows = n + domeRings * 2
  /** The row of the first section. */
  const first = domeRings
  const isSection = (r: number) => r >= first && r < first + n
  /** Whether the strip of faces from a row to the next is between two sections, not in a dome. */
  const between = (r: number) => isSection(r) && isSection(r + 1)

  // ---- the points: a ring to a row, one in the middle of each end, and the mirrors ---
  const pods = detail === 'near' ? 2 : 0
  const POD_ROWS = 5
  const POD_COLS = 8
  const podPoints = (POD_ROWS - 1) * POD_COLS + 2
  const points = new Float32Array((rows * RING + 2 + pods * podPoints) * 3)
  for (let i = 0; i < n; i++) {
    arches[i] = sectionAt(shape, xs[i]!, fns, half) ? 1 : 0
    const x = xs[i]!
    for (let j = 0; j < RING; j++) {
      const k = j < HALF ? j : RING - j
      const p = ((first + i) * RING + j) * 3
      points[p] = x
      points[p + 1] = half[k * 2 + 1]!
      points[p + 2] = j < HALF ? half[k * 2]! : -half[k * 2]!
    }
  }
  const ringAt = (r: number, j: number) => r * RING + (((j % RING) + RING) % RING)
  const middle = (r: number) => (points[ringAt(r, 0) * 3 + 1]! + points[ringAt(r, HALF - 1) * 3 + 1]!) / 2
  const tailHub = rows * RING
  const noseHub = tailHub + 1
  // The domes: each of their rings the last section's, drawn in towards the middle of the end and
  // brought out towards it, less and less steeply — a shallow, rounded face, which runs on into the
  // corners round it without an edge.
  for (const [rim, hub, end, depth] of [
    [first, tailHub, -1, domeB],
    [first + n - 1, noseHub, 1, domeF],
  ] as const) {
    const rimX = points[ringAt(rim, 0) * 3]!
    const hubY = middle(rim)
    points.set([rimX + end * depth, hubY, 0], hub * 3)
    for (let k = 1; k <= domeRings; k++) {
      const s = 1 - k / (domeRings + 1)
      const row = rim + end * k
      const x = rimX + end * depth * (1 - Math.pow(s, DOME_ROUND))
      for (let j = 0; j < RING; j++) {
        const from = ringAt(rim, j) * 3
        const to = ringAt(row, j) * 3
        points[to] = x
        points[to + 1] = hubY + (points[from + 1]! - hubY) * s
        points[to + 2] = points[from + 2]! * s
      }
    }
  }

  // ---- what each face of the skin is made of ------------------------------------
  const g = shape.glass
  const span = windowSpan(shape)
  const drawn = shape.windows !== undefined
  const inside = (x: number, a: number, b: number) => x > Math.min(a, b) - 1e-6 && x < Math.max(a, b) + 1e-6
  /** A door of glass in the kerb side: 0 clear of one, 1 in its glass, 2 in its frame or the post between its leaves. */
  const kerbDoor = (x: number): number => {
    for (const [from, until] of shape.kerbDoors ?? []) {
      if (!inside(x, from, until)) continue
      const mid = (from + until) / 2
      return x < from + FRAME || x > until - FRAME || Math.abs(x - mid) < FRAME / 2 ? 2 : 1
    }
    return 0
  }
  const quads = (rows - 1) * RING
  const partOf = new Uint8Array(quads)
  const sideOf = new Uint8Array(quads)
  for (let r = 0; r < rows - 1; r++) {
    // A dome is paint, for the shader to put lamps and a grille on.
    if (!between(r)) {
      partOf.fill(PART.paint, r * RING, (r + 1) * RING)
      continue
    }
    const i = r - first
    const x = (xs[i]! + xs[i + 1]!) / 2
    const arch = arches[i] === 1 && arches[i + 1] === 1
    const pillarHere = (g.pillars ?? []).some((at) => Math.abs(x - at) < PILLAR)
    const sideGlass = inside(x, span[0], span[1])
    const screen = inside(x, g.front[0], g.front[1]) || (g.rear !== undefined && inside(x, g.rear[0], g.rear[1]))
    for (let j = 0; j < RING; j++) {
      const role = j < HALF - 1 ? j : RING - 1 - j
      // A door of glass, on the kerb side only: glass from the sill up, in a frame.
      const door = j < HALF - 1 ? kerbDoor(x) : 0
      let part: number = PART.paint
      if (role < ROLE.sill) part = PART.under
      // The sill: a black strip along the foot of the doors, and painted where it is the lip of an arch.
      else if (role < ROLE.door) part = arch ? PART.paint : PART.trim
      else if (role < ROLE.belt) part = door === 1 ? PART.glass : door === 2 ? PART.trim : PART.paint
      // The crease of the belt line and the band above it: where the windows are drawn, if they are;
      // or else a strip under the glass, and the glass between its pillars.
      else if (role < ROLE.rail && drawn) part = sideGlass ? PART.window : PART.paint
      else if (role < ROLE.glass) part = door === 1 ? PART.glass : sideGlass ? PART.trim : PART.paint
      else if (role < ROLE.rail) part = door === 2 ? PART.trim : sideGlass && (!pillarHere || door === 1) ? PART.glass : PART.paint
      else if (role < ROLE.top) part = shape.glassTop !== undefined && sideGlass ? PART.second : PART.paint
      else part = screen ? PART.glass : shape.glassTop !== undefined ? PART.second : PART.paint
      const f = r * RING + j
      partOf[f] = part
      sideOf[f] = role >= ROLE.door && role < ROLE.belt && part === PART.paint ? 1 : 0
    }
  }

  // ---- how each face of the skin lies: Newell's normal, and its area ---------------
  const faceN = new Float64Array(quads * 4)
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < RING; j++) {
      const c0 = ringAt(i, j) * 3
      const c1 = ringAt(i + 1, j) * 3
      const c2 = ringAt(i + 1, j + 1) * 3
      const c3 = ringAt(i, j + 1) * 3
      let nx = 0
      let ny = 0
      let nz = 0
      const cs = [c0, c1, c2, c3]
      for (let k = 0; k < 4; k++) {
        const p = cs[k]!
        const q = cs[(k + 1) % 4]!
        nx += (points[p + 1]! - points[q + 1]!) * (points[p + 2]! + points[q + 2]!)
        ny += (points[p + 2]! - points[q + 2]!) * (points[p]! + points[q]!)
        nz += (points[p]! - points[q]!) * (points[p + 1]! + points[q + 1]!)
      }
      const length = Math.hypot(nx, ny, nz)
      const f = (i * RING + j) * 4
      if (length > 1e-12) {
        faceN[f] = nx / length
        faceN[f + 1] = ny / length
        faceN[f + 2] = nz / length
        faceN[f + 3] = length / 2
      }
    }
  }

  // ---- as it is drawn ------------------------------------------------------------
  const hard = shape.hard ?? []
  /** Which side of each sharp crease a face of the ring is on, as one number. */
  const hardSide = (j: number): number => {
    const role = j < HALF - 1 ? j : RING - 1 - j
    let side = 0
    for (let k = 0; k < hard.length; k++) if (role >= hard[k]!) side |= 1 << k
    return side
  }
  const capTris = RING * 2
  const podTris = pods * POD_COLS * 2 * (POD_ROWS - 1)
  const vertexCount = quads * 4 + capTris * 3 + podTris * 3
  const position = new Float32Array(vertexCount * 3)
  const normal = new Float32Array(vertexCount * 3)
  const part = new Float32Array(vertexCount)
  const body = new Float32Array(vertexCount * 2)
  const index: number[] = []
  const closed: number[] = []
  let v = 0
  const heightOf = (role: number): number => clamp01((role - ROLE.door) / (ROLE.belt - ROLE.door))
  const corner = (point: number, nx: number, ny: number, nz: number, made: number, side: number, role: number): number => {
    position[v * 3] = points[point * 3]!
    position[v * 3 + 1] = points[point * 3 + 1]!
    position[v * 3 + 2] = points[point * 3 + 2]!
    normal[v * 3] = nx
    normal[v * 3 + 1] = ny
    normal[v * 3 + 2] = nz
    part[v] = made
    body[v * 2] = side
    body[v * 2 + 1] = side ? heightOf(role) : 0
    return v++
  }

  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < RING; j++) {
      const f = i * RING + j
      const own = f * 4
      if (faceN[own + 3] === 0) continue
      const ids = [ringAt(i, j), ringAt(i + 1, j), ringAt(i + 1, j + 1), ringAt(i, j + 1)]
      closed.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!)
      const start = v
      for (let k = 0; k < 4; k++) {
        // The corner's point on the grid, and the four faces round it: a corner takes the average of
        // those that face nearly the way its own does, so a door is smooth and the edge of a boot is an edge.
        const ci = k === 0 || k === 3 ? i : i + 1
        const cj = k === 0 || k === 1 ? j : j + 1
        let nx = 0
        let ny = 0
        let nz = 0
        for (let di = -1; di <= 0; di++) {
          const fi = ci + di
          if (fi < 0 || fi > rows - 2) continue
          for (let dj = -1; dj <= 0; dj++) {
            const oj = (((cj + dj) % RING) + RING) % RING
            const o = (fi * RING + oj) * 4
            if (faceN[o + 3] === 0) continue
            if (faceN[o]! * faceN[own]! + faceN[o + 1]! * faceN[own + 1]! + faceN[o + 2]! * faceN[own + 2]! < CREASE) continue
            // A crease kept sharp: only the faces on this face's own side of it. It runs out in the domes.
            if (hard.length > 0 && between(fi) && between(i) && hardSide(oj) !== hardSide(j)) continue
            nx += faceN[o]! * faceN[o + 3]!
            ny += faceN[o + 1]! * faceN[o + 3]!
            nz += faceN[o + 2]! * faceN[o + 3]!
          }
        }
        const length = Math.hypot(nx, ny, nz) || 1
        const ring = cj % RING
        corner(ids[k]!, nx / length, ny / length, nz / length, partOf[f]!, sideOf[f]!, ring < HALF ? ring : RING - ring)
      }
      index.push(start, start + 1, start + 2, start, start + 2, start + 3)
    }
  }

  // The middle of each dome, closed with a fan. Shaded as the shallow dome it is — each point of its
  // rim takes the two triangles either side of it — or every triangle of the fan would show in the
  // reflections.
  const fan = new Float64Array(RING * 3)
  for (const [hub, i, flip] of [
    [tailHub, 0, false],
    [noseHub, rows - 1, true],
  ] as const) {
    const hx = points[hub * 3]!
    const hy = points[hub * 3 + 1]!
    const hz = points[hub * 3 + 2]!
    const rim = (j: number) => ringAt(i, j)
    for (let j = 0; j < RING; j++) {
      const a = rim(flip ? j + 1 : j)
      const b = rim(flip ? j : j + 1)
      const ax = points[a * 3]! - hx
      const ay = points[a * 3 + 1]! - hy
      const az = points[a * 3 + 2]! - hz
      const bx = points[b * 3]! - hx
      const by = points[b * 3 + 1]! - hy
      const bz = points[b * 3 + 2]! - hz
      fan[j * 3] = ay * bz - az * by
      fan[j * 3 + 1] = az * bx - ax * bz
      fan[j * 3 + 2] = ax * by - ay * bx
    }
    /** The normal at a point of the rim: the triangles either side of it, by their areas. */
    const at = (j: number): [number, number, number] => {
      const p = ((j - 1 + RING) % RING) * 3
      const q = (j % RING) * 3
      const nx = fan[p]! + fan[q]!
      const ny = fan[p + 1]! + fan[q + 1]!
      const nz = fan[p + 2]! + fan[q + 2]!
      const length = Math.hypot(nx, ny, nz) || 1
      return [nx / length, ny / length, nz / length]
    }
    for (let j = 0; j < RING; j++) {
      const ja = flip ? j + 1 : j
      const jb = flip ? j : j + 1
      const a = rim(ja)
      const b = rim(jb)
      closed.push(hub, a, b)
      const start = v
      corner(hub, flip ? 1 : -1, 0, 0, PART.paint, 0, 0)
      corner(a, ...at(ja), PART.paint, 0, 0)
      corner(b, ...at(jb), PART.paint, 0, 0)
      index.push(start, start + 1, start + 2)
    }
  }

  // ---- mirrors: a pod either side, close up only ---------------------------------------
  let next = noseHub + 1
  for (let pod = 0; pod < pods; pod++) {
    const side = pod === 0 ? 1 : -1
    const [mx, my, mz] = shape.mirror
    const big = shape.kind === 'bus' ? 1.7 : 1
    const rx = 0.055 * big
    const ry = 0.07 * big
    const rz = 0.1 * big
    const cz = side * mz
    const base = next
    const put = (x: number, y: number, z: number) => {
      points[next * 3] = x
      points[next * 3 + 1] = y
      points[next * 3 + 2] = z
      next++
    }
    put(mx, my - ry, cz)
    for (let r = 1; r < POD_ROWS; r++) {
      const lat = -Math.PI / 2 + (Math.PI * r) / POD_ROWS
      for (let c = 0; c < POD_COLS; c++) {
        const lon = (Math.PI * 2 * c) / POD_COLS
        put(mx + rx * Math.cos(lat) * Math.cos(lon), my + ry * Math.sin(lat), cz + rz * Math.cos(lat) * Math.sin(lon))
      }
    }
    const tip = next
    put(mx, my + ry, cz)
    const at = (r: number, c: number) => base + 1 + (r - 1) * POD_COLS + (c % POD_COLS)
    /** An ellipsoid's normal is its point's offset over the squares of its radii. */
    const pointed = (point: number, made: number): number => {
      const dx = (points[point * 3]! - mx) / (rx * rx)
      const dy = (points[point * 3 + 1]! - my) / (ry * ry)
      const dz = (points[point * 3 + 2]! - cz) / (rz * rz)
      const length = Math.hypot(dx, dy, dz) || 1
      return corner(point, dx / length, dy / length, dz / length, made, 0, 0)
    }
    const tri = (a: number, b: number, c: number, made: number) => {
      closed.push(a, b, c)
      index.push(pointed(a, made), pointed(b, made), pointed(c, made))
    }
    for (let c = 0; c < POD_COLS; c++) {
      tri(base, at(1, c), at(1, c + 1), PART.trim)
      for (let r = 1; r < POD_ROWS - 1; r++) {
        tri(at(r, c), at(r + 1, c), at(r + 1, c + 1), PART.paint)
        tri(at(r, c), at(r + 1, c + 1), at(r, c + 1), PART.paint)
      }
      tri(at(POD_ROWS - 1, c), tip, at(POD_ROWS - 1, c + 1), PART.paint)
    }
  }

  return {
    positions: points,
    indices: new Uint32Array(closed),
    draw: {
      position: position.subarray(0, v * 3),
      normal: normal.subarray(0, v * 3),
      part: part.subarray(0, v),
      body: body.subarray(0, v * 2),
      index: new Uint32Array(index),
    },
  }
}
