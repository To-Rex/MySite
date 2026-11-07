/**
 * Measurements over an indexed triangle mesh, shared by the meshing tests.
 * Plain arithmetic on the typed arrays the mesher returns — no three.js, for the
 * same reason the mesher has none.
 */

export interface Mesh {
  positions: Float32Array
  indices: Uint32Array
}

/** How many triangles use each undirected edge, keyed "low:high". */
export function edgeUse({ indices }: Mesh): Map<string, number> {
  const use = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e]!
      const b = indices[t + ((e + 1) % 3)]!
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      use.set(key, (use.get(key) ?? 0) + 1)
    }
  }
  return use
}

/** Edges that are not shared by exactly two triangles: holes (1) and fins (3+). */
export function openEdges(mesh: Mesh): number {
  let open = 0
  for (const count of edgeUse(mesh).values()) if (count !== 2) open++
  return open
}

/** Number of separate pieces, by walking shared vertices. */
export function components({ positions, indices }: Mesh): number {
  const parent = Int32Array.from({ length: positions.length / 3 }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const used = new Set<number>()
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]!)
    const b = find(indices[t + 1]!)
    const c = find(indices[t + 2]!)
    parent[b] = a
    parent[c] = a
    used.add(indices[t]!).add(indices[t + 1]!).add(indices[t + 2]!)
  }
  return new Set([...used].map(find)).size
}

/**
 * Enclosed volume, from signed tetrahedra against the origin. Positive only if
 * the triangles are wound to face outward — so it doubles as a winding check.
 */
export function volume({ positions, indices }: Mesh): number {
  let six = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3
    const b = indices[t + 1]! * 3
    const c = indices[t + 2]! * 3
    const ax = positions[a]!, ay = positions[a + 1]!, az = positions[a + 2]!
    const bx = positions[b]!, by = positions[b + 1]!, bz = positions[b + 2]!
    const cx = positions[c]!, cy = positions[c + 1]!, cz = positions[c + 2]!
    six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  }
  return six / 6
}

/** Smallest and largest coordinate on each axis. */
export function bounds(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis]!
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  return { min, max }
}

export const allFinite = (values: ArrayLike<number>): boolean => {
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return false
  return true
}
