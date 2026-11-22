import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HOURS,
  MARQUEE,
  MOON,
  SKY,
  STRAIGHT,
  SUN,
  arcAt,
  arcStillStops,
  arcStops,
  arcTintStops,
  clockAt,
  createMarquee,
  curveAt,
  curveKeyframes,
  dayClock,
  galleryHeight,
  galleryProgress,
  galleryScrollFor,
  marqueeCopies,
  nearestIndex,
  printsDown,
  sameClock,
  starField,
  stepMarquee,
  trailCount,
  trailPrints,
  wrap,
  type Clock,
  type Stop,
} from '@/lib/scroll'
import { technologies } from '@/content/technologies'
import { SECTION_IDS } from '@/config/sections'
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

describe('the sun and the moon', () => {
  const sun = arcStops(SUN)
  const moon = arcStops(MOON)
  /** Something is in the reader's sky when it is drawn and its centre is on the screen. */
  const inSky = (stops: readonly Stop[], p: number) => {
    const point = curveAt(stops, p)
    return point.opacity > 0.5 && point.y < 100
  }

  it('has the sun on the horizon at the top of the page, overhead through the day and gone by night', () => {
    const dawn = curveAt(sun, 0)
    expect(dawn.opacity).toBe(1)
    // On the bottom edge of the screen, give or take: a sun that is coming up.
    expect(dawn.y).toBeGreaterThan(96)
    expect(dawn.y).toBeLessThan(104)
    expect(dawn.scale).toBeGreaterThan(1.2)
    const noon = curveAt(sun, (SUN.rise + SUN.set) / 2)
    expect(noon.y).toBeCloseTo(SUN.top, 1)
    expect(noon.scale).toBeCloseTo(1, 2)
    for (const p of steps(100)) if (p >= SUN.set) expect(curveAt(sun, p).opacity, `at ${p}`).toBe(0)
  })

  it('goes up while the dawn glows and down while the dusk does', () => {
    const lowAt = (p: number) => arcAt(SUN, p).height < 0.5
    for (const p of steps(200)) {
      if (!arcAt(SUN, p).up || !lowAt(p)) continue
      const glow = Math.max(curveAt(SKY.dawn, p).opacity, curveAt(SKY.dusk, p).opacity)
      expect(glow, `a low sun with no glow under it at ${p}`).toBeGreaterThan(0.5)
    }
    // …and it is high for the whole of the clear sky.
    for (const p of steps(200)) if (curveAt(SKY.noon, p).opacity === 1) expect(arcAt(SUN, p).height, `at ${p}`).toBeGreaterThan(0.9)
  })

  it('spends its day along the top of the screen, where nobody is reading', () => {
    const day = steps(400).filter((p) => arcAt(SUN, p).up)
    const high = day.filter((p) => curveAt(sun, p).y < 28)
    expect(high.length / day.length).toBeGreaterThan(0.6)
    // It leaves the horizon at a walk, not a jump: never faster than the page itself moves.
    for (let i = 1; i < day.length; i++) {
      const climbed = Math.abs(curveAt(sun, day[i]!).y - curveAt(sun, day[i - 1]!).y)
      expect(climbed, `between ${day[i - 1]} and ${day[i]}`).toBeLessThan(2.5)
    }
  })

  it('brings the moon up as the sun goes, into the top right corner at the foot of the page', () => {
    for (const p of steps(200)) {
      expect(inSky(sun, p) && inSky(moon, p) && curveAt(sun, p).y < 80 && curveAt(moon, p).y < 80, `both up at ${p}`).toBe(false)
      if (p < MOON.rise) expect(curveAt(moon, p).opacity).toBe(0)
    }
    const night = curveAt(moon, 1)
    expect(night.opacity).toBe(1)
    expect(night.x).toBeGreaterThan(82)
    expect(night.x).toBeLessThan(92)
    expect(night.y).toBeGreaterThan(8)
    expect(night.y).toBeLessThan(14)
    // The stars are out by the time it is: no moon in an evening sky with none.
    for (const p of steps(200)) if (inSky(moon, p) && curveAt(moon, p).y < 60) expect(curveAt(SKY.night, p).opacity, `at ${p}`).toBeGreaterThan(0.25)
  })

  it('never leaves the screen sideways, and every number of it is one', () => {
    for (const arc of [SUN, MOON]) {
      for (const p of steps(400)) {
        const point = arcAt(arc, p)
        expect(allFinite(point), `at ${p}`).toBe(true)
        expect(point.height).toBeGreaterThanOrEqual(0)
        expect(point.height).toBeLessThanOrEqual(1)
        if (point.up) {
          expect(point.x).toBeGreaterThan(4)
          expect(point.x).toBeLessThan(99)
          expect(point.y).toBeGreaterThanOrEqual(arc.top)
        }
      }
      expect(allFinite(arcAt(arc, Number.NaN))).toBe(true)
      expect(allFinite(arcAt({ ...arc, set: arc.rise }, 0.5))).toBe(true)
      expect(allFinite(arcAt({ ...arc, shoulder: Number.NaN }, 0.5))).toBe(true)
    }
  })

  it('is stops in order on the page, drawn exactly while it is over the horizon', () => {
    for (const [name, arc, stops] of [
      ['sun', SUN, sun],
      ['moon', MOON, moon],
    ] as const) {
      const at = stops.map((stop) => stop.at)
      expect([...at].sort((a, b) => a - b), name).toEqual(at)
      expect(new Set(at).size, name).toBe(at.length)
      expect(at[0], name).toBe(Math.max(0, arc.rise))
      expect(at[at.length - 1], name).toBe(Math.min(1, arc.set))
      for (const stop of stops) {
        expect(allFinite(stop), name).toBe(true)
        expect(stop.opacity, `${name} at ${stop.at}`).toBe(arcAt(arc, stop.at).up ? 1 : 0)
      }
      // Close enough together that the straight lines between them are the arc.
      for (const p of steps(600)) {
        if (p < at[0]! || p > at[at.length - 1]!) continue
        const drawn = curveAt(stops, p)
        const exact = arcAt(arc, p)
        expect(Math.abs(drawn.y - exact.y), `${name} at ${p}`).toBeLessThan(0.6)
        expect(Math.abs(drawn.x - exact.x), `${name} at ${p}`).toBeLessThan(0.05)
      }
    }
  })

  it('becomes keyframes that all move it the same way, so the browser can interpolate them', () => {
    for (const stops of [sun, moon, arcStillStops(SUN), arcStillStops(MOON)]) {
      const frames = curveKeyframes(stops)
      expect(frames[0]?.offset).toBe(0)
      expect(frames[frames.length - 1]?.offset).toBe(1)
      for (const frame of frames) {
        expect(String(frame.transform)).toMatch(/^translate3d\(-?\d+(\.\d+)?vw, -?\d+(\.\d+)?vh, 0\) scale\(\d+(\.\d+)?\)$/)
        expect(Number(frame.opacity)).toBeGreaterThanOrEqual(0)
        expect(Number(frame.opacity)).toBeLessThanOrEqual(1)
      }
    }
    // The four lights only fade and drift, and are still written the short way.
    for (const stops of Object.values(SKY)) for (const frame of curveKeyframes(stops)) expect(String(frame.transform)).toMatch(/^translate3d\(0, /)
  })

  it('is red on the horizon and pale overhead, and always wholly one or the other or between', () => {
    const low = arcTintStops(SUN, 'low')
    const high = arcTintStops(SUN, 'high')
    for (const p of steps(200)) expect(curveAt(low, p).opacity + curveAt(high, p).opacity, `at ${p}`).toBeCloseTo(1, 2)
    expect(curveAt(low, 0).opacity).toBe(1)
    expect(curveAt(high, 0.4).opacity).toBe(1)
    expect(curveAt(low, SUN.set - 0.01).opacity).toBeGreaterThan(0.9)
  })

  it('does not travel for a reader who asked for less motion: it comes and goes where it hangs', () => {
    for (const [arc, when] of [
      [SUN, 0.4],
      [MOON, 1],
    ] as const) {
      const stops = arcStillStops(arc)
      expect(new Set(stops.map((stop) => `${stop.x},${stop.y},${stop.scale}`)).size).toBe(1)
      expect(stops[0]?.y).toBeCloseTo(arc.top, 1)
      expect(curveAt(stops, when).opacity).toBeGreaterThan(0.95)
      expect(curveAt(stops, Math.max(0, arc.rise)).opacity).toBe(0)
    }
    expect(curveAt(arcStillStops(SUN), 0.95).opacity).toBe(0)
  })
})

describe('the clock of the page', () => {
  /** A page whose second third is a scene with a sky of its own: the day waits for it. */
  const held: Clock = [
    [0, 0],
    [0.2, 0.3],
    [0.5, 0.3],
    [1, 1],
  ]

  it('reads the page straight through unless told otherwise', () => {
    for (const p of steps(50)) expect(clockAt(STRAIGHT, p)).toBeCloseTo(p, 12)
    for (const stops of [...Object.values(SKY), arcStops(SUN), arcStops(MOON)]) expect(curveKeyframes(stops, STRAIGHT)).toEqual(curveKeyframes(stops))
  })

  it('never runs backwards, never leaves the day, and stands still where it is held', () => {
    let last = 0
    for (const p of steps(400)) {
      const time = clockAt(held, p)
      expect(time).toBeGreaterThanOrEqual(last)
      expect(time).toBeLessThanOrEqual(1)
      last = time
    }
    expect(clockAt(held, 0)).toBe(0)
    expect(clockAt(held, 1)).toBe(1)
    expect(clockAt(held, 0.2)).toBeCloseTo(0.3, 12)
    expect(clockAt(held, 0.35)).toBeCloseTo(0.3, 12)
    expect(clockAt(held, 0.5)).toBeCloseTo(0.3, 12)
    expect(clockAt(held, Number.NaN)).toBe(0)
    expect(clockAt([], 0.4)).toBeCloseTo(0.4, 12)
  })

  it('makes keyframes the browser can join with straight lines and still land on the curve', () => {
    const number = /-?\d+(?:\.\d+)?/g
    for (const clock of [STRAIGHT, held]) {
      for (const stops of [...Object.values(SKY), arcStops(SUN), arcStops(MOON)]) {
        const frames = curveKeyframes(stops, clock)
        const offsets = frames.map((frame) => frame.offset as number)
        expect(offsets[0]).toBe(0)
        expect(offsets[offsets.length - 1]).toBe(1)
        expect([...offsets].sort((a, b) => a - b)).toEqual(offsets)
        expect(new Set(offsets).size).toBe(offsets.length)
        for (let i = 1; i < frames.length; i++) {
          // Halfway between two keyframes the browser shows the mean of them.
          const middle = (offsets[i - 1]! + offsets[i]!) / 2
          const exact = curveAt(stops, clockAt(clock, middle))
          expect((Number(frames[i - 1]!.opacity) + Number(frames[i]!.opacity)) / 2, `opacity at ${middle}`).toBeCloseTo(exact.opacity, 3)
          const before = String(frames[i - 1]!.transform).match(number)!.map(Number)
          const after = String(frames[i]!.transform).match(number)!.map(Number)
          // "translate3d(x, y, 0)": after the 3 of its name, x and then the drift down the screen.
          expect((before[2]! + after[2]!) / 2, `y at ${middle}`).toBeCloseTo(exact.y, 2)
        }
      }
    }
  })

  it('holds the whole sky still across a held stretch of the page', () => {
    for (const stops of [...Object.values(SKY), arcStops(SUN)]) {
      const frames = curveKeyframes(stops, held)
      const at = (offset: number) => frames.find((frame) => frame.offset === offset)
      expect(at(0.2)).toBeDefined()
      expect(at(0.5)).toBeDefined()
      expect(at(0.5)?.opacity).toBe(at(0.2)?.opacity)
      expect(at(0.5)?.transform).toBe(at(0.2)?.transform)
      expect(frames.some((frame) => (frame.offset as number) > 0.2 && (frame.offset as number) < 0.5)).toBe(false)
    }
  })
})

describe('the hours of the page', () => {
  const timeOf = (section: string, edge: 'top' | 'bottom') => HOURS.find((hour) => hour.section === section && hour.edge === edge)!.time
  /** The page as it is on a desktop and on a phone, in page progress: where each section's top and the projects' end fall. */
  const layouts = {
    desktop: { about: 0.057, philosophy: 0.149, skills: 0.394, building: 0.469, projects: 0.539, projectsEnd: 0.751, github: 0.808, presence: 0.898, contact: 0.943 },
    phone: { about: 0.046, philosophy: 0.179, skills: 0.376, building: 0.468, projects: 0.58, projectsEnd: 0.713, github: 0.758, presence: 0.878, contact: 0.943 },
  }
  const clockOf = (layout: (typeof layouts)[keyof typeof layouts]) =>
    dayClock(HOURS.map(({ section, edge, time }) => ({ at: edge === 'bottom' ? layout.projectsEnd : layout[section as keyof typeof layout], time })))

  it('names sections that exist, in the order they come, and never turns the day back', () => {
    const order: string[] = Object.values(SECTION_IDS)
    let last = 0
    let place = -1
    for (const hour of HOURS) {
      expect(order, hour.section).toContain(hour.section)
      expect(order.indexOf(hour.section)).toBeGreaterThanOrEqual(place)
      place = order.indexOf(hour.section)
      expect(hour.time).toBeGreaterThan(last)
      expect(hour.time).toBeLessThan(1)
      last = hour.time
    }
  })

  it('has the sun down before the projects let go of the screen, and no moon until it is', () => {
    const letGo = timeOf('projects', 'bottom')
    expect(arcAt(SUN, letGo).up).toBe(false)
    expect(arcAt(SUN, timeOf('projects', 'top')).height).toBeGreaterThan(0.9)
    expect(arcAt(MOON, letGo).up).toBe(false)
    expect(arcAt(MOON, timeOf('github', 'top')).up).toBe(true)
    // By the contact section it is where it will stay, and it is night.
    expect(arcAt(MOON, timeOf('contact', 'top')).height).toBeGreaterThan(0.97)
    expect(curveAt(SKY.night, timeOf('contact', 'top')).opacity).toBeGreaterThan(0.95)
    // Morning under the hero, a clear sky by the skills.
    expect(curveAt(SKY.dawn, timeOf('about', 'top')).opacity).toBeGreaterThan(0.9)
    expect(curveAt(SKY.noon, timeOf('skills', 'top')).opacity).toBe(1)
  })

  it('makes a clock that starts at first light, ends at night and only runs forwards', () => {
    for (const layout of Object.values(layouts)) {
      const clock = clockOf(layout)
      expect(clock[0]).toEqual([0, 0])
      expect(clock[clock.length - 1]).toEqual([1, 1])
      expect(clock).toHaveLength(HOURS.length + 2)
      for (let i = 1; i < clock.length; i++) {
        expect(clock[i]![0]).toBeGreaterThan(clock[i - 1]![0])
        expect(clock[i]![1]).toBeGreaterThanOrEqual(clock[i - 1]![1])
      }
    }
  })

  it('shows the same sky over the same section on a phone and on a desktop', () => {
    const desktop = clockOf(layouts.desktop)
    const phone = clockOf(layouts.phone)
    for (const section of ['about', 'philosophy', 'skills', 'building', 'projects', 'github', 'presence', 'contact'] as const) {
      expect(clockAt(phone, layouts.phone[section]), section).toBeCloseTo(clockAt(desktop, layouts.desktop[section]), 6)
    }
    // …which the page read straight through does not: the same section is at a different hour.
    expect(Math.abs(layouts.phone.github - layouts.desktop.github)).toBeGreaterThan(0.03)
  })

  it('gives a new section its share of the hours it sits between, and holds the day where told to', () => {
    // A long scene between the hero and the about section: the morning is longer, and the rest keeps its hours.
    const longer = dayClock([
      { at: 0.4, time: timeOf('about', 'top') },
      { at: 0.7, time: timeOf('projects', 'top') },
    ])
    expect(clockAt(longer, 0.2)).toBeCloseTo(timeOf('about', 'top') / 2, 6)
    expect(clockAt(longer, 0.7)).toBeCloseTo(timeOf('projects', 'top'), 6)
    const held = dayClock([
      { at: 0.1, time: 0.05 },
      { at: 0.4, time: 0.05 },
    ])
    expect(clockAt(held, 0.25)).toBeCloseTo(0.05, 9)
  })

  it('takes the places in any order and leaves out any that make no sense', () => {
    const marks = [
      { at: 0.6, time: 0.5 },
      { at: 0.2, time: 0.3 },
      // Would turn the day back, is off the page, is not a number, is past night.
      { at: 0.7, time: 0.4 },
      { at: 1.2, time: 0.9 },
      { at: -0.3, time: 0.1 },
      { at: Number.NaN, time: 0.5 },
      { at: 0.8, time: 1.4 },
    ]
    expect(dayClock(marks)).toEqual([
      [0, 0],
      [0.2, 0.3],
      [0.6, 0.5],
      [1, 1],
    ])
    expect(dayClock([])).toEqual(STRAIGHT)
  })

  it('lands every curve on itself through a measured clock too', () => {
    const clock = clockOf(layouts.phone)
    for (const stops of [...Object.values(SKY), arcStops(SUN), arcStops(MOON)]) {
      const frames = curveKeyframes(stops, clock)
      const offsets = frames.map((frame) => frame.offset as number)
      expect(offsets[0]).toBe(0)
      expect(offsets[offsets.length - 1]).toBe(1)
      expect(new Set(offsets).size).toBe(offsets.length)
      for (let i = 1; i < frames.length; i++) {
        const middle = (offsets[i - 1]! + offsets[i]!) / 2
        expect((Number(frames[i - 1]!.opacity) + Number(frames[i]!.opacity)) / 2).toBeCloseTo(curveAt(stops, clockAt(clock, middle)).opacity, 3)
      }
    }
  })

  it('knows when a page has moved enough to matter', () => {
    const clock = clockOf(layouts.desktop)
    expect(sameClock(clock, clockOf(layouts.desktop))).toBe(true)
    expect(sameClock(clock, clockOf(layouts.phone))).toBe(false)
    expect(sameClock(clock, clock.slice(1))).toBe(false)
    const nudged = clock.map(([progress, time]) => [progress + 0.0002, time] as const)
    expect(sameClock(clock, nudged)).toBe(true)
  })
})

describe('the sky against the text in front of it', () => {
  type Rgba = [r: number, g: number, b: number, a: number]
  const css = readFileSync('src/styles/globals.css', 'utf8')
  const theme = (name: string) => {
    const block = css.slice(css.indexOf(`:root[data-theme='${name}'] {`))
    const body = block.slice(0, block.indexOf('\n}'))
    const read = (token: string): Rgba => {
      const value = new RegExp(`--${token}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? ''
      const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1]
      if (hex) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1]
      const parts = /^rgba?\(([^)]+)\)$/.exec(value)?.[1]?.split(',').map((part) => Number(part.trim()))
      if (parts && parts.length >= 3 && parts.every(Number.isFinite)) return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
      throw new Error(`no colour for --${token} in the ${name} theme: “${value}”`)
    }
    return read
  }
  const over = (under: Rgba, top: Rgba): Rgba => [0, 1, 2].map((i) => under[i]! + (top[i]! - under[i]!) * top[3]).concat(1) as Rgba
  const luminance = (colour: Rgba) =>
    [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
      const c = colour[i]! / 255
      return sum + weight * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
    }, 0)
  const contrast = (a: Rgba, b: Rgba) => {
    const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y) as [number, number]
    return (light + 0.05) / (dark + 0.05)
  }

  for (const name of ['dark', 'light']) {
    it(`keeps body copy readable over every part of the sun in the ${name} theme`, () => {
      const read = theme(name)
      const paint = (...layers: string[]) => layers.reduce((under, token) => over(under, read(token)), read('bg'))
      /*
       * The worst places a line of text can be: over the middle of the disc,
       * over its rim-ward edge, and in the glow right beside it — each on top
       * of the strongest light of the sky that is there at the same hour. The
       * glows are taken at full strength, which they only reach at the disc.
       */
      const places = {
        'the sun overhead, middle': paint('sky-noon-1', 'sun-core'),
        'the sun overhead, edge': paint('sky-noon-1', 'sun-edge'),
        'beside the sun overhead': paint('sky-noon-1', 'sun-halo', 'sun-haze'),
        'the rising sun, middle': paint('sky-dawn-1', 'sun-low-core'),
        'the rising sun, edge': paint('sky-dawn-1', 'sun-low-edge'),
        'the setting sun, middle': paint('sky-dusk-1', 'sun-low-core'),
        'the setting sun, edge': paint('sky-dusk-1', 'sun-low-edge'),
        'beside the setting sun': paint('sky-dusk-1', 'sun-low-halo', 'sun-low-haze'),
        'the dark of the moon': paint('sky-night-1', 'moon-shade'),
      }
      for (const [place, colour] of Object.entries(places)) {
        expect(contrast(read('fg'), colour), `headings over ${place}`).toBeGreaterThanOrEqual(7)
        expect(contrast(read('fg-2'), colour), `body copy over ${place}`).toBeGreaterThanOrEqual(4.5)
        // The faint labels are the price: they start near 4 : 1 (dark) and 3 : 1 (light) and must not fall below 2.
        expect(contrast(read('fg-3'), colour), `labels over ${place}`).toBeGreaterThanOrEqual(2)
      }
    })
  }
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
