import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { MathUtils, Vector3, type Bone, type Camera, type Group, type Mesh, type SkinnedMesh } from 'three'
import { pointer } from '@/lib/pointer'
import { DIGIT_HEIGHT } from './notFoundGlyphs'
import { cue } from '@/features/sound/store'
import { OPENING, type StageLayout } from '@/lib/notFound'
import type { Theme } from '@/theme/context'
import { DINOSAUR_EYE, type CreatureDetail } from './creatures'
import { animateDinoRun, poseLeg, useBind, useCreature, type Rig } from './creatureRig'
import { Eyes, Teeth } from './creatureFittings'
import { GLOW_LAYER } from './notFoundBloom'
import { FIELD, EMBERS } from './notFoundMaterials'
import { ACTS, IDLE_ORDER, POKE_ORDER, newPose, turnFacingCamera, walkHeading, type RexAct, type RexActName, type RexBeat, type RexPose } from './notFoundRexActs'
import { biteNumber, biteSpot, finite, healBite, panOf, pushWave, requestAct, seeded, show, smooth, spawnDust, spawnRing, spawnSparks } from './notFoundShow'
import { SkinMaterial } from './skinMaterial'

/**
 * The tyrannosaur on the 404 page: where it walks, what it looks at and what it
 * does next. What each act *is* lives in `notFoundRexActs.ts` as numbers; this
 * blends them over the idle and writes the bones.
 */

/** Seconds per full two-step stride: a heavy, hurrying walk. */
const STRIDE = 1.12

/**
 * How far the body travels per stride, in multiples of its own scale, so the
 * planted foot stays planted: the hip swings ±0.44 rad over a leg about 0.19 of
 * the animal's length, and each stride is two steps.
 */
const STRIDE_REACH = 1.7 * 0.188

const HEADING_WALK = Math.PI + 0.06
const HEADING_REST = Math.PI + 0.58
/** Turned to face the number, a little away from the camera. */
const HEADING_BITE = Math.PI - 0.35

/** Where the snout sits on the head bone, in the animal's own units. */
const SNOUT = new Vector3(0.122, -0.014, 0)

/** From the middle of the animal to the end of its nose, as a share of its length. */
const NOSE = 0.49

/** How far it can open its mouth, in radians. */
const JAW_RANGE = 0.68

/** The slowest it walks while it has anywhere left to go. */
const MIN_GAIT = 0.4

const scratch = new Vector3()
const scratch2 = new Vector3()

/**
 * The same animal in black on the glow layer, because glow is drawn over the
 * finished frame: without this, the number's light shines straight through
 * whatever is standing in front of it.
 */
export function GlowMask({ rig }: { rig: Rig }) {
  const mesh = useRef<SkinnedMesh>(null)
  useBind(mesh, rig.skeleton)
  return (
    <skinnedMesh ref={mesh} geometry={rig.geometry} frustumCulled={false} layers={GLOW_LAYER}>
      <meshBasicMaterial color="#000000" toneMapped={false} />
    </skinnedMesh>
  )
}

interface RexBones {
  byName: Rig['byName']
  spine1: Bone
  spine2: Bone
  neck1: Bone
  neck2: Bone
  head: Bone
  jaw: Bone
  armL: Bone
  armR: Bone
  footL: Bone
  footR: Bone
  tail: Bone[]
  legs: { thigh: Bone; shin: Bone; foot: Bone }[]
}

function rexBones(byName: Rig['byName']): RexBones {
  return {
    byName,
    spine1: byName.get('spine1')!,
    spine2: byName.get('spine2')!,
    neck1: byName.get('neck1')!,
    neck2: byName.get('neck2')!,
    head: byName.get('head')!,
    jaw: byName.get('jaw')!,
    armL: byName.get('armL')!,
    armR: byName.get('armR')!,
    footL: byName.get('footL')!,
    footR: byName.get('footR')!,
    tail: ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'].map((name) => byName.get(name)!),
    legs: (['L', 'R'] as const).map((side) => ({
      thigh: byName.get(`thigh${side}`)!,
      shin: byName.get(`shin${side}`)!,
      foot: byName.get(`foot${side}`)!,
    })),
  }
}

interface RunningAct {
  def: RexAct
  start: number
  /** Still walking to where it has to be. */
  approaching: boolean
  nextBeat: number
}

interface RexState {
  /** The layout it last planned against: a window that changes shape moves everything. */
  layout: StageLayout | null
  x: number
  z: number
  yaw: number
  restYaw: number
  goalX: number
  goalZ: number
  movingSince: number
  pace: number
  gait: number
  lookYaw: number
  lookPitch: number
  pose: RexPose
  target: RexPose
  act: RunningAct | null
  aim: Vector3
  aiming: boolean
  nextIdle: number
  idleIndex: number
  pokeIndex: number
  nextSnap: number
  nextBlink: number
  blinkAt: number
  /** Out of breath: decays back to nothing after anything strenuous. */
  pant: number
  lastPointerX: number
  lastPointerY: number
  pointerMovedAt: number
}

const newRexState = (): RexState => ({
  layout: null,
  x: Infinity,
  z: 0,
  yaw: HEADING_WALK,
  restYaw: HEADING_REST,
  goalX: 0,
  goalZ: 0,
  movingSince: 0,
  pace: 0,
  gait: 0,
  lookYaw: 0,
  lookPitch: 0,
  pose: newPose(),
  target: newPose(),
  act: null,
  aim: new Vector3(),
  aiming: false,
  nextIdle: 0,
  idleIndex: 0,
  pokeIndex: 0,
  nextSnap: 0,
  nextBlink: 2,
  blinkAt: -10,
  pant: 0,
  lastPointerX: 0,
  lastPointerY: 0,
  pointerMovedAt: -10,
})

function startAct(s: RexState, name: RexActName): void {
  const def = ACTS[name]
  const L = show.layout
  s.act = { def, start: show.t, approaching: false, nextBeat: 0 }
  show.rexBusy = !def.interruptible
  if (def.approach === 'number') {
    biteSpot(L, s.aim)
    s.aiming = true
    if (L.reachesNumber) {
      // Stand so the nose comes down on the number, near enough, once it is facing it.
      s.goalX = s.aim.x + Math.cos(HEADING_BITE - Math.PI) * L.rexScale * NOSE
      s.goalZ = Math.max(0.75, s.aim.z + Math.sin(Math.PI - HEADING_BITE) * L.rexScale * NOSE)
      s.restYaw = HEADING_BITE
      s.act.approaching = true
      s.movingSince = show.t
    }
  } else if (def.approach === 'roam') {
    const n = s.idleIndex + 3
    s.goalX = L.rexX + (seeded(n, 71) * 1.2 - 1) * L.rexRoam
    s.goalZ = L.rexZ + (seeded(n, 72) - 0.6) * (L.reachesNumber ? 0.8 : 0.2)
    s.restYaw = HEADING_REST
    s.act.approaching = true
    s.movingSince = show.t
  }
}

/** The acts that leave it out of breath. */
const WINDING: readonly RexActName[] = ['roar', 'stomp', 'tailSlam', 'bite']

function finishAct(s: RexState, def: RexAct): void {
  s.act = null
  s.aiming = false
  show.rexBusy = false
  if (WINDING.includes(def.name)) s.pant = 1
  // It stays where it has got to, and just turns back round to the room.
  if (def.name === 'bite') s.restYaw = HEADING_REST
  if (def.name === 'flinch' && show.t - show.roarAt > 2.6) requestAct('roar', 0.1)
  s.nextIdle = show.t + 3.2 + seeded(s.idleIndex, 73) * 3.6
}

/** The moments that have effects outside the animal's own skeleton. */
function fire(beat: RexBeat, s: RexState, bones: RexBones): void {
  const L = show.layout
  const { mouth } = show
  const pan = panOf(mouth.x)
  switch (beat) {
    case 'breathIn':
      show.roarAt = show.t
      cue({ kind: 'roar', pan, short: show.roars++ % 2 === 1 })
      break
    case 'roarOut':
      for (let i = 0; i < 3; i++) spawnRing(mouth, 3.4 + i * 1.5, 0.95, 0.62 - i * 0.14, i * 0.14)
      spawnSparks(mouth, 0.42)
      cue({ kind: 'rattle', pan, power: 1 })
      pushWave(mouth.x, Math.min(mouth.y, L.stageY - DIGIT_HEIGHT * 0.5 * L.stageScale), 1, 0)
      show.shake = Math.max(show.shake, 0.62)
      EMBERS.uGust.value -= 1.6
      FIELD.uLava.value = Math.max(FIELD.uLava.value, 1.7)
      break
    case 'chomp':
      show.thump = Math.max(show.thump, 0.5)
      spawnSparks(mouth, 0.14)
      cue({ kind: 'chomp', pan })
      break
    case 'bite':
      biteNumber(s.aim)
      show.shake = Math.max(show.shake, 0.5)
      pushWave(s.aim.x, s.aim.y, 0.55, 0.3)
      spawnSparks(mouth, 0.34)
      FIELD.uLava.value = Math.max(FIELD.uLava.value, 1.5)
      cue({ kind: 'chomp', pan })
      cue({ kind: 'crunch', pan })
      break
    case 'crunch':
      spawnSparks(mouth, 0.12)
      cue({ kind: 'crunch', pan })
      break
    case 'gulp':
      cue({ kind: 'gulp', pan })
      break
    case 'burp':
      spawnSparks(mouth, 0.3)
      spawnDust(mouth, 0.3)
      show.thump = Math.max(show.thump, 0.25)
      cue({ kind: 'snort', pan })
      break
    case 'swish':
      cue({ kind: 'swish', pan: panOf(s.x + L.rexScale * 0.4) })
      break
    case 'slam': {
      bones.tail[4]!.getWorldPosition(scratch)
      scratch.y = L.groundY + 0.05
      spawnDust(scratch, 1.3)
      show.thump = 1
      show.shake = Math.max(show.shake, 0.5)
      pushWave(scratch.x, L.stageY - DIGIT_HEIGHT * 0.5 * L.stageScale, 0.55, 0)
      cue({ kind: 'slam', pan: panOf(scratch.x) })
      cue({ kind: 'rattle', pan: panOf(scratch.x), power: 0.8 })
      break
    }
    case 'stomp': {
      bones.legs[1]!.foot.getWorldPosition(scratch)
      scratch.y = L.groundY + 0.04
      spawnDust(scratch, 1.1)
      show.thump = 1
      show.shake = Math.max(show.shake, 0.46)
      pushWave(scratch.x, L.stageY - DIGIT_HEIGHT * 0.5 * L.stageScale, 0.5, 0)
      cue({ kind: 'slam', pan: panOf(scratch.x) })
      cue({ kind: 'rattle', pan: panOf(scratch.x), power: 0.6 })
      break
    }
    case 'snort':
      spawnDust(mouth, 0.22)
      cue({ kind: 'snort', pan })
      break
    case 'sniff':
      cue({ kind: 'sniff', pan })
      break
    case 'yawn':
      cue({ kind: 'yawn', pan })
      break
    case 'clack':
      cue({ kind: 'chomp', pan, quiet: true })
      break
    case 'shakeOff':
      spawnSparks(mouth, 0.2)
      spawnDust(mouth, 0.3)
      cue({ kind: 'snort', pan })
      break
    case 'snarl':
      cue({ kind: 'snarl', pan })
      break
  }
}

/**
 * One frame of the tyrannosaur. A plain function, like the animators in
 * `creatureRig`, because all it does is write to bones.
 */
function driveRex(b: Group, s: RexState, bones: RexBones, feet: number, camera: Camera, dt: number, reducedMotion: boolean, eyes: Group | null, tongue: Mesh | null): void {
  const L = show.layout
  const t = show.t
  const step = Math.min(dt, 0.25)

  if (reducedMotion) {
    b.position.set(L.rexX, L.groundY + feet * L.rexScale, L.rexZ)
    b.scale.setScalar(L.rexScale)
    b.rotation.set(0, HEADING_REST, 0)
    show.arrived = true
    return
  }

  healBite()

  if (s.layout !== L) {
    // The window has changed shape, and with it where everything goes.
    s.layout = L
    if (s.x !== Infinity) {
      s.goalX = L.rexX
      s.goalZ = L.rexZ
      s.restYaw = HEADING_REST
      if (show.arrived) {
        s.x = L.rexX
        s.z = L.rexZ
      }
    }
  }

  // ---- Getting there -------------------------------------------------------
  if (s.x === Infinity) {
    s.x = L.rexFrom
    s.z = L.rexZ
    s.goalX = L.rexX
    s.goalZ = L.rexZ
  }
  if (show.walkFrom === Infinity && t >= OPENING.walk) {
    show.walkFrom = t
    s.movingSince = t
  }
  b.visible = t >= show.walkFrom
  const walkingAllowed = t >= show.walkFrom

  const dx = s.goalX - s.x
  const dz = s.goalZ - s.z
  const distance = Math.hypot(dx, dz)
  const moving = walkingAllowed && distance > 0.09
  let gaitTarget = 0
  if (moving) {
    const off = turnFacingCamera(s.yaw, walkHeading(dx, dz, Math.cos(s.yaw) < 0))
    if (Math.abs(off) > 0.5) {
      // A big animal turns on the spot in small steps before it sets off.
      gaitTarget = 0.42
      s.yaw += MathUtils.clamp(off, -2.1 * step, 2.1 * step)
      s.movingSince = t
    } else {
      // With a floor under it: speed follows the legs and the legs follow the
      // distance left, so without one it crawls the last stretch for ever.
      gaitTarget = Math.min(smooth(0, 0.5, t - s.movingSince), Math.max(MIN_GAIT, smooth(0, 0.9, distance)))
      s.yaw += off * Math.min(1, step * 5)
      // Speed follows the legs, so the planted foot does not skate.
      const travel = Math.min(distance, ((STRIDE_REACH * L.rexScale) / STRIDE) * s.gait * step)
      s.x += (dx / distance) * travel
      s.z += (dz / distance) * travel
    }
  } else if (walkingAllowed) {
    if (!show.arrived && distance <= 0.09) show.arrived = true
    s.yaw += turnFacingCamera(s.yaw, s.restYaw) * Math.min(1, step * 2.4)
    if (show.arrived && !s.act && show.rexRequest === null && show.roarAt < 0 && !show.rexBusy) requestAct('roar', OPENING.windUp)
  }
  s.gait = MathUtils.damp(s.gait, gaitTarget, 9, step)
  const beforePace = s.pace
  s.pace += (step / STRIDE) * (s.gait > 0.02 ? 1 : 0)

  // Heel strike a quarter into each leg's cycle.
  if (Math.floor(beforePace * 2 - 0.5) !== Math.floor(s.pace * 2 - 0.5) && s.gait > 0.3) {
    show.thump = Math.max(show.thump, s.gait)
    show.shake = Math.max(show.shake, 0.14 * s.gait)
    cue({ kind: 'footfall', pan: panOf(s.x), power: s.gait })
    const which = Math.floor(s.pace * 2 - 0.5) % 2 === 0 ? bones.footL : bones.footR
    which.getWorldPosition(scratch)
    scratch.y = L.groundY + 0.04
    spawnDust(scratch, 0.65 * s.gait)
    pushWave(s.x - L.rexScale * 0.2, L.stageY - DIGIT_HEIGHT * L.stageScale * 0.5, 0.2 * s.gait, 0)
  }

  // ---- What to do next ------------------------------------------------------
  if (show.rexPoked) {
    show.rexPoked = false
    requestAct(POKE_ORDER[s.pokeIndex++ % POKE_ORDER.length]!)
    s.nextSnap = t + 1.2
  }
  const request = show.rexRequest
  if (request && t >= request.at && show.arrived) {
    if (!s.act || s.act.def.interruptible) {
      show.rexRequest = null
      startAct(s, request.name)
    } else if (t > request.at + 2.5) {
      show.rexRequest = null
    }
  }

  // Keep the cursor away from its mouth.
  const pointerLive = pointer.active && pointer.inside && !pointer.isTouch
  if (pointerLive && (pointer.nx !== s.lastPointerX || pointer.ny !== s.lastPointerY)) {
    s.lastPointerX = pointer.nx
    s.lastPointerY = pointer.ny
    s.pointerMovedAt = t
  }
  if (show.arrived && !s.act && !moving && pointerLive && t >= s.nextSnap) {
    scratch2.set(pointer.nx, pointer.ny, 0.5).unproject(camera)
    scratch2.sub(camera.position).normalize()
    const along = (show.mouth.z - camera.position.z) / scratch2.z
    scratch2.multiplyScalar(along).add(camera.position)
    if (scratch2.distanceTo(show.mouth) < L.rexScale * 0.17) {
      s.aim.copy(scratch2)
      s.aiming = true
      startAct(s, 'snap')
      s.nextSnap = t + 1.5
    }
  }

  if (show.arrived && !s.act && !moving && t >= s.nextIdle && t - show.roarAt > 3 && t > OPENING.alive + 3) {
    startAct(s, IDLE_ORDER[s.idleIndex++ % IDLE_ORDER.length]!)
  }

  // ---- The act in progress ---------------------------------------------------
  const target = s.target
  Object.assign(target, ZERO_POSE)
  const running = s.act
  if (running) {
    if (running.approaching) {
      if (!moving && Math.abs(turnFacingCamera(s.yaw, s.restYaw)) < 0.14) {
        running.approaching = false
        running.start = t
      }
    } else {
      const since = t - running.start
      while (running.nextBeat < running.def.beats.length && since >= running.def.beats[running.nextBeat]!.at) {
        fire(running.def.beats[running.nextBeat++]!.beat, s, bones)
      }
      running.def.pose(since, target)
      if (since >= running.def.seconds) finishAct(s, running.def)
    }
  }

  // ---- Blend it ---------------------------------------------------------------
  const p = s.pose
  p.jaw = MathUtils.damp(p.jaw, target.jaw, 30, step)
  p.rear = MathUtils.damp(p.rear, target.rear, 14, step)
  p.crouch = MathUtils.damp(p.crouch, target.crouch, 14, step)
  p.reach = MathUtils.damp(p.reach, target.reach, 20, step)
  p.lunge = MathUtils.damp(p.lunge, target.lunge, 22, step)
  p.shake = MathUtils.damp(p.shake, target.shake, 16, step)
  p.tremble = MathUtils.damp(p.tremble, target.tremble, 16, step)
  p.tailLift = MathUtils.damp(p.tailLift, target.tailLift, 13, step)
  p.tailDrop = MathUtils.damp(p.tailDrop, target.tailDrop, 34, step)
  p.tailSwing = MathUtils.damp(p.tailSwing, target.tailSwing, 9, step)
  p.lift = MathUtils.damp(p.lift, target.lift, 26, step)
  p.lean = MathUtils.damp(p.lean, target.lean, 20, step)
  p.squint = MathUtils.damp(p.squint, target.squint, 22, step)
  p.lump = target.lump
  s.pant = MathUtils.damp(s.pant, 0, 0.42, step)

  // ---- Legs, hips -------------------------------------------------------------
  let bob = 0
  if (s.gait > 0.001) {
    bob = animateDinoRun(bones.byName, s.pace, s.gait) * 0.85 * L.rexScale * 0.17
  } else {
    bones.legs.forEach((leg) => poseLeg(leg.thigh, leg.shin, leg.foot, 0, 0))
  }
  // Standing still is a stance, not a statue: one foot forward, knees soft.
  const sit = (1 - s.gait) * (1 + p.crouch * 0.5)
  const [front, back] = bones.legs
  if (front && back) {
    front.thigh.rotation.z += sit * 0.3
    front.shin.rotation.z -= sit * 0.42
    front.foot.rotation.z += sit * 0.12
    back.thigh.rotation.z += -sit * 0.06 + p.lift * 0.78
    back.shin.rotation.z -= sit * 0.2 + p.lift * 1.2
    back.foot.rotation.z += sit * 0.26 + p.lift * 0.42
  }
  const stand = 1 - s.gait
  const breathRate = 0.95 + s.pant * 4.2
  const breath = Math.sin(t * breathRate) * (1 + s.pant * 1.3)
  const forward = p.lunge * 0.09 - p.lean * 0.075
  b.position.set(
    finite(s.x + Math.cos(s.yaw) * forward * L.rexScale, L.rexX),
    L.groundY + feet * L.rexScale + finite(bob) - sit * L.rexScale * 0.003 - p.crouch * L.rexScale * 0.018 + p.lift * L.rexScale * 0.008,
    finite(s.z - Math.sin(s.yaw) * forward * L.rexScale + Math.sin(s.pace * Math.PI * 2) * 0.02 * s.gait + Math.sin(t * 0.5) * 0.015 * stand, L.rexZ),
  )
  show.rexX = finite(s.x, L.rexX)
  b.rotation.set(0, finite(s.yaw, HEADING_REST), 0)
  b.scale.setScalar(Math.max(0.0001, finite(L.rexScale, 1)))

  // ---- Where to look -----------------------------------------------------------
  b.updateWorldMatrix(true, false)
  bones.head.getWorldPosition(scratch)
  const glancing = t < show.lookUntil
  let wide = false
  if (s.aiming) {
    scratch2.copy(s.aim)
    wide = true
  } else if (glancing) {
    scratch2.copy(show.look)
  } else if (t - show.flyerSeen < 0.3 && (!pointerLive || t - s.pointerMovedAt > 2.5)) {
    scratch2.copy(show.flyerAt)
  } else if (pointerLive) {
    scratch2.set(pointer.nx, pointer.ny, 0.5).unproject(camera)
    scratch2.sub(camera.position).normalize()
    const along = (scratch.z + 3.2 - camera.position.z) / scratch2.z
    scratch2.multiplyScalar(along).add(camera.position)
  } else {
    scratch2.set(Math.sin(t * 0.31) * 3 + scratch.x - 1, scratch.y + Math.sin(t * 0.47) * 0.9 + 0.3, scratch.z + 3.5)
  }
  // Into the animal's own frame, where +x is its nose and +y is up.
  const local = b.worldToLocal(scratch2.clone()).sub(b.worldToLocal(scratch.clone()))
  // Straight on, this skull reads as a pillow, so it keeps to three-quarters.
  const wantYaw = show.arrived ? MathUtils.clamp(Math.atan2(-local.z, local.x), wide ? -1.1 : -0.85, wide ? 0.9 : 0.34) : 0
  const wantPitch = show.arrived ? MathUtils.clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), wide ? -0.75 : -0.38, wide ? 0.85 : 0.5) : 0
  const listening = 1 - p.rear * 0.8
  s.lookYaw = MathUtils.damp(s.lookYaw, finite(wantYaw) * listening, glancing || wide ? 9 : 4, step)
  s.lookPitch = MathUtils.damp(s.lookPitch, finite(wantPitch) * listening, glancing || wide ? 9 : 4, step)

  // ---- Spine, neck, head ---------------------------------------------------------
  const lump = (at: number) => (p.lump > 0 ? Math.exp(-(((p.lump - at) * 3.2) ** 2)) * 0.2 : 0)
  bones.spine1.scale.set(1, 1 + breath * 0.02 + p.rear * 0.03, 1 + breath * 0.028 + p.rear * 0.05)
  bones.spine2.scale.set(1, 1 + breath * 0.014 + p.rear * 0.04 + lump(1), 1 + breath * 0.02 + p.rear * 0.06 + lump(1))
  bones.neck1.scale.set(1, 1 + lump(0.55), 1 + lump(0.55))
  bones.neck2.scale.set(1, 1 + lump(0.1), 1 + lump(0.1))
  bones.spine1.rotation.z = stand * 0.08 + p.rear * 0.2 - p.crouch * 0.12 + p.lean * 0.2 - p.reach * 0.04
  bones.spine2.rotation.z = stand * 0.07 + p.rear * 0.16 - p.crouch * 0.1 + p.lean * 0.12 - p.reach * 0.05

  const muttering = t - show.grumbleAt
  const grumble = muttering >= 0 && muttering < 2.4 ? Math.sin((muttering / 2.4) * Math.PI) : 0
  const tremble = p.tremble * (0.6 + Math.sin(t * 13) * 0.4) + grumble * 0.3
  const shiver = Math.sin(t * 47) * 0.028 * tremble
  const thrash = Math.sin(t * 33)
  bones.neck1.rotation.y = s.lookYaw * 0.26 + Math.sin(t * 0.33) * 0.03 + thrash * 0.1 * p.shake
  bones.neck1.rotation.z = (s.gait > 0.01 ? bones.neck1.rotation.z * s.gait : 0) + stand * 0.12 + s.lookPitch * 0.26 + p.rear * 0.3 - p.crouch * 0.26 - p.reach * 0.2
  bones.neck2.rotation.y = s.lookYaw * 0.3 + Math.sin(t * 33 + 0.9) * 0.2 * p.shake
  bones.neck2.rotation.z = (s.gait > 0.01 ? bones.neck2.rotation.z * s.gait : 0) + stand * 0.03 + s.lookPitch * 0.3 + p.rear * 0.22 - p.crouch * 0.2 - p.reach * 0.1
  bones.head.rotation.y = s.lookYaw * 0.44 + Math.sin(t * 29) * 0.02 * tremble + Math.sin(t * 33 + 1.7) * 0.34 * p.shake
  bones.head.rotation.x = shiver + Math.sin(t * 27) * 0.14 * p.shake
  bones.head.rotation.z =
    (s.gait > 0.01 ? bones.head.rotation.z * s.gait : 0) - stand * 0.16 + s.lookPitch * 0.44 + Math.sin(t * 0.55 + 0.6) * 0.03 + p.rear * 0.3 - p.crouch * 0.3 + p.reach * 0.14

  // ---- The mouth ---------------------------------------------------------------
  // Hanging a little open when it is out of breath, and never quite shut otherwise.
  const hanging = 0.03 + s.pant * (0.14 + Math.sin(t * 10) * 0.06)
  const open = Math.max(p.jaw, hanging)
  bones.jaw.rotation.z = finite(-open * JAW_RANGE)
  if (tongue) {
    tongue.rotation.z = open * 0.34 + Math.sin(t * 6) * 0.04 * open
    tongue.visible = open > 0.05
  }
  scratch.copy(SNOUT)
  bones.head.localToWorld(scratch)
  show.mouth.copy(scratch)

  // ---- The eyes -----------------------------------------------------------------
  if (t >= s.nextBlink) {
    s.blinkAt = t
    // Now and then twice in a row, the way an animal does when it is thinking.
    s.nextBlink = t + (seeded(Math.floor(t), 74) < 0.2 ? 0.3 : 2 + seeded(Math.floor(t), 75) * 4.5)
  }
  const blinking = t - s.blinkAt
  const lid = Math.max(blinking < 0.15 ? Math.sin((blinking / 0.15) * Math.PI) : 0, p.squint)
  eyes?.children.forEach((eye) => eye.scale.setY(Math.max(0.08, 1 - lid * 0.92)))

  // ---- Tail and arms --------------------------------------------------------------
  bones.tail.forEach((bone, i) => {
    const reach = 0.4 + i * 0.16
    const wave = Math.sin(t * 1.05 - i * 0.72) * (0.05 + i * 0.024)
    const swing = p.tailSwing * 0.16 * (1 + i * 0.3)
    bone.rotation.y = (s.gait > 0.01 ? bone.rotation.y * s.gait + wave * (1 - s.gait) : wave + Math.sin(t * 19 - i) * 0.02 * p.tremble * reach) + swing
    bone.rotation.z =
      (s.gait > 0.01 ? bone.rotation.z * s.gait : 0) +
      Math.sin(t * 0.72 - i * 0.5) * (0.02 + i * 0.012) +
      (i === 0 ? stand * 0.09 : 0) -
      p.rear * 0.09 * reach -
      p.tailLift * 0.21 * (1 + i * 0.28) +
      p.tailDrop * 0.19 * (1 + i * 0.3)
  })
  bones.armL.rotation.z = (s.gait > 0.01 ? bones.armL.rotation.z * s.gait : 0) + Math.sin(t * 1.7) * 0.05 - p.rear * 0.5 + Math.sin(t * 22) * 0.2 * p.shake
  bones.armR.rotation.z = (s.gait > 0.01 ? bones.armR.rotation.z * s.gait : 0) + Math.sin(t * 0.9) * 0.05 - p.rear * 0.46 - Math.sin(t * 22) * 0.2 * p.shake
}

const ZERO_POSE = newPose()

export function Rex({ theme, detail, bump, bloom, reducedMotion }: { theme: Theme; detail: CreatureDetail; bump: number; bloom: boolean; reducedMotion: boolean }) {
  const rig = useCreature('dino', detail)
  if (!rig) return null
  return <RexBody rig={rig} theme={theme} bump={bump} bloom={bloom} reducedMotion={reducedMotion} />
}

/** A dark tongue on the floor of the mouth, on the jaw bone. Only seen when it opens. */
function Tongue({ rig, handle }: { rig: Rig; handle: RefObject<Mesh | null> }) {
  const jaw = rig.byName.get('jaw')
  if (!jaw) return null
  // Bones are in normalised units; the raw anatomy is not. The eye gives the ratio.
  const unit = rig.eyes[0]!.radius / DINOSAUR_EYE.radius
  return createPortal(
    <mesh ref={handle} position={[0.14 * unit, 0.03 * unit, 0]} frustumCulled={false} visible={false}>
      <sphereGeometry args={[1, 18, 12]} />
      <meshStandardMaterial color="#6b2428" roughness={0.42} metalness={0} />
    </mesh>,
    jaw,
  )
}

function RexBody({ rig, theme, bump, bloom, reducedMotion }: { rig: Rig; theme: Theme; bump: number; bloom: boolean; reducedMotion: boolean }) {
  const body = useRef<Group>(null)
  const mesh = useRef<SkinnedMesh>(null)
  const eyes = useRef<Group>(null)
  const tongue = useRef<Mesh>(null)
  const state = useRef(newRexState())
  const invalidate = useThree((three) => three.invalidate)
  const { geometry, root, skeleton, byName } = rig
  useBind(mesh, skeleton)

  // Generated around the origin; this is how far below it the soles are.
  const feet = useMemo(() => {
    geometry.computeBoundingBox()
    return -(geometry.boundingBox?.min.y ?? -0.19)
  }, [geometry])

  const bones = useMemo(() => rexBones(byName), [byName])
  const unit = rig.eyes[0]!.radius / DINOSAUR_EYE.radius

  useEffect(() => {
    tongue.current?.scale.set(0.34 * unit, 0.05 * unit, 0.12 * unit)
    invalidate()
  }, [invalidate, rig, unit])

  useFrame(({ camera }, dt) => {
    if (body.current) driveRex(body.current, state.current, bones, feet, camera, dt, reducedMotion, eyes.current, tongue.current)
  })

  return (
    <group ref={body} position={[20, -20, 0]} scale={0.0001}>
      <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
        <SkinMaterial theme={theme} species="dino" texScale={2.6} bump={bump} halfHeight={0.22} />
      </skinnedMesh>
      {bloom && <GlowMask rig={rig} />}
      <primitive object={root} />
      <Eyes rig={rig} theme={theme} handle={eyes} />
      <Teeth rig={rig} theme={theme} />
      <Tongue rig={rig} handle={tongue} />
    </group>
  )
}

