import { useEffect, useMemo, useRef } from 'react'
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  type MeshPhysicalMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import type { Theme } from '@/theme/context'

/**
 * Creature skin: PBR plus a procedural surface.
 *
 * Silhouette alone never reads as real — hide does. This adds three things on
 * top of MeshPhysicalMaterial without touching the geometry:
 *
 *  1. a tileable procedural scale/wrinkle height map, triplanar-sampled in bind
 *     space so the pattern stays glued to the body while it animates,
 *  2. surface-gradient bump mapping (Mikkelsen), which needs neither UVs nor
 *     tangents — the mesh has neither,
 *  3. the ambient occlusion baked during meshing, darkening creases and
 *     roughening them, which is what makes an eye socket look recessed.
 */

const TEXTURE_SIZE = 256

/**
 * Integer bit-mix hash. Deliberately not the usual sin-based one-liner: this map
 * is evaluated a few million times while building the texture, and both the
 * trig calls and the tuple allocation of a two-value hash dominated startup.
 */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Tileable Worley layer. F1 alone fills each cell edge to edge, which reads as
 * square tiling; the gap F2 − F1 is near zero exactly on the boundary between
 * two cells, so thresholding it carves the seam *between* scales — which is what
 * reptile hide actually is. Cell indices wrap, so the texture tiles.
 *
 * Results land in module-scope slots to keep the inner loop allocation-free.
 */
let worleyF1 = 0
let worleyF2 = 0

function worley(cells: number, jitter: number, px: number, py: number): void {
  const cx = Math.floor(px * cells)
  const cy = Math.floor(py * cells)
  let f1 = Infinity
  let f2 = Infinity
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox
      const gy = cy + oy
      const wx = ((gx % cells) + cells) % cells
      const wy = ((gy % cells) + cells) % cells
      const fx = (gx + 0.5 + (hash(wx, wy, 0) - 0.5) * jitter) / cells
      const fy = (gy + 0.5 + (hash(wx, wy, 1) - 0.5) * jitter) / cells
      const dx = (px - fx) * cells
      const dy = (py - fy) * cells
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < f1) {
        f2 = f1
        f1 = d
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  worleyF1 = f1
  worleyF2 = f2
}

/** One scale layer: raised plates separated by carved seams. */
function scaleLayer(cells: number, jitter: number, px: number, py: number): number {
  worley(cells, jitter, px, py)
  const seam = smoothstep(0.015, 0.22, worleyF2 - worleyF1)
  const dome = 1 - Math.min(1, worleyF1 / 0.75)
  return seam * (0.72 + 0.28 * dome)
}

/** Tileable value-noise fbm, for wrinkles between the scales. */
function fbm(px: number, py: number, period: number, octaves: number): number {
  let sum = 0
  let amp = 0.5
  let freq = period
  for (let o = 0; o < octaves; o++) {
    const x = px * freq
    const y = py * freq
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = x - ix
    const fy = y - iy
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const x0 = ((ix % freq) + freq) % freq
    const y0 = ((iy % freq) + freq) % freq
    const x1 = (x0 + 1) % freq
    const y1 = (y0 + 1) % freq
    const a = hash(x0, y0, 2)
    const b = hash(x1, y0, 2)
    const c = hash(x0, y1, 2)
    const d = hash(x1, y1, 2)
    sum += amp * (a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy)
    amp *= 0.5
    freq *= 2
  }
  return sum
}

let cachedTexture: DataTexture | null = null

/**
 * Builds the skin height map once per session: fine scales, larger plates and
 * wrinkles, packed into R (combined height) and B (fine grain).
 */
function getSkinTexture(): DataTexture {
  if (cachedTexture) return cachedTexture
  const size = TEXTURE_SIZE
  const data = new Uint8Array(size * size * 4)

  // One sample per texel: the GPU's mipmaps and linear filtering handle
  // minification, and supersampling here cost four times the startup budget.
  const SUB = 1
  const offsets: number[] = []
  for (let i = 0; i < SUB; i++) offsets.push((i + 0.5) / SUB)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let height = 0
      let plates = 0
      let grain = 0
      for (const oy of offsets) {
        for (const ox of offsets) {
          const px = (x + ox) / size
          const py = (y + oy) / size
          const scales = scaleLayer(20, 1.0, px, py)
          const big = scaleLayer(7, 0.9, px, py)
          const wrinkle = fbm(px, py, 6, 4)
          height += 0.44 * scales + 0.3 * big + 0.26 * wrinkle
          plates += big
          grain += fbm(px, py, 40, 2)
        }
      }
      const n = SUB * SUB
      const i = (y * size + x) * 4
      data[i] = Math.round(255 * Math.min(1, Math.max(0, height / n)))
      data[i + 1] = Math.round(255 * Math.min(1, Math.max(0, plates / n)))
      data[i + 2] = Math.round(255 * Math.min(1, Math.max(0, grain / n)))
      data[i + 3] = 255
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  // DataTexture defaults to NearestFilter on *both* filters — leaving magFilter
  // alone renders the pattern as hard texel blocks instead of skin.
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.needsUpdate = true
  cachedTexture = texture
  return texture
}

const VERTEX_HEAD = /* glsl */ `
attribute float aoValue;
varying vec3 vSkinPos;
varying vec3 vSkinNormal;
varying float vSkinAo;
`

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uSkinMap;
uniform float uTexScale;
uniform float uBump;
uniform float uAo;
uniform float uAoRough;
uniform float uGrooveTint;
varying vec3 vSkinPos;
varying vec3 vSkinNormal;
varying float vSkinAo;

// Triplanar so the pattern needs no UVs and shows no seams on a closed body.
float dhSkinHeight(vec3 p, vec3 n) {
  vec3 w = pow(abs(normalize(n)), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-5);
  float hx = texture2D(uSkinMap, p.zy).r;
  float hy = texture2D(uSkinMap, p.xz).r;
  float hz = texture2D(uSkinMap, p.xy).r;
  return hx * w.x + hy * w.y + hz * w.z;
}
`

/**
 * Mikkelsen surface-gradient bump: reconstructs the height gradient from screen
 * derivatives, so it works on skinned geometry with no tangent frame at all.
 */
const BUMP_BODY = /* glsl */ `
  if (uBump > 0.0) {
    vec3 dhSurf = -vViewPosition;
    vec3 dhDpdx = dFdx(dhSurf);
    vec3 dhDpdy = dFdy(dhSurf);
    float dhDx = dFdx(dhHeight);
    float dhDy = dFdy(dhHeight);
    vec3 dhR1 = cross(dhDpdy, normal);
    vec3 dhR2 = cross(normal, dhDpdx);
    float dhDet = dot(dhDpdx, dhR1);
    vec3 dhGrad = sign(dhDet) * (dhDx * dhR1 + dhDy * dhR2);
    normal = normalize(abs(dhDet) * normal - uBump * dhGrad);
  }
`

interface Uniforms {
  uSkinMap: { value: DataTexture }
  uTexScale: { value: number }
  uBump: { value: number }
  uAo: { value: number }
  uAoRough: { value: number }
  uGrooveTint: { value: number }
}

export interface SkinMaterialProps {
  theme: Theme
  /**
   * Pattern repeats per unit of bind space. Keep individual scales at roughly
   * 6-10 screen pixels: finer than that and the bump derivative turns the
   * pattern into aliasing noise no amount of mipmapping can rescue.
   */
  texScale: number
  /** Bump strength; pass 0 to skip the effect entirely on weak devices. */
  bump: number
}

/**
 * Hide, not chrome — but readable hide. A matte near-black creature on a
 * near-black page simply disappears, so the dark theme keeps a wet sheen and a
 * lifted base value; the light theme can afford to be genuinely matte.
 */
const PALETTE = {
  dark: {
    color: '#4c4c58',
    metalness: 0.25,
    roughness: 0.44,
    clearcoat: 0.75,
    clearcoatRoughness: 0.3,
    envMapIntensity: 2.2,
    sheen: 0.5,
    sheenColor: '#9aa4bd',
    /** How hard baked occlusion bites into the albedo. */
    ao: 0.62,
  },
  light: {
    color: '#c9c0b0',
    metalness: 0.05,
    roughness: 0.64,
    clearcoat: 0.3,
    clearcoatRoughness: 0.5,
    envMapIntensity: 1.05,
    sheen: 0.45,
    sheenColor: '#fff3e2',
    ao: 0.85,
  },
} as const

export function SkinMaterial({ theme, texScale, bump }: SkinMaterialProps) {
  const material = useRef<MeshPhysicalMaterial>(null)
  const texture = useMemo(() => getSkinTexture(), [])

  // Uniform values are baked into the object rather than mutated later: these
  // settings depend only on the creature and the device tier, so they change at
  // most once in a session, and rebuilding triggers a single shader recompile.
  const uniforms = useMemo<Uniforms>(
    () => ({
      uSkinMap: { value: texture },
      uTexScale: { value: texScale },
      uBump: { value: bump },
      uAo: { value: PALETTE[theme].ao },
      uAoRough: { value: 0.22 },
      uGrooveTint: { value: 0.22 },
    }),
    [texture, texScale, bump, theme],
  )

  const onBeforeCompile = useMemo(
    () => (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, uniforms)

      shader.vertexShader =
        VERTEX_HEAD +
        shader.vertexShader
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSkinPos = position;\n  vSkinAo = aoValue;')
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  vSkinNormal = normal;')

      shader.fragmentShader =
        FRAGMENT_HEAD +
        shader.fragmentShader
          // Sample once, up front: three's colour and roughness chunks both run
          // before the normal chunk, so the height has to exist before all three.
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
  float dhHeight = dhSkinHeight(vSkinPos * uTexScale, vSkinNormal);
  float dhAo = mix(1.0, vSkinAo, uAo);`,
          )
          // Occlusion darkens the albedo and deepens the grooves between scales.
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
  diffuseColor.rgb *= dhAo;
  diffuseColor.rgb *= mix(1.0, 0.7 + 0.3 * dhHeight, uGrooveTint);`,
          )
          // Creases and seams are duller than the surrounding hide.
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor + (1.0 - dhAo) * uAoRough, 0.04, 1.0);`,
          )
          // Perturb the shading normal once the geometric one is established.
          .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + BUMP_BODY)
    },
    [uniforms],
  )

  // The injected program differs from stock physical material; give three a key
  // so it never hands us a cached program compiled without these chunks.
  useEffect(() => {
    const m = material.current
    if (!m) return
    m.customProgramCacheKey = () => 'dh-skin-v1'
    m.needsUpdate = true
  }, [onBeforeCompile])

  const p = PALETTE[theme]
  return (
    <meshPhysicalMaterial
      ref={material}
      color={p.color}
      metalness={p.metalness}
      roughness={p.roughness}
      clearcoat={p.clearcoat}
      clearcoatRoughness={p.clearcoatRoughness}
      envMapIntensity={p.envMapIntensity}
      sheen={p.sheen}
      sheenColor={p.sheenColor}
      onBeforeCompile={onBeforeCompile}
    />
  )
}
