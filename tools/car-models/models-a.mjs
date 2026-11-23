// Model configs, set A. See models.mjs for the Nexia as the worked example.
import { band } from './lamps.mjs'
import { MeshoptSimplifier } from 'meshoptimizer'

/**
 * Gets a part ready before process.mjs gathers it, in its rotated but unscaled units.
 *
 * Welds it: one vertex per position and normal (and texture coordinate, when its texture
 * matters). Both models come with the corners of their faces split into copies, and the
 * simplifier locks a vertex with more than two copies, so unwelded the near LOD stays at the
 * raw count. A part drawn in one colour has its texture coordinates pinned to one point
 * first: they carry nothing, and their seams would lock it just the same.
 *
 * Keeps only the faces `keep(centre, normal)` accepts, when given; and only the faces turned
 * away from `from` (a point inside the car), when given: glass is modelled as two skins a few
 * millimetres apart, and simplified they cut through each other.
 *
 * Then simplifies it to what shows from a few metres: no collapse that moves the surface by
 * more than `mm` millimetres (`perMetre` units to a metre). An error in millimetres, rather
 * than a share of each part, spends the triangles where the shape needs them: a body panel
 * gives up most of its own, a thin chrome strip keeps the ones that make it a strip. The
 * near budget in process.mjs then has nothing left to do.
 */
function prepare(part, { uv = false, uvWeight = 2, pin = null, smooth = false, from = null, keep = null, mm = 0, perMetre = 1 } = {}) {
  const { P, N, U } = part
  if (pin) for (let i = 0; i < U.length; i += 2) { U[i] = pin[0]; U[i + 1] = pin[1] }
  const n = P.length / 3
  const ids = new Map(), remap = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`
    // 'smooth': by position alone, for parts modelled with a normal per face, the normals then averaged.
    if (!smooth) k += `|${Math.round(N[i * 3] * 50)},${Math.round(N[i * 3 + 1] * 50)},${Math.round(N[i * 3 + 2] * 50)}`
    if (uv) k += `|${Math.round(U[i * 2] * 8192)},${Math.round(U[i * 2 + 1] * 8192)}`
    let v = ids.get(k)
    if (v === undefined) ids.set(k, (v = i))
    remap[i] = v
  }
  if (smooth) {
    const sum = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) sum[remap[i] * 3 + d] += N[i * 3 + d]
    for (let i = 0; i < n; i++) if (remap[i] === i) {
      const l = Math.hypot(sum[i * 3], sum[i * 3 + 1], sum[i * 3 + 2]) || 1
      for (let d = 0; d < 3; d++) N[i * 3 + d] = sum[i * 3 + d] / l
    }
  }
  const J = []
  for (let t = 0; t < part.I.length; t += 3) {
    const a = remap[part.I[t]], b = remap[part.I[t + 1]], c = remap[part.I[t + 2]]
    if (a === b || b === c || a === c) continue
    if (keep) {
      const o = [0, 1, 2].map((d) => (P[a * 3 + d] + P[b * 3 + d] + P[c * 3 + d]) / 3)
      const v = [0, 1, 2].map((d) => N[a * 3 + d] + N[b * 3 + d] + N[c * 3 + d])
      if (!keep(o, v)) continue
    }
    if (from) {
      const e = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]]
      const f = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]]
      const g = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]]
      const o = [0, 1, 2].map((d) => (P[a * 3 + d] + P[b * 3 + d] + P[c * 3 + d]) / 3 - from[d])
      if (g[0] * o[0] + g[1] * o[1] + g[2] * o[2] <= 0) continue
    }
    J.push(a, b, c)
  }
  part.I = Uint32Array.from(J)
  if (!mm || part.I.length < 60) return
  // The simplifier wants only the vertices in use, numbered from 0.
  const at = new Int32Array(n).fill(-1), back = []
  for (const i of part.I) if (at[i] < 0) { at[i] = back.length; back.push(i) }
  const Q = new Float32Array(back.length * 3), A = new Float32Array(back.length * 5)
  // Its outermost vertex at either end stays where it is, so the part's length, and the car's, is the model's.
  const lock = new Uint8Array(back.length)
  for (let d = 0; d < 1; d++) {
    let lo = 0, hi = 0
    back.forEach((i, j) => { if (P[i * 3 + d] < P[back[lo] * 3 + d]) lo = j; if (P[i * 3 + d] > P[back[hi] * 3 + d]) hi = j })
    lock[lo] = lock[hi] = 1
  }
  back.forEach((i, j) => {
    Q.set(P.subarray(i * 3, i * 3 + 3), j * 3)
    // Normals count for a little, so shading holds; texture coordinates as much as asked (process.mjs: 2).
    A.set([N[i * 3] * 0.05, N[i * 3 + 1] * 0.05, N[i * 3 + 2] * 0.05, uv ? U[i * 2] * uvWeight : 0, uv ? U[i * 2 + 1] * uvWeight : 0], j * 5)
  })
  const [K] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(part.I, (i) => at[i]), Q, 3, A, 5, [1, 1, 1, 1, 1], lock, 36, (mm / 1000) * perMetre, ['ErrorAbsolute'])
  part.I = Uint32Array.from(K, (j) => back[j])
}

/**
 * The connected piece a triangle belongs to, as a box { lo, hi, n }: for taking a badge's
 * letters out of a part that holds other trim too. Keyed by the triangle's centre, computed
 * exactly as process.mjs computes it.
 */
const pieces = new WeakMap()
const centreKey = (x, y, z) => `${x},${y},${z}`
function piece(ctx) {
  const p = ctx.part
  let byCentre = pieces.get(p)
  if (!byCentre) {
    const { P, I } = p
    const ids = new Map(), at = new Int32Array(P.length / 3)
    for (let i = 0; i < at.length; i++) {
      const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`
      let v = ids.get(k)
      if (v === undefined) ids.set(k, (v = ids.size))
      at[i] = v
    }
    const up = Int32Array.from({ length: ids.size }, (_, i) => i)
    const find = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i] } return i }
    for (let t = 0; t < I.length; t += 3) {
      const a = find(at[I[t]])
      up[find(at[I[t + 1]])] = a
      up[find(at[I[t + 2]])] = a
    }
    const boxes = new Map()
    for (let t = 0; t < I.length; t += 3) {
      const r = find(at[I[t]])
      let b = boxes.get(r)
      if (!b) boxes.set(r, (b = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], n: 0 }))
      b.n++
      for (let k = 0; k < 3; k++) for (let d = 0; d < 3; d++) {
        const x = P[I[t + k] * 3 + d]
        if (x < b.lo[d]) b.lo[d] = x
        if (x > b.hi[d]) b.hi[d] = x
      }
    }
    byCentre = new Map()
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3
      byCentre.set(centreKey((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3), boxes.get(find(at[I[t]])))
    }
    pieces.set(p, byCentre)
  }
  return byCentre.get(centreKey(...ctx.centre))
}
/** Whether a box lies inside [x0, x1, y0, y1, z0, z1], z by its distance from the centreline. */
const within = (b, [x0, x1, y0, y1, z0, z1]) => !!b && b.lo[0] >= x0 && b.hi[0] <= x1 && b.lo[1] >= y0 && b.hi[1] <= y1 &&
  (b.lo[2] >= 0 || b.hi[2] <= 0 ? Math.min(Math.abs(b.lo[2]), Math.abs(b.hi[2])) : 0) >= z0 && Math.max(Math.abs(b.lo[2]), Math.abs(b.hi[2])) <= z1

/** An sRGB colour, 0–255, as a linear glTF base colour factor. */
const linear = (...c) => [...c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }), 1]

// ---------------------------------------------------------------- the Malibu
// Its glTF materials were renamed on export (most are called woodshiny); the node names keep
// the real ones: PolySurface0.048_template_carpaint.002_0 is carpaint.002 on node PolySurface0.048.
const malibuName = (node) => /_template_(.+?)_\d+$/.exec(node)?.[1] ?? ''
const malibuNode = (node) => node.split('_template_')[0]
// Seats, dashboard, carpets, headlining, door cards, the inner door handles and sill plates.
const MALIBU_INTERIOR = /^(leather.*|plasticdiffuse\.00[3-9]|plasticdiffuse\.010|plasticdiffuse__leather.*|carbonrough|selfillumdiffuse.*|plasticshiny\.001|plasticshiny__red|plasticrough\.00[12]|plasticrough__seatbelt|chrome|chrome\.01[5-8]|woodshiny.*|blackpaint|blackpaint\.0(0[5-9]|1[0-2])|aluminiumbrushed|aluminiumbrushed\.001|aluminiumbrushed__chevrolet.*|carpaint\.00[678])$/
const malibuGone = (name, node) =>
  MALIBU_INTERIOR.test(name) ||
  // The inside faces of the door frames and the jambs: hidden with the doors shut.
  node === 'PolySurface0.013' || node === 'PolySurface0.064' ||
  // Badges that are parts of their own: the bowties (grille, boot lid, every wheel cap) and the
  // black behind the front one, TURBO on the boot lid. And the plates.
  /^goldshiny/.test(name) || name === 'plasticshiny' || node === 'PolySurface0.045' || name === 'plasticshiny__plates' ||
  // The lenses over the tail lamps, the headlamps, the third brake light and the camera: they would
  // hide the lamps, which show through them as they did. A tiny bowtie and its bezel in each headlamp.
  node === 'PolySurface0.035' || node === 'PolySurface0.041' || node === 'PolySurface0.038' || node === 'PolySurface0.056' || name === 'chrome.006'

// The amber copy of a material, made once.
const amber = new Map()
// Raw units to a metre, and a point in the cabin, in its rotated but unscaled units.
const MALIBU_PER_M = 6.816 / 4.923
const MALIBU_CABIN = [-0.27, 1.25, 0]
/** How far, in millimetres, simplifying may move each part of it. */
const malibuMM = (name, node) =>
  /^aluminiumbrushed/.test(name) ? 6 :
  /^chrome\.02[0-2]$/.test(name) || node === 'PolySurface0.118' ? 9 :
  /^tyres|^carpaint\.002/.test(name) ? 5 :
  name === 'chrome.001' && /^PolySurface(0\.036|0\.037|0\.031|1\.006)$/.test(node) ? 12 :
  /^chrome(\.001)?$|^chromered$/.test(name) ? 7 :
  /discbrake/.test(name) ? 25 :
  /^(plasticdiffuse|plasticrough|blackpaint__linepattern|carpaint__sensor)$/.test(name) ? 12 : 7

/**
 * Fills a tyre's tread: every vertex near the outside of the tyre goes out onto one cylinder about
 * its axle, facing out. The tread's blocks and grooves are a centimetre deep, too fine to see from
 * the pavement and too coarse for the simplifier, which keeps every block as a lump; filled, the
 * tread simplifies to a smooth round tyre. The part may hold both tyres of an axle.
 *
 * Also tucks the sidewall inside `bead` (a radius) in towards the car by `tuck`, fading out over
 * the next `tuck` of radius: under the rim's lip it sat at the lip's own depth, and simplified
 * the two cut through each other in a ring of teeth.
 */
function fillTread(part, depth, bead, tuck) {
  const { P, N } = part
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]) }
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, cz = (lo[2] + hi[2]) / 2, R = (hi[1] - lo[1]) / 2
  for (let i = 0; i < P.length; i += 3) {
    const dx = P[i] - cx, dy = P[i + 1] - cy, r = Math.hypot(dx, dy)
    if (r < bead + tuck) P[i + 2] -= Math.sign(P[i + 2] - cz) * tuck * Math.min(1, (bead + tuck - r) / tuck)
    if (r < R - depth) continue
    P[i] = cx + (dx / r) * R
    P[i + 1] = cy + (dy / r) * R
    N[i] = dx / r
    N[i + 1] = dy / r
    N[i + 2] = 0
  }
}

/**
 * Adds a vertex no face uses, so the box process.mjs centres the car on is the body's own: a car
 * with one door mirror is otherwise centred half a mirror off its centreline. The vertex goes
 * where a second mirror would be, `at` mirrored about z = `centre`, and is gone once the faces
 * are gathered.
 */
function balance(part, at, centre) {
  const add = (A, v) => { const B = new Float32Array(A.length + v.length); B.set(A); B.set(v, A.length); return B }
  part.P = add(part.P, [at[0], at[1], 2 * centre - at[2]])
  part.N = add(part.N, [0, 1, 0])
  part.U = add(part.U, [0, 0])
}

/**
 * Replaces a part's faces with flat quads, each [corners (4, in order round it), normal]: for a
 * backdrop that stands in for something that would cost hundreds of faces. The winding follows
 * the normal; texture coordinates are pinned to `pin`.
 */
function quads(part, list, pin = [0.5, 0.5]) {
  const P = [], N = [], U = [], I = []
  for (const [corners, n] of list) {
    const [a, b, c] = corners
    const g = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]
    const k = P.length / 3
    for (const v of corners) { P.push(...v); N.push(...n); U.push(...pin) }
    I.push(...(g[0] * n[0] + g[1] * n[1] + g[2] * n[2] >= 0 ? [k, k + 1, k + 2, k, k + 2, k + 3] : [k, k + 2, k + 1, k, k + 3, k + 2]))
  }
  part.P = new Float32Array(P)
  part.N = new Float32Array(N)
  part.U = new Float32Array(U)
  part.I = new Uint32Array(I)
}

/**
 * The top of each connected piece of a part, as a quad a little under it: for a lattice over an
 * opening, replaced by a dark panel filling the opening. Each piece's top is taken as a plane
 * sloping along x, from its highest points at either end.
 */
function tops(part, below) {
  const { P, I } = part
  const ids = new Map(), at = new Int32Array(P.length / 3)
  for (let i = 0; i < at.length; i++) {
    const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`
    if (!ids.has(k)) ids.set(k, ids.size)
    at[i] = ids.get(k)
  }
  const up = Int32Array.from({ length: ids.size }, (_, i) => i)
  const find = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i] } return i }
  for (let t = 0; t < I.length; t += 3) { const a = find(at[I[t]]); up[find(at[I[t + 1]])] = a; up[find(at[I[t + 2]])] = a }
  const groups = new Map()
  for (let i = 0; i < at.length; i++) { const r = find(at[i]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i) }
  const list = []
  for (const verts of groups.values()) {
    const xs = verts.map((i) => P[i * 3]), zs = verts.map((i) => P[i * 3 + 2])
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs)
    const top = (near) => Math.max(...verts.filter((i) => Math.abs(P[i * 3] - near) < 0.01).map((i) => P[i * 3 + 1])) - below
    const y0 = top(x0), y1 = top(x1)
    const n = [y0 - y1, x1 - x0, 0], l = Math.hypot(...n)
    list.push([[[x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1]], n.map((v) => v / l)])
  }
  quads(part, list)
}

// ---------------------------------------------------------------- the VAZ-2106
// Every mesh node is called defaultMaterial and its parent has the name, so the parts are told
// apart by material and size. Its textures are atlases of flat colours, one patch per face.
const vazKey = (part) => `${part.material}:${part.I.length / 3}`
// Steering column and wheel, dashboard, the mirror inside, the trim inside.
const VAZ_INTERIOR = new Set(['Plastic:4489', 'Plastic:11656', 'Plastic:1860', 'Plastic:240', 'Plastic:272', 'Plastic:496', 'Plastic:1164'])
// Parts in one colour, read off their atlas: drawn untextured in it.
const VAZ_FLAT = { Chrome: linear(140, 156, 169), Plastic: linear(17, 17, 17), Rubber: linear(47, 42, 36), Wheel_steel: linear(160, 160, 160), Metal: linear(150, 152, 155) }
const VAZ_AMBER = linear(255, 150, 20)
// The headlamps' own material, made once.
const headlamp = new Map()
const VAZ_PER_M = 4.376 / 4.166
// Its one door mirror reaches z = -0.8784 (rotated raw units); without it the body spans -0.7892 to 0.8784.
const VAZ_MIRROR = [0.82, 0.23, -0.8784], VAZ_CENTRE = 0.0446
const VAZ_CABIN = [-0.05, 0.21, 0.045]
const vazGone = (part) =>
  ['Leather', 'Seats', 'Wood'].includes(part.material) || VAZ_INTERIOR.has(vazKey(part)) ||
  // The gearbox and shaft, axles and springs, exhaust, the tank: none of it shows. The engine stays
  // as a stand-in for its radiator (see drop below).
  (part.material === 'Metal' && vazKey(part) !== 'Metal:19346') ||
  // The headlamps' insides: their lenses are what shows, as they did.
  vazKey(part) === 'Headlights:11176'
// Behind the grille, in rotated raw units: the grille's six openings span y -0.177 to -0.001 and
// z -0.284 to 0.376; the back of its panel is at x 1.956.
const VAZ_RADIATOR = [[[1.95, -0.19, -0.3], [1.95, -0.19, 0.39], [1.95, 0.01, 0.39], [1.95, 0.01, -0.3]], [1, 0, 0]]

export const MODELS_A = {
  malibu: {
    file: '2021_chevrolet_malibu_2lz_premier.glb',
    // Its front is -z.
    turn: -90,
    length: 4.923,
    // prepare() leaves about 10700 faces of body, and process.mjs's budget takes them to 9000: it does that
    // more gently than a looser error would. A wheel is as prepare() leaves it (about 1150).
    near: 9000,
    wheelNear: 1200,
    // Where the seats were: inside the glass all round, above the wheel arches (the finished car's metres).
    cabin: [-1.45, 0.55, 0.8, 1.22, -0.66, 0.66],
    // Where its own plates were (their outer faces): centre x, y, z, width, height, in the finished car.
    plates: { front: [2.417, 0.469, 0, 0.469, 0.119], rear: [-2.354, 0.819, 0, 0.466, 0.103] },
    credit: { title: '2021 Chevrolet Malibu 2LZ Premier', author: 'twr422', url: 'https://sketchfab.com/3d-models/c1e8e127ce114b14a166e93100642424', license: 'CC BY 4.0' },
    // Its only textures are flat: the rims' 8 × 8 grey and the brake discs' brushed metal.
    textureSize: () => 8,
    drop(part) {
      const name = malibuName(part.node), node = malibuNode(part.node)
      if (malibuGone(name, node)) return true
      // The indicators on the mirrors share a grey with the bezels in the headlamps: give them their amber.
      if (name === 'chrome__linepattern.001' || name === 'chrome__linepattern') {
        if (!amber.has(part.mat)) amber.set(part.mat, part.mat.clone().setName('mirror_indicator').setBaseColorFactor(linear(255, 150, 20)).setMetallicFactor(0).setRoughnessFactor(0.3))
        part.mat = amber.get(part.mat)
        part.material = 'mirror_indicator'
      }
      // Of a rim and a brake disc, the faces turned in towards the car never show.
      const wheel = /^aluminiumbrushed\.00[2-5]$|discbrake/.test(name)
      prepare(part, {
        pin: [0.5, 0.5], from: /^glasstinted/.test(name) ? MALIBU_CABIN : null, mm: malibuMM(name, node), perMetre: MALIBU_PER_M,
        keep: wheel ? (c, n) => n[2] * Math.sign(c[2]) > -0.5 * Math.hypot(...n) : null,
      })
      return false
    },
    role(ctx) {
      const { part, centre: c, normal: n } = ctx
      const name = malibuName(part.node), node = malibuNode(part.node)
      // Faces nobody sees: the backs of the grille's slats, towards the engine bay.
      if (c[0] > 1.95 && c[1] < 0.85 && n[0] < -0.3 && /^(plasticdiffuse|plasticrough|blackpaint__linepattern|chrome\.001)$/.test(name) && node !== 'PolySurface0.036' && node !== 'PolySurface0.037') return null
      // Badges in with the chrome: MALIBU, the TURBO surround, the bowtie's rim and PREMIER on the boot
      // lid; the front bowtie's rim; MALIBU on both front doors.
      if (name === 'chrome.001' && c[0] < -2.3 && c[1] > 0.94 && c[1] < 0.995) return null
      if (name === 'chrome.001' && within(piece(ctx), [2.34, 2.46, 0.59, 0.67, 0, 0.095])) return null
      if (name === 'chrome.001' && c[0] > 0.55 && c[0] < 0.9 && c[1] > 0.62 && c[1] < 0.68 && Math.abs(c[2]) > 0.88) return null
      // Wheels: tyres; rims, caps and nuts, brake discs.
      if (/^tyres/.test(name)) return 'tyre'
      // The brake discs; the callipers stay out (they would turn with the wheel, and the spokes hide
      // them), and so do the thin rings on the discs' faces.
      if (/discbrake/.test(name)) { const b = piece(ctx); return !b || b.hi[0] - b.lo[0] < 0.2 || b.hi[2] - b.lo[2] < 0.03 ? null : 'rim' }
      if (/^aluminiumbrushed\.00[2-5]$/.test(name) || /^chrome\.02[0-2]$/.test(name) || node === 'PolySurface0.118') return 'rim'
      // Inside a lamp, only what faces out through where its lens was can be seen.
      const rear = (r) => (n[0] > 0.2 ? null : r), front = (r) => (n[0] < -0.2 ? null : r)
      // Tail lamps: what is red in them (the housing, the light guides) and the third brake light. Their
      // silver reflectors, the reversing lamps' among them, are chrome. The red reflectors low on the
      // bumper are not lamps.
      if (/^(lightred|chromered__squarepattern\.001|chrome__linepattern\.002)$/.test(name)) return rear('lamp_rear')
      if (name === 'chromered') return c[1] < 0.6 ? 'detail' : rear('lamp_rear')
      if (/^(chrome__squarepattern\.001|chrome__linepattern\.004|glassclear__squarepattern)$/.test(name)) return rear('chrome')
      if (name === 'chrome.001' && (node === 'PolySurface1.006' || node === 'PolySurface0.031')) return rear('chrome')
      if (name === 'chromered__squarepattern' || name === 'glassclear.003') return 'detail'
      // Indicators: amber in the corner of each headlamp, and on the mirrors.
      if (name === 'chrome__squarepattern' || name === 'chrome__linepattern.001' || name === 'chrome__linepattern') return 'lamp_turn'
      // Headlamps (reflectors and projectors) and the lamps low in the bumper corners.
      if (/^(lightwarm|lightcold|chrome__linepattern\.00[35]|chrome\.011|glassclear__linepattern|glassclear|glassclear\.002|glassclear__squarepattern\.001)$/.test(name)) return front('lamp_front')
      if (name === 'chrome.001' && (node === 'PolySurface0.036' || node === 'PolySurface0.037')) return front('lamp_front')
      if (/^carpaint/.test(name)) return 'paint'
      if (/^chrome/.test(name)) return 'chrome'
      if (/^glasstinted/.test(name)) return 'glass'
      if (/^(plasticrough|plasticdiffuse|plasticdiffuse\.00[12]|blackpaint\.001|blackpaint__linepattern)$/.test(name)) return 'trim'
      return 'detail'
    },
  },
  vaz2106: {
    file: 'vaz-2106.glb',
    // Its front is +z.
    turn: 90,
    length: 4.166,
    // The near LOD is as prepare() leaves it (about 8970 faces of body, 1200 for a wheel): these are ceilings.
    near: 9200,
    wheelNear: 1250,
    // Where the seats were: inside the glass all round, above the wheel arches (the finished car's metres).
    cabin: [-1.15, 0.36, 0.8, 1.32, -0.62, 0.62],
    // Where its own front plate was (its outer face), in the finished car. It has no rear plate: the rear
    // one goes where a 2106 has it, on the panel between the tail lamps (its two holes are there), at the
    // front's size.
    plates: { front: [1.829, 0.434, 0, 0.467, 0.126], rear: [-2.177, 0.65, 0, 0.467, 0.126] },
    sampleTextures: true,
    // The paint, texel by texel: a sandy beige, dirt and shade baked in. The black of the seals and
    // the grey of the bits baked into the same sheet are not paint.
    paintTexel: (h, s, v) => band(h, 12, 48, 8) * band(s, 0.12, 0.62, 0.06) * Math.min(1, Math.max(0, (v - 0.16) / 0.14)),
    credit: { title: 'VAZ-2106', author: 'domhathair', url: 'https://sketchfab.com/3d-models/a73b3cdeddd846209bf7c73d5f04d20f', license: 'CC BY 4.0' },
    textureSize: (role) => (role === 'skin' ? 512 : 256),
    keepTexture: (role, mat) => role !== 'glass' && role !== 'lamp_turn' && !VAZ_FLAT[mat?.getName()],
    drop(part) {
      if (vazGone(part)) return true
      // Its name, before welding changes its count.
      part.vaz = vazKey(part)
      const m = part.material
      const o = { mm: 4, perMetre: VAZ_PER_M }
      if (part.vaz === 'Steel:11487') balance(part, VAZ_MIRROR, VAZ_CENTRE)
      // The engine bay is empty: of the engine, one light grey panel behind the grille, where its radiator was.
      if (part.vaz === 'Metal:19346') {
        part.mat.setBaseColorFactor(VAZ_FLAT.Metal)
        quads(part, [VAZ_RADIATOR])
        return false
      }
      // The two vent grilles in the bonnet are a lattice of 2120 faces: a black panel in each opening.
      if (part.vaz === 'Plastic:2120') {
        part.mat.setBaseColorFactor(VAZ_FLAT.Plastic)
        tops(part, 0.004)
        return false
      }
      if (m === 'Rubber') fillTread(part, 0.016, 0.2, 0.015)
      if (VAZ_FLAT[m]) {
        part.mat.setBaseColorFactor(VAZ_FLAT[m])
        // The tyres and wheels were modelled flat-shaded, a normal per face: welded by position, smooth.
        prepare(part, {
          ...o, pin: [0.5, 0.5], smooth: m === 'Rubber' || m === 'Wheel_steel',
          // The grille is a black panel with a grid of slots a centimetre or two wide: it keeps them.
          mm: part.vaz === 'Plastic:3124' ? 6 : { Rubber: 10, Wheel_steel: 7, Plastic: 12, Chrome: 5 }[m],
          // Of the engine, only the radiator behind the grille and the tops under the bonnet vents.
          // A wheel's dish is two skins; the inner one, towards the car, never shows and once
          // simplified it pokes through the outer.
          keep: m === 'Wheel_steel' ? (c, n) => n[2] * Math.sign(c[2] - VAZ_CENTRE) > -0.3 * Math.hypot(...n) : null,
        })
      } else if (part.vaz === 'Glass:2030') {
        // The headlamps' lenses, in the light grey of the reflectors that showed through them: the lamps'
        // sheet, on a material of their own so the amber below stays off them.
        if (!headlamp.has(part.mat)) {
          const lamps = part.mat.listParents().find((p) => p.propertyType === 'Root').listMaterials().find((x) => x.getName() === 'Headlights')
          headlamp.set(part.mat, lamps.clone().setName('Headlamp').setBaseColorFactor([1, 1, 1, 1]))
        }
        part.mat = headlamp.get(part.mat)
        part.material = 'Headlamp'
        prepare(part, { ...o, pin: [0.62, 0.08], mm: 4 })
      } else if (m === 'Glass') prepare(part, { ...o, pin: [0.5, 0.5], from: VAZ_CABIN, mm: 8 })
      // The other lamps share one sheet, which has no amber in it: its colour factor is amber, untextured
      // for the indicators (see keepTexture) and over the texture for the rest, where it deepens the tail
      // lamps' faded salmon to a red and leaves their black housings black.
      else if (m === 'Headlights') {
        part.mat.setBaseColorFactor(VAZ_AMBER)
        prepare(part, { ...o, uv: true })
      }
      // The body's sheet is baked dirt and shade: let its texture slide a little rather than keep every seam.
      // The plate under the engine shows only from low down in front.
      else if (m === 'Steel') prepare(part, { ...o, uv: true, uvWeight: 0.5, mm: part.vaz === 'Steel:496' ? 20 : 6 })
      else prepare(part, { ...o, uv: true })
      return false
    },
    role(ctx) {
      const { part, centre: c, hsv } = ctx
      const [, , v] = hsv
      const m = part.material
      if (m === 'Rubber') return 'tyre'
      if (m === 'Wheel_steel') return 'rim'
      // The underside of the floor pan, between the sills and the axles, is seen from nowhere a walker stands.
      if (m === 'Steel') return ctx.normal[1] < -0.5 && c[1] < 0.45 && Math.abs(c[2]) < 0.55 && c[0] > -0.75 && c[0] < 1.1 ? null : 'skin'
      // The panel standing in for the radiator.
      if (m === 'Metal') return 'detail'
      if (m === 'Glass') return 'glass'
      if (m === 'Chrome') {
        // The front plate and its two bolts, on the bumper.
        if (part.vaz === 'Chrome:176' && within(piece(ctx), [2.0, 2.05, 0.36, 0.5, 0, 0.28])) return null
        return 'chrome'
      }
      // The headlamps' lenses.
      if (m === 'Headlamp') return 'lamp_front'
      if (m === 'Headlights') {
        // Under the headlamps, and on the front wings: the indicators. On the rear wings: markers.
        if (part.vaz === 'Headlights:96') return 'lamp_turn'
        if (part.vaz === 'Headlights:40') return c[0] > 0 ? 'lamp_turn' : 'lamp_rear'
        // The tail lamps: the black block inboard is housing, the outer cells are the indicators.
        if (v < 0.25) return 'trim'
        return Math.abs(c[2]) > 0.513 ? 'lamp_turn' : 'lamp_rear'
      }
      if (m === 'Plastic') return 'trim'
      return 'detail'
    },
  },
}
