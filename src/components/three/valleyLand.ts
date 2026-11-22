import { BufferAttribute, BufferGeometry, MathUtils, PlaneGeometry } from 'three'

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

/** Where the grid starts, how far apart its vertices are, and how many quads a side. */
export const GRID = { x0: X0, z0: Z0, step: SEG, segments: TERRAIN_SEGMENTS } as const

/** A lake on the floor, off to the left where the ground is lowest. */
export const LAKE = { x: -36, z: -96, r: 30 } as const
export const WATER_LEVEL = 1.2
/** How far out, in lake radii, the ground is still shaped by the lake. */
const LAKE_REACH = 2.7

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
  //
  // The blend reaches well past the shore. It used to end at half a radius
  // beyond it, and on the west side, where the lake sits against the valley
  // wall, that made a sixty-degree cliff fifteen metres high — a smooth sheet
  // the rock shader could only stripe.
  const q = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r
  if (q >= LAKE_REACH) return natural
  // Outside the shore it climbs, but never above the ground it is blended
  // into: on the near side, where the floor is low, a bank rising to the
  // blend's edge was a dam between the camera and the water.
  const bowl = q < 1 ? WATER_LEVEL - 4.6 * (1 - q * q) : Math.min(WATER_LEVEL + 6 * (q - 1), Math.max(natural, WATER_LEVEL + 1.5))
  const k = 1 - smoothstep(0.85, LAKE_REACH, q)
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

/* -------------------------------------------------------------------------- */
/* The crater and the fire                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where the rock comes down, and the hole it leaves: the radius of the rim's
 * crest, how far the floor goes below the ground that was there, how high the
 * rim stands above it, and how far out, in radii, the thrown-out rock still
 * lies on the ground.
 *
 * A simple crater, the kind a rock a few metres across makes: a bowl a fifth
 * as deep as it is wide, a rim of upturned rock, and a blanket of what came
 * out of it thinning with distance. It is well clear of the herd, so nobody is
 * standing in it, and clear of the lake, so the water never runs into it.
 */
export const CRATER = { x: 12, z: -58, r: 22, depth: 9, rim: 4, reach: 2.4 } as const

/**
 * The crater's shape at q radii from its centre, fully formed, in metres
 * above the ground that was there: a bowl that is flat at the bottom,
 * steepest half way up the wall and rounded over at the crest, and outside
 * the crest a blanket of ejecta that falls away from it.
 */
export function craterProfile(q: number, rim: number = CRATER.rim): number {
  if (q < 1) return -CRATER.depth + (CRATER.depth + rim) * (1 - (1 - q * q) ** 2)
  const a = 2.2 * (q - 1)
  return (rim / (1 + a * a) ** 1.5) * (1 - smoothstep(CRATER.reach - 0.45, CRATER.reach, q))
}

/** The rim is higher in some places than others, the same on both sides of the GPU. */
export function rimAt(angle: number): number {
  return CRATER.rim * (0.82 + 0.16 * Math.sin(3 * angle + 1) + 0.1 * Math.sin(5 * angle + 2.3) + 0.05 * Math.sin(11 * angle + 0.4))
}

/**
 * How far the ground at a point has moved, `grow` of the way through the
 * crater's opening. It opens self-similarly, a small bowl widening and
 * deepening into the full one, which is roughly what an excavating crater does.
 */
export function craterAt(x: number, z: number, grow = 1): number {
  if (grow <= 0) return 0
  const dx = x - CRATER.x
  const dz = z - CRATER.z
  const q = Math.hypot(dx, dz) / (CRATER.r * grow)
  if (q >= CRATER.reach) return 0
  return grow * craterProfile(q, rimAt(Math.atan2(dz, dx)))
}

let patch: BufferGeometry | null = null

/**
 * The ground the crater is cut into, finer than the rest: a polar grid out to
 * the edge of the ejecta, its vertices on the mesh exactly, displaced in the
 * shader as the crater opens. The ground mesh's quads are two and a half
 * metres, and the crest of a rim cut into them was a polygon you could count
 * the sides of against the glow inside it. Built once and kept, like the
 * ground; the terrain under it is lowered out of the way when it is shown.
 */
export function buildCraterPatch(): BufferGeometry {
  if (patch) return patch
  // Rings closest together round the crest, where the silhouette is, and
  // further apart over the floor and the outer blanket. It was four times
  // this once: from the camera the patch is a sliver a few hundred pixels
  // across, and fifty thousand triangles in it, each a pixel or less, cost
  // ten frames a second in fragments shaded for nothing.
  const rings = 56
  const around = 176
  const columns = around + 1
  const position = new Float32Array(columns * (rings + 1) * 3)
  for (let ring = 0; ring <= rings; ring++) {
    const u = ring / rings
    const q = u < 0.6 ? (u / 0.6) * 1.3 : 1.3 + ((u - 0.6) / 0.4) * (CRATER.reach - 1.3)
    const r = q * CRATER.r
    for (let i = 0; i < columns; i++) {
      const a = (i / around) * Math.PI * 2
      const x = CRATER.x + Math.cos(a) * r
      const z = CRATER.z + Math.sin(a) * r
      position.set([x, groundAt(x, z), z], (ring * columns + i) * 3)
    }
  }
  const index: number[] = []
  for (let ring = 0; ring < rings; ring++) {
    for (let i = 0; i < around; i++) {
      const a = ring * columns + i
      const b = a + columns
      // Wound to face up, like the ground.
      index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const built = new BufferGeometry()
  built.setAttribute('position', new BufferAttribute(position, 3))
  built.setIndex(index)
  built.computeVertexNormals()
  built.computeBoundingSphere()
  // Room for the rim and the ejecta it will grow.
  if (built.boundingSphere) built.boundingSphere.radius += CRATER.rim * 2
  patch = built
  return built
}

/**
 * How far the blast front has run from the crater, seconds after the rock
 * lands: fast at first, slowing, and spent by about a hundred and thirty
 * metres. The dust wall rides it, the grass and trees go down as it passes,
 * the herd goes over, and the fire comes in behind it.
 */
export function blastFront(since: number): number {
  if (since < 0.3) return 0
  if (since < 1.8) return 4 + ((since - 0.3) / 1.5) * 75
  const k = Math.min(1, (since - 1.8) / 2.1)
  return 79 + 50 * (1 - (1 - k) * (1 - k))
}

/**
 * When the blast front reaches a distance: `blastFront` the other way round.
 * Past where the front ran out the fire carries on by itself, slower.
 */
export function blastArrival(distance: number): number {
  if (distance <= 4) return 0.3
  if (distance <= 79) return 0.3 + (distance - 4) / 50
  if (distance <= 129) return 1.8 + 2.1 * (1 - Math.sqrt(Math.max(0, 1 - (distance - 79) / 50)))
  return 3.9 + (distance - 129) / 20
}

/**
 * Whether something planted at a point is where the crater opens, or under
 * the ejecta piled round its rim: gone the moment the rock lands, rather than
 * left standing on ground that is no longer there.
 */
export function inCrater(x: number, z: number): boolean {
  return Math.hypot(x - CRATER.x, z - CRATER.z) < CRATER.r * 1.55
}

/** How far from the crater the blast puts trees down. */
const FELL_REACH = 85

/**
 * A tree standing at a point, and the blast: when the front reaches it, how
 * far over it goes, in radians — further the nearer it stands — and which way
 * on the map, straight away from the crater. Null if the front never gets to
 * it with the strength to put it down.
 */
export function fellAt(x: number, z: number): { at: number; tilt: number; dx: number; dz: number } | null {
  const dx = x - CRATER.x
  const dz = z - CRATER.z
  const d = Math.hypot(dx, dz)
  if (d >= FELL_REACH || d < 1e-3) return null
  return { at: blastArrival(d), tilt: (1 - (d / FELL_REACH) * 0.55) * 1.3, dx: dx / d, dz: dz / d }
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
 * lake or on its wet margin, and the ground under each spot is read from the mesh once here so the
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
    const fromLake = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r
    if (fromLake < 1.12) continue
    const y = groundAt(x, z)
    // The wet margin. Only by the lake: most of the floor lies below the water
    // line, and when this test was by height alone nothing grew on it at all.
    if (fromLake < 1.45 && y < WATER_LEVEL + 0.4) continue
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
