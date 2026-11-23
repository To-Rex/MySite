// Orientation helpers for set B: connected components of a part, and which of them are inside out.
// Used by models-b.mjs (in drop(), which sees each part once, turned but not yet scaled) and by
// `node orient-b.mjs <key> [part regex]` to print what it finds.

/** Connected components of a part's triangles, vertices welded by position. Returns an array of triangle-start lists. */
export function components(p) {
  const n = p.P.length / 3
  // Weld by position: a component must not split at a UV or normal seam.
  let ext = 0
  for (let i = 0; i < p.P.length; i++) ext = Math.max(ext, Math.abs(p.P[i]))
  const q = (ext || 1) * 1e-5
  const key = new Map(), id = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(p.P[i * 3] / q)},${Math.round(p.P[i * 3 + 1] / q)},${Math.round(p.P[i * 3 + 2] / q)}`
    if (!key.has(k)) key.set(k, key.size)
    id[i] = key.get(k)
  }
  const parent = Int32Array.from({ length: key.size }, (_, i) => i)
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  for (let t = 0; t < p.I.length; t += 3) {
    const a = find(id[p.I[t]]), b = find(id[p.I[t + 1]]), c = find(id[p.I[t + 2]])
    parent[b] = a
    parent[find(c)] = find(a)
  }
  const groups = new Map()
  for (let t = 0; t < p.I.length; t += 3) {
    const r = find(id[p.I[t]])
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(t)
  }
  return { list: [...groups.values()], id }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const vtx = (p, i) => [p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]]

/**
 * What a component says about its own orientation:
 * - volume: signed volume about its centroid (positive when a closed shell faces out);
 * - open: the share of its welded edges that have one triangle only;
 * - out: area-weighted mean of (face normal · direction away from `centre`), -1..1;
 * - agree: area-weighted share of faces whose winding agrees with their stored vertex normals.
 */
export function measure(p, tris, id, centre, scale = [1, 1, 1]) {
  let cx = 0, cy = 0, cz = 0, area = 0
  const faces = []
  for (const t of tris) {
    const a = vtx(p, p.I[t]), b = vtx(p, p.I[t + 1]), c = vtx(p, p.I[t + 2])
    const n = cross(sub(b, a), sub(c, a))
    const A = Math.hypot(...n) / 2
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
    faces.push({ a, b, c, n, A, m, t })
    cx += m[0] * A; cy += m[1] * A; cz += m[2] * A; area += A
  }
  const g = area ? [cx / area, cy / area, cz / area] : [0, 0, 0]
  let volume = 0, out = 0, agree = 0
  for (const f of faces) {
    volume += dot(sub(f.a, g), cross(sub(f.b, g), sub(f.c, g))) / 6
    // Away from the car's centre, measured on an ellipsoid the car's shape.
    const d = [(f.m[0] - centre[0]) / scale[0] ** 2, (f.m[1] - centre[1]) / scale[1] ** 2, (f.m[2] - centre[2]) / scale[2] ** 2]
    const dl = Math.hypot(...d) || 1, nl = Math.hypot(...f.n) || 1
    out += (dot(f.n, d) / dl / nl) * f.A
    const vn = [0, 1, 2].map((k) => p.N[p.I[f.t] * 3 + k] + p.N[p.I[f.t + 1] * 3 + k] + p.N[p.I[f.t + 2] * 3 + k])
    if (dot(vn, f.n) > 0) agree += f.A
  }
  // Open edges, on welded vertices.
  const edges = new Map()
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = id[p.I[t + k]], b = id[p.I[t + ((k + 1) % 3)]]
    const e = a < b ? `${a}_${b}` : `${b}_${a}`
    edges.set(e, (edges.get(e) ?? 0) + 1)
  }
  let single = 0
  for (const v of edges.values()) if (v === 1) single++
  return { tris: tris.length, area, centroid: g, volume, open: single / (edges.size || 1), out: area ? out / area : 0, agree: area ? agree / area : 0 }
}

/** Flips the winding of the given triangles, and the normals of their vertices if asked. */
export function flip(p, tris, normalsToo) {
  const seen = new Set()
  for (const t of tris) {
    ;[p.I[t + 1], p.I[t + 2]] = [p.I[t + 2], p.I[t + 1]]
    if (normalsToo) for (let k = 0; k < 3; k++) {
      const v = p.I[t + k]
      if (seen.has(v)) continue
      seen.add(v)
      p.N[v * 3] *= -1; p.N[v * 3 + 1] *= -1; p.N[v * 3 + 2] *= -1
    }
  }
}

/** Negates the stored normals of the given triangles' vertices, where they disagree with the winding. */
export function alignNormals(p, tris) {
  const seen = new Set()
  for (const t of tris) {
    const a = vtx(p, p.I[t]), b = vtx(p, p.I[t + 1]), c = vtx(p, p.I[t + 2])
    const n = cross(sub(b, a), sub(c, a))
    for (let k = 0; k < 3; k++) {
      const v = p.I[t + k]
      if (seen.has(v)) continue
      if (n[0] * p.N[v * 3] + n[1] * p.N[v * 3 + 1] + n[2] * p.N[v * 3 + 2] < 0) {
        seen.add(v)
        p.N[v * 3] *= -1; p.N[v * 3 + 1] *= -1; p.N[v * 3 + 2] *= -1
      }
    }
  }
}

/**
 * Turns a part's triangles the right way out, in place: first every patch of welded triangles is made
 * consistent with itself (a neighbour across a shared edge must run that edge the other way), then a
 * patch that is closed enough to have an inside (open edges ≤ maxOpen) and encloses a negative volume
 * is turned over. Stored normals follow their triangles. `decide(stats)` may overrule the volume for a
 * patch: return true to flip it, false to keep it, undefined to let the volume decide.
 * Returns the patches it looked at.
 */
export function orient(p, { maxOpen = 0.3, minVolume = 0.004, decide, vote = false } = {}) {
  const { id } = components(p)
  const T = p.I.length / 3
  const edges = new Map()
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) {
    const a = id[p.I[t * 3 + k]], b = id[p.I[t * 3 + ((k + 1) % 3)]]
    if (a === b) continue
    const e = edgeKey(a, b)
    if (!edges.has(e)) edges.set(e, [])
    edges.get(e).push(t)
  }
  // Does triangle t run the edge a→b (+1) or b→a (−1), in its stored winding?
  const runs = (t, a, b) => {
    for (let k = 0; k < 3; k++) {
      const x = id[p.I[t * 3 + k]], y = id[p.I[t * 3 + ((k + 1) % 3)]]
      if (x === a && y === b) return 1
      if (x === b && y === a) return -1
    }
    return 0
  }
  const sign = new Int8Array(T), patch = new Int32Array(T).fill(-1)
  const patches = []
  for (let seed = 0; seed < T; seed++) {
    if (patch[seed] >= 0) continue
    const pid = patches.length
    const members = [seed]
    patch[seed] = pid
    sign[seed] = 1
    for (let qi = 0; qi < members.length; qi++) {
      const t = members[qi]
      for (let k = 0; k < 3; k++) {
        const a = id[p.I[t * 3 + k]], b = id[p.I[t * 3 + ((k + 1) % 3)]]
        const list = edges.get(edgeKey(a, b))
        if (!list || list.length !== 2) continue
        const u = list[0] === t ? list[1] : list[0]
        if (patch[u] >= 0) continue
        // t runs a→b (times its sign); u must run b→a.
        sign[u] = runs(u, a, b) * sign[t] === 1 ? -1 : 1
        patch[u] = pid
        members.push(u)
      }
    }
    patches.push(members)
  }
  const stats = []
  for (const [pid, members] of patches.entries()) {
    // The volume and the open edges, with the patch's own consistent winding.
    let cx = 0, cy = 0, cz = 0, area = 0, against = 0
    for (const t of members) {
      const a = vtx(p, p.I[t * 3]), b = vtx(p, p.I[t * 3 + 1]), c = vtx(p, p.I[t * 3 + 2])
      const A = Math.hypot(...cross(sub(b, a), sub(c, a))) / 2
      cx += (a[0] + b[0] + c[0]) / 3 * A; cy += (a[1] + b[1] + c[1]) / 3 * A; cz += (a[2] + b[2] + c[2]) / 3 * A; area += A
      if (sign[t] < 0) against += A
    }
    const g = area ? [cx / area, cy / area, cz / area] : [0, 0, 0]
    let volume = 0
    for (const t of members) {
      let a = vtx(p, p.I[t * 3]), b = vtx(p, p.I[t * 3 + 1]), c = vtx(p, p.I[t * 3 + 2])
      if (sign[t] < 0) [b, c] = [c, b]
      volume += dot(sub(a, g), cross(sub(b, g), sub(c, g))) / 6
    }
    const own = new Map()
    for (const t of members) for (let k = 0; k < 3; k++) {
      const e = edgeKey(id[p.I[t * 3 + k]], id[p.I[t * 3 + ((k + 1) % 3)]])
      own.set(e, (own.get(e) ?? 0) + 1)
    }
    let single = 0
    for (const v of own.values()) if (v === 1) single++
    const s = { pid, tris: members.length, area, centroid: g, volume: area ? volume / area ** 1.5 : 0, open: single / (own.size || 1), mixed: members.some((t) => sign[t] < 0) }
    // true: the patch, made consistent, is turned over. false: it stays as it was stored. 'consistent': made consistent, no more.
    // Otherwise, by vote (the way most of its own surface already faced: a shell with a few strips the wrong way),
    // or by its volume when it is closed enough to have one; and when neither can tell, as it was stored.
    let turn = decide?.(s)
    if (turn === 'consistent') turn = null
    else if (turn === undefined) {
      if (vote) turn = against > area / 2
      else if (s.open <= maxOpen && Math.abs(s.volume) > minVolume) turn = s.volume < 0
      else turn = false
    }
    const keep = turn === false && (decide?.(s) === false || !(vote || (s.open <= maxOpen && Math.abs(s.volume) > minVolume)))
    s.flipped = turn
    if (turn) for (const t of members) sign[t] *= -1
    else if (keep) for (const t of members) sign[t] = 1
    stats.push(s)
  }
  const changed = []
  for (let t = 0; t < T; t++) if (sign[t] < 0) { [p.I[t * 3 + 1], p.I[t * 3 + 2]] = [p.I[t * 3 + 2], p.I[t * 3 + 1]]; changed.push(t * 3) }
  // Stored normals follow their triangles: each vertex agrees with the first triangle that uses it.
  if (changed.length) alignNormals(p, Array.from({ length: T }, (_, t) => t * 3))
  return stats
}

