import { BufferAttribute, BufferGeometry, CatmullRomCurve3, SphereGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Procedural creature sculptures for the hero — no external model files, so
 * nothing to download, license or cache-bust.
 *
 * Both shapes are Dilshodjon's own brand symbols: the tyrannosaur comes from the
 * handle "To-Rex", the turtle from his GitHub avatar. Each creature is assembled
 * from two primitives — ellipsoids for body mass and smoothly tapering tubes for
 * tails, necks and limbs — then merged into a single BufferGeometry, so a whole
 * creature costs one draw call.
 *
 * Geometry is emitted centred on the origin and normalised so its longest axis
 * measures exactly 1 unit — callers scale to taste.
 */

export type CreatureDetail = 'low' | 'medium' | 'high'

/** Sphere segments and tube resolution per quality tier. */
const RES: Record<CreatureDetail, { sphere: [number, number]; radial: number; tubular: number }> = {
  low: { sphere: [16, 10], radial: 10, tubular: 18 },
  medium: { sphere: [22, 14], radial: 14, tubular: 26 },
  high: { sphere: [30, 18], radial: 18, tubular: 38 },
}

type Vec3 = [number, number, number]

/** A body mass: a unit sphere scaled, optionally yawed, then moved into place. */
interface Blob {
  kind: 'blob'
  at: Vec3
  /** Radii along x / y / z. */
  size: Vec3
  /** Yaw in radians, applied before positioning. */
  yaw?: number
}

/** A limb, tail or muzzle: a tube swept along a curve with a per-point radius. */
interface Tube {
  kind: 'tube'
  /** Spine of the tube, in order. */
  path: Vec3[]
  /** Radius at each path point; interpolated in between. */
  radii: number[]
}

type Part = Blob | Tube

/** Mirrors a part across the z axis, for limbs that come in pairs. */
function mirrored(part: Part): Part[] {
  if (part.kind === 'blob') {
    const [x, y, z] = part.at
    return [part, { ...part, at: [x, y, -z], yaw: part.yaw === undefined ? undefined : -part.yaw }]
  }
  return [part, { ...part, path: part.path.map(([x, y, z]) => [x, y, -z] as Vec3) }]
}

function blobGeometry(part: Blob, detail: CreatureDetail): BufferGeometry {
  const [w, h] = RES[detail].sphere
  const g = new SphereGeometry(1, w, h)
  g.scale(part.size[0], part.size[1], part.size[2])
  if (part.yaw) g.rotateY(part.yaw)
  g.translate(part.at[0], part.at[1], part.at[2])
  return g
}

/**
 * Sweeps a circular cross-section of varying radius along a Catmull-Rom spline.
 * three's TubeGeometry only supports a constant radius, hence this variant — it
 * is what turns the tail into a smooth taper instead of a string of beads.
 *
 * Ends are left open: every tube either tapers to ~zero or is buried inside a
 * body mass, so no caps are needed.
 */
function tubeGeometry(part: Tube, detail: CreatureDetail): BufferGeometry {
  const { radial, tubular } = RES[detail]
  const points = part.path.map(([x, y, z]) => new Vector3(x, y, z))
  // A two-point spline has no curvature to derive frames from; add a midpoint.
  if (points.length === 2) {
    const a = points[0]!
    const b = points[1]!
    points.splice(1, 0, a.clone().lerp(b, 0.5))
  }
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5)
  const frames = curve.computeFrenetFrames(tubular, false)

  const radiusAt = (t: number) => {
    const x = t * (part.radii.length - 1)
    const i = Math.min(part.radii.length - 2, Math.floor(x))
    const f = x - i
    return (part.radii[i] ?? 0) * (1 - f) + (part.radii[i + 1] ?? 0) * f
  }

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular
    const centre = curve.getPointAt(t)
    const N = frames.normals[i]!
    const B = frames.binormals[i]!
    const r = radiusAt(t)
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2
      const sin = Math.sin(v)
      const cos = -Math.cos(v)
      const nx = cos * N.x + sin * B.x
      const ny = cos * N.y + sin * B.y
      const nz = cos * N.z + sin * B.z
      normals.push(nx, ny, nz)
      positions.push(centre.x + r * nx, centre.y + r * ny, centre.z + r * nz)
      uvs.push(t, j / radial)
    }
  }

  const stride = radial + 1
  for (let i = 1; i <= tubular; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = stride * (i - 1) + (j - 1)
      const b = stride * i + (j - 1)
      const c = stride * i + j
      const d = stride * (i - 1) + j
      indices.push(a, b, d, b, c, d)
    }
  }

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  g.setIndex(indices)
  return g
}

function build(parts: Part[], detail: CreatureDetail): BufferGeometry {
  const pieces = parts.map((p) => (p.kind === 'blob' ? blobGeometry(p, detail) : tubeGeometry(p, detail)))
  const merged = mergeGeometries(pieces, false)
  pieces.forEach((g) => g.dispose())
  if (!merged) throw new Error('creature geometry merge failed')

  // Centre on the origin, then normalise the longest axis to 1 unit.
  merged.computeBoundingBox()
  const box = merged.boundingBox!
  const centre = box.getCenter(new Vector3())
  merged.translate(-centre.x, -centre.y, -centre.z)
  const span = box.getSize(new Vector3())
  const longest = Math.max(span.x, span.y, span.z)
  if (longest > 0) merged.scale(1 / longest, 1 / longest, 1 / longest)
  merged.computeBoundingSphere()
  return merged
}

const blob = (at: Vec3, size: Vec3, yaw?: number): Blob => ({ kind: 'blob', at, size, yaw })
const tube = (path: Vec3[], radii: number[]): Tube => ({ kind: 'tube', path, radii })

/**
 * Tyrannosaurus, facing +x: heavy head carried forward, horizontal spine, a long
 * tail sweeping back and lifting at the tip to counterbalance, thick drumstick
 * legs and the famously small arms.
 */
const DINOSAUR: Part[] = [
  // Body mass — three heavily overlapping ellipsoids read as one smooth trunk.
  blob([0, 0, 0], [0.95, 0.66, 0.58]),
  blob([0.62, 0.1, 0], [0.6, 0.56, 0.52]),
  blob([-0.6, -0.02, 0], [0.62, 0.56, 0.52]),

  // Tail
  tube(
    [
      [-0.45, 0.0, 0],
      [-1.2, 0.02, 0],
      [-1.9, 0.08, 0],
      [-2.5, 0.18, 0],
      [-2.95, 0.3, 0],
      [-3.3, 0.44, 0],
    ],
    [0.44, 0.33, 0.23, 0.14, 0.07, 0.012],
  ),

  // Neck
  tube(
    [
      [0.55, 0.18, 0],
      [0.95, 0.44, 0],
      [1.28, 0.62, 0],
    ],
    [0.44, 0.31, 0.25],
  ),

  // Skull, muzzle and jaw
  blob([1.5, 0.7, 0], [0.36, 0.28, 0.25]),
  tube(
    [
      [1.52, 0.68, 0],
      [1.86, 0.63, 0],
      [2.16, 0.57, 0],
    ],
    [0.26, 0.17, 0.075],
  ),
  blob([2.16, 0.57, 0], [0.078, 0.078, 0.078]), // muzzle tip cap
  blob([1.82, 0.5, 0], [0.28, 0.085, 0.16]),

  // Legs
  ...mirrored(blob([-0.44, -0.22, 0.3], [0.38, 0.5, 0.32])),
  ...mirrored(
    tube(
      [
        [-0.4, -0.5, 0.3],
        [-0.3, -1.0, 0.3],
        [-0.2, -1.32, 0.3],
      ],
      [0.26, 0.15, 0.09],
    ),
  ),
  ...mirrored(blob([-0.02, -1.4, 0.3], [0.31, 0.085, 0.19])),

  // Arms
  ...mirrored(
    tube(
      [
        [0.8, -0.04, 0.3],
        [0.95, -0.18, 0.32],
        [1.04, -0.32, 0.3],
      ],
      [0.12, 0.085, 0.05],
    ),
  ),
  ...mirrored(blob([1.04, -0.32, 0.3], [0.052, 0.052, 0.052])), // hand caps
]

/** Turtle, facing +x: domed carapace, flat plastron, splayed flippers. */
const TURTLE_BODY: Part[] = [
  blob([0, 0.08, 0], [1.0, 0.5, 0.85]), // carapace
  blob([0, 0.28, 0], [0.62, 0.34, 0.52]), // dome ridge
  blob([0, -0.09, 0], [0.93, 0.17, 0.77]), // plastron

  // Neck, head and snout
  tube(
    [
      [0.68, -0.03, 0],
      [0.88, 0.0, 0],
      [1.04, 0.02, 0],
    ],
    [0.21, 0.2, 0.19],
  ),
  blob([1.15, 0.03, 0], [0.24, 0.2, 0.2]),
  tube(
    [
      [1.2, 0.0, 0],
      [1.34, -0.02, 0],
      [1.46, -0.03, 0],
    ],
    [0.18, 0.13, 0.07],
  ),
  blob([1.46, -0.03, 0], [0.072, 0.072, 0.072]), // snout tip cap

  // Flippers
  ...mirrored(blob([0.55, -0.1, 0.66], [0.38, 0.09, 0.2], 0.5)),
  ...mirrored(blob([-0.58, -0.1, 0.6], [0.32, 0.085, 0.17], -0.55)),

  // Tail
  tube(
    [
      [-0.9, -0.03, 0],
      [-1.02, -0.02, 0],
      [-1.12, 0.0, 0],
    ],
    [0.12, 0.08, 0.03],
  ),
]

export function createDinosaurGeometry(detail: CreatureDetail): BufferGeometry {
  return build(DINOSAUR, detail)
}

export function createTurtleGeometry(detail: CreatureDetail): BufferGeometry {
  return build(TURTLE_BODY, detail)
}
