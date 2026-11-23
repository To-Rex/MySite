/**
 * A tiny signed-distance-field mesher.
 *
 * Overlapping ellipsoids merged as separate shells leave visible intersection
 * creases — a body ends up reading as sausage links. Blending the same shapes as
 * an SDF and extracting one continuous surface removes those creases entirely
 * and gives real anatomical fillets where limbs meet the torso.
 *
 * Surface nets is used rather than marching cubes: it needs no 256-entry lookup
 * tables, produces a smooth manifold, and vertex normals come from the field
 * gradient, so shading is continuous everywhere.
 *
 * This module deliberately has no three.js dependency so it can run inside a
 * Web Worker without pulling the whole renderer in with it.
 */

export type Vec3 = [number, number, number]

/** An axis-aligned ellipsoid; `yaw`/`pitch` rotate it about its own centre. */
export interface SdfEllipsoid {
  kind: 'ellipsoid'
  at: Vec3
  radii: Vec3
  yaw?: number
  pitch?: number
  /** Carve this shape out of the union instead of adding to it. */
  negative?: boolean
  /** See `SdfCone.group`. */
  group?: number
  /** See `SdfCone.blend`. */
  blend?: number
}

/** A capsule whose radius varies linearly from `a` to `b`. */
export interface SdfCone {
  kind: 'cone'
  a: Vec3
  b: Vec3
  ra: number
  rb: number
  /** Carve this shape out of the union instead of adding to it. */
  negative?: boolean
  /**
   * Shapes that share a group (and follow one another in the list) are one
   * shape: they are joined with a plain minimum, and only the result is
   * blended into the rest. Without it, the capsules a tube is cut into are
   * each filleted to the next, and a smooth union of two overlapping capsules
   * bulges — a limb comes out as a string of beads. Left out, every shape is
   * its own group, which is what the creatures have always been.
   */
  group?: number
  /**
   * The fillet this shape is joined to what came before it with (or, for a
   * carved one, the rounding of its lip), instead of the mesh's own. A body
   * wants a fillet of a centimetre and a half where a thigh meets a hip; the
   * same fillet round a nostril is the end of the nostril.
   */
  blend?: number
}

export type SdfPrimitive = SdfEllipsoid | SdfCone

interface PreparedEllipsoid {
  kind: 0
  cx: number
  cy: number
  cz: number
  rx: number
  ry: number
  rz: number
  /** Inverse rotation, applied to the sample point before the ellipsoid test. */
  cosY: number
  sinY: number
  cosP: number
  sinP: number
  rotated: boolean
  /** Bounding radius, and the half-sides of the box it fits in, for spatial binning. */
  bound: number
  hx: number
  hy: number
  hz: number
  negative: boolean
  group: number
  /** The shape's own fillet, or -1 for the mesh's. */
  blend: number
}

interface PreparedCone {
  kind: 1
  ax: number
  ay: number
  az: number
  bax: number
  bay: number
  baz: number
  invLenSq: number
  ra: number
  rb: number
  cx: number
  cy: number
  cz: number
  bound: number
  hx: number
  hy: number
  hz: number
  negative: boolean
  group: number
  blend: number
}

type Prepared = PreparedEllipsoid | PreparedCone

function prepare(prim: SdfPrimitive): Prepared {
  if (prim.kind === 'ellipsoid') {
    const [cx, cy, cz] = prim.at
    const [rx, ry, rz] = prim.radii
    const yaw = prim.yaw ?? 0
    const pitch = prim.pitch ?? 0
    const turned = yaw !== 0 || pitch !== 0
    const bound = Math.max(rx, ry, rz)
    return {
      kind: 0,
      cx,
      cy,
      cz,
      rx,
      ry,
      rz,
      cosY: Math.cos(-yaw),
      sinY: Math.sin(-yaw),
      cosP: Math.cos(-pitch),
      sinP: Math.sin(-pitch),
      rotated: turned,
      bound,
      // Turned, it is somewhere inside the ball of its longest radius; square
      // to the axes, it is exactly as wide as it says.
      hx: turned ? bound : rx,
      hy: turned ? bound : ry,
      hz: turned ? bound : rz,
      negative: prim.negative === true,
      group: prim.group ?? -1,
      blend: prim.blend ?? -1,
    }
  }
  const [ax, ay, az] = prim.a
  const [bx, by, bz] = prim.b
  const bax = bx - ax
  const bay = by - ay
  const baz = bz - az
  const lenSq = bax * bax + bay * bay + baz * baz
  const thick = Math.max(prim.ra, prim.rb)
  return {
    kind: 1,
    ax,
    ay,
    az,
    bax,
    bay,
    baz,
    invLenSq: lenSq > 1e-9 ? 1 / lenSq : 0,
    ra: prim.ra,
    rb: prim.rb,
    cx: (ax + bx) / 2,
    cy: (ay + by) / 2,
    cz: (az + bz) / 2,
    bound: Math.sqrt(lenSq) / 2 + thick,
    hx: Math.abs(bax) / 2 + thick,
    hy: Math.abs(bay) / 2 + thick,
    hz: Math.abs(baz) / 2 + thick,
    negative: prim.negative === true,
    group: prim.group ?? -1,
    blend: prim.blend ?? -1,
  }
}

function distance(p: Prepared, x: number, y: number, z: number): number {
  if (p.kind === 0) {
    let dx = x - p.cx
    let dy = y - p.cy
    let dz = z - p.cz
    if (p.rotated) {
      const nx = dx * p.cosY + dz * p.sinY
      const nz = -dx * p.sinY + dz * p.cosY
      dx = nx
      dz = nz
      const px = dx * p.cosP - dy * p.sinP
      const py = dx * p.sinP + dy * p.cosP
      dx = px
      dy = py
    }
    const kx = dx / p.rx
    const ky = dy / p.ry
    const kz = dz / p.rz
    const k = Math.sqrt(kx * kx + ky * ky + kz * kz)
    // Standard ellipsoid approximation: exact on the axes, close enough between.
    return (k - 1) * Math.min(p.rx, p.ry, p.rz)
  }
  const apx = x - p.ax
  const apy = y - p.ay
  const apz = z - p.az
  let t = (apx * p.bax + apy * p.bay + apz * p.baz) * p.invLenSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = apx - p.bax * t
  const dy = apy - p.bay * t
  const dz = apz - p.baz * t
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (p.ra + (p.rb - p.ra) * t)
}

/** Polynomial smooth minimum — the fillet radius where two shapes meet. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/** Smooth maximum, used to carve a shape out with a rounded lip. */
function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k)
}

/**
 * Distance to one shape, for comparing shapes with each other rather than for
 * meshing. The mesher's ellipsoid distance is scaled by the *smallest* radius,
 * which is right at the surface and far too small away from it for a flat
 * shape — a thin slab of muscle would report itself nearer to every vertex
 * within reach than the round thing actually under that vertex. This is the
 * first-order estimate instead (the field over the length of its gradient),
 * which is good everywhere outside.
 */
function fairDistance(p: Prepared, x: number, y: number, z: number): number {
  if (p.kind !== 0) return distance(p, x, y, z)
  let dx = x - p.cx
  let dy = y - p.cy
  let dz = z - p.cz
  if (p.rotated) {
    const nx = dx * p.cosY + dz * p.sinY
    const nz = -dx * p.sinY + dz * p.cosY
    dx = nx
    dz = nz
    const px = dx * p.cosP - dy * p.sinP
    const py = dx * p.sinP + dy * p.cosP
    dx = px
    dy = py
  }
  const k0 = Math.hypot(dx / p.rx, dy / p.ry, dz / p.rz)
  const k1 = Math.hypot(dx / (p.rx * p.rx), dy / (p.ry * p.ry), dz / (p.rz * p.rz))
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(p.rx, p.ry, p.rz)
}

/**
 * The plain distance to the nearest of a set of shapes, with no blending and no
 * carving. Not for meshing: for asking, of a vertex already on a surface, which
 * of several groups of shapes it belongs to — hide or hair, skin or cloth.
 */
export function nearestField(primitives: SdfPrimitive[]): (x: number, y: number, z: number) => number {
  const prepared = primitives.filter((prim) => !prim.negative).map(prepare)
  return (x, y, z) => {
    let d = Infinity
    for (let n = 0; n < prepared.length; n++) {
      const dn = fairDistance(prepared[n]!, x, y, z)
      if (dn < d) d = dn
    }
    return d
  }
}

/**
 * `nearestField` for several sets of shapes at once, and only as far as
 * `reach`: writes into `out` the distance from a point to the nearest shape of
 * each set, or Infinity for a set with nothing that near. For points already
 * on a surface, which is what it is asked about, everything further off than a
 * few centimetres is beside the point — and looking no further is what makes
 * this cost a tenth of asking every set about every shape.
 */
export function nearestFields(sets: SdfPrimitive[][], reach: number): (x: number, y: number, z: number, out: Float64Array) => void {
  const prepared: Prepared[] = []
  const setOf: number[] = []
  sets.forEach((set, index) => {
    for (const prim of set) {
      if (prim.negative) continue
      prepared.push(prepare(prim))
      setOf.push(index)
    }
  })
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const p of prepared) {
    minX = Math.min(minX, p.cx - p.hx - reach)
    minY = Math.min(minY, p.cy - p.hy - reach)
    minZ = Math.min(minZ, p.cz - p.hz - reach)
    maxX = Math.max(maxX, p.cx + p.hx + reach)
    maxY = Math.max(maxY, p.cy + p.hy + reach)
    maxZ = Math.max(maxZ, p.cz + p.hz + reach)
  }
  const size = reach * 1.5
  const bx = Math.max(1, Math.ceil((maxX - minX) / size))
  const by = Math.max(1, Math.ceil((maxY - minY) / size))
  const bz = Math.max(1, Math.ceil((maxZ - minZ) / size))
  const bins: number[][] = Array.from({ length: bx * by * bz }, () => [])
  prepared.forEach((p, i) => {
    const i0 = Math.max(0, Math.floor((p.cx - p.hx - reach - minX) / size))
    const i1 = Math.min(bx - 1, Math.floor((p.cx + p.hx + reach - minX) / size))
    const j0 = Math.max(0, Math.floor((p.cy - p.hy - reach - minY) / size))
    const j1 = Math.min(by - 1, Math.floor((p.cy + p.hy + reach - minY) / size))
    const k0 = Math.max(0, Math.floor((p.cz - p.hz - reach - minZ) / size))
    const k1 = Math.min(bz - 1, Math.floor((p.cz + p.hz + reach - minZ) / size))
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i2 = i0; i2 <= i1; i2++) bins[i2 + bx * (j + by * k)]!.push(i)
  })
  return (x, y, z, out) => {
    out.fill(Infinity)
    const i = Math.floor((x - minX) / size)
    const j = Math.floor((y - minY) / size)
    const k = Math.floor((z - minZ) / size)
    if (i < 0 || j < 0 || k < 0 || i >= bx || j >= by || k >= bz) return
    const list = bins[i + bx * (j + by * k)]!
    for (let n = 0; n < list.length; n++) {
      const index = list[n]!
      const d = fairDistance(prepared[index]!, x, y, z)
      const set = setOf[index]!
      // A bin holds a little more than what is within reach: not reported, so
      // that the answer does not depend on where the bins happen to fall.
      if (d <= reach && d < out[set]!) out[set] = d
    }
  }
}

export interface MeshOptions {
  /** Grid spacing in world units — the dominant quality/cost knob. */
  spacing: number
  /** Blend radius where primitives fuse. Keep small so limbs stay defined. */
  blend: number
  /** Rounding on carved details. Smaller than `blend` keeps sockets crisp. */
  carve?: number
  /**
   * Take the surface from the field itself rather than from a grid of samples
   * of it. Surface nets puts each vertex at the middle of where the surface
   * crosses its cell, and the normals below are differences across two cells:
   * both are right for a hide, whose smallest feature is a toe, and both
   * round off anything a cell or two across — an eyelid, a knuckle, the edge
   * of a lip. With this, every vertex is moved onto the field's own zero and
   * given the field's own gradient there, so a feature is as sharp as it was
   * written, down to the size of a triangle.
   *
   * It also samples the grid only near the surface, which is what pays for it.
   */
  exact?: boolean
  /**
   * How many times to halve the triangles round a point: 0 leaves them as the
   * grid made them, 1 splits each into four, 2 into sixteen. A face needs a
   * mesh four times as fine as a thigh does, and a grid that fine over a whole
   * body is sixty-four times the work for the sake of a twentieth of it. Only
   * with `exact`, which is what puts the new vertices on the surface.
   */
  refine?: (x: number, y: number, z: number) => number
}

/**
 * Extracts a single watertight surface from the union of `primitives`.
 *
 * Cost is dominated by field evaluation, so primitives are binned spatially and
 * each sample only tests the ones that can possibly influence it.
 */
export interface SurfaceMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  /** Baked ambient occlusion, 0 = fully occluded crease, 1 = fully open. */
  ao: Float32Array
}

interface Bounds {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

type Field = (x: number, y: number, z: number) => number

/**
 * The blended field, as a function of a point. Shapes are binned, and a point
 * is tested against the ones within `reach` of its bin: beyond that a shape
 * cannot win the smooth minimum, so the answer is right wherever the surface
 * is nearer than `reach` and merely positive where nothing is.
 */
function sampler(prepared: Prepared[], b: Bounds, binSize: number, reach: number, blend: number, carve: number, far: number): Field {
  const bx = Math.max(1, Math.ceil((b.maxX - b.minX) / binSize))
  const by = Math.max(1, Math.ceil((b.maxY - b.minY) / binSize))
  const bz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / binSize))
  // Most bins are empty air, and a fine grid of them is a great many: a bin
  // is only made when something is put in it.
  const bins: (number[] | undefined)[] = new Array(bx * by * bz)
  prepared.forEach((p, i) => {
    const i0 = Math.max(0, Math.floor((p.cx - p.hx - reach - b.minX) / binSize))
    const i1 = Math.min(bx - 1, Math.floor((p.cx + p.hx + reach - b.minX) / binSize))
    const j0 = Math.max(0, Math.floor((p.cy - p.hy - reach - b.minY) / binSize))
    const j1 = Math.min(by - 1, Math.floor((p.cy + p.hy + reach - b.minY) / binSize))
    const k0 = Math.max(0, Math.floor((p.cz - p.hz - reach - b.minZ) / binSize))
    const k1 = Math.min(bz - 1, Math.floor((p.cz + p.hz + reach - b.minZ) / binSize))
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i2 = i0; i2 <= i1; i2++) {
          const at = i2 + bx * (j + by * k)
          const bin = bins[at]
          if (bin) bin.push(i)
          else bins[at] = [i]
        }
  })

  return (x, y, z) => {
    const i = Math.min(bx - 1, Math.max(0, Math.floor((x - b.minX) / binSize)))
    const j = Math.min(by - 1, Math.max(0, Math.floor((y - b.minY) / binSize)))
    const k = Math.min(bz - 1, Math.max(0, Math.floor((z - b.minZ) / binSize)))
    const list = bins[i + bx * (j + by * k)]
    if (!list) return far
    let d = Infinity
    // The shape being gathered: one primitive, or a run that shares a group.
    let run = Infinity
    let group = -1
    let fillet = blend
    for (let n = 0; n < list.length; n++) {
      const prim = prepared[list[n]!]!
      if (prim.negative) continue
      const dn = distance(prim, x, y, z)
      if (prim.group >= 0 && prim.group === group) {
        if (dn < run) run = dn
        continue
      }
      if (run !== Infinity) d = d === Infinity ? run : smin(d, run, fillet)
      run = dn
      group = prim.group
      fillet = prim.blend > 0 ? prim.blend : blend
    }
    if (run !== Infinity) d = d === Infinity ? run : smin(d, run, fillet)
    if (d === Infinity) return far
    // Carving happens after the union so a socket cuts the finished surface.
    for (let n = 0; n < list.length; n++) {
      const prim = prepared[list[n]!]!
      if (!prim.negative) continue
      d = smax(d, -distance(prim, x, y, z), prim.blend > 0 ? prim.blend : carve)
    }
    return d
  }
}

export function meshSdf(primitives: SdfPrimitive[], { spacing, blend, carve = blend * 0.5, exact = false, refine }: MeshOptions): SurfaceMesh {
  const prepared = primitives.map(prepare)

  // Domain: the union's bounds plus room for the blend fillets and one cell.
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let widest = blend
  for (const p of prepared) {
    minX = Math.min(minX, p.cx - p.bound)
    minY = Math.min(minY, p.cy - p.bound)
    minZ = Math.min(minZ, p.cz - p.bound)
    maxX = Math.max(maxX, p.cx + p.bound)
    maxY = Math.max(maxY, p.cy + p.bound)
    maxZ = Math.max(maxZ, p.cz + p.bound)
    if (p.blend > widest) widest = p.blend
  }
  const pad = widest + spacing * 2
  minX -= pad
  minY -= pad
  minZ -= pad
  maxX += pad
  maxY += pad
  maxZ += pad
  const bounds: Bounds = { minX, minY, minZ, maxX, maxY, maxZ }

  const nx = Math.ceil((maxX - minX) / spacing)
  const ny = Math.ceil((maxY - minY) / spacing)
  const nz = Math.ceil((maxZ - minZ) / spacing)

  // Spatial bins so each sample only evaluates nearby primitives. A primitive
  // influences a sample up to `reach` away — beyond that its contribution can
  // never win the smooth-minimum.
  const binSize = Math.max(spacing * 6, 0.25)
  const FAR = spacing * 4
  const sample = sampler(prepared, bounds, binSize, binSize + widest + spacing, blend, carve, FAR)
  // The same field with a shorter memory, for the exact work, all of which
  // happens within a few cells of the surface: small bins, each holding only
  // what is that close to it, and so several times cheaper to ask.
  const close = exact ? sampler(prepared, bounds, spacing * 3, widest + spacing * 4.5, blend, carve, FAR) : sample
  // And one for the baked occlusion, which looks a set distance out along the
  // normal whatever the mesh is like: bins a third the size, holding only what
  // is within that distance.
  const OCCLUSION_REACH = 0.175
  const around = exact ? sampler(prepared, bounds, 0.085, OCCLUSION_REACH + widest + 0.01, blend, carve, FAR) : sample
  // And a third for a point that is already all but on the surface, where
  // nothing further off than a fillet can matter: the shortest lists of all,
  // and most of the exact work is asked of this one.
  const touching = exact ? sampler(prepared, bounds, Math.max(widest, spacing), widest + spacing * 0.7, blend, carve, FAR) : sample
  /** For each vertex made by splitting an edge, the two it lies between. */
  const between: number[] = []
  let grown = 0

  // ---- Scalar field ----------------------------------------------------------
  const sx = nx + 1
  const sy = ny + 1
  const field = new Float32Array(sx * sy * (nz + 1))
  if (!exact) {
    for (let k = 0; k <= nz; k++) {
      const z = minZ + k * spacing
      for (let j = 0; j <= ny; j++) {
        const y = minY + j * spacing
        const rowBase = sx * (j + sy * k)
        for (let i = 0; i <= nx; i++) {
          field[rowBase + i] = sample(minX + i * spacing, y, z)
        }
      }
    }
  } else {
    // In blocks of three samples a side. The field changes by no more than
    // about one and a half times the distance moved, so a block whose middle
    // is further from the surface than that allows has no surface in it, and
    // all of it is given the middle's value: the right sign, which is all that
    // is asked of a sample nothing crosses beside.
    const BLOCK = 3
    const near = spacing * 2.6
    for (let k0 = 0; k0 <= nz; k0 += BLOCK) {
      const ck = Math.min(nz, k0 + 1)
      const k1 = Math.min(nz, k0 + BLOCK - 1)
      for (let j0 = 0; j0 <= ny; j0 += BLOCK) {
        const cj = Math.min(ny, j0 + 1)
        const j1 = Math.min(ny, j0 + BLOCK - 1)
        for (let i0 = 0; i0 <= nx; i0 += BLOCK) {
          const ci = Math.min(nx, i0 + 1)
          const i1 = Math.min(nx, i0 + BLOCK - 1)
          const middle = close(minX + ci * spacing, minY + cj * spacing, minZ + ck * spacing)
          const empty = Math.abs(middle) > near
          for (let k = k0; k <= k1; k++) {
            for (let j = j0; j <= j1; j++) {
              const rowBase = sx * (j + sy * k)
              for (let i = i0; i <= i1; i++) {
                field[rowBase + i] = empty || (i === ci && j === cj && k === ck) ? middle : close(minX + i * spacing, minY + j * spacing, minZ + k * spacing)
              }
            }
          }
        }
      }
    }
  }
  const fieldAt = (i: number, j: number, k: number) => field[i + sx * (j + sy * k)]!

  // ---- Surface nets: one vertex per cell that straddles the surface ----------
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1)
  const positions: number[] = []
  /** Grid cell each vertex came from, so normals can reuse the sampled field. */
  const cellOf: number[] = []
  const CORNER: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ]
  const EDGE: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ]
  const corners = new Float32Array(8)

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let negative = 0
        for (let c = 0; c < 8; c++) {
          const o = CORNER[c]!
          const v = fieldAt(i + o[0], j + o[1], k + o[2])
          corners[c] = v
          if (v < 0) negative++
        }
        if (negative === 0 || negative === 8) continue

        let ax = 0
        let ay = 0
        let az = 0
        let crossings = 0
        for (let e = 0; e < 12; e++) {
          const [c0, c1] = EDGE[e]!
          const v0 = corners[c0]!
          const v1 = corners[c1]!
          if (v0 < 0 === v1 < 0) continue
          const t = v0 / (v0 - v1)
          const o0 = CORNER[c0]!
          const o1 = CORNER[c1]!
          ax += o0[0] + (o1[0] - o0[0]) * t
          ay += o0[1] + (o1[1] - o0[1]) * t
          az += o0[2] + (o1[2] - o0[2]) * t
          crossings++
        }
        if (crossings === 0) continue

        cellVertex[i + nx * (j + ny * k)] = positions.length / 3
        positions.push(
          minX + (i + ax / crossings) * spacing,
          minY + (j + ay / crossings) * spacing,
          minZ + (k + az / crossings) * spacing,
        )
        cellOf.push(i, j, k)
      }
    }
  }

  // ---- Quads across every sign-changing grid edge ---------------------------
  let indices: number[] = []
  const cellAt = (i: number, j: number, k: number) => cellVertex[i + nx * (j + ny * k)]!
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) indices.push(a, d, c, a, c, b)
    else indices.push(a, b, c, a, c, d)
  }

  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const v = fieldAt(i, j, k)
        // +x edge — surrounded by the four cells sharing it.
        if (i < nx && j > 0 && k > 0) {
          const v2 = fieldAt(i + 1, j, k)
          if (v < 0 !== v2 < 0) {
            quad(
              cellAt(i, j - 1, k - 1),
              cellAt(i, j, k - 1),
              cellAt(i, j, k),
              cellAt(i, j - 1, k),
              v < 0,
            )
          }
        }
        // +y edge
        if (j < ny && i > 0 && k > 0) {
          const v2 = fieldAt(i, j + 1, k)
          if (v < 0 !== v2 < 0) {
            quad(
              cellAt(i - 1, j, k - 1),
              cellAt(i, j, k - 1),
              cellAt(i, j, k),
              cellAt(i - 1, j, k),
              v >= 0,
            )
          }
        }
        // +z edge
        if (k < nz && i > 0 && j > 0) {
          const v2 = fieldAt(i, j, k + 1)
          if (v < 0 !== v2 < 0) {
            quad(
              cellAt(i - 1, j - 1, k),
              cellAt(i, j - 1, k),
              cellAt(i, j, k),
              cellAt(i - 1, j, k),
              v < 0,
            )
          }
        }
      }
    }
  }
  let normals: Float32Array
  if (exact) {
    // ---- The field's own surface, and its own normals ------------------------
    const g: Vec3 = [0, 0, 0]
    const gradient = (of: Field, x: number, y: number, z: number, h: number) => {
      g[0] = (of(x + h, y, z) - of(x - h, y, z)) / (2 * h)
      g[1] = (of(x, y + h, z) - of(x, y - h, z)) / (2 * h)
      g[2] = (of(x, y, z + h) - of(x, y, z - h)) / (2 * h)
    }
    /** Two steps of Newton's method down the gradient, never further than a cell. */
    const settle = (of: Field, v: number, cell: number) => {
      let x = positions[v * 3]!
      let y = positions[v * 3 + 1]!
      let z = positions[v * 3 + 2]!
      gradient(of, x, y, z, cell * 0.3)
      for (let pass = 0; pass < 2; pass++) {
        const f = of(x, y, z)
        const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2]
        if (g2 < 1e-9) break
        let step = f / g2
        const moved = Math.abs(step) * Math.sqrt(g2)
        if (moved > cell * 0.9) step *= (cell * 0.9) / moved
        x -= g[0] * step
        y -= g[1] * step
        z -= g[2] * step
      }
      positions[v * 3] = x
      positions[v * 3 + 1] = y
      positions[v * 3 + 2] = z
    }
    // A vertex of the nets can be most of a cell from the surface; once it has
    // been put there, it and everything made from it is a hair's breadth off.
    for (let v = 0; v < positions.length / 3; v++) settle(close, v, spacing)

    // Halving the triangles where it is asked for. An edge is split when both
    // its ends want it, which is a fact about the edge and so the same for the
    // two triangles that share it: no cracks. A triangle then has all three of
    // its edges split, or one, or none.
    grown = positions.length / 3
    if (refine) {
      for (let level = 1; level <= 4; level++) {
        const count = positions.length / 3
        const want = new Uint8Array(count)
        let any = false
        for (let v = 0; v < count; v++) {
          if (refine(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!) >= level) {
            want[v] = 1
            any = true
          }
        }
        if (!any) break
        const made = new Map<number, number>()
        const mid = (a: number, b: number): number => {
          const key = a < b ? a * count + b : b * count + a
          let m = made.get(key)
          if (m === undefined) {
            m = positions.length / 3
            positions.push(
              (positions[a * 3]! + positions[b * 3]!) / 2,
              (positions[a * 3 + 1]! + positions[b * 3 + 1]!) / 2,
              (positions[a * 3 + 2]! + positions[b * 3 + 2]!) / 2,
            )
            made.set(key, m)
            between.push(a, b)
          }
          return m
        }
        const next: number[] = []
        for (let t = 0; t < indices.length; t += 3) {
          const a = indices[t]!
          const b = indices[t + 1]!
          const c = indices[t + 2]!
          const ab = want[a] === 1 && want[b] === 1
          const bc = want[b] === 1 && want[c] === 1
          const ca = want[c] === 1 && want[a] === 1
          if (ab && bc && ca) {
            const mab = mid(a, b)
            const mbc = mid(b, c)
            const mca = mid(c, a)
            next.push(a, mab, mca, mab, b, mbc, mca, mbc, c, mab, mbc, mca)
          } else if (ab) {
            const m = mid(a, b)
            next.push(a, m, c, m, b, c)
          } else if (bc) {
            const m = mid(b, c)
            next.push(b, m, a, m, c, a)
          } else if (ca) {
            const m = mid(c, a)
            next.push(c, m, b, m, a, b)
          } else {
            next.push(a, b, c)
          }
        }
        indices = next
        const cell = spacing / 2 ** level
        for (let v = count; v < positions.length / 3; v++) settle(touching, v, cell)
      }
    }
    const total = positions.length / 3
    normals = new Float32Array(total * 3)
    for (let v = 0; v < total; v++) {
      const x = positions[v * 3]!
      const y = positions[v * 3 + 1]!
      const z = positions[v * 3 + 2]!
      const level = refine ? Math.max(0, Math.min(4, Math.floor(refine(x, y, z)))) : 0
      gradient(touching, x, y, z, (spacing / 2 ** level) * 0.4)
      const len = Math.hypot(g[0], g[1], g[2]) || 1
      normals[v * 3] = g[0] / len
      normals[v * 3 + 1] = g[1] / len
      normals[v * 3 + 2] = g[2] / len
    }
  } else {
    // ---- Normals from the sampled field -------------------------------------
    // Re-evaluating the SDF six times per vertex dominated the cost; central
    // differences on the field we already have are far cheaper and just as smooth.
    const count = positions.length / 3
    normals = new Float32Array(count * 3)
    const clampI = (v: number) => (v < 0 ? 0 : v > nx ? nx : v)
    const clampJ = (v: number) => (v < 0 ? 0 : v > ny ? ny : v)
    const clampK = (v: number) => (v < 0 ? 0 : v > nz ? nz : v)
    for (let v = 0; v < count; v++) {
      const i = cellOf[v * 3]!
      const j = cellOf[v * 3 + 1]!
      const k = cellOf[v * 3 + 2]!
      // Trilinear blend of the gradient at the cell's eight corners.
      const fx = (positions[v * 3]! - minX) / spacing - i
      const fy = (positions[v * 3 + 1]! - minY) / spacing - j
      const fz = (positions[v * 3 + 2]! - minZ) / spacing - k
      let gx = 0
      let gy = 0
      let gz = 0
      for (let c = 0; c < 8; c++) {
        const oi = c & 1
        const oj = (c >> 1) & 1
        const ok = (c >> 2) & 1
        const w = (oi ? fx : 1 - fx) * (oj ? fy : 1 - fy) * (ok ? fz : 1 - fz)
        if (w === 0) continue
        const ci = i + oi
        const cj = j + oj
        const ck = k + ok
        gx += w * (fieldAt(clampI(ci + 1), cj, ck) - fieldAt(clampI(ci - 1), cj, ck))
        gy += w * (fieldAt(ci, clampJ(cj + 1), ck) - fieldAt(ci, clampJ(cj - 1), ck))
        gz += w * (fieldAt(ci, cj, clampK(ck + 1)) - fieldAt(ci, cj, clampK(ck - 1)))
      }
      const len = Math.hypot(gx, gy, gz) || 1
      normals[v * 3] = gx / len
      normals[v * 3 + 1] = gy / len
      normals[v * 3 + 2] = gz / len
    }
  }
  const vertexCount = positions.length / 3

  // ---- Baked ambient occlusion ---------------------------------------------
  // Classic SDF occlusion: march a few steps along the normal and compare how
  // much closer the surface stays than free space would allow.
  const ao = new Float32Array(vertexCount)
  // Where the mesh was refined, only the vertices it started with are asked:
  // occlusion changes over centimetres, and a vertex made by splitting an edge
  // is the mean of the edge's two ends closely enough.
  const asked = exact ? grown : vertexCount
  for (let v = 0; v < asked; v++) {
    const x = positions[v * 3]!
    const y = positions[v * 3 + 1]!
    const z = positions[v * 3 + 2]!
    const nx2 = normals[v * 3]!
    const ny2 = normals[v * 3 + 1]!
    const nz2 = normals[v * 3 + 2]!
    let occ = 0
    let weight = 1
    for (let step = 1; step <= 5; step++) {
      const h = 0.015 + 0.16 * (step / 5)
      const d = around(x + nx2 * h, y + ny2 * h, z + nz2 * h)
      occ += (h - d) * weight
      weight *= 0.82
    }
    const value = 1 - 2.4 * occ
    ao[v] = value < 0 ? 0 : value > 1 ? 1 : value
  }
  for (let v = asked; v < vertexCount; v++) {
    const at = (v - asked) * 2
    ao[v] = (ao[between[at]!]! + ao[between[at + 1]!]!) / 2
  }
  // ---- Winding safety net ---------------------------------------------------
  // Gradient normals always point outward, so if most triangles wind against
  // them the whole surface is inside-out; flipping once fixes every face.
  let agree = 0
  let disagree = 0
  for (let t = 0; t < indices.length && t < 3 * 400; t += 3) {
    const a = indices[t]!
    const b = indices[t + 1]!
    const c = indices[t + 2]!
    const ux = positions[b * 3]! - positions[a * 3]!
    const uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!
    const vx = positions[c * 3]! - positions[a * 3]!
    const vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!
    const gx = uy * vz - uz * vy
    const gy = uz * vx - ux * vz
    const gz = ux * vy - uy * vx
    const dot = gx * normals[a * 3]! + gy * normals[a * 3 + 1]! + gz * normals[a * 3 + 2]!
    if (dot > 0) agree++
    else if (dot < 0) disagree++
  }
  if (disagree > agree) {
    for (let t = 0; t < indices.length; t += 3) {
      const tmp = indices[t + 1]!
      indices[t + 1] = indices[t + 2]!
      indices[t + 2] = tmp
    }
  }

  return { positions: new Float32Array(positions), normals, indices: new Uint32Array(indices), ao }
}
