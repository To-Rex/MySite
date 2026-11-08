import { MathUtils, Vector3 } from 'three'
import { cue } from '@/features/sound/store'
import { NUMBER_WIDTH } from './notFoundGlyphs'
import { EMBERS, FIELD, GROUND, SKY, WAVE_SLOTS } from './notFoundMaterials'
import type { RexActName } from './notFoundRexActs'
import { OPENING, VIEW_HEIGHT, setNotFoundAct, stageLayout, toStage, type StageLayout } from '@/lib/notFound'

/**
 * The state of the 404 page's show, and the things that change it: one object
 * written from frame callbacks and read by the rest of them. Shared by the scene
 * and the tyrannosaur, which each have a good deal to say to the other.
 */

/** Deterministic 0..1, so nothing here reaches for Math.random during render. */
export function seeded(a: number, b: number): number {
  let h = (Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export const smooth = (edge0: number, edge1: number, x: number) => MathUtils.smoothstep(x, edge0, edge1)
export const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback)

export interface Strike {
  live: boolean
  born: number
  lands: number
  from: Vector3
  to: Vector3
  power: number
}

export interface Ring {
  at: Vector3
  born: number
  life: number
  size: number
  power: number
}

export interface Flare {
  at: Vector3
  born: number
  life: number
  size: number
}

export interface Burst {
  at: Vector3
  born: number
  power: number
}

const newStrike = (): Strike => ({ live: false, born: 0, lands: 0, from: new Vector3(), to: new Vector3(), power: 1 })
const newRing = (): Ring => ({ at: new Vector3(), born: -99, life: 1, size: 1, power: 0 })
const newFlare = (): Flare => ({ at: new Vector3(), born: -99, life: 1, size: 1 })
const newBurst = (): Burst => ({ at: new Vector3(), born: -99, power: 1 })

/**
 * The show's state: one object written from frame callbacks and read by the
 * rest of them. Nothing here may be read from `state.clock` — see "Parked
 * canvases and the clock" in the README — so it counts its own time in clamped
 * steps like every other scene on the site.
 */
export const show = {
  t: 0,
  /** Whole-frame shake, from impacts and roars. */
  shake: 0,
  /** One sharp downward knock per footfall. */
  thump: 0,
  opened: false,
  /** Whether the first meteor has landed: it gets the big bang. */
  landed: false,
  /** Sounds that go with a moment rather than an event. */
  stonesCued: false,
  roars: 0,
  /** When it next mutters to itself, and when it last did. */
  nextGrumble: 0,
  grumbleAt: -100,
  /** Which pass each far meteor is on, so a new one can be heard. */
  streakCycles: [] as number[],
  grindLevel: 0,
  /** When a meteor comes down by itself, and how many have. */
  nextAuto: 0,
  autos: 0,
  nextWave: 0,
  nextRing: 0,
  nextFlare: 0,
  nextHot: 0,
  nextDust: 0,
  strikes: [newStrike(), newStrike(), newStrike()],
  rings: Array.from({ length: 8 }, newRing),
  flares: [newFlare(), newFlare(), newFlare()],
  hot: [newBurst(), newBurst(), newBurst()],
  dust: Array.from({ length: 6 }, newBurst),
  /** When the walk started; Infinity until the animal is ready to. */
  walkFrom: Infinity,
  /** The current roar's start. May be in the future. */
  roarAt: -100,
  /** Something asked of the animal, and from when. */
  rexRequest: null as { name: RexActName; at: number; urgent: boolean } | null,
  /** Whether it is in the middle of something and should be left alone. */
  rexBusy: false,
  /** It has been clicked on. */
  rexPoked: false,
  /** Where it is along the ground right now. */
  rexX: 0,
  /** The nearest pterosaur, while one is on screen. */
  flyerAt: new Vector3(),
  flyerSeen: -100,
  /** What is missing from the number, and for how long. */
  biteAt: -100,
  /** What the tyrannosaur is looking at, and until when. */
  look: new Vector3(0, 1, 8),
  lookUntil: -1,
  mouth: new Vector3(),
  arrived: false,
  layout: stageLayout(1440, 900, NUMBER_WIDTH),
}

export function resetShow(): void {
  show.t = 0
  show.shake = 0
  show.thump = 0
  show.opened = false
  show.landed = false
  show.stonesCued = false
  show.roars = 0
  show.nextGrumble = OPENING.alive + 7
  show.grumbleAt = -100
  show.streakCycles = []
  show.grindLevel = 0
  show.nextAuto = OPENING.alive + 7
  show.autos = 0
  show.walkFrom = Infinity
  show.roarAt = -100
  show.rexRequest = null
  show.rexBusy = false
  show.rexPoked = false
  show.rexX = 0
  show.flyerSeen = -100
  show.biteAt = -100
  FIELD.uBite.value.w = 0
  FIELD.uBiteTo.value.w = 0
  show.lookUntil = -1
  show.arrived = false
  for (const strike of show.strikes) strike.live = false
  for (const ring of show.rings) ring.born = -99
  for (const flare of show.flares) flare.born = -99
  for (const burst of [...show.hot, ...show.dust]) burst.born = -99
  FIELD.uWaves.value.forEach((wave) => wave.set(0, 0, -100, 0))
  FIELD.uWaveCore.value.fill(0)
  FIELD.uLava.value = 1
  SKY.uReveal.value = 0
  SKY.uFlash.value = 0
  GROUND.uCrack.value = 0
  EMBERS.uGust.value = 0
  setNotFoundAct('load')
}

export function pushWave(worldX: number, worldY: number, strength: number, core: number): void {
  const slot = show.nextWave++ % WAVE_SLOTS
  const [x, y] = toStage(worldX, worldY, show.layout)
  FIELD.uWaves.value[slot]!.set(x, y, show.t, strength)
  FIELD.uWaveCore.value[slot] = core
}

export function spawnRing(at: Vector3, size: number, life: number, power: number, delay = 0): void {
  const ring = show.rings[show.nextRing++ % show.rings.length]!
  ring.at.copy(at)
  ring.size = size
  ring.life = life
  ring.power = power
  ring.born = show.t + delay
}

export function spawnFlare(at: Vector3, size: number, life: number): void {
  const flare = show.flares[show.nextFlare++ % show.flares.length]!
  flare.at.copy(at)
  flare.size = size
  flare.life = life
  flare.born = show.t
}

export function spawnSparks(at: Vector3, power: number): void {
  const burst = show.hot[show.nextHot++ % show.hot.length]!
  burst.at.copy(at)
  burst.power = power
  burst.born = show.t
}

export function spawnDust(at: Vector3, power: number): void {
  const burst = show.dust[show.nextDust++ % show.dust.length]!
  burst.at.copy(at)
  burst.power = power
  burst.born = show.t
}

/** Where a world x is across the stereo field. */
export function panOf(x: number): number {
  const half = (VIEW_HEIGHT * Math.max(0.5, show.layout.aspect)) / 2
  return MathUtils.clamp(finite(x) / half, -1, 1)
}

export function launchMeteor(to: Vector3, flight: number, power: number): void {
  const strike = show.strikes.find((candidate) => !candidate.live)
  if (!strike) return
  strike.live = true
  strike.born = show.t
  strike.lands = show.t + flight
  strike.power = power
  strike.to.copy(to)
  // Always out of the top right, so a run of them reads as one storm.
  strike.from.set(to.x + 6.5 + seeded(show.nextRing, 1) * 2, to.y + 8 + seeded(show.nextRing, 2) * 2, to.z - 4)
  cue({ kind: 'meteor', flight, from: panOf(strike.from.x), to: panOf(to.x), power })
}

export function landMeteor(strike: Strike): void {
  strike.live = false
  const { to, power } = strike
  cue({ kind: 'impact', pan: panOf(to.x), power, first: !show.landed })
  show.landed = true
  pushWave(to.x, to.y, power, power)
  spawnRing(to, 9 * power, 1.1, 0.5)
  spawnRing(to, 5 * power, 0.8, 0.42, 0.07)
  spawnFlare(to, 7.5 * power, 0.55)
  spawnSparks(to, power)
  show.shake = Math.max(show.shake, power)
  FIELD.uLava.value = Math.max(FIELD.uLava.value, 1 + power * 0.75)
  SKY.uFlash.value = Math.max(SKY.uFlash.value, power * 0.34)
  EMBERS.uGust.value += power * 1.4
  if (show.arrived) {
    show.look.copy(to)
    show.lookUntil = show.t + 1.9
    // Close enough to feel it, and it says so; otherwise it just takes offence.
    if (Math.hypot(to.x - show.mouth.x, to.y - show.mouth.y) < 1.5 && !show.rexBusy) requestAct('flinch')
    // The small ones that come down by themselves get a look and a snarl. A roar
    // every time would leave it no moment to do anything else.
    else if (power >= 0.7 && show.t - show.roarAt > 2.6) requestAct('roar', 0.35)
    else if (!show.rexBusy) requestAct('snarl', 0.15)
  }
}

/**
 * Asks the animal to do something: taken up as soon as it is free, or dropped if
 * it never is. `urgent` is for what a visitor asked for, which cuts in instead,
 * and which nothing the animal thinks of for itself may take the place of.
 */
export function requestAct(name: RexActName, delay = 0, urgent = false): void {
  if (show.rexRequest?.urgent && !urgent) return
  show.rexRequest = { name, at: show.t + delay, urgent }
}

/**
 * Where on the number its mouth goes, in the world. In a wide window it walks up
 * to the right of the zero; where it has to reach from where it stands, its head
 * is at the left and the nearest thing to bite is the foot of the first four.
 */
export function biteSpot(L: StageLayout, out: Vector3): Vector3 {
  const stageX = L.reachesNumber ? 0.52 : -3.04
  return out.set(L.stageX + stageX * L.stageScale, L.stageY - 1.32 * L.stageScale, 0.5 * L.stageScale)
}

/** How long the piece stays missing, before it starts to come back. */
const WOUND_HOLD = 1.6
const WOUND_HEAL = 5

/** Tears a piece out of the number and sends it to the mouth. */
export function biteNumber(spot: Vector3): void {
  const L = show.layout
  const [x, y] = toStage(spot.x, spot.y, L)
  FIELD.uBite.value.set(x, y, 0.72, 0)
  show.biteAt = show.t
}

/** Advances the wound: quickly open, a moment to look at it, then slowly shut. */
export function healBite(): void {
  const since = show.t - show.biteAt
  if (since < 0 || since > WOUND_HOLD + WOUND_HEAL) {
    FIELD.uBite.value.w = 0
    return
  }
  const L = show.layout
  const [mx, my] = toStage(show.mouth.x, show.mouth.y, L)
  FIELD.uBiteTo.value.set(mx, my, show.mouth.z / L.stageScale, 1 - smooth(0.25, 0.55, since))
  FIELD.uBite.value.w = smooth(0, 0.18, since) * (1 - smooth(WOUND_HOLD, WOUND_HOLD + WOUND_HEAL, since))
}
