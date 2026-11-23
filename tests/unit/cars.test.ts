import { describe, expect, it } from 'vitest'
import { ARCH_GAP, MAX_DECALS, MAX_OUTLINE, PART, VEHICLE_KINDS, VEHICLE_SHAPES, plateAt, skinAt, vehicleMesh, wheelReach, type VehicleKind } from '@/components/three/evoCarShapes'
import { carTexts } from '@/components/three/evoCarText'
import { BUS_STOP, CROSSWALK, LANES, ROAD, STREET_LENGTH, STREET_START, STREET_Z, crossingHeld } from '@/components/three/evoStreet'
import { AMBER, LENS_CLEAR, MIX, PAINT, PULL_IN, RED, STOP_LANE, STOP_NOSE_X, STRIPES_CLEAR, TRAFFIC_RING, createTraffic, dealKinds, stopLine, type Traffic, type Vehicle } from '@/components/three/evoTraffic'
import { allFinite, bounds, components, openEdges, volume } from './mesh'

/**
 * The traffic of the long walk: the bodies of the cars a street in Tashkent
 * is full of, made out of numbers, and the way they are driven. Neither needs
 * a renderer — a body is typed arrays that can be measured, and the driving is
 * handed time a step at a time — so an hour of a busy street is run here in a
 * blink, and what has to be true of it at every step is asked at every step.
 */

/** A generator of its own, so that a failure is the same failure every run. */
function dice(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    return a / 4294967296
  }
}

/** The real cars the bodies are after, as published: length, width, height and wheelbase, in metres. */
const REAL: Partial<Record<VehicleKind, readonly [number, number, number, number]>> = {
  cobalt: [4.48, 1.735, 1.51, 2.62],
  nexia: [4.48, 1.66, 1.39, 2.52],
  gentra: [4.52, 1.725, 1.445, 2.6],
  damas: [3.49, 1.4, 1.91, 1.84],
  matiz: [3.5, 1.495, 1.5, 2.34],
  zhiguli: [4.15, 1.62, 1.44, 2.42],
  byd: [4.705, 1.89, 1.68, 2.765],
  malibu: [4.92, 1.855, 1.465, 2.83],
}

describe('the bodies', () => {
  for (const kind of VEHICLE_KINDS) {
    const shape = VEHICLE_SHAPES[kind]
    for (const detail of ['near', 'far'] as const) {
      const mesh = vehicleMesh(kind, detail)

      it(`${kind}, ${detail}: one closed skin, right way out, and close up a mirror either side`, () => {
        expect(allFinite(mesh.positions)).toBe(true)
        // The body, and the two pods of its mirrors: nothing else, and no holes in any of them.
        expect(components(mesh)).toBe(detail === 'near' ? 3 : 1)
        expect(openEdges(mesh)).toBe(0)
        // Wound to face outwards: a mesh that is inside out encloses less than nothing.
        const box = shape.length * shape.width * shape.height
        expect(volume(mesh)).toBeGreaterThan(box * 0.45)
        expect(volume(mesh)).toBeLessThan(box)
      })

      it(`${kind}, ${detail}: every face one thing, with a normal that is a normal`, () => {
        const { position, normal, part, body, index } = mesh.draw
        const count = position.length / 3
        expect(normal.length).toBe(count * 3)
        expect(part.length).toBe(count)
        expect(body.length).toBe(count * 2)
        expect(allFinite(position)).toBe(true)
        let worst = 0
        for (let v = 0; v < count; v++) worst = Math.max(worst, Math.abs(Math.hypot(normal[v * 3]!, normal[v * 3 + 1]!, normal[v * 3 + 2]!) - 1))
        expect(worst).toBeLessThan(1e-4)
        // A triangle's three corners agree about what it is made of, and about whether it is the side of the body
        // that doors are drawn on: paint, below the glass.
        const made = new Set<number>()
        let sides = 0
        let bad = ''
        // Nothing of a door above the belt line, wherever along the body that is highest.
        const beltTop = Math.max(shape.cabin.belt + 0.12, ...shape.belt.map((key) => key[1] + 0.005))
        for (let t = 0; t < index.length; t += 3) {
          const a = part[index[t]!]!
          const side = body[index[t]! * 2]!
          if (part[index[t + 1]!] !== a || part[index[t + 2]!] !== a) bad ||= `triangle ${t / 3} is two things`
          if (body[index[t + 1]! * 2] !== side || body[index[t + 2]! * 2] !== side) bad ||= `triangle ${t / 3} is half a door`
          made.add(a)
          if (side === 0) continue
          sides++
          if (a !== PART.paint) bad ||= `a door of something other than paint`
          for (const corner of [index[t]!, index[t + 1]!, index[t + 2]!]) {
            const up = body[corner * 2 + 1]!
            if (up < 0 || up > 1 || position[corner * 3 + 1]! > beltTop) bad ||= `a door corner at ${up}, ${position[corner * 3 + 1]}`
          }
        }
        expect(bad).toBe('')
        for (const needed of [PART.paint, PART.glass, PART.trim, PART.under]) expect(made.has(needed), `part ${needed}`).toBe(true)
        expect(sides).toBeGreaterThan(detail === 'near' ? 100 : 30)
        // And they face the way the skin does: out, on the whole, from the middle of the car.
        let out = 0
        const middle = shape.height * 0.5
        for (let v = 0; v < count; v++) {
          const dot = normal[v * 3]! * position[v * 3]! * 0.2 + normal[v * 3 + 1]! * (position[v * 3 + 1]! - middle) + normal[v * 3 + 2]! * position[v * 3 + 2]!
          if (dot > 0) out++
        }
        expect(out / count).toBeGreaterThan(0.9)
      })
    }

    it(`${kind}: the size of the car it is after, standing on its wheels`, () => {
      const real = REAL[kind]
      if (real) {
        const [length, width, height, wheelbase] = real
        // Within a few per cent of the real thing, every way.
        expect(Math.abs(shape.length / length - 1)).toBeLessThan(0.03)
        expect(Math.abs(shape.width / width - 1)).toBeLessThan(0.03)
        expect(Math.abs(shape.height / height - 1)).toBeLessThan(0.03)
        expect(Math.abs((shape.axles[0] - shape.axles[1]) / wheelbase - 1)).toBeLessThan(0.03)
      }
      // And the mesh is the size the numbers say: its length, domes and all, its height.
      const { min, max } = bounds(vehicleMesh(kind, 'near').positions)
      expect(max[0] - min[0]).toBeCloseTo(shape.length, 2)
      expect(max[1]).toBeGreaterThan(shape.height - 0.02)
      expect(max[1]).toBeLessThan(shape.height + 0.02)
      const body = bounds(vehicleMesh(kind, 'far').positions)
      expect(Math.abs((body.max[2] * 2) / shape.width - 1)).toBeLessThan(0.015)
      expect(body.max[2]).toBeCloseTo(-body.min[2], 5)
      // Clear of the road by what it says; mirrors stand out past the body and nothing else does.
      expect(min[1]).toBeGreaterThan(shape.clearance - 0.01)
      expect(max[2]).toBeLessThan(shape.width / 2 + 0.35)
    })

    it(`${kind}: four wheels, each inside its arch`, () => {
      const { positions } = vehicleMesh(kind, 'near')
      const { radius, width } = shape.wheel
      const reach = wheelReach(shape)
      let bad = ''
      for (const axle of shape.axles) {
        for (const side of [1, -1]) {
          const z = side * reach
          // Nothing of the body inside the tyre.
          let over = Infinity
          let outside = 0
          for (let v = 0; v < positions.length / 3; v++) {
            const px = positions[v * 3]!
            const py = positions[v * 3 + 1]!
            const pz = positions[v * 3 + 2]!
            if (Math.abs(px - axle) < radius) outside = Math.max(outside, Math.abs(pz))
            if (Math.abs(pz - z) > width / 2) continue
            if (Math.hypot(px - axle, py - radius) < radius - 0.004) bad ||= `${kind}: the body inside the wheel at ${axle}, ${side}`
            // The arch over it: the lowest of the body straight above the tyre.
            if (Math.abs(px - axle) < 0.06 && py > radius) over = Math.min(over, py)
          }
          // The arch hugs the tyre: not far above it, and not into it.
          if (!(over > radius * 2 && over < radius * 2 + ARCH_GAP + 0.06)) bad ||= `${kind}: the arch at ${axle} is ${over - radius * 2} above the tyre`
          // And the tyre's outer face is inside the body's side, give or take its bulge.
          if (reach + width / 2 > outside + 0.005) bad ||= `${kind}: the wheel at ${axle} stands out of the body by ${reach + width / 2 - outside}`
          // And it is under the body, not off an end of it.
          if (Math.abs(axle) + radius > shape.length / 2 - 0.1) bad ||= `${kind}: a wheel off the end`
        }
      }
      expect(bad).toBe('')
    })
  }

  it('what is drawn on a body has skin to be drawn on, and room in the shader', () => {
    for (const kind of VEHICLE_KINDS) {
      const shape = VEHICLE_SHAPES[kind]
      const { position, part, index } = vehicleMesh(kind).draw
      const half = shape.length / 2
      expect(shape.decals.length, kind).toBeLessThanOrEqual(MAX_DECALS)
      // A headlamp on the nose and a red lamp on the tail, at least, on every body.
      expect(shape.decals.some((decal) => decal.end > 0 && decal.kind === 'head'), `${kind} headlamp`).toBe(true)
      expect(shape.decals.some((decal) => decal.end < 0 && (decal.kind === 'tail' || decal.kind === 'redbar')), `${kind} tail lamp`).toBe(true)
      for (const decal of shape.decals) {
        expect(decal.at.length, kind).toBeGreaterThanOrEqual(3)
        expect(decal.at.length, kind).toBeLessThanOrEqual(MAX_OUTLINE)
        for (const [u, y] of decal.at) {
          // On the end, or a little way round its corner (an outline on the middle may reach past it, mirrored); between the road and the roof.
          expect(u, `${kind} ${decal.kind}`).toBeGreaterThan(-0.2)
          expect(u, `${kind} ${decal.kind}`).toBeLessThan(shape.width / 2 + 0.55)
          expect(y, `${kind} ${decal.kind}`).toBeGreaterThan(shape.clearance - 0.02)
          expect(y, `${kind} ${decal.kind}`).toBeLessThan(shape.height)
        }
      }
      // Every lamp has skin under it: painted faces at its end, at its height.
      for (const decal of shape.decals.filter((each) => each.kind === 'head' || each.kind === 'tail')) {
        const ys = decal.at.map((p) => p[1])
        const lo = Math.min(...ys)
        const hi = Math.max(...ys)
        let found = 0
        for (let t = 0; t < index.length; t += 3) {
          if (part[index[t]!] !== PART.paint) continue
          const v = index[t]! * 3
          if (half - decal.end * position[v]! < 0.5 && position[v + 1]! > lo - 0.03 && position[v + 1]! < hi + 0.03) found++
        }
        expect(found, `${kind} ${decal.kind}`).toBeGreaterThan(4)
      }
      // The windows, where they are drawn: inside the body's length, from the belt to under the roof.
      if (shape.windows) {
        expect(shape.windows.outline.length).toBeLessThanOrEqual(MAX_OUTLINE)
        for (const [x, y] of shape.windows.outline) {
          expect(Math.abs(x), kind).toBeLessThan(half)
          // (Its top may run past the roof rail: the band it is drawn in is what clips it.)
          expect(y, kind).toBeGreaterThan(shape.clearance + 0.4)
          expect(y, kind).toBeLessThan(shape.height + 0.1)
        }
        expect(shape.windows.bars.length).toBeLessThanOrEqual(4)
      }
      // A plate on each end, clear of the skin all over by a finger and no more in the middle — on
      // the skin, whatever shape the end is, and never in it.
      const mesh = vehicleMesh(kind)
      for (const end of [1, -1] as const) {
        const x = plateAt(shape, end)
        const y = end > 0 ? shape.plates.front : shape.plates.back
        const middle = skinAt(mesh, y, 0, end)
        expect(end * (x - middle), `${kind} plate off the skin`).toBeGreaterThan(0.005)
        expect(end * (x - middle), `${kind} plate off the skin`).toBeLessThan(0.02)
        for (const [dy, dz] of [[-0.056, -0.26], [-0.056, 0.26], [0.056, -0.26], [0.056, 0.26]] as const) {
          expect(end * (x - skinAt(mesh, y + dy, dz, end)), `${kind} plate's corner in the skin`).toBeGreaterThan(0)
        }
      }
      for (const [end, y] of [
        [1, shape.plates.front],
        [-1, shape.plates.back],
      ] as const) {
        expect(y - 0.056, `${kind} plate`).toBeGreaterThan(shape.clearance)
        // Not over a lamp.
        for (const decal of shape.decals.filter((each) => each.end === end && (each.kind === 'head' || each.kind === 'tail'))) {
          const us = decal.at.map((p) => p[0])
          const ys = decal.at.map((p) => p[1])
          const overlaps = Math.min(...us) < 0.26 && Math.max(...ys) > y - 0.056 && Math.min(...ys) < y + 0.056
          expect(overlaps, `${kind} plate under a ${decal.kind}`).toBe(false)
        }
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
      // A route card, where there is one, stands behind the windscreen and inside the cab.
      if (shape.card) {
        expect(shape.card.x).toBeLessThan(shape.glass.front[0])
        expect(shape.card.x).toBeGreaterThan(cabin.seats?.[0] ?? -half)
        expect(shape.card.y - shape.card.tall / 2).toBeGreaterThan(cabin.belt)
        expect(Math.abs(shape.card.z) + shape.card.wide / 2).toBeLessThan(cabin.half)
      }
    }
  })

  it('costs, close up, about what a car always has, and far off half of it', () => {
    for (const kind of VEHICLE_KINDS) {
      const near = vehicleMesh(kind, 'near').draw.index.length / 3
      const far = vehicleMesh(kind, 'far').draw.index.length / 3
      expect(near, kind).toBeLessThan(kind === 'bus' ? 7600 : 8000)
      expect(far / near, kind).toBeLessThan(0.56)
    }
  })
})

describe('the fleet', () => {
  it('is mixed as the city is, however few of them there are', () => {
    const shares = new Map(MIX.map(([kind, share]) => [kind, share]))
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    for (const count of [9, 19, 30, 42, 200]) {
      const kinds = dealKinds(count)
      for (const [kind, share] of shares) {
        const dealt = kinds.filter((each) => each === kind).length
        // Never more than one car off what its share of the street would be.
        expect(Math.abs(dealt - share * count), `${kind} in ${count}`).toBeLessThan(1)
      }
    }
  })

  it('is mostly white, half the microvans are minibuses on routes, and a few sedans are taxis', () => {
    for (const count of [10, 20, 32, 44]) {
      const traffic = createTraffic(count)
      const cars = traffic.vehicles.filter((vehicle) => vehicle.kind !== 'bus')
      const white = cars.filter((vehicle) => vehicle.paint === PAINT.white || vehicle.paint === PAINT.cream).length
      expect(white / cars.length, `${count}`).toBeGreaterThan(0.5)
      const vans = cars.filter((vehicle) => vehicle.kind === 'damas')
      const minibuses = vans.filter((vehicle) => vehicle.role === 'minibus')
      expect(minibuses.length).toBe(Math.ceil(vans.length / 2))
      for (const minibus of minibuses) {
        expect(minibus.lane).toBe(STOP_LANE)
        expect(minibus.look.card).toBeGreaterThanOrEqual(0)
      }
      for (const vehicle of traffic.vehicles) if (vehicle.role !== 'minibus') expect(vehicle.look.card).toBe(-1)
      // Taxis are sedans, and there are a few of them once there is traffic.
      const taxis = traffic.vehicles.filter((vehicle) => vehicle.role === 'taxi')
      for (const taxi of taxis) expect(['cobalt', 'nexia', 'gentra']).toContain(taxi.kind)
      if (count >= 32) expect(taxis.length).toBeGreaterThan(0)
      // The old Soviet sedans are faded, and wear both their faces.
      const old = traffic.vehicles.filter((vehicle) => vehicle.kind === 'zhiguli')
      for (const car of old) expect(car.look.fade).toBeGreaterThan(0.5)
      if (old.length > 1) expect(new Set(old.map((car) => car.look.variant)).size).toBe(2)
    }
  })

  it('draws no name of a maker or a model on anything', () => {
    const banned = /chevrolet|daewoo|ravon|uzauto|byd|lada|vaz|nexia|cobalt|damas|gentra|lacetti|matiz|spark|malibu|zhiguli|jiguli/i
    const texts = carTexts()
    expect(texts.length).toBeGreaterThan(10)
    for (const text of texts) expect(text, text).not.toMatch(banned)
  })
})

describe('the bus stop', () => {
  it('is where the buses and the minibuses stop, pulled in, for a while; and nothing else stops there', () => {
    const traffic = createTraffic(44)
    const lane = LANES[STOP_LANE]!
    const stoppers = traffic.vehicles.filter((vehicle) => vehicle.stops)
    expect(stoppers.length).toBeGreaterThan(2)
    for (const vehicle of stoppers) expect(['bus', 'minibus']).toContain(vehicle.role)
    const stood = new Map<Vehicle, number[]>()
    const started = new Map<Vehicle, number>()
    const all = watch()
    const dt = 0.05
    // Twelve minutes of the street, with the crossing held for a minute in every four.
    for (let step = 0; step < 12 * 60 * 20; step++) {
      const held = step % 4800 < 1200 ? 1 : 0
      traffic.step(dt, held)
      for (const vehicle of traffic.vehicles) {
        const nose = vehicle.x + (vehicle.going * vehicle.length) / 2
        if (vehicle.dwell > 0) {
          all.check(vehicle.stops && vehicle.lane === STOP_LANE, () => `step ${step}: a ${vehicle.kind} (${vehicle.role}) stopping at the shelter`)
          all.check(Math.abs(nose - STOP_NOSE_X) < 0.7, () => `step ${step}: a ${vehicle.role} standing at the stop with its nose at ${nose.toFixed(2)}`)
          all.check(vehicle.v === 0, () => `step ${step}: a ${vehicle.role} moving while it stands at the stop`)
          // Its doors to the kerb: pulled over that way, all of it inside the bay.
          all.check(lane.z - vehicle.z > PULL_IN * 0.6, () => `step ${step}: a ${vehicle.role} at the stop not pulled in (${(lane.z - vehicle.z).toFixed(2)})`)
          const tail = vehicle.x - (vehicle.going * vehicle.length) / 2
          all.check(Math.max(nose, tail) < BUS_STOP.x + BUS_STOP.bay / 2 + 0.01 && Math.min(nose, tail) > BUS_STOP.x - BUS_STOP.bay / 2 - 0.01, () => `step ${step}: a ${vehicle.role} sticking out of the bay`)
          if (!started.has(vehicle)) started.set(vehicle, step)
        } else if (started.has(vehicle)) {
          const list = stood.get(vehicle) ?? []
          list.push((step - started.get(vehicle)!) * dt)
          stood.set(vehicle, list)
          started.delete(vehicle)
        }
        // Nothing but what stops there is ever off the middle of its lane.
        if (!(vehicle.stops && vehicle.lane === STOP_LANE)) all.check(vehicle.z === LANES[vehicle.lane]!.z, () => `step ${step}: a ${vehicle.kind} off the middle of its lane`)
        // And nothing else stands in the bay unless it is queueing behind something that does.
        if (!vehicle.stops && vehicle.lane === STOP_LANE && vehicle.shown && vehicle.v < 0.05 && Math.abs(nose - BUS_STOP.x) < BUS_STOP.bay / 2) {
          const ahead = traffic.vehicles.filter((other) => other.lane === STOP_LANE && other !== vehicle && other.shown && (vehicle.x - other.x) * -vehicle.going < 0)
          const gap = Math.min(...ahead.map((other) => Math.abs(other.x - vehicle.x) - (other.length + vehicle.length) / 2))
          all.check(gap < 6 || held > 0, () => `step ${step}: a ${vehicle.kind} standing at the stop with ${gap.toFixed(1)} m of road ahead of it`)
        }
      }
    }
    all.done()
    // Every one of them stopped there, again and again, for as long as it should.
    for (const vehicle of stoppers.filter((each) => each.lane === STOP_LANE)) {
      const times = stood.get(vehicle) ?? []
      expect(times.length, `${vehicle.role}`).toBeGreaterThan(2)
      for (const time of times) {
        expect(time).toBeGreaterThan(vehicle.role === 'bus' ? 7.9 : 4.9)
        expect(time).toBeLessThan(vehicle.role === 'bus' ? 12.1 : 8.1)
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
        // (What stops at the shelter pulls over towards that kerb, a little, and only that way.)
        const off = LANES[vehicle.lane]!.z - vehicle.z
        const kept = vehicle.stops && vehicle.lane === STOP_LANE ? off >= -1e-9 && off <= PULL_IN + 1e-9 : off === 0
        all.check(kept && vehicle.going === LANES[vehicle.lane]!.going, () => `step ${step}: a ${vehicle.kind} out of its lane`)
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
    // (A minute and a half: a bus that was standing at its stop when the lights changed has the whole lap still to come.)
    for (let step = 0; step < 2250; step++) traffic.step(0.04, 1)
    const from = CROSSWALK.x - CROSSWALK.half
    const until = CROSSWALK.x + CROSSWALK.half
    let waiting = 0
    for (const vehicle of traffic.vehicles) {
      // A minute and a half on, everything has stopped.
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
      // (Not counting what is standing at the bus stop further down, or queueing behind something that is: that is waiting for something else.)
      const waiting = traffic.vehicles.filter((vehicle) => vehicle.shown && vehicle.v < 0.05 && !(vehicle.lane === STOP_LANE && vehicle.x < CROSSWALK.x - 30))
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
