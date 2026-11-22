import { describe, expect, it } from 'vitest'
import {
  MARQUEE,
  SKY,
  createMarquee,
  curveAt,
  curveKeyframes,
  galleryHeight,
  galleryProgress,
  galleryScrollFor,
  marqueeCopies,
  nearestIndex,
  printsDown,
  starField,
  stepMarquee,
  trailCount,
  trailPrints,
  wrap,
} from '@/lib/scroll'
import { technologies } from '@/content/technologies'
import {
  HOLD,
  UNIVERSE,
  cameraPosition,
  closestApproach,
  layoutNodes,
  stageProgress,
  universeFlight,
} from '@/components/three/universeFlight'

/** Every number a scroll effect hands the page has to be one; a NaN in a transform draws nothing. */
const allFinite = (value: unknown): boolean =>
  typeof value === 'number' ? Number.isFinite(value) : typeof value === 'object' && value !== null ? Object.values(value).every(allFinite) : true

const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n)

describe('the reading trail', () => {
  it('fits a stride of about thirty pixels to the screen, within bounds', () => {
    expect(trailCount(1440)).toBe(48)
    expect(trailCount(390)).toBe(13)
    expect(trailCount(200)).toBe(12)
    expect(trailCount(5000)).toBe(64)
    expect(trailCount(Number.NaN)).toBeGreaterThanOrEqual(12)
  })

  it('walks right, feet alternating either side of its line', () => {
    const prints = trailPrints(40)
    expect(prints).toHaveLength(40)
    for (const [i, print] of prints.entries()) {
      expect(allFinite(print)).toBe(true)
      expect(print.x).toBeGreaterThan(0)
      expect(print.x).toBeLessThan(100)
      if (i > 0) expect(print.x).toBeGreaterThan(prints[i - 1]!.x)
      // Left feet above the line (which is left of a walker heading right), right feet below.
      expect(print.left).toBe(i % 2 === 0)
      expect(Math.sign(print.y)).toBe(print.left ? -1 : 1)
      expect(Math.abs(print.rotate)).toBeLessThan(14)
    }
    // Not stamps: the prints are not all the same size.
    expect(new Set(prints.map((print) => print.scale)).size).toBeGreaterThan(20)
    expect(trailPrints(40)).toEqual(prints)
  })

  it('puts the first print down as soon as the reader moves, and the last at the bottom', () => {
    expect(printsDown(0, 48)).toBe(0)
    expect(printsDown(0.01, 48)).toBe(1)
    expect(printsDown(0.5, 48)).toBe(24)
    expect(printsDown(0.999, 48)).toBe(48)
    expect(printsDown(1, 48)).toBe(48)
    expect(printsDown(2, 48)).toBe(48)
    expect(printsDown(Number.NaN, 48)).toBe(0)
    let last = 0
    for (const p of steps(400)) {
      const down = printsDown(p, 48)
      expect(down).toBeGreaterThanOrEqual(last)
      last = down
    }
  })
})

describe('the sky', () => {
  const layers = Object.entries(SKY)

  it('is morning at the top of the page and night at the bottom', () => {
    expect(curveAt(SKY.dawn, 0).opacity).toBe(1)
    expect(curveAt(SKY.night, 0).opacity).toBe(0)
    expect(curveAt(SKY.dawn, 1).opacity).toBe(0)
    expect(curveAt(SKY.night, 1).opacity).toBe(1)
    // A clear sky through the middle of the page, an evening over the work.
    expect(curveAt(SKY.noon, 0.4).opacity).toBe(1)
    expect(curveAt(SKY.dusk, 0.74).opacity).toBe(1)
  })

  it('never leaves the page with no light at all, nor stacks every layer at once', () => {
    for (const p of steps(200)) {
      const total = layers.reduce((sum, [, stops]) => sum + curveAt(stops, p).opacity, 0)
      expect(total, `at ${p}`).toBeGreaterThan(0.3)
      expect(total, `at ${p}`).toBeLessThanOrEqual(2)
    }
  })

  it('becomes keyframes that start at the top, end at the bottom and hold the same curve', () => {
    for (const [name, stops] of layers) {
      const frames = curveKeyframes(stops)
      expect(frames[0]?.offset, name).toBe(0)
      expect(frames[frames.length - 1]?.offset, name).toBe(1)
      const offsets = frames.map((frame) => frame.offset as number)
      expect([...offsets].sort((a, b) => a - b), name).toEqual(offsets)
      expect(new Set(offsets).size, name).toBe(offsets.length)
      for (const frame of frames) {
        const at = frame.offset as number
        expect(frame.opacity, `${name} at ${at}`).toBeCloseTo(curveAt(stops, at).opacity, 6)
        expect(String(frame.transform)).toMatch(/^translate3d\(0, -?\d+(\.\d+)?vh, 0\)$/)
      }
    }
  })

  it('has a star field that is the same on every visit, denser near the top', () => {
    const stars = starField(160, 11)
    expect(stars).toHaveLength(160)
    expect(starField(160, 11)).toEqual(stars)
    for (const star of stars) {
      expect(allFinite(star)).toBe(true)
      expect(star.x).toBeGreaterThanOrEqual(0)
      expect(star.x).toBeLessThanOrEqual(100)
      expect(star.y).toBeGreaterThanOrEqual(0)
      expect(star.y).toBeLessThanOrEqual(94)
      expect(star.r).toBeGreaterThan(0)
      expect(star.r).toBeLessThan(1.6)
    }
    const twinkling = stars.filter((star) => star.twinkle).length
    expect(twinkling).toBeGreaterThan(4)
    expect(twinkling).toBeLessThan(40)
    expect(stars.filter((star) => star.y < 47).length).toBeGreaterThan(stars.length / 2)
  })
})

describe('the marquee', () => {
  const run = (frames: number, scrolledPerFrame: number, motion = createMarquee(), hovered = false) => {
    for (let i = 0; i < frames; i++) stepMarquee(motion, 1 / 60, scrolledPerFrame, 1600, hovered)
    return motion
  }

  it('drifts left at its calm pace when nothing is happening', () => {
    const motion = run(240, 0)
    expect(motion.direction).toBe(1)
    expect(motion.speed).toBeCloseTo(MARQUEE.base, 1)
    expect(motion.skew).toBeGreaterThan(0)
    expect(motion.skew).toBeLessThan(1)
  })

  it('runs faster when the page is scrolled down, and leans into it', () => {
    const motion = run(30, 25)
    expect(motion.speed).toBeGreaterThan(MARQUEE.base * 4)
    expect(motion.skew).toBeGreaterThan(3)
    expect(motion.skew).toBeLessThanOrEqual(MARQUEE.maxSkew)
  })

  it('turns round when the reader scrolls back up, and keeps that way when they stop', () => {
    const motion = run(60, -18)
    expect(motion.direction).toBe(-1)
    expect(motion.speed).toBeLessThan(-MARQUEE.base)
    expect(motion.skew).toBeLessThan(0)
    run(300, 0, motion)
    expect(motion.direction).toBe(-1)
    expect(motion.speed).toBeCloseTo(-MARQUEE.base, 1)
  })

  it('all but stops under the pointer', () => {
    const motion = run(240, 0, createMarquee(), true)
    expect(Math.abs(motion.speed)).toBeLessThan(MARQUEE.base * 0.2)
  })

  it('wraps to one copy of the row, and shrugs off nonsense', () => {
    const motion = createMarquee()
    for (const [dt, scrolled] of [
      [1 / 60, 40],
      [Number.NaN, 10],
      [1 / 60, Number.POSITIVE_INFINITY],
      [-1, 5],
      [5, 90_000],
      [1 / 60, Number.NaN],
    ] as const) {
      stepMarquee(motion, dt, scrolled, 1600, false)
      expect(allFinite(motion)).toBe(true)
      expect(motion.offset).toBeGreaterThanOrEqual(0)
      expect(motion.offset).toBeLessThan(1600)
      expect(motion.travel).toBeGreaterThanOrEqual(0)
      expect(motion.travel).toBeLessThan(720)
      expect(Math.abs(motion.speed)).toBeLessThanOrEqual(MARQUEE.base + MARQUEE.maxRush + 1)
    }
    expect(wrap(-10, 100)).toBe(90)
    expect(wrap(250, 100)).toBe(50)
    expect(wrap(5, 0)).toBe(0)
  })

  it('has copies enough that the end of the row never shows', () => {
    expect(marqueeCopies(1440, 1600)).toBe(2)
    expect(marqueeCopies(2560, 1200)).toBe(4)
    expect(marqueeCopies(0, 0)).toBe(2)
    for (const width of [320, 800, 1440, 2560, 3840]) {
      const period = 900
      const copies = marqueeCopies(width, period)
      // However far into its period the row has moved, it still reaches the far edge.
      expect(copies * period - period).toBeGreaterThanOrEqual(width)
    }
  })
})

describe('the projects gallery', () => {
  it('maps the page scroll to the row and back', () => {
    const travel = 2400
    const lead = 50
    const top = 3000
    for (const p of steps(40)) {
      const y = galleryScrollFor(p, top, travel, lead)
      // The wrapper's top relative to the viewport, at that page position.
      expect(galleryProgress(top - y, travel, lead)).toBeCloseTo(p, 9)
    }
    // Before the pin and after it, the row holds at its ends.
    expect(galleryProgress(400, travel, lead)).toBe(0)
    expect(galleryProgress(-40, travel, lead)).toBe(0)
    expect(galleryProgress(-(lead + travel + 900), travel, lead)).toBe(1)
    expect(galleryProgress(-500, 0, lead)).toBe(0)
    expect(galleryProgress(Number.NaN, travel, lead)).toBe(0)
  })

  it('is tall enough to pin the row for every pixel it travels', () => {
    expect(galleryHeight(900, 2400, 54, 144)).toBe(900 + 2400 + 54 + 144)
    expect(galleryHeight(900, -5, 0, 0)).toBe(900)
  })

  it('knows which card is in the middle', () => {
    const centers = [300, 760, 1220, 1680]
    expect(nearestIndex(centers, 0)).toBe(0)
    expect(nearestIndex(centers, 990)).toBe(1)
    expect(nearestIndex(centers, 1000)).toBe(2)
    expect(nearestIndex(centers, 99_999)).toBe(3)
    expect(nearestIndex([], 5)).toBe(0)
  })
})

describe('the flight through the universe', () => {
  const shapes = [
    { name: 'wide', compact: false, rest: UNIVERSE.rest.wide, radius: UNIVERSE.radius.wide },
    { name: 'compact', compact: true, rest: UNIVERSE.rest.compact, radius: UNIVERSE.radius.compact },
  ] as const

  it('holds exactly the composed shot while the stage is wholly on screen', () => {
    for (const { rest } of shapes) {
      for (const p of [HOLD.from, 0.45, 0.5, 0.55, HOLD.to]) {
        const flight = universeFlight(p, rest)
        const eye = cameraPosition(flight)
        expect(eye.x).toBeCloseTo(0, 9)
        expect(eye.y).toBeCloseTo(0, 9)
        expect(eye.z).toBeCloseTo(rest, 9)
        expect(flight.spread).toBeCloseTo(1, 9)
        expect(flight.labels).toBeCloseTo(1, 9)
      }
    }
  })

  it('comes in from far out with the sphere flung wide, and pushes in as it leaves', () => {
    for (const { rest } of shapes) {
      const start = universeFlight(0, rest)
      expect(start.distance).toBeGreaterThan(rest * 1.8)
      expect(start.spread).toBeGreaterThan(1.5)
      expect(start.labels).toBe(0)
      const end = universeFlight(1, rest)
      expect(end.distance).toBeLessThan(rest * 0.7)
      expect(end.elevation).toBeGreaterThan(0.3)
      expect(end.labels).toBe(0)
      let last = Infinity
      for (const p of steps(40).filter((p) => p <= HOLD.from)) {
        const { distance } = universeFlight(p, rest)
        expect(distance).toBeLessThanOrEqual(last + 1e-9)
        last = distance
      }
    }
  })

  it('never flies the camera into a node, however the sphere has turned', () => {
    for (const { name, compact, rest, radius } of shapes) {
      const nodes = layoutNodes(technologies, radius, compact)
      for (const p of steps(200)) {
        const nearest = closestApproach(universeFlight(p, rest), nodes)
        // The largest node, lit and swollen, is about a quarter unit across.
        expect(nearest, `${name} at ${p}`).toBeGreaterThan(0.9)
      }
    }
  })

  it('turns nonsense into the composed shot, and stays finite everywhere', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -5, 12]) {
      expect(allFinite(universeFlight(value, UNIVERSE.rest.wide))).toBe(true)
    }
    expect(universeFlight(Number.NaN, 7.6)).toEqual(universeFlight(0.5, 7.6))
    expect(stageProgress(900, 600, 900)).toBe(0)
    expect(stageProgress(-600, 600, 900)).toBe(1)
    expect(stageProgress(150, 600, 900)).toBe(0.5)
    expect(stageProgress(Number.NaN, 600, 900)).toBeGreaterThanOrEqual(0)
    expect(stageProgress(0, 0, 0)).toBe(0.5)
  })

  it('lays the technologies out where the scene always had them', () => {
    const nodes = layoutNodes(technologies, UNIVERSE.radius.wide, false)
    expect(nodes).toHaveLength(technologies.length)
    for (const [i, node] of nodes.entries()) {
      expect(allFinite(node)).toBe(true)
      const reach = technologies[i]?.core ? UNIVERSE.radius.wide * 0.72 : UNIVERSE.radius.wide
      expect(Math.hypot(node.x, node.y / 0.78, node.z / 0.7)).toBeCloseTo(reach, 6)
    }
  })
})
