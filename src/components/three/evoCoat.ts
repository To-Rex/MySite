import type { Vec3 } from './sdf'

/**
 * Fur and hair for the figures of the long walk, as cards.
 *
 * A sculpt has no hair: it has a smooth mass the shape of a head of it, and
 * paint. That reads as clay at any distance, because what says "fur" is not a
 * colour but an edge — an outline that breaks up into locks, light coming
 * through the tips of them, a coat that hangs past the body it grows on.
 *
 * So the coat is grown, here, on the finished mesh: a few thousand narrow
 * strips, each rooted at a point on the surface, lying along the way the hair
 * is combed there and as long as the hair is there. A strip is not one hair
 * but a lock of them — the shader cuts it into strands (`evoMaterials.ts`) —
 * and it carries the bone weights of the skin under its root, so a coat goes
 * where its animal goes without a simulation.
 *
 * What comes out is one record per card, for the scene to draw as instances of
 * a single strip. They are shuffled, so that drawing the first half of them is
 * drawing half the coat evenly and not the left side of it.
 *
 * No three.js: this runs in the meshing worker with the sculpt it grows on.
 */

/** What grows at a place on a figure. Lengths are in metres. */
export interface Tuft {
  /** Cards to the square metre. */
  density: number
  length: number
  width: number
  /** The way it is combed there, before it is laid along the surface. Any length. */
  comb: Vec3
  /** How far it stands off the surface it grows from: 0 lies flat, 1 stands straight out. */
  lift: number
  /** How much its own weight bends it, 0 to 1. */
  droop: number
  /** Which of the look's two coats it is: 0 the hair of a head, 1 a pelt. */
  tint: number
  /** Where it sits between that coat's dark and its pale, 0 to 1. */
  tone: number
  /** Strands across one card. */
  strands: number
}

/**
 * Says what grows at a point: the point and the surface's normal there, in
 * metres and in the pose the figure was sculpted in, and how much of the
 * surface there is each of the eight regions. Nothing, for bare skin.
 */
export type Grower = (x: number, y: number, z: number, n: Vec3, regions: ArrayLike<number>) => Tuft | null

/** One record per card, laid out for instanced attributes. */
export interface Coat {
  count: number
  /** Where each is rooted, in the mesh's own units. */
  roots: Float32Array
  /** The surface's normal at the root. */
  normals: Float32Array
  /** The way it grows (a unit vector) and how long it is. */
  grow: Float32Array
  /** The way it is wide (a unit vector) and how wide. */
  across: Float32Array
  /** A random number, the sculpt's occlusion at the root, which coat, and how much it droops. */
  tone: Float32Array
  /** How far it stands off, how many strands, dark to pale, and how far the surface falls away under it. */
  shape: Float32Array
  skinIndices: Uint16Array
  skinWeights: Float32Array
}

export const COAT_BUFFERS = ['roots', 'normals', 'grow', 'across', 'tone', 'shape', 'skinIndices', 'skinWeights'] as const

/** A small seeded generator: the same coat every time, on every machine. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface CoatSource {
  /** The mesh as it was sculpted, before it is centred and scaled: `unit` of its units to a metre. */
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  ao: Float32Array
  /** Eight weights to a vertex. */
  regions: Float32Array
  unit: number
}

export interface CoatOptions {
  /** How much of the full coat to grow, and how much wider to make each card to cover for the rest. */
  share: number
  widen: number
  /** Bone weights for a list of points, the same way the mesh's own were worked out. */
  weigh: (points: Float32Array) => { skinIndices: Uint16Array; skinWeights: Float32Array }
  /** The mesh's units to the scene's: the centring and scaling the mesh itself is about to be given. */
  centre: Vec3
  scale: number
  /**
   * How far a point is from the figure, in the mesh's units: for finding how
   * much the surface curves away under a lock, so the lock can lie round it
   * and not stand off it like the brim of a hat.
   */
  field: (x: number, y: number, z: number) => number
}

export function growCoat(source: CoatSource, grower: Grower, options: CoatOptions): Coat {
  const { positions, normals, indices, ao, regions, unit } = source
  const random = mulberry(0x7a3d)
  const roots: number[] = []
  const rootNormals: number[] = []
  const grow: number[] = []
  const across: number[] = []
  const tone: number[] = []
  const shape: number[] = []
  const n: Vec3 = [0, 0, 0]
  const r = new Float32Array(8)
  const toMetres = 1 / unit

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!
    const b = indices[t + 1]!
    const c = indices[t + 2]!
    const ax = positions[a * 3]!
    const ay = positions[a * 3 + 1]!
    const az = positions[a * 3 + 2]!
    const ux = positions[b * 3]! - ax
    const uy = positions[b * 3 + 1]! - ay
    const uz = positions[b * 3 + 2]! - az
    const vx = positions[c * 3]! - ax
    const vy = positions[c * 3 + 1]! - ay
    const vz = positions[c * 3 + 2]! - az
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * toMetres * toMetres
    if (area <= 0) continue

    // What grows here is asked once, at the middle of the triangle: a triangle
    // is smaller than anything a coat changes over.
    for (let i = 0; i < 3; i++) n[i] = normals[a * 3 + i]! + normals[b * 3 + i]! + normals[c * 3 + i]!
    const nl = Math.hypot(n[0], n[1], n[2]) || 1
    n[0] /= nl
    n[1] /= nl
    n[2] /= nl
    for (let i = 0; i < 8; i++) r[i] = (regions[a * 8 + i]! + regions[b * 8 + i]! + regions[c * 8 + i]!) / 3
    const tuft = grower((ax + (ux + vx) / 3) * toMetres, (ay + (uy + vy) / 3) * toMetres, (az + (uz + vz) / 3) * toMetres, n, r)
    if (!tuft) continue

    const expected = area * tuft.density * options.share
    const cards = Math.floor(expected + random())
    for (let k = 0; k < cards; k++) {
      // A point in the triangle, evenly.
      let s = random()
      let w = random()
      if (s + w > 1) {
        s = 1 - s
        w = 1 - w
      }
      const px = ax + ux * s + vx * w
      const py = ay + uy * s + vy * w
      const pz = az + uz * s + vz * w
      const f = 1 - s - w
      let mx = normals[a * 3]! * f + normals[b * 3]! * s + normals[c * 3]! * w
      let my = normals[a * 3 + 1]! * f + normals[b * 3 + 1]! * s + normals[c * 3 + 1]! * w
      let mz = normals[a * 3 + 2]! * f + normals[b * 3 + 2]! * s + normals[c * 3 + 2]! * w
      const ml = Math.hypot(mx, my, mz) || 1
      mx /= ml
      my /= ml
      mz /= ml

      // Combed: the comb's direction with what points into or out of the skin
      // taken off it, so the lock lies along the surface...
      let cx = tuft.comb[0] + (random() - 0.5) * 0.5
      let cy = tuft.comb[1] + (random() - 0.5) * 0.3
      let cz = tuft.comb[2] + (random() - 0.5) * 0.5
      const into = cx * mx + cy * my + cz * mz
      cx -= mx * into
      cy -= my * into
      cz -= mz * into
      let cl = Math.hypot(cx, cy, cz)
      if (cl < 0.12) {
        // ...unless the comb goes straight into it, as on the crown of a head:
        // then any way along the surface will do, and gravity sorts it out.
        const turn = random() * Math.PI * 2
        const ex = Math.abs(my) < 0.9 ? 0 : 1
        const ey = Math.abs(my) < 0.9 ? 1 : 0
        // Two vectors across the normal.
        let tx = ey * mz
        let ty = -ex * mz
        let tz = ex * my - ey * mx
        const tl = Math.hypot(tx, ty, tz) || 1
        tx /= tl
        ty /= tl
        tz /= tl
        const bx = my * tz - mz * ty
        const by = mz * tx - mx * tz
        const bz = mx * ty - my * tx
        cx = tx * Math.cos(turn) + bx * Math.sin(turn)
        cy = ty * Math.cos(turn) + by * Math.sin(turn)
        cz = tz * Math.cos(turn) + bz * Math.sin(turn)
        cl = 1
      }
      cx /= cl
      cy /= cl
      cz /= cl
      // ...and then stood off it by as much as it is asked to.
      const stand = Math.min(1, Math.max(0, tuft.lift + (random() - 0.5) * 0.16)) * (Math.PI / 2)
      const dx = cx * Math.cos(stand) + mx * Math.sin(stand)
      const dy = cy * Math.cos(stand) + my * Math.sin(stand)
      const dz = cz * Math.cos(stand) + mz * Math.sin(stand)

      // Wide across the way it grows, flat to the surface, and then turned a
      // little about itself so that no two lie quite alike.
      let wx = dy * mz - dz * my
      let wy = dz * mx - dx * mz
      let wz = dx * my - dy * mx
      const wl = Math.hypot(wx, wy, wz) || 1
      wx /= wl
      wy /= wl
      wz /= wl
      const twist = (random() - 0.5) * 1.1
      const ox = dy * wz - dz * wy
      const oy = dz * wx - dx * wz
      const oz = dx * wy - dy * wx
      wx = wx * Math.cos(twist) + ox * Math.sin(twist)
      wy = wy * Math.cos(twist) + oy * Math.sin(twist)
      wz = wz * Math.cos(twist) + oz * Math.sin(twist)

      // How far the surface has dropped away from under where the lock would
      // end if it went straight: on the top of a back, a good part of its
      // length; down a flank, nothing.
      const length = tuft.length * (0.7 + 0.6 * random())
      const reach = length * unit
      const gap = options.field(px + cx * reach, py + cy * reach, pz + cz * reach)
      const sag = Math.min(1.2, Math.max(0, gap / reach))

      roots.push(px, py, pz)
      rootNormals.push(mx, my, mz)
      grow.push(dx, dy, dz, length)
      across.push(wx, wy, wz, tuft.width * options.widen * (0.8 + 0.4 * random()))
      tone.push(random(), ao[a]! * f + ao[b]! * s + ao[c]! * w, tuft.tint, tuft.droop)
      shape.push(tuft.lift, tuft.strands, Math.min(1, Math.max(0, tuft.tone + (random() - 0.5) * 0.3)), sag)
    }
  }

  // Shuffled, so any first part of the list is the whole coat thinned out.
  const count = roots.length / 3
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i++) order[i] = i
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = order[i]!
    order[i] = order[j]!
    order[j] = swap
  }
  const take = (from: number[], stride: number): Float32Array => {
    const out = new Float32Array(count * stride)
    for (let i = 0; i < count; i++) {
      const at = order[i]! * stride
      for (let k = 0; k < stride; k++) out[i * stride + k] = from[at + k]!
    }
    return out
  }
  const out: Coat = {
    count,
    roots: take(roots, 3),
    normals: take(rootNormals, 3),
    grow: take(grow, 4),
    across: take(across, 4),
    tone: take(tone, 4),
    shape: take(shape, 4),
    skinIndices: new Uint16Array(0),
    skinWeights: new Float32Array(0),
  }
  // Bone weights where the mesh's own were worked out: in the sculpt's space.
  const weights = options.weigh(out.roots)
  out.skinIndices = weights.skinIndices
  out.skinWeights = weights.skinWeights
  // And then into the mesh's own units, with the mesh.
  const metres = unit * options.scale
  for (let i = 0; i < count; i++) {
    out.roots[i * 3] = (out.roots[i * 3]! - options.centre[0]) * options.scale
    out.roots[i * 3 + 1] = (out.roots[i * 3 + 1]! - options.centre[1]) * options.scale
    out.roots[i * 3 + 2] = (out.roots[i * 3 + 2]! - options.centre[2]) * options.scale
    out.grow[i * 4 + 3] = out.grow[i * 4 + 3]! * metres
    out.across[i * 4 + 3] = out.across[i * 4 + 3]! * metres
  }
  return out
}
