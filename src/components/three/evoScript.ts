import { PLACE, groundAt } from './evoLand'

/**
 * The long walk's script: where the camera is, where the sun is and what the
 * light is like, for every point of the scroll.
 *
 * Nothing here keeps time. The whole walk is a function of one number — how far
 * the page has been scrolled through it — so it plays forwards, backwards or
 * not at all exactly as the reader's hand does, and a frame can be asked for
 * out of order by a test. What does run on a clock (wind, fire, traffic) is
 * the scene's business and sits on top of this.
 *
 * Plain arithmetic, no three.js: the tests walk the camera the whole way and
 * hold it above the ground without a renderer.
 */

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

// ------------------------------------------------------------------ tracks

/** A value that changes along the walk: where (0 to 1), and what it is there. */
export type Key = readonly [at: number, ...value: number[]]

/**
 * A track through its keys that never overshoots them.
 *
 * Monotone cubic (Fritsch–Carlson) rather than Catmull-Rom: between two keys a
 * Catmull-Rom spline swings past both, which for a camera a metre and a half
 * off the ground means dipping into it, and for the sun means setting twice.
 * Here a value held at two keys is held between them, and one that turns
 * round does so with no speed at the turn — which is also what an eased camera
 * move is.
 */
export function track(keys: readonly Key[]): (at: number, out: number[]) => number[] {
  const n = keys.length
  const width = keys[0]!.length - 1
  const times = keys.map((key) => key[0])
  // Tangent of every channel at every key.
  const tangents: number[][] = keys.map(() => new Array<number>(width).fill(0))
  for (let c = 0; c < width; c++) {
    const secant: number[] = []
    for (let i = 0; i < n - 1; i++) secant.push((keys[i + 1]![c + 1]! - keys[i]![c + 1]!) / (times[i + 1]! - times[i]!))
    for (let i = 0; i < n; i++) {
      const before = secant[i - 1]
      const after = secant[i]
      if (before === undefined || after === undefined) tangents[i]![c] = 0
      else if (before * after <= 0) tangents[i]![c] = 0
      else {
        const h0 = times[i]! - times[i - 1]!
        const h1 = times[i + 1]! - times[i]!
        // Weighted harmonic mean: the gentler slope wins, so no overshoot.
        tangents[i]![c] = (3 * (h0 + h1)) / ((2 * h1 + h0) / before + (h1 + 2 * h0) / after)
      }
    }
  }
  return (at, out) => {
    const t = Math.min(times[n - 1]!, Math.max(times[0]!, finite(at, times[0])))
    let i = 0
    while (i < n - 2 && t > times[i + 1]!) i++
    const h = times[i + 1]! - times[i]!
    const u = h > 0 ? (t - times[i]!) / h : 0
    const u2 = u * u
    const u3 = u2 * u
    const h00 = 2 * u3 - 3 * u2 + 1
    const h10 = u3 - 2 * u2 + u
    const h01 = -2 * u3 + 3 * u2
    const h11 = u3 - u2
    for (let c = 0; c < width; c++) {
      out[c] = h00 * keys[i]![c + 1]! + h10 * h * tangents[i]![c]! + h01 * keys[i + 1]![c + 1]! + h11 * h * tangents[i + 1]![c]!
    }
    return out
  }
}

// ------------------------------------------------------------------ camera

export interface Shot {
  x: number
  y: number
  z: number
  /** What it looks at. */
  tx: number
  ty: number
  tz: number
  /** Vertical field of view, in degrees, on a landscape screen. */
  fov: number
}

/**
 * The camera's keys: where along the walk, where it stands, what it looks at,
 * and the lens. In order: low by the embers at the back of the cave; behind the
 * people as they get up and go; out through the mouth with them; up, to see the
 * country they have come out into; down into the grass beside the hunters;
 * with them as they run; up again as the years go by, over the first roofs,
 * towards a skyline that is building itself; down into its street at dusk;
 * along it; across it to one lit window; in through the glass, over a
 * shoulder, and into the screen.
 */
const CAMERA: readonly Key[] = [
  //  at     eye x      y      z     look x     y      z    fov
  [0.0, -21.3, 1.05, -2.7, -14.9, 0.95, 0.85, 40],
  [0.06, -20.6, 1.25, -3.3, -13.4, 1.15, 0.75, 41],
  [0.12, -19.6, 1.72, -2.3, -6.0, 1.45, 0.3, 43],
  [0.165, -9.0, 1.85, -0.9, 6.0, 1.5, -0.6, 46],
  [0.2, 1.5, 2.2, 1.2, 30, 1.6, -5.5, 49],
  [0.245, 13, 7.5, 12, 76, 0.6, -19, 47],
  [0.3, 42, 1.7, 1.5, 66, 1.3, -9.5, 36],
  [0.36, 72.5, 1.6, -4.5, 104, 1.9, -21.5, 30],
  [0.39, 85.5, 1.65, -8.5, 106, 2.1, -22.6, 30],
  [0.415, 90, 1.65, -10.5, 112, 2.3, -21, 32],
  [0.455, 104, 4.6, -6, 150, 2.6, -40, 46],
  [0.5, 132, 15, 16, 204, 0.5, -20, 50],
  [0.56, 178, 19.5, 21, 250, 2, -14, 52],
  [0.615, 233, 15, -1.5, 305, 9, -6.5, 50],
  [0.665, 264, 4.4, 3.4, 334, 7.5, -6.5, 49],
  [0.75, 304, 2.3, 3.5, 366, 5.2, -7.5, 47],
  [0.835, 352, 2.0, 3.1, 392, 3.0, -13.5, 45],
  [0.9, 384.5, 1.9, -6.2, 396.6, 1.55, -19.5, 41],
  [0.95, 395.5, 1.55, -16.2, 396.9, 1.3, -21.76, 38],
  [1.0, 396.9, 1.26, -21.5, 396.9, 1.26, -21.76, 30],
]

const cameraTrack = track(CAMERA)
const scratch: number[] = []

/** How far the camera must stay above the ground it is over. */
export const HEADROOM = 0.55

/**
 * The shot at a point of the walk. `aspect` is the frame's width over its
 * height: held upright, a phone ends the walk closer to the screen, or the
 * screen would not fill a frame that tall.
 */
export function cameraAt(progress: number, out: Shot, aspect = 1.6): Shot {
  const p = clamp01(finite(progress))
  cameraTrack(p, scratch)
  const closer = smooth(0.955, 1, p) * 0.5 * clamp01((0.8 - aspect) / 0.35)
  for (let c = 0; c < 3; c++) scratch[c] = scratch[c]! + (scratch[c + 3]! - scratch[c]!) * closer
  out.x = scratch[0]!
  out.z = scratch[2]!
  // In the cave and in the studio the floor is not the land: the keys are trusted there.
  const outdoors = out.x > 2 && out.z > -15
  out.y = outdoors ? Math.max(scratch[1]!, groundAt(out.x, out.z) + HEADROOM) : scratch[1]!
  out.tx = scratch[3]!
  out.ty = scratch[4]!
  out.tz = scratch[5]!
  out.fov = scratch[6]!
  return out
}

/**
 * The lens for a screen of a given shape. The keys are composed for a
 * landscape frame; held upright a phone sees a third of that across, and the
 * figures at the edges of every shot would be out of it — so the field of view
 * is opened until the frame is at least as wide as a 4:5 one would be.
 */
export function lensFor(fov: number, aspect: number): number {
  const least = 0.8
  if (!(aspect > 0) || aspect >= least) return fov
  const half = Math.atan(Math.tan((fov * Math.PI) / 360) * (least / aspect))
  return Math.min(86, (half * 360) / Math.PI)
}

// --------------------------------------------------------------------- sun

const PI = Math.PI

/**
 * The sun's angle round its circle, in radians: 0 on the horizon as it rises,
 * a quarter turn at its highest, half a turn as it sets. Before dawn in the
 * cave; up as the people come out; a morning for the hunt; then three days and
 * nights in the space of a few hundred pixels, and one long evening over the
 * city that ends in the dark.
 */
const SUN_ANGLE: readonly Key[] = [
  [0.0, -0.215],
  [0.1, -0.16],
  [0.165, -0.035],
  [0.215, 0.085],
  [0.3, 0.3],
  [0.44, 0.6],
  [0.475, 0.7],
  [0.618, 7 * PI - 0.41],
  [0.7, 7 * PI - 0.035],
  [0.75, 7 * PI + 0.12],
  [0.85, 7 * PI + 0.4],
  [1.0, 7 * PI + 0.52],
]

/**
 * Which way the sun rises, as an angle on the map from +x towards +z. It comes
 * up straight out of the mouth of the cave. By the time the city is built the
 * circle has swung round so that it *sets* ahead of the walk instead, and the
 * skyline stands against it — which no reader can catch it doing, because it
 * happens while the sun is going round three times.
 */
const SUN_BEARING: readonly Key[] = [
  [0.0, -0.24],
  [0.2, -0.24],
  // Out on the steppe it climbs away to one side of the way the hunt goes: a
  // sun dead ahead leaves everything that is walked towards a black shape,
  // and one off to the side puts light down a flank and along a spear.
  [0.34, 0.75],
  [0.475, 0.75],
  [0.618, PI - 0.42],
  [1.0, PI - 0.42],
]

/** How far the sun's circle leans over towards the far side of the walk. */
const TILT = 0.62

const sunAngle = track(SUN_ANGLE)
const sunBearing = track(SUN_BEARING)

export interface Sky {
  /** Unit vector towards the sun. */
  sx: number
  sy: number
  sz: number
  /** Unit vector towards the moon. */
  mx: number
  my: number
  mz: number
  /** The sun's height above the horizon, in degrees. Negative at night. */
  elevation: number
  /** Days gone by since the walk began, for anything that should turn with them. */
  days: number
}

const one: number[] = []

function onCircle(angle: number, bearing: number, out: { x: number; y: number; z: number }): void {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const x = c * Math.cos(bearing)
  const y = s * Math.cos(TILT)
  const z = c * Math.sin(bearing) - s * Math.sin(TILT)
  const len = Math.hypot(x, y, z) || 1
  out.x = x / len
  out.y = y / len
  out.z = z / len
}

const point = { x: 0, y: 0, z: 0 }

/** Where the sun and the moon are at a point of the walk. */
export function skyAt(progress: number, out: Sky): Sky {
  const p = clamp01(finite(progress))
  const angle = sunAngle(p, one)[0]!
  const bearing = sunBearing(p, one)[0]!
  onCircle(angle, bearing, point)
  out.sx = point.x
  out.sy = point.y
  out.sz = point.z
  out.elevation = (Math.asin(Math.min(1, Math.max(-1, point.y))) * 180) / PI
  // The moon keeps to the other side of the sky, a little behind.
  onCircle(angle - PI + 0.95, bearing + PI, point)
  out.mx = point.x
  out.my = point.y
  out.mz = point.z
  out.days = (angle + 0.215) / (2 * PI)
  return out
}

// -------------------------------------------------------------------- mood

/**
 * What the light is like for a height of the sun. Colours are sRGB hex; the
 * scene turns them into working colours once and blends between neighbours.
 */
export interface Mood {
  /** Degrees above the horizon this row describes. */
  elevation: number
  zenith: string
  horizon: string
  /** The sky round the sun, and the haze looking towards it. */
  glow: string
  /** The colour and strength of the direct light: the sun's, or the moon's. */
  light: string
  power: number
  /** The sky's own light on things, and what comes back up off the ground. */
  ambient: string
  ground: string
  fill: number
  /** The air between the camera and the far ground. */
  haze: string
  stars: number
  exposure: number
}

export const MOODS: readonly Mood[] = [
  { elevation: -18, zenith: '#03050d', horizon: '#0a1222', glow: '#101a30', light: '#9db4e8', power: 0.95, ambient: '#2a3d6e', ground: '#0d1018', fill: 0.52, haze: '#0a111f', stars: 1, exposure: 1.05 },
  { elevation: -9, zenith: '#081030', horizon: '#2b2746', glow: '#6e3a3a', light: '#8ea2d6', power: 0.5, ambient: '#33437a', ground: '#14141c', fill: 0.52, haze: '#1c2038', stars: 0.6, exposure: 1.1 },
  { elevation: -4, zenith: '#182a5e', horizon: '#c26d58', glow: '#ff8448', light: '#ffa978', power: 0.3, ambient: '#5a6aa6', ground: '#2a2222', fill: 0.62, haze: '#6f5a66', stars: 0.12, exposure: 1.12 },
  { elevation: 0, zenith: '#2a4a8c', horizon: '#f2a268', glow: '#ffae5c', light: '#ff9448', power: 1.5, ambient: '#7f8fc0', ground: '#3d3026', fill: 0.78, haze: '#d59a78', stars: 0, exposure: 1.05 },
  { elevation: 5, zenith: '#3a66ac', horizon: '#f5cd9e', glow: '#ffd596', light: '#ffbf78', power: 3.1, ambient: '#93a8d4', ground: '#55452f', fill: 0.86, haze: '#e6c8a4', stars: 0, exposure: 1 },
  { elevation: 14, zenith: '#3a72c6', horizon: '#cfe0f0', glow: '#fff0d2', light: '#ffe4c0', power: 4.0, ambient: '#a6bde6', ground: '#63543a', fill: 0.95, haze: '#cdd9e4', stars: 0, exposure: 0.96 },
  { elevation: 40, zenith: '#2c68c2', horizon: '#bcd4ee', glow: '#ffffff', light: '#fff5e6', power: 4.6, ambient: '#b4c8ec', ground: '#6b5a3e', fill: 1.02, haze: '#c4d6ea', stars: 0, exposure: 0.94 },
]

/** The two rows of `MOODS` a height of the sun falls between, and how far from the first to the second. */
export function moodAt(elevation: number): { from: number; to: number; mix: number } {
  const e = finite(elevation, -18)
  let from = 0
  while (from < MOODS.length - 2 && e > MOODS[from + 1]!.elevation) from++
  const a = MOODS[from]!.elevation
  const b = MOODS[from + 1]!.elevation
  return { from, to: from + 1, mix: clamp01((e - a) / (b - a)) }
}

/** How much of the direct light is the sun's, 0 to 1; the rest of the way down it is the moon's. */
export const sunShare = (elevation: number): number => smooth(-4.5, -1, elevation)

/** How lit the city is: lamps and windows come on as the sun goes down. */
export const lampsAt = (elevation: number): number => smooth(5, -6, elevation)

// ------------------------------------------------------------------- stage

/**
 * What exists at a point of the walk, 0 to 1 each: the scene builds, shows and
 * hides its sets by these, so nothing is drawn — or animated — that the camera
 * cannot see.
 */
export interface Stage {
  /** The cave and the people in it. */
  cave: number
  /** The hearth: embers at 0, a fire by 1. */
  fire: number
  /** The steppe's meadow and the herd. */
  steppe: number
  /** Huts and ploughed strips. */
  field: number
  /** The city, as a share of its full height. */
  city: number
  /** How fast the days are going by, 0 to 1. */
  lapse: number
  /** The veil at either end of the walk, 0 clear to 1 gone to the page's colour. */
  veil: number
}

export function stageAt(progress: number, out: Stage): Stage {
  const p = clamp01(finite(progress))
  out.cave = 1 - smooth(0.25, 0.3, p)
  out.fire = smooth(0.012, 0.075, p)
  out.steppe = 1 - smooth(0.6, 0.66, p)
  out.field = smooth(0.485, 0.545, p)
  out.city = smooth(0.52, 0.635, p)
  out.lapse = smooth(0.47, 0.5, p) * (1 - smooth(0.585, 0.62, p))
  out.veil = Math.max(1 - smooth(0, 0.02, p), smooth(0.966, 0.996, p))
  return out
}

// -------------------------------------------------------------------- cast

/** A line across the ground, with how far along it each corner is. */
export interface Route {
  points: readonly (readonly [x: number, z: number])[]
  marks: readonly number[]
  length: number
}

export function route(points: readonly (readonly [number, number])[]): Route {
  const marks = [0]
  for (let i = 1; i < points.length; i++) {
    marks.push(marks[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]))
  }
  return { points, marks, length: marks[marks.length - 1]! }
}

export interface Spot {
  x: number
  z: number
  /** Heading, as an angle on the map from +x towards +z. */
  heading: number
}

/** The point `distance` metres along a route, and which way the route runs there. */
export function along(r: Route, distance: number, out: Spot): Spot {
  const d = Math.min(r.length, Math.max(0, finite(distance)))
  let i = 0
  while (i < r.marks.length - 2 && d > r.marks[i + 1]!) i++
  const a = r.points[i]!
  const b = r.points[i + 1]!
  const span = r.marks[i + 1]! - r.marks[i]!
  const u = span > 0 ? (d - r.marks[i]!) / span : 0
  out.x = a[0] + (b[0] - a[0]) * u
  out.z = a[1] + (b[1] - a[1]) * u
  // Turned through each corner over a couple of metres, not on the spot.
  const here = Math.atan2(b[1] - a[1], b[0] - a[0])
  const next = r.points[i + 2]
  const prev = r.points[i - 1]
  let heading = here
  const turn = 2.4
  if (next && r.marks[i + 1]! - d < turn) {
    const there = Math.atan2(next[1] - b[1], next[0] - b[0])
    heading = here + shortest(there - here) * 0.5 * (1 - (r.marks[i + 1]! - d) / turn)
  } else if (prev && d - r.marks[i]! < turn) {
    const before = Math.atan2(a[1] - prev[1], a[0] - prev[0])
    heading = here + shortest(before - here) * 0.5 * (1 - (d - r.marks[i]!) / turn)
  }
  out.heading = heading
  return out
}

function shortest(angle: number): number {
  const turn = Math.PI * 2
  return ((((angle + Math.PI) % turn) + turn) % turn) - Math.PI
}

const HEARTH = PLACE.cave.hearth

/**
 * The way out, and on: from beside the hearth, down the passage, out of the
 * mouth and across the steppe to where the herd is drinking.
 */
export const HUNT_ROUTE = route([
  [HEARTH.x + 1.6, HEARTH.z + 0.6],
  [-11.5, 0.5],
  [-5, 0.15],
  [1, 0],
  [9, -1],
  [24, -3.6],
  [46, -6.6],
  [70, -9.2],
  [85, -12.5],
  [101, -20],
  [107, -23.5],
])

/** How far along `HUNT_ROUTE` the one in front is, in metres, through the walk. */
const HUNT_PACE = track([
  [0.0, 0],
  [0.088, 0],
  [0.12, 5.5],
  [0.165, 15],
  [0.19, 19],
  [0.3, 66],
  [0.375, 106],
  [0.4, 112],
  [0.44, 121.5],
  [0.47, 123.8],
  [1.0, 123.8],
])

/** Who walks where in the party: metres behind the one in front, and metres to its left. */
export const HUNTERS = [
  { behind: 0, left: 0, seat: [HEARTH.x + 1.55, HEARTH.z + 1.05], facing: -2.6 },
  { behind: 2.6, left: -1.5, seat: [HEARTH.x + 0.5, HEARTH.z - 1.75], facing: 1.75 },
  { behind: 4.7, left: 1.6, seat: [HEARTH.x - 1.2, HEARTH.z + 1.55], facing: -0.85 },
] as const

/** The one who stays by the fire. */
export const ELDER = { seat: [HEARTH.x - 1.7, HEARTH.z - 0.75], facing: 0.4 } as const

export interface Walker extends Spot {
  /** Metres covered since the start: the scene turns the change in this into steps. */
  travelled: number
  /** 1 sitting by the fire, 0 up. */
  seated: number
  /** How bent to the ground: 0 walking upright, 1 stalking. */
  low: number
  /** 0 walking, 1 flat out. */
  running: number
  /** A spear arm: 0 carried, 1 drawn back, 2 let go and following through. */
  cast: number
}

const paceScratch: number[] = []
const spotScratch: Spot = { x: 0, z: 0, heading: 0 }

/** Where one of the hunting party is, and what it is doing, at a point of the walk. */
export function hunterAt(index: number, progress: number, out: Walker): Walker {
  const p = clamp01(finite(progress))
  const who = HUNTERS[index] ?? HUNTERS[0]
  const lead = HUNT_PACE(p, paceScratch)[0]!
  // The others set off a moment later and close up in the passage, where
  // there is no room to walk abreast.
  // (Over twelve metres, so that nobody is ever taken backwards to make the gap.)
  const travelled = Math.max(0, lead - who.behind * smooth(0, 12, lead))
  along(HUNT_ROUTE, travelled, spotScratch)
  const abreast = who.left * smooth(15.5, 26, travelled) + who.left * 0.3 * smooth(0.5, 3, travelled) * (1 - smooth(15.5, 26, travelled))
  // Out of the seat and onto the route over the first couple of metres.
  const away = smooth(0, 2.2, travelled)
  const rx = spotScratch.x + Math.sin(spotScratch.heading) * abreast
  const rz = spotScratch.z - Math.cos(spotScratch.heading) * abreast
  out.x = who.seat[0] + (rx - who.seat[0]) * away
  out.z = who.seat[1] + (rz - who.seat[1]) * away
  out.heading = who.facing + shortest(spotScratch.heading - who.facing) * smooth(0, 1.2, travelled)
  out.travelled = travelled
  out.seated = 1 - smooth(0.05 + index * 0.009, 0.082 + index * 0.009, p)
  out.low = smooth(0.3, 0.33, p) * (1 - smooth(0.402, 0.412, p))
  out.running = smooth(0.41, 0.424, p) * (1 - smooth(0.446, 0.466, p))
  out.cast = index === 0 ? smooth(0.398, 0.41, p) + smooth(0.41, 0.418, p) : 0
  return out
}

/** When the spear leaves the hand, and when it comes down. */
export const CAST = { from: 0.4135, until: 0.438 } as const

/** Where the spear comes down: short of the herd, in the grass. */
export const SPEAR_LANDS = { x: 113.5, z: -27.5 } as const

/** The herd at the water: where each stands, how big it is, and which way it faces. */
export const HERD = [
  { x: 107.4, z: -23.4, heading: -2.5, size: 1, seed: 1.3 },
  { x: 113.5, z: -18.5, heading: -1.1, size: 0.9, seed: 4.1 },
  { x: 105, z: -30.5, heading: -0.5, size: 0.56, seed: 7.7 },
] as const

/** Where the herd goes when it goes: round the water and away into the hills. */
const FLIGHT = [
  route([[107.4, -23.4], [120, -13], [140, -16], [172, -44], [205, -90]]),
  route([[113.5, -18.5], [126, -9], [146, -11], [178, -38], [212, -84]]),
  route([[105, -30.5], [114, -14], [134, -13], [166, -40], [198, -88]]),
] as const

const FLIGHT_PACE = track([
  [0.0, 0],
  [0.4, 0],
  [0.425, 8],
  [0.47, 50],
  [0.52, 120],
  [1.0, 120],
])

export interface Beast extends Spot {
  travelled: number
  /** 0 at the water, 1 head up and ears out. */
  alarm: number
  /** 0 standing, 1 going as fast as it goes. */
  fleeing: number
}

/** Where one of the herd is at a point of the walk. */
export function herdAt(index: number, progress: number, out: Beast): Beast {
  const p = clamp01(finite(progress))
  const home = HERD[index] ?? HERD[0]
  const way = FLIGHT[index] ?? FLIGHT[0]
  // The big one goes first; the others a beat behind it.
  const travelled = Math.max(0, FLIGHT_PACE(p, paceScratch)[0]! - index * 1.2)
  along(way, travelled, spotScratch)
  out.x = spotScratch.x
  out.z = spotScratch.z
  out.heading = home.heading + shortest(spotScratch.heading - home.heading) * smooth(0, 5, travelled)
  out.travelled = travelled
  out.alarm = smooth(0.386 + index * 0.004, 0.398 + index * 0.004, p)
  out.fleeing = smooth(0.2, 6, travelled)
  return out
}
