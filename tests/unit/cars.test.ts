import { describe, expect, it } from 'vitest'
import { BULGE, PART, VEHICLE_KINDS, VEHICLE_SHAPES, plateAt, vehicleMesh, type VehicleKind } from '@/components/three/evoCarShapes'
import { CROSSWALK, LANES, ROAD, STREET_LENGTH, STREET_START, STREET_Z, crossingHeld } from '@/components/three/evoStreet'
import { AMBER, LENS_CLEAR, RED, STRIPES_CLEAR, TRAFFIC_RING, createTraffic, stopLine, type Traffic, type Vehicle } from '@/components/three/evoTraffic'
import { allFinite, bounds, components, openEdges, volume } from './mesh'

/**
 * The traffic of the long walk: five bodies made out of numbers, and the way
 * they are driven. Neither needs a renderer — a body is typed arrays that can
 * be measured, and the driving is handed time a step at a time — so an hour of
 * a busy street is run here in a blink, and what has to be true of it at every
 * step is asked at every step.
 */

/** A generator of its own, so that a failure is the same failure every run. */
function dice(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    return a / 4294967296
  }
}

describe('the bodies', () => {
  for (const kind of VEHICLE_KINDS) {
    const shape = VEHICLE_SHAPES[kind]
    const mesh = vehicleMesh(kind)

    it(`${kind}: one closed skin and a mirror either side, right way out`, () => {
      expect(allFinite(mesh.positions)).toBe(true)
      // The body, and the two pods of its mirrors: nothing else, and no holes in any of them.
      expect(components(mesh)).toBe(3)
      expect(openEdges(mesh)).toBe(0)
      // Wound to face outwards: a mesh that is inside out encloses less than nothing.
      const box = shape.length * shape.width * shape.height
      expect(volume(mesh)).toBeGreaterThan(box * 0.45)
      expect(volume(mesh)).toBeLessThan(box)
    })

    it(`${kind}: the size it says it is, standing on its wheels`, () => {
      const { min, max } = bounds(mesh.positions)
      // Its length, and the little by which the middle of each end stands proud.
      expect(max[0] - min[0]).toBeCloseTo(shape.length + BULGE * 2, 2)
      expect(max[1]).toBeGreaterThan(shape.height - 0.06)
      expect(max[1]).toBeLessThan(shape.height + 0.02)
      // Clear of the road by what it says, and of its own wheels where they are.
      expect(min[1]).toBeGreaterThan(shape.clearance - 0.01)
      // Mirrors stand out past the body; nothing else does.
      expect(max[2]).toBeLessThan(shape.width / 2 + 0.35)
      expect(max[2]).toBeCloseTo(-min[2], 5)
      // The tyres fit under it and inside its sides.
      for (const axle of shape.axles) expect(Math.abs(axle)).toBeLessThan(shape.length / 2 - shape.wheel.radius)
    })

    it(`${kind}: every face one thing, with a normal that is a normal`, () => {
      const { position, normal, part, body, index } = mesh.draw
      const count = position.length / 3
      expect(normal.length).toBe(count * 3)
      expect(part.length).toBe(count)
      expect(body.length).toBe(count * 2)
      expect(allFinite(position)).toBe(true)
      let worst = 0
      for (let v = 0; v < count; v++) worst = Math.max(worst, Math.abs(Math.hypot(normal[v * 3]!, normal[v * 3 + 1]!, normal[v * 3 + 2]!) - 1))
      expect(worst).toBeLessThan(1e-4)
      // A triangle's three corners agree about what it is made of.
      const made = new Set<number>()
      for (let t = 0; t < index.length; t += 3) {
        const a = part[index[t]!]!
        expect(part[index[t + 1]!]).toBe(a)
        expect(part[index[t + 2]!]).toBe(a)
        made.add(a)
      }
      for (const needed of [PART.paint, PART.glass, PART.trim, PART.under]) expect(made.has(needed), `part ${needed}`).toBe(true)
      // And about whether it is the side of the body that doors are drawn on: paint, below the glass.
      let sides = 0
      for (let t = 0; t < index.length; t += 3) {
        const side = body[index[t]! * 2]!
        expect(side === 0 || side === 1).toBe(true)
        expect(body[index[t + 1]! * 2]).toBe(side)
        expect(body[index[t + 2]! * 2]).toBe(side)
        if (side === 0) continue
        sides++
        expect(part[index[t]!]).toBe(PART.paint)
        for (const corner of [index[t]!, index[t + 1]!, index[t + 2]!]) {
          expect(body[corner * 2 + 1]).toBeGreaterThanOrEqual(0)
          expect(body[corner * 2 + 1]).toBeLessThanOrEqual(1)
          expect(position[corner * 3 + 1]).toBeLessThan(shape.cabin.belt + 0.12)
        }
      }
      expect(sides).toBeGreaterThan(100)
      // And they face the way the skin does: out, on the whole, from the middle of the car.
      let out = 0
      let all = 0
      const middle = shape.height * 0.5
      for (let v = 0; v < count; v++) {
        const dot = normal[v * 3]! * position[v * 3]! * 0.2 + normal[v * 3 + 1]! * (position[v * 3 + 1]! - middle) + normal[v * 3 + 2]! * position[v * 3 + 2]!
        if (dot > 0) out++
        all++
      }
      expect(out / all).toBeGreaterThan(0.9)
    })

    it(`${kind}: glass where the windows are, and none in the doors but a bus's`, () => {
      const { position, part, index } = mesh.draw
      let glass = 0
      let low = 0
      for (let t = 0; t < index.length; t += 3) {
        if (part[index[t]!] !== PART.glass) continue
        glass++
        const y = (position[index[t]! * 3 + 1]! + position[index[t + 1]! * 3 + 1]! + position[index[t + 2]! * 3 + 1]!) / 3
        if (y < shape.height * 0.5) low++
      }
      expect(glass).toBeGreaterThan(40)
      if (shape.kerbDoors) expect(low).toBeGreaterThan(0)
      else expect(low).toBe(0)
    })
  }

  it('what is drawn on a body has skin to be drawn on', () => {
    for (const kind of VEHICLE_KINDS) {
      const shape = VEHICLE_SHAPES[kind]
      const { position, part, index } = vehicleMesh(kind).draw
      const half = shape.length / 2
      /** How many faces of painted skin pass through a box at one end of the body, on its right. */
      const skin = (end: 1 | -1, depth: number, y: number, tall: number, z: number, wide: number): number => {
        let found = 0
        for (let t = 0; t < index.length; t += 3) {
          if (part[index[t]!] !== PART.paint) continue
          const lo = [Infinity, Infinity, Infinity]
          const hi = [-Infinity, -Infinity, -Infinity]
          for (let c = 0; c < 3; c++) {
            const v = index[t + c]! * 3
            // How far in from the end, how high, how far out.
            const at = [half - end * position[v]!, position[v + 1]!, position[v + 2]!]
            for (let axis = 0; axis < 3; axis++) {
              lo[axis] = Math.min(lo[axis]!, at[axis]!)
              hi[axis] = Math.max(hi[axis]!, at[axis]!)
            }
          }
          if (lo[0]! < depth && lo[1]! < y + tall / 2 && hi[1]! > y - tall / 2 && lo[2]! < z + wide / 2 && hi[2]! > z - wide / 2) found++
        }
        return found
      }
      // A lamp at each corner, where the body comes round it; and where the lamp's own light is put.
      expect(skin(1, shape.nose + 0.14, shape.head.y, shape.head.tall, shape.head.z, shape.head.wide), `${kind} headlamp`).toBeGreaterThan(4)
      expect(skin(-1, shape.tail + 0.14, shape.rear.y, shape.rear.tall, shape.rear.z, shape.rear.wide), `${kind} tail lamp`).toBeGreaterThan(4)
      expect(shape.head.x).toBeGreaterThan(half - 0.2)
      expect(shape.head.x).toBeLessThan(half + 0.02)
      expect(shape.rear.x).toBeLessThan(-half + 0.2)
      expect(shape.rear.x).toBeGreaterThan(-half - 0.02)
      // A plate on the flat of each end, clear of the skin by a finger and no more, and off the lamps.
      const { min, max } = bounds(vehicleMesh(kind).positions)
      expect(plateAt(shape, 1)).toBeGreaterThan(max[0])
      expect(plateAt(shape, 1)).toBeLessThan(max[0] + 0.03)
      expect(plateAt(shape, -1)).toBeLessThan(min[0])
      expect(plateAt(shape, -1)).toBeGreaterThan(min[0] - 0.03)
      for (const [end, y, lens] of [
        [1, shape.plates.front, shape.head],
        [-1, shape.plates.back, shape.rear],
      ] as const) {
        // The flat of an end: from the lowest of its skin to the highest, down the middle of it.
        let low = Infinity
        let high = -Infinity
        for (let v = 0; v < position.length / 3; v++) {
          if (half - end * position[v * 3]! > 0.011 || Math.abs(position[v * 3 + 2]!) > 0.3) continue
          low = Math.min(low, position[v * 3 + 1]!)
          high = Math.max(high, position[v * 3 + 1]!)
        }
        expect(y - 0.056, `${kind} plate`).toBeGreaterThan(low + 0.02)
        expect(y + 0.056, `${kind} plate`).toBeLessThan(high - 0.02)
        const apart = Math.abs(y - lens.y) > (0.112 + lens.tall) / 2 || lens.z - lens.wide / 2 > 0.26
        expect(apart, `${kind} plate under a lamp`).toBe(true)
      }
      // A grille and an intake that fit on the front of it.
      for (const [y, tall, wide] of [shape.grille, shape.intake]) {
        if (wide === 0) continue
        expect(y - tall / 2).toBeGreaterThan(shape.clearance)
        expect(y + tall / 2).toBeLessThan(shape.cabin.belt)
        expect(wide / 2).toBeLessThan(shape.width / 2)
      }
      // And an inside that is inside: seats between the screens, glass between belt and roof.
      const cabin = shape.cabin
      expect(cabin.belt).toBeGreaterThan(shape.clearance + 0.4)
      expect(cabin.top).toBeGreaterThan(cabin.belt + 0.3)
      expect(cabin.top).toBeLessThan(shape.height)
      expect(cabin.half).toBeLessThan(shape.width / 2)
      expect(cabin.front).toBeLessThan(half)
      expect(cabin.rear).toBeGreaterThan(-half)
      if (cabin.seats) {
        expect(cabin.seats[0]).toBeLessThan(cabin.front - 0.5)
        expect(cabin.seats[1]).toBeLessThan(cabin.seats[0] - 0.6)
        expect(cabin.seats[1]).toBeGreaterThan(cabin.rear + 0.2)
      }
    }
  })
})

/** How far each body really reaches from its middle: its mirrors stand out past its sides, and its ends are not flat. */
const REACH = new Map<VehicleKind, { x: number; y: number; z: number }>()
function reachOf(kind: VehicleKind): { x: number; y: number; z: number } {
  let reach = REACH.get(kind)
  if (!reach) {
    const { min, max } = bounds(vehicleMesh(kind).positions)
    reach = { x: Math.max(max[0], -min[0]), y: max[1], z: Math.max(max[2], -min[2]) }
    REACH.set(kind, reach)
  }
  return reach
}

/** How near the body of a vehicle is to a point: the box its mesh fits in, standing on the road. */
function clearance(vehicle: Vehicle, point: { x: number; y: number; z: number }): number {
  const reach = reachOf(vehicle.kind)
  const dx = Math.max(0, Math.abs(point.x - vehicle.x) - reach.x)
  const dz = Math.max(0, Math.abs(point.z - vehicle.z) - reach.z)
  const dy = Math.max(0, point.y - reach.y)
  return Math.hypot(dx, dy, dz)
}

/**
 * Somewhere to note the first thing that goes wrong in a long run. Asking
 * `expect` a million times is most of the run — and a test has five seconds
 * on a machine that is busy with something else — so the checks in a loop are
 * plain comparisons, and the one `expect` is at the end.
 */
function watch(): { check(ok: boolean, say: () => string): void; done(): void } {
  let first = ''
  return {
    check(ok, say) {
      if (!ok && !first) first = say()
    },
    done() {
      expect(first).toBe('')
    },
  }
}

/** The least air between any vehicle and the one ahead of it in its lane. */
function tightest(traffic: Traffic): number {
  let least = Infinity
  LANES.forEach((_, lane) => {
    const row = traffic.vehicles.filter((vehicle) => vehicle.lane === lane).sort((a, b) => a.s - b.s)
    row.forEach((me, k) => {
      const ahead = row[(k + 1) % row.length]!
      if (ahead === me) return
      const gap = (((ahead.s - ahead.length / 2 - (me.s + me.length / 2)) % TRAFFIC_RING) + TRAFFIC_RING) % TRAFFIC_RING
      least = Math.min(least, gap > TRAFFIC_RING - 40 ? gap - TRAFFIC_RING : gap)
    })
  })
  return least
}

describe('the traffic', () => {
  it('puts as many on the street as it is asked for, most of them white, a bus at the kerb', () => {
    for (const count of [0, 10, 20, 32, 44]) {
      const traffic = createTraffic(count)
      expect(traffic.vehicles.length).toBe(count)
      const buses = traffic.vehicles.filter((vehicle) => vehicle.kind === 'bus')
      expect(buses.length).toBe(count >= 28 ? 2 : count >= 8 ? 1 : 0)
      for (const bus of buses) expect([0, LANES.length - 1]).toContain(bus.lane)
      if (count >= 20) {
        const cars = traffic.vehicles.filter((vehicle) => vehicle.kind !== 'bus')
        expect(cars.filter((vehicle) => vehicle.paint === 0).length / cars.length).toBeGreaterThan(0.45)
        // Every lane has something in it.
        for (let lane = 0; lane < LANES.length; lane++) expect(traffic.vehicles.some((vehicle) => vehicle.lane === lane)).toBe(true)
      }
      expect(tightest(traffic)).toBeGreaterThan(0.5)
    }
  })

  it('is the same street every visit', () => {
    const a = createTraffic(32)
    const b = createTraffic(32)
    for (let step = 0; step < 200; step++) {
      a.step(0.03, 0)
      b.step(0.03, 0)
    }
    expect(a.vehicles.map((vehicle) => [vehicle.kind, vehicle.lane, vehicle.s, vehicle.v])).toEqual(b.vehicles.map((vehicle) => [vehicle.kind, vehicle.lane, vehicle.s, vehicle.v]))
  })

  it('never drives one through another, however unevenly time comes', () => {
    const roll = dice(7)
    const traffic = createTraffic(44)
    let held = 0
    let moved = 0
    const all = watch()
    const before = new Float64Array(traffic.vehicles.length)
    for (let step = 0; step < 6000; step++) {
      // Frames of every length, the odd stall, and the lights changed now and then, all at once.
      const dt = roll() < 0.02 ? 0.5 + roll() * 3 : roll() * 0.05
      const changed = roll() < 0.004
      if (changed) held = held > 0.5 ? 0 : 1
      traffic.vehicles.forEach((vehicle, i) => {
        before[i] = vehicle.travelled
      })
      traffic.step(dt, held)
      // Looked at closely every few steps: an overlap, once there is one, stays.
      if (step % 4 === 0 || changed) all.check(tightest(traffic) > 0.5, () => `step ${step}: two of them ${tightest(traffic).toFixed(2)} m apart`)
      traffic.vehicles.forEach((vehicle, i) => {
        // Forwards only, and no further in a step than a quarter of a second at speed —
        // but for what the lights catch on the crossing as they go red, which is carried off it.
        const went = vehicle.travelled - before[i]!
        const most = vehicle.cruise * 1.06 * 0.25 + (changed && held > 0.5 ? CROSSWALK.half * 2 + CROSSWALK.stop + 14 : 0)
        all.check(went >= 0 && went < most + 1e-6, () => `step ${step}: a ${vehicle.kind} went ${went} m in a step`)
        moved += went
      })
    }
    all.done()
    for (const vehicle of traffic.vehicles) {
      for (const value of [vehicle.s, vehicle.v, vehicle.x, vehicle.z, vehicle.travelled]) expect(Number.isFinite(value)).toBe(true)
      expect(vehicle.v).toBeLessThanOrEqual(vehicle.cruise * 1.05 + 1e-9)
      expect(vehicle.s).toBeGreaterThanOrEqual(0)
      expect(vehicle.s).toBeLessThan(TRAFFIC_RING)
    }
    // And it is traffic: it gets somewhere.
    expect(moved / traffic.vehicles.length).toBeGreaterThan(300)
  })

  it('keeps to its lanes and to the street, and is only shown while all of it is on', () => {
    const traffic = createTraffic(32)
    const all = watch()
    let shown = 0
    let hidden = 0
    for (let step = 0; step < 3000; step++) {
      traffic.step(0.04, 0)
      for (const vehicle of traffic.vehicles) {
        all.check(vehicle.z === LANES[vehicle.lane]!.z && vehicle.going === LANES[vehicle.lane]!.going, () => `step ${step}: a ${vehicle.kind} out of its lane`)
        if (!vehicle.shown) {
          hidden++
          continue
        }
        shown++
        const on = vehicle.x - vehicle.length / 2 > STREET_START - 1e-6 && vehicle.x + vehicle.length / 2 < STREET_START + STREET_LENGTH + 1e-6
        all.check(on, () => `step ${step}: a ${vehicle.kind} shown at ${vehicle.x}, off the end of the street`)
      }
    }
    all.done()
    // Most of the time it is on the street; some of the time it is round the back.
    expect(shown).toBeGreaterThan(hidden * 4)
    expect(hidden).toBeGreaterThan(0)
  })

  it('stops for the crossing while it is held: a queue behind each line, and nothing left on the stripes', () => {
    const traffic = createTraffic(44)
    for (let step = 0; step < 600; step++) traffic.step(0.04, 0)
    // Who is short of their line when it changes, and could still pull up.
    const before = new Map(traffic.vehicles.map((vehicle) => [vehicle, vehicle.s + vehicle.length / 2]))
    for (let step = 0; step < 1500; step++) traffic.step(0.04, 1)
    const from = CROSSWALK.x - CROSSWALK.half
    const until = CROSSWALK.x + CROSSWALK.half
    let waiting = 0
    for (const vehicle of traffic.vehicles) {
      // A minute on, everything has stopped.
      expect(vehicle.v).toBeLessThan(0.05)
      // Nothing is standing on the crossing.
      if (vehicle.shown) expect(vehicle.x + vehicle.length / 2 < from || vehicle.x - vehicle.length / 2 > until, `${vehicle.kind} at ${vehicle.x}`).toBe(true)
      const line = stopLine(vehicle.lane)
      const nose = vehicle.s + vehicle.length / 2
      if (before.get(vehicle)! < line - 40) expect(nose).toBeLessThanOrEqual(line + 1e-6)
      if (nose <= line && line - nose < 60) waiting++
    }
    // Queues, not one car at each line.
    expect(waiting).toBeGreaterThan(12)
    expect(tightest(traffic)).toBeGreaterThan(0.5)
    // At the front of each queue, a nose just short of the line with its brake lights on.
    LANES.forEach((_, lane) => {
      const line = stopLine(lane)
      const first = traffic.vehicles
        .filter((vehicle) => vehicle.lane === lane && vehicle.s + vehicle.length / 2 <= line)
        .sort((a, b) => b.s - a.s)[0]!
      expect(line - (first.s + first.length / 2)).toBeLessThan(1.5)
      expect(first.braking).toBe(true)
    })
    // And when it is let go, they go.
    for (let step = 0; step < 400; step++) traffic.step(0.04, 0)
    expect(traffic.vehicles.filter((vehicle) => vehicle.v > 3).length).toBeGreaterThan(traffic.vehicles.length * 0.6)
  })

  it('goes by the lights: over on amber if it cannot pull up, never over on red, away in its turn on green', () => {
    const traffic = createTraffic(44)
    const noseOf = (vehicle: Vehicle) => vehicle.s + vehicle.length / 2
    let wentOver = 0
    let caught = 0
    /** Who is short of their line and too near it, at the speed they are doing, to stop for it short of standing on the brakes. */
    const tooNear = () =>
      traffic.vehicles.filter((vehicle) => {
        const room = stopLine(vehicle.lane) - noseOf(vehicle)
        return room > 0 && room < 10 && (vehicle.v * vehicle.v) / (2 * room) > 9
      })
    for (let round = 0; round < 8; round++) {
      // Until the traffic has settled, and then until something is right on top of its line.
      for (let step = 0; step < 150 + round * 37; step++) traffic.step(0.04, 0)
      for (let step = 0; step < 3000 && tooNear().length === 0; step++) traffic.step(0.04, 0)
      const cannot = tooNear()
      const can = traffic.vehicles.filter((vehicle) => {
        const room = stopLine(vehicle.lane) - noseOf(vehicle)
        return room > 25 && room < 60
      })
      // (Every other time round there is no amber at all: the scroll does not have to wait for one.)
      if (round % 2 === 0) {
        for (let step = 0; step < 100; step++) traffic.step(0.04, (AMBER + RED) / 2)
        // What could not pull up went over; what had the room is standing at the line, or behind what is.
        for (const vehicle of cannot) expect(noseOf(vehicle), `${vehicle.kind}, round ${round}`).toBeGreaterThan(stopLine(vehicle.lane))
        for (const vehicle of can) expect(noseOf(vehicle), `${vehicle.kind}, round ${round}`).toBeLessThanOrEqual(stopLine(vehicle.lane) + 1e-6)
        wentOver += cannot.length
      } else {
        caught += cannot.length
      }
      // Red. Nothing crosses its line from here on, however near it was and however fast.
      const all = watch()
      const was = traffic.vehicles.map(noseOf)
      for (let step = 0; step < 250; step++) {
        traffic.step(0.04, 1)
        traffic.vehicles.forEach((vehicle, i) => {
          const line = stopLine(vehicle.lane)
          all.check(was[i]! > line || noseOf(vehicle) <= line + 1e-6, () => `round ${round} step ${step}: a ${vehicle.kind} over the line on red`)
          was[i] = noseOf(vehicle)
        })
      }
      all.done()
      // Green: the front of each queue is off at once, the back of it is still waiting its turn.
      const queues = LANES.map((_, lane) =>
        traffic.vehicles
          .filter((vehicle) => vehicle.lane === lane && vehicle.v < 0.05 && noseOf(vehicle) <= stopLine(lane) && stopLine(lane) - noseOf(vehicle) < 80)
          .sort((a, b) => b.s - a.s),
      )
      for (let step = 0; step < 60; step++) traffic.step(0.04, 0)
      // (Ten seconds of red is a queue in most lanes, not in every one every time.)
      expect(queues.filter((queue) => queue.length > 0).length).toBeGreaterThan(1)
      for (const queue of queues) {
        if (queue.length === 0) continue
        expect(queue[0]!.v).toBeGreaterThan(1)
        if (queue.length > 4) expect(queue[queue.length - 1]!.v).toBeLessThan(0.5)
      }
    }
    // (And both were put to something: some were too near to stop for the amber, and some for a red out of nowhere.)
    expect(wentOver).toBeGreaterThan(0)
    expect(caught).toBeGreaterThan(0)
  })

  it('leaves nothing on the stripes while the crossing is held, however the scroll gets there', () => {
    // Where the walk has the camera, near enough: along the near pavement, then straight over on the stripes.
    const walker = (p: number, lens: { x: number; y: number; z: number }): void => {
      const u = Math.min(1, Math.max(0, (p - 0.88) / 0.07))
      lens.x = p < 0.88 ? CROSSWALK.x - 2.1 - (0.88 - p) * 420 : CROSSWALK.x - 2.1 + 4.1 * u
      lens.y = 1.8
      lens.z = p < 0.88 ? STREET_Z + ROAD + 2.5 : STREET_Z + ROAD + 1 - (ROAD * 2 + 2) * u
    }
    const roll = dice(53)
    let jumpTo = 0.8
    let jumpAt = 0
    // How the page gets from the pavement to the far side: a walk, a flick there and back, in jumps, and dithering at the change.
    const scrolls: [string, (t: number) => number][] = [
      ['at a walk', (t) => Math.min(0.97, 0.8 + t * 0.005)],
      [
        'at a flick: to the kerb, across, back to the middle, and away',
        (t) => {
          const c = t % 14
          const flick = (from: number, to: number, at: number) => from + (to - from) * Math.min(1, Math.max(0, (c - at) / 0.3))
          return c < 4.3 ? flick(0.8, 0.9, 0) : c < 7 ? flick(0.9, 0.97, 4.3) : c < 11 ? flick(0.97, 0.9, 7) : flick(0.9, 0.8, 11)
        },
      ],
      [
        'in jumps',
        (t) => {
          if (t >= jumpAt) {
            jumpTo = 0.8 + roll() * 0.17
            jumpAt = t + 0.2 + roll() * 2.4
          }
          return jumpTo
        },
      ],
      ['wavering at the change', (t) => 0.8515 + 0.0065 * Math.sin(t * 1.7)],
      ['wavering as it is let go', (t) => 0.9395 + 0.0065 * Math.sin(t * 2.3)],
    ]
    const from = CROSSWALK.x - CROSSWALK.half
    const until = CROSSWALK.x + CROSSWALK.half
    for (const [name, scroll] of scrolls) {
      const traffic = createTraffic(44, 77 + name.length)
      for (let step = 0; step < 500; step++) traffic.step(0.04, 0)
      const lens = { x: 0, y: 0, z: 0 }
      const all = watch()
      let heldFor = 0
      const dt = 1 / 30
      for (let step = 0; step < 40 * 30; step++) {
        const p = scroll(step * dt)
        const held = crossingHeld(p)
        walker(p, lens)
        traffic.step(dt, held, lens)
        for (const vehicle of traffic.vehicles) {
          if (!vehicle.shown) continue
          all.check(clearance(vehicle, lens) >= LENS_CLEAR, () => `${name}, step ${step}: a ${vehicle.kind} ${clearance(vehicle, lens).toFixed(2)} m from the lens`)
          if (held <= STRIPES_CLEAR) continue
          const reach = reachOf(vehicle.kind).x
          all.check(vehicle.x + reach < from || vehicle.x - reach > until, () => `${name}, step ${step} (p ${p.toFixed(4)}): a ${vehicle.kind} at ${vehicle.x.toFixed(2)} on the stripes`)
        }
        if (held > STRIPES_CLEAR) heldFor++
        if (step % 4 === 0) all.check(tightest(traffic) > 0.5, () => `${name}, step ${step}: two of them ${tightest(traffic).toFixed(2)} m apart`)
      }
      all.done()
      // (It was held for some of that, or this has shown nothing.)
      expect(heldFor, name).toBeGreaterThan(60)
    }
  })

  it('waits short of a walk that steps into the road at the line itself, and not at the line', () => {
    // The walk does not have to cross on the stripes. Here it goes straight
    // over a metre before the near side's stop line: a car waiting at that
    // line would be standing on the lens.
    const reach = (vehicle: Vehicle) => reachOf(vehicle.kind).x
    const near = LANES.filter((lane) => lane.going > 0).map((lane) => lane.z)
    const out = CROSSWALK.x - CROSSWALK.half - CROSSWALK.stop - 1
    for (const seed of [3, 11, 29]) {
      const roll = dice(seed)
      const traffic = createTraffic(44, 1000 + seed)
      for (let step = 0; step < 800 + Math.floor(roll() * 400); step++) traffic.step(0.04, 0)
      const lens = { x: out, y: 1.9, z: STREET_Z + ROAD + 1 }
      const dt = 1 / 30
      // Thirty seconds to the far kerb, at a stroll.
      const steps = 30 * 30
      const all = watch()
      const was = traffic.vehicles.map(() => ({ s: 0, v: 0 }))
      for (let step = 0; step < steps; step++) {
        lens.z = STREET_Z + ROAD + 1 - ((ROAD * 2 + 2) * step) / steps
        traffic.vehicles.forEach((vehicle, i) => {
          was[i]!.s = vehicle.s
          was[i]!.v = vehicle.v
        })
        // The lights change as it steps off the kerb, over a second.
        traffic.step(dt, Math.min(1, step / 30), lens)
        traffic.vehicles.forEach((vehicle, i) => {
          if (!vehicle.shown) return
          all.check(clearance(vehicle, lens) >= LENS_CLEAR, () => `seed ${seed} step ${step}: a ${vehicle.kind} ${clearance(vehicle, lens).toFixed(2)} m from the lens`)
          if (!near.includes(vehicle.z) || step < 90) return
          // Once the lights have changed, its own side of the road is empty from a stride short of the walk to the far edge of the stripes…
          const clear = vehicle.x + reach(vehicle) < out - 1.5 || vehicle.x - reach(vehicle) > CROSSWALK.x + CROSSWALK.half
          all.check(clear, () => `seed ${seed} step ${step}: a ${vehicle.kind} at ${vehicle.x.toFixed(1)}, in the way`)
          // …and nothing that is waiting there is shoved: whatever goes forwards is driving.
          const went = ((((vehicle.s - was[i]!.s) % TRAFFIC_RING) + TRAFFIC_RING + TRAFFIC_RING / 2) % TRAFFIC_RING) - TRAFFIC_RING / 2
          if (vehicle.x < out) all.check(went <= Math.max(was[i]!.v, vehicle.v) * dt + 1e-6, () => `seed ${seed} step ${step}: a ${vehicle.kind} shoved ${went.toFixed(2)} m`)
        })
      }
      all.done()
      // A queue short of where it stepped out, brake lights on; and on the far side one at that side's own line.
      const waiting = traffic.vehicles.filter((vehicle) => vehicle.shown && vehicle.v < 0.05)
      const mine = waiting.filter((vehicle) => near.includes(vehicle.z))
      expect(mine.length, `seed ${seed}`).toBeGreaterThan(3)
      expect(waiting.length - mine.length, `seed ${seed}`).toBeGreaterThan(3)
      for (const z of near) {
        const first = mine.filter((vehicle) => vehicle.z === z).sort((a, b) => b.x - a.x)[0]!
        expect(first.braking).toBe(true)
        // Not at its line, which is a metre past the walk: short of the walk, by what the lens keeps and a little more.
        expect(first.x + first.length / 2).toBeLessThan(out - LENS_CLEAR)
        expect(first.x + first.length / 2).toBeGreaterThan(out - LENS_CLEAR - 4)
      }
      for (const vehicle of waiting) if (!near.includes(vehicle.z)) expect(vehicle.x - reach(vehicle)).toBeGreaterThan(CROSSWALK.x + CROSSWALK.half)
      // And when the crossing is given back, they go: the front of each queue at once, the back of it in its turn.
      const away = { x: CROSSWALK.x, y: 1.6, z: STREET_Z - ROAD - 3 }
      for (let step = 0; step < 100; step++) traffic.step(0.05, 0, away)
      expect(traffic.vehicles.filter((vehicle) => vehicle.v > 3).length).toBeGreaterThan(6)
      for (let step = 0; step < 600; step++) traffic.step(0.05, 0, away)
      expect(traffic.vehicles.filter((vehicle) => vehicle.v > 3).length).toBeGreaterThan(traffic.vehicles.length * 0.6)
    }
  })

  it('never comes within a metre and a half of the lens, wherever a scroll puts it', () => {
    const roll = dice(31)
    const traffic = createTraffic(44)
    const lens: { x: number; y: number; z: number } = { x: CROSSWALK.x, y: 1.8, z: LANES[3]!.z + 4 }
    const least = () => {
      let nearest = Infinity
      for (const vehicle of traffic.vehicles) if (vehicle.shown) nearest = Math.min(nearest, clearance(vehicle, lens))
      return nearest
    }
    const all = watch()
    for (let step = 0; step < 12000; step++) {
      const r = roll()
      if (r < 0.01) {
        // A jump: anywhere along the street, anywhere across it, at any height a camera has.
        lens.x = STREET_START + roll() * STREET_LENGTH
        lens.z = LANES[0]!.z - 4 + roll() * (LANES[3]!.z - LANES[0]!.z + 8)
        lens.y = 1.2 + roll() * roll() * 14
      } else if (r < 0.6) {
        // A walk: across the road and along it, a little at a time.
        lens.z += (roll() - 0.5) * 0.5
        lens.x += (roll() - 0.5) * 0.4
      }
      // With the lights against the traffic or not, with the clock running or stopped.
      traffic.step(roll() < 0.1 ? 0 : roll() * 0.06, roll() < 0.5 ? 1 : 0, lens)
      all.check(least() >= LENS_CLEAR, () => `step ${step}, lens ${lens.x.toFixed(1)},${lens.y.toFixed(1)},${lens.z.toFixed(1)}: ${least().toFixed(3)} m from it`)
      if (step % 4 === 0) all.check(tightest(traffic) > 0.5, () => `step ${step}: two of them ${tightest(traffic).toFixed(2)} m apart`)
    }
    all.done()
  })

  it('takes whatever it is handed for time and for a lens', () => {
    const traffic = createTraffic(20)
    for (const dt of [NaN, -1, Infinity, 0, 1e9]) traffic.step(dt, NaN, { x: NaN, y: Infinity, z: -Infinity })
    traffic.step(0.03, 0, null)
    for (const vehicle of traffic.vehicles) for (const value of [vehicle.s, vehicle.v, vehicle.x, vehicle.z, vehicle.travelled]) expect(Number.isFinite(value)).toBe(true)
  })
})
