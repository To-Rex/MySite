import { describe, expect, it } from 'vitest'
import { beforeTheTower, towers, type Tower } from '@/components/three/evoCity'
import { PLACE, RANGE, rangeAt } from '@/components/three/evoLand'
import { cameraAt, skyAt, type Shot, type Sky } from '@/components/three/evoScript'
import { SIGN_GRID, SIGN_WORDS } from '@/components/three/evoSigns'
import {
  CROSSWALK,
  FLAG,
  FOUNTAIN,
  FRONT_FAR,
  FRONT_NEAR,
  HOTEL,
  LAMP_GAP,
  LANTERNS,
  MOSQUE,
  PLAZA,
  ROAD,
  STREET_Z,
  TOWER_SEEN_FROM,
  TREE_CROWN,
  TV_TOWER,
  crossingHeld,
  treeSpots,
} from '@/components/three/evoStreet'
import { FLOOD, HOTEL_NAME, SIGN, SIGNAL_POSTS, SURFACE, TOWER_PROFILE, buildTashkent } from '@/components/three/evoTashkent'

/**
 * The street the walk ends on is a street in Tashkent: a square across the
 * road with a mosque on it, the television tower over the square, a flag.
 * What is tested here is where those things are — that each can be seen from
 * where the walk looks at it, and that none of them is standing in another.
 */

const blocks = towers()
const steps = (from: number, to: number, n: number) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n)
const degrees = (radians: number) => (radians * 180) / Math.PI

/** Whether the level line from a to b passes through a block's footprint, grown by `margin`. */
function crosses(ax: number, az: number, bx: number, bz: number, block: Pick<Tower, 'x' | 'z' | 'w' | 'd'>, margin = 0): boolean {
  let t0 = 0
  let t1 = 1
  for (const [from, by, centre, size] of [
    [ax, bx - ax, block.x, block.w / 2 + margin],
    [az, bz - az, block.z, block.d / 2 + margin],
  ] as const) {
    if (Math.abs(by) < 1e-9) {
      if (Math.abs(from - centre) > size) return false
      continue
    }
    const a = (centre - size - from) / by
    const b = (centre + size - from) / by
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  return t0 < t1
}

/** The mosque as boxes on the ground: its hall, its portal, its two wings. */
function mosqueBoxes(): Pick<Tower, 'x' | 'z' | 'w' | 'd'>[] {
  const { x, z, hall, portal, wing } = MOSQUE
  const front = z + hall / 2
  return [
    { x, z, w: hall, d: hall },
    { x, z: front + portal.depth / 2, w: portal.width, d: portal.depth },
    ...[-1, 1].map((side) => ({ x: x + side * (hall / 2 + wing.width / 2), z: front - 2.4 - wing.depth / 2, w: wing.width, d: wing.depth })),
  ]
}

describe('the square', () => {
  it('is open ground on the far side of the road, with the fronts either side of it', () => {
    expect(PLAZA.front).toBe(FRONT_FAR)
    expect(PLAZA.back).toBeLessThan(PLAZA.front - 40)
    for (const b of blocks) {
      const inX = b.x + b.w / 2 > PLAZA.x0 && b.x - b.w / 2 < PLAZA.x1
      const inZ = b.z + b.d / 2 > PLAZA.back && b.z - b.d / 2 < PLAZA.front
      expect(inX && inZ, `a block at ${b.x},${b.z} on the square`).toBe(false)
    }
    // A front stands at each side of it: the square is a gap in a street, not the end of one.
    const fronts = blocks.filter((b) => b.z < STREET_Z && Math.abs(b.z + b.d / 2 - FRONT_FAR) < 0.01)
    expect(fronts.some((b) => b.x < PLAZA.x0 && b.x + b.w / 2 > PLAZA.x0 - 8)).toBe(true)
    expect(fronts.some((b) => b.x > PLAZA.x1 && b.x - b.w / 2 < PLAZA.x1 + 8)).toBe(true)
  })

  it('stands the mosque at the back of it, the fountain before its door and the lanterns up to it', () => {
    const { x, z, hall, portal, wing, minarets } = MOSQUE
    const front = z + hall / 2
    const reach = hall / 2 + wing.width + 3.2
    expect(x - reach).toBeGreaterThan(PLAZA.x0)
    expect(x + reach).toBeLessThan(PLAZA.x1)
    expect(z - hall / 2 - 4).toBeGreaterThan(PLAZA.back)
    // On the square's own middle line, facing the street.
    expect(Math.abs(x - (PLAZA.x0 + PLAZA.x1) / 2)).toBeLessThan(1)

    // A minaret either side of the portal, clear of it and of the hall.
    expect(minarets).toHaveLength(2)
    expect(minarets[0][0] + minarets[1][0]).toBeCloseTo(2 * x, 6)
    for (const [mx, mz] of minarets) {
      expect(Math.abs(mx - x)).toBeGreaterThan(hall / 2 + 2)
      expect(mz).toBeGreaterThan(front)
      expect(Math.abs(mx - x) - 2).toBeGreaterThan(portal.width / 2)
    }

    expect(FOUNTAIN.x).toBe(x)
    expect(FOUNTAIN.z - FOUNTAIN.r - 2).toBeGreaterThan(front + portal.depth)
    expect(FOUNTAIN.z + FOUNTAIN.r + 2).toBeLessThan(PLAZA.front)

    expect(LANTERNS).toHaveLength(8)
    for (const [lx, lz] of LANTERNS) {
      expect(lx).toBeGreaterThan(PLAZA.x0)
      expect(lx).toBeLessThan(PLAZA.x1)
      expect(lz).toBeLessThan(PLAZA.front)
      expect(lz).toBeGreaterThan(front + portal.depth - 1)
      expect(Math.hypot(lx - FOUNTAIN.x, lz - FOUNTAIN.z)).toBeGreaterThan(FOUNTAIN.r + 2)
      for (const [mx, mz] of minarets) expect(Math.hypot(lx - mx, lz - mz)).toBeGreaterThan(3.5)
      for (const box of mosqueBoxes()) expect(Math.abs(lx - box.x) > box.w / 2 + 1 || Math.abs(lz - box.z) > box.d / 2 + 1).toBe(true)
    }
  })

  it('flies the flag where, from across the road, it is over the dome and not in front of it', () => {
    expect(FLAG.x).toBeGreaterThan(PLAZA.x0 + 1)
    expect(FLAG.z).toBeLessThan(PLAZA.front - 2)
    // From the pavement opposite, at the point the walk looks across the square.
    const eye = { x: 285, y: 2.6, z: 3.5 }
    const bearing = (x: number, z: number) => degrees(Math.atan2(z - eye.z, x - eye.x))
    const rise = (x: number, y: number, z: number) => degrees(Math.atan2(y - eye.y, Math.hypot(x - eye.x, z - eye.z)))
    const dome = Math.hypot(MOSQUE.x - eye.x, MOSQUE.z - eye.z)
    const edge = bearing(MOSQUE.x, MOSQUE.z) - degrees(Math.asin(MOSQUE.dome.r / dome))
    // The pole goes up to the left of the dome...
    expect(bearing(FLAG.x, FLAG.z)).toBeLessThan(edge)
    // ...and the cloth is higher in the sky than the dome's own point.
    const top = MOSQUE.step + MOSQUE.wall + MOSQUE.dome.drumHeight + MOSQUE.dome.height + 2.9
    const cloth = FLAG.pole - 0.5 - FLAG.length / 2
    expect(rise(FLAG.x, cloth, FLAG.z)).toBeGreaterThan(rise(MOSQUE.x, top, MOSQUE.z) + 3)
  })
})

describe('the tower', () => {
  it('stands on the plain, a tower of 375 metres drawn from the ground to its tip', () => {
    // The ranges begin a little further out; a tower on a mountainside is not this one.
    expect(Math.hypot(TV_TOWER.x - RANGE.x, TV_TOWER.z - RANGE.z)).toBeLessThan(RANGE.foot)
    expect(rangeAt(TV_TOWER.x, TV_TOWER.z)).toBe(0)
    expect(TV_TOWER.height).toBe(375)
    const last = TOWER_PROFILE[TOWER_PROFILE.length - 1]!
    expect(last).toEqual([0, 375])
    expect(TOWER_PROFILE[0]![1]).toBeLessThan(0)
    for (const [i, [r, y]] of TOWER_PROFILE.entries()) {
      expect(r).toBeGreaterThanOrEqual(0)
      if (i > 0) expect(y).toBeGreaterThanOrEqual(TOWER_PROFILE[i - 1]![1])
    }
    // Two pods, each wider than the shaft under it.
    const widthAt = (height: number) => Math.max(...TOWER_PROFILE.filter(([, y]) => Math.abs(y - height) < 8).map(([r]) => r))
    expect(widthAt(105)).toBeGreaterThan(widthAt(80) * 1.5)
    expect(widthAt(217)).toBeGreaterThan(widthAt(190) * 1.3)
  })

  it('is under where the sun goes down', () => {
    const sky: Sky = { sx: 0, sy: 0, sz: 0, mx: 0, my: 0, mz: 0, elevation: 0, days: 0 }
    // The moment the sun is on the horizon, late in the walk.
    let dusk = 0.66
    for (const p of steps(0.64, 0.8, 320)) {
      if (skyAt(p, sky).elevation > 0) dusk = p
    }
    skyAt(dusk, sky)
    const sunset = degrees(Math.atan2(sky.sz, sky.sx))
    const from = (TOWER_SEEN_FROM.x0 + TOWER_SEEN_FROM.x1) / 2
    const tower = degrees(Math.atan2(TV_TOWER.z - TOWER_SEEN_FROM.z, TV_TOWER.x - from))
    expect(Math.abs(tower - sunset)).toBeLessThan(8)
  })

  it('is seen whole across the square: nothing stands on the line from the pavement to it', () => {
    for (const from of steps(TOWER_SEEN_FROM.x0, TOWER_SEEN_FROM.x1, 10)) {
      for (const b of blocks) {
        // The hotel's wings are turned a little: taken a little bigger than they are.
        const margin = b.part ? 3 : 0.5
        expect(crosses(from, TOWER_SEEN_FROM.z, TV_TOWER.x, TV_TOWER.z, b, margin), `the block at ${b.x},${b.z} from ${from}`).toBe(false)
      }
      for (const box of mosqueBoxes()) expect(crosses(from, TOWER_SEEN_FROM.z, TV_TOWER.x, TV_TOWER.z, box, 1)).toBe(false)
    }
    // And the rule that keeps it so says yes on the line and no well off it.
    const mid = { x: (TOWER_SEEN_FROM.x0 + TV_TOWER.x) / 2, z: (TOWER_SEEN_FROM.z + TV_TOWER.z) / 2 }
    expect(beforeTheTower(mid.x, mid.z, 5)).toBe(true)
    expect(beforeTheTower(mid.x, mid.z + 160, 5)).toBe(false)
    expect(beforeTheTower(TV_TOWER.x + 80, TV_TOWER.z - 40, 5)).toBe(false)
  })

  it('is looked at: the walk turns to it while it can be seen', () => {
    const shot: Shot = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 45 }
    let seen = 0
    for (const p of steps(0.66, 0.78, 60)) {
      cameraAt(p, shot)
      if (shot.x < TOWER_SEEN_FROM.x0 || shot.x > TOWER_SEEN_FROM.x1) continue
      const look = Math.atan2(shot.tz - shot.z, shot.tx - shot.x)
      const tower = Math.atan2(TV_TOWER.z - shot.z, TV_TOWER.x - shot.x)
      // Well inside a frame sixty degrees and more across.
      expect(Math.abs(degrees(tower - look)), `at ${p}`).toBeLessThan(24)
      // And all of it: the tip is under the top of the frame.
      const tip = degrees(Math.atan2(TV_TOWER.height - shot.y, Math.hypot(TV_TOWER.x - shot.x, TV_TOWER.z - shot.z)))
      const pitch = degrees(Math.atan2(shot.ty - shot.y, Math.hypot(shot.tx - shot.x, shot.tz - shot.z)))
      if (p > 0.7) expect(tip, `at ${p}`).toBeLessThan(pitch + shot.fov / 2)
      seen++
    }
    expect(seen).toBeGreaterThan(30)
  })
})

describe('what stands still', () => {
  const mass = buildTashkent()
  const count = mass.position.length / 3

  it('is one sound mesh, small enough to be nothing next to the street', () => {
    expect(count).toBeGreaterThan(2000)
    expect(mass.index.length / 3).toBeLessThan(14000)
    expect(mass.normal).toHaveLength(count * 3)
    expect(mass.surface).toHaveLength(count * 4)
    expect(mass.dim).toHaveLength(count * 3)
    expect(mass.tint).toHaveLength(count * 3)
    expect(mass.grow).toHaveLength(count * 4)
    for (const list of [mass.position, mass.normal, mass.surface, mass.dim, mass.tint, mass.grow]) {
      expect(list.every(Number.isFinite)).toBe(true)
    }
    expect(mass.index.every((i) => Number.isInteger(i) && i >= 0 && i < count)).toBe(true)
    const kinds = new Set<number>(Object.values(SURFACE))
    const floods = new Set<number>(Object.values(FLOOD))
    let short = 0
    for (let i = 0; i < count; i++) {
      if (!kinds.has(mass.surface[i * 4]!)) short++
      if (!floods.has(mass.dim[i * 3 + 2]!)) short++
      if (Math.abs(Math.hypot(mass.normal[i * 3]!, mass.normal[i * 3 + 1]!, mass.normal[i * 3 + 2]!) - 1) > 1e-3) short++
    }
    expect(short).toBe(0)
  })

  it('faces every surface outwards', () => {
    const { position, normal, index } = mass
    let inward = 0
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t]! * 3, index[t + 1]! * 3, index[t + 2]! * 3]
      const ux = position[b]! - position[a]!
      const uy = position[b + 1]! - position[a + 1]!
      const uz = position[b + 2]! - position[a + 2]!
      const vx = position[c]! - position[a]!
      const vy = position[c + 1]! - position[a + 1]!
      const vz = position[c + 2]! - position[a + 2]!
      const nx = uy * vz - uz * vy
      const ny = uz * vx - ux * vz
      const nz = ux * vy - uy * vx
      // A triangle at the tip of something turned has no area and faces nowhere.
      if (Math.hypot(nx, ny, nz) < 1e-7) continue
      const along = nx * (normal[a]! + normal[b]! + normal[c]!) + ny * (normal[a + 1]! + normal[b + 1]! + normal[c + 1]!) + nz * (normal[a + 2]! + normal[b + 2]! + normal[c + 2]!)
      if (along <= 0) inward++
    }
    expect(inward).toBe(0)
  })

  it('has everything up by the time the city is, and nothing below the ground it rises from', () => {
    let wrong = 0
    for (let i = 0; i < count; i++) {
      const base = mass.grow[i * 4]!
      const height = mass.grow[i * 4 + 1]!
      const delay = mass.grow[i * 4 + 2]!
      const span = mass.grow[i * 4 + 3]!
      if (delay < 0.4 || span <= 0 || delay + span > 1) wrong++
      // Sunk by its whole height before it rises, it is all under the ground.
      if (mass.position[i * 3 + 1]! - height > base + 1e-6) wrong++
      // (The tower's legs lean, so the rim of each foot is a little under the ground it stands on.)
      const sunk = mass.dim[i * 3 + 2] === FLOOD.tower ? 2 : 1e-6
      if (mass.position[i * 3 + 1]! < base - sunk) wrong++
    }
    expect(wrong).toBe(0)
  })

  it('keeps each thing where it belongs: the mosque on the square, the tower on its own ground', () => {
    let highest = -Infinity
    let stray = 0
    for (let i = 0; i < count; i++) {
      const x = mass.position[i * 3]!
      const y = mass.position[i * 3 + 1]!
      const z = mass.position[i * 3 + 2]!
      const flood = mass.dim[i * 3 + 2]!
      if (flood === FLOOD.mosque) {
        if (x < PLAZA.x0 || x > PLAZA.x1 || z < PLAZA.back || z > PLAZA.front) stray++
        if (y > MOSQUE.minaret + 2) stray++
      } else if (flood === FLOOD.tower) {
        if (Math.hypot(x - TV_TOWER.x, z - TV_TOWER.z) > 50) stray++
        highest = Math.max(highest, y)
      }
    }
    expect(stray).toBe(0)
    expect(highest).toBeGreaterThanOrEqual(TV_TOWER.height)
    expect(highest).toBeLessThan(TV_TOWER.height + 3)
  })
})

describe('the trees', () => {
  const trees = treeSpots()

  it('stand none of them between the walk and what it turns to look at', () => {
    const shot: Shot = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 45 }
    const sights = [
      { name: 'the flag', x: FLAG.x + 0.12 + FLAG.length / 2, y: FLAG.pole - 0.5 - FLAG.length / 4, z: FLAG.z },
      { name: 'the dome', x: MOSQUE.x, y: MOSQUE.step + MOSQUE.wall + MOSQUE.dome.drumHeight + MOSQUE.dome.height * 0.45, z: MOSQUE.z },
      { name: 'the portal', x: MOSQUE.x, y: MOSQUE.portal.height * 0.6, z: MOSQUE.z + MOSQUE.hall / 2 + MOSQUE.portal.depth },
      ...MOSQUE.minarets.map(([x, z], i) => ({ name: `minaret ${i}`, x, y: MOSQUE.minaret - 5, z })),
      { name: 'the tower', x: TV_TOWER.x, y: 105, z: TV_TOWER.z },
    ]
    let looked = 0
    for (const p of steps(0.66, 0.79, 52)) {
      cameraAt(p, shot)
      for (const sight of sights) {
        // The tower for as long as it is looked at; after that the walk goes
        // under a tree of its own kerb, and loses it behind the crown as it does.
        if (sight.name === 'the tower' && (shot.x < TOWER_SEEN_FROM.x0 - 2 || shot.x > TOWER_SEEN_FROM.x1)) continue
        const dx = sight.x - shot.x
        const dz = sight.z - shot.z
        const across = Math.hypot(dx, dz)
        for (const tree of trees) {
          // The crown as a drum: as wide as it reaches (and its lean), as high as it stands.
          const r = TREE_CROWN.along * tree.scale + (tree.park ? 0 : TREE_CROWN.lean)
          const t = ((tree.x - shot.x) * dx + (tree.z - shot.z) * dz) / (across * across)
          const off = Math.abs((tree.x - shot.x) * dz - (tree.z - shot.z) * dx) / across
          if (off >= r) continue
          const half = Math.sqrt(r * r - off * off) / across
          const t0 = Math.max(0, t - half)
          const t1 = Math.min(1, t + half)
          if (t0 >= t1) continue
          // Where the line is through the drum, from the eye up or down to what it looks at.
          const y0 = shot.y + (sight.y - shot.y) * t0
          const y1 = shot.y + (sight.y - shot.y) * t1
          const under = Math.min(y0, y1) > TREE_CROWN.top * tree.scale
          const over = Math.max(y0, y1) < TREE_CROWN.from * tree.scale
          expect(under || over, `the tree at ${tree.x},${tree.z} in front of ${sight.name} at ${p}`).toBe(true)
        }
        looked++
      }
    }
    expect(looked).toBeGreaterThan(200)
  })

  it('keeps the square\'s own clear of everything else on it', () => {
    const park = trees.filter((tree) => tree.park)
    expect(park.length).toBeGreaterThan(4)
    for (const tree of park) {
      const r = TREE_CROWN.along * tree.scale
      for (const box of mosqueBoxes()) {
        // The mosque's steps reach three metres out from its walls all round.
        expect(Math.abs(tree.x - box.x) > box.w / 2 + 3 + r || Math.abs(tree.z - box.z) > box.d / 2 + 3 + r, `in the mosque at ${tree.x},${tree.z}`).toBe(true)
      }
      for (const [mx, mz] of MOSQUE.minarets) expect(Math.hypot(tree.x - mx, tree.z - mz)).toBeGreaterThan(r + 2)
      for (const [lx, lz] of LANTERNS) expect(Math.hypot(tree.x - lx, tree.z - lz)).toBeGreaterThan(r)
      expect(Math.hypot(tree.x - FOUNTAIN.x, tree.z - FOUNTAIN.z)).toBeGreaterThan(FOUNTAIN.r + r + 2)
      expect(Math.hypot(tree.x - FLAG.x, tree.z - FLAG.z)).toBeGreaterThan(r + 2)
    }
  })
})

describe('the crossing', () => {
  it('is straight in front of the lit window, and the walk goes over on it', () => {
    expect(Math.abs(CROSSWALK.x - PLACE.studio.x)).toBeLessThan(CROSSWALK.half + 0.6)
    const shot: Shot = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 45 }
    let onTheRoad = 0
    for (const p of steps(0.84, 0.97, 260)) {
      cameraAt(p, shot)
      if (Math.abs(shot.z - STREET_Z) > ROAD - 0.2) continue
      onTheRoad++
      expect(Math.abs(shot.x - CROSSWALK.x), `off the crossing at ${p}`).toBeLessThan(CROSSWALK.half)
      // And the traffic is held for as long as it is out there.
      expect(crossingHeld(p), `not held at ${p}`).toBeGreaterThan(0.97)
    }
    expect(onTheRoad).toBeGreaterThan(20)
  })

  it('hangs its lights on lamp posts that are there', () => {
    const { far, near } = SIGNAL_POSTS
    expect(far.x % LAMP_GAP).toBe(0)
    expect((near.x - LAMP_GAP / 2) % LAMP_GAP).toBe(0)
    expect(far.z).toBeLessThan(STREET_Z - ROAD)
    expect(near.z).toBeGreaterThan(STREET_Z + ROAD)
    // One before the crossing and one past it, each on the right of the traffic it is for.
    expect(far.x).toBeLessThan(CROSSWALK.x - CROSSWALK.half + 0.01)
    expect(far.x).toBeGreaterThan(CROSSWALK.x - CROSSWALK.half - 4)
    expect(near.x).toBeGreaterThan(CROSSWALK.x + CROSSWALK.half)
    expect(near.x).toBeLessThan(CROSSWALK.x + CROSSWALK.half + 10)
  })
})

describe('the walk through it', () => {
  it('never takes the camera through a wall', () => {
    const shot: Shot = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 45 }
    for (const p of steps(0.5, 1, 500)) {
      cameraAt(p, shot)
      for (const b of blocks) {
        const inside = Math.abs(shot.x - b.x) < b.w / 2 + 0.3 && Math.abs(shot.z - b.z) < b.d / 2 + 0.3 && shot.y > b.base - 0.2 && shot.y < b.h
        expect(inside, `inside the block at ${b.x},${b.z} at ${p}`).toBe(false)
      }
      // It keeps to its own side of the road until the crossing.
      if (p > 0.67 && p < 0.86) {
        expect(shot.z).toBeGreaterThan(STREET_Z + ROAD + 0.5)
        expect(shot.z).toBeLessThan(FRONT_NEAR - 0.8)
      }
    }
  })
})

describe('the words on it', () => {
  it('names the shops for what they sell, each once, and the hotel for the country', () => {
    expect(SIGN_WORDS).toHaveLength(SIGN_GRID.columns * SIGN_GRID.rows)
    expect(new Set(SIGN_WORDS).size).toBe(SIGN_WORDS.length)
    for (const word of SIGN_WORDS) {
      expect(word).toBe(word.toUpperCase())
      expect(word).toMatch(/^[A-ZʻʼʻA-Z -]+$/u)
    }
    expect(HOTEL_NAME).toBe('OʻZBEKISTON')
    // It is on the end of the roof the walk comes towards, and faces down the street at it.
    expect(SIGN.x).toBeLessThan(HOTEL.x - HOTEL.length / 2 + 2)
    expect(Math.sin(SIGN.turn)).toBeLessThan(-0.9)
    expect(Math.cos(SIGN.turn)).toBeGreaterThan(0)
    expect(SIGN.width).toBeLessThan(HOTEL.depth)
    // The hotel is on the far side, past the studio, and is the tallest thing on the street.
    expect(HOTEL.x - HOTEL.length / 2).toBeGreaterThan(PLACE.studio.x + 10)
    const street = blocks.filter((b) => !b.part && Math.abs(Math.abs(b.z - STREET_Z) - b.d / 2 - (ROAD + 4.2)) < 0.01)
    expect(street.length).toBeGreaterThan(20)
    for (const b of street) expect(b.h).toBeLessThan(HOTEL.height)
  })
})
