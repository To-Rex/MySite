import { describe, expect, it } from 'vitest'
import {
  ARIQ,
  CITY_FROM,
  CITY_UNTIL,
  CROSSINGS,
  CROSSING_HALF,
  CROSSWALK,
  FRONT_FAR,
  FRONT_NEAR,
  LAMP_GAP,
  LAWNS,
  NEAR_TREES_FROM,
  PARK_TREES,
  PASSER_LANES,
  PAVEMENT,
  PLAZA,
  ROAD,
  STREET_Z,
  TREE_CROWN,
  TREE_INSET,
  TREE_PIT,
  TREE_SCALE,
  treeSpots,
  treeStands,
  treesAlong,
} from '@/components/three/evoStreet'
import { KERB_SQUASH, TREE_CARDS, TREE_GROWS, TREE_PATTERNS, growTree, treeAt, trianglesIn, type TreeMesh } from '@/components/three/evoTrees'
import { WALK_QUALITY } from '@/components/three/evoWalk'

/**
 * The street's plane trees: where they stand, and what one is made of.
 *
 * The patterns are grown here, once, outside any test: growing one is a few
 * thousand cards placed and checked against each other, and a test has five
 * seconds on a machine that may be doing a good deal else.
 */

const far = treesAlong('far')
const near = treesAlong('near')
const spots = treeSpots()
const kerb = spots.filter((spot) => !spot.park)
const park = spots.filter((spot) => spot.park)
const full = TREE_PATTERNS.map((pattern) => growTree(pattern, 1))
const thin = TREE_PATTERNS.map((pattern) => growTree(pattern, WALK_QUALITY.low.leaves))

/** Every corner of every leaf card of a pattern: as it is in the open, and with the crown pressed narrow for a kerb. */
function cardCorners(mesh: TreeMesh): { open: [number, number, number][]; kerb: [number, number, number][] } {
  const { positions, across, up, corners, cards } = mesh.crown
  const open: [number, number, number][] = []
  const kerb: [number, number, number][] = []
  for (let i = 0; i < cards.length / 4; i++) {
    if (cards[i * 4 + 2]! < 0.5) continue
    const a = corners[i * 2]!
    const b = corners[i * 2 + 1]!
    const off = [0, 1, 2].map((k) => across[i * 3 + k]! * a + up[i * 3 + k]! * b)
    open.push([positions[i * 3]! + off[0]!, positions[i * 3 + 1]! + off[1]!, positions[i * 3 + 2]! + off[2]!])
    // The card is moved in with the crown but is no smaller: what the shader does.
    kerb.push([positions[i * 3]! + off[0]!, positions[i * 3 + 1]! + off[1]!, positions[i * 3 + 2]! * KERB_SQUASH + off[2]!])
  }
  return { open, kerb }
}

/** How many of a pattern's cards have next to nothing near them. */
function cardsAlone(mesh: TreeMesh): number {
  const centres: [number, number, number][] = []
  for (let i = 0; i < mesh.leaves; i++) centres.push([mesh.crown.positions[i * 12]!, mesh.crown.positions[i * 12 + 1]!, mesh.crown.positions[i * 12 + 2]!])
  let alone = 0
  for (const a of centres) {
    let company = 0
    for (const b of centres) if (a !== b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1.5 && ++company >= 2) break
    if (company < 2) alone++
  }
  return alone
}

const corners = full.map(cardCorners)
const alone = full.map(cardsAlone)
const thinCorners = thin.map(cardCorners)
const extent = (points: [number, number, number][], axis: 0 | 1 | 2): [number, number] => {
  let low = Infinity
  let high = -Infinity
  for (const p of points) {
    low = Math.min(low, p[axis])
    high = Math.max(high, p[axis])
  }
  return [low, high]
}

describe('where the trees stand', () => {
  it('is between the lamps of their own kerb, with room for a crown', () => {
    // The far kerb's lamps are on the gap, the near kerb's half a gap along.
    const nearestLamp = (x: number, offset: number) => {
      const along = (((x - offset) % LAMP_GAP) + LAMP_GAP) % LAMP_GAP
      return Math.min(along, LAMP_GAP - along)
    }
    for (const x of far) expect(nearestLamp(x, 0), `far ${x}`).toBeGreaterThanOrEqual(6)
    for (const x of near) expect(nearestLamp(x, LAMP_GAP / 2), `near ${x}`).toBeGreaterThanOrEqual(6)
    // And the biggest crown stops well short of the lamp either side of it.
    expect(LAMP_GAP / 2 - TREE_CROWN.along * TREE_SCALE.to).toBeGreaterThanOrEqual(6)
  })

  it('is never where the walk crosses, in the mouth of a side street, or along the front of the square', () => {
    expect(far.length).toBeGreaterThan(5)
    expect(near.length).toBeGreaterThan(1)
    for (const x of [...far, ...near]) {
      expect(x).toBeGreaterThanOrEqual(CITY_FROM + 6)
      expect(x).toBeLessThan(CITY_UNTIL - 6)
      expect(Math.abs(x - CROSSWALK.x), `crossing at ${x}`).toBeGreaterThanOrEqual(CROSSWALK.half + 5)
      for (const c of CROSSINGS) expect(Math.abs(x - c), `side street at ${x}`).toBeGreaterThan(CROSSING_HALF - 0.1)
    }
    for (const x of far) expect(x <= PLAZA.x0 - LAMP_GAP / 2 || x >= PLAZA.x1 - 2, `square at ${x}`).toBe(true)
  })

  it('leaves the near kerb bare until the walk is down on it, and then has one to walk under', () => {
    for (const x of near) expect(x).toBeGreaterThanOrEqual(NEAR_TREES_FROM)
    expect(treeStands(NEAR_TREES_FROM - LAMP_GAP, 'near')).toBe(false)
    // One before the crossing: the only tree the camera comes close to.
    expect(near.some((x) => x < CROSSWALK.x - 20)).toBe(true)
  })

  it('lists them as spots, one row to a kerb and then the square', () => {
    expect(kerb).toHaveLength(far.length + near.length)
    // The kerbs first: the patterns are dealt out in this order.
    expect(spots.slice(0, kerb.length)).toEqual(kerb)
    expect(park).toHaveLength(PARK_TREES.length)
    for (const spot of park) {
      expect(spot.scale).toBeGreaterThanOrEqual(TREE_SCALE.from)
      expect(spot.scale).toBeLessThanOrEqual(TREE_SCALE.to)
      // On a lawn, with its whole crown over the square.
      const lawn = LAWNS.find((l) => spot.x > l.x0 && spot.x < l.x1 && spot.z > l.z0 && spot.z < l.z1)
      expect(lawn, `no lawn under ${spot.x},${spot.z}`).toBeDefined()
      const reach = TREE_CROWN.along * spot.scale
      expect(spot.x - reach).toBeGreaterThan(PLAZA.x0 - 0.5)
      expect(spot.x + reach).toBeLessThan(PLAZA.x1 + 0.5)
      expect(spot.z - reach).toBeGreaterThan(PLAZA.back - 0.5)
    }
    for (const spot of kerb) {
      expect(Number.isFinite(spot.x) && Number.isFinite(spot.z) && Number.isFinite(spot.scale)).toBe(true)
      expect(spot.scale).toBeGreaterThanOrEqual(TREE_SCALE.from)
      expect(spot.scale).toBeLessThanOrEqual(TREE_SCALE.to)
      expect(Math.abs(Math.abs(spot.z - STREET_Z) - (ROAD + TREE_INSET))).toBeLessThan(1e-9)
      expect(spot.park).toBeFalsy()
    }
    // Not all of a size.
    expect(new Set(spots.map((spot) => spot.scale.toFixed(3))).size).toBeGreaterThan(spots.length / 2)
  })

  it('keeps every crown clear of the fronts', () => {
    for (const spot of kerb) {
      const road = spot.z < STREET_Z ? 1 : -1
      // The crown leans out over the road, so the side towards the front is the short one.
      const back = spot.z + road * TREE_CROWN.lean * spot.scale - road * TREE_CROWN.across * spot.scale
      if (road > 0) expect(back, `far ${spot.x}`).toBeGreaterThan(FRONT_FAR + 0.25)
      else expect(back, `near ${spot.x}`).toBeLessThan(FRONT_NEAR - 0.25)
    }
  })

  it('leaves the people on the pavement room to pass', () => {
    const lanes = [...PASSER_LANES].sort((a, b) => a - b)
    // Past the square of earth and the ariq beyond it; and short of the shop fronts.
    expect(lanes[0]!).toBeGreaterThanOrEqual(TREE_INSET + TREE_PIT + 0.25)
    expect(lanes[0]!).toBeGreaterThanOrEqual(ARIQ.outer + ARIQ.lip + 0.25)
    expect(lanes[lanes.length - 1]!).toBeLessThanOrEqual(PAVEMENT - 0.5)
    // A shoulder's width apart, at least.
    for (let i = 1; i < lanes.length; i++) expect(lanes[i]! - lanes[i - 1]!).toBeGreaterThanOrEqual(0.44)
  })

  it('brings each of them up in its own time, and all of them before the city is built', () => {
    const starts = spots.map((spot, index) => treeAt(spot, index))
    for (const tree of starts) {
      expect(tree.delay).toBeGreaterThanOrEqual(TREE_GROWS.from)
      expect(tree.delay + TREE_GROWS.takes).toBeLessThanOrEqual(0.975)
      expect(tree.pattern).toBeGreaterThanOrEqual(0)
      expect(tree.pattern).toBeLessThan(TREE_PATTERNS.length)
      expect(tree.yaw).toBeGreaterThanOrEqual(0)
      expect(tree.yaw).toBeLessThan(Math.PI * 2)
    }
    expect(new Set(starts.map((tree) => tree.delay.toFixed(4))).size).toBe(spots.length)
    // Dealt out in turn: every pattern is used, and no tree stands next to its double.
    expect(new Set(starts.map((tree) => tree.pattern)).size).toBe(TREE_PATTERNS.length)
    for (let i = 1; i < far.length; i++) expect(starts[i]!.pattern).not.toBe(starts[i - 1]!.pattern)
    // The same every visit.
    expect(treeAt(spots[0]!, 0)).toEqual(starts[0])
  })
})

describe('a plane tree', () => {
  it('is all numbers, and indexed inside itself', () => {
    for (const mesh of [...full, ...thin]) {
      for (const list of [mesh.wood.positions, mesh.wood.normals, mesh.crown.positions, mesh.crown.normals, mesh.crown.across, mesh.crown.up, mesh.crown.cards]) {
        expect(list.every(Number.isFinite)).toBe(true)
      }
      expect(Math.max(...mesh.wood.indices)).toBeLessThan(mesh.wood.positions.length / 3)
      expect(Math.max(...mesh.crown.indices)).toBeLessThan(mesh.crown.positions.length / 3)
      expect(mesh.wood.indices.length % 3).toBe(0)
      expect(mesh.crown.indices.length % 3).toBe(0)
    }
  })

  it('has a stout trunk that stands on the ground and forks under its crown', () => {
    full.forEach((mesh, index) => {
      const { positions } = mesh.wood
      let low = Infinity
      let high = -Infinity
      let girth = 0
      for (let i = 0; i < positions.length; i += 3) {
        const y = positions[i + 1]!
        low = Math.min(low, y)
        high = Math.max(high, y)
        // The ring at breast height, give or take: how far from the axis it gets.
        if (Math.abs(y - 0.9) < 0.02) girth = Math.max(girth, Math.hypot(positions[i]!, positions[i + 2]!))
      }
      expect(low, `pattern ${index}`).toBeGreaterThan(-0.05)
      expect(low).toBeLessThan(0.05)
      expect(high).toBeLessThan(TREE_CROWN.top)
      expect(high).toBeGreaterThan(TREE_CROWN.top * 0.7)
      // Half a metre to seventy centimetres across, above the spread of its foot.
      expect(girth * 2).toBeGreaterThan(0.5)
      expect(girth * 2).toBeLessThan(0.78)
      expect(mesh.fork).toBeGreaterThanOrEqual(3.5)
      expect(mesh.fork).toBeLessThanOrEqual(4.5)
      expect(mesh.fork).toBeLessThan(TREE_CROWN.from)
    })
  })

  it('keeps every leaf inside the room a crown has, in the open and on a kerb', () => {
    for (const set of [...corners, ...thinCorners]) {
      const [x0, x1] = extent(set.open, 0)
      const [y0, y1] = extent(set.open, 1)
      const [z0, z1] = extent(set.open, 2)
      expect(Math.max(-x0, x1)).toBeLessThanOrEqual(TREE_CROWN.along + 0.02)
      expect(Math.max(-z0, z1)).toBeLessThanOrEqual(TREE_CROWN.along + 0.02)
      expect(y0).toBeGreaterThan(TREE_CROWN.from - 0.5)
      expect(y1).toBeLessThanOrEqual(TREE_CROWN.top + 0.02)
      // Pressed narrow, it is no wider across the street than the street has room for.
      const [k0, k1] = extent(set.kerb, 2)
      expect(Math.max(-k0, k1)).toBeLessThanOrEqual(TREE_CROWN.across + 0.02)
      // And it fills that room: a crown, not a ball in the middle of one.
      expect(Math.max(-x0, x1)).toBeGreaterThan(TREE_CROWN.along * 0.85)
      expect(y1).toBeGreaterThan(TREE_CROWN.top - 1.2)
    }
  })

  it('has fewer and bigger cards where there is less to draw them with', () => {
    full.forEach((mesh, index) => {
      const less = thin[index]!
      expect(mesh.leaves).toBe(TREE_CARDS)
      expect(less.leaves).toBe(Math.round(TREE_CARDS * WALK_QUALITY.low.leaves))
      const side = (tree: TreeMesh) => {
        let sum = 0
        for (let i = 0; i < tree.leaves; i++) sum += Math.hypot(tree.crown.across[i * 12]!, tree.crown.across[i * 12 + 1]!, tree.crown.across[i * 12 + 2]!)
        return sum / tree.leaves
      }
      expect(side(less)).toBeGreaterThan(side(mesh) * 1.25)
      // The wood and the mass inside are the same tree either way.
      expect(less.wood.indices.length).toBe(mesh.wood.indices.length)
    })
  })

  it('leaves no card hanging by itself', () => {
    alone.forEach((count, index) => expect(count, `pattern ${index}`).toBe(0))
  })

  it('is cheap enough for a street of them', () => {
    const count = (meshes: TreeMesh[]) => spots.reduce((sum, spot, index) => sum + trianglesIn(meshes[treeAt(spot, index).pattern]!), 0)
    // The street's and the square's together: the square's are only ever seen
    // from across the road, small, and cost their triangles and little else.
    expect(count(full)).toBeLessThan(100_000)
    expect(count(thin)).toBeLessThan(count(full) * 0.7)
  })

  it('is the same tree every time it is grown', () => {
    const again = growTree(TREE_PATTERNS[0]!, 1)
    expect(Array.from(again.crown.positions.slice(0, 300))).toEqual(Array.from(full[0]!.crown.positions.slice(0, 300)))
    expect(Array.from(again.wood.positions.slice(0, 300))).toEqual(Array.from(full[0]!.wood.positions.slice(0, 300)))
  })
})
