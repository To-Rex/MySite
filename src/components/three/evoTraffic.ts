import { VEHICLE_SHAPES, type VehicleKind } from './evoCarShapes'
import { CROSSWALK, LANES, ROAD, STREET_LENGTH, STREET_START, STREET_Z } from './evoStreet'

/**
 * How the traffic of the long walk moves.
 *
 * Not on rails, as it was — a car a set distance down its lane for a set time
 * on the clock, through whatever was in front of it — but driven: each one
 * keeps a gap to the one ahead that grows with its speed, brakes for what is
 * stopped, waits at the crossing while the walk is on it and pulls away when
 * the walk is off it. (The rule is the Intelligent Driver Model, which is four
 * lines and is what a queue forming and clearing looks like.)
 *
 * It keeps its own time: the city does not wait for the scroll. But where the
 * scroll has the camera is the one thing it must know, because the walk
 * crosses the road and nothing may be driven through the lens. Whatever is
 * coming stops short of it; and if the camera is put down where a car already
 * is — a scroll can jump — the car is moved out of the way, there and then.
 *
 * The crossing has lights, and `held` is what drives them: amber as it
 * starts to be held, red once it mostly is, and by the time whoever is on
 * foot is across the kerb there is nothing on the stripes at all. On amber a
 * driver who can pull up before the line does, and one who cannot goes over;
 * on red nothing crosses the line, whatever it takes to stop there. What is
 * already over it drives off the crossing — and since how long that has is
 * up to the scroll, which can cover the whole change in a tenth of a second,
 * the last of the way is not left to the driving: between red and the
 * moment the stripes have to be empty, anything still on them is carried
 * through as far as the change itself has gone.
 *
 * And the walk does not have to cross between the stop lines. If it steps
 * into the road at one, or short of it, while the lights are against the
 * traffic, what is coming waits short of where it stepped out and not at
 * the line — a driver gives way to who is in front of the car, wherever the
 * paint is — and once a queue has formed there it stays there.
 *
 * No three.js and no clock of its own: it is handed time a step at a time,
 * which is what lets a test run an hour of it.
 */

/** A lane is a ring: off its far end, round the back out of sight, and on again at its near one. */
const OFFSTAGE = 44
export const TRAFFIC_RING = STREET_LENGTH + OFFSTAGE

/** How close the body of anything may come to the camera, and the slack kept on top of it. */
export const LENS_CLEAR = 1.5
const LENS_SLACK = 0.45
/** The least air between two bumpers, whatever has happened. */
const BUMPER = 0.7
/** How far short of someone crossing a driver stops, on top of that; and how near a kerb, and how low, counts as crossing. */
const GIVE_WAY = 1.6
const KERB_REACH = 1.5
const WALKING = 6

/**
 * The lights at the crossing, by how far it is held: amber from the first of
 * these, red from the second, and nothing on the stripes from the third. (The
 * street draws its lamps from the same two numbers.)
 */
export const AMBER = 0.06
export const RED = 0.55
export const STRIPES_CLEAR = 0.9
/** How hard a driver will brake to stop for amber, and how far past the paint the stripes are kept clear. */
const WILLING = 6
const STRIPES_MARGIN = 0.3

/** Driving: how hard it pulls away, brakes when it sees it coming, and brakes when it did not. */
const PULL = 1.5
const EASE = 2.3
const HARD = 7.5
/** Seconds kept behind the one in front, and metres kept when both are stopped. */
const HEADWAY = 1.25
const STANDING = 2.1

export interface Vehicle {
  kind: VehicleKind
  /** Which paint, as an index the scene has colours for. */
  paint: number
  lane: number
  length: number
  width: number
  height: number
  /** Metres along its lane to the middle of it, from where the lane comes on. */
  s: number
  /** Metres a second, and what it would do with the road to itself. */
  v: number
  cruise: number
  /** Whether its brake lights are on. */
  braking: boolean
  /** Metres it has covered since it was made: its wheels turn by this. */
  travelled: number
  /** In the world: the middle of it, which way it faces (+1 along +x), and whether it is on the street at all. */
  x: number
  z: number
  going: 1 | -1
  shown: boolean
}

export interface Traffic {
  vehicles: readonly Vehicle[]
  /**
   * Moves everything on by `dt` seconds. `held` is how far the crossing is
   * held against the traffic, 0 to 1; `lens` is where the camera is.
   */
  step(dt: number, held: number, lens?: { x: number; y: number; z: number } | null): void
}

/** Where, along its lane, each lane's stop line is. */
export function stopLine(lane: number): number {
  const going = LANES[lane]?.going ?? 1
  const x = going > 0 ? CROSSWALK.x - CROSSWALK.half - CROSSWALK.stop : CROSSWALK.x + CROSSWALK.half + CROSSWALK.stop
  return going > 0 ? x - STREET_START : STREET_START + STREET_LENGTH - x
}

/** And where a place in the world is along it. */
const along = (lane: number, x: number): number => ((LANES[lane]?.going ?? 1) > 0 ? x - STREET_START : STREET_START + STREET_LENGTH - x)

/** Where, along its lane, the far edge of the stripes is, and the little past it that is kept clear with them. */
const stripesEnd = (lane: number): number => along(lane, CROSSWALK.x + (LANES[lane]?.going ?? 1) * (CROSSWALK.half + STRIPES_MARGIN))

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * What is on the street: mostly saloons and small hatchbacks, a few of the
 * rest. Dealt in this order over and over, so that ten cars are as mixed as
 * forty: a street of nothing but saloons is a roll of the dice away otherwise.
 */
const DEAL: readonly VehicleKind[] = ['saloon', 'hatch', 'crossover', 'saloon', 'van', 'hatch', 'saloon', 'crossover', 'saloon', 'hatch']
/**
 * And what colour: most of them white, which is the first thing anyone who
 * has stood on a street in Tashkent would say about it. The numbers are
 * indices into the scene's paints: 0 is white.
 */
const PAINTS: readonly [number, number][] = [
  [0, 0.6],
  [1, 0.13],
  [2, 0.1],
  [3, 0.08],
  [4, 0.03],
  [5, 0.03],
  [6, 0.03],
]
/** A bus is the one colour buses are. */
export const BUS_PAINT = 7
export const PAINT_COUNT = 8

function pick<T>(table: readonly (readonly [T, number])[], roll: number): T {
  let sum = 0
  for (const [value, share] of table) {
    sum += share
    if (roll < sum) return value
  }
  return table[table.length - 1]![0]
}

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)

/**
 * The acceleration a driver chooses with something `gap` metres ahead that is
 * closing at `closing` metres a second, wanting `standing` metres left when
 * both have stopped.
 */
function follow(v: number, cruise: number, gap: number, closing: number, standing: number): number {
  const wanted = standing + Math.max(0, v * HEADWAY + (v * closing) / (2 * Math.sqrt(PULL * EASE)))
  const free = 1 - Math.pow(v / Math.max(cruise, 0.1), 4)
  const near = wanted / Math.max(gap, 0.05)
  return PULL * (free - near * near)
}

export function createTraffic(count: number, seed = 20261123): Traffic {
  const random = mulberry(seed)
  const lanes: Vehicle[][] = LANES.map(() => [])
  const total = Math.max(0, Math.floor(count))
  // Buses keep to the kerb: one in the near kerb lane, and with enough traffic one in the far.
  const kerbs = [LANES.length - 1, 0]
  const buses = total >= 28 ? 2 : total >= 8 ? 1 : 0

  const make = (kind: VehicleKind, lane: number, paint: number): Vehicle => {
    const shape = VEHICLE_SHAPES[kind]
    const cruise = kind === 'bus' ? 8.5 + random() * 1.5 : kind === 'van' ? 9 + random() * 2.5 : 10 + random() * 4.5
    return {
      kind,
      paint,
      lane,
      length: shape.length,
      width: shape.width,
      height: shape.height,
      s: 0,
      v: cruise * 0.8,
      cruise,
      braking: false,
      travelled: random() * 10,
      x: 0,
      z: LANES[lane]!.z,
      going: LANES[lane]!.going,
      shown: false,
    }
  }
  for (let b = 0; b < buses; b++) lanes[kerbs[b]!]!.push(make('bus', kerbs[b]!, BUS_PAINT))
  for (let i = buses; i < total; i++) {
    // Dealt out lane by lane, so that no lane is empty while another is full.
    const lane = (i * 3 + 1) % LANES.length
    const kind = DEAL[(i - buses) % DEAL.length]!
    // A van is a working thing: white, nearly always.
    const paint = kind === 'van' && random() < 0.8 ? 0 : pick(PAINTS, random())
    lanes[lane]!.push(make(kind, lane, paint))
  }
  // Spread round each ring, in the order they will keep: nothing overtakes.
  for (const lane of lanes) {
    const n = lane.length
    lane.forEach((vehicle, k) => {
      vehicle.s = ((k + 0.25 + random() * 0.5) / n) * TRAFFIC_RING
    })
    lane.sort((a, b) => a.s - b.s)
  }
  const vehicles = lanes.flat()

  const place = (vehicle: Vehicle): void => {
    vehicle.s = ((finite(vehicle.s) % TRAFFIC_RING) + TRAFFIC_RING) % TRAFFIC_RING
    vehicle.x = vehicle.going > 0 ? STREET_START + vehicle.s : STREET_START + STREET_LENGTH - vehicle.s
    const half = vehicle.length / 2
    vehicle.shown = vehicle.s - half > 0 && vehicle.s + half < STREET_LENGTH
  }
  for (const vehicle of vehicles) place(vehicle)

  /**
   * The gap from the nose of one to the tail of the one ahead of it, round the
   * ring. Nothing overtakes, so the one ahead is ahead: a gap that comes out
   * just short of a whole lap is two of them overlapping, and is given as that.
   */
  const gapTo = (me: Vehicle, ahead: Vehicle): number => {
    if (ahead === me) return TRAFFIC_RING - me.length
    const raw = ahead.s - ahead.length / 2 - (me.s + me.length / 2)
    const gap = ((raw % TRAFFIC_RING) + TRAFFIC_RING) % TRAFFIC_RING
    return gap > TRAFFIC_RING - 40 ? gap - TRAFFIC_RING : gap
  }

  /**
   * Where each lane waits while the crossing is held: at its stop line, or
   * short of where the walk stepped into the road if that was before the line.
   * Kept for as long as the crossing is held — once a queue has formed it does
   * not creep forward after whoever it stopped for.
   */
  const waitAt: number[] = LANES.map(() => Infinity)

  /** Scratch for putting a lane in order from the lens: how far ahead of it each vehicle is. */
  const ahead = new Map<Vehicle, number>()
  const order: Vehicle[] = []
  const byAhead = (p: Vehicle, q: Vehicle): number => ahead.get(p)! - ahead.get(q)!
  /** And for carrying things off the stripes: which of a lane have been moved. */
  const carried = new Uint8Array(Math.max(1, total))

  const lines = LANES.map((_, lane) => stopLine(lane))
  const ends = LANES.map((_, lane) => stripesEnd(lane))

  /** The stretch of a lane the lens keeps clear, in the lane's own metres: whether there is one, and where. */
  const zone = { from: 0, until: 0 }
  const lensZone = (laneIndex: number, lens: { x: number; y: number; z: number } | null | undefined, widest: number, tallest: number): boolean => {
    if (!lens) return false
    const lane = LANES[laneIndex]!
    const reach = LENS_CLEAR + LENS_SLACK
    if (Math.abs(finite(lens.z, 1e6) - lane.z) > widest / 2 + reach) return false
    if (finite(lens.y, 1e6) - reach > tallest) return false
    const at = along(laneIndex, finite(lens.x, 1e6))
    zone.from = at - reach
    zone.until = at + reach
    return true
  }

  function advance(dt: number, held: number, lens?: { x: number; y: number; z: number } | null): void {
    const against = held > AMBER
    const red = held >= RED
    // How far the change has gone from red to the stripes having to be empty.
    const sweep = red ? Math.min(1, (held - RED) / (STRIPES_CLEAR - RED)) : 0
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const lane = lanes[laneIndex]!
      const n = lane.length
      if (n === 0) continue
      let widest = 0
      let tallest = 0
      for (let k = 0; k < n; k++) {
        widest = Math.max(widest, lane[k]!.width)
        tallest = Math.max(tallest, lane[k]!.height)
      }
      const blocked = lensZone(laneIndex, lens, widest, tallest)
      const line = lines[laneIndex]!
      if (against) {
        // Someone in the road, on foot, with the line inside what the lens keeps clear, or beyond it:
        // nothing can wait at the line, so what is coming waits short of the walk instead.
        if (lens && Math.abs(finite(lens.z, 1e6) - STREET_Z) < ROAD + KERB_REACH && finite(lens.y, 1e6) < WALKING) {
          const clear = along(laneIndex, finite(lens.x, 1e6)) - LENS_CLEAR - LENS_SLACK
          if (clear < line) waitAt[laneIndex] = Math.min(waitAt[laneIndex]!, clear - GIVE_WAY)
        }
      } else {
        waitAt[laneIndex] = Infinity
      }
      const wait = waitAt[laneIndex]!

      for (let k = 0; k < n; k++) {
        const me = lane[k]!
        const front = lane[(k + 1) % n]!
        const nose = me.s + me.length / 2
        let a = follow(me.v, me.cruise, gapTo(me, front), me.v - front.v, STANDING)
        let stopping = false
        let barred = false
        // The lights: a wall at the line — or short of the walk, for whatever
        // is short of that; and whatever came to rest between there and the
        // walk, having braked for the walk itself, stays where it stopped. On
        // amber the wall is for whatever can still pull up before it — what
        // cannot is better across than stopped on the stripes. On red it is
        // for everything.
        const short = wait < line && nose <= wait + GIVE_WAY + 0.3
        const wall = short ? wait : line
        if (against && (short || nose <= line + 0.2)) {
          const room = wall - nose
          if (red || (me.v * me.v) / (2 * Math.max(room, 0.05)) <= WILLING || room > 14) {
            a = Math.min(a, follow(me.v, me.cruise, Math.max(room, 0), me.v, 0.35))
            stopping = room < 30
            barred = red
          }
        }
        // The lens: a wall nothing gets a say about.
        if (blocked && nose <= zone.from + 0.05) {
          a = Math.min(a, follow(me.v, me.cruise, zone.from - nose, me.v, 0.25))
          stopping = stopping || zone.from - nose < 20
        }
        a = Math.max(-HARD, Math.min(PULL, finite(a)))
        const before = me.v
        me.v = Math.max(0, Math.min(me.cruise * 1.05, me.v + a * dt))
        let moved = ((before + me.v) / 2) * dt
        // On red the line is not crossed: what braking could not stop in time, the line does.
        if (barred && moved > Math.max(0, wall - nose)) {
          moved = Math.max(0, wall - nose)
          me.v = 0
        }
        me.s += moved
        me.travelled += moved
        me.braking = a < -0.45 || (me.v < 0.4 && (stopping || gapTo(me, front) < STANDING + 2.5))
      }

      // What driving did not manage, arithmetic does. First the stripes:
      // whatever is past the line and not yet off the far side of them is at
      // least as far through as the change is from red to their being empty —
      // each making room for itself by moving on whatever is in front of it.
      if (sweep > 0) {
        const end = ends[laneIndex]!
        let any = false
        for (let k = 0; k < n; k++) {
          const me = lane[k]!
          carried[k] = 0
          if (me.s + me.length / 2 <= line + 0.2 || me.s - me.length / 2 >= end) continue
          const least = line - me.length / 2 + (end - line + me.length + 0.05) * sweep
          if (me.s >= least) continue
          me.travelled += least - me.s
          me.s = least
          carried[k] = 1
          any = true
        }
        if (any) {
          // From the hindmost of those, forwards round the lane.
          let first = 0
          for (let tries = 0; tries < n && (carried[first] === 0 || carried[(first - 1 + n) % n] === 1); tries++) first = (first + 1) % n
          for (let step = 0; step < n - 1; step++) {
            const k = (first + step) % n
            if (carried[k] === 0) continue
            const me = lane[k]!
            const next = (k + 1) % n
            const front = lane[next]!
            const gap = gapTo(me, front)
            if (gap < BUMPER) {
              front.s += BUMPER - gap
              front.travelled += BUMPER - gap
              carried[next] = 1
            }
          }
        }
      }

      if (blocked) {
        // The lens's stretch is a wall across the lane. Measured from the
        // middle of it round the ring, everything is either just past it or
        // (nearly a lap on) just short of it: the first are moved on until
        // they are clear, each making room for the one behind it, and the
        // second are moved back, each making room for the one ahead.
        const middle = (zone.from + zone.until) / 2
        const reach = (zone.until - zone.from) / 2
        order.length = 0
        for (let k = 0; k < n; k++) {
          const me = lane[k]!
          ahead.set(me, (((me.s - middle) % TRAFFIC_RING) + TRAFFIC_RING) % TRAFFIC_RING)
          order.push(me)
        }
        order.sort(byAhead)
        let least = reach + 0.02
        for (let k = 0; k < n; k++) {
          const me = order[k]!
          const at = ahead.get(me)!
          if (at > TRAFFIC_RING / 2) break
          if (at < least + me.length / 2) ahead.set(me, least + me.length / 2)
          least = ahead.get(me)! + me.length / 2 + BUMPER
        }
        let most = TRAFFIC_RING - reach - 0.02
        for (let k = n - 1; k >= 0; k--) {
          const me = order[k]!
          const at = ahead.get(me)!
          if (at <= TRAFFIC_RING / 2) break
          if (at > most - me.length / 2) {
            ahead.set(me, most - me.length / 2)
            me.v = 0
          }
          most = ahead.get(me)! - me.length / 2 - BUMPER
        }
        for (let k = 0; k < n; k++) {
          // Moved, not driven; but its wheels have gone round by as much all the same.
          const me = lane[k]!
          const was = (((me.s - middle) % TRAFFIC_RING) + TRAFFIC_RING) % TRAFFIC_RING
          me.travelled += ahead.get(me)! - was
          me.s = middle + ahead.get(me)!
        }
      } else {
        // From each one back along the lane, nothing is left nearer the one
        // ahead of it than a bumper's width.
        for (let pass = 0; pass < 2; pass++) {
          for (let k = n - 1; k >= 0; k--) {
            const me = lane[k]!
            const front = lane[(k + 1) % n]!
            if (me === front) continue
            const gap = gapTo(me, front)
            if (gap < BUMPER) {
              me.s -= BUMPER - gap
              me.v = Math.min(me.v, front.v)
            }
          }
        }
      }
      for (let k = 0; k < n; k++) place(lane[k]!)
    }
  }

  return {
    vehicles,
    step(dt, held, lens) {
      // A frame after a gap is the page waking, not the traffic having driven on for a minute.
      let left = Math.min(0.25, Math.max(0, finite(dt)))
      while (left > 1e-5) {
        const part = Math.min(0.05, left)
        advance(part, finite(held), lens)
        left -= part
      }
      // And the lens once more, when no time has gone by at all: a scroll can
      // jump with the clock stopped.
      if (finite(dt) <= 1e-5) advance(0, finite(held), lens)
    },
  }
}
