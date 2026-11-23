// Turns a downloaded car model into the walk's format (see CONTRACT below).
//   node process.mjs <model> [--debug]      model = a key of MODELS in models.mjs
//   node process.mjs --all                  every model, one after another
// Reads raw/<file>, writes out/<model>.glb and out/<model>.glb.gz. See README.md.
//
// CONTRACT (what evoCars' runtime expects):
// - metres; +x the car's front, +y up, tyres' contact at y = 0, x = 0 mid-wheelbase, z = 0 centreline.
// - nodes: body, wheel (template on its own axle, axle along z, outer face +z), body_far, wheel_far.
// - material roles by name prefix: paint, glass, chrome, trim, lamp_front, lamp_rear, lamp_turn, tyre, rim, detail.
// - scene.extras: { kind, length, width, height, wheelbase, track, wheelRadius, wheels, plates, credit }.
// - KHR_mesh_quantization; WebP textures; nothing that needs WASM to decode.
import { Document, NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP, KHRMeshQuantization, KHRTextureTransform } from '@gltf-transform/extensions'
import { dedup, prune, quantize, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { mat4, vec3 } from 'gl-matrix'
import { writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { MODELS } from './models.mjs'

const S = new URL('.', import.meta.url).pathname
if (process.argv[2] === '--all') {
  const { execFileSync } = await import('node:child_process')
  for (const each of Object.keys(MODELS)) execFileSync(process.execPath, [new URL(import.meta.url).pathname, each], { stdio: 'inherit' })
  process.exit(0)
}
const key = process.argv[2]
const debug = process.argv.includes('--debug')
const cfg = MODELS[key]
if (!cfg) throw new Error(`no model ${key}; one of ${Object.keys(MODELS).join(', ')}`)
await MeshoptSimplifier.ready

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const src = await io.read(`${S}raw/${cfg.file}`)

// ---------------------------------------------------------------- read it all, in world space
/** A part: one primitive's triangles in world space, with the material it came from. */
const parts = []
const world = (node, parent) => {
  const local = mat4.create()
  const t = node.getTranslation(), r = node.getRotation(), s = node.getScale()
  mat4.fromRotationTranslationScale(local, r, t, s)
  const m = mat4.create()
  mat4.multiply(m, parent, local)
  const mesh = node.getMesh()
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue
      const pos = prim.getAttribute('POSITION')
      const nor = prim.getAttribute('NORMAL')
      const uv = prim.getAttribute('TEXCOORD_0')
      const count = pos.getCount()
      const P = new Float32Array(count * 3), N = new Float32Array(count * 3), U = new Float32Array(count * 2)
      const nm = mat4.create()
      mat4.invert(nm, m)
      mat4.transpose(nm, nm)
      const a = [0, 0, 0], b = [0, 0, 0]
      for (let i = 0; i < count; i++) {
        pos.getElement(i, a)
        vec3.transformMat4(b, a, m)
        P.set(b, i * 3)
        if (nor) {
          nor.getElement(i, a)
          const x = nm[0] * a[0] + nm[4] * a[1] + nm[8] * a[2]
          const y = nm[1] * a[0] + nm[5] * a[1] + nm[9] * a[2]
          const z = nm[2] * a[0] + nm[6] * a[1] + nm[10] * a[2]
          const l = Math.hypot(x, y, z) || 1
          N.set([x / l, y / l, z / l], i * 3)
        }
        if (uv) {
          uv.getElement(i, a)
          U.set([a[0], a[1]], i * 2)
        }
      }
      const ix = prim.getIndices()
      const I = ix ? Uint32Array.from(ix.getArray()) : Uint32Array.from({ length: count }, (_, i) => i)
      // A mirrored transform turns the triangles inside out.
      if (mat4.determinant(m) < 0) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]]
      const mat = prim.getMaterial()
      parts.push({ node: node.getName() || '', mesh: mesh.getName() || '', material: mat?.getName() || '(none)', mat, P, N, U, I, hasNormals: !!nor, hasUV: !!uv })
    }
  }
  for (const child of node.listChildren()) world(child, m)
}
for (const node of src.getRoot().listScenes()[0].listChildren()) world(node, mat4.create())

// ---------------------------------------------------------------- normalise: +x forward, real size, on the ground
{
  const R = mat4.create()
  mat4.rotateY(R, R, (cfg.turn ?? 0) * Math.PI / 180)
  if (cfg.flipX) mat4.scale(R, R, [-1, 1, 1])
  const apply = (M) => {
    const nm = mat4.create()
    mat4.invert(nm, M)
    mat4.transpose(nm, nm)
    for (const p of parts) {
      for (let i = 0; i < p.P.length; i += 3) {
        const v = vec3.transformMat4([0, 0, 0], [p.P[i], p.P[i + 1], p.P[i + 2]], M)
        p.P.set(v, i)
        const n = [p.N[i], p.N[i + 1], p.N[i + 2]]
        const x = nm[0] * n[0] + nm[4] * n[1] + nm[8] * n[2], y = nm[1] * n[0] + nm[5] * n[1] + nm[9] * n[2], z = nm[2] * n[0] + nm[6] * n[1] + nm[10] * n[2]
        const l = Math.hypot(x, y, z) || 1
        p.N.set([x / l, y / l, z / l], i)
      }
      if (mat4.determinant(M) < 0) for (let t = 0; t < p.I.length; t += 3) [p.I[t + 1], p.I[t + 2]] = [p.I[t + 2], p.I[t + 1]]
    }
  }
  apply(R)
  // Drop what the config says is not the car, before measuring it.
  for (const p of parts) p.drop = cfg.drop?.(p) ?? false
  const kept = parts.filter((p) => !p.drop)
  const box = bounds(kept)
  const scale = cfg.length / (box.max[0] - box.min[0])
  const M = mat4.create()
  mat4.scale(M, M, [scale, scale, scale])
  mat4.translate(M, M, [-(box.min[0] + box.max[0]) / 2, -box.min[1], -(box.min[2] + box.max[2]) / 2])
  apply(M)
}

function bounds(list) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const p of list) for (let i = 0; i < p.P.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], p.P[i + k])
    max[k] = Math.max(max[k], p.P[i + k])
  }
  return { min, max }
}

// ---------------------------------------------------------------- textures we can sample
const images = new Map()
async function pixels(texture) {
  if (!texture) return null
  if (images.has(texture)) return images.get(texture)
  const { data, info } = await sharp(Buffer.from(texture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const img = { data, w: info.width, h: info.height }
  images.set(texture, img)
  return img
}
const sample = (img, u, v) => {
  const x = Math.min(img.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * img.w)))
  const y = Math.min(img.h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * img.h)))
  const o = (y * img.w + x) * 4
  return [img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255]
}
const hsv = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = 0
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [((h * 60) + 360) % 360, mx > 0 ? d / mx : 0, mx]
}

// ---------------------------------------------------------------- give every triangle a role
// A role from the config, per part or per triangle (with what the texture says there).
const tris = [] // { part, t (first index), role }
const dims = (() => {
  const b = bounds(parts.filter((p) => !p.drop))
  return { length: b.max[0] - b.min[0], width: b.max[2] - b.min[2], height: b.max[1] - b.min[1], min: b.min, max: b.max }
})()
for (const p of parts) {
  if (p.drop) continue
  const img = cfg.sampleTextures && p.hasUV ? await pixels(p.mat?.getBaseColorTexture()) : null
  const base = p.mat?.getBaseColorFactor() ?? [1, 1, 1, 1]
  for (let t = 0; t < p.I.length; t += 3) {
    const a = p.I[t] * 3, b = p.I[t + 1] * 3, c = p.I[t + 2] * 3
    const centre = [(p.P[a] + p.P[b] + p.P[c]) / 3, (p.P[a + 1] + p.P[b + 1] + p.P[c + 1]) / 3, (p.P[a + 2] + p.P[b + 2] + p.P[c + 2]) / 3]
    const normal = [(p.N[a] + p.N[b] + p.N[c]) / 3, (p.N[a + 1] + p.N[b + 1] + p.N[c + 1]) / 3, (p.N[a + 2] + p.N[b + 2] + p.N[c + 2]) / 3]
    let color = base.slice(0, 3)
    if (img) {
      const ua = p.I[t] * 2, ub = p.I[t + 1] * 2, uc = p.I[t + 2] * 2
      const u = (p.U[ua] + p.U[ub] + p.U[uc]) / 3, v = (p.U[ua + 1] + p.U[ub + 1] + p.U[uc + 1]) / 3
      color = sample(img, u, v)
    }
    const role = cfg.role({ part: p, centre, normal, color, hsv: hsv(color), dims })
    if (role) tris.push({ p, t, role, centre })
  }
}

// ---------------------------------------------------------------- the wheels: four clusters of tyre and rim, one template
const isWheel = (r) => r === 'tyre' || r === 'rim' || r === 'wheel'
const wheelTris = tris.filter((x) => isWheel(x.role))
// Facing +x with +y up, +z is the car's right. fl, fr, rl, rr.
const corners = [[1, -1], [1, 1], [-1, -1], [-1, 1]]
const groups = corners.map(() => [])
for (const x of wheelTris) {
  const k = (x.centre[0] > 0 ? 0 : 2) + (x.centre[2] > 0 ? 1 : 0)
  groups[k].push(x)
}
const hubs = groups.map((g) => {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (const x of g) {
    const p = x.p
    for (let k = 0; k < 3; k++) {
      const i = p.I[x.t + k] * 3
      for (let d = 0; d < 3; d++) {
        b.min[d] = Math.min(b.min[d], p.P[i + d])
        b.max[d] = Math.max(b.max[d], p.P[i + d])
      }
    }
  }
  return { centre: b.min.map((m, d) => (m + b.max[d]) / 2), radius: (b.max[1] - b.min[1]) / 2, width: b.max[2] - b.min[2] }
})
// Re-centre along x on the middle of the wheelbase, now that we know where it is.
const shiftX = -(hubs[0].centre[0] + hubs[2].centre[0] + hubs[1].centre[0] + hubs[3].centre[0]) / 4
for (const p of parts) for (let i = 0; i < p.P.length; i += 3) p.P[i] += shiftX
for (const h of hubs) h.centre[0] += shiftX
for (const x of tris) x.centre[0] += shiftX

// ---------------------------------------------------------------- build indexed meshes per role
/** Gathers triangles into one indexed mesh per role, vertices compacted. */
function gather(list, transform) {
  const byRole = new Map()
  for (const x of list) {
    if (!byRole.has(x.role)) byRole.set(x.role, [])
    byRole.get(x.role).push(x)
  }
  const out = []
  for (const [role, items] of byRole) {
    // Per source material within a role, so each keeps its texture.
    const byMat = new Map()
    for (const x of items) {
      const k = x.p.mat
      if (!byMat.has(k)) byMat.set(k, [])
      byMat.get(k).push(x)
    }
    for (const [mat, its] of byMat) {
      const map = new Map()
      const P = [], N = [], U = [], I = []
      for (const x of its) {
        const p = x.p
        for (let k = 0; k < 3; k++) {
          const v = p.I[x.t + k]
          const id = `${parts.indexOf(p)}:${v}`
          let n = map.get(id)
          if (n === undefined) {
            n = P.length / 3
            map.set(id, n)
            let pos = [p.P[v * 3], p.P[v * 3 + 1], p.P[v * 3 + 2]], nor = [p.N[v * 3], p.N[v * 3 + 1], p.N[v * 3 + 2]]
            if (transform) [pos, nor] = transform(pos, nor)
            P.push(...pos)
            N.push(...nor)
            U.push(p.U[v * 2] ?? 0, p.U[v * 2 + 1] ?? 0)
          }
          I.push(n)
        }
      }
      out.push({ role, mat, P: new Float32Array(P), N: new Float32Array(N), U: new Float32Array(U), I: new Uint32Array(I) })
    }
  }
  return out
}

/** Simplifies one mesh to a share of its triangles, keeping its UV seams and normals honest. */
function simplify(m, share, error, flags = []) {
  if (share >= 1 || m.I.length < 60) return m
  const target = Math.max(12, Math.floor((m.I.length * share) / 3) * 3)
  const attrs = new Float32Array((m.P.length / 3) * 5)
  for (let i = 0; i < m.P.length / 3; i++) attrs.set([m.N[i * 3] * 0.5, m.N[i * 3 + 1] * 0.5, m.N[i * 3 + 2] * 0.5, m.U[i * 2] * 2, m.U[i * 2 + 1] * 2], i * 5)
  const [I] = MeshoptSimplifier.simplifyWithAttributes(m.I, m.P, 3, attrs, 5, [1, 1, 1, 1, 1], null, target, error, flags)
  return compact({ ...m, I: Uint32Array.from(I) })
}

/** Drops the vertices no triangle uses any more, and renumbers the rest in the order they are first used. */
function compact(m) {
  const remap = new Int32Array(m.P.length / 3).fill(-1)
  let n = 0
  for (const i of m.I) if (remap[i] < 0) remap[i] = n++
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2)
  for (let i = 0; i < remap.length; i++) {
    const j = remap[i]
    if (j < 0) continue
    P.set(m.P.subarray(i * 3, i * 3 + 3), j * 3)
    N.set(m.N.subarray(i * 3, i * 3 + 3), j * 3)
    U.set(m.U.subarray(i * 2, i * 2 + 2), j * 2)
  }
  return { ...m, P, N, U, I: m.I.map((i) => remap[i]) }
}

const bodyTris = tris.filter((x) => !isWheel(x.role))
/** A box, as a mesh of one role: for the dark of a cabin whose seats have been taken out. */
function box(role, [x0, x1, y0, y1, z0, z1]) {
  const P = [], N = [], U = [], I = []
  const faces = [
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
    [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
  ]
  for (const [n, quad] of faces) {
    const b = P.length / 3
    for (const v of quad) { P.push(...v); N.push(...n); U.push(0, 0) }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  return { role, mat: null, P: new Float32Array(P), N: new Float32Array(N), U: new Float32Array(U), I: new Uint32Array(I) }
}
// The front-right wheel, moved to its own axle: the template, its outer face +z.
// (A wheel on the left, at -z, is the template turned half round y.)
const fr = hubs[1]
const toAxle = (pos, nor) => [[pos[0] - fr.centre[0], pos[1] - fr.centre[1], pos[2] - fr.centre[2]], nor]
const wheelMeshes = gather(groups[1], toAxle)
let bodyMeshes = gather(bodyTris)

// Budget: share the near LOD's triangles between the body's roles in proportion, never below what a role needs.
const budget = (meshes, total, error, flags) => {
  const sum = meshes.reduce((s, m) => s + m.I.length / 3, 0)
  return meshes.map((m) => simplify(m, Math.min(1, total / sum), error, flags))
}
// Near: as close as the budget allows. Far: whatever it takes, small loose bits pruned away.
if (cfg.cabin) bodyMeshes = [...bodyMeshes, box('cabin', cfg.cabin)]
const nearBody = budget(bodyMeshes, cfg.near ?? 8500, 0.02, [])
const nearWheel = budget(wheelMeshes, cfg.wheelNear ?? 900, 0.02, [])
const farBody = budget(bodyMeshes, cfg.far ?? 2000, 0.1, ['Prune', 'Permissive'])
const farWheel = budget(wheelMeshes, cfg.wheelFar ?? 160, 0.1, ['Prune', 'Permissive'])

// ---------------------------------------------------------------- texture coordinates into [0, 1], so they quantize
// Per source material (near and far share one), with a KHR_texture_transform to undo it.
const uvBox = new Map()
for (const m of [...nearBody, ...nearWheel, ...farBody, ...farWheel]) {
  const k = `${m.role}|${m.mat?.getName?.() ?? ''}`
  const b = uvBox.get(k) ?? [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i < m.U.length; i += 2) {
    b[0] = Math.min(b[0], m.U[i]); b[1] = Math.min(b[1], m.U[i + 1])
    b[2] = Math.max(b[2], m.U[i]); b[3] = Math.max(b[3], m.U[i + 1])
  }
  uvBox.set(k, b)
}
const uvTransform = new Map()
for (const [k, b] of uvBox) {
  if (b[0] >= 0 && b[1] >= 0 && b[2] <= 1 && b[3] <= 1) continue
  const offset = [b[0], b[1]], scale = [Math.max(1e-6, b[2] - b[0]), Math.max(1e-6, b[3] - b[1])]
  uvTransform.set(k, { offset, scale })
}
for (const m of [...nearBody, ...nearWheel, ...farBody, ...farWheel]) {
  const t = uvTransform.get(`${m.role}|${m.mat?.getName?.() ?? ''}`)
  if (!t) continue
  const U = new Float32Array(m.U.length)
  for (let i = 0; i < U.length; i += 2) {
    U[i] = (m.U[i] - t.offset[0]) / t.scale[0]
    U[i + 1] = (m.U[i + 1] - t.offset[1]) / t.scale[1]
  }
  m.U = U
}

// ---------------------------------------------------------------- the plates: found by the config, removed, recorded
const plates = cfg.plates ?? null

// ---------------------------------------------------------------- write the document
const doc = new Document()
doc.createBuffer()
const out = doc.getRoot()
const textures = new Map()
async function texture(srcTex, size) {
  if (!srcTex) return null
  const k = `${srcTex.getName() || ''}:${srcTex.getURI() || ''}:${size}:${src.getRoot().listTextures().indexOf(srcTex)}`
  if (textures.has(k)) return textures.get(k)
  const buf = await sharp(Buffer.from(srcTex.getImage())).resize(size, size, { fit: 'fill' }).webp({ quality: cfg.webpQuality ?? 78, effort: 6 }).toBuffer()
  const t = doc.createTexture(k).setImage(new Uint8Array(buf)).setMimeType('image/webp')
  textures.set(k, t)
  return t
}
const materials = new Map()
/**
 * A skin: the model's own texture, with the paint marked in its alpha — 1
 * where a texel is the car's paint, 0 where it is anything else, dust and rust
 * included — and the gain that brings the paint's own average shade up to 1.
 * The walk tints by the alpha: lum(rgb) × gain × paint colour, and leaves the
 * rest of the texture alone.
 */
async function skin(srcTex, size) {
  const { data, info } = await sharp(Buffer.from(srcTex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const mask = Buffer.alloc(info.width * info.height)
  let sum = 0, n = 0
  for (let i = 0, j = 0; i < data.length; i += 3, j++) {
    const c = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]
    const [h, sat, v] = hsv(c)
    // How much of this texel is paint, 0 to 1: a soft mask, so a tint fades into dust as the paint does.
    const paint = Math.max(0, Math.min(1, +cfg.paintTexel(h, sat, v)))
    mask[j] = Math.round(paint * 255)
    sum += paint * (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
    n += paint
  }
  const rgb = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).resize(size, size, { fit: 'fill' }).webp({ quality: cfg.webpQuality ?? 80, effort: 6 }).toBuffer()
  // The mask is soft and needs no more than a quarter of the texels.
  const m = await sharp(mask, { raw: { width: info.width, height: info.height, channels: 1 } }).blur(1).resize(size / 2, size / 2, { fit: 'fill' }).toColourspace('b-w').webp({ quality: 82, effort: 6 }).toBuffer()
  return {
    texture: doc.createTexture('skin').setImage(new Uint8Array(rgb)).setMimeType('image/webp'),
    mask: doc.createTexture('paint-mask').setImage(new Uint8Array(m)).setMimeType('image/webp'),
    gain: n ? 1 / (sum / n) : 1,
    share: n / (data.length / 3),
  }
}
const textureTransform = doc.createExtension(KHRTextureTransform)
/** Puts back a material's texture coordinates as they were before they were squeezed into [0, 1]. */
function unsqueeze(m, k) {
  const t = uvTransform.get(k)
  if (!t) return
  for (const info of [m.getBaseColorTextureInfo(), m.getEmissiveTextureInfo()]) {
    if (!info) continue
    info.setExtension('KHR_texture_transform', textureTransform.createTransform().setOffset(t.offset).setScale(t.scale))
  }
}
async function material(role, srcMat) {
  const k = `${role}|${srcMat?.getName?.() ?? ''}`
  if (materials.has(k)) return materials.get(k)
  const m = doc.createMaterial(`${role}${srcMat ? '.' + (srcMat.getName() || 'm') : ''}`)
  if (role === 'skin') {
    const { texture: t, mask, gain, share } = await skin(srcMat.getBaseColorTexture(), cfg.textureSize?.(role) ?? 512)
    // The paint mask rides in the emissive slot, with no emission: the one place GLTFLoader will load a second texture from.
    m.setBaseColorTexture(t).setEmissiveTexture(mask).setEmissiveFactor([0, 0, 0]).setRoughnessFactor(0.55).setMetallicFactor(0)
      .setExtras({ role, paintGain: +gain.toFixed(3), paintShare: +share.toFixed(3), paintMask: 'emissiveTexture (linear, R)' })
    unsqueeze(m, k)
    materials.set(k, m)
    return m
  }
  const base = srcMat?.getBaseColorFactor() ?? [1, 1, 1, 1]
  m.setBaseColorFactor(role === 'paint' && !cfg.keepPaintTexture ? [1, 1, 1, 1] : base)
  m.setRoughnessFactor(srcMat?.getRoughnessFactor() ?? 0.6).setMetallicFactor(srcMat?.getMetallicFactor() ?? 0)
  const keep = cfg.keepTexture?.(role, srcMat) ?? ['detail', 'rim', 'tyre', 'wheel', 'paint', 'lamp_front', 'lamp_rear', 'lamp_turn', 'chrome', 'trim'].includes(role)
  if (keep && srcMat?.getBaseColorTexture()) m.setBaseColorTexture(await texture(srcMat.getBaseColorTexture(), cfg.textureSize?.(role) ?? 512))
  if (role === 'glass') m.setAlphaMode('BLEND').setBaseColorFactor([0.08, 0.1, 0.12, 0.72])
  if (role === 'cabin') m.setBaseColorFactor([0.03, 0.03, 0.035, 1]).setRoughnessFactor(1)
  m.setExtras({ role })
  unsqueeze(m, k)
  materials.set(k, m)
  return m
}
async function meshOf(name, list) {
  const mesh = doc.createMesh(name)
  for (const m of list) {
    if (m.I.length === 0) continue
    const prim = doc.createPrimitive()
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(m.P))
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(m.N))
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(m.U))
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(m.P.length / 3 > 65535 ? m.I : Uint16Array.from(m.I)))
    prim.setMaterial(await material(m.role, m.mat))
    mesh.addPrimitive(prim)
  }
  return mesh
}
const scene = doc.createScene('car')
for (const [name, list] of [['body', nearBody], ['wheel', nearWheel], ['body_far', farBody], ['wheel_far', farWheel]]) {
  scene.addChild(doc.createNode(name).setMesh(await meshOf(name, list)))
}
const all = bounds(nearBody.map((m) => ({ P: m.P })))
const extras = {
  kind: key,
  length: +(all.max[0] - all.min[0]).toFixed(3),
  width: +(all.max[2] - all.min[2]).toFixed(3),
  height: +all.max[1].toFixed(3),
  wheelbase: +(((hubs[0].centre[0] + hubs[1].centre[0]) - (hubs[2].centre[0] + hubs[3].centre[0])) / 2).toFixed(3),
  track: +(((hubs[1].centre[2] - hubs[0].centre[2]) + (hubs[3].centre[2] - hubs[2].centre[2])) / 2).toFixed(3),
  wheelFaces: '+z',
  wheelRadius: +((hubs.reduce((s, h) => s + h.radius, 0)) / 4).toFixed(3),
  wheels: hubs.map((h) => h.centre.map((v) => +v.toFixed(3))),
  plates,
  credit: cfg.credit,
}
scene.setExtras(extras)
doc.createExtension(KHRMeshQuantization).setRequired(true)
doc.createExtension(EXTTextureWebP).setRequired(true)
// Materials are never merged: two with the same texture can be different roles.
await doc.transform(weld(), dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), prune(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }))
mkdirSync(`${S}out`, { recursive: true })
const glb = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc)
writeFileSync(`${S}out/${key}.glb`, glb)
const gz = gzipSync(glb, { level: 9 })
writeFileSync(`${S}out/${key}.glb.gz`, gz)
console.log(`gzip: ${(gz.byteLength / 1024).toFixed(0)} KB`)
const count = (list) => list.reduce((s, m) => s + m.I.length / 3, 0)
const imageBytes = doc.getRoot().listTextures().reduce((s, t) => s + t.getImage().byteLength, 0)
console.log(`textures: ${doc.getRoot().listTextures().length}, ${(imageBytes / 1024).toFixed(0)} KB of ${(glb.byteLength / 1024).toFixed(0)} KB`)
console.log(JSON.stringify({ key, bytes: glb.byteLength, near: count(nearBody) + count(nearWheel) * 4, body: count(nearBody), wheel: count(nearWheel), far: count(farBody) + count(farWheel) * 4, roles: [...new Set(nearBody.map((m) => m.role))], extras }))
if (debug) {
  const tally = {}
  for (const x of tris) tally[x.role] = (tally[x.role] ?? 0) + 1
  console.log('triangles by role:', JSON.stringify(tally))
}
