/**
 * The page's scroll-linked effects, in the parts that need neither React nor
 * three.js: how far down the reader is, the curves that turn that into an
 * effect, and the one place that decides whether the browser can run an
 * effect by itself.
 *
 * Where it can, it does: a `ScrollTimeline` drives a Web Animation straight
 * from the scroll position on the compositor, with no script per frame and no
 * frame of lag. Where it cannot, one passive listener hands the same progress
 * to a callback, at most once a frame.
 */

export const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, finite(value, min)))

export const clamp01 = (value: number): number => clamp(value, 0, 1)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Frame-rate independent approach to a target, the same curve as three's `MathUtils.damp`. */
export const damp = (current: number, target: number, lambda: number, dt: number): number => lerp(current, target, 1 - Math.exp(-lambda * dt))

/** `value` wrapped into [0, period), negative values included. */
export function wrap(value: number, period: number): number {
  if (!(period > 0)) return 0
  const r = finite(value) % period
  return r < 0 ? r + period : r
}

/** A stable pseudo-random number in [0, 1) for an index and a seed: the same layout on every visit. */
export function hash(i: number, seed = 0): number {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return s - Math.floor(s)
}

// ---------------------------------------------------------------- progress

/** How far down the page the reader is: 0 at the top, 1 at the bottom. */
export function pageProgress(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight
  return max > 0 ? clamp01(window.scrollY / max) : 0
}

/** Calls `apply` with the page progress whenever it may have changed: on scroll, on resize, and when the page grows. */
export function followPageProgress(apply: (progress: number) => void): () => void {
  let frame = 0
  const run = () => {
    frame = 0
    apply(pageProgress())
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run)
  }
  run()
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  // The GitHub section and the fonts arrive after the first paint, and a page
  // that grows moves the bottom away from a reader who has not moved.
  const grows = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  grows?.observe(document.body)
  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    grows?.disconnect()
  }
}

interface ScrollTimelineConstructor {
  new (options: { source?: Element | null; axis?: 'block' | 'inline' | 'x' | 'y' }): AnimationTimeline
}

/** The document's own scroll as an animation timeline, or null in a browser without them. */
function pageTimeline(): AnimationTimeline | null {
  const Timeline = (globalThis as { ScrollTimeline?: ScrollTimelineConstructor }).ScrollTimeline
  if (typeof Timeline !== 'function') return null
  try {
    return new Timeline({ source: document.documentElement, axis: 'block' })
  } catch {
    return null
  }
}

/** An element and the curve it follows down the page. */
export interface PageLink {
  element: HTMLElement
  stops: readonly Stop[]
}

/**
 * Plays each element's curve across the page, top to bottom: as Web
 * Animations on the document's scroll timeline where the browser has one —
 * opacity and transform, so they run on the compositor — and from one shared
 * listener where it has not. `clock` says what time of the curve each part of
 * the page shows; left out, the top of the page is its start and the bottom
 * its end.
 */
export function animateAlongPage(links: readonly PageLink[], clock: Clock = STRAIGHT): () => void {
  const timeline = pageTimeline()
  if (timeline && links.every(({ element }) => typeof element.animate === 'function')) {
    const animations = links.map(({ element, stops }) => element.animate(curveKeyframes(stops, clock), { timeline, fill: 'both', easing: 'linear' }))
    return () => animations.forEach((animation) => animation.cancel())
  }
  return followPageProgress((progress) => links.forEach(({ element, stops }) => applyCurve(element, stops, progress, clock)))
}

// ---------------------------------------------------------------- curves

/** A value along the page: `at` is when it holds, the rest is what holds then. */
export interface Stop {
  at: number
  opacity: number
  /** Vertical drift, in hundredths of the viewport's height (vh). */
  y?: number
  /** Sideways drift, in hundredths of the viewport's width (vw). */
  x?: number
  /** Size, as a factor of the element's own. */
  scale?: number
}

export interface CurvePoint {
  opacity: number
  x: number
  y: number
  scale: number
}

const pointOf = (stop: Stop): CurvePoint => ({ opacity: stop.opacity, x: stop.x ?? 0, y: stop.y ?? 0, scale: stop.scale ?? 1 })

/** A stop's numbers between two stops, linearly; held flat before the first and after the last. */
export function curveAt(stops: readonly Stop[], progress: number): CurvePoint {
  const p = clamp01(progress)
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!first || !last) return { opacity: 0, x: 0, y: 0, scale: 1 }
  if (p <= first.at) return pointOf(first)
  if (p >= last.at) return pointOf(last)
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!
    const a = stops[i - 1]!
    if (p <= b.at) {
      const t = b.at > a.at ? (p - a.at) / (b.at - a.at) : 1
      const from = pointOf(a)
      const to = pointOf(b)
      return { opacity: lerp(from.opacity, to.opacity, t), x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), scale: lerp(from.scale, to.scale, t) }
    }
  }
  return pointOf(last)
}

const trim = (value: number) => Number(value.toFixed(3))

/**
 * A curve either only fades and drifts up and down, or travels: the first is
 * written the short way, and every keyframe of one curve the same way, so
 * the browser can interpolate them function for function.
 */
const travels = (stops: readonly Stop[]) => stops.some((stop) => stop.x !== undefined || stop.scale !== undefined)

const pose = (point: CurvePoint, travelling: boolean) =>
  travelling ? `translate3d(${trim(point.x)}vw, ${trim(point.y)}vh, 0) scale(${trim(point.scale)})` : `translate3d(0, ${trim(point.y)}vh, 0)`

/**
 * What time it is at each part of the page: knots of [page progress, time],
 * both from 0 to 1. Progress climbs from knot to knot; time never goes back,
 * and where it stands still the curve holds for that stretch of the page.
 */
export type Clock = readonly (readonly [progress: number, time: number])[]

/** The page read straight through: the top is the start of the curve, the bottom its end. */
export const STRAIGHT: Clock = [
  [0, 0],
  [1, 1],
]

/** The time a clock shows at a page progress. */
export function clockAt(clock: Clock, progress: number): number {
  const p = clamp01(progress)
  const first = clock[0]
  const last = clock[clock.length - 1]
  if (!first || !last) return p
  if (p <= first[0]) return clamp01(first[1])
  if (p >= last[0]) return clamp01(last[1])
  for (let i = 1; i < clock.length; i++) {
    const [p1, t1] = clock[i]!
    const [p0, t0] = clock[i - 1]!
    if (p <= p1) return clamp01(p1 > p0 ? lerp(t0, t1, (p - p0) / (p1 - p0)) : t1)
  }
  return clamp01(last[1])
}

/** Every page progress at which a clock comes to show `time` while it is running. */
function progressAt(clock: Clock, time: number): number[] {
  const found: number[] = []
  for (let i = 1; i < clock.length; i++) {
    const [p1, t1] = clock[i]!
    const [p0, t0] = clock[i - 1]!
    if (t1 > t0 && time >= t0 && time <= t1) found.push(lerp(p0, p1, (time - t0) / (t1 - t0)))
  }
  return found
}

/**
 * The same curve as Web Animation keyframes, from the top of the page to the
 * bottom. Between two keyframes both the clock and the curve are straight
 * lines, so the browser's own interpolation lands exactly on the curve.
 */
export function curveKeyframes(stops: readonly Stop[], clock: Clock = STRAIGHT): Keyframe[] {
  const travelling = travels(stops)
  const points = [0, 1, ...clock.map(([progress]) => progress), ...stops.flatMap((stop) => progressAt(clock, stop.at))]
    .map(clamp01)
    .sort((a, b) => a - b)
    // Two ways of arriving at the same place can differ in the last bit, and two keyframes a hair apart are a jump.
    .filter((at, i, all) => i === 0 || at - all[i - 1]! > 1e-9)
  // Whatever was merged, the curve still ends at the bottom of the page: a last keyframe short of it lets go of the element there.
  points[points.length - 1] = 1
  return points.map((at) => {
    const point = curveAt(stops, clockAt(clock, at))
    return { offset: at, opacity: point.opacity, transform: pose(point, travelling) }
  })
}

/** A stop applied by hand, for the fallback: what the keyframes would have set. */
export function applyCurve(element: HTMLElement, stops: readonly Stop[], progress: number, clock: Clock = STRAIGHT): void {
  const point = curveAt(stops, clockAt(clock, progress))
  element.style.opacity = point.opacity.toFixed(3)
  element.style.transform = pose(point, travels(stops))
}

// ---------------------------------------------------------------- the sky

export type SkyLayer = 'dawn' | 'noon' | 'dusk' | 'night'

/*
 * Everything in the sky is timed in one unit, the time of day: 0 is first
 * light and 1 the dead of night. The four lights, the sun and the moon are
 * tuned against each other in it — the sun is on the horizon while the dawn
 * glows, overhead through the clear stretch, down as the dusk is at its
 * fullest, and the moon is up by the time the stars are out — so they are
 * kept here together.
 *
 * What time it is at each place on the page is a separate question, and
 * `HOURS` answers it by section, not by how far down the page a section
 * happens to be. That distance is different on a phone, changes when the
 * GitHub section loads, and moves for every section below a new one; the
 * section a reader is looking at does not.
 */

/**
 * The time of day down the page. The hero is morning, the middle of the page
 * a clear sky, the work and the code an evening, and the contact and footer
 * are night, with stars. The warm glows sit low and move — dawn rises out of
 * the frame, the dusk sinks below it — and the stars come up into place.
 */
export const SKY: Record<SkyLayer, readonly Stop[]> = {
  dawn: [
    { at: 0, opacity: 1, y: 0 },
    { at: 0.05, opacity: 1, y: -1 },
    { at: 0.24, opacity: 0, y: -8 },
  ],
  noon: [
    { at: 0.1, opacity: 0 },
    { at: 0.3, opacity: 1 },
    { at: 0.48, opacity: 1 },
    { at: 0.66, opacity: 0 },
  ],
  dusk: [
    { at: 0.5, opacity: 0, y: -6 },
    { at: 0.68, opacity: 1, y: 0 },
    { at: 0.8, opacity: 1, y: 3 },
    { at: 0.94, opacity: 0, y: 11 },
  ],
  night: [
    { at: 0.76, opacity: 0, y: 7 },
    { at: 0.95, opacity: 1, y: 0 },
  ],
}

/** The path of something that rises, crosses the screen and sets. */
export interface Arc {
  /** When it comes over the horizon and when it has gone under it. Either may lie off the page. */
  rise: number
  set: number
  /** Where along the horizon it rises and where it sets, in vw. */
  from: number
  to: number
  /** How far down the screen its highest point is, and where the horizon lies, in vh. */
  top: number
  horizon: number
  /**
   * How soon it is up. 1 is a plain arc; higher climbs faster and then runs
   * along the top of the screen for longer — which is where a reader's eyes
   * are not.
   */
  shoulder: number
  /** How much larger it looks on the horizon than overhead. */
  swell: number
}

/**
 * The sun: on the horizon at the very top of the page, across the top of the
 * screen all day, and down while the projects row is still pinned — behind
 * its cards, not behind the GitHub section that comes after.
 */
export const SUN: Arc = { rise: -0.004, set: 0.775, from: 21, to: 68, top: 11.5, horizon: 103, shoulder: 2.2, swell: 1.3 }

/**
 * The moon: a young one, so it is in the west where the sun went down. It
 * comes up the right-hand edge as the stars come out and is still climbing at
 * the foot of the page, into the one corner the footer leaves empty at every
 * width.
 */
export const MOON: Arc = { rise: 0.79, set: 1.36, from: 97, to: 70, top: 10.5, horizon: 107, shoulder: 3, swell: 1.16 }

/** A moment of the day, pinned to a place on the page. */
export interface Hour {
  /** The id of a section. */
  section: string
  /**
   * Which of its edges: the moment is when that edge reaches the same edge of
   * the screen. `top` is a section arriving; `bottom` is one that has been
   * read to its end — for a pinned one, the moment it lets go.
   */
  edge: 'top' | 'bottom'
  time: number
}

/**
 * What time it is where. Between two of these the day runs evenly; before the
 * first it runs from first light, after the last to the dead of night. A
 * section that is not on the page is skipped, and a new one placed between
 * two of these simply takes its share of the hours between them — so a long
 * scene after the hero is a long morning, and nothing here needs retuning.
 */
export const HOURS: readonly Hour[] = [
  { section: 'about', edge: 'top', time: 0.057 },
  { section: 'philosophy', edge: 'top', time: 0.149 },
  { section: 'skills', edge: 'top', time: 0.394 },
  { section: 'building', edge: 'top', time: 0.469 },
  { section: 'projects', edge: 'top', time: 0.539 },
  // The sun is down by the time the projects row lets go of the screen.
  { section: 'projects', edge: 'bottom', time: 0.775 },
  { section: 'github', edge: 'top', time: 0.82 },
  { section: 'presence', edge: 'top', time: 0.9 },
  { section: 'contact', edge: 'top', time: 0.945 },
]

/**
 * A clock from the places on the page where the time is known: each `at` is a
 * page progress. Whatever order they come in, the clock runs down the page;
 * a place that would turn the day back, or that is not on the page, is left
 * out; two places with the same time hold the day still between them.
 */
export function dayClock(marks: readonly { at: number; time: number }[]): Clock {
  const knots: [number, number][] = [[0, 0]]
  const placed = marks.filter((mark) => Number.isFinite(mark.at) && Number.isFinite(mark.time)).sort((a, b) => a.at - b.at)
  for (const mark of placed) {
    const [progress, time] = knots[knots.length - 1]!
    if (mark.at <= progress + 1e-4 || mark.at >= 1 - 1e-4) continue
    if (mark.time < time || mark.time > 1) continue
    knots.push([mark.at, mark.time])
  }
  knots.push([1, 1])
  return knots
}

/** The clock of the page as it is laid out now: `HOURS`, measured. */
export function measureDay(hours: readonly Hour[] = HOURS): Clock {
  const max = document.documentElement.scrollHeight - window.innerHeight
  if (!(max > 0)) return STRAIGHT
  return dayClock(
    hours.flatMap(({ section, edge, time }) => {
      const box = document.getElementById(section)?.getBoundingClientRect()
      if (!box) return []
      // Where the page has to be for that edge of the section to be on that edge of the screen.
      const at = edge === 'top' ? box.top + window.scrollY : box.bottom + window.scrollY - window.innerHeight
      return [{ at: at / max, time }]
    }),
  )
}

/** Whether two clocks would put anything in a visibly different place. */
export function sameClock(a: Clock, b: Clock, tolerance = 5e-4): boolean {
  return a.length === b.length && a.every(([progress, time], i) => Math.abs(progress - b[i]![0]) <= tolerance && Math.abs(time - b[i]![1]) <= tolerance)
}

/**
 * `animateAlongPage`, by the page's own clock — and kept to it. The page is
 * not laid out once: sections load, fonts arrive, the window is turned. Each
 * time it changes the hours are measured again, and if any has moved the
 * curves are re-tied to the page where it now is.
 */
export function animateThroughDay(links: readonly PageLink[], hours: readonly Hour[] = HOURS): () => void {
  let clock = measureDay(hours)
  let stop = animateAlongPage(links, clock)
  let frame = 0
  const check = () => {
    frame = 0
    const now = measureDay(hours)
    if (sameClock(clock, now)) return
    clock = now
    stop()
    stop = animateAlongPage(links, clock)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(check)
  }
  window.addEventListener('resize', schedule)
  const grows = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  grows?.observe(document.body)
  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', schedule)
    grows?.disconnect()
    stop()
  }
}

export interface ArcPoint {
  /** Across and down the screen, in vw and vh. */
  x: number
  y: number
  scale: number
  /** How high it stands: 0 on the horizon, 1 at the top of its path. */
  height: number
  /** Whether it is over the horizon at all. */
  up: boolean
}

/** Where on its path something is at a time of day. */
export function arcAt(arc: Arc, time: number): ArcPoint {
  const span = arc.set - arc.rise
  const raw = span > 0 ? (finite(time) - arc.rise) / span : 0
  const u = clamp01(raw)
  // A sine arc with its top held: it leaves the horizon at a steady pace, not straight up.
  const height = 1 - Math.pow(Math.max(0, 1 - Math.sin(Math.PI * u)), Math.max(1, finite(arc.shoulder, 1)))
  return {
    x: lerp(arc.from, arc.to, u),
    y: lerp(arc.horizon, arc.top, height),
    scale: lerp(arc.swell, 1, height),
    height,
    up: raw > 0 && raw < 1,
  }
}

/** The times at which a path is sampled: the part of it that falls on the page, closer together where it turns fastest. */
function arcTimes(arc: Arc, steps: number): number[] {
  const n = Math.max(2, Math.floor(steps))
  const span = arc.set - arc.rise
  const times: number[] = []
  for (let i = 0; i <= n; i++) {
    // Evenly round the half circle, so the steep ends get as many samples as the flat top.
    const time = arc.rise + span * (0.5 - 0.5 * Math.cos((Math.PI * i) / n))
    if (time >= 0 && time <= 1) times.push(time)
  }
  for (const end of [clamp01(arc.rise), clamp01(arc.set)]) if (!times.includes(end)) times.push(end)
  return times.sort((a, b) => a - b)
}

/**
 * A path as stops: across the screen in a straight line of time, up and over
 * in an arc. It is there for as long as it is over the horizon, and fades in
 * the last step down to it — the horizon is off the bottom of the screen, so
 * that is a sinking, not a switch.
 */
export function arcStops(arc: Arc, steps = 32): Stop[] {
  return arcTimes(arc, steps).map((time) => {
    const point = arcAt(arc, time)
    return { at: time, opacity: point.up ? 1 : 0, x: trim(point.x), y: trim(point.y), scale: trim(point.scale) }
  })
}

/**
 * The two colours of something in the sky, as a cross-fade: `low` is the
 * colour it has on the horizon, `high` the one it has overhead, and between
 * them the two always add up to the whole of it.
 */
export function arcTintStops(arc: Arc, tint: 'low' | 'high', steps = 32): Stop[] {
  return arcTimes(arc, steps).map((time) => {
    const high = smoothstep(0.25, 0.8, arcAt(arc, time).height)
    return { at: time, opacity: trim(tint === 'high' ? high : 1 - high) }
  })
}

/**
 * The same thing for a reader who has asked for less motion: it does not
 * travel. It hangs where it would be highest and comes and goes with the
 * light, like the four layers do.
 */
export function arcStillStops(arc: Arc, steps = 32): Stop[] {
  const rest = arcAt(arc, (arc.rise + arc.set) / 2)
  return arcTimes(arc, steps).map((time) => ({
    at: time,
    opacity: trim(smoothstep(0.5, 0.95, arcAt(arc, time).height)),
    x: trim(rest.x),
    y: trim(rest.y),
    scale: 1,
  }))
}

export interface Star {
  /** Across, in percent of the sky. */
  x: number
  /** Down, in percent of the sky. */
  y: number
  /** Radius in CSS pixels. */
  r: number
  /** Brightness, 0–1. */
  a: number
  /** One of the few bright ones that twinkle. */
  twinkle: boolean
  /** Seconds into its twinkle it starts at, and how long one takes. */
  delay: number
  period: number
}

/** A fixed, hand-free star field: more and fainter towards the top, a few bright ones that twinkle. */
export function starField(count: number, seed = 1): Star[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => {
    const size = hash(i, seed + 3)
    return {
      x: Number((hash(i, seed) * 100).toFixed(2)),
      y: Number((Math.pow(hash(i, seed + 1), 1.4) * 94).toFixed(2)),
      r: Number((0.35 + Math.pow(size, 3) * 1.1).toFixed(2)),
      a: Number((0.3 + hash(i, seed + 2) * 0.62).toFixed(2)),
      twinkle: size > 0.9,
      delay: Number((-hash(i, seed + 4) * 6).toFixed(2)),
      period: Number((2.4 + hash(i, seed + 5) * 3.6).toFixed(2)),
    }
  })
}

// ---------------------------------------------------------------- the trail

/** How many footprints fit across a screen this wide: a stride of about thirty pixels. */
export function trailCount(width: number): number {
  return Math.round(clamp(finite(width, 1280) / 30, 12, 64))
}

export interface Print {
  i: number
  /** Across the top edge, in percent. */
  x: number
  /** Off the line the animal walks, in CSS pixels: left feet above it, right feet below. */
  y: number
  /** Toe-out, in degrees. */
  rotate: number
  scale: number
  left: boolean
}

/**
 * A theropod's trackway across the top of the screen, walking right: the feet
 * alternate either side of the line, each toes out a little, and no two are
 * quite the same size — a trail, not a row of stamps.
 */
export function trailPrints(count: number): Print[] {
  const n = Math.max(0, Math.floor(count))
  return Array.from({ length: n }, (_, i) => {
    const left = i % 2 === 0
    const side = left ? -1 : 1
    return {
      i,
      x: Number((((i + 0.5) / n) * 100).toFixed(3)),
      y: Number((side * (2.1 + hash(i, 5) * 0.9)).toFixed(2)),
      rotate: Number((side * 8 + (hash(i, 6) - 0.5) * 7).toFixed(2)),
      scale: Number((0.9 + hash(i, 7) * 0.2).toFixed(3)),
      left,
    }
  })
}

/**
 * How many prints are down at a given progress. The first lands as soon as
 * the reader moves, the last exactly at the bottom of the page.
 */
export function printsDown(progress: number, count: number): number {
  const n = Math.max(0, Math.floor(count))
  const p = clamp01(progress)
  if (p <= 0) return 0
  return Math.min(n, Math.floor(p * n + 0.85))
}

// ---------------------------------------------------------------- the marquee

export interface MarqueeMotion {
  /** How far the row has moved, wrapped to one copy of it, in pixels. */
  offset: number
  /** How far it has moved, wrapped to 720 px: half a degree a pixel is one whole turn, so a spin read from it never jumps. */
  travel: number
  /** Pixels per second; positive moves the row to the left. */
  speed: number
  /** The way the reader last scrolled: 1 down, -1 up. */
  direction: 1 | -1
  /** Extra speed the scrolling has given it, in pixels per second. */
  rush: number
  /** Shear, in degrees, from how fast it is going. */
  skew: number
}

export const MARQUEE = {
  /** The calm drift, pixels per second. */
  base: 42,
  /** How much of the page's scroll speed the row picks up. */
  pickup: 0.34,
  maxRush: 560,
  /** How quickly it comes round when the reader turns back. */
  turn: 3,
  /** Degrees of shear per pixel per second. */
  shear: 0.0135,
  maxSkew: 8,
  /** On hover it almost stops, so the words can be read. */
  hover: 0.12,
} as const

export const createMarquee = (): MarqueeMotion => ({ offset: 0, travel: 0, speed: MARQUEE.base, direction: 1, rush: 0, skew: 0 })

/**
 * One frame of the ticker. `scrolled` is how far the page moved since the
 * last frame (positive is down) and `period` the width of one copy of the row.
 *
 * Scrolling down drives it left, faster the faster the page goes; scrolling
 * up turns it round. It keeps the last direction once the page stops, and
 * eases back to the calm drift rather than stopping dead.
 */
export function stepMarquee(motion: MarqueeMotion, dt: number, scrolled: number, period: number, hovered: boolean): MarqueeMotion {
  const step = clamp(dt, 0, 0.25)
  if (step === 0) return motion
  // An anchor jump moves thousands of pixels in a frame; that is not a fling.
  const moved = clamp(scrolled, -1200, 1200)
  const scrolling = Math.abs(moved) > 0.5
  if (scrolling) motion.direction = moved > 0 ? 1 : -1
  const pull = Math.min((Math.abs(moved) / step) * MARQUEE.pickup, MARQUEE.maxRush)
  motion.rush = damp(motion.rush, scrolling ? pull : 0, scrolling ? 9 : 2.2, step)
  const target = motion.direction * ((hovered ? MARQUEE.hover : 1) * MARQUEE.base + motion.rush)
  motion.speed = finite(damp(motion.speed, target, MARQUEE.turn, step), target)
  motion.offset = wrap(motion.offset + motion.speed * step, period)
  motion.travel = wrap(motion.travel + motion.speed * step, 720)
  motion.skew = finite(damp(motion.skew, clamp(motion.speed * MARQUEE.shear, -MARQUEE.maxSkew, MARQUEE.maxSkew), 8, step))
  return motion
}

/** How many copies of the row it takes for the ticker never to show an edge. */
export function marqueeCopies(width: number, period: number): number {
  if (!(period > 0) || !(width > 0)) return 2
  return clamp(Math.ceil(width / period) + 1, 2, 12)
}

// ---------------------------------------------------------------- the gallery

/**
 * The projects gallery is pinned for as long as it takes to slide its whole
 * row past. `lead` is the stretch at the start where it is pinned but holds
 * still, so the heading lands before anything moves.
 */
export function galleryProgress(top: number, travel: number, lead: number): number {
  if (!(travel > 0)) return 0
  return clamp01((-finite(top) - lead) / travel)
}

/** The page position at which the gallery shows `progress` — the inverse, for a gallery moved sideways. */
export function galleryScrollFor(progress: number, wrapperTop: number, travel: number, lead: number): number {
  return finite(wrapperTop) + lead + clamp01(progress) * Math.max(0, travel)
}

/** How tall the gallery's section is: one screen to pin, plus every pixel the row has to travel. */
export function galleryHeight(viewport: number, travel: number, lead: number, tail: number): number {
  return Math.round(Math.max(0, viewport) + Math.max(0, travel) + Math.max(0, lead) + Math.max(0, tail))
}

/** The card whose centre is nearest `at`. */
export function nearestIndex(centers: readonly number[], at: number): number {
  let best = 0
  let distance = Infinity
  centers.forEach((center, i) => {
    const d = Math.abs(center - at)
    if (d < distance) {
      distance = d
      best = i
    }
  })
  return best
}
