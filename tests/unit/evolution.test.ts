import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { ERAS, ERA_FROM, captionAt, eraAt, eraUntil, getEvolution, resetEvolution, setEvolution, walkProgress, walkScreens, walkScrollFor } from '@/lib/evolution'
import { buildSkeleton } from '@/components/three/creatureRig'
import { STUDIO, towers } from '@/components/three/evoCity'
import { createFigure } from '@/components/three/evoFigures'
import { LAND, PLACE, RANGE, buildLand, caveFootprint, grassAt, groundAt, landAt, rangeAt } from '@/components/three/evoLand'
import { BEAST_GAITS, GAITS, applyBeast, applyPose, beastGaitPose, createBeastPose, createPose, deskPose, gaitPose, measure, sitPose, standPose } from '@/components/three/evoRig'
import {
  CAST,
  HEADROOM,
  HERD,
  HUNTERS,
  HUNT_ROUTE,
  MOODS,
  along,
  cameraAt,
  herdAt,
  hunterAt,
  lampsAt,
  lensFor,
  moodAt,
  skyAt,
  stageAt,
  track,
  type Beast,
  type Shot,
  type Sky,
  type Stage,
  type Walker,
} from '@/components/three/evoScript'
import { SCREEN } from '@/components/three/evoStudio'
import { components, edgeUse, openEdges } from './mesh'

/**
 * The long walk: the pinned scene after the hero that the scroll runs from a
 * cave to a screen. Nearly all of it is a function of one number, which is what
 * makes it testable without a renderer — the camera can be walked the whole
 * way, the sun watched round the sky and the hunters followed to the water,
 * here, in milliseconds.
 */

const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n)

describe('the walk on the page', () => {
  it('gives every point of it to exactly one era, in order', () => {
    expect(eraAt(0)).toBe('fire')
    expect(eraAt(1)).toBe('now')
    expect(eraAt(-3)).toBe('fire')
    let last = 0
    for (const p of steps(400)) {
      const index = ERAS.indexOf(eraAt(p))
      expect(index).toBeGreaterThanOrEqual(last)
      last = index
    }
    for (const era of ERAS) {
      expect(eraAt(ERA_FROM[era])).toBe(era)
      expect(eraUntil(era)).toBeGreaterThan(ERA_FROM[era])
    }
  })

  it('shows each caption in full and never two at once', () => {
    for (const era of ERAS) expect(Math.max(...steps(600).map((p) => captionAt(era, p)))).toBe(1)
    for (const p of steps(600)) {
      const up = ERAS.filter((era) => captionAt(era, p) > 0.05)
      expect(up.length, `at ${p}`).toBeLessThanOrEqual(1)
      if (up[0]) expect(up[0]).toBe(eraAt(p))
    }
    // The last one is gone before the scene is, so the page is not handed a line of someone else's text.
    expect(captionAt('now', 0.995)).toBe(0)
  })

  it('measures progress from the wrapper, and can be asked the other way', () => {
    expect(walkProgress(100, 9000, 900)).toBe(0)
    expect(walkProgress(0, 9000, 900)).toBe(0)
    expect(walkProgress(-4050, 9000, 900)).toBe(0.5)
    expect(walkProgress(-9000, 9000, 900)).toBe(1)
    // A wrapper no taller than the window has nowhere to walk.
    expect(walkProgress(-50, 900, 900)).toBe(0)
    expect(walkProgress(Number.NaN, 9000, 900)).toBe(0)
    for (const p of [0, 0.2, 0.55, 1]) {
      const y = walkScrollFor(p, 1234, 9000, 900)
      expect(walkProgress(1234 - y, 9000, 900)).toBeCloseTo(p, 10)
    }
    expect(walkScreens(true)).toBeLessThan(walkScreens(false))
  })

  it('tells the page only when something has changed, and stays built once it is', () => {
    resetEvolution()
    let told = 0
    const stop = (() => {
      const listener = () => told++
      // The store's subscribe is what React uses; a change of state is observable through the snapshot.
      const before = getEvolution()
      setEvolution({ onScreen: true })
      expect(getEvolution()).not.toBe(before)
      const same = getEvolution()
      setEvolution({ onScreen: true })
      expect(getEvolution()).toBe(same)
      return listener
    })()
    void stop
    setEvolution({ near: true })
    setEvolution({ near: false })
    expect(getEvolution().near).toBe(true)
    expect(told).toBe(0)
    resetEvolution()
    expect(getEvolution()).toEqual({ near: false, onScreen: false, pinned: false, era: 'fire' })
  })
})

describe('the script', () => {
  it('runs a track through its keys without swinging past any of them', () => {
    const run = track([
      [0, 0, 10],
      [0.5, 4, 10],
      [0.6, 4, 2],
      [1, 9, 2],
    ])
    const out: number[] = []
    expect(run(0, out)).toEqual([0, 10])
    expect(run(1, out)).toEqual([9, 2])
    expect(run(0.5, out)[0]).toBeCloseTo(4, 10)
    let last = -Infinity
    for (const p of steps(500)) {
      const [a, b] = run(p, out) as [number, number]
      expect(a).toBeGreaterThanOrEqual(last - 1e-9)
      last = a
      // Held at two keys, held between them.
      if (p <= 0.5) expect(b).toBeCloseTo(10, 9)
      expect(b).toBeGreaterThanOrEqual(2 - 1e-9)
      expect(b).toBeLessThanOrEqual(10 + 1e-9)
    }
    // Outside its keys it holds the ends, and nonsense is the start.
    expect(run(-1, out)).toEqual([0, 10])
    expect(run(7, out)).toEqual([9, 2])
    expect(run(Number.NaN, out)).toEqual([0, 10])
  })

  it('walks the camera the whole way without a jump, and never under the ground', () => {
    const shot = {} as Shot
    const before = {} as Shot
    cameraAt(0, before)
    for (const p of steps(2000)) {
      cameraAt(p, shot)
      for (const value of Object.values(shot)) expect(Number.isFinite(value)).toBe(true)
      // Forward along the walk, a step at a time.
      expect(shot.x).toBeGreaterThanOrEqual(before.x - 1e-6)
      expect(Math.hypot(shot.x - before.x, shot.y - before.y, shot.z - before.z), `at ${p}`).toBeLessThan(1.6)
      if (shot.x > 2 && shot.z > -15) expect(shot.y, `at ${p}`).toBeGreaterThanOrEqual(groundAt(shot.x, shot.z) + HEADROOM - 1e-6)
      expect(shot.fov).toBeGreaterThan(20)
      expect(shot.fov).toBeLessThan(70)
      Object.assign(before, shot)
    }
  })

  it('starts the camera in the cave and ends it in front of the screen', () => {
    const shot = cameraAt(0, {} as Shot)
    expect(caveFootprint(shot.x, shot.z)).toBe(1)
    expect(shot.y).toBeLessThan(2)
    cameraAt(1, shot)
    expect(shot.tx).toBeCloseTo(SCREEN.x, 2)
    expect(shot.ty).toBeCloseTo(SCREEN.y, 2)
    expect(shot.tz).toBeCloseTo(SCREEN.z, 2)
    // Square on to it, and close enough that it fills a landscape frame top to bottom.
    expect(Math.abs(shot.x - SCREEN.x)).toBeLessThan(0.02)
    const distance = shot.z - SCREEN.z
    expect(distance).toBeGreaterThan(0.1)
    expect(2 * distance * Math.tan((shot.fov * Math.PI) / 360)).toBeLessThan(SCREEN.height)
    // Held upright, a phone ends closer still.
    const narrow = cameraAt(1, {} as Shot, 0.46)
    expect(narrow.z - SCREEN.z).toBeLessThan(distance)
    expect(narrow.z - SCREEN.z).toBeGreaterThan(0.05)
  })

  it('opens the lens for a screen held upright and leaves a wide one alone', () => {
    expect(lensFor(45, 1.6)).toBe(45)
    expect(lensFor(45, 0.8)).toBe(45)
    expect(lensFor(45, 0.46)).toBeGreaterThan(45)
    expect(lensFor(45, 0.46)).toBeLessThanOrEqual(86)
    expect(lensFor(45, 0)).toBe(45)
    // As wide across as a 4:5 frame would have been.
    const across = (fov: number, aspect: number) => Math.tan((fov * Math.PI) / 360) * aspect
    expect(across(lensFor(40, 0.5), 0.5)).toBeCloseTo(across(40, 0.8), 6)
  })

  it('brings the sun up for the people leaving the cave and takes it down over the city', () => {
    const sky = {} as Sky
    const elevation = (p: number) => skyAt(p, sky).elevation
    for (const p of steps(1000)) {
      skyAt(p, sky)
      expect(Math.hypot(sky.sx, sky.sy, sky.sz)).toBeCloseTo(1, 6)
      expect(Math.hypot(sky.mx, sky.my, sky.mz)).toBeCloseTo(1, 6)
    }
    expect(elevation(0)).toBeLessThan(-6)
    expect(elevation(0.22)).toBeGreaterThan(1)
    // It rises out of the mouth of the cave: ahead of the walk.
    expect(skyAt(0.19, sky).sx).toBeGreaterThan(0.9)
    expect(elevation(0.4)).toBeGreaterThan(18)
    expect(elevation(0.66)).toBeGreaterThan(2)
    expect(elevation(0.8)).toBeLessThan(-5)
    expect(elevation(1)).toBeLessThan(-15)
    // And sets ahead of the walk too, behind the city.
    expect(skyAt(0.69, sky).sx).toBeGreaterThan(0.7)
    // By then there is a moon up.
    expect(skyAt(0.9, sky).my).toBeGreaterThan(0.4)
  })

  it('puts three days and three nights between the hunt and the city', () => {
    const sky = {} as Sky
    let crossings = 0
    let above = skyAt(0.475, sky).elevation > 0
    for (const p of steps(4000).map((u) => 0.475 + u * (0.618 - 0.475))) {
      const now = skyAt(p, sky).elevation > 0
      if (now !== above) crossings++
      above = now
    }
    expect(crossings).toBe(6)
    expect(skyAt(0.618, sky).days - skyAt(0.475, sky).days).toBeGreaterThan(3)
  })

  it('has a mood for every height of the sun, and lights the lamps as it goes down', () => {
    for (let e = -40; e <= 80; e += 0.5) {
      const mood = moodAt(e)
      expect(mood.to).toBe(mood.from + 1)
      expect(MOODS[mood.from]).toBeDefined()
      expect(MOODS[mood.to]).toBeDefined()
      expect(mood.mix).toBeGreaterThanOrEqual(0)
      expect(mood.mix).toBeLessThanOrEqual(1)
    }
    expect(moodAt(Number.NaN).mix).toBe(0)
    expect(lampsAt(30)).toBe(0)
    expect(lampsAt(-10)).toBe(1)
    let last = 1
    for (let e = -10; e <= 10; e += 0.25) {
      expect(lampsAt(e)).toBeLessThanOrEqual(last)
      last = lampsAt(e)
    }
  })

  it('has the cave gone by the hunt and the city built by dusk', () => {
    const stage = {} as Stage
    for (const p of steps(500)) {
      stageAt(p, stage)
      for (const value of Object.values(stage)) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
    expect(stageAt(0, stage).fire).toBe(0)
    expect(stageAt(0.1, stage).fire).toBe(1)
    expect(stageAt(0.35, stage).cave).toBe(0)
    expect(stageAt(0.3, stage).city).toBe(0)
    expect(stageAt(0.645, stage).city).toBe(1)
    expect(stageAt(0.7, stage).steppe).toBe(0)
    // Covered at both ends, clear between.
    expect(stageAt(0, stage).veil).toBe(1)
    expect(stageAt(0.5, stage).veil).toBe(0)
    expect(stageAt(1, stage).veil).toBe(1)
  })
})

describe('the cast', () => {
  it('lays a route with its corners where it was told', () => {
    expect(HUNT_ROUTE.marks[0]).toBe(0)
    expect(HUNT_ROUTE.length).toBeGreaterThan(120)
    const spot = { x: 0, z: 0, heading: 0 }
    along(HUNT_ROUTE, 0, spot)
    expect([spot.x, spot.z]).toEqual([HUNT_ROUTE.points[0]![0], HUNT_ROUTE.points[0]![1]])
    along(HUNT_ROUTE, 1e9, spot)
    expect(spot.x).toBeCloseTo(HUNT_ROUTE.points.at(-1)![0], 9)
    along(HUNT_ROUTE, Number.NaN, spot)
    expect(Number.isFinite(spot.x + spot.z + spot.heading)).toBe(true)
  })

  it('sits the hunters by the fire, gets them up, and walks them to the water without a step back', () => {
    for (const [i] of HUNTERS.entries()) {
      const w = {} as Walker
      hunterAt(i, 0, w)
      expect(w.seated).toBe(1)
      expect(caveFootprint(w.x, w.z)).toBe(1)
      expect(w.travelled).toBe(0)
      let last = 0
      for (const p of steps(1500)) {
        hunterAt(i, p, w)
        for (const value of Object.values(w)) expect(Number.isFinite(value)).toBe(true)
        expect(w.travelled).toBeGreaterThanOrEqual(last - 1e-9)
        last = w.travelled
        // Never in the pond.
        expect(Math.hypot(w.x - PLACE.pond.x, w.z - PLACE.pond.z)).toBeGreaterThan(PLACE.pond.r)
      }
      expect(hunterAt(i, 0.12, w).seated).toBe(0)
      // Out of the cave by the time the camera is, and in the grass.
      expect(hunterAt(i, 0.22, w).x).toBeGreaterThan(0)
      expect(hunterAt(i, 0.34, w).low).toBeGreaterThan(0.9)
      expect(hunterAt(i, 0.41, w).running).toBeGreaterThan(0.9)
      expect(hunterAt(i, 0.5, w).running).toBe(0)
      expect(hunterAt(i, 0.5, w).x).toBeGreaterThan(90)
    }
    // Only the one in front throws, and only once it has run.
    const thrower = {} as Walker
    expect(hunterAt(0, 0.39, thrower).cast).toBe(0)
    expect(hunterAt(0, CAST.from, thrower).cast).toBeGreaterThan(1)
    expect(hunterAt(1, CAST.from, thrower).cast).toBe(0)
    expect(CAST.until).toBeGreaterThan(CAST.from)
  })

  it('keeps the herd at the water until it is alarmed, and then it is gone', () => {
    for (const [i, home] of HERD.entries()) {
      const b = {} as Beast
      herdAt(i, 0.3, b)
      expect([b.x, b.z]).toEqual([home.x, home.z])
      expect(b.alarm).toBe(0)
      expect(b.fleeing).toBe(0)
      // On the shore, not in the water.
      expect(Math.hypot(home.x - PLACE.pond.x, home.z - PLACE.pond.z)).toBeGreaterThan(PLACE.pond.r * 0.95)
      // Heads up before the feet move.
      const alarmed = steps(400).map((u) => 0.36 + u * 0.06).find((p) => herdAt(i, p, b).alarm > 0.5)!
      expect(herdAt(i, alarmed, b).travelled).toBe(0)
      let last = 0
      for (const p of steps(800)) {
        herdAt(i, p, b)
        for (const value of Object.values(b)) expect(Number.isFinite(value)).toBe(true)
        expect(b.travelled).toBeGreaterThanOrEqual(last - 1e-9)
        last = b.travelled
      }
      expect(herdAt(i, 0.52, b).fleeing).toBe(1)
      expect(Math.hypot(b.x - home.x, b.z - home.z)).toBeGreaterThan(60)
    }
  })
})

describe('the land', () => {
  it('is level where the walk needs it to be', () => {
    // The floor of the cave.
    const { chamber, hearth } = PLACE.cave
    expect(Math.abs(groundAt(hearth.x, hearth.z))).toBeLessThan(0.15)
    expect(Math.abs(groundAt(chamber.x, chamber.z))).toBeLessThan(0.15)
    expect(Math.abs(groundAt(-6, 0))).toBeLessThan(0.15)
    // The street, end to end.
    for (let x = PLACE.city.from + 16; x < PLACE.city.until - 5; x += 7) {
      expect(Math.abs(groundAt(x, PLACE.city.street)), `at ${x}`).toBeLessThan(0.03)
      expect(Math.abs(groundAt(x, PLACE.city.street - 20))).toBeLessThan(0.03)
    }
    expect(Math.abs(groundAt(PLACE.studio.x, PLACE.studio.z))).toBeLessThan(0.03)
  })

  it('holds the pond: a bowl below the water with a shore above it', () => {
    const { x, z, r, level } = PLACE.pond
    expect(groundAt(x, z)).toBeLessThan(level - 1)
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      expect(groundAt(x + Math.cos(a) * r * 0.8, z + Math.sin(a) * r * 0.8)).toBeLessThan(level)
      expect(groundAt(x + Math.cos(a) * r * 1.35, z + Math.sin(a) * r * 1.35), `bearing ${a}`).toBeGreaterThan(level)
    }
  })

  it('draws what it says: the mesh is the ground', () => {
    for (const [x, z] of [[LAND.x0, LAND.z0], [0, 0], [102.5, -20], [300, -7.5], [LAND.x1, LAND.z1]] as const) {
      expect(groundAt(x, z)).toBeCloseTo(landAt(x, z), 4)
    }
    // Between vertices it is the triangles, which is not the formula but is close.
    expect(Math.abs(groundAt(51.2, -3.3) - landAt(51.2, -3.3))).toBeLessThan(0.12)
    expect(Number.isFinite(groundAt(1e6, -1e6))).toBe(true)
    const geometry = buildLand()
    const positions = geometry.getAttribute('position')
    expect(positions.count).toBe(((LAND.x1 - LAND.x0) / LAND.step + 1) * ((LAND.z1 - LAND.z0) / LAND.step + 1))
    const grass = geometry.getAttribute('grass')
    expect(grass.count).toBe(positions.count)
    for (let i = 0; i < positions.count; i += 97) {
      expect(positions.getY(i)).toBeCloseTo(groundAt(positions.getX(i), positions.getZ(i)), 5)
      expect(grass.getX(i)).toBeGreaterThanOrEqual(0)
      expect(grass.getX(i)).toBeLessThanOrEqual(1)
    }
    geometry.dispose()
  })

  it('grows grass on the steppe and nowhere it should not', () => {
    expect(grassAt(60, -8)).toBeGreaterThan(0.9)
    expect(grassAt(PLACE.cave.hearth.x, PLACE.cave.hearth.z)).toBe(0)
    expect(grassAt(PLACE.pond.x, PLACE.pond.z)).toBe(0)
    expect(grassAt(2, 0)).toBeLessThan(0.05)
  })

  it('rings the walk with ranges that start level, under the edge of the land', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const at = (r: number) => rangeAt(RANGE.x + Math.cos(a) * r, RANGE.z + Math.sin(a) * r)
      expect(at(RANGE.inner)).toBe(0)
      expect(at(RANGE.foot)).toBeCloseTo(0, 6)
      expect(at((RANGE.foot + RANGE.outer) / 2)).toBeGreaterThan(40)
    }
    // The skirt reaches in past every edge of the land.
    const corner = Math.hypot(Math.max(Math.abs(LAND.x0 - RANGE.x), Math.abs(LAND.x1 - RANGE.x)), Math.max(Math.abs(LAND.z0 - RANGE.z), Math.abs(LAND.z1 - RANGE.z)))
    const nearest = Math.min(Math.abs(LAND.x0 - RANGE.x), Math.abs(LAND.x1 - RANGE.x), Math.abs(LAND.z0 - RANGE.z), Math.abs(LAND.z1 - RANGE.z))
    expect(RANGE.inner).toBeLessThan(nearest + 120)
    expect(RANGE.foot).toBeGreaterThan(corner)
  })
})

describe('the city', () => {
  const blocks = towers()

  it('is the same city every visit, with one building for the studio', () => {
    expect(towers()).toEqual(blocks)
    expect(blocks.length).toBeGreaterThan(40)
    const lifted = blocks.filter((b) => b.base > 0)
    expect(lifted).toHaveLength(1)
    const home = lifted[0]!
    // The room fits under it, glass on the street.
    expect(home.x - home.w / 2).toBeLessThan(PLACE.studio.x - STUDIO.width / 2)
    expect(home.x + home.w / 2).toBeGreaterThan(PLACE.studio.x + STUDIO.width / 2)
    expect(home.base).toBeGreaterThan(STUDIO.height)
    expect(home.d).toBeGreaterThan(STUDIO.depth)
    expect(home.h).toBeGreaterThan(home.base + 10)
  })

  it('leaves the street clear and stands nothing in another building', () => {
    const { street, half } = PLACE.city
    for (const b of blocks) {
      expect(Math.abs(b.z - street) - b.d / 2, 'a building in the road').toBeGreaterThan(half + 3)
      expect(b.h).toBeGreaterThan(4)
      expect(b.delay).toBeGreaterThanOrEqual(0)
      expect(b.delay).toBeLessThan(1)
    }
    for (const [i, a] of blocks.entries()) {
      for (const b of blocks.slice(i + 1)) {
        const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 1e-6 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2 - 1e-6
        expect(apart, `${a.x},${a.z} and ${b.x},${b.z}`).toBe(true)
      }
    }
  })
})

describe('the figures', () => {
  const early = createFigure('early', 'low')
  const mammoth = createFigure('mammoth', 'low')

  it('meshes each as one surface at its real size', () => {
    for (const figure of [early, createFigure('modern', 'low'), mammoth]) {
      expect(figure.positions.length / 3).toBeGreaterThan(1500)
      // One piece, and closed but for the odd edge where something as thin as
      // a finger or the tip of a tusk is thinner than the field it was cut from.
      expect(components(figure)).toBe(1)
      expect(openEdges(figure) / edgeUse(figure).size).toBeLessThan(0.001)
      for (const value of figure.positions) expect(Number.isFinite(value)).toBe(true)
    }
    // A person a little under a metre eighty; a mammoth most of six from tusk to tail.
    expect(early.size).toBeGreaterThan(1.7)
    expect(early.size).toBeLessThan(1.86)
    expect(mammoth.size).toBeGreaterThan(5)
    expect(mammoth.size).toBeLessThan(6.5)
  })

  it('gives every vertex its share of skin, hair, clothing and trim', () => {
    const regions = early.regions!
    expect(regions.length).toBe((early.positions.length / 3) * 4)
    const totals = [0, 0, 0, 0]
    for (let v = 0; v < regions.length; v += 4) {
      const sum = regions[v]! + regions[v + 1]! + regions[v + 2]! + regions[v + 3]!
      expect(sum).toBeCloseTo(1, 5)
      for (let r = 0; r < 4; r++) totals[r] = totals[r]! + regions[v + r]!
    }
    // Someone from the cave is mostly skin, with hair, a hide and a belt.
    const count = regions.length / 4
    expect(totals[0]! / count).toBeGreaterThan(0.35)
    for (const total of totals) expect(total / count).toBeGreaterThan(0.01)
  })

  it('skins each side of a body to its own limbs', () => {
    const names = early.bones.map((bone) => bone.name)
    for (let v = 0; v < early.positions.length / 3; v++) {
      const z = early.positions[v * 3 + 2]!
      let sum = 0
      for (let i = 0; i < 4; i++) {
        const weight = early.skinWeights[v * 4 + i]!
        sum += weight
        const name = names[early.skinIndices[v * 4 + i]!]!
        // The mesh is a unit tall: three hundredths is five centimetres off the middle.
        if (weight > 0.02 && z > 0.03) expect(name.endsWith('R'), `${name} at z ${z}`).toBe(false)
        if (weight > 0.02 && z < -0.03) expect(name.endsWith('L'), `${name} at z ${z}`).toBe(false)
      }
      expect(sum).toBeCloseTo(1, 5)
    }
  })

  it('puts each foot where the gait says, whatever the body above it is doing', () => {
    const { byName } = buildSkeleton(early.bones)
    const frame = measure(early.bones, early.size!)
    const pose = createPose()
    const at = new Vector3()
    for (const gait of [GAITS.walk, GAITS.stalk, GAITS.run]) {
      for (const phase of [0, 0.13, 0.3, 0.47, 0.62, 0.8, 0.93]) {
        gaitPose(pose, phase, gait)
        applyPose(byName, pose, frame)
        byName.get('hips')!.updateMatrixWorld(true)
        for (const [suffix, side, leg] of [['L', 1, pose.legL], ['R', -1, pose.legR]] as const) {
          byName.get(`foot${suffix}`)!.getWorldPosition(at).multiplyScalar(frame.size)
          const want = { x: frame.legs.stands.x + leg[0], y: frame.legs.stands.y + leg[1], z: side * (frame.legs.stands.z + leg[2]) }
          // A leg at full stretch stops short rather than coming apart: allow it that.
          expect(Math.hypot(at.x - want.x, at.y - want.y, at.z - want.z), `${suffix} at ${phase}`).toBeLessThan(0.09)
        }
      }
    }
  })

  it('plants a foot for as long as it is down: the ground it covers is the ground the body covers', () => {
    const pose = createPose()
    for (const gait of [GAITS.walk, GAITS.stalk, GAITS.run]) {
      const first = gaitPose(pose, 0.001, gait).legL[0]
      const last = gaitPose(pose, gait.stance - 0.001, gait).legL[0]
      expect(first - last).toBeCloseTo(gait.stride * gait.stance, 1)
      // Down while it is down, up while it is carried through.
      expect(gaitPose(pose, gait.stance * 0.4, gait).legL[1]).toBeLessThan(0.02)
      expect(gaitPose(pose, gait.stance + (1 - gait.stance) * 0.5, gait).legL[1]).toBeGreaterThan(gait.lift * 0.6)
      // The other foot is half a cycle behind.
      expect(gaitPose(pose, 0.5, gait).legR[0]).toBeCloseTo(gaitPose(pose, 0, gait).legL[0], 6)
    }
    for (const made of [standPose(createPose(), 3.3, 1), sitPose(createPose(), 3.3, 1), deskPose(createPose(), 3.3)]) {
      for (const value of [made.rise, made.lean, made.bend, ...made.armL, ...made.armR, ...made.legL, ...made.legR]) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('walks a mammoth one foot at a time, and keeps all four on the ground it stands on', () => {
    const { byName } = buildSkeleton(mammoth.bones)
    const frame = measure(mammoth.bones, mammoth.size!)
    expect(frame.arms).toBeDefined()
    const pose = createBeastPose()
    const at = new Vector3()
    for (const gait of [BEAST_GAITS.walk, BEAST_GAITS.amble]) {
      for (const phase of [0, 0.2, 0.45, 0.7, 0.9]) {
        beastGaitPose(pose, phase, gait)
        // An elephant never has all four feet off the ground.
        const down = [pose.frontL, pose.frontR, pose.hindL, pose.hindR].filter((foot) => foot[1] === 0).length
        expect(down).toBeGreaterThanOrEqual(2)
        applyBeast(byName, pose, frame)
        byName.get('hips')!.updateMatrixWorld(true)
        for (const [name, limb, side, foot] of [
          ['footL', frame.legs, 1, pose.hindL],
          ['footR', frame.legs, -1, pose.hindR],
          ['handL', frame.arms!, 1, pose.frontL],
          ['handR', frame.arms!, -1, pose.frontR],
        ] as const) {
          byName.get(name)!.getWorldPosition(at).multiplyScalar(frame.size)
          const want = { x: limb.stands.x + foot[0], y: limb.stands.y + foot[1], z: side * limb.stands.z }
          expect(Math.hypot(at.x - want.x, at.y - want.y, at.z - want.z), `${name} at ${phase}`).toBeLessThan(0.16)
        }
      }
    }
  })
})
