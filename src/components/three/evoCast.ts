import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  type Bone,
} from 'three'
import type { CreatureDetail } from './creatures'
import { buildSkeleton } from './creatureRig'
import { ownShadow, type Air, type Arrivals } from './evoAir'
import type { Coat } from './evoCoat'
import { HUMAN, type FigureKind } from './evoFigures'
import { groundAt } from './evoLand'
import { FIGURE_LOOKS, type FigureLookName } from './evoLooks'
import { COAT_SPANS, createFigureUniforms, makeCoatMaterial, makeEyeMaterial, makeFigureMaterial, type FigureUniforms } from './evoMaterials'
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

/**
 * One lock of a coat, to be drawn once for every card: six rows of two
 * vertices, so it can bend five times along its length — fewer, and a lock
 * that falls over a shoulder is a zigzag. Its `position` is not
 * a place but (how far across, how far along); the shader makes the place.
 */
const STRIP_ROWS = COAT_SPANS + 1
const STRIP = (() => {
  const position = new Float32Array(STRIP_ROWS * 2 * 3)
  const index: number[] = []
  for (let row = 0; row < STRIP_ROWS; row++) {
    const along = row / (STRIP_ROWS - 1)
    position.set([-0.5, along, 0, 0.5, along, 0], row * 6)
    if (row < STRIP_ROWS - 1) index.push(row * 2, row * 2 + 1, row * 2 + 2, row * 2 + 1, row * 2 + 3, row * 2 + 2)
  }
  return { position, index }
})()

/**
 * A coat's cards as instanced attributes. Like the mesh they grow on they are
 * made once for each kind of figure, shared by everyone of that kind, and
 * never disposed: only the geometry that holds them is a figure's own, so that
 * each can draw as much of the coat as it is near enough to need.
 */
const coatAttributes = new WeakMap<Coat, { index: BufferAttribute; named: Record<string, BufferAttribute> }>()
function coatGeometry(coat: Coat): InstancedBufferGeometry {
  let attributes = coatAttributes.get(coat)
  if (!attributes) {
    attributes = {
      index: new BufferAttribute(new Uint16Array(STRIP.index), 1),
      named: {
        position: new BufferAttribute(STRIP.position, 3),
        aRoot: new InstancedBufferAttribute(coat.roots, 3),
        normal: new InstancedBufferAttribute(coat.normals, 3),
        aGrow: new InstancedBufferAttribute(coat.grow, 4),
        aAcross: new InstancedBufferAttribute(coat.across, 4),
        aTone: new InstancedBufferAttribute(coat.tone, 4),
        aShape: new InstancedBufferAttribute(coat.shape, 4),
        skinIndex: new InstancedBufferAttribute(coat.skinIndices, 4),
        skinWeight: new InstancedBufferAttribute(coat.skinWeights, 4),
      },
    }
    coatAttributes.set(coat, attributes)
  }
  // Nothing here is the geometry's own, so there is nothing of it to dispose:
  // disposing it would take the shared buffers from under everyone else's.
  const geometry = new InstancedBufferGeometry()
  for (const [name, attribute] of Object.entries(attributes.named)) geometry.setAttribute(name, attribute)
  geometry.setIndex(attributes.index)
  geometry.instanceCount = coat.count
  return geometry
}

/**
 * A circle swept along a curve through `path`, as wide at each of its points
 * as `radii` says and closed to a point at the far end: a tusk. Dressed as
 * the figure's own mesh is, so the figure's material can draw it: all horn,
 * stained where it leaves the head.
 */
function sweepGeometry(path: readonly (readonly [number, number, number])[], radii: readonly number[], around = 14, along = 48): BufferGeometry {
  const curve = new CatmullRomCurve3(
    path.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'centripetal',
  )
  const frames = curve.computeFrenetFrames(along, false)
  const count = (along + 1) * around
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const regions = new Float32Array(count * 4)
  const regions2 = new Float32Array(count * 4)
  const paint = new Float32Array(count * 4)
  const ao = new Float32Array(count).fill(1)
  const at = new Vector3()
  for (let i = 0; i <= along; i++) {
    const t = i / along
    curve.getPointAt(t, at)
    const x = t * (radii.length - 1)
    const k = Math.min(radii.length - 2, Math.floor(x))
    // Round at its end rather than cut off.
    const radius = (radii[k]! + (radii[k + 1]! - radii[k]!) * (x - k)) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.97) / 0.03, 2)))
    const n = frames.normals[i]!
    const b = frames.binormals[i]!
    for (let j = 0; j < around; j++) {
      const a = (j / around) * Math.PI * 2
      const v = (i * around + j) * 3
      const nx = Math.cos(a) * n.x + Math.sin(a) * b.x
      const ny = Math.cos(a) * n.y + Math.sin(a) * b.y
      const nz = Math.cos(a) * n.z + Math.sin(a) * b.z
      position.set([at.x + nx * radius, at.y + ny * radius, at.z + nz * radius], v)
      normal.set([nx, ny, nz], v)
      regions2[(i * around + j) * 4 + 2] = 1
      paint[(i * around + j) * 4 + 1] = 0.85 * Math.pow(Math.max(0, 1 - t / 0.42), 1.5)
    }
  }
  const index: number[] = []
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * around + j
      const b = i * around + ((j + 1) % around)
      index.push(a, b, a + around, b, b + around, a + around)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('regions', new BufferAttribute(regions, 4))
  geometry.setAttribute('regions2', new BufferAttribute(regions2, 4))
  geometry.setAttribute('paint', new BufferAttribute(paint, 4))
  geometry.setAttribute('aoValue', new BufferAttribute(ao, 1))
  geometry.setIndex(index)
  return geometry
}

export interface FigureOptions {
  detail: CreatureDetail
  look: FigureLookName
  /** How much taller or shorter than the sculpt, which is a metre seventy-six. */
  scale?: number
  bump: number
  shadows: boolean
  /** How much of the coat to draw, 0 to 1: the rest is covered for by drawing what is left wider. */
  coat?: number
}

/** How long the worker is given to mesh a figure. They are built ahead of being seen, so: as long as it takes. */
const PATIENCE = 30000

export class Figure {
  /** Stands on the ground at its origin and faces +x until it is turned. */
  readonly group = new Group()
  byName: Map<string, Bone> | null = null
  frame: FigureFrame | null = null
  readonly uniforms: FigureUniforms
  private readonly inner = new Group()
  private readonly disposers: (() => void)[] = []
  private coat: { geometry: InstancedBufferGeometry; count: number; share: number } | null = null
  /** How tall it stands, in metres. */
  private tall = 1.76
  private gone = false

  constructor(kind: FigureKind, air: Air & Arrivals, options: FigureOptions) {
    this.uniforms = createFigureUniforms(FIGURE_LOOKS[options.look], options.bump)
    this.group.add(this.inner)
    this.group.visible = false
    void inTurn(() => requestCreature(kind, options.detail, PATIENCE)).then((creature) => {
      if (this.gone) return
      const size = (creature.size ?? 1) * (options.scale ?? 1)
      this.uniforms.uSize.value = creature.size ?? 1
      const material = makeFigureMaterial(air, this.uniforms)
      const mesh = new SkinnedMesh(creature.geometry, material)
      // Its bounds are the sculpt's, not the pose's; the cast hides what is out of sight itself.
      mesh.frustumCulled = false
      mesh.castShadow = options.shadows
      mesh.receiveShadow = options.shadows
      if (options.shadows) this.disposers.push(ownShadow(mesh))
      const { root, skeleton, byName } = buildSkeleton(creature.bones)
      this.inner.add(mesh, root)
      mesh.bind(skeleton, new Matrix4())
      this.disposers.push(
        () => material.dispose(),
        () => skeleton.dispose(),
      )

      // What grows on it: the same skeleton, so it goes where the skin goes.
      const share = Math.min(1, Math.max(0, options.coat ?? 1))
      if (creature.coat && creature.coat.count > 0 && share > 0) {
        const geometry = coatGeometry(creature.coat)
        const fur = makeCoatMaterial(air, this.uniforms)
        const coat = new SkinnedMesh(geometry, fur)
        coat.frustumCulled = false
        coat.receiveShadow = options.shadows
        // After the skin, so that the half of the coat on the far side of the
        // body is behind something by the time it comes to be drawn.
        coat.renderOrder = 1
        this.inner.add(coat)
        coat.bind(skeleton, new Matrix4())
        this.disposers.push(() => fur.dispose())
        this.coat = { geometry, count: creature.coat.count, share }
        this.seen(0)
      }

      // Eyes: balls behind the lids, which is the one way an eye is ever round.
      const head = byName.get(creature.eyeBone)
      if (head && creature.eyes.length > 0) {
        const ball = new SphereGeometry(1, 14, 10)
        const wet = makeEyeMaterial(air, this.uniforms, kind === 'mammoth' ? 1.2 : 0.5)
        for (const eye of creature.eyes) {
          const orb = new Mesh(ball, wet)
          orb.position.set(eye.offset[0], eye.offset[1], eye.offset[2])
          orb.scale.setScalar(eye.radius)
          // A person looks ahead; an animal that is hunted, out to each side.
          orb.rotation.y = -Math.sign(eye.offset[2]) * (kind === 'mammoth' ? 1.1 : 0.05)
          head.add(orb)
        }
        this.disposers.push(
          () => ball.dispose(),
          () => wet.dispose(),
        )
      }

      // Tusks: swept, not sculpted, and rigid on the bone they grow from.
      if (creature.sweeps && creature.sweeps.length > 0) {
        const ivory = makeFigureMaterial(air, this.uniforms)
        this.disposers.push(() => ivory.dispose())
        for (const sweep of creature.sweeps) {
          const tusk = new Mesh(sweepGeometry(sweep.path, sweep.radii), ivory)
          tusk.castShadow = options.shadows
          tusk.receiveShadow = options.shadows
          tusk.frustumCulled = false
          byName.get(sweep.bone)?.add(tusk)
          this.disposers.push(() => tusk.geometry.dispose())
        }
      }

      creature.geometry.computeBoundingBox()
      this.inner.scale.setScalar(size)
      // The mesh is centred on its middle; its feet are half its height below.
      this.inner.position.y = -(creature.geometry.boundingBox?.min.y ?? -0.5) * size
      this.tall = ((creature.geometry.boundingBox?.max.y ?? 0.5) - (creature.geometry.boundingBox?.min.y ?? -0.5)) * size
      this.byName = byName
      this.frame = measure(creature.bones, size)
      air.arrived?.(this.group)
    })
  }

  /** Puts it on the ground at a spot, facing along `heading` (an angle on the map from +x towards +z). */
  place(x: number, z: number, heading: number, lift = 0): void {
    this.group.position.set(finite(x), finite(groundAt(x, z) + lift), finite(z))
    this.group.rotation.y = -finite(heading)
  }

  /**
   * How its coat is thrown by the way it is moving: backwards as it goes
   * forwards, up and down with its step. In its own frame, as a share of each
   * lock's length.
   */
  swing(back: number, up: number, across: number): void {
    this.uniforms.uSwing.value.set(finite(-back), finite(up), finite(across))
  }

  /**
   * How much of its coat to draw, for how far off it is: all of it from
   * within two and a half times its own height, and from there fewer locks,
   * each drawn wider, down to a little over a quarter of them. A coat is thousands of small
   * strips lying over one another, and from a distance most of what is paid
   * for is strips that are hidden by other strips. `distance` is in metres
   * through a forty-degree lens: a longer lens brings it nearer.
   */
  seen(distance: number): void {
    const coat = this.coat
    if (!coat) return
    const far = Math.max(1, finite(distance, 1) / (this.tall * 2.5))
    const drawn = coat.share * Math.max(0.28, 1 / far)
    coat.geometry.instanceCount = Math.max(1, Math.round(coat.count * drawn))
    // Not quite as much wider as there are fewer: a coat has locks to spare,
    // and what is being saved is the drawing of one over another.
    this.uniforms.uCoatWidth.value = Math.pow(drawn, -0.42)
  }

  /** Whether it has been built yet: nothing can be posed before its mesh arrives. */
  get ready(): boolean {
    return this.frame !== null
  }

  dispose(): void {
    this.gone = true
    for (const dispose of this.disposers) dispose()
    // The geometry, and the coat's cards, belong to a cache and are shared: never disposed here.
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

/** The shorter way round from one heading to another. */
const shortest = (angle: number): number => {
  const a = (angle + Math.PI) % (Math.PI * 2)
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI
}

/**
 * How far a head has to turn to look at a spot, for someone standing at
 * another and facing along `heading`: as a pose's `turn`, which is
 * positive to the figure's own left, and no further than a neck goes.
 */
function glance(x: number, z: number, heading: number, tx: number, tz: number, most: number): number {
  const aim = shortest(Math.atan2(tz - z, tx - x) - heading)
  return Math.max(-most, Math.min(most, -aim))
}
/**
 * Where a shaft lies in a hand, from the wrist, in metres: down the arm to the
 * middle of the palm and in from it by the thickness of the shaft, which is
 * where the sculpt's fingers curl round to. The +z hand's; the other's is its mirror.
 */
const GRIP: readonly [number, number, number] = [
  0,
  HUMAN.armDir[1] * HUMAN.grip - HUMAN.armDir[2] * 0.024,
  HUMAN.armDir[2] * HUMAN.grip + HUMAN.armDir[1] * 0.024,
]

/** Tells the meadow where something is walking through it: a slot, a place, how wide and how hard. */
export type Tread = (index: number, x: number, z: number, radius: number, strength: number) => void

export function createCast(air: Air & Arrivals, detail: { people: CreatureDetail; beasts: CreatureDetail; coat: number }, bump: number, shadows: boolean, tread?: Tread): Part {
  const root = new Group()
  const disposers: (() => void)[] = []

  // ---- the hunting party, and the one who stays ---------------------------
  const looks: FigureLookName[] = ['hunter', 'early', 'elder']
  const hunters = HUNTERS.map((_, i) => {
    const figure = new Figure('early', air, { detail: detail.people, look: looks[i] ?? 'early', scale: [1, 0.95, 0.985][i] ?? 1, bump, shadows, coat: detail.coat })
    root.add(figure.group)
    const { spear, dispose } = makeSpear()
    disposers.push(dispose, () => figure.dispose())
    return { figure, spear, stepper: stepper(), state: {} as Walker, held: null as boolean | null }
  })
  const elder = new Figure('early', air, { detail: detail.people, look: 'elder', scale: 0.93, bump, shadows, coat: detail.coat })
  root.add(elder.group)
  disposers.push(() => elder.dispose())

  // The spear that is thrown: the first hunter's, once it has left the hand.
  const thrown = makeSpear()
  thrown.spear.visible = false
  root.add(thrown.spear)
  disposers.push(thrown.dispose)

  // ---- the herd ------------------------------------------------------------
  const herd = HERD.map((home) => {
    const figure = new Figure('mammoth', air, { detail: detail.beasts, look: 'mammoth', scale: home.size, bump, shadows, coat: detail.coat })
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
    // How much nearer or further a lens makes things, against one of forty degrees.
    const lens = Math.tan((beat.camera.fov * Math.PI) / 360) / Math.tan((40 * Math.PI) / 360)
    const off = (figure: Figure) => figure.seen(beat.camera.position.distanceTo(figure.group.position) * lens)

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
      off(figure)
      const posed = posePerson(s, w, t, i * 2.7 + 0.4)
      // Once they are out in the open what they are looking at is the herd.
      const watching = ramp(0.255, 0.3, p) * (1 - w.seated)
      if (watching > 0) {
        const quarry = herd[0]!.state
        posed.turn += (glance(w.x, w.z, w.heading, quarry.x ?? HERD[0].x, quarry.z ?? HERD[0].z, 0.75) - posed.turn) * watching * 0.85
        posed.nod += (-0.06 - posed.nod) * watching * w.low
      }
      // The arm with the spear in it is carried, not swung: the shaft level and a little ahead.
      const carried = (1 - w.seated) * (1 - clamp01(w.cast))
      posed.armR[0] += (0.1 + 0.25 * w.low - posed.armR[0]) * carried * 0.7
      posed.armR[2] += (0.42 + 0.5 * w.low - posed.armR[2]) * carried * 0.8
      // Hair and fur are thrown back by going forward, and up and down by each step.
      const swung = s.phase * Math.PI * 2
      figure.swing(s.moving * (0.05 + 0.2 * w.running), s.moving * (0.03 + 0.05 * w.running) * Math.cos(2 * swung), s.moving * 0.03 * Math.sin(swung))

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
          // Gripped in the palm, inside the curl of the fingers, lying forward and a little up.
          hunter.spear.position.set(0, GRIP[1], -GRIP[2]).multiplyScalar(1 / figure.frame.size)
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
      off(elder)
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
      off(figure)
      beastGaitPose(beastWalk, s.phase, BEAST_GAITS.walk, s.moving)
      beastGaitPose(beastAmble, s.phase, BEAST_GAITS.amble, s.moving)
      blendBeast(beastPose, beastWalk, beastAmble, fast)
      beastStandPose(beastRest, t, home.seed, b.alarm)
      // What has alarmed it is the hunters: that is where it looks.
      const threat = hunters[0]!.state
      if (b.alarm > 0 && threat.x !== undefined) beastRest.turn += (glance(b.x, b.z, b.heading, threat.x, threat.z, 0.6) - beastRest.turn) * b.alarm
      blendBeast(beastPose, beastRest, beastPose, s.moving)
      // Running, the head stays up and the ears out.
      beastPose.raise += (0.22 - beastPose.raise) * fast * 0.7
      beastPose.ears += (0.8 - beastPose.ears) * fast * 0.6
      beastPose.curl += (0.5 - beastPose.curl) * fast * 0.5
      applyBeast(figure.byName, beastPose, figure.frame)
      const gait = s.phase * Math.PI * 2
      figure.swing(s.moving * (0.04 + 0.14 * fast), s.moving * (0.04 + 0.05 * fast) * Math.cos(2 * gait + 0.6), s.moving * 0.05 * Math.sin(gait))
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
