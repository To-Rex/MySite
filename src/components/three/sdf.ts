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
  /** Bounding radius used for spatial binning. */
  bound: number
  negative: boolean
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
  negative: boolean
}

type Prepared = PreparedEllipsoid | PreparedCone

function prepare(prim: SdfPrimitive): Prepared {
  if (prim.kind === 'ellipsoid') {
    const [cx, cy, cz] = prim.at
    const [rx, ry, rz] = prim.radii
    const yaw = prim.yaw ?? 0
    const pitch = prim.pitch ?? 0
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
      rotated: yaw !== 0 || pitch !== 0,
      bound: Math.max(rx, ry, rz),
      negative: prim.negative === true,
    }
  }
  const [ax, ay, az] = prim.a
  const [bx, by, bz] = prim.b
  const bax = bx - ax
  const bay = by - ay
  const baz = bz - az
  const lenSq = bax * bax + bay * bay + baz * baz
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
    bound: Math.sqrt(lenSq) / 2 + Math.max(prim.ra, prim.rb),
    negative: prim.negative === true,
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

export interface MeshOptions {
  /** Grid spacing in world units — the dominant quality/cost knob. */
  spacing: number
  /** Blend radius where primitives fuse. Keep small so limbs stay defined. */
  blend: number
  /** Rounding on carved details. Smaller than `blend` keeps sockets crisp. */
  carve?: number
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

export function meshSdf(primitives: SdfPrimitive[], { spacing, blend, carve = blend * 0.5 }: MeshOptions): SurfaceMesh {
  const prepared = primitives.map(prepare)

  // Domain: the union's bounds plus room for the blend fillets and one cell.
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const p of prepared) {
    minX = Math.min(minX, p.cx - p.bound)
    minY = Math.min(minY, p.cy - p.bound)
    minZ = Math.min(minZ, p.cz - p.bound)
    maxX = Math.max(maxX, p.cx + p.bound)
    maxY = Math.max(maxY, p.cy + p.bound)
    maxZ = Math.max(maxZ, p.cz + p.bound)
  }
  const pad = blend + spacing * 2
  minX -= pad
  minY -= pad
  minZ -= pad
  maxX += pad
  maxY += pad
  maxZ += pad

  const nx = Math.ceil((maxX - minX) / spacing)
  const ny = Math.ceil((maxY - minY) / spacing)
  const nz = Math.ceil((maxZ - minZ) / spacing)

  // Spatial bins so each sample only evaluates nearby primitives.
  const binSize = Math.max(spacing * 6, 0.25)
  const bx = Math.max(1, Math.ceil((maxX - minX) / binSize))
  const by = Math.max(1, Math.ceil((maxY - minY) / binSize))
  const bz = Math.max(1, Math.ceil((maxZ - minZ) / binSize))
  const bins: number[][] = Array.from({ length: bx * by * bz }, () => [])
  // A primitive influences a sample up to `reach` away — beyond that its
  // contribution can never win the smooth-minimum.
  const reach = binSize + blend + spacing
  prepared.forEach((p, i) => {
    const i0 = Math.max(0, Math.floor((p.cx - p.bound - reach - minX) / binSize))
    const i1 = Math.min(bx - 1, Math.floor((p.cx + p.bound + reach - minX) / binSize))
    const j0 = Math.max(0, Math.floor((p.cy - p.bound - reach - minY) / binSize))
    const j1 = Math.min(by - 1, Math.floor((p.cy + p.bound + reach - minY) / binSize))
    const k0 = Math.max(0, Math.floor((p.cz - p.bound - reach - minZ) / binSize))
    const k1 = Math.min(bz - 1, Math.floor((p.cz + p.bound + reach - minZ) / binSize))
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i2 = i0; i2 <= i1; i2++) bins[i2 + bx * (j + by * k)]!.push(i)
  })

  const FAR = spacing * 4
  const sample = (x: number, y: number, z: number): number => {
    const i = Math.min(bx - 1, Math.max(0, Math.floor((x - minX) / binSize)))
    const j = Math.min(by - 1, Math.max(0, Math.floor((y - minY) / binSize)))
    const k = Math.min(bz - 1, Math.max(0, Math.floor((z - minZ) / binSize)))
    const list = bins[i + bx * (j + by * k)]!
    if (list.length === 0) return FAR
    let d = Infinity
    for (let n = 0; n < list.length; n++) {
      const prim = prepared[list[n]!]!
      if (prim.negative) continue
      const dn = distance(prim, x, y, z)
      d = d === Infinity ? dn : smin(d, dn, blend)
    }
    if (d === Infinity) return FAR
    // Carving happens after the union so a socket cuts the finished surface.
    for (let n = 0; n < list.length; n++) {
      const prim = prepared[list[n]!]!
      if (!prim.negative) continue
      d = smax(d, -distance(prim, x, y, z), carve)
    }
    return d
  }

  // ---- Scalar field ----------------------------------------------------------
  const sx = nx + 1
  const sy = ny + 1
  const field = new Float32Array(sx * sy * (nz + 1))
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
  const indices: number[] = []
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

  // ---- Normals from the sampled field -------------------------------------
  // Re-evaluating the SDF six times per vertex dominated the cost; central
  // differences on the field we already have are far cheaper and just as smooth.
  const vertexCount = positions.length / 3
  const normals = new Float32Array(vertexCount * 3)
  const clampI = (v: number) => (v < 0 ? 0 : v > nx ? nx : v)
  const clampJ = (v: number) => (v < 0 ? 0 : v > ny ? ny : v)
  const clampK = (v: number) => (v < 0 ? 0 : v > nz ? nz : v)
  for (let v = 0; v < vertexCount; v++) {
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

  // ---- Baked ambient occlusion ---------------------------------------------
  // Classic SDF occlusion: march a few steps along the normal and compare how
  // much closer the surface stays than free space would allow.
  const ao = new Float32Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) {
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
      const d = sample(x + nx2 * h, y + ny2 * h, z + nz2 * h)
      occ += (h - d) * weight
      weight *= 0.82
    }
    const value = 1 - 2.4 * occ
    ao[v] = value < 0 ? 0 : value > 1 ? 1 : value
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
