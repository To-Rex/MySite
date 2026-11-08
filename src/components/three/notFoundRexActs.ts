/**
 * What the tyrannosaur on the 404 page can do, as numbers.
 *
 * An act says how far to open the jaw, rear up, crouch, reach or lift a foot at
 * each moment, and which moments are events other things should hear about. It
 * never touches a bone. The frame loop blends whatever the act asks for over the
 * idle and writes the skeleton once, which is what lets one act run out of
 * another without a pop, the same division of labour as the hero's easter egg.
 *
 * Free of three.js, so all of it can be checked without a GPU.
 */

export interface RexPose {
  /** 0 shut, 1 as wide as it goes. */
  jaw: number
  /** Chest and head coming up. */
  rear: number
  /** Hips down, head low: the wind-up to anything. */
  crouch: number
  /** Neck stretched out at whatever it is aiming for. */
  reach: number
  /** The whole body pushed forward along its heading. */
  lunge: number
  /** Head thrown side to side. */
  shake: number
  /** A fast shiver through the head and tail. */
  tremble: number
  tailLift: number
  tailDrop: number
  /** 1 and -1 are the tail swung hard to either side. */
  tailSwing: number
  /** The back foot coming up off the ground. */
  lift: number
  /** A swallow going down the throat: 0 none, then 0..1 from jaw to chest. */
  lump: number
  /** Thrown backwards, away from something. */
  lean: number
  /** Eyes closing. */
  squint: number
}

export const newPose = (): RexPose => ({
  jaw: 0,
  rear: 0,
  crouch: 0,
  reach: 0,
  lunge: 0,
  shake: 0,
  tremble: 0,
  tailLift: 0,
  tailDrop: 0,
  tailSwing: 0,
  lift: 0,
  lump: 0,
  lean: 0,
  squint: 0,
})

/** The moments other things want to know about. */
export type RexBeat =
  | 'breathIn'
  | 'roarOut'
  | 'chomp'
  | 'bite'
  | 'crunch'
  | 'gulp'
  | 'burp'
  | 'swish'
  | 'slam'
  | 'stomp'
  | 'snort'
  | 'sniff'
  | 'yawn'
  | 'clack'
  | 'shakeOff'
  | 'snarl'

export type RexActName = 'roar' | 'snap' | 'bite' | 'tailSlam' | 'stomp' | 'shake' | 'yawn' | 'sniff' | 'flinch' | 'snarl' | 'pace'

export interface RexAct {
  name: RexActName
  seconds: number
  /** Something else may cut it short. */
  interruptible: boolean
  /** Walks to `approach` first; its own clock starts once it gets there. */
  approach?: 'number' | 'roam'
  beats: readonly { at: number; beat: RexBeat }[]
  pose(s: number, out: RexPose): void
}

const smooth = (a: number, b: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

/** Up over a..b, held, down over c..d. */
const span = (s: number, a: number, b: number, c: number, d: number): number => smooth(a, b, s) * (1 - smooth(c, d, s))

/** How long a roar's wind-up lasts; the voice comes in as the head comes up. */
export const ROAR_WIND = 0.42
export const ROAR_RISE = 0.14
export const ROAR_HOLD = 1.5

export const ACTS: Record<RexActName, RexAct> = {
  roar: {
    name: 'roar',
    seconds: 2.7,
    interruptible: false,
    beats: [
      { at: 0, beat: 'breathIn' },
      { at: ROAR_WIND + ROAR_RISE, beat: 'roarOut' },
    ],
    pose(s, p) {
      p.crouch = span(s, 0, ROAR_WIND, ROAR_WIND, ROAR_WIND + 0.2)
      p.rear = span(s, ROAR_WIND, ROAR_WIND + ROAR_RISE, ROAR_WIND + ROAR_HOLD - 0.4, ROAR_WIND + ROAR_HOLD + 0.25)
      const open = span(s, ROAR_WIND, ROAR_WIND + ROAR_RISE + 0.06, ROAR_WIND + ROAR_HOLD - 0.3, ROAR_WIND + ROAR_HOLD + 0.3)
      p.jaw = Math.max(span(s, 0.08, 0.38, ROAR_WIND, 0.5) * 0.2, open * (0.92 + Math.sin(s * 37) * 0.08))
      p.tremble = span(s, ROAR_WIND + 0.1, ROAR_WIND + 0.3, ROAR_WIND + ROAR_HOLD - 0.3, ROAR_WIND + ROAR_HOLD + 0.2)
    },
  },

  // Lunges at the thing in front of it and shuts its mouth on the air.
  snap: {
    name: 'snap',
    seconds: 0.8,
    interruptible: false,
    beats: [{ at: 0.2, beat: 'chomp' }],
    pose(s, p) {
      p.reach = span(s, 0, 0.13, 0.26, 0.74)
      p.lunge = span(s, 0, 0.13, 0.26, 0.68)
      p.jaw = span(s, 0, 0.11, 0.16, 0.22)
      p.tremble = span(s, 0.2, 0.25, 0.3, 0.5) * 0.5
    },
  },

  // Walks up to the number and takes a piece out of it.
  bite: {
    name: 'bite',
    seconds: 5.1,
    interruptible: false,
    approach: 'number',
    beats: [
      { at: 0.5, beat: 'bite' },
      { at: 1.58, beat: 'crunch' },
      { at: 2.13, beat: 'crunch' },
      { at: 2.68, beat: 'crunch' },
      { at: 3.22, beat: 'gulp' },
      { at: 4.25, beat: 'burp' },
    ],
    pose(s, p) {
      p.crouch = span(s, 0, 0.28, 0.3, 0.46) * 0.55
      p.reach = span(s, 0.32, 0.48, 0.58, 1.1)
      p.lunge = span(s, 0.34, 0.5, 0.6, 1.1)
      p.lean = span(s, 0.72, 0.95, 1.1, 1.45) * 0.45
      p.shake = span(s, 0.58, 0.7, 1.05, 1.25)
      const chew = s > 1.3 && s < 3 ? (0.5 - 0.5 * Math.cos(((s - 1.3) / 0.55) * Math.PI * 2)) * span(s, 1.3, 1.42, 2.85, 3) * 0.42 : 0
      p.jaw = Math.max(span(s, 0.12, 0.42, 0.46, 0.54), chew, span(s, 4.12, 4.22, 4.36, 4.56) * 0.5)
      p.rear = span(s, 3, 3.25, 3.65, 3.95) * 0.6
      p.lump = s > 3.2 && s < 3.95 ? (s - 3.2) / 0.75 : 0
      p.tremble = span(s, 4.15, 4.25, 4.4, 4.7) * 0.5
    },
  },

  // Tail up over its back, then brought down as hard as it will go.
  tailSlam: {
    name: 'tailSlam',
    seconds: 1.9,
    interruptible: false,
    beats: [
      { at: 0.54, beat: 'swish' },
      { at: 0.68, beat: 'slam' },
    ],
    pose(s, p) {
      p.tailLift = span(s, 0, 0.5, 0.52, 0.66)
      p.tailDrop = span(s, 0.53, 0.68, 0.78, 1.7)
      p.tailSwing = span(s, 0, 0.5, 0.6, 1.5) * 0.35
      p.rear = span(s, 0, 0.45, 0.55, 0.95) * 0.3
      p.crouch = span(s, 0.56, 0.7, 0.85, 1.4) * 0.55
      p.jaw = span(s, 0.56, 0.68, 0.9, 1.3) * 0.32
    },
  },

  // Two stamps, the second harder, the way something large makes a point.
  stomp: {
    name: 'stomp',
    seconds: 2.1,
    interruptible: false,
    beats: [
      { at: 0.46, beat: 'stomp' },
      { at: 1.26, beat: 'stomp' },
    ],
    pose(s, p) {
      p.lift = Math.max(span(s, 0, 0.34, 0.36, 0.47), span(s, 0.8, 1.14, 1.16, 1.27))
      p.crouch = Math.max(span(s, 0.45, 0.52, 0.6, 0.86) * 0.5, span(s, 1.25, 1.32, 1.4, 1.9) * 0.7)
      p.rear = span(s, 0, 0.3, 0.4, 0.5) * 0.25 + span(s, 0.8, 1.1, 1.2, 1.3) * 0.32
      p.jaw = span(s, 0.2, 0.42, 1.4, 1.85) * 0.4
      p.tremble = span(s, 1.26, 1.32, 1.5, 1.9) * 0.6
    },
  },

  // Like a dog coming out of the water.
  shake: {
    name: 'shake',
    seconds: 1.25,
    interruptible: true,
    beats: [
      { at: 0.06, beat: 'snort' },
      { at: 0.82, beat: 'shakeOff' },
    ],
    pose(s, p) {
      p.shake = span(s, 0.02, 0.15, 0.82, 1.1)
      p.jaw = span(s, 0.06, 0.2, 0.8, 1.05) * 0.3
      p.squint = span(s, 0, 0.1, 0.85, 1.05)
    },
  },

  yawn: {
    name: 'yawn',
    seconds: 3.7,
    interruptible: true,
    beats: [
      { at: 0.25, beat: 'yawn' },
      { at: 3.12, beat: 'clack' },
    ],
    pose(s, p) {
      p.rear = span(s, 0.2, 1.3, 2.3, 3.3) * 0.7
      p.jaw = span(s, 0.35, 1.5, 2.45, 3.12) * 0.98
      p.squint = span(s, 0.45, 1.1, 2.7, 3.35)
    },
  },

  // Head down over the ground, working something out.
  sniff: {
    name: 'sniff',
    seconds: 3.1,
    interruptible: true,
    beats: [
      { at: 0.72, beat: 'sniff' },
      { at: 1.16, beat: 'sniff' },
      { at: 1.62, beat: 'sniff' },
      { at: 2.68, beat: 'snort' },
    ],
    pose(s, p) {
      const down = span(s, 0, 0.55, 2.2, 2.85)
      p.crouch = down * 0.62
      p.reach = down * (0.9 + Math.sin(s * 14) * 0.1)
      p.jaw = span(s, 2.62, 2.72, 2.82, 3) * 0.18
    },
  },

  // Something landed much too close.
  flinch: {
    name: 'flinch',
    seconds: 1,
    interruptible: false,
    beats: [{ at: 0, beat: 'snarl' }],
    pose(s, p) {
      p.lean = span(s, 0, 0.08, 0.32, 0.92)
      p.crouch = span(s, 0, 0.1, 0.3, 0.8) * 0.65
      p.jaw = span(s, 0, 0.1, 0.5, 0.9) * 0.62
      p.squint = span(s, 0, 0.05, 0.2, 0.4)
    },
  },

  // Something went off nearby, and it would like that known without getting up.
  snarl: {
    name: 'snarl',
    seconds: 1.05,
    interruptible: true,
    beats: [{ at: 0.04, beat: 'snarl' }],
    pose(s, p) {
      p.jaw = span(s, 0.02, 0.14, 0.62, 1) * 0.52
      p.crouch = span(s, 0, 0.16, 0.5, 1) * 0.3
      p.tremble = span(s, 0.08, 0.2, 0.55, 0.9) * 0.7
    },
  },

  // A few steps to somewhere else, for no reason it would admit to.
  pace: {
    name: 'pace',
    seconds: 0.3,
    interruptible: true,
    approach: 'roam',
    beats: [],
    pose() {},
  },
}

export const ACT_NAMES = Object.keys(ACTS) as RexActName[]

/**
 * What it does by itself, in order. A list and not dice: chance left the bite
 * for the third minute, by which time a visitor has gone, and this way each
 * thing it can do is seen within about the first minute.
 */
export const IDLE_ORDER: readonly RexActName[] = ['tailSlam', 'bite', 'yawn', 'stomp', 'sniff', 'pace', 'shake', 'bite', 'tailSlam', 'pace', 'yawn', 'sniff', 'stomp', 'shake']

/** Answers to being clicked on, in order: it gets less patient. */
export const POKE_ORDER: readonly RexActName[] = ['snap', 'shake', 'stomp', 'snap', 'roar']

const TWO_PI = Math.PI * 2

/** An angle brought into -π..π. */
const wrap = (angle: number): number => ((((angle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI

/** The heading that points it straight away from the camera. */
const AWAY = Math.PI / 2

/**
 * The turn from one heading to another, going round by the side that faces the
 * camera. The short way round is usually that, but not always, and the one time
 * it is not the visitor gets a good long look at the wrong end of the animal.
 */
export function turnFacingCamera(from: number, to: number): number {
  const short = wrap(to - from)
  const toAway = wrap(AWAY - from)
  const crosses = short > 0 ? toAway > 0 && toAway < short : toAway < 0 && toAway > short
  return crosses ? short - Math.sign(short) * TWO_PI : short
}

/** Anything closer than this is a shuffle, and not worth turning round for. */
const SHUFFLE = 0.25

/** How far from side-on it will point, whichever way it is really going. */
const MOST_OBLIQUE = 0.5

/**
 * Which way to face on the way somewhere. Side-on, more or less, wherever that
 * is: the walk is drawn from the side, and a goal that is mostly further into
 * the scene would otherwise point it directly away from the visitor. The body
 * goes straight to the goal regardless, and over these distances nobody can see
 * that it is crabbing slightly.
 */
export function walkHeading(dx: number, dz: number, facingLeft: boolean): number {
  const side = Math.abs(dx) < SHUFFLE ? (facingLeft ? Math.PI : 0) : dx < 0 ? Math.PI : 0
  const offset = wrap(Math.atan2(-dz, dx) - side)
  // Backwards, for a shuffle: stay square rather than twist away from it.
  if (Math.abs(offset) > Math.PI / 2) return side
  return side + Math.min(MOST_OBLIQUE, Math.max(-MOST_OBLIQUE, offset))
}

/** The longest a visitor is kept waiting for something that is about to finish anyway. */
const VISITOR_PATIENCE = 0.6

export interface ActInProgress {
  name: RexActName
  interruptible: boolean
  /** Still walking to where it has to be. */
  approaching: boolean
  /** Seconds it still has to go. */
  left: number
}

/**
 * Whether it takes up a new request now. What it decides for itself can wait its
 * turn, but a bite with the walk to it is seven seconds long, and someone who
 * has just pressed a button should not have to sit through that to find out
 * whether the button works. So what a visitor asks for cuts in, unless what is
 * going on is nearly over anyway, or is already a roar.
 */
export function takesRequest(running: ActInProgress | null, urgent: boolean): boolean {
  if (!running || running.interruptible) return true
  if (!urgent || running.name === 'roar') return false
  return running.approaching || running.left > VISITOR_PATIENCE
}
