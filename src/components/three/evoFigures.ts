import { blob, cut, mirrored, toPrimitives, tube, type BoneSpec, type CreatureDetail, type CreaturePayload, type Part } from './creatures'
import { meshSdf, nearestField, type Vec3 } from './sdf'

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
 *   skin, hair, clothing, trim — and after meshing each vertex is given its
 *   share of the four, from which region's shapes it lies nearest. The surface
 *   is still one mesh with no seams; the shader colours it by those weights.
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

/** What a shape is made of. The shader has four colours and four finishes to match. */
const SKIN = 0
const HAIR = 1
const CLOTH = 2
const TRIM = 3
type Region = typeof SKIN | typeof HAIR | typeof CLOTH | typeof TRIM

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

/** Each vertex's share of the four regions, from which region's shapes it lies nearest. */
function regionsOf(positions: Float32Array, pieces: Piece[], unit: number): Float32Array {
  const fields = [SKIN, HAIR, CLOTH, TRIM].map((region) => {
    const parts = pieces.filter((piece) => piece.region === region && !piece.part.negative).map((piece) => piece.part)
    return parts.length ? nearestField(toPrimitives(parts)) : null
  })
  const count = positions.length / 3
  const out = new Float32Array(count * 4)
  // The width of the border between two regions on the surface.
  const soft = 0.0045 * unit
  // What is worn lies over what wears it. Where a sleeve and the arm inside it
  // are both at the surface the sleeve has it, by this much.
  const over = [0, 0.012 * unit, 0.016 * unit, 0.014 * unit]
  const d = [0, 0, 0, 0]
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    const z = positions[v * 3 + 2]!
    let least = Infinity
    for (let r = 0; r < 4; r++) {
      d[r] = fields[r] ? fields[r]!(x, y, z) - over[r]! : Infinity
      if (d[r]! < least) least = d[r]!
    }
    let total = 0
    for (let r = 0; r < 4; r++) {
      const w = d[r] === Infinity ? 0 : Math.exp(-(d[r]! - least) / soft)
      out[v * 4 + r] = w
      total += w
    }
    for (let r = 0; r < 4; r++) out[v * 4 + r] = out[v * 4 + r]! / (total || 1)
  }
  return out
}

function buildFigure(figure: Figure, detail: CreatureDetail): CreaturePayload {
  const unit = figure.scale
  const spacing = figure.spacing[detail] * unit
  const blend = spacing * figure.blend
  const { positions, normals, indices, ao } = meshSdf(toPrimitives(figure.pieces.map((piece) => piece.part)), { spacing, blend, carve: blend * 0.45 })

  // Regions and skin weights are worked out where the anatomy was written,
  // before the mesh is moved and scaled.
  const regions = regionsOf(positions, figure.pieces, unit)
  const { skinIndices, skinWeights } = skin(positions, figure.bones, figure.soft * unit, figure.margin * unit)

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

  return {
    positions,
    normals,
    indices,
    ao,
    skinIndices,
    skinWeights,
    bones,
    eyeBone: bones.some((bone) => bone.name === 'head') ? 'head' : bones[0]!.name,
    eyes: [],
    teeth: [],
    regions,
    size: longest / unit,
  }
}

// ---------------------------------------------------------------- authoring

/** Raw units to a metre for the people: enough that a tube's bends and the baked occlusion are resolved. */
const HUMAN_SCALE = 2

const at = (unit: number, [x, y, z]: Vec3): Vec3 => [x * unit, y * unit, z * unit]

/** Helpers that take metres and tag the shape with what it is made of. */
function kit(unit: number) {
  // Every tube is one shape: its capsules are joined plainly, and only the
  // whole limb is filleted into the body.
  let groups = 0
  const mass = (region: Region, p: Vec3, size: Vec3, yaw?: number, pitch?: number): Piece => ({ part: blob(at(unit, p), at(unit, size), yaw, pitch), region })
  const limb = (region: Region, path: Vec3[], radii: number[]): Piece => ({
    part: {
      ...tube(
        path.map((p) => at(unit, p)),
        radii.map((r) => r * unit),
      ),
      group: groups++,
    },
    region,
  })
  const carve = (p: Vec3, size: Vec3, yaw?: number, pitch?: number): Piece => ({ part: cut(at(unit, p), at(unit, size), yaw, pitch), region: SKIN })
  const both = (piece: Piece): Piece[] => mirrored(piece.part).map((part) => ({ part, region: piece.region }))
  /** A closed band round the body at a height: a belt, a collar, a hem. */
  const ring = (region: Region, y: number, front: number, back: number, half: number, radius: number, slant = 0): Piece[] => {
    const steps = 10
    const points: Vec3[] = []
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const cx = (front - back) / 2
      const rx = (front + back) / 2
      points.push([cx + Math.cos(a) * rx, y + Math.cos(a) * slant, Math.sin(a) * half])
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
  return { mass, limb, carve, both, ring, bone }
}

const add = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]

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
  /** Whether the chest is bare. Under a top its muscle is left out, or it shows through the cloth. */
  bare: boolean
}

/** The body under whatever it wears: the same for everyone, give or take a brow. */
function body(look: HumanLook): Piece[] {
  const { mass, limb, carve, both } = kit(HUMAN_SCALE)
  const g = look.build
  const H = HUMAN
  const mid = (a: Vec3, b: Vec3, bulge: Vec3 = [0, 0, 0]): Vec3 => [(a[0] + b[0]) / 2 + bulge[0], (a[1] + b[1]) / 2 + bulge[1], (a[2] + b[2]) / 2 + bulge[2]]
  return [
    // --- Trunk: hips, a belly, a ribcage, the muscle over them ---------------
    mass(SKIN, [-0.005, 0.955, 0], [0.1, 0.105, 0.156]),
    mass(SKIN, [0.012, 1.09, 0], [0.097 * g, 0.12, 0.134 * g]),
    mass(SKIN, [-0.005, 1.29, 0], [0.117 * g, 0.165, 0.16 * g]),
    ...(look.bare ? both(mass(SKIN, [0.084, 1.345, 0.085], [0.022 * g, 0.05, 0.08])) : []),
    mass(SKIN, [-0.04, 1.4, 0], [0.084 * g, 0.094, 0.206]),
    ...both(limb(SKIN, [[-0.02, 1.515, 0.035], [-0.015, 1.488, 0.12]], [0.045 * g, 0.045 * g])),
    ...both(mass(SKIN, [-0.006, 1.45, 0.207], [0.063 * g, 0.07, 0.063 * g])),
    ...both(mass(SKIN, [-0.066, 0.925, 0.082], [0.074, 0.084, 0.08])),

    // --- Neck and head ---------------------------------------------------------
    limb(SKIN, [[-0.018, 1.47, 0], [-0.008, 1.53, 0], [0, 1.585, 0]], [0.057 * g, 0.05 * g, 0.049 * g]),
    mass(SKIN, [-0.012, 1.672, 0], [0.097, 0.093, 0.077]),
    mass(SKIN, [0.034, 1.612, 0], [0.069, 0.088, 0.064]),
    mass(SKIN, [0.035, 1.565, 0], [0.058, 0.043, 0.056]),
    mass(SKIN, [0.068, 1.548, 0], [0.026, 0.026, 0.03]),
    mass(SKIN, [0.08, 1.678, 0], [0.02 + 0.006 * look.brow, 0.012 + 0.005 * look.brow, 0.056]),
    limb(SKIN, [[0.086, 1.668, 0], [0.108, 1.63, 0], [0.111, 1.614, 0]], [0.01, 0.012, 0.0145]),
    mass(SKIN, [0.092, 1.582, 0], [0.016, 0.016, 0.026]),
    ...both(mass(SKIN, [0.07, 1.628, 0.044], [0.024, 0.021, 0.021])),
    ...both(mass(SKIN, [-0.005, 1.635, 0.078], [0.016, 0.03, 0.011])),
    ...both(carve([0.098, 1.655, 0.031], [0.009, 0.007, 0.014])),
    carve([0.108, 1.579, 0], [0.01, 0.0026, 0.022]),

    // --- Arms: held out, so they meet the body at the shoulder and nowhere else
    ...both(limb(SKIN, [H.shoulder, mid(H.shoulder, H.elbow, [0.008, 0, 0]), H.elbow], [0.05 * g, 0.049 * g, 0.038 * g])),
    ...both(limb(SKIN, [H.elbow, mid(H.elbow, H.wrist, [0.004, 0, 0]), H.wrist], [0.039 * g, 0.042 * g, 0.027])),
    // The hand: three tubes side by side make a palm, which is wider than it is thick.
    ...[-0.021, 0, 0.021].flatMap((dx) =>
      both(limb(SKIN, [add(H.wrist, [dx * 0.6, 0, 0], 1), add(mid(H.wrist, H.tip), [dx, 0, 0], 1), add(H.tip, [dx * 0.8, 0, 0], 1)], [0.019, 0.021, 0.014])),
    ),
    ...both(limb(SKIN, [add(H.wrist, [0.022, -0.02, 0.012], 1), add(H.wrist, [0.052, -0.075, 0.03], 1)], [0.016, 0.012])),

    // --- Legs ------------------------------------------------------------------
    ...both(limb(SKIN, [H.hip, [0.02, 0.72, 0.098], H.knee], [0.086 * g, 0.079 * g, 0.054 * g])),
    ...both(mass(SKIN, [0.024, 0.5, 0.1], [0.05, 0.055, 0.05])),
    ...both(limb(SKIN, [[0.008, 0.47, 0.1], [-0.02, 0.34, 0.104], H.ankle], [0.05 * g, 0.057 * g, 0.033])),
    ...both(limb(SKIN, [[-0.056, 0.04, 0.105], [0.05, 0.045, 0.11], [0.162, 0.027, 0.117]], [0.037, 0.04, 0.026])),
  ]
}

function skeleton(): FigureBone[] {
  const { bone } = kit(HUMAN_SCALE)
  const H = HUMAN
  const flip = ([x, y, z]: Vec3): Vec3 => [x, y, -z]
  const side = (suffix: 'L' | 'R', s: 1 | -1): FigureBone[] => {
    const m = (p: Vec3) => (s === 1 ? p : flip(p))
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

const HUMAN_SPACING: Record<CreatureDetail, number> = { low: 0.019, medium: 0.013, high: 0.0095 }

/**
 * Someone from the cave: heavy-browed and thick-set, long hair and a beard, a
 * hide wrapped over one shoulder and belted at the waist, bare legs and feet.
 */
function early(): Figure {
  const { mass, limb, both, ring } = kit(HUMAN_SCALE)
  return {
    scale: HUMAN_SCALE,
    spacing: HUMAN_SPACING,
    blend: 1.55,
    soft: 0.014,
    margin: 0.022,
    bones: skeleton(),
    pieces: [
      ...body({ brow: 1, build: 1.07, bare: true }),
      // Hair: a shaggy mass, down the neck to the shoulders, and a beard.
      mass(HAIR, [-0.03, 1.7, 0], [0.105, 0.086, 0.09]),
      limb(HAIR, [[-0.085, 1.66, 0], [-0.097, 1.56, 0], [-0.088, 1.47, 0]], [0.066, 0.07, 0.055]),
      ...both(limb(HAIR, [[-0.012, 1.67, 0.07], [-0.03, 1.57, 0.086], [-0.046, 1.485, 0.088]], [0.035, 0.036, 0.026])),
      mass(HAIR, [0.058, 1.536, 0], [0.04, 0.046, 0.052]),
      // The hide: a kilt to mid-thigh, and a band of it up over the left shoulder.
      mass(CLOTH, [-0.005, 0.975, 0], [0.128, 0.11, 0.184]),
      mass(CLOTH, [-0.002, 0.84, 0], [0.15, 0.125, 0.202]),
      limb(CLOTH, [[0, 1.5, 0.13], [0.09, 1.36, 0.05], [0.104, 1.2, -0.06], [0.06, 1.07, -0.15]], [0.05, 0.055, 0.055, 0.05]),
      limb(CLOTH, [[-0.03, 1.5, 0.13], [-0.118, 1.36, 0.05], [-0.112, 1.2, -0.06], [-0.062, 1.07, -0.15]], [0.05, 0.055, 0.055, 0.05]),
      mass(CLOTH, [-0.012, 1.485, 0.165], [0.082, 0.058, 0.088]),
      // A thong round the waist.
      ...ring(TRIM, 1.068, 0.128, 0.132, 0.178, 0.02),
    ],
  }
}

/**
 * Someone from now: short hair, a hooded top with the hood down, trousers and
 * shoes. The clothes are the body's own shapes made a little thicker, plus the
 * things that give clothing its outline — a hem, a hood, the break of a
 * trouser leg over a shoe.
 */
function modern(): Figure {
  const { mass, limb, both, ring } = kit(HUMAN_SCALE)
  const H = HUMAN
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  return {
    scale: HUMAN_SCALE,
    spacing: HUMAN_SPACING,
    blend: 1.55,
    soft: 0.014,
    margin: 0.022,
    bones: skeleton(),
    pieces: [
      ...body({ brow: 0, build: 1, bare: false }),
      // Short hair.
      mass(HAIR, [-0.022, 1.698, 0], [0.101, 0.079, 0.084]),
      mass(HAIR, [-0.06, 1.64, 0], [0.062, 0.06, 0.076]),
      // The top. Its body is two tubes side by side — wider than it is deep,
      // as a chest is — then the yoke over the shoulders, sleeves to the wrist,
      // and the hood lying on the back.
      ...both(limb(CLOTH, [[-0.002, 0.985, 0.058], [0.004, 1.12, 0.056], [-0.004, 1.3, 0.064], [-0.012, 1.44, 0.06]], [0.115, 0.108, 0.122, 0.094])),
      mass(CLOTH, [-0.04, 1.405, 0], [0.09, 0.094, 0.212]),
      ...both(mass(CLOTH, [-0.006, 1.45, 0.207], [0.072, 0.076, 0.072])),
      ...both(limb(CLOTH, [H.shoulder, mid(H.shoulder, H.elbow), H.elbow], [0.063, 0.06, 0.05])),
      ...both(limb(CLOTH, [H.elbow, mid(H.elbow, H.wrist), add(H.wrist, H.armDir, -0.015)], [0.05, 0.049, 0.04])),
      mass(CLOTH, [-0.098, 1.475, 0], [0.05, 0.075, 0.12]),
      ...ring(CLOTH, 1.5, 0.068, 0.084, 0.086, 0.021, 0.022),
      // Trousers, and the shoes they break over.
      mass(TRIM, [-0.005, 0.94, 0], [0.112, 0.108, 0.166]),
      ...both(mass(TRIM, [-0.066, 0.925, 0.082], [0.082, 0.09, 0.086])),
      ...both(limb(TRIM, [H.hip, [0.02, 0.72, 0.098], [0.016, 0.5, 0.1]], [0.096, 0.088, 0.07])),
      ...both(limb(TRIM, [[0.016, 0.5, 0.1], [-0.012, 0.32, 0.104], [-0.012, 0.11, 0.105]], [0.07, 0.066, 0.054])),
      ...both(limb(HAIR, [[-0.066, 0.042, 0.105], [0.05, 0.05, 0.11], [0.172, 0.034, 0.117]], [0.044, 0.047, 0.034])),
      ...both(mass(HAIR, [-0.012, 0.075, 0.105], [0.046, 0.04, 0.044])),
    ],
  }
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
} as const

/**
 * A woolly mammoth: a high domed head and a hump over the shoulders, a back
 * that falls away behind it, a coat that hangs to the knees, small ears, a
 * trunk, and tusks that go out, round and back in.
 */
function mammoth(): Figure {
  const { mass, limb, carve, both, bone } = kit(1)
  const M = MAMMOTH
  const flip = ([x, y, z]: Vec3): Vec3 => [x, y, -z]
  const side = (suffix: 'L' | 'R', s: 1 | -1): FigureBone[] => {
    const m = (p: Vec3) => (s === 1 ? p : flip(p))
    return [
      bone(`arm${suffix}`, 'chest', m(M.shoulder), 0.16, undefined, s),
      bone(`fore${suffix}`, `arm${suffix}`, m(M.elbow), 0.27, undefined, s),
      bone(`hand${suffix}`, `fore${suffix}`, m(M.wrist), 0.27, m([1.12, 0.04, 0.5]), s),
      bone(`thigh${suffix}`, 'hips', m(M.hip), 0.16, undefined, s),
      bone(`shin${suffix}`, `thigh${suffix}`, m(M.knee), 0.27, undefined, s),
      bone(`foot${suffix}`, `shin${suffix}`, m(M.ankle), 0.26, m([-0.92, 0.04, 0.5]), s),
      bone(`ear${suffix}`, 'head', m([1.2, 2.95, 0.4]), 0.1, m([1.22, 2.66, 0.66]), s),
      // The tusks have bones only so that they keep to the head: the trunk
      // hangs between them, and without these its bones would have them.
      bone(`tusk${suffix}`, 'head', m([1.95, 2.15, 0.28]), 0.13, undefined, s),
      bone(`tuskTip${suffix}`, `tusk${suffix}`, m([3.0, 1.15, 0.62]), 0.1, m([3.75, 2.05, 0.2]), s),
    ]
  }
  return {
    scale: 1,
    spacing: { low: 0.075, medium: 0.052, high: 0.038 },
    blend: 1.9,
    soft: 0.11,
    margin: 0.1,
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
      // --- The barrel, under its coat ----------------------------------------
      mass(CLOTH, [0.55, 2.02, 0], [0.98, 0.98, 0.8]),
      mass(CLOTH, [-0.2, 1.8, 0], [1.08, 0.9, 0.84]),
      mass(CLOTH, [-0.98, 1.9, 0], [0.82, 0.86, 0.74]),
      mass(CLOTH, [0.5, 2.82, 0], [0.6, 0.5, 0.48]),
      limb(CLOTH, [[0.62, 2.95, 0], [-0.2, 2.72, 0], [-1.1, 2.42, 0], [-1.58, 2.0, 0]], [0.42, 0.46, 0.42, 0.3]),
      // The coat hanging off the flanks and the belly.
      mass(CLOTH, [-0.15, 1.3, 0], [1.25, 0.55, 0.74]),
      ...both(mass(CLOTH, [0.9, 1.5, 0.5], [0.48, 0.62, 0.36])),
      ...both(mass(CLOTH, [-1.02, 1.45, 0.48], [0.5, 0.62, 0.36])),

      // --- Neck and head -----------------------------------------------------
      mass(CLOTH, [1.02, 2.5, 0], [0.62, 0.74, 0.6]),
      mass(CLOTH, [1.52, 2.95, 0], [0.52, 0.62, 0.48]),
      mass(CLOTH, [1.44, 3.42, 0], [0.32, 0.27, 0.31]),
      mass(SKIN, [1.86, 2.52, 0], [0.42, 0.6, 0.4]),
      ...both(mass(CLOTH, [1.2, 2.84, 0.5], [0.13, 0.3, 0.17], 0.5)),
      ...both(carve([2.1, 2.78, 0.33], [0.05, 0.04, 0.05])),
      limb(SKIN, M.trunk, [0.31, 0.25, 0.19, 0.15, 0.11]),
      ...both(limb(TRIM, [[1.95, 2.15, 0.28], [2.4, 1.45, 0.5], [3.0, 1.15, 0.62], [3.5, 1.45, 0.47], [3.68, 1.92, 0.26]], [0.13, 0.12, 0.105, 0.085, 0.055])),

      // --- Legs: columns, with a pad of a foot ---------------------------------
      ...both(limb(SKIN, [[0.95, 1.85, 0.5], M.elbow, M.wrist], [0.42, 0.31, 0.26])),
      ...both(mass(SKIN, [1.03, 0.15, 0.5], [0.31, 0.16, 0.3])),
      ...both(limb(SKIN, [[-1.05, 1.72, 0.48], M.knee, M.ankle], [0.45, 0.32, 0.25])),
      ...both(mass(SKIN, [-1.0, 0.15, 0.5], [0.3, 0.16, 0.29])),
      limb(CLOTH, [[-1.7, 2.02, 0], [-1.95, 1.5, 0], [-1.9, 1.08, 0]], [0.13, 0.085, 0.07]),
    ],
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
