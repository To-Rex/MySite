import { BufferAttribute, MathUtils, PlaneGeometry, type BufferGeometry } from 'three'

/**
 * The lie of the land: the height field the whole valley is built on, and the
 * scatter that puts a forest on it.
 *
 * Pure geometry and arithmetic, kept apart from the scene so the terrain
 * material, the flora and the cinematic all read the same ground. Everything
 * is deterministic — every hash is seeded — so the valley is the same valley
 * every showing.
 *
 * Two height functions, and the difference matters. `heightAt` is the analytic
 * field the mesh is sampled from. `groundAt` is the mesh: the same triangles,
 * the same interpolation between the same vertices. Anything that has to stand
 * *on* the ground asks `groundAt`, because between two vertices the analytic
 * field and the mesh disagree by up to a third of a unit, which is a turtle
 * buried to its shell.
 */

/** Allocation-free integer hash, the same trick the skin texture uses. */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const sx = xf * xf * (3 - 2 * xf)
  const sy = yf * yf * (3 - 2 * yf)
  const a = MathUtils.lerp(hash2(xi, yi), hash2(xi + 1, yi), sx)
  const b = MathUtils.lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), sx)
  return MathUtils.lerp(a, b, sy)
}

export function fbm(x: number, y: number, octaves: number): number {
  let v = 0
  let a = 0.5
  let fx = x
  let fy = y
  for (let i = 0; i < octaves; i++) {
    v += a * valueNoise(fx, fy)
    fx = fx * 2.03 + 17
    fy = fy * 2.03 + 9
    a *= 0.5
  }
  return v
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** The plane is this wide and is centred `TERRAIN_SHIFT` down the valley. */
export const TERRAIN_SIZE = 340
export const TERRAIN_SHIFT = 110
/**
 * One resolution on every tier. Sixteen thousand vertices cost nothing next to
 * the fragment work, and a single grid means `groundAt` is the mesh everywhere.
 */
export const TERRAIN_SEGMENTS = 128
const SEG = TERRAIN_SIZE / TERRAIN_SEGMENTS
const X0 = -TERRAIN_SIZE / 2
const Z0 = -TERRAIN_SIZE / 2 - TERRAIN_SHIFT

/** A lake on the floor, off to the left where the ground is lowest. */
export const LAKE = { x: -36, z: -96, r: 30 } as const
export const WATER_LEVEL = 1.2

/**
 * The volcano is part of the height field rather than a cone stood on it, so
 * it gets the same rock, strata, bump and mist as the ridges and meets them
 * without a seam. Its summit is where the vent smokes from.
 */
export const VOLCANO = { x: 60, z: -250, r: 84, height: 64 } as const

/**
 * The shape of the place: a floor that lifts into ridges on both sides and
 * closes off in the distance, so the camera is looking *along* a valley rather
 * than across a field.
 *
 * The ridges are capped. Uncapped they climbed past the top of the frustum
 * long before the plane ran out and the frame became all hill: at the back of
 * the valley the camera can see roughly 75 units up, so 30 and 46 leave the
 * skyline low in the frame and the upper half to the sky. Both are modulated
 * along their length so the skyline is a line of peaks rather than a wall.
 *
 * Nothing here is finer than the mesh can carry: the smallest octave has a
 * wavelength of nearly seven units against quads of two and a half. Finer
 * detail belongs to the material's bump, which the mesh never has to agree with.
 */
export function heightAt(x: number, z: number): number {
  const walls = Math.min(30, Math.pow(Math.abs(x) / 98, 2.2) * 30) * (0.72 + 0.56 * valueNoise(z * 0.03 + 5, 3))
  const far =
    Math.min(46, Math.pow(Math.max(0, -z - 120) / 105, 2) * 46) * (0.65 + 0.7 * valueNoise(x * 0.024 + 9, 11))
  const rolling =
    (valueNoise(x * 0.021, z * 0.021) - 0.5) * 7 +
    (valueNoise(x * 0.055, z * 0.055) - 0.5) * 2.6 +
    (valueNoise(x * 0.15, z * 0.15) - 0.5) * 0.9
  // The mountain: a cone with slightly hollowed flanks, a crater at the top,
  // and its own noise so the flanks are gullied rather than smooth.
  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
  const cone = Math.pow(Math.max(0, 1 - dv / VOLCANO.r), 1.35) * VOLCANO.height
  const gully =
    cone > 0 ? cone * (valueNoise(Math.atan2(z - VOLCANO.z, x - VOLCANO.x) * 2.2 + 3, dv * 0.06) - 0.5) * 0.3 : 0
  const crater = smoothstep(16, 0, dv) * 11
  const natural = walls + far + rolling + cone + gully - crater

  // The lake is a bowl blended into whatever the ground was doing there. Inside
  // the shoreline it dips below the water; outside it rises steadily, so the
  // shore is where the terrain crosses the water plane and nowhere else.
  const q = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r
  if (q >= 1.45) return natural
  const bowl = q < 1 ? WATER_LEVEL - 4.6 * (1 - q * q) : WATER_LEVEL + 6 * (q - 1)
  const k = 1 - smoothstep(0.85, 1.45, q)
  return MathUtils.lerp(natural, bowl + rolling * 0.15, k)
}

/* -------------------------------------------------------------------------- */
/* The grid                                                                    */
/* -------------------------------------------------------------------------- */

let grid: Float32Array | null = null

/**
 * The height at every vertex of the mesh, computed once. Called from the
 * warm-up while the page is idle; anything that needs it sooner builds it on
 * the spot.
 */
export function prepareLand(): Float32Array {
  if (grid) return grid
  const n = TERRAIN_SEGMENTS + 1
  const out = new Float32Array(n * n)
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      out[iy * n + ix] = heightAt(X0 + ix * SEG, Z0 + iy * SEG)
    }
  }
  grid = out
  return out
}

/**
 * The height of the *mesh* at a point: the same two triangles per quad that
 * `PlaneGeometry` indexes, interpolated the same way the rasteriser will.
 */
export function groundAt(x: number, z: number): number {
  const g = prepareLand()
  const n = TERRAIN_SEGMENTS + 1
  const fx = MathUtils.clamp((x - X0) / SEG, 0, TERRAIN_SEGMENTS - 1e-6)
  const fz = MathUtils.clamp((z - Z0) / SEG, 0, TERRAIN_SEGMENTS - 1e-6)
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const u = fx - ix
  const v = fz - iz
  const a = g[iz * n + ix] ?? 0
  const b = g[(iz + 1) * n + ix] ?? 0
  const c = g[(iz + 1) * n + ix + 1] ?? 0
  const d = g[iz * n + ix + 1] ?? 0
  // The diagonal runs b–d; the near triangle is a-b-d, the far one b-c-d.
  if (u + v <= 1) return a + u * (d - a) + v * (b - a)
  return c + (1 - u) * (b - c) + (1 - v) * (d - c)
}

/** The mesh's surface normal at a point, from the ground around it. */
export function groundNormalAt(x: number, z: number, out: { set: (x: number, y: number, z: number) => unknown }): void {
  const h = 1.2
  const nx = groundAt(x - h, z) - groundAt(x + h, z)
  const nz = groundAt(x, z - h) - groundAt(x, z + h)
  const len = Math.hypot(nx, 2 * h, nz)
  out.set(nx / len, (2 * h) / len, nz / len)
}

/** 0 on the flat, 1 on a cliff. */
export function slopeAt(x: number, z: number): number {
  const h = 0.8
  const nx = heightAt(x - h, z) - heightAt(x + h, z)
  const nz = heightAt(x, z - h) - heightAt(x, z + h)
  const ny = 2 * h
  return 1 - ny / Math.hypot(nx, ny, nz)
}

export function buildTerrain(): BufferGeometry {
  const heights = prepareLand()
  const geometry = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS)
  geometry.rotateX(-Math.PI / 2)
  const pos = geometry.attributes.position as BufferAttribute
  // PlaneGeometry lays its vertices out row by row from the top, which after
  // the rotation is exactly the order the grid was filled in.
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heights[i] ?? 0)
    pos.setZ(i, pos.getZ(i) - TERRAIN_SHIFT)
  }
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The ground after the impact: a bowl with a raised rim, pressed into the
 * mesh in place. Done once, on the frame the rock lands.
 */
export function carveCrater(geometry: BufferGeometry, x: number, z: number, radius: number, depth: number): void {
  const pos = geometry.attributes.position as BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i) - x, pos.getZ(i) - z)
    if (d > radius * 1.4) continue
    const q = d / radius
    const bowl = q < 1 ? -depth * Math.pow(1 - q * q, 2) : 0
    const rim = depth * 0.3 * smoothstep(0.55, 0.95, q) * (1 - smoothstep(0.95, 1.4, q))
    pos.setY(i, pos.getY(i) + bowl + rim)
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
}

/* -------------------------------------------------------------------------- */
/* Scatter                                                                     */
/* -------------------------------------------------------------------------- */

export interface Spot {
  x: number
  y: number
  z: number
  scale: number
  yaw: number
  /** 0..1, for whatever variation the thing planted here wants. */
  tint: number
}

export interface ScatterRule {
  count: number
  seed: number
  /** Where to look, so a rule for the lake shore is not sampling the far ridge. */
  bounds: { x: [number, number]; z: [number, number] }
  /** Acceptance weight for a candidate, 0 to reject it outright. */
  accept: (x: number, z: number, y: number, slope: number) => number
  scale: [number, number]
}

/**
 * Rejection sampling over the rule's bounds. Nothing is ever planted in the
 * lake, and the ground under each spot is read from the mesh once here so the
 * instances can be placed without touching the height field again.
 */
export function scatter(rule: ScatterRule): Spot[] {
  const out: Spot[] = []
  const tries = rule.count * 40
  const [x0, x1] = rule.bounds.x
  const [z0, z1] = rule.bounds.z
  for (let i = 0; i < tries && out.length < rule.count; i++) {
    const x = MathUtils.lerp(x0, x1, hash2(i, rule.seed))
    const z = MathUtils.lerp(z0, z1, hash2(i, rule.seed + 1))
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.12) continue
    const y = groundAt(x, z)
    if (y < WATER_LEVEL + 0.4) continue
    const slope = slopeAt(x, z)
    const weight = rule.accept(x, z, y, slope)
    if (weight <= 0 || hash2(i, rule.seed + 2) > weight) continue
    out.push({
      x,
      y,
      z,
      scale: MathUtils.lerp(rule.scale[0], rule.scale[1], hash2(i, rule.seed + 3)),
      yaw: hash2(i, rule.seed + 4) * Math.PI * 2,
      tint: hash2(i, rule.seed + 5),
    })
  }
  return out
}
