import { describe, expect, it } from 'vitest'
import { towers } from '@/components/three/evoCity'
import { BRICK, PANEL, SHOP, STYLE, bays, floorsOf, hasShops, panelColumn, reliefOf, streetSide, type Piece, type Tower } from '@/components/three/evoFacade'
import { hash2 } from '@/components/three/evoLand'
import { cameraAt, type Shot } from '@/components/three/evoScript'
import { SIGN_GRID } from '@/components/three/evoSigns'
import { PAVEMENT, ROAD, STREET_Z } from '@/components/three/evoStreet'

/**
 * What stands out from the walls: that it stands where the walls the shader
 * draws have room for it — a cooler under a window, a board over a whole
 * shop, a pipe over the shops and not across a window — and nowhere it would
 * be in the road, in the walk's way, or in the air.
 */

const blocks = towers()
const signs = SIGN_GRID.columns * SIGN_GRID.rows
const pieces = reliefOf(blocks, signs)
const steps = (from: number, to: number, n: number) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n)

/** Where the camera goes through the city, worked out once: [progress, x, y, z], and the box round all of it. */
const path = (() => {
  const shot: Shot = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 45 }
  const points = steps(0.55, 1, 450).map((p) => {
    cameraAt(p, shot)
    return [p, shot.x, shot.y, shot.z] as const
  })
  const box: [number, number, number, number, number, number] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
  for (const [, x, y, z] of points) {
    box[0] = Math.min(box[0], x)
    box[1] = Math.max(box[1], x)
    box[2] = Math.min(box[2], y)
    box[3] = Math.max(box[3], y)
    box[4] = Math.min(box[4], z)
    box[5] = Math.max(box[5], z)
  }
  return { points, box }
})()

/** How far a piece reaches from its middle along x, y and z, as it is turned. */
function extent(p: Piece): [number, number, number] {
  if (p.kind === 'mast' && p.axis === 'along') return [p.w / 2, p.h / 2, p.w / 2]
  const turned = Math.abs(Math.sin(p.facing)) > 0.7
  // A bar's length is along its own axis; its other two sides are its thickness.
  const [along, up, out] = p.kind === 'pipe' || p.kind === 'mast' ? (p.axis === 'up' ? [p.w, p.h, p.d] : p.axis === 'out' ? [p.w, p.h, p.d] : [p.w, p.h, p.d]) : [p.w, p.h, p.d]
  return turned ? [out / 2, up / 2, along / 2] : [along / 2, up / 2, out / 2]
}

/** Where a piece is on its block's street front: how far along it, how high, how far out. */
function onFront(piece: Piece, t: Tower): { u: number; v: number; out: number } {
  const side = streetSide(t)
  return { u: piece.x - (t.x - t.w / 2), v: piece.y, out: side * (piece.z - (t.z + (side * t.d) / 2)) }
}

describe('the hash the walls are drawn with', () => {
  it('is the one the shader has: the same number for the same cell, from either side', () => {
    // The shader floors what it is given and hashes the integers; so does this.
    expect(hash2(3, 41)).toBe(hash2(3, 41))
    expect(hash2(3, 41)).not.toBe(hash2(41, 3))
    for (let i = 0; i < 200; i++) {
      const v = hash2(i * 7 - 300, 1000 - i * 13)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('the relief', () => {
  it('is the same every visit, and small', () => {
    expect(reliefOf(blocks, signs)).toEqual(pieces)
    expect(pieces.length).toBeGreaterThan(400)
    expect(pieces.length).toBeLessThan(2500)
    for (const kind of ['cooler', 'meter', 'sign', 'awning', 'pipe', 'masonry', 'mast'] as const) {
      expect(pieces.some((p) => p.kind === kind), kind).toBe(true)
    }
    for (const p of pieces) {
      for (const n of [p.x, p.y, p.z, p.w, p.h, p.d, p.facing]) expect(Number.isFinite(n)).toBe(true)
      expect(p.w).toBeGreaterThan(0)
      expect(p.h).toBeGreaterThan(0)
      expect(p.d).toBeGreaterThan(0)
    }
  })

  it('hangs a cooler only under a window or on a loggia, never across a stair', () => {
    let checked = 0
    for (const p of pieces.filter((piece) => piece.kind === 'cooler')) {
      const t = blocks[p.tower]!
      if (t.style !== STYLE.panel) continue
      const { u, v, out } = onFront(p, t)
      const { from } = bays(t.w, PANEL.bay)
      const column = Math.floor((u - from) / PANEL.bay)
      expect(panelColumn(t, column), `a cooler across a stair at ${p.x},${p.y}`).not.toBe('stair')
      const { foot } = floorsOf(t, PANEL)
      expect(v).toBeGreaterThan(foot)
      expect(out).toBeGreaterThan(0)
      expect(out).toBeLessThan(0.4)
      checked++
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('puts a board over every whole shop, and nowhere else', () => {
    for (const t of blocks) {
      const boards = pieces.filter((p) => p.kind === 'sign' && blocks[p.tower] === t)
      expect(boards.length, `boards on the block at ${t.x}`).toBe(hasShops(t) ? Math.floor(Math.fround(t.w) / SHOP.wide) : 0)
      for (const p of boards) {
        const { u, v } = onFront(p, t)
        const middle = u / SHOP.wide - 0.5
        expect(Math.abs(middle - Math.round(middle))).toBeLessThan(1e-6)
        expect(v).toBeCloseTo((SHOP.board.from + SHOP.board.to) / 2, 6)
        expect(p.sign).toBeGreaterThanOrEqual(0)
        expect(p.sign).toBeLessThan(signs)
      }
    }
  })

  it('runs gas over the shops of the older blocks only, under the first floor and over the boards', () => {
    const along = pieces.filter((p) => p.kind === 'pipe' && p.axis === 'along' && p.w > 2)
    expect(along.length).toBeGreaterThan(3)
    for (const p of along) {
      const t = blocks[p.tower]!
      expect(t.style === STYLE.panel || t.style === STYLE.brick).toBe(true)
      expect(hasShops(t)).toBe(true)
      expect(p.y).toBeGreaterThan(SHOP.board.to + p.h / 2)
      expect(p.y).toBeLessThan((t.style === STYLE.brick ? BRICK.ground : PANEL.ground) - p.h / 2)
    }
  })

  it('keeps everything to its own block: out of the road, off the pavement below head height, and on the roofs it is on', () => {
    for (const p of pieces) {
      const t = blocks[p.tower]!
      const reach = Math.max(p.w, p.d) / 2 + 0.6
      expect(Math.abs(p.x - t.x), `${p.kind} at ${p.x}`).toBeLessThan(t.w / 2 + reach)
      expect(Math.abs(p.z - t.z), `${p.kind} at ${p.z}`).toBeLessThan(t.d / 2 + reach)
      // Never over the road — no more than an awning's reach out over the
      // pavement — and anything over the pavement is above a head.
      expect(Math.abs(p.z - STREET_Z)).toBeGreaterThan(ROAD + PAVEMENT - 1.3)
      if (Math.abs(p.z - STREET_Z) < ROAD + PAVEMENT && p.kind !== 'pipe' && p.kind !== 'meter') expect(p.y - p.h / 2).toBeGreaterThan(2.2)
      if (p.roof) {
        // On the roof: standing on it, or up a mast that does.
        if (p.kind === 'masonry') expect(p.y - p.h / 2).toBeCloseTo(t.h, 6)
        expect(p.y - p.h / 2).toBeGreaterThan(t.h - 1e-6)
        expect(p.y + p.h / 2).toBeLessThan(t.h + 4.5)
      } else {
        expect(p.y + p.h / 2).toBeLessThan(t.h + 0.01)
        expect(p.y - p.h / 2).toBeGreaterThan(0)
      }
    }
  })

  it('is never in the walk\'s way', () => {
    // Only what is anywhere near the walk's path is worth asking about.
    const near = pieces.filter((piece) => {
      const [ex, ey, ez] = extent(piece)
      return piece.x + ex > path.box[0] - 0.3 && piece.x - ex < path.box[1] + 0.3 && piece.y + ey > path.box[2] - 0.3 && piece.y - ey < path.box[3] + 0.3 && piece.z + ez > path.box[4] - 0.3 && piece.z - ez < path.box[5] + 0.3
    })
    for (const [p, x, y, z] of path.points) {
      for (const piece of near) {
        const [ex, ey, ez] = extent(piece)
        const inside = Math.abs(x - piece.x) < ex + 0.3 && Math.abs(y - piece.y) < ey + 0.3 && Math.abs(z - piece.z) < ez + 0.3
        expect(inside, `the camera in a ${piece.kind} at ${piece.x},${piece.y},${piece.z} at ${p}`).toBe(false)
      }
    }
  })
})
