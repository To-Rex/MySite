import { meshSdf, type SdfPrimitive, type Vec3 } from './sdf'

/**
 * Procedural, rigged creature sculptures for the hero — no external model files,
 * so nothing to download, license or cache-bust.
 *
 * Both shapes are Dilshodjon's own brand symbols: the tyrannosaur comes from the
 * handle "To-Rex", the turtle from his GitHub avatar.
 *
 * Anatomy is authored as ellipsoid masses plus tapering tubes, but those are not
 * meshed as separate shells — they are blended into one signed distance field and
 * a single continuous surface is extracted from it, so limbs meet the torso with
 * real fillets instead of visible intersection creases. Skin weights are baked
 * against a small skeleton, which lets a tail travel a wave and a head turn
 * without the surface tearing, at one draw call per creature.
 *
 * Like `sdf.ts` this module has no three.js dependency: it produces plain typed
 * arrays so the whole generation can run inside a Web Worker, off the main
 * thread, without shipping a second copy of three to the browser.
 *
 * Output is centred on the origin and normalised so the longest axis measures
 * exactly 1 unit — callers scale to taste. Bone rest positions travel through
 * the same transform so they stay aligned with the mesh.
 */

export type CreatureDetail = 'low' | 'medium' | 'high'
export type CreatureKind = 'dino' | 'turtle'

/**
 * Field spacing and fillet radius per tier.
 *
 * These two are coupled: a blend much smaller than the spacing cannot be
 * resolved and joints go back to looking like hard creases, while a blend near
 * the size of a real feature (a flipper, a toe) dissolves that feature. Roughly
 * blend ≈ 1.4 × spacing, with anatomy kept comfortably thicker than the blend.
 */
const QUALITY: Record<CreatureDetail, { spacing: number; blend: number }> = {
  low: { spacing: 0.065, blend: 0.09 },
  medium: { spacing: 0.045, blend: 0.065 },
  high: { spacing: 0.034, blend: 0.05 },
}

/** A body mass. */
interface Blob {
  kind: 'blob'
  at: Vec3
  /** Radii along x / y / z. */
  size: Vec3
  yaw?: number
  pitch?: number
  /** Carve out of the body rather than adding to it. */
  negative?: boolean
}

/** A limb, tail or muzzle: a tapering tube swept along a curve. */
interface Tube {
  kind: 'tube'
  path: Vec3[]
  /** Radius at each path point; interpolated in between. */
  radii: number[]
}

type Part = Blob | Tube

/** One joint of a creature's skeleton, in bind pose. */
export interface BoneSpec {
  name: string
  /** Parent bone name, or null for the root. */
  parent: string | null
  /** Joint position in creature space. */
  head: Vec3
  /**
   * Far end of the bone's influence. Defaults to the first child's head; set it
   * explicitly for leaf bones (skull, feet, tail tip) so they own enough mesh.
   */
  tip?: Vec3
}

/** Everything needed to build a SkinnedMesh, in transferable form. */
export interface CreaturePayload {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  /** Baked ambient occlusion per vertex — creases, armpits, under the jaw. */
  ao: Float32Array
  skinIndices: Uint16Array
  skinWeights: Float32Array
  bones: BoneSpec[]
}

const blob = (at: Vec3, size: Vec3, yaw?: number, pitch?: number): Blob => ({ kind: 'blob', at, size, yaw, pitch })
/** A shape carved out of the body: eye sockets, nostrils, the mouth line. */
const cut = (at: Vec3, size: Vec3, yaw?: number, pitch?: number): Blob => ({
  kind: 'blob',
  at,
  size,
  yaw,
  pitch,
  negative: true,
})
const tube = (path: Vec3[], radii: number[]): Tube => ({ kind: 'tube', path, radii })

/** Mirrors a part across the z axis, for limbs that come in pairs. */
function mirrored(part: Part): Part[] {
  if (part.kind === 'blob') {
    const [x, y, z] = part.at
    return [part, { ...part, at: [x, y, -z], yaw: part.yaw === undefined ? undefined : -part.yaw }]
  }
  return [part, { ...part, path: part.path.map(([x, y, z]) => [x, y, -z] as Vec3) }]
}

/**
 * Cardinal spline (tension 0.5) through the given points, sampled uniformly in
 * parameter space. End tangents are extrapolated from the first/last segment.
 * A local implementation rather than three's CatmullRomCurve3 so this file stays
 * runnable in a worker.
 */
function splinePoint(points: Vec3[], t: number): Vec3 {
  const n = points.length - 1
  const scaled = Math.min(t, 1) * n
  const i = Math.min(n - 1, Math.floor(scaled))
  const f = scaled - i

  const p1 = points[i]!
  const p2 = points[i + 1]!
  const p0 = points[i - 1] ?? ([2 * p1[0] - p2[0], 2 * p1[1] - p2[1], 2 * p1[2] - p2[2]] as Vec3)
  const p3 = points[i + 2] ?? ([2 * p2[0] - p1[0], 2 * p2[1] - p1[1], 2 * p2[2] - p1[2]] as Vec3)

  const f2 = f * f
  const f3 = f2 * f
  const h00 = 2 * f3 - 3 * f2 + 1
  const h10 = f3 - 2 * f2 + f
  const h01 = -2 * f3 + 3 * f2
  const h11 = f3 - f2

  const out: Vec3 = [0, 0, 0]
  for (let a = 0; a < 3; a++) {
    const m1 = 0.5 * (p2[a]! - p0[a]!)
    const m2 = 0.5 * (p3[a]! - p1[a]!)
    out[a] = h00 * p1[a]! + h10 * m1 + h01 * p2[a]! + h11 * m2
  }
  return out
}

/** Rough arc length: the control polygon is close enough for choosing step counts. */
function polylineLength(points: Vec3[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return total
}

/**
 * Turns a tube into a chain of tapered capsules. A capsule is exact along its
 * own length, so segment count only has to track the curve's bend — matching it
 * to field resolution makes the primitive count (and meshing time) explode for
 * no visible gain.
 */
function tubeToCones(part: Tube): SdfPrimitive[] {
  const steps = Math.min(14, Math.max(4, Math.round(polylineLength(part.path) / 0.32)))

  const radiusAt = (t: number) => {
    const x = t * (part.radii.length - 1)
    const i = Math.min(part.radii.length - 2, Math.floor(x))
    const f = x - i
    return (part.radii[i] ?? 0) * (1 - f) + (part.radii[i + 1] ?? 0) * f
  }

  const cones: SdfPrimitive[] = []
  let prev = splinePoint(part.path, 0)
  let prevR = radiusAt(0)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const point = splinePoint(part.path, t)
    const r = radiusAt(t)
    cones.push({ kind: 'cone', a: prev, b: point, ra: prevR, rb: r })
    prev = point
    prevR = r
  }
  return cones
}

function toPrimitives(parts: Part[]): SdfPrimitive[] {
  const out: SdfPrimitive[] = []
  for (const part of parts) {
    if (part.kind === 'blob') {
      out.push({
        kind: 'ellipsoid',
        at: part.at,
        radii: part.size,
        yaw: part.yaw,
        pitch: part.pitch,
        negative: part.negative,
      })
    } else {
      out.push(...tubeToCones(part))
    }
  }
  return out
}

/** Squared distance from a point to a line segment. */
function distSqToSegment(px: number, py: number, pz: number, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const apx = px - a[0]
  const apy = py - a[1]
  const apz = pz - a[2]
  const abLenSq = abx * abx + aby * aby + abz * abz
  let t = abLenSq > 1e-9 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = apx - abx * t
  const dy = apy - aby * t
  const dz = apz - abz * t
  return dx * dx + dy * dy + dz * dz
}

const MAX_INFLUENCES = 4
/**
 * Falloff exponent for skin weights. Higher makes each bone own its own limb
 * more strictly; lower blends more softly but lets limbs drag the torso around.
 */
const FALLOFF = 3

/**
 * Assigns every vertex to its nearest bone segments, weighted by inverse
 * distance. Good enough for organic shapes whose limbs are well separated, and
 * it costs nothing at runtime — weights are baked once during generation.
 */
function computeSkinning(positions: Float32Array, bones: BoneSpec[]) {
  const names = new Set(bones.map((b) => b.name))
  for (const bone of bones) {
    if (bone.parent !== null && !names.has(bone.parent)) {
      throw new Error(`creature bone "${bone.name}" references unknown parent "${bone.parent}"`)
    }
  }

  // Influence segment per bone: joint → tip (explicit, or the first child's joint).
  const segments = bones.map((bone) => {
    if (bone.tip) return { head: bone.head, tip: bone.tip }
    const child = bones.find((b) => b.parent === bone.name)
    return { head: bone.head, tip: child ? child.head : bone.head }
  })

  const count = positions.length / 3
  const skinIndices = new Uint16Array(count * 4)
  const skinWeights = new Float32Array(count * 4)
  const scored = bones.map((_, index) => ({ index, weight: 0 }))

  for (let v = 0; v < count; v++) {
    const px = positions[v * 3]!
    const py = positions[v * 3 + 1]!
    const pz = positions[v * 3 + 2]!

    for (let b = 0; b < segments.length; b++) {
      const seg = segments[b]!
      const d2 = distSqToSegment(px, py, pz, seg.head, seg.tip)
      scored[b]!.index = b
      scored[b]!.weight = 1 / Math.pow(d2 + 1e-4, FALLOFF / 2)
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

function build(parts: Part[], boneSpecs: BoneSpec[], detail: CreatureDetail): CreaturePayload {
  const { spacing, blend } = QUALITY[detail]
  const { positions, normals, indices, ao } = meshSdf(toPrimitives(parts), { spacing, blend })

  // Centre on the origin, then normalise the longest axis to 1 unit.
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
  const bones: BoneSpec[] = boneSpecs.map((b) => ({
    ...b,
    head: map(b.head),
    tip: b.tip ? map(b.tip) : undefined,
  }))

  const { skinIndices, skinWeights } = computeSkinning(positions, bones)
  return { positions, normals, indices, ao, skinIndices, skinWeights, bones }
}

/* -------------------------------------------------------------------------- */
/* Tyrannosaurus                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Facing +x: heavy skull carried forward on an S-curved neck, deep ribcage,
 * muscular drumstick thighs over three-toed feet, and a long tail that tapers
 * and lifts to counterbalance.
 *
 * Nothing here is thinner than the blend radius — features at that scale get
 * dissolved by the smooth union rather than rendered.
 */
const DINOSAUR_PARTS: Part[] = [
  // --- Trunk: ribcage tapering into narrow hips, with a slung belly ---------
  blob([0.05, 0.02, 0], [0.9, 0.66, 0.56]),
  blob([0.6, 0.1, 0], [0.58, 0.58, 0.51]),
  blob([-0.55, -0.04, 0], [0.6, 0.55, 0.5]),
  blob([0.16, -0.24, 0], [0.72, 0.42, 0.46]),
  // Shoulder and hip muscle, so limbs emerge from mass rather than sockets.
  ...mirrored(blob([0.5, -0.02, 0.34], [0.34, 0.36, 0.24])),
  ...mirrored(blob([-0.48, 0.02, 0.33], [0.36, 0.4, 0.24])),
  // Dorsal ridge running the length of the spine.
  tube(
    [
      [0.75, 0.5, 0],
      [0.2, 0.6, 0],
      [-0.5, 0.5, 0],
      [-1.0, 0.34, 0],
    ],
    [0.1, 0.14, 0.12, 0.07],
  ),

  // --- Tail ------------------------------------------------------------------
  tube(
    [
      [-0.45, 0.0, 0],
      [-1.2, 0.02, 0],
      [-1.9, 0.08, 0],
      [-2.5, 0.18, 0],
      [-2.95, 0.3, 0],
      [-3.3, 0.44, 0],
    ],
    [0.46, 0.34, 0.23, 0.15, 0.09, 0.045],
  ),
  // Caudofemoral muscle: the heavy wedge where tail meets hip.
  blob([-0.95, -0.04, 0], [0.45, 0.34, 0.34]),

  // --- Neck ------------------------------------------------------------------
  tube(
    [
      [0.52, 0.16, 0],
      [0.84, 0.38, 0],
      [1.1, 0.55, 0],
      [1.32, 0.62, 0],
    ],
    [0.38, 0.28, 0.23, 0.2],
  ),
  blob([0.86, 0.46, 0], [0.26, 0.18, 0.22]), // nape muscle

  // --- Skull -----------------------------------------------------------------
  blob([1.58, 0.68, 0], [0.33, 0.27, 0.24]), // cranium
  ...mirrored(blob([1.62, 0.72, 0.16], [0.22, 0.15, 0.09])), // cheek arch
  blob([1.9, 0.68, 0], [0.32, 0.19, 0.17]), // maxilla
  tube(
    [
      [1.7, 0.68, 0],
      [2.02, 0.65, 0],
      [2.26, 0.6, 0],
    ],
    [0.23, 0.17, 0.1],
  ),
  ...mirrored(blob([1.7, 0.87, 0.13], [0.19, 0.075, 0.085])), // lacrimal brow horns
  blob([1.95, 0.5, 0], [0.3, 0.1, 0.155]), // lower jaw
  blob([1.66, 0.47, 0], [0.16, 0.11, 0.15]), // jaw muscle at the hinge

  // Carved detail: eye sockets, nostrils and the mouth line. Baked occlusion
  // does the rest — a recessed orbit reads as a dark eye without any texture.
  ...mirrored(cut([1.63, 0.76, 0.2], [0.085, 0.075, 0.07])),
  ...mirrored(cut([2.06, 0.7, 0.075], [0.05, 0.035, 0.035])),
  cut([2.0, 0.585, 0], [0.42, 0.028, 0.2]),

  // --- Legs ------------------------------------------------------------------
  ...mirrored(blob([-0.46, -0.2, 0.37], [0.36, 0.52, 0.3])), // thigh
  ...mirrored(blob([-0.38, -0.62, 0.37], [0.22, 0.26, 0.21])), // knee
  ...mirrored(
    tube(
      [
        [-0.4, -0.66, 0.37],
        [-0.3, -1.02, 0.37],
        [-0.21, -1.32, 0.37],
      ],
      [0.21, 0.14, 0.11],
    ),
  ),
  ...mirrored(blob([-0.04, -1.4, 0.37], [0.21, 0.1, 0.16])), // metatarsus pad
  ...mirrored(blob([0.16, -1.42, 0.37], [0.17, 0.08, 0.07])), // middle toe
  ...mirrored(blob([0.11, -1.42, 0.5], [0.15, 0.075, 0.065], 0.38)), // outer toe
  ...mirrored(blob([0.11, -1.42, 0.24], [0.15, 0.075, 0.065], -0.38)), // inner toe
  // Claws
  ...mirrored(tube([[0.3, -1.43, 0.37], [0.4, -1.45, 0.37]], [0.055, 0.012])),
  ...mirrored(tube([[0.23, -1.43, 0.56], [0.31, -1.45, 0.61]], [0.048, 0.01])),
  ...mirrored(tube([[0.23, -1.43, 0.18], [0.31, -1.45, 0.13]], [0.048, 0.01])),

  // --- Arms: two clawed fingers, held close to the chest --------------------
  ...mirrored(
    tube(
      [
        [0.8, -0.08, 0.3],
        [0.98, -0.22, 0.32],
        [1.1, -0.36, 0.3],
      ],
      [0.14, 0.11, 0.08],
    ),
  ),
  ...mirrored(tube([[1.12, -0.38, 0.27], [1.24, -0.46, 0.26]], [0.055, 0.014])),
  ...mirrored(tube([[1.12, -0.38, 0.33], [1.23, -0.44, 0.35]], [0.05, 0.012])),
]

const DINOSAUR_BONES: BoneSpec[] = [
  { name: 'root', parent: null, head: [-0.35, -0.02, 0] },
  { name: 'spine1', parent: 'root', head: [0.1, 0.02, 0] },
  { name: 'spine2', parent: 'spine1', head: [0.55, 0.1, 0] },
  { name: 'neck1', parent: 'spine2', head: [0.85, 0.38, 0] },
  { name: 'neck2', parent: 'neck1', head: [1.15, 0.58, 0] },
  { name: 'head', parent: 'neck2', head: [1.54, 0.67, 0], tip: [2.26, 0.57, 0] },

  { name: 'tail1', parent: 'root', head: [-0.75, 0.0, 0] },
  { name: 'tail2', parent: 'tail1', head: [-1.25, 0.02, 0] },
  { name: 'tail3', parent: 'tail2', head: [-1.85, 0.08, 0] },
  { name: 'tail4', parent: 'tail3', head: [-2.4, 0.16, 0] },
  { name: 'tail5', parent: 'tail4', head: [-2.9, 0.28, 0], tip: [-3.34, 0.45, 0] },

  { name: 'thighL', parent: 'root', head: [-0.46, -0.28, 0.37] },
  { name: 'shinL', parent: 'thighL', head: [-0.34, -0.92, 0.37] },
  { name: 'footL', parent: 'shinL', head: [-0.2, -1.36, 0.37], tip: [0.2, -1.42, 0.37] },
  { name: 'thighR', parent: 'root', head: [-0.46, -0.28, -0.37] },
  { name: 'shinR', parent: 'thighR', head: [-0.34, -0.92, -0.37] },
  { name: 'footR', parent: 'shinR', head: [-0.2, -1.36, -0.37], tip: [0.2, -1.42, -0.37] },

  { name: 'armL', parent: 'spine2', head: [0.8, -0.06, 0.3], tip: [1.1, -0.36, 0.3] },
  { name: 'armR', parent: 'spine2', head: [0.8, -0.06, -0.3], tip: [1.1, -0.36, -0.3] },
]

/* -------------------------------------------------------------------------- */
/* Turtle                                                                     */
/* -------------------------------------------------------------------------- */

/** Facing +x: domed carapace with a marginal rim, flat plastron, paddle flippers. */
const TURTLE_PARTS: Part[] = [
  // --- Shell: domed carapace, keel ridge, flared marginal rim, flat plastron -
  blob([0, 0.06, 0], [0.95, 0.44, 0.78]),
  blob([0, 0.24, 0], [0.62, 0.32, 0.5]),
  tube(
    [
      [0.5, 0.4, 0],
      [0.0, 0.48, 0],
      [-0.5, 0.4, 0],
    ],
    [0.1, 0.14, 0.09],
  ), // keel
  blob([0, -0.02, 0], [1.02, 0.19, 0.86]), // marginal rim
  blob([0, -0.15, 0], [0.86, 0.15, 0.7]), // plastron
  // Groove separating carapace from rim — occlusion turns it into a real seam.
  cut([0, -0.03, 0], [1.16, 0.035, 0.99]),

  // --- Neck and head ---------------------------------------------------------
  tube(
    [
      [0.78, -0.05, 0],
      [1.0, -0.01, 0],
      [1.18, 0.02, 0],
    ],
    [0.2, 0.18, 0.17],
  ),
  blob([0.86, -0.04, 0], [0.16, 0.15, 0.19]), // neck fold
  blob([1.33, 0.03, 0], [0.26, 0.22, 0.22]), // head
  tube(
    [
      [1.4, 0.0, 0],
      [1.54, -0.02, 0],
      [1.66, -0.04, 0],
    ],
    [0.19, 0.15, 0.1],
  ), // beak
  ...mirrored(cut([1.36, 0.09, 0.18], [0.075, 0.065, 0.06])), // eye sockets
  cut([1.6, -0.055, 0], [0.16, 0.022, 0.11]), // beak line

  // --- Flippers: broad, thin, swept back like a sea turtle's ----------------
  ...mirrored(blob([0.52, -0.06, 0.94], [0.5, 0.14, 0.32], 0.5)),
  ...mirrored(blob([0.78, -0.07, 1.16], [0.26, 0.09, 0.2], 0.75)), // tapered tip
  ...mirrored(blob([-0.64, -0.08, 0.82], [0.4, 0.12, 0.24], -0.55)),

  // --- Tail ------------------------------------------------------------------
  tube(
    [
      [-0.98, -0.05, 0],
      [-1.16, -0.02, 0],
      [-1.32, 0.01, 0],
    ],
    [0.14, 0.1, 0.055],
  ),
]

const TURTLE_BONES: BoneSpec[] = [
  { name: 'shell', parent: null, head: [0, 0, 0], tip: [-0.5, 0, 0] },
  { name: 'neck', parent: 'shell', head: [0.82, -0.04, 0] },
  { name: 'head', parent: 'neck', head: [1.28, 0.02, 0], tip: [1.68, -0.04, 0] },
  { name: 'flipperFL', parent: 'shell', head: [0.36, -0.05, 0.6], tip: [0.72, -0.08, 1.2] },
  { name: 'flipperFR', parent: 'shell', head: [0.36, -0.05, -0.6], tip: [0.72, -0.08, -1.2] },
  { name: 'flipperRL', parent: 'shell', head: [-0.46, -0.06, 0.54], tip: [-0.8, -0.1, 1.04] },
  { name: 'flipperRR', parent: 'shell', head: [-0.46, -0.06, -0.54], tip: [-0.8, -0.1, -1.04] },
  { name: 'tail', parent: 'shell', head: [-0.96, -0.04, 0], tip: [-1.34, 0.02, 0] },
]

/** Generates one creature. Pure computation — safe to call from a worker. */
export function createCreature(kind: CreatureKind, detail: CreatureDetail): CreaturePayload {
  return kind === 'dino'
    ? build(DINOSAUR_PARTS, DINOSAUR_BONES, detail)
    : build(TURTLE_PARTS, TURTLE_BONES, detail)
}
