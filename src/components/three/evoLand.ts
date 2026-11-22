import { BufferAttribute, BufferGeometry } from 'three'

/**
 * The ground the long walk crosses: one strip of country seven hundred metres
 * long, with a crag and a cave at its west end, open steppe and a pond in the
 * middle, and level ground at the east end for a city to stand on.
 *
 * The walk runs along +x. The camera keeps to the +z side and looks across the
 * path towards -z, where the ground climbs into foothills and the ranges stand
 * behind them, so the far side of every frame is closed by land and never by
 * the edge of a mesh.
 *
 * Everything above the geometry builders is plain arithmetic: the scene, the
 * cast and the tests all ask the same functions where the ground is.
 */

/** Where things are, in metres. `x` runs along the walk, `z` across it. */
export const PLACE = {
  /** The cave: a chamber at the back with the hearth in it, a passage, and a mouth that opens east. */
  cave: { chamber: { x: -17.5, z: 0.4, r: 6.4 }, hearth: { x: -15.4, z: 0.9 }, passage: 3.5, mouth: { x: 0, z: 0 } },
  /** Water on the steppe, where the herd drinks. */
  pond: { x: 121, z: -34, r: 17, level: -0.55 },
  /** The first roofs. */
  village: { x: 204, z: -24, r: 30 },
  /** Level ground for the city, and the street that runs through it. */
  city: { from: 248, until: 600, street: -6, half: 7 },
  /** The lit window at the end of the walk, and the desk behind it. */
  studio: { x: 397, z: -19.2 },
} as const

export const LAND = { x0: -90, x1: 610, z0: -260, z1: 110, step: 2.5 } as const
const COLS = Math.round((LAND.x1 - LAND.x0) / LAND.step)
const ROWS = Math.round((LAND.z1 - LAND.z0) / LAND.step)
export const LAND_GRID = { cols: COLS, rows: ROWS } as const

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
export const ramp = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * A lattice hash in integer arithmetic. The usual `fract(sin(...))` loses
 * precision a few hundred units from the origin and starts to repeat; this is
 * exact anywhere, and the shaders use the same one so the two agree.
 */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) | 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Value noise, 0 to 1, smooth across lattice points. */
export function noise2(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

export function fbm2(x: number, y: number, octaves: number): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, y) * amp
    norm += amp
    x = x * 2.03 + 17.3
    y = y * 2.03 - 9.1
    amp *= 0.5
  }
  return sum / norm
}

/** Distance from a point to a segment in the plane. */
function toSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len = dx * dx + dz * dz
  const t = len > 1e-9 ? clamp01(((px - ax) * dx + (pz - az) * dz) / len) : 0
  return Math.hypot(px - ax - dx * t, pz - az - dz * t)
}

/**
 * How far inside the cave's footprint a point is: 1 over the chamber and the
 * passage, falling to 0 a few metres out. The ground is held level here and is
 * the cave's floor; the crag over it is a mesh of its own, hollowed out to
 * just inside this line, so the height field only climbs again inside rock.
 */
export function caveFootprint(x: number, z: number): number {
  const { chamber, passage, mouth } = PLACE.cave
  const room = Math.hypot(x - chamber.x, z - chamber.z) - chamber.r
  const hall = toSegment(x, z, chamber.x + 3, chamber.z, mouth.x + 1.5, mouth.z) - passage
  return 1 - ramp(0.4, 3.4, Math.min(room, hall))
}

/**
 * The height of the land at a point, in metres, as a formula. What is drawn —
 * and what anything standing on it should use — is `groundAt`, the mesh.
 */
export function landAt(x: number, z: number): number {
  // Open country: long swells with a little roughness on them, calmer along
  // the line the walk takes so a figure crossing it keeps its footing.
  const calm = 1 - 0.6 * Math.exp(-(((z - 1) / 17) ** 2))
  let h = ((fbm2(x * 0.019 + 3.1, z * 0.019 - 1.7, 4) - 0.5) * 4.2 + (noise2(x * 0.105, z * 0.105) - 0.5) * 0.4) * calm

  // Foothills beyond the path, climbing to meet the ranges.
  const far = ramp(-58, -240, z)
  h += far * (10 + 42 * fbm2(x * 0.0075 + 9.2, z * 0.0075 + 4.4, 5)) + far * far * 14

  // A bank behind the camera, so that side is closed too.
  const near = ramp(30, 96, z)
  h += near * (9 + 12 * fbm2(x * 0.013 - 2.2, z * 0.013 + 7.7, 3))

  // The high ground the cave is cut into, rising west from the mouth.
  const west = ramp(10, -46, x)
  h += west * (8 + 20 * fbm2(x * 0.016 + 1.3, z * 0.016 - 5.1, 4)) * (0.55 + 0.45 * ramp(4, 30, Math.abs(z - 1)))

  // The apron in front of the mouth: trodden level.
  const apron = (1 - ramp(0, 15, x)) * (1 - ramp(5, 13, Math.abs(z)))
  h = mix(h, 0.05, apron * (1 - west * 0.3))

  // The pond: a shallow bowl, with a shore that comes down to it gently.
  const pond = PLACE.pond
  const d = Math.hypot(x - pond.x, z - pond.z) / pond.r
  const shore = 1 - ramp(0.9, 2.6, d)
  h = mix(h, pond.level + 0.12 + Math.max(0, d - 1) * 1.3, shore)
  if (d < 1) h = Math.min(h, pond.level - 0.15 - 1.5 * (1 - d * d))

  // Level ground where the city will stand, and a little either side of it.
  const city = PLACE.city
  const built = ramp(city.from - 14, city.from + 12, x) * (1 - ramp(105, 150, Math.abs(z - city.street)))
  h = mix(h, 0, built)

  // The floor of the cave is this mesh too: level, and under the crag, which
  // is hollow there. Outside the footprint the land climbs again inside solid
  // rock, where nothing sees it.
  const cave = caveFootprint(x, z)
  if (cave > 0) h = mix(h, 0.04 + (noise2(x * 0.5, z * 0.5) - 0.5) * 0.1, cave)
  return h
}

let grid: Float32Array | null = null

/** The land sampled on the mesh's own grid. Built once; everything below reads it. */
export function prepareLand(): Float32Array {
  if (grid) return grid
  const out = new Float32Array((COLS + 1) * (ROWS + 1))
  for (let j = 0; j <= ROWS; j++) {
    const z = LAND.z0 + j * LAND.step
    for (let i = 0; i <= COLS; i++) out[i + j * (COLS + 1)] = landAt(LAND.x0 + i * LAND.step, z)
  }
  grid = out
  return out
}

/**
 * The height of the ground *as drawn*: the mesh's own triangles, interpolated
 * the way the card interpolates them. Between two vertices this and `landAt`
 * disagree by a few centimetres, which is a foot in the air or in the ground.
 */
export function groundAt(x: number, z: number): number {
  const g = prepareLand()
  const u = Math.min(COLS - 1e-6, Math.max(0, (x - LAND.x0) / LAND.step))
  const v = Math.min(ROWS - 1e-6, Math.max(0, (z - LAND.z0) / LAND.step))
  const i = Math.floor(u)
  const j = Math.floor(v)
  const fx = u - i
  const fz = v - j
  const w = COLS + 1
  const a = g[i + j * w]!
  const b = g[i + 1 + j * w]!
  const c = g[i + (j + 1) * w]!
  const d = g[i + 1 + (j + 1) * w]!
  // Each quad is split along b–c, as `buildLand` indexes it.
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz)
}

/** The slope of the drawn ground at a point: 0 level, 1 at forty-five degrees. */
export function slopeAt(x: number, z: number): number {
  const e = LAND.step * 0.5
  return Math.hypot(groundAt(x + e, z) - groundAt(x - e, z), groundAt(x, z + e) - groundAt(x, z - e)) / (2 * e)
}

/**
 * Whether grass grows at a point, 0 to 1: not in the cave or on its doorstep,
 * not in the water or on its wet margin, thin on steep ground. The meadow and
 * the ground's own colour both go by this, so a blade never stands on bare
 * earth and bare earth is never painted green.
 */
export function grassAt(x: number, z: number): number {
  const pond = PLACE.pond
  const d = Math.hypot(x - pond.x, z - pond.z) / pond.r
  const dry = ramp(1.02, 1.22, d)
  const doorstep = ramp(1.5, 9, Math.hypot(x - 3, z * 0.8))
  const level = 1 - ramp(0.38, 0.7, slopeAt(x, z))
  return clamp01(dry * doorstep * level * (1 - caveFootprint(x, z)))
}

/** The land as a mesh: positions, normals from the grid, and an index that splits every quad the same way. */
export function buildLand(): BufferGeometry {
  const g = prepareLand()
  const w = COLS + 1
  const count = w * (ROWS + 1)
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const at = (i: number, j: number) => g[Math.min(COLS, Math.max(0, i)) + Math.min(ROWS, Math.max(0, j)) * w]!
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) {
      const n = i + j * w
      positions[n * 3] = LAND.x0 + i * LAND.step
      positions[n * 3 + 1] = g[n]!
      positions[n * 3 + 2] = LAND.z0 + j * LAND.step
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * LAND.step)
      const dz = (at(i, j + 1) - at(i, j - 1)) / (2 * LAND.step)
      const len = Math.hypot(dx, 1, dz)
      normals[n * 3] = -dx / len
      normals[n * 3 + 1] = 1 / len
      normals[n * 3 + 2] = -dz / len
    }
  }
  const indices = new Uint32Array(COLS * ROWS * 6)
  let k = 0
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = i + j * w
      const b = a + 1
      const c = a + w
      const d = c + 1
      indices[k++] = a
      indices[k++] = c
      indices[k++] = b
      indices[k++] = b
      indices[k++] = c
      indices[k++] = d
    }
  }
  // Where the meadow grows, for the ground's own colour.
  const grass = new Float32Array(count)
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) grass[i + j * w] = grassAt(LAND.x0 + i * LAND.step, LAND.z0 + j * LAND.step)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('grass', new BufferAttribute(grass, 1))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

// ------------------------------------------------------------------ ranges

/** The ranges: a ring of mountains a kilometre and more out, all the way round. */
export const RANGE = { x: 230, z: -40, inner: 250, foot: 760, outer: 1900, segments: 420, rings: 44 } as const

function ridged(x: number, z: number): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let weight = 1
  for (let i = 0; i < 5; i++) {
    let n = 1 - Math.abs(noise2(x, z) * 2 - 1)
    n *= n * weight
    weight = clamp01(n * 2.2)
    sum += n * amp
    norm += amp
    x = x * 2.07 + 11.9
    z = z * 2.07 - 4.3
    amp *= 0.5
  }
  return sum / norm
}

/** How high the ranges stand at a point, in metres above the plain. */
export function rangeAt(x: number, z: number): number {
  const r = Math.hypot(x - RANGE.x, z - RANGE.z)
  // Inside their foot the ranges are a level skirt that runs in under the edge
  // of the land, so no gap ever shows between the two from a height.
  const across = clamp01((r - RANGE.foot) / (RANGE.outer - RANGE.foot))
  // Up out of the plain, highest two thirds of the way back, and down again
  // behind so the back of the ring is never a wall.
  const rise = ramp(0, 0.34, across) * (1 - ramp(0.82, 1, across) * 0.75)
  // Taller on the far side of the walk than behind the camera.
  const side = 0.72 + 0.28 * ramp(260, -520, z)
  const crest = ridged(x * 0.00125 + 3.7, z * 0.00125 + 1.9)
  const massif = fbm2(x * 0.0006 - 1.1, z * 0.0006 + 6.3, 3)
  return rise * side * (60 + 520 * crest * (0.45 + 0.75 * massif))
}

export function buildRange(): BufferGeometry {
  const { segments, rings, inner, outer } = RANGE
  const w = segments + 1
  const positions = new Float32Array(w * (rings + 1) * 3)
  for (let j = 0; j <= rings; j++) {
    // Rings closer together near the front edge, where the skyline is.
    const t = j / rings
    const r = inner + (outer - inner) * t ** 1.2
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const x = RANGE.x + Math.cos(a) * r
      const z = RANGE.z + Math.sin(a) * r
      const n = (i + j * w) * 3
      positions[n] = x
      positions[n + 1] = rangeAt(x, z) - 6
      positions[n + 2] = z
    }
  }
  const indices = new Uint32Array(segments * rings * 6)
  let k = 0
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = i + j * w
      const b = a + 1
      const c = a + w
      const d = c + 1
      // Wound to face the middle of the ring, which is where the camera is.
      indices[k++] = a
      indices[k++] = b
      indices[k++] = c
      indices[k++] = b
      indices[k++] = d
      indices[k++] = c
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
