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
 * listener where it has not.
 */
export function animateAlongPage(links: readonly PageLink[]): () => void {
  const timeline = pageTimeline()
  if (timeline && links.every(({ element }) => typeof element.animate === 'function')) {
    const animations = links.map(({ element, stops }) => element.animate(curveKeyframes(stops), { timeline, fill: 'both', easing: 'linear' }))
    return () => animations.forEach((animation) => animation.cancel())
  }
  return followPageProgress((progress) => links.forEach(({ element, stops }) => applyCurve(element, stops, progress)))
}

// ---------------------------------------------------------------- curves

/** A value along the page: `at` is the page progress, the rest is what holds there. */
export interface Stop {
  at: number
  opacity: number
  /** Vertical drift, in viewport heights × 100 (vh). */
  y?: number
}

/** A stop's numbers between two stops, linearly; held flat before the first and after the last. */
export function curveAt(stops: readonly Stop[], progress: number): { opacity: number; y: number } {
  const p = clamp01(progress)
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!first || !last) return { opacity: 0, y: 0 }
  if (p <= first.at) return { opacity: first.opacity, y: first.y ?? 0 }
  if (p >= last.at) return { opacity: last.opacity, y: last.y ?? 0 }
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!
    const a = stops[i - 1]!
    if (p <= b.at) {
      const t = b.at > a.at ? (p - a.at) / (b.at - a.at) : 1
      return { opacity: lerp(a.opacity, b.opacity, t), y: lerp(a.y ?? 0, b.y ?? 0, t) }
    }
  }
  return { opacity: last.opacity, y: last.y ?? 0 }
}

const drift = (y: number) => `translate3d(0, ${Number(y.toFixed(3))}vh, 0)`

/** The same curve as Web Animation keyframes, from the top of the page to the bottom. */
export function curveKeyframes(stops: readonly Stop[]): Keyframe[] {
  const points = [0, ...stops.map((stop) => clamp01(stop.at)), 1].filter((at, i, all) => all.indexOf(at) === i).sort((a, b) => a - b)
  return points.map((at) => {
    const { opacity, y } = curveAt(stops, at)
    return { offset: at, opacity, transform: drift(y) }
  })
}

/** A stop applied by hand, for the fallback: what the keyframes would have set. */
export function applyCurve(element: HTMLElement, stops: readonly Stop[], progress: number): void {
  const { opacity, y } = curveAt(stops, progress)
  element.style.opacity = opacity.toFixed(3)
  element.style.transform = drift(y)
}

// ---------------------------------------------------------------- the sky

export type SkyLayer = 'dawn' | 'noon' | 'dusk' | 'night'

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
