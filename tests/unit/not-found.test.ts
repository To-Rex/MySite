import { afterEach, describe, expect, it } from 'vitest'
import { DIGITS, DIGIT_HEIGHT, NUMBER_WIDTH, ZERO_CENTRE, buildColumns, signedDistance } from '@/components/three/notFoundGlyphs'
import { CAMERA, OPENING, VIEW_HEIGHT, callRoar, callStrike, drainCommands, setNotFoundAct, stageLayout, toStage } from '@/lib/notFound'

/**
 * The parts of the 404 page that are arithmetic. What the scene looks like is a
 * job for eyes and `npm run shots`; whether the digits are the right shape, the
 * columns stay inside them and everything fits in the window is not.
 */

const allFinite = (values: ArrayLike<number>) => Array.from(values).every(Number.isFinite)
const insideInk = (x: number, y: number) => DIGITS.reduce((nearest, digit) => Math.min(nearest, signedDistance(digit, x, y)), Infinity)

describe('the digits', () => {
  it('are a 4, a 0 and a 4, centred on the origin', () => {
    expect(DIGITS).toHaveLength(3)
    const xs = DIGITS.flatMap((digit) => digit.outer.map(([x]) => x))
    expect(Math.min(...xs)).toBeCloseTo(-NUMBER_WIDTH / 2, 5)
    expect(Math.max(...xs)).toBeCloseTo(NUMBER_WIDTH / 2, 5)
    // The fours are the same shape, so a misplaced vertex shows up as a difference.
    expect(DIGITS[0]!.outer.length).toBe(DIGITS[2]!.outer.length)
  })

  it('all stand exactly as tall as each other', () => {
    for (const digit of DIGITS) {
      const ys = digit.outer.map(([, y]) => y)
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(DIGIT_HEIGHT, 5)
    }
  })

  it('measure negative in the ink and positive out of it, counters included', () => {
    const [four, zero] = DIGITS
    // Middle of the zero's left stroke, then its counter, then well outside.
    const zeroLeft = ZERO_CENTRE[0] - 0.81
    expect(signedDistance(zero!, zeroLeft, 0)).toBeLessThan(-0.25)
    expect(signedDistance(zero!, ZERO_CENTRE[0], ZERO_CENTRE[1])).toBeGreaterThan(0.4)
    expect(signedDistance(zero!, 40, 40)).toBeGreaterThan(30)
    // The counter of the first four is a triangle above the crossbar.
    const stemLeft = Math.max(...four!.holes[0]!.map(([x]) => x))
    expect(signedDistance(four!, stemLeft - 0.15, 0.05)).toBeGreaterThan(0)
  })

  it('leave a hole in the zero a turtle can swim through', () => {
    // Its path runs through this point, at a body width of about ±0.3.
    expect(signedDistance(DIGITS[1]!, ZERO_CENTRE[0], ZERO_CENTRE[1])).toBeGreaterThan(0.45)
  })
})

describe('the columns', () => {
  it.each([
    ['high', 0.052],
    ['medium', 0.064],
    ['low', 0.088],
  ])('fill the digits on a %s device without getting out of hand', (_, cell) => {
    const field = buildColumns(cell)
    expect(field.count).toBeGreaterThan(400)
    expect(field.count).toBeLessThan(6000)
  })

  it('are all real numbers', () => {
    const field = buildColumns(0.064)
    for (const array of [field.home, field.radius, field.rest, field.seed]) expect(allFinite(array)).toBe(true)
    expect(field.home).toHaveLength(field.count * 2)
    expect(field.seed).toHaveLength(field.count * 4)
  })

  it('each stay inside the ink, hexagon and all', () => {
    const field = buildColumns(0.064)
    for (let i = 0; i < field.count; i++) {
      const depth = -insideInk(field.home[i * 2]!, field.home[i * 2 + 1]!)
      // The circumradius: the corners of the hexagon are the furthest it reaches.
      expect(field.radius[i]!).toBeLessThanOrEqual(depth + 1e-5)
      expect(field.radius[i]!).toBeGreaterThan(0)
    }
  })

  it('stand out from the core by a sensible amount, seeds in range', () => {
    const field = buildColumns(0.064)
    for (const rest of field.rest) {
      expect(rest).toBeGreaterThanOrEqual(0.1)
      expect(rest).toBeLessThan(0.9)
    }
    for (const seed of field.seed) {
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThan(1)
    }
  })

  it('come out the same on every visit', () => {
    const a = buildColumns(0.088)
    const b = buildColumns(0.088)
    expect(Array.from(a.home)).toEqual(Array.from(b.home))
    expect(Array.from(a.rest)).toEqual(Array.from(b.rest))
  })
})

describe('the layout', () => {
  const windows = [
    [320, 568],
    [360, 640],
    [390, 844],
    [412, 915],
    [768, 1024],
    [600, 560],
    [800, 780],
    [844, 390],
    [667, 375],
    [1024, 768],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
    [2560, 1080],
    [3840, 2160],
  ] as const

  it.each(windows)('at %d×%d keeps the number on screen and every value real', (width, height) => {
    const L = stageLayout(width, height, NUMBER_WIDTH)
    expect(allFinite(Object.values(L).filter((value): value is number => typeof value === 'number'))).toBe(true)
    const viewW = VIEW_HEIGHT * (width / height)
    const half = (NUMBER_WIDTH / 2) * L.stageScale
    expect(L.stageX - half).toBeGreaterThanOrEqual(-viewW / 2)
    expect(L.stageX + half).toBeLessThanOrEqual(viewW / 2)
    const top = L.stageY + (DIGIT_HEIGHT / 2) * L.stageScale
    expect(top).toBeLessThanOrEqual(VIEW_HEIGHT / 2)
  })

  it.each(windows)('at %d×%d has the animal walk in from off screen', (width, height) => {
    const L = stageLayout(width, height, NUMBER_WIDTH)
    const viewW = VIEW_HEIGHT * (width / height)
    // It stands nearer than the plane the view was measured at, so less of the world fits.
    const fits = (viewW / 2) * ((CAMERA.z - L.rexZ) / CAMERA.z)
    expect(L.rexFrom - L.rexScale * 0.5).toBeGreaterThan(fits)
    expect(L.rexFrom).toBeGreaterThan(L.rexX)
  })

  it.each(windows.filter(([width, height]) => width < height))('at %d×%d stands it under the number', (width, height) => {
    const L = stageLayout(width, height, NUMBER_WIDTH)
    const bottom = L.stageY - (DIGIT_HEIGHT / 2) * L.stageScale
    expect(L.groundY + L.rexScale * 0.44).toBeLessThanOrEqual(bottom + 1e-5)
  })

  it('converts between the world and the number', () => {
    const L = stageLayout(1440, 900, NUMBER_WIDTH)
    expect(toStage(L.stageX, L.stageY, L)).toEqual([0, 0])
    expect(toStage(L.stageX + L.stageScale, L.stageY - L.stageScale * 2, L)).toEqual([1, -2])
  })
})

describe('the opening', () => {
  it('happens in order', () => {
    const order = [OPENING.meteor, OPENING.impact, OPENING.rise, OPENING.walk, OPENING.alive]
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(new Set(order).size).toBe(order.length)
  })
})

describe('what the visitor can ask for', () => {
  afterEach(() => {
    drainCommands()
    setNotFoundAct('load')
  })

  it('waits for the opening to finish', () => {
    setNotFoundAct('impact')
    callRoar()
    callStrike(0, 0)
    expect(drainCommands()).toEqual([])
  })

  it('reaches the scene once, in order', () => {
    setNotFoundAct('alive')
    callStrike(0.5, -0.5)
    callRoar()
    expect(drainCommands()).toEqual([{ kind: 'strike', nx: 0.5, ny: -0.5 }, { kind: 'roar' }])
    expect(drainCommands()).toEqual([])
  })

  it('does not let a held key queue a siege', () => {
    setNotFoundAct('alive')
    for (let i = 0; i < 50; i++) callStrike(0, 0)
    expect(drainCommands().length).toBeLessThanOrEqual(4)
  })
})
