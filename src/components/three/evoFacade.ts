import { hash2 } from './evoLand'
import { SHOP_WIDE, STREET_Z } from './evoStreet'

/**
 * How the city's walls are laid out, as numbers: what kinds of wall there are,
 * how wide a bay is and how high a floor, where the shops are, and — worked
 * out the same way the façade shader works it out — what is in every bay of
 * every floor of every front: a stair behind a screen, a loggia, a window,
 * and under which windows somebody has hung a cooler.
 *
 * The shader draws the walls; `evoRelief.ts` stands things out from them —
 * the coolers, the gas pipes, the shop boards, sills, cornices, everything on
 * the roofs. Both read the same numbers from here, and the same hash
 * (`hash2` is the shader's `evoHash`), so a cooler on its bracket is always
 * under a window and never across a stair. No three.js: the tests read it too.
 */

/** What a building is faced with: the shader has a wall for each. */
export const STYLE = {
  /** Concrete panels, with loggias and cast screens: most of what was built after the earthquake. */
  panel: 0,
  /** Yellow brick, four or five floors, arched at the top: the 1950s. */
  brick: 1,
  /** A curtain of glass. */
  glass: 2,
  /** Painted render and big windows: what has gone up since. */
  render: 3,
  /** Glass, with its top drawn in: the tallest of the towers at the end of the avenue. */
  crown: 4,
  /** A deep lattice of concrete over every window: the hotel. */
  lattice: 5,
} as const

export interface Tower {
  x: number
  z: number
  w: number
  d: number
  h: number
  seed: number
  /** One of `STYLE`. */
  style: number
  /** When in the building of the city this one starts to go up, 0 to 1. */
  delay: number
  /** Metres its base is lifted off the ground: the studio's building has no ground floor of its own. */
  base: number
  /** Turned about its own middle, radians. Only the hotel's wings are. */
  yaw: number
  /** Whether its ground floor is shops: the fronts on the street. */
  shops: boolean
  /** What it is part of, for the few that are one thing made of several boxes. */
  part?: 'hotel'
}

/** A kind of wall's grid: how wide a bay, how high a floor, how high the shops under them. */
export interface Grid {
  bay: number
  storey: number
  ground: number
}

export const PANEL: Grid = { bay: 3.2, storey: 2.9, ground: 4.4 }
export const BRICK: Grid = { bay: 2.9, storey: 3.5, ground: 4.6 }
export const RENDER: Grid = { bay: 3.4, storey: 3.0, ground: 4.4 }

/**
 * A shop: how wide, and where on it its board is — from what height to what
 * height, and how far in from either side, as a share of its width.
 */
export const SHOP = { wide: SHOP_WIDE, board: { from: 3.36, to: 4.2, side: 0.06 } } as const

/** How the shader holds a number it was handed as a float. */
const f32 = Math.fround

/** The shader's `evoHash(p + add)`, for a point it built as `vec2(a, b)`. */
export const hashAt = (a: number, b: number, add = 0): number => hash2(Math.floor(f32(a + add)), Math.floor(f32(b + add)))

/** Whether a wall of a block faces the street: the one its shops are in. */
export const streetSide = (t: Tower): 1 | -1 => (t.z < STREET_Z ? 1 : -1)

/** Whether a front has shops along its foot, as the shader decides it. */
export function hasShops(t: Tower): boolean {
  if (!t.shops) return false
  // A panel block lifted over something has none.
  return t.style !== STYLE.panel || t.base < 0.5
}

/** The bays of a front: how many, and where along it the first begins. */
export function bays(span: number, bay: number): { count: number; from: number } {
  const count = Math.max(1, Math.floor(f32(span) / bay))
  return { count, from: (f32(span) - count * bay) * 0.5 }
}

/** What fills a bay of a panel block, the whole way up: a stair behind a screen, loggias, or windows. */
export type PanelColumn = 'stair' | 'loggia' | 'window'

export function panelColumn(t: Tower, column: number): PanelColumn {
  const kind = hashAt(column + f32(t.seed) * 41, 3 + f32(t.seed) * 41)
  return kind < 0.15 ? 'stair' : kind < 0.64 ? 'loggia' : 'window'
}

/** A room's own number in the shader: its column and floor, moved along by the block's seed. */
const room = (t: Tower, column: number, level: number): [number, number] => [column + f32(t.seed) * 57, level + f32(t.seed) * 57]

/** Whether the shader hangs a cooler under this window of a panel block. */
export function panelCooler(t: Tower, column: number, level: number): boolean {
  const [a, b] = room(t, column, level)
  return hashAt(a, b, 9) < 0.32
}

/** Whether a loggia of a panel block has been glazed in. */
export function loggiaGlazed(t: Tower, column: number, level: number): boolean {
  const [a, b] = room(t, column, level)
  return hashAt(a, b, 5) < 0.36
}

/** Which of the sign boards a shop has, out of `count`. */
export function shopSign(t: Tower, shop: number, count: number): number {
  return Math.floor(hashAt(shop + f32(t.seed) * 23, 7 + f32(t.seed) * 23) * count)
}

/** Whether a shop has its shutter down, day and night: closed, or closed down. */
export function shopShut(t: Tower, shop: number): boolean {
  return hashAt(shop + f32(t.seed) * 23, 13 + f32(t.seed) * 23) < 0.2
}

/** Whether a shop that is open has an awning out over its windows. */
export function shopAwning(t: Tower, shop: number): boolean {
  return !shopShut(t, shop) && hashAt(shop + f32(t.seed) * 23, 17 + f32(t.seed) * 23) < 0.38
}

/** An awning: where on the wall its top edge is, how far out and down it slopes, and its flap. */
export const AWNING = { top: 3.3, reach: 1.15, slope: 0.42, flap: 0.22, wide: 0.8 } as const

/** The colours awnings are, out of the handful the shops along a street buy. */
const AWNINGS: readonly (readonly [number, number, number])[] = [
  [0.62, 0.1, 0.1],
  [0.08, 0.36, 0.22],
  [0.1, 0.24, 0.5],
  [0.85, 0.5, 0.08],
  [0.42, 0.14, 0.3],
]

/** Whether a column of a rendered block has balconies let into it. */
export function renderBalconies(t: Tower, column: number): boolean {
  return hashAt(column + f32(t.seed) * 3, 33 + f32(t.seed) * 3) < 0.45
}

/** Where a block's floors begin, and how many there are, on the front facing the street. */
export function floorsOf(t: Tower, grid: Grid): { foot: number; count: number } {
  const shops = hasShops(t)
  if (t.style === STYLE.brick) {
    const foot = shops ? grid.ground : 0.9
    return { foot, count: Math.max(0, Math.floor((t.h - 1.5 - foot) / grid.storey)) }
  }
  const foot = shops ? grid.ground : t.style === STYLE.panel ? t.base + 0.7 : 0.6
  // A floor is drawn wherever it starts under the top band of the wall.
  const band = t.style === STYLE.panel ? 1.1 : 1.3
  return { foot, count: Math.max(0, Math.ceil((t.h - band - foot) / grid.storey)) }
}

// ------------------------------------------------------------ what stands out

/** What a piece of the relief is. */
export type PieceKind =
  /** A cooler on a bracket. */
  | 'cooler'
  /** A gas meter in its box. */
  | 'meter'
  /** A shop's board, lit from inside. */
  | 'sign'
  /** Striped cloth over a shop's windows. */
  | 'awning'
  /** A run of gas pipe, along a wall, up it, or out of it. */
  | 'pipe'
  /** A dish on a loggia. */
  | 'dish'
  /** A mast on a roof. */
  | 'mast'
  /** Concrete or stone: a parapet, a lift's machine room, a vent, a cornice, a sill. */
  | 'masonry'

/**
 * A piece of the relief, in the world: its middle, its size — along the wall
 * it is on, up, and out from it — and which way that wall faces (radians
 * about y; 0 is +z). A pipe is a bar along its own `axis`. Everything belongs
 * to a block, and rises with it: anything with `top` comes into being when
 * the block's roof goes past it; anything on a roof (`roof`) is carried up on it.
 */
export interface Piece {
  kind: PieceKind
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  facing: number
  tower: number
  /** For a pipe: which way it runs — along the wall, up it, or out of it. */
  axis?: 'along' | 'up' | 'out'
  /** For a sign: which board. */
  sign?: number
  /** Whether it stands on the roof and goes up with it. */
  roof?: boolean
  /** How far it is tipped about the wall's own line, radians: its outer edge down. */
  tilt?: number
  /** A colour, as linear light, for whatever is not the same colour everywhere. */
  tint?: readonly [number, number, number]
}

const lin = (r: number, g: number, b: number): [number, number, number] => [r ** 2.2, g ** 2.2, b ** 2.2]
const mix = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t]
const fract = (v: number) => v - Math.floor(v)

/** The colour of a block's own wall, as the shader paints it, for whatever is built of the same. */
export function wallTint(t: Tower): [number, number, number] {
  const seed = f32(t.seed)
  if (t.style === STYLE.panel) return mix(lin(0.6, 0.58, 0.54), lin(0.74, 0.7, 0.62), fract(seed * 5.7))
  if (t.style === STYLE.brick) return lin(0.82, 0.78, 0.68)
  return mix(lin(0.86, 0.84, 0.78), lin(0.78, 0.76, 0.72), fract(seed * 6.1))
}

/** The yellow every gas pipe in the country is painted. */
const GAS = lin(0.93, 0.76, 0.16)
const METAL = lin(0.32, 0.33, 0.35)

/**
 * Everything that stands out from the walls and off the roofs, for the
 * blocks of the city. Fronts on the street are done in full; a block's other
 * walls are not looked at closely enough to need it, but every roof is seen
 * from above as the city goes up.
 */
export function reliefOf(blocks: readonly Tower[], signs: number): Piece[] {
  const out: Piece[] = []
  blocks.forEach((t, index) => {
    // The hotel and the towers of glass are faced to their roofs already.
    if (t.style === STYLE.glass || t.style === STYLE.crown || t.style === STYLE.lattice) return
    const side = streetSide(t)
    const facing = side > 0 ? 0 : Math.PI
    // The street front: where along it, in the world, a distance from its
    // western end is, and how far out from it a depth is.
    const wallZ = t.z + (side * t.d) / 2
    const at = (u: number, out: number) => ({ x: t.x - t.w / 2 + u, z: wallZ + side * out })
    const front = !!t.shops
    const add = (piece: Omit<Piece, 'tower' | 'facing'> & { facing?: number }) => out.push({ facing, tower: index, ...piece })

    if (front) facadeOf(t, at, add, signs)
    roofOf(t, add)
  })
  return out
}

type Place = (u: number, out: number) => { x: number; z: number }
type Add = (piece: Omit<Piece, 'tower' | 'facing'> & { facing?: number }) => void

function facadeOf(t: Tower, at: Place, add: Add, signs: number): void {
  const grid = t.style === STYLE.panel ? PANEL : t.style === STYLE.brick ? BRICK : RENDER
  const shops = hasShops(t)
  const { count, from } = bays(t.w, grid.bay)
  const floors = floorsOf(t, grid)

  // ---- the shops' boards: boxes of light standing out over every door.
  if (shops) {
    const whole = Math.floor(f32(t.w) / SHOP.wide)
    for (let s = 0; s < whole; s++) {
      const { from: low, to: high, side: inset } = SHOP.board
      const p = at(SHOP.wide * (s + 0.5), 0.13)
      add({ kind: 'sign', x: p.x, y: (low + high) / 2, z: p.z, w: SHOP.wide * (1 - 2 * inset), h: high - low, d: 0.24, sign: shopSign(t, s, signs) })
      if (shopAwning(t, s)) {
        // Cloth on a frame, sloping out from under the board, and a flap along its edge.
        const { top, reach, slope, flap, wide } = AWNING
        const tint = AWNINGS[Math.floor(hashAt(s + f32(t.seed) * 23, 19 + f32(t.seed) * 23) * AWNINGS.length)]!
        const cloth = lin(tint[0], tint[1], tint[2])
        const mid = at(SHOP.wide * (s + 0.5), (Math.cos(slope) * reach) / 2)
        add({ kind: 'awning', x: mid.x, y: top - (Math.sin(slope) * reach) / 2, z: mid.z, w: SHOP.wide * wide, h: 0.035, d: reach, tilt: slope, tint: cloth })
        const edge = at(SHOP.wide * (s + 0.5), Math.cos(slope) * reach)
        add({ kind: 'awning', x: edge.x, y: top - Math.sin(slope) * reach - flap / 2, z: edge.z, w: SHOP.wide * wide, h: flap, d: 0.02, tint: cloth })
      }
    }
  }

  // ---- what hangs on the floors above.
  // Panel blocks have galvanised flashing under their windows; brick ones, stone.
  const sill = mix(wallTint(t), lin(0.74, 0.75, 0.76), t.style === STYLE.panel ? 0.55 : 0.15)
  const kitchens: number[] = []
  for (let c = 0; c < count; c++) {
    const u0 = from + c * grid.bay
    const column = t.style === STYLE.panel ? panelColumn(t, c) : t.style === STYLE.render && renderBalconies(t, c) ? 'loggia' : 'window'
    if (column === 'window' && t.style !== STYLE.render && kitchens.length < 2 && hashAt(c + f32(t.seed) * 57, 61) < 0.4) kitchens.push(c)
    for (let level = 0; level < floors.count; level++) {
      const v0 = floors.foot + level * grid.storey
      // Nothing above the band at the top of the wall.
      if (v0 + grid.storey * 0.9 > t.h - (t.style === STYLE.brick ? 1.5 : 1.1)) continue
      const [ra, rb] = room(t, c, level)
      if (t.style === STYLE.panel) {
        if (column === 'window') {
          // A sill under every window; a cooler under one in three, where the shader paints one.
          const s = at(u0 + grid.bay * 0.5, 0.06)
          add({ kind: 'masonry', x: s.x, y: v0 + grid.storey * 0.2 - 0.03, z: s.z, w: grid.bay * 0.6 + 0.12, h: 0.05, d: 0.12, tint: sill })
          if (panelCooler(t, c, level)) {
            const p = at(u0 + grid.bay * 0.7, 0.16)
            add({ kind: 'cooler', x: p.x, y: v0 + 0.28, z: p.z, w: 0.72, h: 0.46, d: 0.28 })
          }
        } else if (column === 'loggia') {
          // Coolers hung on the outside of a loggia's front, and here and there a dish on it.
          if (hashAt(ra, rb, 11) < 0.22) {
            const left = hashAt(ra, rb, 12) < 0.5
            const p = at(u0 + grid.bay * (left ? 0.27 : 0.7), 0.16)
            add({ kind: 'cooler', x: p.x, y: v0 + 0.52, z: p.z, w: 0.72, h: 0.46, d: 0.28 })
          } else if (hashAt(ra, rb, 13) < 0.08) {
            const p = at(u0 + grid.bay * 0.84, 0.25)
            add({ kind: 'dish', x: p.x, y: v0 + 1.25, z: p.z, w: 0.62, h: 0.62, d: 0.18 })
          }
        }
      } else if (t.style === STYLE.brick) {
        // Down the middle of the front, a balcony to every floor above the
        // first: a stone slab and a solid stone parapet, the window a door.
        if (count >= 3 && c === Math.floor(count / 2) && level >= 1) {
          const stone = lin(0.8, 0.76, 0.66)
          const door = v0 + grid.storey * 0.13
          const wide = grid.bay * 0.74
          const deep = 0.8
          const slab = at(u0 + grid.bay * 0.5, deep / 2)
          add({ kind: 'masonry', x: slab.x, y: door - 0.08, z: slab.z, w: wide, h: 0.16, d: deep, tint: stone })
          const front = at(u0 + grid.bay * 0.5, deep - 0.05)
          add({ kind: 'masonry', x: front.x, y: door + 0.47, z: front.z, w: wide, h: 0.94, d: 0.1, tint: stone })
          for (const end of [-1, 1]) {
            const side = at(u0 + grid.bay * 0.5 + end * (wide / 2 - 0.05), deep / 2)
            add({ kind: 'masonry', x: side.x, y: door + 0.47, z: side.z, w: 0.1, h: 0.94, d: deep - 0.1, tint: stone })
          }
          continue
        }
        // Stone sills; a cooler under some of the windows, below the sill.
        const s = at(u0 + grid.bay * 0.5, 0.08)
        add({ kind: 'masonry', x: s.x, y: v0 + grid.storey * 0.13 - 0.04, z: s.z, w: grid.bay * 0.46 + 0.22, h: 0.08, d: 0.16, tint: sill })
        if (level > 0 && hashAt(ra, rb, 9) < 0.3) {
          const p = at(u0 + grid.bay * 0.5, 0.16)
          add({ kind: 'cooler', x: p.x, y: v0 + 0.1, z: p.z, w: 0.72, h: 0.46, d: 0.28 })
        }
      } else if (column === 'window' && level > 0 && hashAt(ra, rb, 9) < 0.26) {
        // Newer blocks: a cooler on the wall between one floor's window and the next.
        const p = at(u0 + grid.bay * 0.5, 0.16)
        add({ kind: 'cooler', x: p.x, y: v0 + 0.02, z: p.z, w: 0.72, h: 0.46, d: 0.28 })
      }
    }
  }

  // ---- gas: a pipe along the front over the shops, a riser up to the
  // kitchens, and where it comes up out of the ground, its meter. Not on the
  // newer blocks, which have it inside.
  if (shops && t.style !== STYLE.render) {
    const run = t.style === STYLE.brick ? 4.35 : grid.ground - 0.1
    const mid = at(t.w / 2, 0.12)
    add({ kind: 'pipe', axis: 'along', x: mid.x, y: run, z: mid.z, w: t.w - 0.8, h: 0.09, d: 0.09, tint: GAS })
    if (t.w > SHOP.wide + 0.8) {
      const down = at(SHOP.wide, 0.12)
      add({ kind: 'pipe', axis: 'up', x: down.x, y: (run + 0.45) / 2, z: down.z, w: 0.07, h: run - 0.45, d: 0.07, tint: GAS })
      const box = at(SHOP.wide, 0.1)
      add({ kind: 'meter', x: box.x, y: 1.55, z: box.z, w: 0.3, h: 0.4, d: 0.2 })
    }
    for (const c of kitchens) {
      const u = from + c * grid.bay + 0.22
      // Up to the top floor's kitchen, and never through the band along the top of the wall.
      const top = Math.min(floors.foot + (floors.count - 1) * grid.storey + grid.storey * 0.5, t.h - 1.6)
      if (top <= run + 1) continue
      const p = at(u, 0.12)
      add({ kind: 'pipe', axis: 'up', x: p.x, y: (run + top) / 2, z: p.z, w: 0.055, h: top - run, d: 0.055, tint: GAS })
      for (let level = 0; level < floors.count; level++) {
        const v = floors.foot + level * grid.storey + grid.storey * 0.45
        if (v > top) break
        // Into the kitchen, beside its window.
        const s = at(u + 0.17, 0.12)
        add({ kind: 'pipe', axis: 'along', x: s.x, y: v, z: s.z, w: 0.34, h: 0.045, d: 0.045, tint: GAS })
        const into = at(u + 0.34, 0.06)
        add({ kind: 'pipe', axis: 'out', x: into.x, y: v, z: into.z, w: 0.045, h: 0.045, d: 0.12, tint: GAS })
      }
    }
  }

  // ---- brick: a cornice that stands out along the top, round the corners.
  if (t.style === STYLE.brick) {
    const stone = lin(0.82, 0.78, 0.68)
    const c = at(t.w / 2, 0.22)
    add({ kind: 'masonry', x: c.x, y: t.h - 0.45, z: c.z, w: t.w + 0.88, h: 0.42, d: 0.44, tint: stone })
    const ledge = at(t.w / 2, 0.07)
    add({ kind: 'masonry', x: ledge.x, y: t.h - 1.5, z: ledge.z, w: t.w + 0.28, h: 0.12, d: 0.14, tint: stone })
  }
}

function roofOf(t: Tower, add: Add): void {
  const top = t.h
  const tint = wallTint(t)
  const high = t.style === STYLE.brick ? 0.42 : 0.6
  const thick = 0.24
  // The parapet: a low wall all the way round, its outside the wall's own face carried up.
  const edges: [number, number, number, number, number][] = [
    [t.x, t.z + t.d / 2 - thick / 2, t.w, thick, 0],
    [t.x, t.z - t.d / 2 + thick / 2, t.w, thick, 0],
    [t.x + t.w / 2 - thick / 2, t.z, t.d - thick * 2, thick, Math.PI / 2],
    [t.x - t.w / 2 + thick / 2, t.z, t.d - thick * 2, thick, Math.PI / 2],
  ]
  for (const [x, z, w, d, turn] of edges) add({ kind: 'masonry', roof: true, x, y: top + high / 2, z, w, h: high, d, facing: turn, tint })

  // The lifts' machine rooms, over the stairs, on anything tall enough to have lifts.
  const grid = t.style === STYLE.panel ? PANEL : t.style === STYLE.brick ? BRICK : RENDER
  const { count, from } = bays(t.w, grid.bay)
  const rooms: number[] = []
  if (t.h > 24 && t.style !== STYLE.brick) {
    for (let c = 0; c < count; c++) {
      const stair = t.style === STYLE.panel ? panelColumn(t, c) === 'stair' : hashAt(c + f32(t.seed) * 19, 71) < 0.18
      if (stair) rooms.push(c)
    }
    if (rooms.length === 0) rooms.push(Math.floor(count / 2))
  }
  const shade = mix(tint, lin(0.5, 0.5, 0.5), 0.35)
  for (const c of rooms.slice(0, 3)) {
    const x = t.x - t.w / 2 + from + (c + 0.5) * grid.bay
    add({ kind: 'masonry', roof: true, x, y: top + 1.25, z: t.z, w: Math.min(3.1, grid.bay), h: 2.5, d: Math.min(4.4, t.d * 0.32), facing: 0, tint: shade })
  }

  // Vents, and on the older blocks the masts the aerials were on.
  const vents = 2 + Math.floor(hash2(Math.floor(t.x * 7), 83) * 3)
  for (let i = 0; i < vents; i++) {
    const x = t.x + (hash2(Math.floor(t.x * 7) + i, 89) - 0.5) * (t.w - 3)
    const z = t.z + (hash2(Math.floor(t.z * 7) + i, 97) - 0.5) * (t.d - 3)
    add({ kind: 'masonry', roof: true, x, y: top + 0.45, z, w: 0.6, h: 0.9, d: 0.6, facing: 0, tint: shade })
  }
  if (t.style !== STYLE.render && hash2(Math.floor(t.x * 3), 101) < 0.6) {
    const masts = 1 + Math.floor(hash2(Math.floor(t.x * 3), 103) * 2)
    for (let i = 0; i < masts; i++) {
      const x = t.x + (hash2(Math.floor(t.x * 5) + i, 107) - 0.5) * (t.w - 4)
      const z = t.z + (hash2(Math.floor(t.z * 5) + i, 109) - 0.5) * (t.d - 4)
      const tall = 2.4 + hash2(i, Math.floor(t.x)) * 1.8
      add({ kind: 'mast', roof: true, axis: 'up', x, y: top + tall / 2, z, w: 0.05, h: tall, d: 0.05, facing: 0, tint: METAL })
      add({ kind: 'mast', roof: true, axis: 'along', x, y: top + tall - 0.3, z, w: 1.4, h: 0.035, d: 0.035, facing: hash2(i, 7) * Math.PI, tint: METAL })
    }
  }
}
