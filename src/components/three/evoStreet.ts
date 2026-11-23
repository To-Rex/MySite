import { PLACE, hash2 } from './evoLand'

/**
 * The street the walk ends on, as numbers.
 *
 * Several files stand things on it — the buildings, the lamps, the traffic,
 * the trees, the people on the pavement — and they have to agree about where
 * the kerb is. This is where it is written down, once: plain numbers, and the
 * GLSL that repeats them, so the tests read the same street the scene draws.
 *
 * The street runs along +x. "Far" is the side across the road from the walk
 * (towards -z), "near" the side the walk comes down.
 */

const CITY = PLACE.city

/** Where the city starts and stops, along the walk. */
export const CITY_FROM = CITY.from
export const CITY_UNTIL = CITY.until
/** The middle of the road. */
export const STREET_Z = CITY.street
/** From the middle of the road to either kerb, and the width of the pavement beyond each. */
export const ROAD = CITY.half
export const PAVEMENT = 4.2
/** Where the fronts of the buildings stand, either side. */
export const FRONT_FAR = STREET_Z - ROAD - PAVEMENT
export const FRONT_NEAR = STREET_Z + ROAD + PAVEMENT
/** The length of what is paved: a little before the first front to a little past the last. */
export const STREET_LENGTH = CITY_UNTIL - CITY_FROM + 30
export const STREET_START = CITY_FROM - 8
/** Where the paving itself begins: the west end of the street's ground. */
export const PAVED_FROM = CITY_FROM - 12

/** Lamps: how far apart along a kerb, and how high. The two kerbs' lamps are staggered by half a gap. */
export const LAMP_GAP = 26
export const LAMP_HEIGHT = 7.2
/** How far in over the road from its kerb a lamp's head hangs. */
export const LAMP_REACH = 0.9

/**
 * The same numbers for a shader, so that what the lamps light — the road, a
 * wall, the roof of a car going under them — is lit from where the lamps are.
 */
export const STREET_GLSL = /* glsl */ `
  const float STREET_Z = ${STREET_Z.toFixed(2)};
  const float ROAD = ${ROAD.toFixed(2)};
  const float PAVEMENT = ${PAVEMENT.toFixed(2)};
  const float LAMP_GAP = ${LAMP_GAP.toFixed(2)};
  const float LAMP_HEIGHT = ${LAMP_HEIGHT.toFixed(2)};
  const float LAMP_REACH = ${LAMP_REACH.toFixed(2)};
`

/**
 * The lanes: two each way. The far pair comes towards the walk, the near pair
 * goes with it. `z` is the middle of the lane, `going` +1 along +x.
 */
export const LANES: readonly { z: number; going: 1 | -1 }[] = [
  { z: STREET_Z - 5.25, going: -1 },
  { z: STREET_Z - 1.75, going: -1 },
  { z: STREET_Z + 1.75, going: 1 },
  { z: STREET_Z + 5.25, going: 1 },
]

/**
 * Where the walk crosses the road, to the lit window on the other side: a
 * zebra crossing straight in front of that window, with a stop line a few
 * metres back from it either way.
 */
export const CROSSWALK = { x: 393.5, half: 3, stop: 2.2 } as const

/**
 * How far the traffic is held at the crossing, 0 to 1, at a point of the walk:
 * the lights are with whoever is walking, so they change as the walk comes up
 * to the kerb and change back once it is across.
 */
export function crossingHeld(progress: number): number {
  const ramp = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  return ramp(0.842, 0.856, progress) * (1 - ramp(0.935, 0.95, progress))
}

// ---------------------------------------------------------------- Tashkent

/**
 * The square across the road from the walk. Nothing is built on it but what
 * it is for; from the pavement opposite it is the one place the sky comes
 * down to the ground, which is why the tower is where it is.
 */
export const PLAZA = { x0: 302, x1: 388, front: FRONT_FAR, back: FRONT_FAR - 66 } as const

/**
 * The mosque at the back of the square, after the white one on the Anhor: a
 * marble hall with a tall portal towards the street, a turquoise dome on a
 * drum, a low arcaded wing either side and a minaret at each front corner.
 */
export const MOSQUE = {
  x: 345,
  z: -60,
  /** The step it all stands on. */
  step: 0.6,
  /** The hall: how wide (it is square), and how high its walls. */
  hall: 24,
  wall: 11,
  /** The portal: how wide, how high, and how far it stands out from the hall. */
  portal: { width: 10.4, height: 15.6, depth: 2.4 },
  /** The wings: how far each runs out from the hall, how deep, how high. */
  wing: { width: 11, depth: 14, height: 6.2 },
  /** The dome: the radius at its widest and its height, on a drum of this radius and height. */
  dome: { r: 8.6, height: 11, drum: 7.9, drumHeight: 4.2 },
  minaret: 31.4,
  minarets: [
    [329, -45.5],
    [361, -45.5],
  ],
} as const

export const FOUNTAIN = { x: 345, z: -30, r: 5.5 } as const

/**
 * Grass on the square, each bed behind a kerb with flowers along it: a strip
 * across the back and one down each side. Trees stand in the back one and in
 * the one the walk reaches first; the other is kept low, for the tower is
 * looked at over it.
 */
export const LAWNS = [
  { x0: PLAZA.x0 + 1.5, x1: PLAZA.x1 - 1.5, z0: PLAZA.back + 1.5, z1: PLAZA.back + 8 },
  { x0: PLAZA.x0 + 1.5, x1: PLAZA.x0 + 11, z0: PLAZA.back + 11, z1: PLAZA.front - 13 },
  { x0: PLAZA.x1 - 11, x1: PLAZA.x1 - 1.5, z0: PLAZA.back + 11, z1: PLAZA.front - 13 },
] as const
/**
 * The flag: its pole and how high. At the corner of the square the walk
 * reaches first, where from across the road it flies above the dome and not
 * in front of it.
 */
export const FLAG = { x: 305, z: -22.5, pole: 22, length: 6.6 } as const

/**
 * The television tower: three legs, a shaft with two pods on it and a mast,
 * 375 metres of it. Seven hundred metres off over the square, which is as far
 * as the plain goes before the ranges begin — and under where the sun goes
 * down, so that for the last of the daylight it stands in front of it.
 */
export const TV_TOWER = { x: 918, z: -306, height: 375 } as const

/**
 * From where on the near pavement the tower is looked at: between coming down
 * to it and the studio's building getting in the way. Nothing is built on the
 * lines from there to the tower.
 */
export const TOWER_SEEN_FROM = { x0: 262, x1: 312, z: 3.5 } as const

/** The hotel on the far side past the studio: a long slab bent a little towards the street, faced with a lattice. */
export const HOTEL = { x: 456, z: FRONT_FAR - 11, length: 60, height: 58, depth: 15, bend: 0.2 } as const

/** Where the cross streets are: gaps in the fronts. */
export const CROSSINGS = [331, 413, 492, 571] as const

// ------------------------------------------------------------------- trees

/** How far in from its kerb a street tree stands. */
export const TREE_INSET = 0.6
/** Where the near kerb's trees begin. */
export const NEAR_TREES_FROM = 320
/**
 * A plane tree's crown, in metres: how far it reaches along the street and
 * across it (the fronts are close, so it is narrower that way), how high its
 * underside is and how high its top, and how far it leans out over the road.
 */
export const TREE_CROWN = { along: 5.2, across: 3.5, from: 4.6, top: 16, lean: 0.5 } as const

/** Half the gap the fronts leave where a side street comes in. */
export const CROSSING_HALF = 7
/** Half the side of the square of earth left open round a trunk: short of the ariq beside it. */
export const TREE_PIT = 0.45
/** How much bigger or smaller than the pattern one tree is than the next. */
export const TREE_SCALE = { from: 0.9, to: 1.06 } as const

/**
 * People on the far pavement: how far in from its kerb each of them walks.
 * On the far side of the ariq from the trees, past the bus shelter, and far
 * enough from each other to pass.
 */
export const PASSER_LANES = [2.25, 2.7, 3.2, 3.65] as const

/**
 * A tree, as a place to stand one. `park` is a tree that is not on a kerb: it
 * has no road to lean out over and no fronts to keep clear of, so its crown is
 * as wide one way as the other.
 */
export interface TreeSpot {
  x: number
  z: number
  scale: number
  park?: boolean
}

/**
 * The square's own trees, on its lawns: at the two back corners, either side
 * of the mosque and never behind it, for its dome is seen against the sky; and
 * at the back of the lawn on the side the walk reaches first, where coming
 * down to the pavement it looks over the front of that lawn at the dome. The
 * lawn on the other side has none, because the tower is looked at over it.
 */
export const PARK_TREES: readonly (readonly [number, number])[] = [
  [307.5, PLAZA.back + 5.4],
  [316, PLAZA.back + 5.2],
  [374.5, PLAZA.back + 5.2],
  [383, PLAZA.back + 5.4],
  [308.2, PLAZA.front - 35],
  [308.2, PLAZA.front - 48],
]

/**
 * Every tree the city has: the two kerbs' rows, then the square's. `evoTrees.ts`
 * plants from this list and nothing else, and deals its patterns out in the
 * order of it — so anything added goes on the end.
 */
export function treeSpots(): TreeSpot[] {
  const size = (x: number, row: number) => TREE_SCALE.from + (TREE_SCALE.to - TREE_SCALE.from) * hash2(Math.round(x), 53 + row)
  return [
    ...treesAlong('far').map((x) => ({ x, z: STREET_Z - ROAD - TREE_INSET, scale: size(x, 0) })),
    ...treesAlong('near').map((x) => ({ x, z: STREET_Z + ROAD + TREE_INSET, scale: size(x, 1) })),
    ...PARK_TREES.map(([x, z]) => ({ x, z, scale: size(x * 3 + z, 2), park: true })),
  ]
}

/** A kerb's trees are this far apart, and the first of them this far along. */
const treeRow = (side: 'far' | 'near'): { gap: number; first: number } =>
  // The far kerb has a tree between every two lamps; the near one, which the
  // walk goes down a pace from, one in four.
  side === 'far' ? { gap: LAMP_GAP, first: LAMP_GAP / 2 } : { gap: LAMP_GAP * 2, first: LAMP_GAP }

/**
 * Whether a tree stands in a place of a kerb's row: never where the walk
 * crosses the road or a side street comes in, and on the far side not along
 * the front of the square, which is left open to be looked across — nor for
 * half a gap before it, where from the pavement opposite a crown would stand
 * in front of the flag and the mosque.
 */
export function treeStands(x: number, side: 'far' | 'near'): boolean {
  if (x < CITY_FROM + 6 || x >= CITY_UNTIL - 6) return false
  if (Math.abs(x - CROSSWALK.x) < CROSSWALK.half + 5) return false
  // Not in the mouth of a side street; on its corner is as near as one comes.
  if (CROSSINGS.some((c) => Math.abs(x - c) < CROSSING_HALF - 0.05)) return false
  if (side === 'far' && x > PLAZA.x0 - LAMP_GAP / 2 && x < PLAZA.x1 - 2) return false
  // And none on the near side until the walk is down on the pavement and has
  // looked across the square: the camera comes down through where the first
  // of them would be, and the next would stand in front of the tower.
  if (side === 'near' && x < NEAR_TREES_FROM) return false
  return true
}

/** Where the plane trees stand along a kerb: between the lamps, wherever `treeStands` lets one. */
export function treesAlong(side: 'far' | 'near'): number[] {
  const out: number[] = []
  const { gap, first } = treeRow(side)
  for (let x = Math.ceil((CITY_FROM + 6 - first) / gap) * gap + first; x < CITY_UNTIL - 6; x += gap) {
    if (treeStands(x, side)) out.push(x)
  }
  return out
}

/**
 * The lanterns of the square: two rows from the street to the mosque's door,
 * this far either side of the line between them — outside the fountain, and
 * inside the minarets.
 */
export const LANTERN_ROW = 10.5
export const LANTERNS: readonly (readonly [number, number])[] = [-1, 1].flatMap((side) =>
  [0, 1, 2, 3].map((i) => [MOSQUE.x + side * LANTERN_ROW, FRONT_FAR - 5.5 - i * 7.2] as const),
)
export const LANTERN_HEIGHT = 3.4

/**
 * The city's lamps, for anything that stands under them: what the street's
 * own throw on a surface, and what the lanterns of the square do. Needs
 * `STREET_GLSL` before it. Warm, and in the same measure the road is lit in.
 */
export const CITY_LIGHT_GLSL = /* glsl */ `
  // What falls on a surface at 'at', facing 'n', from the street's lamps: the
  // two nearest either way along each kerb. 'wrap' lets it round a little, for leaves.
  vec3 evoStreetLight(vec3 at, vec3 n, float wrap) {
    vec3 sum = vec3(0.0);
    float nearest = floor(at.x / LAMP_GAP + 0.5) * LAMP_GAP;
    for (int i = -1; i <= 1; i++) {
      float lx = nearest + float(i) * LAMP_GAP;
      vec3 a = vec3(lx, LAMP_HEIGHT, STREET_Z - ROAD + LAMP_REACH) - at;
      vec3 b = vec3(lx + LAMP_GAP * 0.5, LAMP_HEIGHT, STREET_Z + ROAD - LAMP_REACH) - at;
      sum += max((dot(n, normalize(a)) + wrap) / (1.0 + wrap), 0.0) / max(dot(a, a), 1.0);
      sum += max((dot(n, normalize(b)) + wrap) / (1.0 + wrap), 0.0) / max(dot(b, b), 1.0);
    }
    return vec3(1.0, 0.78, 0.5) * sum * 62.0;
  }
  vec3 evoLanternLight(vec3 at, vec3 n, float wrap) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      for (int s = -1; s <= 1; s += 2) {
        vec3 to = vec3(${MOSQUE.x.toFixed(1)} + float(s) * ${LANTERN_ROW.toFixed(1)}, ${LANTERN_HEIGHT.toFixed(1)}, ${(FRONT_FAR - 5.5).toFixed(2)} - float(i) * 7.2) - at;
        sum += max((dot(n, normalize(to)) + wrap) / (1.0 + wrap), 0.0) / max(dot(to, to), 0.6);
      }
    }
    return vec3(1.0, 0.86, 0.66) * sum * 16.0;
  }
`

// ------------------------------------------------------------- the bus stop

/**
 * Where the buses and the minibuses stop: a shelter on the far pavement,
 * between the far kerb's tree at 273 and its lamp at 286, and the length of
 * kerb in front of it that is kept clear for them to pull in to.
 */
export const BUS_STOP = { x: 279.5, half: 3.2, side: 'far', bay: 16 } as const

// ----------------------------------------------------------------- the ariq

/**
 * The ariq: the concrete channel the city's water runs along beside every
 * kerb, with the trees on its bank. Measured, like everything on a pavement,
 * out from its kerb: the channel's two inside faces, the concrete lip on top
 * of each, how far down the water is, and how thick a slab laid over it is.
 * Between the kerb and the ariq are the trees and the lamp posts; beyond it,
 * the pavement people walk on.
 */
export const ARIQ = { inner: 1.24, outer: 1.74, lip: 0.08, water: 0.3, slab: 0.14 } as const

/**
 * How wide a shop is along a front, and so where its door is: in the middle of
 * it. The one number for it: `evoFacade.ts` builds `SHOP` from it, and the
 * façade shader and the boards out over the doors are drawn from that.
 */
export const SHOP_WIDE = 6.4

/** A slab over the ariq: from where to where along it, on which kerb, and what crosses on it. */
export interface AriqSlab {
  x0: number
  x1: number
  side: 'far' | 'near'
  for: 'crossing' | 'stop' | 'door'
}

/** What a front needs to say for a slab to be laid to its doors: where it is, and whether it has shops. */
export interface FrontBlock {
  x: number
  z: number
  w: number
  d: number
  base: number
  yaw: number
  style: number
  shops: boolean
}

/** The façades that have shops on their ground floor: panels (when not lifted), brick and render. */
const SHOP_STYLES = [0, 1, 3]

/** Where the doors are along the fronts of a kerb: the middle of every whole shop. */
export function shopDoors(blocks: readonly FrontBlock[], side: 'far' | 'near'): number[] {
  const out: number[] = []
  for (const b of blocks) {
    if (!b.shops || Math.abs(b.yaw) > 1e-6 || !SHOP_STYLES.includes(b.style) || (b.style === 0 && b.base >= 0.5)) continue
    const face = side === 'far' ? b.z + b.d / 2 : b.z - b.d / 2
    if (Math.abs(face - (side === 'far' ? FRONT_FAR : FRONT_NEAR)) > 0.6) continue
    for (let k = 0; (k + 0.59) * SHOP_WIDE <= b.w; k++) out.push(b.x - b.w / 2 + (k + 0.5) * SHOP_WIDE)
  }
  return out.sort((a, b) => a - b)
}

/** The lamp posts of a kerb, along it. */
export function lampsAlong(side: 'far' | 'near'): number[] {
  const out: number[] = []
  for (let x = Math.ceil(CITY_FROM / LAMP_GAP) * LAMP_GAP; x < CITY_UNTIL; x += LAMP_GAP) out.push(side === 'far' ? x : x + LAMP_GAP / 2)
  return out
}

/**
 * Where slabs are laid over the ariq: the length of the crossing on both
 * kerbs, and a little way back along the near one, where the walk comes up
 * to it on the slant; the length of the bus stop, where the shelter stands
 * on them; and now and then at a shop's door — about one in three, and never
 * hard against a tree or a lamp post. `blocks` are the city's, from `towers()`.
 */
export function ariqSlabs(blocks: readonly FrontBlock[]): AriqSlab[] {
  const out: AriqSlab[] = [
    { x0: CROSSWALK.x - CROSSWALK.half - 4.5, x1: CROSSWALK.x + CROSSWALK.half + 1, side: 'near', for: 'crossing' },
    { x0: CROSSWALK.x - CROSSWALK.half - 1, x1: CROSSWALK.x + CROSSWALK.half + 1, side: 'far', for: 'crossing' },
    { x0: BUS_STOP.x - BUS_STOP.half - 0.3, x1: BUS_STOP.x + BUS_STOP.half + 0.3, side: 'far', for: 'stop' },
  ]
  for (const side of ['far', 'near'] as const) {
    const trunks = treesAlong(side)
    const posts = lampsAlong(side)
    for (const door of shopDoors(blocks, side)) {
      if (hash2(Math.round(door * 4), side === 'far' ? 211 : 223) > 0.36) continue
      const x0 = door - 0.75
      const x1 = door + 0.75
      if (trunks.some((t) => Math.abs(t - door) < 1.9) || posts.some((l) => Math.abs(l - door) < 1.4)) continue
      if (out.some((o) => o.side === side && x0 < o.x1 + 1.5 && x1 > o.x0 - 1.5)) continue
      out.push({ x0, x1, side, for: 'door' })
    }
  }
  return out
}

/** Which kerb a point on the ground is on the pavement of, and how far out from that kerb. */
export function pavementAt(z: number): { side: 'far' | 'near'; past: number } {
  const across = z - STREET_Z
  return { side: across < 0 ? 'far' : 'near', past: Math.abs(across) - ROAD }
}

/** Whether a point on the ground is over the ariq's open water, with no slab over it. */
export function inTheAriq(x: number, z: number, slabs: readonly AriqSlab[]): boolean {
  const { side, past } = pavementAt(z)
  if (past <= ARIQ.inner || past >= ARIQ.outer || x < PAVED_FROM || x > CITY_UNTIL + 20) return false
  return !slabs.some((s) => s.side === side && x >= s.x0 && x <= s.x1)
}

// -------------------------------------------------------- street furniture

/**
 * The bus shelter, on the slabs over the ariq at the stop: open to the road,
 * glass at the back and the ends, a roof that reaches out over the kerb and
 * a bench along the back. Its front and back as distances out from the kerb.
 */
export const SHELTER = { x: BUS_STOP.x, half: 2.9, front: 0.55, back: 1.92, height: 2.6 } as const

/** The metro: a pylon with an M on it, at the corner of the square nearest the crossing. */
export const METRO = { x: 384.2, z: FRONT_FAR - 2.6, height: 6.4, width: 1.1 } as const

/** Benches on the square, along its front and facing it: where, and which way their seats face (radians about y; 0 is +z). */
export const BENCHES: readonly { x: number; z: number; turn: number }[] = [316.5, 326.5, 363.5, 373.5].map((x) => ({ x, z: FRONT_FAR - 3.3, turn: Math.PI }))

/** Litter bins: by the bus stop, at the crossing, by the benches, and here and there in the near kerb's strip. */
export const BINS: readonly (readonly [number, number])[] = [
  [SHELTER.x + SHELTER.half + 1.2, STREET_Z - ROAD - 0.85],
  [CROSSWALK.x - CROSSWALK.half - 1.9, STREET_Z - ROAD - 0.85],
  [321.5, FRONT_FAR - 3.3],
  [368.5, FRONT_FAR - 3.3],
  [312, STREET_Z + ROAD + 0.85],
  [364, STREET_Z + ROAD + 0.85],
]

/**
 * A low fence down the middle of the road, the length of the street, with a
 * gap where the crossing is and a little either side of it.
 */
export const FENCE = {
  from: PAVED_FROM + 10,
  until: CITY_UNTIL + 14,
  gap: [CROSSWALK.x - CROSSWALK.half - CROSSWALK.stop - 1.2, CROSSWALK.x + CROSSWALK.half + CROSSWALK.stop + 1.2] as const,
  height: 0.92,
  post: 2.4,
} as const
