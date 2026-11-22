import { ConeGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, SkinnedMesh, Vector3, type Bone, type Material } from 'three'
import type { CreatureDetail } from './creatures'
import { buildSkeleton } from './creatureRig'
import type { Air, Arrivals } from './evoAir'
import type { FigureKind } from './evoFigures'
import { groundAt } from './evoLand'
import { FIGURE_LOOKS, type FigureLookName } from './evoLooks'
import { createFigureUniforms, makeFigureMaterial, type FigureUniforms } from './evoMaterials'
import {
  BEAST_GAITS,
  GAITS,
  applyBeast,
  applyPose,
  beastGaitPose,
  beastStandPose,
  blendBeast,
  blendPose,
  createBeastPose,
  createPose,
  gaitPose,
  measure,
  sitPose,
  standPose,
  type FigureFrame,
  type Pose,
} from './evoRig'
import { CAST, ELDER, HERD, HUNTERS, SPEAR_LANDS, herdAt, hunterAt, type Beast, type Walker } from './evoScript'
import type { Beat, Part } from './evoWalk'
import { requestCreature } from './useCreature'

/**
 * The people and animals of the long walk, on stage.
 *
 * A `Figure` is one of them standing somewhere: the shared mesh for its kind,
 * a skeleton and a finish of its own, and a group whose origin is the ground
 * under it. What it does is not in here but in `evoScript.ts`, as a function of
 * how far the page has been scrolled; this file turns that into steps.
 *
 * Steps are the one thing that is *not* a pure function of the scroll. Where a
 * figure is, is; but its stride is counted forward from how far it has moved
 * since the last frame, at no more than the pace a body can keep. Flick the
 * wheel and a hunter covers thirty metres in a breath — at a run, not with its
 * legs a blur — and when the page is still, so is everyone on it: standing,
 * breathing, looking about, where a clip scrubbed to that frame would have
 * left them frozen in mid-stride.
 */

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const ramp = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * One request to the meshing worker at a time. There is one worker, and a
 * request that sits in its queue for more than a few seconds is taken back and
 * built on the main thread — which, with four figures asked for at once, is
 * the last of them stalling the page for a second.
 */
let queue: Promise<unknown> = Promise.resolve()
function inTurn<T>(ask: () => Promise<T>): Promise<T> {
  const next = queue.then(ask, ask)
  queue = next.catch(() => undefined)
  return next
}

export interface FigureOptions {
  detail: CreatureDetail
  look: FigureLookName
  /** How much taller or shorter than the sculpt, which is a metre seventy-six. */
  scale?: number
  bump: number
  shadows: boolean
}

export class Figure {
  /** Stands on the ground at its origin and faces +x until it is turned. */
  readonly group = new Group()
  byName: Map<string, Bone> | null = null
  frame: FigureFrame | null = null
  readonly uniforms: FigureUniforms
  private readonly inner = new Group()
  private material: Material | null = null
  private skeletonDispose: (() => void) | null = null
  private gone = false

  constructor(kind: FigureKind, air: Air & Arrivals, key: string, options: FigureOptions) {
    this.uniforms = createFigureUniforms(FIGURE_LOOKS[options.look], options.bump)
    this.group.add(this.inner)
    this.group.visible = false
    void inTurn(() => requestCreature(kind, options.detail)).then((creature) => {
      if (this.gone) return
      const size = (creature.size ?? 1) * (options.scale ?? 1)
      const material = makeFigureMaterial(air, this.uniforms, key)
      const mesh = new SkinnedMesh(creature.geometry, material)
      // Its bounds are the sculpt's, not the pose's; the cast hides what is out of sight itself.
      mesh.frustumCulled = false
      mesh.castShadow = options.shadows
      mesh.receiveShadow = options.shadows
      const { root, skeleton, byName } = buildSkeleton(creature.bones)
      this.inner.add(mesh, root)
      mesh.bind(skeleton, new Matrix4())
      creature.geometry.computeBoundingBox()
      this.inner.scale.setScalar(size)
      // The mesh is centred on its middle; its feet are half its height below.
      this.inner.position.y = -(creature.geometry.boundingBox?.min.y ?? -0.5) * size
      this.byName = byName
      this.frame = measure(creature.bones, size)
      this.material = material
      this.skeletonDispose = () => skeleton.dispose()
      air.arrived?.(this.group)
    })
  }

  /** Puts it on the ground at a spot, facing along `heading` (an angle on the map from +x towards +z). */
  place(x: number, z: number, heading: number, lift = 0): void {
    this.group.position.set(finite(x), finite(groundAt(x, z) + lift), finite(z))
    this.group.rotation.y = -finite(heading)
  }

  /** Whether it has been built yet: nothing can be posed before its mesh arrives. */
  get ready(): boolean {
    return this.frame !== null
  }

  dispose(): void {
    this.gone = true
    this.material?.dispose()
    this.skeletonDispose?.()
    // The geometry belongs to the creature cache and is shared: never disposed here.
  }
}

/** A spear: a shaft a little over two metres long with a flake of stone on the end. */
function makeSpear(): { spear: Group; dispose: () => void } {
  const shaft = new CylinderGeometry(0.013, 0.016, 2.15, 6)
  const tip = new ConeGeometry(0.024, 0.16, 5)
  const wood = new MeshStandardMaterial({ color: '#4b3523', roughness: 0.9 })
  const stone = new MeshStandardMaterial({ color: '#2c2b2a', roughness: 0.5 })
  const spear = new Group()
  // Along +x, with the grip a third of the way up from the butt.
  const a = new Mesh(shaft, wood)
  a.rotation.z = -Math.PI / 2
  a.position.x = 0.36
  const b = new Mesh(tip, stone)
  b.rotation.z = -Math.PI / 2
  b.position.x = 0.36 + 1.075 + 0.07
  a.castShadow = true
  spear.add(a, b)
  return {
    spear,
    dispose: () => {
      shaft.dispose()
      tip.dispose()
      wood.dispose()
      stone.dispose()
    },
  }
}

/** Strides a second a body keeps to: walking, stalking, running. */
const CADENCE = { walk: 1.0, stalk: 0.62, run: 1.5 }

interface Stepper {
  phase: number
  travelled: number
  /** 0 still, 1 moving: eased, so a figure settles into standing and steps off again. */
  moving: number
  started: boolean
}

const stepper = (): Stepper => ({ phase: 0, travelled: 0, moving: 0, started: false })

/** Counts strides forward from how far a figure has moved, at no more than `cadence` a second. */
function step(s: Stepper, travelled: number, stride: number, cadence: number, dt: number): void {
  if (!s.started) {
    s.started = true
    s.travelled = travelled
    return
  }
  const moved = travelled - s.travelled
  s.travelled = travelled
  const most = cadence * dt
  s.phase += Math.min(most, Math.max(-most, moved / stride))
  const speed = dt > 0 ? Math.abs(moved) / dt : 0
  s.moving += (ramp(0.04, 0.5, speed) - s.moving) * (1 - Math.exp(-(speed > 0.04 ? 9 : 3.2) * dt))
}

const V = new Vector3()
const X_AXIS = new Vector3(1, 0, 0)

/** Tells the meadow where something is walking through it: a slot, a place, how wide and how hard. */
export type Tread = (index: number, x: number, z: number, radius: number, strength: number) => void

export function createCast(air: Air & Arrivals, detail: { people: CreatureDetail; beasts: CreatureDetail }, bump: number, shadows: boolean, tread?: Tread): Part {
  const root = new Group()
  const disposers: (() => void)[] = []

  // ---- the hunting party, and the one who stays ---------------------------
  const looks: FigureLookName[] = ['hunter', 'early', 'elder']
  const hunters = HUNTERS.map((_, i) => {
    const figure = new Figure('early', air, `hunter${i}`, { detail: detail.people, look: looks[i] ?? 'early', scale: [1, 0.95, 0.985][i] ?? 1, bump, shadows })
    root.add(figure.group)
    const { spear, dispose } = makeSpear()
    disposers.push(dispose, () => figure.dispose())
    return { figure, spear, stepper: stepper(), state: {} as Walker, held: null as boolean | null }
  })
  const elder = new Figure('early', air, 'elder', { detail: detail.people, look: 'elder', scale: 0.93, bump, shadows })
  root.add(elder.group)
  disposers.push(() => elder.dispose())

  // The spear that is thrown: the first hunter's, once it has left the hand.
  const thrown = makeSpear()
  thrown.spear.visible = false
  root.add(thrown.spear)
  disposers.push(thrown.dispose)

  // ---- the herd ------------------------------------------------------------
  const herd = HERD.map((home, i) => {
    const figure = new Figure('mammoth', air, `mammoth${i}`, { detail: detail.beasts, look: 'mammoth', scale: home.size, bump, shadows })
    root.add(figure.group)
    disposers.push(() => figure.dispose())
    return { figure, stepper: stepper(), state: {} as Beast, home }
  })

  const walk = createPose()
  const stalk = createPose()
  const run = createPose()
  const rest = createPose()
  const sit = createPose()
  const pose = createPose()
  const beastWalk = createBeastPose()
  const beastAmble = createBeastPose()
  const beastRest = createBeastPose()
  const beastPose = createBeastPose()
  const release = { x: 0, y: 0, z: 0 }
  {
    const at = hunterAt(0, CAST.from, {} as Walker)
    release.x = at.x + Math.cos(at.heading) * 0.7
    release.z = at.z + Math.sin(at.heading) * 0.7
    release.y = groundAt(at.x, at.z) + 1.95
  }

  function posePerson(s: Stepper, w: Walker, t: number, seed: number): Pose {
    gaitPose(walk, s.phase, GAITS.walk, s.moving)
    gaitPose(stalk, s.phase, GAITS.stalk, s.moving)
    gaitPose(run, s.phase, GAITS.run, s.moving)
    blendPose(pose, walk, stalk, w.low)
    blendPose(pose, pose, run, w.running)
    // Still: standing, or held low and motionless if that is how it was moving.
    standPose(rest, t, seed)
    gaitPose(stalk, s.phase, GAITS.stalk, 0)
    blendPose(rest, rest, stalk, w.low)
    blendPose(pose, rest, pose, s.moving)
    if (w.seated > 0) blendPose(pose, pose, sitPose(sit, t, seed), w.seated)
    return pose
  }

  function update(beat: Beat): void {
    const { p, t, dt } = beat

    // ---- people ------------------------------------------------------------
    const peopleSeen = p < 0.5
    hunters.forEach((hunter, i) => {
      const { figure, state: w, stepper: s } = hunter
      figure.group.visible = peopleSeen && figure.ready
      if (!figure.ready || !figure.byName || !figure.frame) return
      figure.uniforms.uLight.value.copy(beat.light)
      hunterAt(i, p, w)
      const stride = GAITS.walk.stride + (GAITS.stalk.stride - GAITS.walk.stride) * w.low + (GAITS.run.stride - GAITS.walk.stride) * w.running
      const cadence = CADENCE.walk + (CADENCE.stalk - CADENCE.walk) * w.low + (CADENCE.run - CADENCE.walk) * w.running
      step(s, w.travelled, stride, cadence, dt)
      tread?.(i, w.x, w.z, 0.85, peopleSeen ? 0.75 : 0)
      if (!peopleSeen) return
      figure.place(w.x, w.z, w.heading)
      const posed = posePerson(s, w, t, i * 2.7 + 0.4)

      // The one who throws: the arm drawn back, then through.
      const drawn = clamp01(w.cast) * (1 - clamp01(w.cast - 1))
      const through = clamp01(w.cast - 1)
      if (w.cast > 0) {
        posed.armR[0] += (-1.35 - posed.armR[0]) * drawn + (1.45 - posed.armR[0]) * through
        posed.armR[1] += (0.55 - posed.armR[1]) * Math.max(drawn, through * 0.5)
        posed.armR[2] += (1.3 - posed.armR[2]) * drawn + (0.25 - posed.armR[2]) * through
        posed.counter += -0.55 * drawn + 0.45 * through
        posed.bend += 0.28 * through - 0.08 * drawn
        posed.armL[0] += (0.9 - posed.armL[0]) * drawn
        posed.armL[2] += (0.5 - posed.armL[2]) * drawn
      }
      applyPose(figure.byName, posed, figure.frame)

      // The spear lies by its owner at the fire, rides in the right hand once
      // they are up, and for the one who throws, leaves it.
      const hand = figure.byName.get('handR')
      const inHand = w.seated < 0.45 && !(i === 0 && p >= CAST.from)
      if (hand && inHand !== hunter.held) {
        hunter.held = inHand
        if (inHand) {
          hand.add(hunter.spear)
          hunter.spear.scale.setScalar(1 / figure.frame.size)
          // Gripped in the palm, lying forward and a little up.
          hunter.spear.position.copy(figure.frame.armRest).multiplyScalar(0.085 / figure.frame.size)
          hunter.spear.position.z *= -1
          hunter.spear.quaternion.setFromUnitVectors(X_AXIS, V.set(1, 0.16, -0.04).normalize())
        } else {
          root.add(hunter.spear)
          hunter.spear.scale.setScalar(1)
          const seat = HUNTERS[i]!.seat
          const lie = HUNTERS[i]!.facing + 1.9
          hunter.spear.position.set(seat[0] + Math.cos(lie + 1.4) * 0.55, groundAt(seat[0], seat[1]) + 0.03, seat[1] + Math.sin(lie + 1.4) * 0.55)
          hunter.spear.rotation.set(0, -lie, 0)
        }
      }
      hunter.spear.visible = w.seated >= 0.45 || inHand
    })

    // The spear in the air, and where it ends up.
    const flying = p >= CAST.from
    thrown.spear.visible = flying && peopleSeen
    if (flying) {
      const u = clamp01((p - CAST.from) / (CAST.until - CAST.from))
      const endY = groundAt(SPEAR_LANDS.x, SPEAR_LANDS.z) + 0.45
      const arc = 3.4
      const x = release.x + (SPEAR_LANDS.x - release.x) * u
      const z = release.z + (SPEAR_LANDS.z - release.z) * u
      const y = release.y + (endY - release.y) * u + arc * 4 * u * (1 - u)
      // Pointing the way it is going, and left standing the way it came down.
      const uu = Math.min(u, 0.985)
      V.set(SPEAR_LANDS.x - release.x, endY - release.y + arc * 4 * (1 - 2 * uu), SPEAR_LANDS.z - release.z).normalize()
      thrown.spear.position.set(x - V.x * 1.3, y - V.y * 1.3, z - V.z * 1.3)
      thrown.spear.quaternion.setFromUnitVectors(X_AXIS, V)
    }

    elder.group.visible = p < 0.26 && elder.ready
    if (elder.group.visible && elder.byName && elder.frame) {
      elder.uniforms.uLight.value.copy(beat.light)
      elder.place(ELDER.seat[0], ELDER.seat[1], ELDER.facing)
      applyPose(elder.byName, sitPose(sit, t, 5.1), elder.frame)
    }

    // ---- the herd ----------------------------------------------------------
    const herdSeen = p > 0.19 && p < 0.56
    herd.forEach((animal, i) => {
      const { figure, state: b, stepper: s, home } = animal
      figure.group.visible = herdSeen && figure.ready
      if (!figure.ready || !figure.byName || !figure.frame) return
      herdAt(i, p, b)
      const fast = clamp01(b.fleeing)
      const stride = (BEAST_GAITS.walk.stride + (BEAST_GAITS.amble.stride - BEAST_GAITS.walk.stride) * fast) * home.size
      step(s, b.travelled, stride, 0.62 + 0.5 * fast, dt)
      tread?.(3 + i, b.x, b.z, 2.9 * home.size, herdSeen ? 0.9 : 0)
      if (!herdSeen) return
      figure.uniforms.uLight.value.copy(beat.light)
      figure.place(b.x, b.z, b.heading)
      beastGaitPose(beastWalk, s.phase, BEAST_GAITS.walk, s.moving)
      beastGaitPose(beastAmble, s.phase, BEAST_GAITS.amble, s.moving)
      blendBeast(beastPose, beastWalk, beastAmble, fast)
      beastStandPose(beastRest, t, home.seed, b.alarm)
      blendBeast(beastPose, beastRest, beastPose, s.moving)
      // Running, the head stays up and the ears out.
      beastPose.raise += (0.22 - beastPose.raise) * fast * 0.7
      beastPose.ears += (0.8 - beastPose.ears) * fast * 0.6
      beastPose.curl += (0.5 - beastPose.curl) * fast * 0.5
      applyBeast(figure.byName, beastPose, figure.frame)
    })
  }

  return {
    object: root,
    update,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}
