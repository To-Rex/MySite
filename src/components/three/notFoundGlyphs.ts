/**
 * The number on the 404 page: three digits as outlines, and the field of basalt
 * columns that fills them.
 *
 * Free of three.js, so the geometry can be checked without a GPU. The scene
 * turns the outlines into an extruded molten core and the field into instanced
 * columns; because both come from the same polygons, the columns can never
 * drift off the glow underneath them.
 */

export type Point2 = readonly [number, number]

export interface Glyph {
  /** The outside of the digit. */
  outer: readonly Point2[]
  /** Counters: the triangle in a 4, the oval in a 0. */
  holes: readonly (readonly Point2[])[]
}

/** Every digit spans −1.5..1.5 in y before the stage is scaled to the viewport. */
export const DIGIT_HEIGHT = 3

/** How thick a digit's strokes are; relief is measured against it. */
const STROKE = 0.62

/** Space between digits. */
const GAP = 0.34

/** An oval that has been squared off a little, the way a heavy grotesque's zero is. */
function superellipse(a: number, b: number, squareness: number, segments: number): Point2[] {
  const out: Point2[] = []
  const power = 2 / squareness
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    out.push([a * Math.sign(c) * Math.abs(c) ** power, b * Math.sign(s) * Math.abs(s) ** power])
  }
  return out
}

/**
 * Drawn by hand against Manrope ExtraBold, the headline face. The inner diagonal
 * is the outer one moved one stroke in along its normal, and the counter's other
 * two corners are where that line meets the stem and the crossbar.
 */
const FOUR: Glyph = {
  outer: [
    [1.07, 1.5],
    [0.38, 1.5],
    [-1.3, -0.12],
    [-1.3, -0.7],
    [0.45, -0.7],
    [0.45, -1.5],
    [1.07, -1.5],
    [1.07, -0.7],
    [1.32, -0.7],
    [1.32, -0.14],
    [1.07, -0.14],
  ],
  holes: [
    [
      [0.45, -0.14],
      [0.45, 0.734],
      [-0.457, -0.14],
    ],
  ],
}

const ZERO: Glyph = {
  outer: superellipse(1.12, 1.5, 2.5, 72),
  holes: [superellipse(0.5, 0.9, 2.3, 48)],
}

function translate(glyph: Glyph, dx: number): Glyph {
  const move = (points: readonly Point2[]) => points.map(([x, y]) => [x + dx, y] as Point2)
  return { outer: move(glyph.outer), holes: glyph.holes.map(move) }
}

const span = (glyph: Glyph) => {
  const xs = glyph.outer.map(([x]) => x)
  return [Math.min(...xs), Math.max(...xs)] as const
}

function compose(glyphs: readonly Glyph[]): { digits: Glyph[]; width: number } {
  const widths = glyphs.map(span)
  const width = widths.reduce((sum, [min, max]) => sum + (max - min), 0) + GAP * (glyphs.length - 1)
  let cursor = -width / 2
  const digits = glyphs.map((glyph, i) => {
    const [min, max] = widths[i]!
    const placed = translate(glyph, cursor - min)
    cursor += max - min + GAP
    return placed
  })
  return { digits, width }
}

const composed = compose([FOUR, ZERO, FOUR])

/** The three digits, centred on the origin. */
export const DIGITS: readonly Glyph[] = composed.digits

/** Width of the whole number before scaling. */
export const NUMBER_WIDTH = composed.width

/** Where a turtle can get through: the middle of the zero. */
export const ZERO_CENTRE: Point2 = [(span(DIGITS[1]!)[0] + span(DIGITS[1]!)[1]) / 2, 0]

/**
 * Signed distance to a digit: negative inside the ink, positive outside it and
 * inside its counters. Brute force over the edges, which is plenty for one
 * lattice of a few thousand points once per page load.
 */
export function signedDistance(glyph: Glyph, x: number, y: number): number {
  let nearest = Infinity
  let inside = false
  for (const loop of [glyph.outer, ...glyph.holes]) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [ax, ay] = loop[j]!
      const [bx, by] = loop[i]!
      const ex = bx - ax
      const ey = by - ay
      const px = x - ax
      const py = y - ay
      const along = Math.min(1, Math.max(0, (px * ex + py * ey) / (ex * ex + ey * ey)))
      const dx = px - ex * along
      const dy = py - ey * along
      nearest = Math.min(nearest, dx * dx + dy * dy)
      // Even-odd across every loop, which is what makes a counter count as outside.
      if (ay > y !== by > y && x < (ex * (y - ay)) / ey + ax) inside = !inside
    }
  }
  return (inside ? -1 : 1) * Math.sqrt(nearest)
}

/** A deterministic 0..1 per integer pair, so the digits come out the same every visit. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

export interface ColumnField {
  count: number
  /** x, y of each column's axis. */
  home: Float32Array
  /** Circumradius of each hexagon. Shrinks toward the edge of the ink. */
  radius: Float32Array
  /** How far each column stands out of the core at rest. */
  rest: Float32Array
  /** Four independent 0..1 values per column. */
  seed: Float32Array
}

/**
 * Packs a digit with hexagonal columns of circumradius `cell`.
 *
 * Near an outline a full hexagon would stick out of the ink, so a column there
 * takes whatever radius still fits. That shrinks them into a sort of halftone
 * along every edge instead of a staircase, and the molten core, which has the
 * exact outline, shows through between them and keeps the silhouette crisp.
 */
export function buildColumns(cell: number): ColumnField {
  const columns: number[] = []
  const stepX = cell * Math.sqrt(3)
  const stepY = cell * 1.5
  const halfX = NUMBER_WIDTH / 2 + cell
  const halfY = DIGIT_HEIGHT / 2 + cell
  const rows = Math.ceil(halfY / stepY)
  const cols = Math.ceil(halfX / stepX)

  for (let row = -rows; row <= rows; row++) {
    const offset = row & 1 ? stepX / 2 : 0
    for (let col = -cols; col <= cols; col++) {
      const x = col * stepX + offset
      const y = row * stepY
      let depth = 0
      for (const glyph of DIGITS) {
        const [min, max] = span(glyph)
        if (x < min || x > max) continue
        depth = Math.max(depth, -signedDistance(glyph, x, y))
      }
      // Anything thinner than this is a speck rather than a column.
      if (depth < cell * 0.26) continue

      // Rounded across the stroke, so a digit reads as a mass and not a plate.
      const across = Math.min(1, depth / (STROKE * 0.5))
      const pillow = across * across * (3 - 2 * across)
      const ground = valueNoise(x * 1.25 + 7.1, y * 1.25 - 3.3) - 0.5
      const jitter = hash(row, col) - 0.5
      const rest = 0.2 + pillow * 0.36 + ground * 0.2 + jitter * 0.07
      columns.push(x, y, Math.min(cell, depth), Math.max(0.1, rest), hash(col, row + 11), hash(col + 5, row), hash(row - 3, col + 9), hash(col - 7, row - 2))
    }
  }

  const count = columns.length / 8
  const home = new Float32Array(count * 2)
  const radius = new Float32Array(count)
  const rest = new Float32Array(count)
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const at = i * 8
    home[i * 2] = columns[at]!
    home[i * 2 + 1] = columns[at + 1]!
    radius[i] = columns[at + 2]!
    rest[i] = columns[at + 3]!
    seed.set(columns.slice(at + 4, at + 8), i * 4)
  }
  return { count, home, radius, rest, seed }
}
