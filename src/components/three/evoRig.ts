import { Quaternion, Vector3, type Bone } from 'three'
import type { BoneSpec } from './creatures'

/**
 * How the people of the long walk move.
 *
 * A pose here is a short list of numbers a person could be told — how far the
 * hips have dropped, where each foot is, how far each arm has swung — and not
 * a quaternion per bone. Gaits write those numbers from a phase; two poses
 * blend by blending the numbers; and one function turns the result into bone
 * rotations, solving each leg from where its foot has to be.
 *
 * Feet are placed, not swung. A stride clock that rotates the hips and knees
 * and hopes the sole ends up level is how a figure comes to skate; here the
 * foot stays where it was put for as long as it is on the ground, and the leg
 * is whatever reaches it. The phase is a distance — strides covered — so a
 * walker's feet agree with the ground however the scroll that moves it goes:
 * forwards, backwards, or not at all.
 */

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

/** One two-boned limb that is solved from where its end has to be: a leg, of a person or an animal. */
export interface Limb {
  upper: string
  lower: string
  end: string
  upperLength: number
  lowerLength: number
  /** Where the joint is from the bone that carries it, and where the end stands, in metres. The +z side's. */
  joint: Vector3
  stands: Vector3
  upperRest: Vector3
  lowerRest: Vector3
  endRest: Vector3
  /** Which way the middle joint folds: forwards for a knee, backwards for an elbow. */
  fold: 1 | -1
}

/** What the rig needs to know about one meshed figure. Lengths are in metres. */
export interface FigureFrame {
  /** Metres to the mesh's own units (it is normalised to a longest side of 1). */
  size: number
  /** The root bone's rest place in the mesh's own units, where it is moved from, and the same in metres. */
  rootRest: Vector3
  rootAt: Vector3
  legs: Limb
  /** A four-legged figure's front pair. */
  arms?: Limb
  /** Rest direction of a person's upper arm (left side). */
  armRest: Vector3
}

const spec = (bones: readonly BoneSpec[], name: string): BoneSpec => {
  const found = bones.find((bone) => bone.name === name)
  if (!found) throw new Error(`figure has no bone "${name}"`)
  return found
}

const between = (a: readonly number[], b: readonly number[]) => new Vector3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!)

function limbOf(bones: readonly BoneSpec[], size: number, names: readonly [string, string, string], carrier: string, fold: 1 | -1): Limb {
  const upper = spec(bones, names[0])
  const lower = spec(bones, names[1])
  const end = spec(bones, names[2])
  const a = between(upper.head, lower.head)
  const b = between(lower.head, end.head)
  return {
    upper: names[0].slice(0, -1),
    lower: names[1].slice(0, -1),
    end: names[2].slice(0, -1),
    upperLength: a.length() * size,
    lowerLength: b.length() * size,
    joint: between(spec(bones, carrier).head, upper.head).multiplyScalar(size),
    stands: new Vector3(end.head[0], end.head[1], end.head[2]).multiplyScalar(size),
    upperRest: a.clone().normalize(),
    lowerRest: b.clone().normalize(),
    endRest: between(end.head, end.tip ?? end.head).normalize(),
    fold,
  }
}

/** Measures a meshed figure from its own bones, so the rig can never drift from the sculpt. */
export function measure(bones: readonly BoneSpec[], size: number): FigureFrame {
  const root = spec(bones, 'hips')
  const fourLegged = bones.some((bone) => bone.name === 'armL') && bones.some((bone) => bone.name === 'foreL')
  const shoulder = bones.find((bone) => bone.name === 'upperArmL')
  const elbow = bones.find((bone) => bone.name === 'foreArmL')
  return {
    size,
    rootRest: new Vector3(root.head[0], root.head[1], root.head[2]),
    rootAt: new Vector3(root.head[0], root.head[1], root.head[2]).multiplyScalar(size),
    legs: limbOf(bones, size, ['thighL', 'shinL', 'footL'], 'hips', 1),
    // An animal's front legs hang off its chest, which the rig never turns, so
    // they are measured from the root like the hind pair.
    arms: fourLegged ? limbOf(bones, size, ['armL', 'foreL', 'handL'], 'hips', -1) : undefined,
    armRest: shoulder && elbow ? between(shoulder.head, elbow.head).normalize() : new Vector3(0, -1, 0),
  }
}

/** [swing forward, spread out from the side, elbow bend, roll of the forearm inward], radians. */
export type ArmPose = [number, number, number, number]
/** [foot forward of its hip, ankle above its standing height, foot out from under its hip, toe up], metres and radians. */
export type LegPose = [number, number, number, number]

export interface Pose {
  /** The hips: up (negative is a crouch), sideways towards +z, and forwards, in metres. */
  rise: number
  shift: number
  /** The hips' own lean forward, twist to the left and drop on one side, radians. */
  lean: number
  twist: number
  tilt: number
  /** The back bending forward, and the chest turning against the hips. */
  bend: number
  counter: number
  /** The head: nodding down, turning left. */
  nod: number
  turn: number
  armL: ArmPose
  armR: ArmPose
  legL: LegPose
  legR: LegPose
}

export function createPose(): Pose {
  return { rise: 0, shift: 0, lean: 0, twist: 0, tilt: 0, bend: 0, counter: 0, nod: 0, turn: 0, armL: [0, 0.1, 0.12, 0], armR: [0, 0.1, 0.12, 0], legL: [0, 0, 0, 0], legR: [0, 0, 0, 0] }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const frac = (v: number) => v - Math.floor(v)
const ease = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** `out` becomes `a` blended towards `b`. */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  const m = clamp01(t)
  out.rise = lerp(a.rise, b.rise, m)
  out.shift = lerp(a.shift, b.shift, m)
  out.lean = lerp(a.lean, b.lean, m)
  out.twist = lerp(a.twist, b.twist, m)
  out.tilt = lerp(a.tilt, b.tilt, m)
  out.bend = lerp(a.bend, b.bend, m)
  out.counter = lerp(a.counter, b.counter, m)
  out.nod = lerp(a.nod, b.nod, m)
  out.turn = lerp(a.turn, b.turn, m)
  for (let i = 0; i < 4; i++) {
    out.armL[i] = lerp(a.armL[i]!, b.armL[i]!, m)
    out.armR[i] = lerp(a.armR[i]!, b.armR[i]!, m)
    out.legL[i] = lerp(a.legL[i]!, b.legL[i]!, m)
    out.legR[i] = lerp(a.legR[i]!, b.legR[i]!, m)
  }
  return out
}

// -------------------------------------------------------------------- gaits

export interface Gait {
  /** Ground covered in one full cycle, both feet, in metres. */
  stride: number
  /** Share of the cycle a foot is on the ground. Under a half, it is a run. */
  stance: number
  /** How high the foot is carried through. */
  lift: number
  /** How far the hips sit below standing height, and how much they bob. */
  drop: number
  bob: number
  lean: number
  bend: number
  /** Arm swing, and how bent the elbows are carried. */
  swing: number
  elbow: number
  /** How far the knees are carried apart, for a crouch. */
  splay: number
}

export const GAITS = {
  walk: { stride: 1.36, stance: 0.62, lift: 0.1, drop: 0.045, bob: 0.022, lean: 0.03, bend: 0.03, swing: 0.5, elbow: 0.22, splay: 0 },
  /** Bent low and placing each foot: someone who does not want to be heard. */
  stalk: { stride: 0.96, stance: 0.68, lift: 0.13, drop: 0.2, bob: 0.012, lean: 0.2, bend: 0.36, swing: 0.1, elbow: 0.7, splay: 0.03 },
  run: { stride: 2.9, stance: 0.36, lift: 0.3, drop: 0.07, bob: 0.05, lean: 0.2, bend: 0.1, swing: 0.95, elbow: 1.5, splay: 0 },
} as const satisfies Record<string, Gait>

function stepLeg(out: LegPose, phase: number, gait: Gait): void {
  const p = frac(phase)
  const reach = gait.stride * gait.stance * 0.5
  if (p < gait.stance) {
    // On the ground: the foot stays where it landed while the body passes over it.
    const u = p / gait.stance
    out[0] = reach * (1 - 2 * u)
    // Heel first, flat by a fifth of the way, and up onto the toe at the end.
    const strike = 1 - clamp01(u / 0.2)
    const push = clamp01((u - 0.66) / 0.34)
    out[3] = 0.3 * strike * strike - 0.62 * push * push
    out[1] = 0.115 * Math.sin(0.62 * push * push) + 0.012 * strike
  } else {
    // In the air: carried through and set down ahead.
    const u = (p - gait.stance) / (1 - gait.stance)
    const e = ease(u)
    out[0] = reach * (-1 + 2 * e) + gait.stride * 0.012 * Math.sin(Math.PI * u)
    out[1] = gait.lift * Math.sin(Math.PI * Math.pow(u, 0.82)) + 0.115 * Math.sin(0.62) * (1 - ease(clamp01(u / 0.35)))
    out[3] = lerp(-0.62, 0.3, ease(clamp01((u - 0.1) / 0.8))) - 0.25 * gait.lift * Math.sin(Math.PI * u)
  }
  out[2] = gait.splay
}

/**
 * A gait at a phase: the left foot strikes at 0, the right half a cycle later.
 * `energy` scales the bounce and the swing: at 0 it is someone standing in
 * mid-step, which is what a walker eased to a halt should be.
 */
export function gaitPose(out: Pose, phase: number, gait: Gait, energy = 1): Pose {
  const beat = frac(phase) * Math.PI * 2
  stepLeg(out.legL, phase, gait)
  stepLeg(out.legR, phase + 0.5, gait)
  const mid = gait.stance * 0.5
  // Lowest with both feet down, highest passing over one.
  out.rise = -gait.drop + gait.bob * energy * Math.cos(2 * (beat - mid * Math.PI * 2))
  out.shift = 0.02 * energy * Math.cos(beat - mid * Math.PI * 2) * (gait.stance > 0.5 ? 1 : 0.4)
  out.lean = gait.lean
  out.twist = 0.1 * energy * Math.cos(beat) * Math.min(1, gait.stride / 1.4)
  out.tilt = -0.045 * energy * Math.sin(beat - 0.5)
  out.bend = gait.bend
  out.counter = -0.17 * energy * Math.cos(beat) * (gait.swing > 0.3 ? 1 : 0.4)
  out.nod = -gait.bend * 0.72 - gait.lean * 0.5
  out.turn = 0
  // Arms against the legs: the right arm is forward as the left foot lands.
  const swing = gait.swing * energy * Math.cos(beat)
  out.armL[0] = -swing
  out.armR[0] = swing
  out.armL[1] = 0.1 + gait.elbow * 0.05
  out.armR[1] = 0.1 + gait.elbow * 0.05
  out.armL[2] = gait.elbow + 0.3 * Math.max(0, -swing)
  out.armR[2] = gait.elbow + 0.3 * Math.max(0, swing)
  out.armL[3] = 0.1
  out.armR[3] = 0.1
  return out
}

/** Standing, alive: weight on both feet, breathing, the head not quite still. `t` in seconds. */
export function standPose(out: Pose, t: number, seed = 0): Pose {
  const breath = Math.sin(t * 1.25 + seed)
  out.rise = -0.012 + 0.004 * breath
  out.shift = 0.012 * Math.sin(t * 0.31 + seed * 1.7)
  out.lean = 0.01
  out.twist = 0.03 * Math.sin(t * 0.23 + seed)
  out.tilt = 0.012 * Math.sin(t * 0.31 + seed * 1.7)
  out.bend = 0.035 + 0.012 * breath
  out.counter = -0.02 * Math.sin(t * 0.23 + seed)
  out.nod = 0.02 * Math.sin(t * 0.4 + seed * 2.3)
  out.turn = 0.16 * Math.sin(t * 0.27 + seed * 3.1)
  out.armL = [0.03 + 0.02 * breath, 0.11, 0.18, 0.1]
  out.armR = [-0.02 + 0.02 * breath, 0.11, 0.2, 0.1]
  out.legL = [0.03, 0, 0.012, 0]
  out.legR = [-0.03, 0, 0.012, 0]
  return out
}

/** Sitting on the ground by a fire: knees up, forearms across them, leaning in. */
export function sitPose(out: Pose, t: number, seed = 0): Pose {
  const breath = Math.sin(t * 1.1 + seed)
  out.rise = -0.66 + 0.004 * breath
  out.shift = 0
  out.lean = -0.12
  out.twist = 0
  out.tilt = 0
  out.bend = 0.5 + 0.02 * breath
  out.counter = 0.05 * Math.sin(t * 0.21 + seed)
  out.nod = -0.2 + 0.03 * Math.sin(t * 0.37 + seed)
  out.turn = 0.18 * Math.sin(t * 0.19 + seed * 2.1)
  out.armL = [0.95, 0.2, 0.75, 0.5]
  out.armR = [0.9, 0.22, 0.8, 0.5]
  out.legL = [0.4, 0.02, 0.08, 0.2]
  out.legR = [0.36, 0.02, 0.1, 0.2]
  return out
}

/** Sitting on a chair at a desk, hands on a keyboard: the fingers are never quite still. */
export function deskPose(out: Pose, t: number): Pose {
  const breath = Math.sin(t * 1.15)
  const keys = Math.sin(t * 9.1) * Math.sin(t * 2.3)
  out.rise = -0.44 + 0.003 * breath
  out.shift = 0
  out.lean = 0.04
  out.twist = 0
  out.tilt = 0
  out.bend = 0.2 + 0.012 * breath
  out.counter = 0.1
  out.nod = 0.1 + 0.02 * Math.sin(t * 0.31)
  out.turn = 0.34 + 0.05 * Math.sin(t * 0.17)
  out.armL = [0.5 + 0.012 * keys, 0.16, 1.22 + 0.03 * keys, 0.35]
  out.armR = [0.52 - 0.012 * keys, 0.16, 1.2 - 0.03 * Math.sin(t * 7.7), 0.35]
  out.legL = [0.4, 0, 0.03, 0.05]
  out.legR = [0.44, 0, 0.03, 0.05]
  return out
}

/** Named poses for the preview page and the tests. */
export function poseFor(name: string, phase: number, out: Pose): Pose {
  if (name === 'walk') return gaitPose(out, phase, GAITS.walk)
  if (name === 'stalk') return gaitPose(out, phase, GAITS.stalk)
  if (name === 'run') return gaitPose(out, phase, GAITS.run)
  if (name === 'sit') return sitPose(out, phase * 10)
  if (name === 'desk') return deskPose(out, phase * 10)
  return standPose(out, phase * 10)
}

// ------------------------------------------------------------------ solving

const pelvis = new Quaternion()
const pelvisInverse = new Quaternion()
const q = new Quaternion()
const qa = new Quaternion()
const chain = new Quaternion()
const inv = new Quaternion()
const joint = new Vector3()
const target = new Vector3()
const reachV = new Vector3()
const along = new Vector3()
const bendDir = new Vector3()
const kneeAt = new Vector3()
const dirA = new Vector3()
const dirB = new Vector3()
const axis = new Vector3()
const tmp = new Vector3()
const rootNow = new Vector3()

/**
 * Solves one limb: the joint at the top is wherever the body has put it, the
 * end is where it was placed, and the two bones between are whatever reaches.
 * `pelvis` is the rotation of the bone that carries the limb, `rootNow` where
 * that bone is; both in the mesh's frame, in metres.
 */
function solveLimb(byName: Map<string, Bone>, limb: Limb, suffix: 'L' | 'R', side: 1 | -1, forward: number, up: number, out: number, pitch: number): void {
  const upper = byName.get(`${limb.upper}${suffix}`)
  const lower = byName.get(`${limb.lower}${suffix}`)
  const end = byName.get(`${limb.end}${suffix}`)
  if (!upper || !lower || !end) return

  joint.copy(limb.joint)
  joint.z *= side
  joint.applyQuaternion(pelvis).add(rootNow)
  target.set(limb.stands.x + forward, limb.stands.y + Math.max(0, up), side * (limb.stands.z + out))

  // Into the carrier's frame, where the upper bone's rotation is expressed.
  reachV.copy(target).sub(joint).applyQuaternion(pelvisInverse)
  const full = limb.upperLength + limb.lowerLength
  const d = Math.min(full * 0.9995, Math.max(Math.abs(limb.upperLength - limb.lowerLength) + 1e-3, reachV.length()))
  along.copy(reachV).normalize()
  // The middle joint folds forwards or back, and a little out with the foot.
  bendDir.set(limb.fold, 0, side * (0.06 + out * 2.2))
  bendDir.addScaledVector(along, -bendDir.dot(along)).normalize()
  const a = (limb.upperLength * limb.upperLength - limb.lowerLength * limb.lowerLength + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, limb.upperLength * limb.upperLength - a * a))
  kneeAt.copy(along).multiplyScalar(a).addScaledVector(bendDir, h)
  dirA.copy(kneeAt).normalize()
  dirB.copy(along).multiplyScalar(d).sub(kneeAt).normalize()

  tmp.copy(limb.upperRest)
  tmp.z *= side
  upper.quaternion.setFromUnitVectors(tmp.normalize(), dirA)
  // The lower bone's direction as its parent, the turned upper one, sees it.
  inv.copy(upper.quaternion).invert()
  tmp.copy(limb.lowerRest)
  tmp.z *= side
  lower.quaternion.setFromUnitVectors(tmp.normalize(), dirB.applyQuaternion(inv))

  // The foot keeps to the ground whatever the leg above it is doing: its
  // direction is set in the figure's frame and carried back down the chain.
  const rest = Math.atan2(limb.endRest.y, Math.hypot(limb.endRest.x, limb.endRest.z))
  const heading = Math.sign(limb.endRest.x) || 1
  const angle = rest + pitch
  dirA.set(heading * Math.cos(angle), Math.sin(angle), side * 0.06).normalize()
  chain.copy(pelvis).multiply(upper.quaternion).multiply(lower.quaternion)
  inv.copy(chain).invert()
  tmp.copy(limb.endRest)
  tmp.z *= side
  end.quaternion.setFromUnitVectors(tmp.normalize(), dirA.applyQuaternion(inv))
}

function solveArm(byName: Map<string, Bone>, suffix: 'L' | 'R', side: 1 | -1, arm: ArmPose, frame: FigureFrame): void {
  const upper = byName.get(`upperArm${suffix}`)
  const fore = byName.get(`foreArm${suffix}`)
  if (!upper || !fore) return
  const [swing, spread, bend, roll] = arm
  // Hanging, spread out from the side, then swung about the shoulders' axis.
  const cs = Math.cos(spread)
  dirA.set(Math.sin(swing) * cs, -Math.cos(swing) * cs, side * Math.sin(spread)).normalize()
  tmp.copy(frame.armRest)
  tmp.z *= side
  tmp.normalize()
  upper.quaternion.setFromUnitVectors(tmp, dirA)
  // The elbow folds the forearm forward; `roll` turns that fold in across the body.
  axis.crossVectors(dirA, X)
  if (axis.lengthSq() < 1e-6) axis.copy(Z)
  axis.normalize()
  qa.setFromAxisAngle(dirA, -side * roll)
  axis.applyQuaternion(qa)
  q.setFromAxisAngle(axis, bend)
  dirB.copy(dirA).applyQuaternion(q)
  inv.copy(upper.quaternion).invert()
  fore.quaternion.setFromUnitVectors(tmp, dirB.applyQuaternion(inv))
}

/**
 * Puts a pose on a person's skeleton. The figure's own group is expected to
 * stand at ground level, scaled so that one unit is `frame.size` metres.
 */
export function applyPose(byName: Map<string, Bone>, pose: Pose, frame: FigureFrame): void {
  const hips = byName.get('hips')
  if (!hips) return
  // Lean forward is a turn about -z; twist left about +y; tilt about +x.
  pelvis.setFromAxisAngle(Y, pose.twist)
  pelvis.multiply(q.setFromAxisAngle(Z, -pose.lean))
  pelvis.multiply(q.setFromAxisAngle(X, pose.tilt))
  pelvisInverse.copy(pelvis).invert()
  hips.quaternion.copy(pelvis)
  hips.position.set(frame.rootRest.x, frame.rootRest.y + pose.rise / frame.size, frame.rootRest.z + pose.shift / frame.size)
  rootNow.copy(frame.rootAt)
  rootNow.y += pose.rise
  rootNow.z += pose.shift

  const spine = byName.get('spine')
  const chest = byName.get('chest')
  const neck = byName.get('neck')
  const head = byName.get('head')
  if (spine) spine.quaternion.setFromAxisAngle(Z, -pose.bend * 0.45).multiply(q.setFromAxisAngle(Y, pose.counter * 0.4))
  if (chest) chest.quaternion.setFromAxisAngle(Z, -pose.bend * 0.55).multiply(q.setFromAxisAngle(Y, pose.counter * 0.6 - pose.twist))
  if (neck) neck.quaternion.setFromAxisAngle(Z, -pose.nod * 0.5).multiply(q.setFromAxisAngle(Y, pose.turn * 0.4))
  if (head) head.quaternion.setFromAxisAngle(Z, -pose.nod * 0.5).multiply(q.setFromAxisAngle(Y, pose.turn * 0.6))

  solveLimb(byName, frame.legs, 'L', 1, pose.legL[0], pose.legL[1], pose.legL[2], pose.legL[3])
  solveLimb(byName, frame.legs, 'R', -1, pose.legR[0], pose.legR[1], pose.legR[2], pose.legR[3])
  solveArm(byName, 'L', 1, pose.armL, frame)
  solveArm(byName, 'R', -1, pose.armR, frame)
}

// ------------------------------------------------------------------- beasts

/** How a mammoth holds itself. Feet are [forward of where they stand, off the ground, toe turned up], in metres and radians. */
export type BeastFoot = [number, number, number]

export interface BeastPose {
  /**
   * The body: up and down, pitched nose-down, rolled to its left. These are
   * over and above what its legs let it have — see `applyBeast`, which carries
   * each end of it no higher than the legs under that end can reach.
   */
  rise: number
  pitch: number
  roll: number
  frontL: BeastFoot
  frontR: BeastFoot
  hindL: BeastFoot
  hindR: BeastFoot
  /** The head: raised, turned to its left. */
  raise: number
  turn: number
  /** How far the trunk is curled up under itself, and swung to its left. */
  curl: number
  swing: number
  /** Ears held out from the head. */
  ears: number
  tail: number
}

export function createBeastPose(): BeastPose {
  return { rise: 0, pitch: 0, roll: 0, frontL: [0, 0, 0], frontR: [0, 0, 0], hindL: [0, 0, 0], hindR: [0, 0, 0], raise: 0, turn: 0, curl: 0, swing: 0, ears: 0, tail: 0 }
}

export interface BeastGait {
  stride: number
  stance: number
  lift: number
  bob: number
  /** How far the heel has come off the ground by the time the foot leaves it. */
  roll: number
}

export const BEAST_GAITS = {
  /** An elephant's walk: three feet down at any time, and all the time in the world. */
  walk: { stride: 1.95, stance: 0.7, lift: 0.17, bob: 0.008, roll: 0.1 },
  /** As fast as it goes. It never leaves the ground: an elephant cannot gallop. */
  amble: { stride: 2.5, stance: 0.58, lift: 0.26, bob: 0.014, roll: 0.14 },
} as const satisfies Record<string, BeastGait>

/** How long a mammoth's foot is from its ankle to its toes, near enough, for how far a lifted heel tips it. */
const BEAST_FOOT = 0.32

function stepFoot(out: BeastFoot, phase: number, gait: BeastGait): void {
  const p = frac(phase)
  const travel = gait.stride * gait.stance
  // It lands a little less far ahead of the leg than it leaves behind it.
  const ahead = travel * 0.44
  const tipped = -Math.asin(Math.min(1, gait.roll / BEAST_FOOT))
  if (p < gait.stance) {
    // On the ground, the body passing over it; and at the last the heel comes
    // up and the foot goes onto its toes, which is what lets a straight leg
    // trail so far behind.
    const u = p / gait.stance
    const off = ease(clamp01((u - 0.7) / 0.3))
    out[0] = ahead - travel * u
    out[1] = gait.roll * off
    out[2] = tipped * off + 0.1 * (1 - clamp01(u / 0.14))
  } else {
    // Carried through with the foot hanging from the wrist, and set down flat.
    const u = (p - gait.stance) / (1 - gait.stance)
    out[0] = ahead - travel + travel * ease(u)
    out[1] = gait.roll * (1 - ease(clamp01(u / 0.4))) + gait.lift * Math.sin(Math.PI * Math.pow(u, 0.85))
    out[2] = lerp(tipped, 0.1, ease(u)) - 0.45 * Math.sin(Math.PI * u)
  }
}

/**
 * A mammoth walking: each hind foot, then the front foot on the same side a
 * quarter of a cycle after it, then the other side. `energy` at 0 is an animal
 * standing with its feet where the stride left them.
 */
export function beastGaitPose(out: BeastPose, phase: number, gait: BeastGait, energy = 1): BeastPose {
  const beat = frac(phase) * Math.PI * 2
  stepFoot(out.hindL, phase, gait)
  stepFoot(out.frontL, phase + 0.75, gait)
  stepFoot(out.hindR, phase + 0.5, gait)
  stepFoot(out.frontR, phase + 0.25, gait)
  out.rise = gait.bob * energy * Math.cos(2 * beat)
  out.pitch = 0
  out.roll = 0.024 * energy * Math.sin(beat + 0.4)
  out.raise = -0.05 * energy * Math.sin(2 * beat + 1.1)
  out.turn = 0.03 * energy * Math.sin(beat)
  out.curl = 0.08 + 0.05 * energy * Math.sin(2 * beat + 0.3)
  out.swing = 0.16 * energy * Math.sin(beat + 0.8)
  out.ears = 0.1 + 0.12 * energy * (0.5 + 0.5 * Math.sin(beat * 1.5))
  out.tail = 0.25 * energy * Math.sin(beat + 1.4)
  return out
}

/** Standing at the water: drinking, the ears fanning, the weight going from one side to the other. */
export function beastStandPose(out: BeastPose, t: number, seed = 0, alarm = 0): BeastPose {
  const slow = Math.sin(t * 0.33 + seed)
  out.rise = -0.02 + 0.012 * Math.sin(t * 0.9 + seed)
  out.pitch = 0.012 * slow
  out.roll = 0.012 * Math.sin(t * 0.27 + seed * 2.3)
  out.frontL = [0.06, 0, 0]
  out.frontR = [-0.05, 0, 0]
  out.hindL = [-0.08, 0, 0]
  out.hindR = [0.07, 0, 0]
  // Head down and the trunk to the ground; up, ears out, when something is wrong.
  out.raise = lerp(-0.22 + 0.06 * slow, 0.34, alarm)
  out.turn = lerp(0.12 * Math.sin(t * 0.21 + seed * 1.3), 0.5 * Math.sin(seed * 5), alarm)
  out.curl = lerp(0.05 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.5 + seed)), 0.95, alarm)
  out.swing = 0.14 * Math.sin(t * 0.42 + seed * 0.7) * (1 - alarm * 0.6)
  out.ears = lerp(0.12 + 0.2 * Math.max(0, Math.sin(t * 1.3 + seed * 3)), 0.95, alarm)
  out.tail = 0.3 * Math.sin(t * 0.8 + seed)
  return out
}

export function blendBeast(out: BeastPose, a: BeastPose, b: BeastPose, t: number): BeastPose {
  const m = clamp01(t)
  out.rise = lerp(a.rise, b.rise, m)
  out.pitch = lerp(a.pitch, b.pitch, m)
  out.roll = lerp(a.roll, b.roll, m)
  out.raise = lerp(a.raise, b.raise, m)
  out.turn = lerp(a.turn, b.turn, m)
  out.curl = lerp(a.curl, b.curl, m)
  out.swing = lerp(a.swing, b.swing, m)
  out.ears = lerp(a.ears, b.ears, m)
  out.tail = lerp(a.tail, b.tail, m)
  for (let i = 0; i < 3; i++) {
    out.frontL[i] = lerp(a.frontL[i]!, b.frontL[i]!, m)
    out.frontR[i] = lerp(a.frontR[i]!, b.frontR[i]!, m)
    out.hindL[i] = lerp(a.hindL[i]!, b.hindL[i]!, m)
    out.hindR[i] = lerp(a.hindR[i]!, b.hindR[i]!, m)
  }
  return out
}

/**
 * How high above where it stands a leg's top joint can be carried with the
 * foot where it is: no further from the foot than the leg is long. Nought or
 * less; and it is the leg reaching furthest, of a pair, that decides.
 */
function carried(limb: Limb, rootAt: Vector3, foot: BeastFoot): number {
  const top = limb.joint.y + rootAt.y
  const across = foot[0] + limb.stands.x - (limb.joint.x + rootAt.x)
  // Not quite its whole length: a leg is never locked straight.
  const reach = (limb.upperLength + limb.lowerLength) * 0.992
  return limb.stands.y + foot[1] + Math.sqrt(Math.max(0, reach * reach - across * across)) - top
}

/** The lesser of two, without the corner: the body does not jolt as one leg takes over from the other. */
const softMin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/**
 * Puts a pose on a mammoth's skeleton.
 *
 * The body is carried on its legs, not posed over them: each end of it is as
 * high as the legs under that end allow — highest as it passes over a leg
 * that is upright, lowest when one foot has just landed far ahead and the
 * other is about to leave far behind. That is what a walking animal's back
 * does, the two ends of it a quarter of a stride apart; and it is what lets
 * the legs be straight when they bear weight, which is what an elephant's are.
 */
export function applyBeast(byName: Map<string, Bone>, pose: BeastPose, frame: FigureFrame): void {
  const root = byName.get('hips')
  if (!root || !frame.arms) return
  const front = Math.min(0, softMin(carried(frame.arms, frame.rootAt, pose.frontL), carried(frame.arms, frame.rootAt, pose.frontR), 0.05))
  const hind = Math.min(0, softMin(carried(frame.legs, frame.rootAt, pose.hindL), carried(frame.legs, frame.rootAt, pose.hindR), 0.05))
  const span = frame.arms.joint.x - frame.legs.joint.x
  // (An animal with no length between its legs is not one of ours, but a NaN
  // here would be one in every bone below.)
  const slope = span > 1e-3 ? (hind - front) / span : 0
  const pitch = pose.pitch + Math.asin(Math.max(-0.5, Math.min(0.5, Number.isFinite(slope) ? slope : 0)))
  // The root is not quite over the hind legs: what it is lifted by the pitch, it is let down again.
  const rise = pose.rise + hind + Math.sin(pitch) * frame.legs.joint.x

  pelvis.setFromAxisAngle(Z, -pitch)
  pelvis.multiply(q.setFromAxisAngle(X, pose.roll))
  pelvisInverse.copy(pelvis).invert()
  root.quaternion.copy(pelvis)
  root.position.set(frame.rootRest.x, frame.rootRest.y + rise / frame.size, frame.rootRest.z)
  rootNow.copy(frame.rootAt)
  rootNow.y += rise

  solveLimb(byName, frame.legs, 'L', 1, pose.hindL[0], pose.hindL[1], 0, pose.hindL[2])
  solveLimb(byName, frame.legs, 'R', -1, pose.hindR[0], pose.hindR[1], 0, pose.hindR[2])
  solveLimb(byName, frame.arms, 'L', 1, pose.frontL[0], pose.frontL[1], 0, pose.frontL[2])
  solveLimb(byName, frame.arms, 'R', -1, pose.frontR[0], pose.frontR[1], 0, pose.frontR[2])

  const neck = byName.get('neck')
  const head = byName.get('head')
  if (neck) neck.quaternion.setFromAxisAngle(Z, pose.raise * 0.5).multiply(q.setFromAxisAngle(Y, pose.turn * 0.5))
  if (head) head.quaternion.setFromAxisAngle(Z, pose.raise * 0.5).multiply(q.setFromAxisAngle(Y, pose.turn * 0.5))
  // The trunk curls forward and up from its tip, each joint a little more than the last.
  for (let i = 1; i <= 4; i++) {
    const bone = byName.get(`trunk${i}`)
    if (!bone) continue
    bone.quaternion.setFromAxisAngle(Z, pose.curl * (0.25 + i * 0.22)).multiply(q.setFromAxisAngle(X, pose.swing * (0.2 + i * 0.12)))
  }
  const earL = byName.get('earL')
  const earR = byName.get('earR')
  if (earL) earL.quaternion.setFromAxisAngle(Y, -pose.ears * 0.9)
  if (earR) earR.quaternion.setFromAxisAngle(Y, pose.ears * 0.9)
  const tail = byName.get('tail')
  if (tail) tail.quaternion.setFromAxisAngle(X, pose.tail).multiply(q.setFromAxisAngle(Z, -0.1))
}
