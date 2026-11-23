import { blob, cut, mirrored, toPrimitives, tube, type BoneSpec, type CreatureDetail, type CreaturePayload, type Part } from './creatures'
import { growCoat, type Coat, type Grower } from './evoCoat'
import { meshSdf, nearestField, nearestFields, type Vec3 } from './sdf'

/**
 * The people and the animals of the long walk, sculpted the way the site's
 * creatures are: masses and tapering tubes blended into one signed distance
 * field, one continuous surface taken from it, skinned to a small skeleton.
 * No model files, like everything else here.
 *
 * Three things are different from `creatures.ts`, which is why this is a file
 * of its own and not three more entries in it.
 *
 * - **A figure is authored in metres.** A hide can be any size; a person
 *   standing next to a doorway cannot, so the anatomy below is measured, and
 *   the payload carries how tall it came out (`size`) for the scene to stand it
 *   at that height.
 * - **A figure is more than one material.** Every shape belongs to a region —
 *   skin, scalp, pelt, leather, cloth, horn — and after meshing each vertex is
 *   given its share of each, from which region's shapes it lies nearest. The
 *   surface is still one mesh with no seams; the shader colours it by those
 *   weights, and the fur and hair (`evoCoat.ts`) grow where they say.
 * - **A figure is finer where it is looked at.** A face and a hand are meshed
 *   several times as finely as a thigh, and every vertex is put on the field's
 *   own surface (`meshSdf`'s `exact` and `refine`), so an eyelid a few
 *   millimetres deep is still there when the mesh comes out.
 * - **Limbs are skinned by reach, not by distance.** Distance alone gives the
 *   ribs to the upper arm, which hangs closer to them than the spine does, and
 *   the inside of each thigh partly to the other leg. Here every bone has a
 *   girth — how thick the body is round it — and a side, and a vertex goes to
 *   the bone whose *surface* it is nearest, on its own side of the body.
 *
 * No three.js, like `creatures.ts` and `sdf.ts`: this rides into the meshing
 * worker with them.
 */

export type FigureKind = 'early' | 'modern' | 'mammoth' | 'crag'
export const FIGURE_KINDS: readonly FigureKind[] = ['early', 'modern', 'mammoth', 'crag']
export const isFigureKind = (kind: string): kind is FigureKind => (FIGURE_KINDS as readonly string[]).includes(kind)

/**
 * What a shape is made of. The shader (`evoMaterials.ts`) has a colour and a
 * finish for each, and the numbers are the order it has them in.
 */
export const REGIONS = 8
const SKIN = 0
/** Where the hair of a head or a beard grows: the scalp under it, as dark as its roots. */
const HAIR = 1
/** Fur, worn or grown: what a coat's cards stand on. */
const PELT = 2
/** Leather: a belt, a strap, leggings, the upper of a shoe. */
const HIDE = 3
/** Something knitted. */
const CLOTH = 4
/** Something woven and heavier. */
const DENIM = 5
/** Ivory and nail. */
const HORN = 6
/** The sole of a shoe. */
const SOLE = 7
type Region = typeof SKIN | typeof HAIR | typeof PELT | typeof HIDE | typeof CLOTH | typeof DENIM | typeof HORN | typeof SOLE

interface Piece {
  part: Part
  region: Region
}

/** A bone, with how thick the body is round it and which side of the body it serves. */
export interface FigureBone extends BoneSpec {
  girth: number
  /** +1 for the +z side only, -1 for the -z side only. Left out for the middle. */
  side?: 1 | -1
}

/**
 * A mark on the surface, in metres: an ellipsoid of it, and how strong it is
 * at the middle. Four kinds, which the shader reads as a flush of blood under
 * skin, as shade, as the hair of a brow, and as a lip.
 */
interface Paint {
  kind: 0 | 1 | 2 | 3
  at: Vec3
  size: Vec3
  amount: number
}

interface Figure {
  pieces: Piece[]
  bones: FigureBone[]
  /** Raw units to a metre: the anatomy is written in metres and scaled up by this to mesh. */
  scale: number
  /** Field spacing per detail, in metres. */
  spacing: Record<CreatureDetail, number>
  /** Fillet radius as a multiple of the spacing. */
  blend: number
  /**
   * How gradually skin passes from one bone to the next, and how sharply a
   * side ends, in metres. A centimetre and a half is a soft joint on a person
   * and a hinge on something five metres long.
   */
  soft: number
  margin: number
  /** How many times finer than `spacing` to mesh round a point, in metres: see `meshSdf`. Given, the mesh is exact. */
  refine?: (x: number, y: number, z: number) => number
  /** What grows on it. */
  coat?: Grower
  paints?: Paint[]
  /** Eyeballs, in metres: where each is and how big. */
  eyes?: { at: Vec3; radius: number }[]
  /** Tusks, in metres: see `CreatureSweep`. */
  sweeps?: { bone: string; path: Vec3[]; radii: number[] }[]
}

// ------------------------------------------------------------------ builder

const MAX_INFLUENCES = 4

function distToSegment(px: number, py: number, pz: number, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const len = abx * abx + aby * aby + abz * abz
  let t = len > 1e-9 ? ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / len : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - a[0] - abx * t, py - a[1] - aby * t, pz - a[2] - abz * t)
}

/**
 * Skin weights from how far a vertex is from the *surface* of each bone's
 * limb, not from its axis, and only from bones on its own side of the body.
 */
function skin(positions: Float32Array, bones: FigureBone[], softness: number, edge: number) {
  const segments = bones.map((bone) => {
    if (bone.tip) return { head: bone.head, tip: bone.tip }
    const child = bones.find((b) => b.parent === bone.name)
    return { head: bone.head, tip: child ? child.head : bone.head }
  })
  const count = positions.length / 3
  const skinIndices = new Uint16Array(count * 4)
  const skinWeights = new Float32Array(count * 4)
  const scored = bones.map((_, index) => ({ index, weight: 0 }))
  const soft = softness
  const margin = edge

  for (let v = 0; v < count; v++) {
    const px = positions[v * 3]!
    const py = positions[v * 3 + 1]!
    const pz = positions[v * 3 + 2]!
    for (let b = 0; b < bones.length; b++) {
      const bone = bones[b]!
      const seg = segments[b]!
      const d = Math.max(0, distToSegment(px, py, pz, seg.head, seg.tip) - bone.girth)
      let weight = 1 / (d + soft) ** 3
      if (bone.side) {
        const own = (pz * bone.side + margin) / (2 * margin)
        weight *= own < 0 ? 0 : own > 1 ? 1 : own
      }
      scored[b]!.index = b
      scored[b]!.weight = weight
    }
    scored.sort((a, b) => b.weight - a.weight)
    let total = 0
    for (let i = 0; i < MAX_INFLUENCES; i++) total += scored[i]?.weight ?? 0
    for (let i = 0; i < MAX_INFLUENCES; i++) {
      const entry = scored[i]
      skinIndices[v * 4 + i] = entry ? entry.index : 0
      skinWeights[v * 4 + i] = entry && total > 0 ? entry.weight / total : 0
    }
  }
  return { skinIndices, skinWeights }
}

/**
 * What is worn lies over what wears it. Where a sleeve and the arm inside it
 * are both at the surface the sleeve has it, by this much, in metres.
 */
const OVER = [0, 0.012, 0.016, 0.014, 0.016, 0.014, 0.004, 0.008]

/** Each vertex's share of the eight regions, from which region's shapes it lies nearest. */
function regionsOf(positions: Float32Array, pieces: Piece[], unit: number, blend: number): Float32Array {
  const sets = OVER.map((_, region) => toPrimitives(pieces.filter((piece) => piece.region === region && !piece.part.negative).map((piece) => piece.part)))
  // A vertex is on the surface, so whatever it belongs to is within a fillet
  // of it, and nothing further off than that and a border's width has a say.
  const nearest = nearestFields(sets, 0.06 * unit + blend)
  const count = positions.length / 3
  const out = new Float32Array(count * REGIONS)
  // The width of the border between two regions on the surface.
  const soft = 0.0045 * unit
  const d = new Float64Array(REGIONS)
  for (let v = 0; v < count; v++) {
    nearest(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!, d)
    let least = Infinity
    for (let r = 0; r < REGIONS; r++) {
      d[r] = d[r]! - OVER[r]! * unit
      if (d[r]! < least) least = d[r]!
    }
    if (least === Infinity) {
      out[v * REGIONS] = 1
      continue
    }
    let total = 0
    for (let r = 0; r < REGIONS; r++) {
      const w = d[r] === Infinity ? 0 : Math.exp(-(d[r]! - least) / soft)
      out[v * REGIONS + r] = w
      total += w
    }
    for (let r = 0; r < REGIONS; r++) out[v * REGIONS + r] = out[v * REGIONS + r]! / (total || 1)
  }
  return out
}

/** The four kinds of mark at each vertex: the strongest of each that reaches it. */
function paintOf(positions: Float32Array, paints: Paint[], unit: number): Float32Array {
  const count = positions.length / 3
  const out = new Float32Array(count * 4)
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3]! / unit
    const y = positions[v * 3 + 1]! / unit
    const z = positions[v * 3 + 2]! / unit
    for (const paint of paints) {
      const q = Math.hypot((x - paint.at[0]) / paint.size[0], (y - paint.at[1]) / paint.size[1], (z - paint.at[2]) / paint.size[2])
      if (q >= 1) continue
      // Full strength over the middle third, and gone by the edge.
      const t = q < 0.35 ? 1 : 1 - (q - 0.35) / 0.65
      const w = paint.amount * t * t * (3 - 2 * t)
      if (w > out[v * 4 + paint.kind]!) out[v * 4 + paint.kind] = w
    }
  }
  return out
}

/** How much of the full coat each detail grows, and how much wider its cards are to cover for the rest. */
const COAT_SHARE: Record<CreatureDetail, { share: number; widen: number }> = {
  low: { share: 0.3, widen: 1.8 },
  medium: { share: 0.58, widen: 1.32 },
  high: { share: 1, widen: 1 },
}

function buildFigure(figure: Figure, detail: CreatureDetail): CreaturePayload {
  const unit = figure.scale
  const spacing = figure.spacing[detail] * unit
  const blend = spacing * figure.blend
  const refine = figure.refine
  const primitives = toPrimitives(figure.pieces.map((piece) => piece.part))
  const { positions, normals, indices, ao } = meshSdf(primitives, {
    spacing,
    blend,
    carve: blend * 0.45,
    exact: refine !== undefined,
    refine: refine ? (x, y, z) => refine(x / unit, y / unit, z / unit) : undefined,
  })
  // Regions and skin weights are worked out where the anatomy was written,
  // before the mesh is moved and scaled.
  const all = regionsOf(positions, figure.pieces, unit, blend)
  const weigh = (points: Float32Array) => skin(points, figure.bones, figure.soft * unit, figure.margin * unit)
  const { skinIndices, skinWeights } = weigh(positions)
  const paint = figure.paints ? paintOf(positions, figure.paints, unit) : undefined

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  const longest = Math.max(maxX - minX, maxY - minY, maxZ - minZ)
  const k = longest > 0 ? 1 / longest : 1

  // The coat grows on the mesh as it was sculpted, and is moved with it.
  let coat: Coat | undefined
  if (figure.coat) {
    coat = growCoat({ positions, normals, indices, ao, regions: all, unit }, figure.coat, {
      ...COAT_SHARE[detail],
      weigh,
      centre: [cx, cy, cz],
      scale: k,
      field: nearestField(primitives),
    })
  }
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i]! - cx) * k
    positions[i + 1] = (positions[i + 1]! - cy) * k
    positions[i + 2] = (positions[i + 2]! - cz) * k
  }
  const map = ([x, y, z]: Vec3): Vec3 => [(x - cx) * k, (y - cy) * k, (z - cz) * k]
  const bones: BoneSpec[] = figure.bones.map((bone) => ({
    name: bone.name,
    parent: bone.parent,
    head: map(bone.head),
    tip: bone.tip ? map(bone.tip) : undefined,
  }))
  const eyeBone = bones.find((bone) => bone.name === 'head') ?? bones[0]!

  // Two attributes of four, which is what a vertex shader is handed.
  const count = positions.length / 3
  const regions = new Float32Array(count * 4)
  const regions2 = new Float32Array(count * 4)
  for (let v = 0; v < count; v++) {
    for (let r = 0; r < 4; r++) {
      regions[v * 4 + r] = all[v * REGIONS + r]!
      regions2[v * 4 + r] = all[v * REGIONS + 4 + r]!
    }
  }

  return {
    positions,
    normals,
    indices,
    ao,
    skinIndices,
    skinWeights,
    bones,
    eyeBone: eyeBone.name,
    eyes: (figure.eyes ?? []).map((eye) => {
      const at = map([eye.at[0] * unit, eye.at[1] * unit, eye.at[2] * unit])
      return { offset: [at[0] - eyeBone.head[0], at[1] - eyeBone.head[1], at[2] - eyeBone.head[2]], radius: eye.radius * unit * k }
    }),
    teeth: [],
    regions,
    regions2,
    paint,
    coat,
    sweeps: (figure.sweeps ?? []).map((sweep) => {
      const from = bones.find((bone) => bone.name === sweep.bone) ?? bones[0]!
      return {
        bone: from.name,
        path: sweep.path.map((point) => {
          const at = map([point[0] * unit, point[1] * unit, point[2] * unit])
          return [at[0] - from.head[0], at[1] - from.head[1], at[2] - from.head[2]] as Vec3
        }),
        radii: sweep.radii.map((radius) => radius * unit * k),
      }
    }),
    size: longest / unit,
  }
}

// ---------------------------------------------------------------- authoring

/** Raw units to a metre for the people: enough that a tube's bends and the baked occlusion are resolved. */
const HUMAN_SCALE = 2

const at = (unit: number, [x, y, z]: Vec3): Vec3 => [x * unit, y * unit, z * unit]

/**
 * Helpers that take metres and tag the shape with what it is made of. `fillet`,
 * where one is given, is the shape's own in metres: small ones belong only
 * where the mesh is refined enough to show them.
 */
function kit(unit: number) {
  // Every tube is one shape: its capsules are joined plainly, and only the
  // whole limb is filleted into the body.
  let groups = 0
  const own = (fillet?: number) => (fillet === undefined ? undefined : fillet * unit)
  const mass = (region: Region, p: Vec3, size: Vec3, yaw?: number, pitch?: number, fillet?: number): Piece => ({
    part: { ...blob(at(unit, p), at(unit, size), yaw, pitch), blend: own(fillet) },
    region,
  })
  const limb = (region: Region, path: Vec3[], radii: number[], fillet?: number): Piece => ({
    part: {
      ...tube(
        path.map((p) => at(unit, p)),
        radii.map((r) => r * unit),
      ),
      group: groups++,
      blend: own(fillet),
    },
    region,
  })
  const carve = (p: Vec3, size: Vec3, yaw?: number, pitch?: number, fillet?: number): Piece => ({
    part: { ...cut(at(unit, p), at(unit, size), yaw, pitch), blend: own(fillet) },
    region: SKIN,
  })
  const both = (piece: Piece): Piece[] => mirrored(piece.part).map((part) => ({ part, region: piece.region }))
  /** A closed band round a point: a belt, a collar, the tie of a boot. `slant` tips it forward. */
  const hoop = (region: Region, centre: Vec3, rx: number, rz: number, radius: number, slant = 0): Piece[] => {
    const steps = 10
    const points: Vec3[] = []
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2
      points.push([centre[0] + Math.cos(a) * rx, centre[1] + Math.cos(a) * slant, centre[2] + Math.sin(a) * rz])
    }
    const group = groups++
    const out: Piece[] = []
    for (let i = 0; i < steps; i++) {
      out.push({ part: { ...tube([at(unit, points[i]!), at(unit, points[i + 1]!)], [radius * unit, radius * unit]), group }, region })
    }
    return out
  }
  const bone = (name: string, parent: string | null, head: Vec3, girth: number, tip?: Vec3, side?: 1 | -1): FigureBone => ({
    name,
    parent,
    head: at(unit, head),
    tip: tip ? at(unit, tip) : undefined,
    girth: girth * unit,
    side,
  })
  return { mass, limb, carve, both, hoop, bone }
}

const add = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const flipZ = ([x, y, z]: Vec3): Vec3 => [x, y, -z]
/** 0 at `a`, 1 at `b`, eased; `a` may be the greater. */
const ramp = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const pair = (paint: Paint): Paint[] => [paint, { ...paint, at: flipZ(paint.at) }]

/**
 * The joints of a person a metre seventy-six tall, facing +x, standing with
 * the arms held forty degrees out from the body so that neither they nor the
 * legs are close enough to anything else to be fused to it. Bones sit
 * unrotated in this pose; `evoRig.ts` poses from the same numbers.
 */
export const HUMAN = (() => {
  const armDir: Vec3 = [0, -Math.cos(0.7), Math.sin(0.7)]
  const shoulder: Vec3 = [-0.008, 1.452, 0.2]
  const elbow = add(shoulder, armDir, 0.3)
  const wrist = add(elbow, armDir, 0.262)
  const tip = add(wrist, armDir, 0.185)
  return {
    height: 1.76,
    hips: [-0.01, 0.97, 0] as Vec3,
    spine: [-0.012, 1.1, 0] as Vec3,
    chest: [-0.015, 1.27, 0] as Vec3,
    neck: [-0.012, 1.5, 0] as Vec3,
    head: [0, 1.585, 0] as Vec3,
    crown: [0.004, 1.76, 0] as Vec3,
    shoulder,
    elbow,
    wrist,
    tip,
    armDir,
    hip: [0, 0.93, 0.092] as Vec3,
    knee: [0.012, 0.5, 0.1] as Vec3,
    ankle: [-0.012, 0.085, 0.105] as Vec3,
    toe: [0.17, 0.025, 0.116] as Vec3,
    /** Where an eye is, and the middle of the palm a spear lies across. */
    eye: [0.0745, 1.656, 0.031] as Vec3,
    grip: 0.07,
  }
})()

/** Lengths the rig needs, in metres. */
export const HUMAN_LIMBS = {
  thigh: Math.hypot(HUMAN.knee[0] - HUMAN.hip[0], HUMAN.knee[1] - HUMAN.hip[1], HUMAN.knee[2] - HUMAN.hip[2]),
  shin: Math.hypot(HUMAN.ankle[0] - HUMAN.knee[0], HUMAN.ankle[1] - HUMAN.knee[1], HUMAN.ankle[2] - HUMAN.knee[2]),
  upperArm: 0.3,
  foreArm: 0.262,
  hipHeight: HUMAN.hip[1],
  ankleHeight: HUMAN.ankle[1],
} as const

interface HumanLook {
  /** How heavy the brow is, 0 to 1. */
  brow: number
  /** Thicker neck, shoulders and limbs: 1 is a modern build. */
  build: number
  /** A broader nose and a heavier jaw, 0 to 1. */
  broad: number
}

/**
 * The body under whatever it wears: the same for everyone, give or take a
 * brow. What will be seen of it is sculpted — a head, a neck, the arms, the
 * hands — and what will be under clothing is only there to hold the clothing
 * out to the right shape.
 */
function body(look: HumanLook): Piece[] {
  const { mass, limb, carve, both } = kit(HUMAN_SCALE)
  const g = look.build
  const w = look.broad
  const H = HUMAN
  const d = H.armDir
  // Down the arm, and from it: `fwd` is the thumb's side (forward, as it
  // hangs), `out` is the back of the hand's side, away from the body.
  const arm = (base: Vec3, a: number, fwd = 0, out = 0): Vec3 => [base[0] + fwd, base[1] + d[1] * a + d[2] * out, base[2] + d[2] * a - d[1] * out]
  const S = H.shoulder
  const E = H.elbow
  const W = H.wrist

  // The hand: four bones of a palm side by side, a finger curled off the end
  // of each as a hand at rest holds them, and a thumb across the front.
  const KNUCKLE = 0.088
  const curl = [0.45, 1.15, 1.7]
  const hand: Piece[] = []
  for (const [fwd, length, radius] of [
    [0.0285, 0.072, 0.0098],
    [0.0095, 0.08, 0.0102],
    [-0.0095, 0.074, 0.0096],
    [-0.0275, 0.058, 0.0086],
  ] as const) {
    hand.push(...both(limb(SKIN, [arm(W, 0.006, fwd * 0.72), arm(W, KNUCKLE, fwd)], [0.0125, 0.0118])))
    const points: Vec3[] = [arm(W, KNUCKLE, fwd)]
    let along = KNUCKLE
    let inward = 0
    ;[0.45, 0.3, 0.25].forEach((share, i) => {
      along += Math.cos(curl[i]!) * length * share
      inward += Math.sin(curl[i]!) * length * share
      points.push(arm(W, along, fwd, -inward))
    })
    hand.push(...both(limb(SKIN, points, [radius, radius * 0.94, radius * 0.86, radius * 0.76], 0.003)))
  }
  hand.push(
    ...both(limb(SKIN, [arm(W, 0.02, 0.026, -0.006), arm(W, 0.052, 0.046, -0.016), arm(W, 0.08, 0.05, -0.03), arm(W, 0.096, 0.042, -0.042)], [0.0135, 0.012, 0.0105, 0.009], 0.006)),
    ...both(mass(SKIN, arm(W, 0.04, 0.02, -0.012), [0.016, 0.02, 0.016], undefined, undefined, 0.008)),
  )

  return [
    // --- Trunk: only what holds clothing out -------------------------------
    mass(SKIN, [-0.005, 0.955, 0], [0.1, 0.105, 0.156]),
    mass(SKIN, [0.012, 1.09, 0], [0.097 * g, 0.12, 0.134 * g]),
    mass(SKIN, [-0.005, 1.29, 0], [0.117 * g, 0.165, 0.16 * g]),
    mass(SKIN, [-0.04, 1.4, 0], [0.084 * g, 0.094, 0.2]),
    ...both(mass(SKIN, [-0.066, 0.925, 0.082], [0.074, 0.084, 0.08])),

    // --- Neck: its column, the two cords down the front of it, and the slope to the shoulders
    limb(SKIN, [[-0.02, 1.47, 0], [-0.01, 1.53, 0], [-0.002, 1.59, 0]], [0.058 * g, 0.051 * g, 0.05 * g]),
    ...both(limb(SKIN, [[-0.032, 1.6, 0.05], [0.004, 1.535, 0.04], [0.04, 1.475, 0.02]], [0.013, 0.013, 0.011], 0.012)),
    mass(SKIN, [0.046, 1.537, 0], [0.012, 0.015, 0.013], undefined, undefined, 0.01),
    ...both(limb(SKIN, [[-0.035, 1.53, 0.03], [-0.026, 1.494, 0.11], [-0.012, 1.468, 0.172]], [0.04 * g, 0.04 * g, 0.034 * g])),
    ...both(limb(SKIN, [[0.058, 1.476, 0.02], [0.03, 1.474, 0.1], [0.008, 1.47, 0.172]], [0.011, 0.011, 0.011], 0.01)),

    // --- Head: a cranium, a face in front of it and a jaw under that --------
    mass(SKIN, [-0.012, 1.672, 0], [0.098, 0.092, 0.0765]),
    mass(SKIN, [0.03, 1.615, 0], [0.068, 0.085, 0.062]),
    mass(SKIN, [0.03, 1.568, 0], [0.062, 0.04, 0.054 + 0.004 * w]),
    mass(SKIN, [0.072, 1.552, 0], [0.022, 0.022, 0.026 + 0.004 * w], undefined, undefined, 0.012),
    // The brow, and the bones of the cheek.
    mass(SKIN, [0.08, 1.681, 0], [0.018 + 0.006 * look.brow, 0.011 + 0.004 * look.brow, 0.046], undefined, undefined, 0.016),
    ...both(mass(SKIN, [0.068, 1.632, 0.046], [0.024, 0.02, 0.02], undefined, undefined, 0.012)),
    // The nose: its bridge, its tip, a wing each side and a nostril under each.
    limb(SKIN, [[0.09, 1.666, 0], [0.104, 1.638, 0], [0.112, 1.616, 0]], [0.008, 0.009 + 0.002 * w, 0.0105 + 0.002 * w], 0.006),
    mass(SKIN, [0.1125, 1.6125, 0], [0.0108, 0.0098, 0.011 + 0.003 * w], undefined, undefined, 0.005),
    ...both(mass(SKIN, [0.102, 1.6075, 0.013 + 0.003 * w], [0.0076, 0.007, 0.0072 + 0.002 * w], undefined, undefined, 0.004)),
    // The mound the mouth is on, and the lips.
    mass(SKIN, [0.084, 1.582, 0], [0.021, 0.022, 0.031], undefined, undefined, 0.01),
    mass(SKIN, [0.1025, 1.5838, 0], [0.0075, 0.0052, 0.021], undefined, undefined, 0.004),
    mass(SKIN, [0.1, 1.5742, 0], [0.008, 0.006, 0.019], undefined, undefined, 0.004),
    // Ears.
    ...both(mass(SKIN, [-0.008, 1.638, 0.0795], [0.014, 0.03, 0.008], 0.32, undefined, 0.005)),
    // The lid of each eye, over where the ball is.
    ...both(mass(SKIN, H.eye, [0.0132, 0.0132, 0.0132], undefined, undefined, 0.006)),

    // What is cut out of all that: the slot between the lids of each eye, the
    // nostrils, the line of the mouth, the bowl of an ear.
    ...both(carve([H.eye[0] + 0.0132, H.eye[1], H.eye[2]], [0.0066, 0.0042, 0.0118], undefined, undefined, 0.0014)),
    ...both(carve([0.1065, 1.6005, 0.0066 + 0.002 * w], [0.0042, 0.0032, 0.0034], undefined, undefined, 0.002)),
    carve([0.1085, 1.5792, 0], [0.009, 0.0016, 0.024], undefined, undefined, 0.0012),
    ...both(carve([-0.002, 1.638, 0.0885], [0.007, 0.016, 0.005], 0.32, undefined, 0.003)),

    // --- Arms: held out, so they meet the body at the shoulder and nowhere else.
    // The cap of the shoulder, the upper arm with a muscle before and behind
    // it, the point of the elbow, and a forearm that is thickest just below it.
    ...both(limb(SKIN, [arm(S, -0.025, 0, 0.018), arm(S, 0.05, 0.002, 0.02), arm(S, 0.12, 0.004, 0.008)], [0.05 * g, 0.052 * g, 0.04 * g])),
    ...both(limb(SKIN, [S, arm(S, 0.15, 0.006), E], [0.046 * g, 0.045 * g, 0.036 * g])),
    ...both(limb(SKIN, [arm(S, 0.08, 0.018), arm(S, 0.16, 0.022), arm(S, 0.25, 0.014)], [0.027 * g, 0.033 * g, 0.024 * g], 0.012)),
    ...both(limb(SKIN, [arm(S, 0.06, -0.02), arm(S, 0.15, -0.024), arm(S, 0.24, -0.016)], [0.027 * g, 0.031 * g, 0.024 * g], 0.012)),
    ...both(mass(SKIN, arm(E, 0, -0.026), [0.02, 0.022, 0.02], undefined, undefined, 0.01)),
    ...both(limb(SKIN, [E, arm(E, 0.08, 0.004), arm(E, 0.18, 0.002), W], [0.038 * g, 0.041 * g, 0.033 * g, 0.0255])),
    ...both(limb(SKIN, [arm(E, -0.02, 0.014, 0.004), arm(E, 0.07, 0.018, 0.006), arm(E, 0.15, 0.012, 0.002)], [0.024 * g, 0.028 * g, 0.018 * g], 0.012)),
    ...hand,

    // --- Legs: again, only what holds clothing out ----------------------------
    ...both(limb(SKIN, [H.hip, [0.02, 0.72, 0.098], H.knee], [0.086 * g, 0.079 * g, 0.054 * g])),
    ...both(mass(SKIN, [0.024, 0.5, 0.1], [0.05, 0.055, 0.05])),
    ...both(limb(SKIN, [[0.008, 0.47, 0.1], [-0.02, 0.34, 0.104], H.ankle], [0.05 * g, 0.057 * g, 0.033])),
    ...both(limb(SKIN, [[-0.056, 0.04, 0.105], [0.05, 0.045, 0.11], [0.162, 0.027, 0.117]], [0.037, 0.04, 0.026])),
  ]
}

/** The marks every face has: blood near the surface, shade round the eyes, brows, lips. */
function facePaint(brow: number): Paint[] {
  return [
    { kind: 0, at: [0.11, 1.614, 0], size: [0.022, 0.02, 0.022], amount: 0.4 },
    ...pair({ kind: 0, at: [0.078, 1.62, 0.046], size: [0.03, 0.026, 0.03], amount: 0.3 }),
    ...pair({ kind: 0, at: [-0.008, 1.638, 0.082], size: [0.03, 0.04, 0.02], amount: 0.45 }),
    ...pair({ kind: 1, at: [0.088, 1.658, 0.031], size: [0.022, 0.015, 0.024], amount: 0.6 }),
    ...pair({ kind: 1, at: [0.1065, 1.6, 0.0075], size: [0.007, 0.005, 0.006], amount: 0.7 }),
    ...pair({ kind: 2, at: [0.094, 1.6775, 0.03], size: [0.014, 0.0062 + 0.002 * brow, 0.022], amount: 0.95 }),
    { kind: 3, at: [0.103, 1.579, 0], size: [0.012, 0.0105, 0.023], amount: 0.85 },
  ]
}

/** Blood at the knuckles and the elbows, and the grime of a hand that is used. */
function armPaint(): Paint[] {
  const H = HUMAN
  const d = H.armDir
  const along = (base: Vec3, a: number): Vec3 => [base[0], base[1] + d[1] * a, base[2] + d[2] * a]
  return [
    ...pair({ kind: 0, at: along(H.wrist, 0.09), size: [0.05, 0.03, 0.03], amount: 0.5 }),
    ...pair({ kind: 0, at: add(H.elbow, [-0.02, 0, 0], 1), size: [0.035, 0.035, 0.035], amount: 0.45 }),
    ...pair({ kind: 1, at: along(H.wrist, 0.11), size: [0.07, 0.09, 0.09], amount: 0.3 }),
  ]
}

function skeleton(): FigureBone[] {
  const { bone } = kit(HUMAN_SCALE)
  const H = HUMAN
  const side = (suffix: 'L' | 'R', s: 1 | -1): FigureBone[] => {
    const m = (p: Vec3) => (s === 1 ? p : flipZ(p))
    return [
      bone(`upperArm${suffix}`, 'chest', m(H.shoulder), 0.046, undefined, s),
      bone(`foreArm${suffix}`, `upperArm${suffix}`, m(H.elbow), 0.038, undefined, s),
      bone(`hand${suffix}`, `foreArm${suffix}`, m(H.wrist), 0.03, m(H.tip), s),
      bone(`thigh${suffix}`, 'hips', m(H.hip), 0.076, undefined, s),
      bone(`shin${suffix}`, `thigh${suffix}`, m(H.knee), 0.05, undefined, s),
      bone(`foot${suffix}`, `shin${suffix}`, m(H.ankle), 0.036, m(H.toe), s),
    ]
  }
  return [
    bone('hips', null, H.hips, 0.13),
    bone('spine', 'hips', H.spine, 0.122),
    bone('chest', 'spine', H.chest, 0.142, [-0.015, 1.46, 0]),
    bone('neck', 'chest', H.neck, 0.052),
    bone('head', 'neck', H.head, 0.086, H.crown),
    ...side('L', 1),
    ...side('R', -1),
  ]
}

const HUMAN_SPACING: Record<CreatureDetail, number> = { low: 0.02, medium: 0.015, high: 0.011 }

/**
 * Where a person is meshed finer than a thigh needs: the front of the head
 * twice as fine, the face four times, the eyes, nose and mouth eight; a hand
 * twice, and its fingers four.
 */
function humanRefine(x: number, y: number, z: number): number {
  const az = Math.abs(z)
  if (y > 1.515) {
    if (x > 0.068 && ((az > 0.006 && az < 0.058 && y > 1.636 && y < 1.678) || (az < 0.032 && y > 1.562 && y < 1.622))) return 3
    if (Math.hypot((x - 0.07) / 0.066, (y - 1.62) / 0.08, z / 0.064) < 1) return 2
    if (az > 0.058 && Math.abs(y - 1.638) < 0.045 && Math.abs(x + 0.004) < 0.034) return 2
    // Behind the ears there is only hair, and that is drawn over.
    return x > -0.04 ? 1 : 0
  }
  const W = HUMAN.wrist
  const d = HUMAN.armDir
  const along = (y - W[1]) * d[1] + (az - W[2]) * d[2]
  const t = Math.min(0.13, Math.max(-0.02, along))
  const from = Math.hypot(x - W[0], y - W[1] - d[1] * t, az - W[2] - d[2] * t)
  if (from < 0.06 && along > 0.066) return 2
  return from < 0.085 ? 1 : 0
}

/**
 * Someone from the cave, dressed for the cold the mammoths lived in: long
 * hair and a beard, a sleeveless tunic of fur to the middle of the thigh with
 * a thong round the waist and a strap across the chest, a ruff of longer fur
 * at the neck, leggings of hide and boots of fur tied at the ankle.
 */
function early(): Figure {
  const { mass, limb, carve, both, hoop } = kit(HUMAN_SCALE)
  const H = HUMAN
  const d = H.armDir
  const along = (base: Vec3, a: number): Vec3 => [base[0], base[1] + d[1] * a, base[2] + d[2] * a]
  return {
    scale: HUMAN_SCALE,
    spacing: HUMAN_SPACING,
    blend: 1.55,
    soft: 0.014,
    margin: 0.022,
    bones: skeleton(),
    refine: humanRefine,
    coat: earlyCoat,
    paints: [...facePaint(0.6), ...armPaint()],
    eyes: [{ at: H.eye, radius: 0.0118 }, { at: flipZ(H.eye), radius: 0.0118 }],
    pieces: [
      ...body({ brow: 0.5, build: 1.07, broad: 0.5 }),
      // Hair: over the skull, down the neck to the shoulders, and a beard.
      mass(HAIR, [-0.03, 1.705, 0], [0.1, 0.078, 0.087]),
      limb(HAIR, [[-0.085, 1.66, 0], [-0.1, 1.56, 0], [-0.092, 1.48, 0]], [0.062, 0.066, 0.05]),
      ...both(limb(HAIR, [[-0.02, 1.67, 0.072], [-0.035, 1.58, 0.088], [-0.05, 1.5, 0.09]], [0.03, 0.032, 0.024])),
      mass(HAIR, [0.06, 1.546, 0], [0.04, 0.046, 0.05]),
      ...both(mass(HAIR, [0.04, 1.585, 0.05], [0.03, 0.035, 0.016])),
      mass(HAIR, [0.099, 1.5925, 0], [0.01, 0.0058, 0.026], undefined, undefined, 0.004),
      // The tunic: over the ribs and the belly, a yoke over the shoulders that
      // stops short of the arms, and a skirt of it to the middle of the thigh.
      mass(PELT, [-0.004, 1.3, 0], [0.13, 0.172, 0.174]),
      mass(PELT, [0.012, 1.1, 0], [0.118, 0.13, 0.152]),
      mass(PELT, [-0.032, 1.4, 0], [0.094, 0.084, 0.188]),
      ...both(limb(PELT, [[-0.022, 1.5, 0.07], [-0.02, 1.474, 0.15]], [0.05, 0.046])),
      mass(PELT, [-0.005, 0.96, 0], [0.128, 0.115, 0.18]),
      mass(PELT, [-0.004, 0.83, 0], [0.142, 0.11, 0.196]),
      // The ruff.
      ...hoop(PELT, [-0.012, 1.482, 0], 0.092, 0.104, 0.03, 0.02),
      // A thong round the waist with a pouch on it, and a strap from one
      // shoulder to the other hip.
      ...hoop(HIDE, [-0.002, 1.068, 0], 0.13, 0.166, 0.015),
      mass(HIDE, [0.05, 1.0, 0.165], [0.04, 0.052, 0.028]),
      limb(HIDE, [[-0.022, 1.505, 0.12], [0.106, 1.37, 0.044], [0.12, 1.22, -0.05], [0.07, 1.086, -0.152]], [0.0125, 0.0125, 0.0125, 0.0125]),
      limb(HIDE, [[-0.022, 1.505, 0.12], [-0.128, 1.37, 0.044], [-0.124, 1.22, -0.05], [-0.06, 1.086, -0.152]], [0.0125, 0.0125, 0.0125, 0.0125]),
      // A wrap of hide at each wrist.
      ...both(limb(HIDE, [along(H.elbow, 0.17), along(H.elbow, 0.244)], [0.0345, 0.031])),
      // Leggings.
      ...both(limb(HIDE, [H.hip, [0.02, 0.72, 0.098], [0.014, 0.5, 0.1]], [0.092, 0.084, 0.063])),
      ...both(limb(HIDE, [[0.014, 0.5, 0.1], [-0.016, 0.34, 0.104], [-0.012, 0.2, 0.105]], [0.061, 0.063, 0.05])),
      // Boots, tied below the knee and at the ankle.
      ...both(limb(PELT, [[-0.014, 0.34, 0.104], [-0.014, 0.2, 0.105], [-0.012, 0.09, 0.105]], [0.064, 0.06, 0.054])),
      ...both(limb(PELT, [[-0.06, 0.052, 0.105], [0.05, 0.054, 0.11], [0.166, 0.042, 0.117]], [0.047, 0.051, 0.041])),
      ...hoop(HIDE, [-0.014, 0.3, 0.104], 0.062, 0.062, 0.008),
      ...hoop(HIDE, [-0.014, 0.3, -0.104], 0.062, 0.062, 0.008),
      ...hoop(HIDE, [-0.012, 0.125, 0.105], 0.054, 0.054, 0.008),
      ...hoop(HIDE, [-0.012, 0.125, -0.105], 0.054, 0.054, 0.008),
      // The ground: what is under a foot is flat.
      ...both(carve([0.05, -0.292, 0.11], [0.32, 0.3, 0.13])),
    ],
  }
}

/** What grows on someone from the cave: hair, a beard, and the fur of what they wear. */
const earlyCoat: Grower = (x, y, z, n, r) => {
  const side = z >= 0 ? 1 : -1
  if (r[HAIR]! > 0.5) {
    // The beard, under the mouth and along the jaw: longest at the chin.
    if (y < 1.612 && x > 0.004) {
      const chin = ramp(1.6, 1.53, y)
      return { density: 15000, length: 0.045 + 0.075 * chin, width: 0.014, comb: [0.3, -1, side * 0.12], lift: 0.34, droop: 0.55, tint: 0, tone: 0.45, strands: 7 }
    }
    // Over the forehead it is short and pushed back; on top it lies back along
    // the skull; from the sides and the back it hangs.
    if (n[0] > 0.3 && y > 1.66) return { density: 13000, length: 0.06, width: 0.016, comb: [-0.5, 0.7, side * 0.5], lift: 0.25, droop: 0.12, tint: 0, tone: 0.5, strands: 8 }
    if (n[1] > 0.45) return { density: 13000, length: 0.11, width: 0.018, comb: [-0.8, -0.3, side * 0.5], lift: 0.05, droop: 0.4, tint: 0, tone: 0.55, strands: 8 }
    const back = ramp(0.02, -0.08, x)
    return { density: 12000, length: 0.16 + 0.13 * back, width: 0.019, comb: [-0.12, -1, side * 0.05], lift: 0.1, droop: 1, tint: 0, tone: 0.4, strands: 8 }
  }
  if (r[PELT]! > 0.5) {
    // The ruff at the neck is long; a boot's fur is short and lies down.
    if (y > 1.44) return { density: 5200, length: 0.085, width: 0.024, comb: [0, -0.5, side * 0.5], lift: 0.6, droop: 0.5, tint: 1, tone: 0.7, strands: 7 }
    if (y < 0.4) return { density: 5200, length: 0.034, width: 0.02, comb: [0, -1, 0], lift: 0.3, droop: 0.3, tint: 1, tone: 0.45, strands: 7 }
    // The hem is the ragged edge of the hide, and hangs.
    const hem = ramp(0.82, 0.74, y)
    return { density: 4300, length: 0.045 + 0.04 * hem, width: 0.023, comb: [0, -1, 0], lift: 0.32 - 0.12 * hem, droop: 0.45 + 0.4 * hem, tint: 1, tone: 0.5, strands: 7 }
  }
  return null
}

/**
 * Someone from now: short hair, a hooded top with the hood down, trousers and
 * shoes. The clothes are the body's own shapes made a little thicker, plus the
 * things that give clothing its outline — a hem, a cuff, a hood, the break of
 * a trouser leg over a shoe, a sole.
 */
function modern(): Figure {
  const { mass, limb, carve, both, hoop } = kit(HUMAN_SCALE)
  const H = HUMAN
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  const cuff = add(H.wrist, H.armDir, -0.012)
  return {
    scale: HUMAN_SCALE,
    spacing: HUMAN_SPACING,
    blend: 1.55,
    soft: 0.014,
    margin: 0.022,
    bones: skeleton(),
    refine: humanRefine,
    coat: modernCoat,
    paints: [...facePaint(0.3), ...armPaint()],
    eyes: [{ at: H.eye, radius: 0.0118 }, { at: flipZ(H.eye), radius: 0.0118 }],
    pieces: [
      ...body({ brow: 0, build: 1, broad: 0 }),
      // Short hair.
      mass(HAIR, [-0.022, 1.698, 0], [0.101, 0.079, 0.084]),
      mass(HAIR, [-0.06, 1.64, 0], [0.062, 0.06, 0.076]),
      // The top. Its body is two tubes side by side — wider than it is deep,
      // as a chest is — then the yoke over the shoulders, sleeves to the wrist
      // with a cuff on each, a band at the hem, and the hood lying on the back.
      ...both(limb(CLOTH, [[-0.002, 0.985, 0.058], [0.004, 1.12, 0.056], [-0.004, 1.3, 0.064], [-0.012, 1.44, 0.06]], [0.115, 0.108, 0.122, 0.094])),
      mass(CLOTH, [-0.004, 1.3, 0], [0.127, 0.17, 0.168]),
      mass(CLOTH, [0.012, 1.1, 0], [0.112, 0.128, 0.146]),
      mass(CLOTH, [-0.04, 1.405, 0], [0.092, 0.096, 0.214]),
      ...both(limb(CLOTH, [[-0.035, 1.535, 0.03], [-0.026, 1.5, 0.11], [-0.012, 1.474, 0.172]], [0.044, 0.045, 0.04])),
      ...both(mass(CLOTH, [-0.006, 1.444, 0.214], [0.08, 0.084, 0.08])),
      ...both(limb(CLOTH, [H.shoulder, mid(H.shoulder, H.elbow), H.elbow], [0.068, 0.063, 0.052])),
      ...both(limb(CLOTH, [H.elbow, mid(H.elbow, H.wrist), cuff], [0.05, 0.049, 0.04])),
      ...both(limb(CLOTH, [add(cuff, H.armDir, -0.03), cuff], [0.0385, 0.037], 0.004)),
      ...hoop(CLOTH, [-0.002, 0.975, 0], 0.118, 0.172, 0.022),
      mass(CLOTH, [-0.092, 1.47, 0], [0.04, 0.058, 0.1]),
      ...hoop(CLOTH, [-0.008, 1.5, 0], 0.076, 0.086, 0.021, 0.022),
      // Trousers, breaking over the shoes.
      mass(DENIM, [-0.005, 0.94, 0], [0.112, 0.108, 0.166]),
      ...both(mass(DENIM, [-0.066, 0.925, 0.082], [0.082, 0.09, 0.086])),
      ...both(limb(DENIM, [H.hip, [0.02, 0.72, 0.098], [0.016, 0.5, 0.1]], [0.096, 0.088, 0.07])),
      ...both(limb(DENIM, [[0.016, 0.5, 0.1], [-0.012, 0.32, 0.104], [-0.012, 0.11, 0.105]], [0.07, 0.066, 0.056])),
      // Shoes: an upper, and a sole a little wider than it.
      ...both(limb(HIDE, [[-0.064, 0.056, 0.105], [0.05, 0.062, 0.11], [0.17, 0.046, 0.117]], [0.042, 0.045, 0.033])),
      ...both(mass(HIDE, [-0.012, 0.082, 0.105], [0.046, 0.04, 0.043])),
      ...both(limb(SOLE, [[-0.074, 0.02, 0.105], [0.05, 0.02, 0.11], [0.178, 0.02, 0.117]], [0.04, 0.046, 0.036], 0.004)),
      ...both(carve([0.05, -0.296, 0.11], [0.34, 0.3, 0.14])),
    ],
  }
}

/** Short hair: forward over the top of the head, down at the sides and the back. */
const modernCoat: Grower = (x, _y, z, n, r) => {
  if (r[HAIR]! < 0.5) return null
  const side = z >= 0 ? 1 : -1
  if (n[1] > 0.4) return { density: 15000, length: 0.048, width: 0.014, comb: [0.8, -0.2, side * 0.45], lift: 0.1, droop: 0.3, tint: 0, tone: 0.5, strands: 8 }
  return { density: 15000, length: 0.032 + 0.012 * ramp(0, -0.08, x), width: 0.013, comb: [-0.1, -1, 0], lift: 0.2, droop: 0.25, tint: 0, tone: 0.4, strands: 8 }
}

/**
 * Where a mammoth's joints are, in metres, facing +x: three and a quarter
 * metres at the shoulder and sloping away to the hips, which is the outline
 * that makes it a mammoth and not an elephant. `evoRig.ts` poses from these.
 */
export const MAMMOTH = {
  hips: [-0.95, 1.95, 0] as Vec3,
  spine: [-0.15, 2.05, 0] as Vec3,
  chest: [0.6, 2.15, 0] as Vec3,
  neck: [1.05, 2.5, 0] as Vec3,
  head: [1.5, 2.8, 0] as Vec3,
  // The legs' top joints are inside the body, as an elephant's are: what shows
  // below the coat is only the lower two thirds of each.
  shoulder: [0.9, 2.25, 0.46] as Vec3,
  elbow: [1.02, 1.32, 0.5] as Vec3,
  wrist: [0.98, 0.32, 0.5] as Vec3,
  hip: [-1.08, 2.05, 0.44] as Vec3,
  knee: [-0.93, 1.2, 0.5] as Vec3,
  ankle: [-1.05, 0.32, 0.5] as Vec3,
  trunk: [[2.08, 2.42, 0], [2.36, 1.8, 0], [2.4, 1.2, 0], [2.32, 0.72, 0], [2.46, 0.32, 0]] as Vec3[],
  eye: [2.012, 2.77, 0.328] as Vec3,
  tusk: [[1.86, 2.5, 0.2], [2.0, 2.16, 0.28], [2.4, 1.4, 0.52], [3.02, 0.94, 0.72], [3.7, 1.04, 0.68], [4.12, 1.56, 0.46], [4.16, 2.1, 0.2]] as Vec3[],
} as const

/**
 * A woolly mammoth: a high domed head with a knob on top of it and a hump over
 * the shoulders, a back that falls away behind, small ears, a trunk, tusks
 * that go out, round and back in — and a body that is only the animal under
 * its coat, which is grown on it afterwards and is most of what is seen.
 */
function mammoth(): Figure {
  const { mass, limb, carve, both, bone } = kit(1)
  const M = MAMMOTH
  const side = (suffix: 'L' | 'R', s: 1 | -1): FigureBone[] => {
    const m = (p: Vec3) => (s === 1 ? p : flipZ(p))
    return [
      bone(`arm${suffix}`, 'chest', m(M.shoulder), 0.16, undefined, s),
      bone(`fore${suffix}`, `arm${suffix}`, m(M.elbow), 0.27, undefined, s),
      bone(`hand${suffix}`, `fore${suffix}`, m(M.wrist), 0.27, m([1.12, 0.04, 0.5]), s),
      bone(`thigh${suffix}`, 'hips', m(M.hip), 0.16, undefined, s),
      bone(`shin${suffix}`, `thigh${suffix}`, m(M.knee), 0.27, undefined, s),
      bone(`foot${suffix}`, `shin${suffix}`, m(M.ankle), 0.26, m([-0.92, 0.04, 0.5]), s),
      bone(`ear${suffix}`, 'head', m([1.2, 2.95, 0.4]), 0.1, m([1.22, 2.66, 0.66]), s),
    ]
  }
  // Nails round the front of each foot.
  const nails = (x: number, spread: number[]): Piece[] =>
    spread.flatMap((a) => both(mass(HORN, [x + 0.275 * Math.cos(a), 0.085, 0.5 + 0.27 * Math.sin(a)], [0.046, 0.075, 0.056], -a, undefined, 0.012)))
  return {
    scale: 1,
    // Coarse, for what it is: nearly all of it is under a coat. What is not —
    // the tusks, the end of the trunk, the feet, the eyes — is refined below.
    spacing: { low: 0.09, medium: 0.066, high: 0.05 },
    blend: 1.5,
    soft: 0.11,
    margin: 0.1,
    refine: (x, y, z) => {
      const eye = Math.hypot(x - M.eye[0], y - M.eye[1], Math.abs(z) - M.eye[2])
      if (eye < 0.1) return 3
      if (eye < 0.2) return 2
      if (x > 1.75 || y < 0.44) return 1
      return 0
    },
    coat: mammothCoat,
    paints: [
      // Tusks are stained where they leave the head, and worn pale at the tip.
      ...pair({ kind: 1, at: [2.05, 2.05, 0.3], size: [0.5, 0.75, 0.4], amount: 0.75 }),
      // The bare end of the trunk, and round each eye.
      { kind: 1, at: [2.44, 0.36, 0], size: [0.3, 0.34, 0.3], amount: 0.2 },
      ...pair({ kind: 1, at: [M.eye[0] + 0.02, M.eye[1], M.eye[2] + 0.03], size: [0.12, 0.09, 0.1], amount: 0.7 }),
    ],
    eyes: [{ at: M.eye, radius: 0.04 }, { at: flipZ(M.eye), radius: 0.04 }],
    // Out of the head beside the trunk, down and apart, then forward, in and up.
    sweeps: [M.tusk, M.tusk.map(flipZ)].map((path) => ({ bone: 'head', path, radii: [0.14, 0.145, 0.135, 0.118, 0.094, 0.064, 0.022] })),
    bones: [
      bone('hips', null, M.hips, 0.78),
      bone('spine', 'hips', M.spine, 0.9),
      bone('chest', 'spine', M.chest, 0.9, [1.0, 2.3, 0]),
      bone('neck', 'chest', M.neck, 0.55),
      bone('head', 'neck', M.head, 0.5, [1.9, 2.5, 0]),
      bone('trunk1', 'head', M.trunk[0]!, 0.27),
      bone('trunk2', 'trunk1', M.trunk[1]!, 0.21),
      bone('trunk3', 'trunk2', M.trunk[2]!, 0.17),
      bone('trunk4', 'trunk3', M.trunk[3]!, 0.13, M.trunk[4]),
      bone('tail', 'hips', [-1.72, 2.0, 0], 0.1, [-1.9, 1.1, 0]),
      ...side('L', 1),
      ...side('R', -1),
    ],
    pieces: [
      // --- The barrel: ribs, belly, quarters, and the line of the back -------
      mass(PELT, [0.3, 2.12, 0], [1.2, 0.86, 0.74]),
      mass(PELT, [-0.95, 1.98, 0], [0.86, 0.8, 0.7]),
      mass(PELT, [-0.25, 1.68, 0], [1.15, 0.5, 0.66]),
      mass(PELT, [0.72, 2.84, 0], [0.56, 0.5, 0.44]),
      limb(PELT, [[0.76, 3.0, 0], [-0.2, 2.74, 0], [-1.15, 2.4, 0], [-1.72, 1.98, 0]], [0.36, 0.42, 0.4, 0.27]),
      // The muscle each leg hangs from.
      ...both(mass(PELT, [0.92, 1.95, 0.48], [0.5, 0.78, 0.36])),
      ...both(mass(PELT, [-1.02, 1.8, 0.46], [0.56, 0.8, 0.36])),

      // --- Neck and head -----------------------------------------------------
      mass(PELT, [1.12, 2.55, 0], [0.6, 0.72, 0.56]),
      mass(PELT, [1.62, 3.0, 0], [0.5, 0.58, 0.46]),
      mass(PELT, [1.52, 3.44, 0], [0.31, 0.25, 0.3]),
      mass(PELT, [1.98, 2.62, 0], [0.38, 0.6, 0.36]),
      mass(PELT, [1.68, 2.3, 0], [0.42, 0.42, 0.37]),
      mass(SKIN, [1.97, 1.98, 0], [0.2, 0.13, 0.13]),
      // What each tusk grows out of, and the ears.
      ...both(mass(PELT, [2.03, 2.22, 0.27], [0.2, 0.3, 0.165])),
      ...both(mass(PELT, [1.22, 2.84, 0.5], [0.1, 0.27, 0.16], 0.5)),
      // The lid of each eye, the hollow it is in and the slot between its lids.
      ...both(mass(SKIN, M.eye, [0.046, 0.046, 0.046], undefined, undefined, 0.02)),
      ...both(carve([M.eye[0] + 0.05, M.eye[1], M.eye[2] + 0.07], [0.075, 0.06, 0.06], undefined, undefined, 0.03)),
      ...both(carve([M.eye[0] + 0.022, M.eye[1], M.eye[2] + 0.043], [0.034, 0.017, 0.034], undefined, undefined, 0.005)),
      // The trunk, bare at its end. (The tusks are not in here: see `sweeps`.)
      limb(PELT, [...M.trunk.slice(0, 4), [2.39, 0.52, 0]], [0.31, 0.25, 0.19, 0.15, 0.13]),
      limb(SKIN, [[2.39, 0.52, 0], [2.43, 0.41, 0], M.trunk[4]!], [0.128, 0.118, 0.098], 0.03),

      // --- Legs: columns, a little waisted above a pad of a foot ---------------
      ...both(limb(PELT, [[0.95, 1.85, 0.5], M.elbow, [0.99, 0.62, 0.5], [0.99, 0.26, 0.5]], [0.42, 0.3, 0.235, 0.265])),
      ...both(mass(PELT, [1.02, 0.17, 0.5], [0.3, 0.17, 0.29])),
      ...nails(1.02, [-0.95, -0.32, 0.32, 0.95]),
      ...both(limb(PELT, [[-1.05, 1.72, 0.48], M.knee, [-1.04, 0.62, 0.5], [-1.05, 0.26, 0.5]], [0.45, 0.31, 0.23, 0.26])),
      ...both(mass(PELT, [-1.0, 0.17, 0.5], [0.29, 0.17, 0.28])),
      ...nails(-1.0, [-0.6, 0, 0.6]),
      limb(PELT, [[-1.7, 2.02, 0], [-1.95, 1.5, 0], [-1.9, 1.08, 0]], [0.13, 0.085, 0.07]),
      // The ground under each foot.
      ...both(carve([1.02, -0.47, 0.5], [0.6, 0.5, 0.6])),
      ...both(carve([-1.0, -0.47, 0.5], [0.6, 0.5, 0.6])),
    ],
  }
}

/**
 * A mammoth's coat: a mane along the back and over the hump, hair that gets
 * longer down the flanks to a skirt under the belly, shorter on the head and
 * shorter still down the trunk and the legs, and none on the feet.
 */
const mammothCoat: Grower = (x, y, z, n, r) => {
  if (r[PELT]! < 0.55 || y < 0.2) return null
  const side = z >= 0 ? 1 : -1
  // The trunk, to its bare end.
  if (x > 1.95 && y < 2.25) {
    const down = ramp(2.2, 0.7, y)
    return { density: 420, length: 0.2 - 0.12 * down, width: 0.07, comb: [0.1, -1, side * 0.15], lift: 0.25, droop: 0.5, tint: 1, tone: 0.3, strands: 8 }
  }
  // The legs, below the skirt.
  if (y < 1.25) {
    const down = ramp(1.25, 0.3, y)
    return { density: 400, length: 0.42 - 0.3 * down, width: 0.075, comb: [-0.08, -1, side * 0.05], lift: 0.2, droop: 0.6, tint: 1, tone: 0.2 + 0.1 * down, strands: 8 }
  }
  // The head: a knot of it on top, shorter over the face, and none round the eyes.
  if (x > 1.25) {
    const eye = Math.hypot(x - MAMMOTH.eye[0], y - MAMMOTH.eye[1], Math.abs(z) - MAMMOTH.eye[2])
    if (eye < 0.1) return null
    if (y > 3.2) return { density: 330, length: 0.36, width: 0.085, comb: [-0.5, -0.3, side * 0.7], lift: 0.5, droop: 0.7, tint: 1, tone: 0.75, strands: 8 }
    const face = ramp(1.55, 1.95, x)
    return { density: 380, length: (0.3 - 0.17 * face) * (0.45 + 0.55 * ramp(0.1, 0.34, eye)), width: 0.075, comb: [-0.15, -1, side * 0.25], lift: 0.22, droop: 0.7, tint: 1, tone: 0.45, strands: 8 }
  }
  // The tail's tuft.
  if (x < -1.75) return { density: 420, length: 0.22 + 0.2 * ramp(1.7, 1.1, y), width: 0.07, comb: [-0.2, -1, 0], lift: 0.25, droop: 0.8, tint: 1, tone: 0.3, strands: 8 }
  // The body: longest low on the flanks, where it hangs clear.
  const low = ramp(2.6, 1.45, y)
  const top = ramp(0.2, 0.8, n[1])
  return {
    density: 300,
    length: 0.34 + 0.42 * low + 0.1 * top,
    width: 0.09,
    comb: [-0.28, -1, side * (0.2 + 0.6 * top)],
    lift: 0.22 + 0.16 * top - 0.08 * low,
    droop: 0.85,
    tint: 1,
    tone: 0.8 - 0.55 * low,
    strands: 8,
  }
}

/**
 * The crag the cave is in: not a figure, but built like one, because the same
 * mesher that fillets a limb into a body erodes a passage into a hill, and
 * bakes the dark into its corners.
 *
 * A mass of rock the size of a small hill, with the cave carved out of it — a
 * chamber at the back, a passage, a mouth with a brow of rock over it. Only the
 * walls and the roof: the floor is the land itself (`evoLand.ts`), which is
 * level under the hollow and climbs again inside the solid rock around it, so
 * the hollow has to stay inside `caveFootprint`.
 *
 * Authored at a quarter scale, so that the baked occlusion reaches most of a
 * metre into a corner rather than a hand's width.
 */
function crag(): Figure {
  const { mass, limb, carve, bone } = kit(0.25)
  const hollow = (path: Vec3[], radii: number[]): Piece => {
    const piece = limb(SKIN, path, radii)
    return { part: { ...piece.part, negative: true, group: undefined }, region: SKIN }
  }
  return {
    scale: 0.25,
    // Coarse on purpose: a crag is forty metres long, the field is sampled
    // through all of it, and the worker has a few seconds before the page
    // takes the job back. What the walls are like close to is the shader's.
    spacing: { low: 0.56, medium: 0.44, high: 0.34 },
    blend: 2.6,
    soft: 1,
    margin: 1,
    bones: [bone('hips', null, [0, 0, 0], 1, [1, 0, 0])],
    pieces: [
      // --- The rock ----------------------------------------------------------
      mass(SKIN, [-16.5, 4.5, 0.5], [19.5, 10.5, 14.5]),
      mass(SKIN, [-6.5, 7.5, -7], [9, 7, 7]),
      mass(SKIN, [-8.5, 7, 9], [8.5, 6.5, 6.5]),
      mass(SKIN, [-27, 8.5, 3], [10, 8.5, 10.5]),
      mass(SKIN, [-17, 12.5, -3], [9, 5, 8]),
      // A brow over the mouth, and a shoulder of rock either side of it.
      mass(SKIN, [1.6, 6.2, 0.2], [3.6, 2.5, 6]),
      mass(SKIN, [1.3, 1.6, 5.6], [2.8, 3.6, 2.6]),
      mass(SKIN, [0.9, 1.3, -5.4], [2.6, 3.3, 2.8]),
      mass(SKIN, [4.2, 0.4, 7.4], [2.2, 1.5, 1.9]),
      mass(SKIN, [3.6, 0.3, -7.6], [1.9, 1.3, 2.1]),

      // --- The hollow --------------------------------------------------------
      // The chamber: a dome, with bays off it so its wall is not a circle.
      carve([-17.5, 0.6, 0.4], [6.1, 5.0, 5.9]),
      carve([-20.4, 0.8, -2.4], [3.6, 3.7, 3.4]),
      carve([-15.2, 0.9, 3.4], [4.2, 4.1, 3.0]),
      carve([-13.6, 0.5, -2.7], [3.4, 3.2, 3.0]),
      // The passage, lower in the middle than at either end, and the mouth.
      hollow([[-13, 1.2, 0.4], [-8, 1.0, 0.25], [-3.5, 1.1, 0.1], [1.5, 1.5, 0]], [3.1, 2.55, 2.7, 3.2]),
      carve([2.6, 1.2, 0], [3.4, 3.5, 3.5]),
    ],
  }
}

const BUILDERS: Record<FigureKind, () => Figure> = { early, modern, mammoth, crag }

/** Generates one figure. Pure arithmetic: safe to call from a worker. */
export function createFigure(kind: FigureKind, detail: CreatureDetail): CreaturePayload {
  return buildFigure(BUILDERS[kind](), detail)
}
