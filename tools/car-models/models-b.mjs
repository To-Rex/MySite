// Model configs, set B. See models.mjs for the Nexia as the worked example.
import { lamp, band } from './lamps.mjs'
import { orient } from './orient-b.mjs'
import { MeshoptSimplifier } from 'meshoptimizer'

await MeshoptSimplifier.ready

/** Is a point within r of a wheel's axle (in x and y), and in that wheel's slice of z? */
const nearAxle = (c, wheels, r, z0, z1) => wheels.some(([x, y]) => Math.hypot(c[0] - x, c[1] - y) < r) && Math.abs(c[2]) > z0 && Math.abs(c[2]) < z1

/**
 * Turns over what a model's author mirrored without turning it: a part named in `orientation`
 * gets its patches put the right way out (see orient-b.mjs) before anything is measured.
 * The options may give `where(centroid in metres)`: false keeps a patch as it is.
 */
function orientParts(cfg, p) {
  const o = cfg.orientation?.[p.node] ?? cfg.orientation?.[p.material]
  if (!o) return
  const [cx, cy, cz, s] = cfg.rawFrame
  const toMetres = (g) => [(g[0] - cx) * s, (g[1] - cy) * s, (g[2] - cz) * s]
  orient(p, {
    ...o,
    decide: (st) => {
      const m = toMetres(st.centroid)
      if (o.where && !o.where(m)) return false
      return o.flip?.(m, st)
    },
  })
}

/** Turns over each triangle of a part whose centre (metres, bbox-centred car) passes the test; its vertices' normals go with it. */
function turnTriangles(cfg, p, test) {
  const [cx, cy, cz, s] = cfg.rawFrame
  const seen = new Set()
  for (let t = 0; t < p.I.length; t += 3) {
    const c = [0, 1, 2].map((k) => ((p.P[p.I[t] * 3 + k] + p.P[p.I[t + 1] * 3 + k] + p.P[p.I[t + 2] * 3 + k]) / 3 - [cx, cy, cz][k]) * s)
    if (!test(c)) continue
    ;[p.I[t + 1], p.I[t + 2]] = [p.I[t + 2], p.I[t + 1]]
    for (let k = 0; k < 3; k++) {
      const v = p.I[t + k]
      if (seen.has(v)) continue
      seen.add(v)
      p.N[v * 3] *= -1; p.N[v * 3 + 1] *= -1; p.N[v * 3 + 2] *= -1
    }
  }
}

/**
 * Cuts out of a part, before anything is measured, the triangles whose centre (metres, bbox-centred car)
 * passes the test, and the vertices only they used: a number plate that is the car's frontmost point
 * would otherwise set its length.
 */
function cut(cfg, p, test) {
  const [cx, cy, cz, s] = cfg.rawFrame
  const keep = []
  for (let t = 0; t < p.I.length; t += 3) {
    const c = [0, 1, 2].map((k) => ((p.P[p.I[t] * 3 + k] + p.P[p.I[t + 1] * 3 + k] + p.P[p.I[t + 2] * 3 + k]) / 3 - [cx, cy, cz][k]) * s)
    if (!test(c)) keep.push(p.I[t], p.I[t + 1], p.I[t + 2])
  }
  const remap = new Int32Array(p.P.length / 3).fill(-1)
  let n = 0
  for (const v of keep) if (remap[v] < 0) remap[v] = n++
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2)
  for (let v = 0; v < remap.length; v++) {
    const j = remap[v]
    if (j < 0) continue
    P.set(p.P.subarray(v * 3, v * 3 + 3), j * 3)
    N.set(p.N.subarray(v * 3, v * 3 + 3), j * 3)
    U.set(p.U.subarray(v * 2, v * 2 + 2), j * 2)
  }
  Object.assign(p, { P, N, U, I: Uint32Array.from(keep, (v) => remap[v]) })
}

/** Pulls a part towards a point (metres, in the bbox-centred car) by the given factors. */
function shrink(cfg, p, [mx, my, mz], [fx, fy, fz]) {
  const [cx, cy, cz, s] = cfg.rawFrame
  const o = [cx + mx / s, cy + my / s, cz + mz / s]
  for (let i = 0; i < p.P.length; i += 3) {
    p.P[i] = o[0] + (p.P[i] - o[0]) * fx
    p.P[i + 1] = o[1] + (p.P[i + 1] - o[1]) * fy
    p.P[i + 2] = o[2] + (p.P[i + 2] - o[2]) * fz
  }
}

/**
 * Thins a dense part in place before the pipeline sees it, to an error given in metres rather than
 * as a share of the whole car: the pipeline's own pass cannot get past a part's hard edges, and a
 * mirror shell of 2000 triangles or a rim of 7000 then eats the car's budget. Hard edges (normals)
 * and texture seams still count, through the attributes.
 */
function reduce(cfg, p, metres, { permissive = false, prune = false, uv = 2, lock = null } = {}) {
  const [cx, cy, cz, s] = cfg.rawFrame
  const n = p.P.length / 3
  const attrs = new Float32Array(n * 5)
  for (let i = 0; i < n; i++) attrs.set([p.N[i * 3] * 0.5, p.N[i * 3 + 1] * 0.5, p.N[i * 3 + 2] * 0.5, p.U[i * 2] * uv, p.U[i * 2 + 1] * uv], i * 5)
  const flags = ['ErrorAbsolute', ...(permissive ? ['Permissive'] : []), ...(prune ? ['Prune'] : [])]
  const before = p.I.length / 3
  // lock(vertex in metres): vertices that must stay where they are (another role's, sharing the part).
  const locked = lock ? Uint8Array.from({ length: n }, (_, i) => (lock([(p.P[i * 3] - cx) * s, (p.P[i * 3 + 1] - cy) * s, (p.P[i * 3 + 2] - cz) * s]) ? 1 : 0)) : null
  const [I] = MeshoptSimplifier.simplifyWithAttributes(p.I, p.P, 3, attrs, 5, [1, 1, 1, 1, 1], locked, 3, metres / s, flags)
  p.I = Uint32Array.from(I)
  if (process.env.REDUCE_LOG) console.log(`reduce ${p.node}|${p.material}: ${before} -> ${p.I.length / 3}`)
}

export const MODELS_B = {
  damas: {
    file: 'chevrolet_damas.glb',
    // Its front is -x. A cab-over microvan: the driver sits on the left, over the front wheels.
    turn: 180,
    length: 3.495,
    // Raw (turned) bbox centre x, ground y, centre z, and the scale to metres: for orientParts.
    rawFrame: [-0.02945, -0.6821, 0, 0.40429],
    // Front axle x, rear axle x, axle height (measured from the tyres).
    axles: [[0.817, 0.283], [-1.058, 0.283]],
    credit: { title: 'Chevrolet Damas', author: 'own.guest', url: 'https://sketchfab.com/3d-models/70f8556e4b3840e7b975f0e000b54757', license: 'CC BY 4.0' },
    // Mirrored halves the author left inside out (the raw model is drawn double-sided; the walk is not).
    orientation: {
      material_2: {}, material_9: {}, material_12: {}, material_8: {}, material_10: {}, material_14: {},
      material_7: {},
      // The mirror stays (its wheel parts are left alone: only the front-right wheel is used, and it is right).
      material_15: { where: (m) => m[1] > 0.7 },
      // The doors and the tailgate (whose two halves disagree with each other).
      Object_12: {},
      // The shell: right but for the B-pillars' strips, so the way most of it faces wins.
      Object_13: { vote: true },
      // The lamps' reflectors.
      material_13: { flip: (m) => (m[2] > 0 ? true : 'consistent') },
      // The mirror glass faces backwards; the right-hand one is inside out.
      material: { flip: (m) => m[2] > 0 },
    },
    drop(p) {
      // Object_20: flat slivers under the floor. material_11: a clear lens drawn fully transparent.
      // Object_15/16 (material_4) and material_6: the seats and their frames, the dashboard. The lining (Object_14) stays, as the cabin's dark.
      if (['Object_20', 'Object_15', 'Object_16'].includes(p.node) || ['material_11', 'material_6'].includes(p.material)) return true
      orientParts(this, p)
      // The lining sits a hair inside the roof and walls: pulled in a little, so that thinning either cannot push it through.
      if (p.node === 'Object_14') {
        shrink(this, p, [0, 1.15, 0], [0.985, 0.92, 0.94])
        // Its wheel-arch humps face the cabin; from outside it is their other side that shows.
        turnTriangles(this, p, (c) => c[1] < 0.66 && this.axles.some(([x]) => Math.abs(c[0] - x) < 0.5))
      }
      // No texture: its texture coordinates mean nothing, and would only hold the simplifier back.
      if (!p.mat?.getBaseColorTexture()) p.U.fill(0)
      const r = this.reduction[p.node] ?? this.reduction[p.material] ?? this.reduction.default
      if (r) reduce(this, p, r.metres ?? r, r)
      return false
    },
    near: 9000,
    // The wheel's parts are sized by reduce() (a round tyre, a rim face whose holes survive), and the pipeline leaves them so.
    wheelNear: 2000,
    // Metres of error allowed when thinning a part (see reduce()).
    reduction: { default: 0.008, material_10: { metres: 0.01, permissive: true }, material_4: 0.015, '.001': 0.0035, Object_25: { metres: 0.01, permissive: true }, Object_27: { metres: 0.02, permissive: true } },
    // In the written car's frame: x = 0 mid-wheelbase, which is 0.12 m behind the middle of the van.
    // Inside the shell everywhere (checked by rays, inside-b.mjs): above the wheel arches, under the roof's slopes.
    cabin: [-1.4, 0.95, 0.66, 1.55, -0.56, 0.56],
    // The tyres' sidewalls carry a maker's name: at 64 texels it is gone, and the rubber stays rubber.
    textureSize: (role) => (role === 'tyre' ? 64 : 512),
    // Measured by rays on the written car: the front in the bumper's shallow recess, the rear in the tailgate's, under the handle.
    plates: { front: [1.863, 0.567, 0, 0.52, 0.112], rear: [-1.545, 0.87, 0, 0.52, 0.112] },
    role(ctx) {
      const { part, centre: c } = ctx
      const m = part.material
      const wheel = nearAxle(c, this.axles, 0.3, 0.45, 0.75)
      if (m === '.001') return 'tyre'
      if (m === 'material_15') {
        // Object_26 repeats the rear-right wheel's rim; the rest of it is mirror brackets.
        if (wheel) return part.node === 'Object_26' ? null : 'rim'
        return 'trim'
      }
      // The hub caps.
      if (m === 'material_7' && nearAxle(c, this.axles, 0.16, 0.6, 0.75)) return 'rim'
      if (m === 'material_3') return 'paint'
      // The headlamps' clear lenses go: the chrome bowls behind them are the lamps.
      if (m === 'material_5') return c[0] > 1.4 && c[1] < 1.05 ? null : 'glass'
      if (m === 'material_2' || m === 'material_12') return 'lamp_rear'
      if (m === 'material_9') return 'lamp_turn'
      // The reflectors: the headlamps' twin bowls; at the back the reversing lamp's, behind its clear lens.
      // The rest sit behind coloured lenses that the walk draws opaque.
      if (m === 'material_13') return c[0] > 0 ? (c[1] > 0.7 ? 'lamp_front' : null) : c[1] < 0.9 ? 'lamp_rear' : null
      // The axle tubes under the floor.
      if (m === 'material_14' && this.axles.some(([x, y]) => Math.abs(c[0] - x) < 0.15 && Math.abs(c[1] - y) < 0.15)) return null
      // The lining: roof, walls and floor of the cabin, seen through the windows; its wheel-arch liners are outside, and trim.
      if (m === 'material_4') return c[1] < 0.66 && this.axles.some(([x]) => Math.abs(c[0] - x) < 0.5) ? 'trim' : 'cabin'
      if (m === 'material_8') return 'detail'
      if (m === 'material') return 'chrome'
      // material_7 (bumpers, handles, mirror shells, wipers, flaps), material_10 (window seals), material_14 (underbody).
      return 'trim'
    },
  },
  matiz: {
    file: 'daewoo-matiz.glb',
    // Its front is +z; metres already. A black roof panel, as the model has it.
    turn: 90,
    length: 3.495,
    rawFrame: [-0.00305, 0.0013, 0, 1.00101],
    // Front and rear axle x, axle height (from the tyres).
    axles: [[1.098, 0.273], [-1.25, 0.273]],
    credit: { title: 'Daewoo Matiz', author: 'elijahforonda631', url: 'https://sketchfab.com/3d-models/61be0476f0d64a9d8b37e4cdbc430fff', license: 'CC BY 4.0' },
    // Parts that go whole, by node. The antenna (it would set the height); the struts and springs behind the wheels;
    // the badges: the grille's emblem, the tailgate's names and its emblem; the cabin's fittings and the engine bay's
    // contents (under a closed bonnet), by node where they share a material with the outside.
    dropNodes: new Set([
      'Object_121', 'Object_7', 'Object_12', 'Object_56', 'Object_58', 'Object_160', 'Object_42',
      'Object_202', 'Object_205', 'Object_172', 'Object_178', 'Object_182', 'Object_195', 'Object_203', 'Object_206', 'Object_210', 'Object_216', 'Object_226',
      ...Array.from({ length: 24 }, (_, k) => `Object_${228 + k * 2}`), 'Object_270', 'Object_272', 'Object_274',
      // material_16: all of it is cabin trim but the roof lining and pillars (Object_96), kept as the cabin's dark.
      'Object_80', 'Object_89', 'Object_94', 'Object_102', 'Object_166',
      // The headlamps' smoked lenses: the walk would draw them opaque; the chrome bowls behind are the lamps.
      'Object_16',
      // The tail lamps' insides, behind red lenses that the walk draws opaque.
      'Object_44', 'Object_48', 'Object_52', 'Object_131',
      // The exhaust's run under the floor (the tailpipe stays): 760 triangles that do not thin, for nothing seen.
      'Object_73',
    ]),
    // Materials that are only ever inside the cabin or the engine bay.
    dropMaterials: new Set(['material_20', 'material_21', 'material_23', 'material_24', 'SB.001', 'SR.001', 'SB.002', 'H.001', 'BB.003', 'BB.008', 'material_29', 'material_36', 'material_37', 'KP1.001', 'material_39', 'BB.002', 'BB.005', 'BB.006', 'BB.007', 'BB.009', 'BB.010']),
    drop(p) {
      if (this.dropNodes.has(p.node) || this.dropMaterials.has(p.material)) return true
      // The roof lining sits a hair under the black roof panel: pulled in, so that thinning either cannot push it through.
      if (p.node === 'Object_96') shrink(this, p, [-0.1, 0.8, 0], [0.98, 0.93, 0.95])
      orientParts(this, p)
      if (!p.mat?.getBaseColorTexture()) p.U.fill(0)
      const r = this.reduction[p.node] ?? this.reduction[p.material] ?? this.reduction.default
      if (r) reduce(this, p, r.metres ?? r, r)
      return false
    },
    // Faces the right way out as stored: nothing to turn.
    orientation: {},
    // The near LOD is what this leaves (the pipeline's own pass would shave the bumpers' tips off the length);
    // the bumpers' ends are held still.
    near: 9300,
    get reduction() {
      const ends = (v) => Math.abs(v[0]) > 1.735
      const coarse = { metres: 0.012, permissive: true, lock: ends }
      return {
        default: { metres: 0.008, lock: ends },
        // The black trim, most of it small and dark; not the black rims, which share its material.
        material_6: coarse, material_7: coarse, 'BB.004': coarse,
        Object_28: { metres: 0.004 }, Object_293: { metres: 0.004 },
        // The wipers, the brake calipers, the underbody and exhaust: small or barely seen, and dense.
        Object_276: coarse, Object_278: coarse, Object_280: coarse, material: coarse, Object_24: coarse, Object_63: coarse,
      }
    },
    // In the written car's frame (x = 0 mid-wheelbase, 0.08 m ahead of the middle of the car).
    // Inside the shell everywhere (checked by rays, inside-b.mjs): above the wheel arches, under the windscreen's slope.
    cabin: [-1.05, 0.4, 0.62, 1.15, -0.56, 0.56],
    // Measured by rays on the written car: the front on the flat band of bumper over the lower intake, the rear in the tailgate's shallow recess.
    plates: { front: [1.82, 0.437, 0, 0.52, 0.112], rear: [-1.563, 0.85, 0, 0.52, 0.112] },
    textureSize: (role) => (role === 'tyre' ? 64 : 512),
    role(ctx) {
      const { part, centre: c, hsv } = ctx
      const [h, s, v] = hsv
      const m = part.material, n = part.node
      if (n === 'Object_32' || n === 'Object_295') return 'tyre'
      // The rims, and the brake discs behind them.
      if (n === 'Object_28' || n === 'Object_293' || n === 'Object_67' || n === 'Object_297') return 'rim'
      // The body colour's material is also the wheel arches' liners and a panel under the bonnet's front edge: those are trim.
      if (m === 'material_1') return nearAxle(c, this.axles, 0.3, 0.45, 0.8) || n === 'Object_254' ? 'trim' : 'paint'
      if (m === 'material_14') return 'glass'
      if (m === 'material_3') return 'lamp_turn'
      if (m === 'material_9' || m === 'material_11') return 'lamp_rear'
      if (m === 'material_13') return h > 18 && h < 52 && s > 0.4 && v > 0.4 ? 'lamp_turn' : 'lamp_rear'
      // The headlamps' chrome bowls and their backs, and the fog lamps'; the rest of the chrome is the mirrors' glass and small trim.
      if (n === 'Object_18' || n === 'Object_115' || n === 'Object_20') return 'lamp_front'
      if (m === 'material_5' || m === 'material_8') return 'chrome'
      // The brake calipers, orange.
      if (m === 'material') return 'detail'
      // The roof lining and pillar trims.
      if (m === 'material_16') return 'cabin'
      // material_6 (gloss black: roof panel, grille, mirrors, mouldings), material_7 (matt black: bumpers' lower parts,
      // wipers, seals, underbody), material_12, material_15 (the glass's black borders), BB.004.
      return 'trim'
    },
  },
  vaz2107: {
    file: 'old_car_-_vaz_2107.glb',
    // Its front is +z; centimetres.
    turn: 90,
    length: 4.145,
    near: 7800,
    // Its wheels (1920 triangles each as modelled) round enough at this; at the default 900 the rims turn twelve-sided.
    wheelNear: 1300,
    rawFrame: [-24.9969, 0, 0, 0.0099547],
    // Front and rear axle x, axle height (measured from the Bottom's wheel components).
    axles: [[1.449, 0.305], [-0.952, 0.305]],
    sampleTextures: true,
    credit: { title: 'Old car - VAZ 2107', author: 'prephonat', url: 'https://sketchfab.com/3d-models/91270dab9d1a47c7ba7ffaaf8c8b0beb', license: 'CC BY 4.0' },
    // The paint, texel by texel: a faded red, darker where it has weathered; rust (browner, duller), dirt and bare metal are not paint.
    paintTexel: (h, s, v) => {
      const hh = h > 180 ? h - 360 : h
      return band(hh, -8, 15, 4) * Math.min(1, Math.max(0, (s - 0.36) / 0.1)) * Math.min(1, Math.max(0, (v - 0.2) / 0.08))
    },
    drop(p) {
      // The seats and dashboard: a cabin box instead.
      if (p.material === 'Interior') return true
      // The plates go (the walk hangs its own), and the maker's name on the boot lid.
      if (p.material === 'Details') cut(this, p, (c) => (Math.abs(c[2]) < 0.3 && ((c[0] > 2.03 && c[1] > 0.36 && c[1] < 0.48) || (c[0] < -1.955 && c[1] > 0.62 && c[1] < 0.735))) || (c[0] < -1.97 && c[1] > 0.78 && c[1] < 0.83 && c[2] > 0.3 && c[2] < 0.58))
      orientParts(this, p)
      const r = this.reduction[p.material] ?? this.reduction.default
      if (r) reduce(this, p, r.metres ?? r, r)
      return false
    },
    // The underbody, barely seen, to 2.5 cm; the wheels in the same part are held still (the pipeline thins them on their own).
    get reduction() {
      return { Bottom: { metres: 0.025, permissive: true, prune: true, lock: (v) => nearAxle(v, this.axles, 0.36, 0.55, 0.95) } }
    },
    // In the written car's frame (x = 0 mid-wheelbase, 0.25 m behind the middle of the car).
    // Inside the shell everywhere (checked by rays, inside-b.mjs): above the wheel arches, clear of the C-pillars' slope.
    cabin: [-1.18, 0.4, 0.64, 1.21, -0.62, 0.62],
    // Where the model's own plates were (cut out above): on the front bumper's face, and at the bottom of the recess between the tail lamps.
    plates: { front: [1.813, 0.423, 0, 0.52, 0.112], rear: [-2.218, 0.678, 0, 0.52, 0.112] },
    role(ctx) {
      const { part, centre: c, hsv } = ctx
      const [h, s, v] = hsv
      const m = part.material
      if (m === 'Windows') return 'glass'
      if (m === 'CarBody') return 'skin'
      if (m === 'Bottom') return nearAxle(c, this.axles, 0.34, 0.58, 0.9) ? 'wheel' : 'trim'
      const amber = h > 18 && h < 50 && s > 0.45 && v > 0.3
      // The lenses: at the back they carry the lamps' colours; at the front they are a dirty half-clear glass that the
      // walk would draw opaque, so they go and the reflectors behind them are the headlamps, the amber corners the indicators.
      if (m === 'Details_Transparent') return c[0] > 0 ? null : amber ? 'lamp_turn' : 'lamp_rear'
      if (c[0] > 1.88 && c[1] > 0.6 && c[1] < 0.82 && Math.abs(c[2]) > 0.36 && Math.abs(c[2]) < 0.74 && ctx.normal[0] > 0.3) {
        if (amber) return 'lamp_turn'
        if (v > 0.3) return 'lamp_front'
      }
      // The side repeaters on the front wings (grey covers in this texture).
      if (c[0] > 1.8 && c[0] < 1.9 && c[1] > 0.7 && c[1] < 0.76 && Math.abs(c[2]) > 0.76) return 'lamp_turn'
      return 'detail'
    },
  },
}
