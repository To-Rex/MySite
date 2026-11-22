import {
  BufferAttribute,
  DataTexture,
  DoubleSide,
  FloatType,
  HalfFloatType,
  InstancedBufferGeometry,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three'
import type { ValleyQuality } from '@/lib/valley'
import { HERD } from './valleyCast'
import { GRID, prepareLand } from './valleyLand'
import {
  ATMOS,
  ATMOS_PARS_FRAG,
  ATMOS_PARS_VERT,
  ATMOS_VERT_BODY,
  CRATER_GLSL,
  FIRE,
  FIRE_GLSL,
  FIRE_PARS,
  MIST_BODY,
  NOISE_GLSL,
  WIND_GLSL,
  WIND_PARS,
  mistUniforms,
  type Shader,
} from './valleyMaterials'

/**
 * The meadow: up to a hundred and sixty thousand blades of grass, none of
 * them placed on the CPU.
 *
 * One blade is seven vertices near and a single triangle far, drawn
 * instanced as many times as the level allows; the vertex shader works out
 * from the instance's number alone where that blade stands, and from the
 * bake (below) how tall it is and what colour, then how the wind is bending
 * it this frame. Nothing per blade crosses the bus, and the warm-up has no
 * new work at all.
 *
 * The blades are planted in a fan that opens down the valley from just behind
 * the camera, in rows that get further apart with distance and columns that
 * spread with the angle, so there are as many blades per square metre of
 * *screen* near as far. Each stands on the mesh exactly: the heights are the
 * terrain grid itself, in a float texture, interpolated over the same two
 * triangles per quad `groundAt` uses. Where they grow follows the rules the
 * ground's colour follows — none on rock, the shore or the lake, short where
 * it is wet, sparse on bare earth — and in clumps, because grass grows in
 * clumps. A blade is never drawn narrower than about a pixel where it stands,
 * so the far field is tufts and not shimmer.
 */

/** Where the fan opens from: behind the camera at both ends of its dolly. */
const APEX: readonly [number, number] = [0, 34]
/** The nearest ground in shot is about forty units from the apex, the furthest blade a hundred and ninety. */
const NEAR = 40
const FAR = 190
/** Either side of what the lens takes in, for a camera held by hand. */
const MARGIN = 0.11
/** Below this span, in radians, the fan is filled more densely (see `columnsFor`). */
const NARROW = 1.25

/** How far round each kind the grass is trodden flat, as a fraction of its size. */
const CLEARING: Partial<Record<string, number>> = {
  turtle: 0.44,
  stegosaur: 0.22,
}

/**
 * Where the near blades stop and the far ones start, as a fraction of the rows.
 * About eighty units out a blade is a couple of pixels wide and one triangle
 * draws it as well as five do.
 */
const NEAR_SHARE = 0.45

/**
 * Rows from near to far, and blades per radian of fan, for each level. On a
 * 16:9 screen that is about 165 000 blades on `ultra`, 93 000 on `high` and
 * 30 000 on `medium`; a phone held upright draws well under half as many.
 * `ultra` was measured on an M2 with everything else the valley draws, and
 * holds sixty frames a second at this count because of the bake: working
 * each blade out every frame, it could not hold it at two thirds of it.
 * `low` is the software renderer and the weakest machines, where the
 * ground's own colour has to be the grass.
 */
export const GRASS_DENSITY: Record<ValleyQuality, { rows: number; perRadian: number } | null> = {
  low: null,
  medium: { rows: 150, perRadian: 130 },
  high: { rows: 260, perRadian: 236 },
  ultra: { rows: 340, perRadian: 320 },
}

/** Half the angle the fan has to open to: what the lens sees across, plus the margin. */
export function fanFor(fovDegrees: number, aspect: number): number {
  const across = Math.atan(Math.tan((fovDegrees * Math.PI) / 360) * Math.max(0.1, aspect))
  return Math.min(1.45, across + MARGIN)
}

/**
 * Columns across the fan. A phone held upright sees a slice a third as wide
 * as a laptop does, through the same height of lens, so the same blades per
 * radian left its meadow thin; a narrow fan is filled more densely instead,
 * up to a little over twice.
 */
function columnsFor(perRadian: number, half: number): number {
  const span = 2 * half
  const fill = Math.min(2.2, Math.max(1, NARROW / span))
  return Math.ceil(perRadian * span * fill) | 1
}

/** How many blades a level draws on a screen of this shape. */
export function bladeCount(quality: ValleyQuality, fovDegrees: number, aspect: number): number {
  const density = GRASS_DENSITY[quality]
  if (!density) return 0
  return density.rows * columnsFor(density.perRadian, fanFor(fovDegrees, aspect))
}

/** The blade itself and the meadow's own state, written by the scene as the acts run. */
export const GRASS = {
  uHeights: { value: null as DataTexture | null },
  uGrid: { value: new Vector4(GRID.x0, GRID.z0, GRID.step, GRID.segments) },
  uFan: { value: new Vector3(APEX[0], APEX[1], 0.8) },
  uRows: { value: new Vector4(1, 1, NEAR, FAR) },
  /** Height and width of an average blade, in metres. */
  uBlade: { value: new Vector2(0.95, 0.042) },
  /** The width of a pixel one unit from the lens. */
  uPixel: { value: 0.001 },
  /** 1 for every blade, 2 for every other one, each a little wider: what a slow machine gets. */
  uStride: { value: 1 },
  /** The bake: the ground, height and colour of every blade, a texel each (see `bakeGrass`). */
  uBakeA: { value: null as Texture | null },
  uBakeB: { value: null as Texture | null },
  /**
   * Nothing grows through an animal that is low to the ground: x, z and radius
   * for each. The tall ones stand in the grass, which is how they look grounded.
   */
  uClear: {
    value: HERD.map((h) => new Vector3(h.x, h.z, h.size * (CLEARING[h.kind] ?? 0))),
  },
  /** The blast front: x, z, how far it has got, and 1 once it is moving. */
  uBlast: { value: new Vector4(0, 0, 0, 0) },
}

/** Where each of the two draws starts counting blades. */
const FIRST = { near: { value: 0 }, far: { value: 0 } }

/** Back to how the meadow was before the rock. */
export function resetGrass(): void {
  GRASS.uBlast.value.set(0, 0, 0, 0)
  GRASS.uStride.value = 1
}

/* -------------------------------------------------------------------------- */
/* GLSL                                                                       */
/* -------------------------------------------------------------------------- */

/** What every grass program shares: the layout, the ground, and how a blade stands. */
const COMMON = /* glsl */ `
#define VG_CLEAR ${HERD.length}
uniform sampler2D uHeights;
uniform vec4 uGrid;
uniform vec3 uFan;
uniform vec4 uRows;
uniform vec2 uBlade;
uniform vec3 uClear[VG_CLEAR];
uniform float uWaterLevel;
uniform vec3 uLake;

uint vgMix(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float vgRand(uint id, uint k) {
  return float(vgMix(id * 8u + k) >> 8u) / 16777216.0;
}

// The mesh's height, over the same two triangles per quad as groundAt, and its slope.
float vgGround(vec2 p, out vec2 grad) {
  vec2 f = clamp((p - uGrid.xy) / uGrid.z, vec2(0.0), vec2(uGrid.w - 0.001));
  ivec2 i = ivec2(f);
  vec2 w = f - vec2(i);
  float a = texelFetch(uHeights, i, 0).r;
  float b = texelFetch(uHeights, i + ivec2(0, 1), 0).r;
  float c = texelFetch(uHeights, i + ivec2(1, 1), 0).r;
  float d = texelFetch(uHeights, i + ivec2(1, 0), 0).r;
  if (w.x + w.y <= 1.0) {
    grad = vec2(d - a, b - a) / uGrid.z;
    return a + w.x * (d - a) + w.y * (b - a);
  }
  grad = vec2(c - b, c - d) / uGrid.z;
  return c + (1.0 - w.x) * (b - c) + (1.0 - w.y) * (d - c);
}

// Where a blade stands, by its number, and how far out along the fan, 0 to 1.
vec2 vgPlace(float index, uint id, out float k) {
  float row = floor(index / uRows.y);
  float col = index - row * uRows.y;
  k = (row + vgRand(id, 0u)) / uRows.x;
  float r = uRows.z * pow(uRows.w / uRows.z, k);
  float a = uFan.z * (2.0 * (col + vgRand(id, 1u)) / uRows.y - 1.0);
  return uFan.xy + r * vec2(sin(a), -cos(a));
}

// Everything about a blade that does not change while it is on screen: the
// ground under it, how tall it grows there and the colour it is. Where it
// grows follows the same rules, on the same noise, as the ground's colour.
void vgStand(vec2 p, uint id, float k, out float y, out vec2 grad, out float h, out vec3 colour, out float seedHead) {
  y = vgGround(p, grad);
  float slope = 1.0 - inversesqrt(1.0 + dot(grad, grad));
  float mid = vvFbm3(p * 0.09);
  float macro = vvNoise(p * 0.013 + 3.0) * 0.5 + 0.25;
  float fine = vvNoise(p * 0.7);
  float rocky = max(smoothstep(0.24, 0.5, slope + (fine - 0.5) * 0.16), smoothstep(24.0, 40.0, y) * 0.7);
  float wet = smoothstep(0.35, 0.7, macro) * (1.0 - smoothstep(1.0, 12.0, y));
  float earth = smoothstep(0.55, 0.8, mid) * 0.6;
  float shore = (1.0 - smoothstep(uWaterLevel + 0.4, uWaterLevel + 2.6, y))
    * (1.0 - smoothstep(1.0, 1.4, distance(p, uLake.xy) / uLake.z));
  float clump = vvNoise(p * 0.42 + 13.0);
  float lush = (1.0 - rocky) * (1.0 - earth) * (1.0 - shore) * smoothstep(0.16, 0.5, clump + vgRand(id, 2u) * 0.3);
  // Shorter and shorter towards the far edge of the fan, so it has no edge.
  lush *= 1.0 - smoothstep(0.6, 1.0, k);
  for (int i = 0; i < VG_CLEAR; i++) {
    if (uClear[i].z > 0.0) lush *= smoothstep(uClear[i].z * 0.5, uClear[i].z, distance(p, uClear[i].xy));
  }
  // One stem in eight is in seed: taller, with a head the colour of straw.
  seedHead = step(0.875, vgRand(id + 104729u, 3u));
  h = uBlade.x * lush * (0.5 + 0.9 * vgRand(id, 3u)) * (0.7 + 0.6 * clump) * mix(1.0, 0.65, wet) * (1.0 + seedHead * 0.35);
  // Lush or dry by the same patches the ground has.
  float tone = vgRand(id + 7919u, 1u);
  float hue = vvNoise(p * 0.19 + 31.0);
  colour = mix(vec3(0.055, 0.11, 0.028), vec3(0.13, 0.2, 0.05), tone);
  colour = mix(colour, mix(vec3(0.09, 0.15, 0.03), vec3(0.17, 0.21, 0.06), tone), smoothstep(0.35, 0.75, hue));
  vec3 dry = mix(vec3(0.24, 0.2, 0.085), vec3(0.38, 0.31, 0.14), tone);
  colour = mix(colour, dry, smoothstep(0.42, 0.8, mid + (tone - 0.5) * 0.4) * (1.0 - wet) * 0.8);
}
`

const PARS_VERT = /* glsl */ `
uniform float uFirst;
uniform float uPixel;
uniform float uStride;
uniform vec4 uBlast;
uniform sampler2D uBakeA;
uniform sampler2D uBakeB;
varying vec3 vgColor;
varying vec3 vgGlow;
varying float vgT;
`

/**
 * In place of three's normal setup: everything about this blade, from its
 * number. Declares `objectNormal` as the chunk it replaces did, and `vgPos`
 * for the position chunk after it. Where the card can render to float
 * textures what does not change is read from the bake (see `bakeGrass`);
 * otherwise it is worked out here, for every vertex, every frame.
 */
const PLACE = /* glsl */ `
  float vgIndex = uFirst + float(gl_InstanceID) * uStride;
  uint vgId = uint(vgIndex);
  float vgK;
  vec2 vgP = vgPlace(vgIndex, vgId, vgK);
  float vgY;
  vec2 vgGrad;
  float vgH;
  vec3 vgBase;
  float vgSeedHead;
  #ifdef VG_BAKED
    float vgRowAt = floor(vgIndex / uRows.y);
    ivec2 vgTexel = ivec2(int(vgIndex - vgRowAt * uRows.y), int(vgRowAt));
    vec4 vgStandA = texelFetch(uBakeA, vgTexel, 0);
    vec4 vgStandB = texelFetch(uBakeB, vgTexel, 0);
    vgY = vgStandA.x;
    vgGrad = vgStandA.yz;
    vgH = vgStandA.w;
    vgBase = vgStandB.rgb;
    vgSeedHead = vgStandB.a;
  #else
    vgStand(vgP, vgId, vgK, vgY, vgGrad, vgH, vgBase, vgSeedHead);
  #endif

  // The crater, as it opens: the blades ride the ground it moves, and where
  // the bowl is and the ejecta lie thick there are none, vaporised or buried.
  if (uCrater.w > 0.0) {
    vec3 vgCr = vcCrater(vgP, uCrater.w);
    float vgQ = distance(vgP, uCrater.xy) / (uCrater.z * uCrater.w);
    vgY += vgCr.x + 0.08 * step(vgQ, VC_REACH);
    vgGrad += vgCr.yz;
    vgH *= smoothstep(1.25, 1.85, vgQ);
  }
  // The fire. The heat ahead of it dries a blade; then it burns down from the
  // tip to a black stubble, glowing where it burns, and the stubble greys.
  float vgAge = uSince > -50.0 ? vfAge(vgP) + (vgRand(vgId, 8u) - 0.5) * 0.35 : -100.0;
  float vgGone = smoothstep(0.0, 1.2, vgAge);
  float vgDry = smoothstep(-0.8, 0.05, vgAge) * (1.0 - vgGone);
  vgH *= 1.0 - 0.86 * vgGone;

  // Never narrower than about a pixel where it stands.
  float vgCam = distance(cameraPosition, vec3(vgP.x, vgY, vgP.y));
  float vgW = max(uBlade.y * sqrt(uStride) * (0.7 + 0.6 * vgRand(vgId, 4u)), uPixel * vgCam * 1.25);

  // How it bends: a lean of its own, the breeze and its gusts, a flutter, and
  // then the blast front, which lays everything down away from the crater.
  float vgYaw = vgRand(vgId, 5u) * 6.2832;
  float vgSeed = vgRand(vgId, 6u);
  vec2 vgBend = vec2(cos(vgSeed * 6.2832), sin(vgSeed * 6.2832)) * (0.1 + 0.28 * vgRand(vgId, 7u));
  float vgPh = uTime * (1.7 + 1.3 * vgSeed) + vgRand(vgId, 2u) * 6.2832;
  float vgGustHere = vvGust(vgP);
  vgBend += uWindDir * uWind * (0.3 + 1.3 * vgGustHere + 0.22 * sin(vgPh));
  vgBend += vec2(-uWindDir.y, uWindDir.x) * uWind * 0.1 * sin(vgPh * 1.7 + 2.0);
  float vgD = distance(vgP, uBlast.xy);
  float vgHit = (1.0 - smoothstep(uBlast.z - 16.0, uBlast.z, vgD)) * uBlast.w;
  vgBend = mix(vgBend, (vgP - uBlast.xy) / max(vgD, 0.01) * (1.5 - 0.6 * smoothstep(40.0, 125.0, vgD)), vgHit);
  float vgTheta = min(length(vgBend) * 1.15, 1.45);
  vec2 vgDir = vgBend / max(length(vgBend), 1e-4);

  // The blade: a strip curled along an arc as far as the bend says.
  float vgTt = position.y;
  float vgAng = vgTheta * vgTt;
  float vgUp = vgTheta < 1e-3 ? vgTt : sin(vgAng) / vgTheta;
  float vgOut = vgTheta < 1e-3 ? 0.5 * vgTheta * vgTt * vgTt : (1.0 - cos(vgAng)) / vgTheta;
  vec3 vgSide = vec3(cos(vgYaw), 0.0, sin(vgYaw));
  vec3 vgPos = vec3(vgP.x, vgY - 0.05, vgP.y)
    + vec3(vgDir.x * vgOut, vgUp, vgDir.y * vgOut) * vgH
    + vgSide * (position.x * 0.5 * vgW * (1.0 - vgTt * vgTt * 0.9));

  // Across its face, turned to the lens, and eased towards the ground's own
  // normal so a field of blades at every angle shades like a meadow and not
  // like glitter — and so grass on a slope that faces away from the sun is in
  // that slope's shade: lit as if it stood on the level, it made bright
  // streaks over dark ground.
  vec3 vgTan = vec3(vgDir.x * sin(vgAng), cos(vgAng), vgDir.y * sin(vgAng));
  vec3 vgN = normalize(cross(vgSide, vgTan));
  if (dot(vgN, cameraPosition - vgPos) < 0.0) vgN = -vgN;
  vec3 vgGroundN = normalize(vec3(-vgGrad.x, 1.0, -vgGrad.y));
  vec3 objectNormal = normalize(vgN + vgGroundN * 1.1 + vgSide * position.x * 0.25);

  // Paler and drier at the tip, dark at the root where little light gets in,
  // char where it burnt.
  float vgTone = vgRand(vgId + 7919u, 1u);
  vec3 vgC = mix(vgBase, vgBase * vec3(1.3, 1.2, 0.78) + vec3(0.03, 0.025, 0.0), vgTt * vgTt * 0.7);
  vgC = mix(vgC, vec3(0.3, 0.22, 0.1) * (0.7 + 0.6 * vgTone), vgSeedHead * smoothstep(0.62, 0.9, vgTt));
  vgC *= mix(0.26, 1.0, smoothstep(0.0, 0.62, vgTt));
  vgC = mix(vgC, vec3(0.2, 0.13, 0.05) * (0.7 + 0.6 * vgTone), vgDry * 0.85);
  vec3 vgAshen = mix(vec3(0.022, 0.02, 0.018), vec3(0.22, 0.215, 0.21), smoothstep(2.0, 6.0, vgAge) * 0.7);
  vgColor = mix(vgC, vgAshen, vgGone);
  // The tip of a blade that is burning, briefly, and not every blade at once.
  float vgFlame = smoothstep(-0.05, 0.12, vgAge) * (1.0 - smoothstep(0.25, 0.7, vgAge)) * step(0.45, vgRand(vgId, 9u));
  vgGlow = vec3(1.0, 0.36, 0.07) * vgFlame * smoothstep(0.4, 1.0, vgTt) * 1.3;
  vgT = vgTt;
`

const PARS_FRAG = /* glsl */ `
uniform vec3 uBack;
varying vec3 vgColor;
varying vec3 vgGlow;
varying float vgT;
`

/** Light coming through the blade from the low sun behind it: the meadow glows where it is backlit. */
const THROUGH = /* glsl */ `
  {
    vec3 vgSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    float vgThrough = pow(max(dot(normalize(vViewPosition), -vgSun), 0.0), 2.5);
    reflectedLight.directDiffuse += diffuseColor.rgb * uBack * vgThrough * (0.2 + 0.8 * vgT);
    reflectedLight.indirectSpecular *= 0.5;
  }
`

/** The program, for the draw that starts at instance `first`; `baked` reads the bake rather than working it out. */
function grassProgram(first: { value: number }, baked: boolean): (shader: Shader) => void {
  return (shader) => {
    Object.assign(shader.uniforms, mistUniforms(), GRASS, {
      uFirst: first,
      uTime: ATMOS.uTime,
      uWind: ATMOS.uWind,
      uWindDir: ATMOS.uWindDir,
      uCrater: FIRE.uCrater,
      uSince: FIRE.uSince,
      uMelt: FIRE.uMelt,
      uWaterLevel: ATMOS.uWaterLevel,
      uLake: ATMOS.uLake,
      uSunDir: ATMOS.uSunDir,
      uBack: ATMOS.uBack,
    })
    shader.vertexShader =
      (baked ? '#define VG_BAKED\n' : '') +
      ATMOS_PARS_VERT +
      WIND_PARS +
      NOISE_GLSL +
      WIND_GLSL +
      FIRE_PARS +
      CRATER_GLSL +
      FIRE_GLSL +
      COMMON +
      PARS_VERT +
      shader.vertexShader
        .replace('#include <beginnormal_vertex>', PLACE)
        .replace('#include <begin_vertex>', 'vec3 transformed = vgPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>' + ATMOS_VERT_BODY)
    shader.fragmentShader =
      ATMOS_PARS_FRAG +
      PARS_FRAG +
      shader.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = vgColor;')
        // Both faces take the normal the vertex shader turned to the lens.
        .replace(
          '#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\n  #ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n  nonPerturbedNormal = normal;\n  #endif',
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vgGlow;')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + THROUGH)
        .replace('#include <fog_fragment>', '#include <fog_fragment>' + MIST_BODY)
  }
}

/**
 * One blade, x across and y along. Near: three pairs up a tapering strip and a
 * point, so it can curl. Far: a single triangle, which at two pixels wide is
 * all a blade is.
 */
function bladeGeometry(near: boolean): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry()
  const position = near
    ? new Float32Array([-1, 0, 0, 1, 0, 0, -1, 0.36, 0, 1, 0.36, 0, -1, 0.7, 0, 1, 0.7, 0, 0, 1, 0])
    : new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0])
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setIndex(near ? [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6] : [0, 1, 2])
  // Never culled, but three still asks.
  geometry.boundingSphere = new Sphere(new Vector3(APEX[0], 0, APEX[1] - FAR / 2), FAR)
  geometry.instanceCount = 0
  return geometry
}

function grassMaterial(first: { value: number }, baked: boolean): MeshLambertMaterial {
  // Lambert, not standard: no specular to work out for half a million
  // fragments a frame — and grass is not glossy, from this low an angle the
  // sheen off every blade turned whole hillsides the grey of the sky.
  const material = new MeshLambertMaterial({ side: DoubleSide })
  material.onBeforeCompile = grassProgram(first, baked)
  // Both draws run the same source; only the uniform differs.
  material.customProgramCacheKey = () => (baked ? 'valley-grass-baked' : 'valley-grass')
  return material
}

/** The ground's heights as a float texture, for the blades to stand on. */
export function grassHeights(): DataTexture {
  const n = GRID.segments + 1
  // A copy: the crater is cut into this one, not into the grid `groundAt` reads.
  const texture = new DataTexture(Float32Array.from(prepareLand()), n, n, RedFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/* -------------------------------------------------------------------------- */
/* The two draws                                                               */
/* -------------------------------------------------------------------------- */

export interface GrassDraws {
  near: { geometry: InstancedBufferGeometry; material: MeshLambertMaterial }
  far: { geometry: InstancedBufferGeometry; material: MeshLambertMaterial }
  baked: boolean
}

/** `baked` where the card can render to float textures (see `canBake`). */
export function grassDraws(baked: boolean): GrassDraws {
  return {
    near: { geometry: bladeGeometry(true), material: grassMaterial(FIRST.near, baked) },
    far: { geometry: bladeGeometry(false), material: grassMaterial(FIRST.far, baked) },
    baked,
  }
}

/** The draws as last laid out, for `thinGrass`. */
let laid: { draws: GrassDraws; nearRows: number; farRows: number; columns: number } | null = null

function count(): void {
  if (!laid) return
  const stride = GRASS.uStride.value
  laid.draws.near.geometry.instanceCount = Math.ceil((laid.nearRows * laid.columns) / stride)
  laid.draws.far.geometry.instanceCount = Math.ceil((laid.farRows * laid.columns) / stride)
}

/**
 * Every other blade, each a little wider. The step a machine that is missing
 * frames takes after its resolution and before its shadows: the meadow is
 * most of what the valley costs, and at half the blades it still reads as one.
 */
export function thinGrass(): void {
  GRASS.uStride.value = 2
  count()
}

export function disposeGrass(draws: GrassDraws): void {
  if (laid?.draws === draws) laid = null
  for (const draw of [draws.near, draws.far]) {
    draw.geometry.dispose()
    draw.material.dispose()
  }
  if (bake) {
    for (const target of bake.targets) target.dispose()
    for (const material of bake.materials) material.dispose()
    bake.mesh.geometry.dispose()
    bake = null
    GRASS.uBakeA.value = null
    GRASS.uBakeB.value = null
  }
}

/** Makes `heights` the ground the blades stand on, until the returned function lets it go. */
export function holdHeights(heights: DataTexture): () => void {
  GRASS.uHeights.value = heights
  resetGrass()
  return () => {
    if (GRASS.uHeights.value === heights) GRASS.uHeights.value = null
    heights.dispose()
  }
}

/**
 * Opens the fan as wide as the lens does — a wider screen gets more blades,
 * not the same blades further apart — and splits the rows between the draws.
 */
export function layGrass(draws: GrassDraws, quality: ValleyQuality, fovDegrees: number, aspect: number): void {
  const density = GRASS_DENSITY[quality]
  ATMOS.uMeadow.value.set(APEX[0], APEX[1], density ? FAR : 0)
  if (!density) return
  const half = fanFor(fovDegrees, aspect)
  // Odd, so that every other blade is a different column in alternate rows.
  const columns = columnsFor(density.perRadian, half)
  const nearRows = Math.round(density.rows * NEAR_SHARE)
  GRASS.uFan.value.z = half
  GRASS.uRows.value.set(density.rows, columns, NEAR, FAR)
  FIRST.far.value = nearRows * columns
  laid = { draws, nearRows, farRows: density.rows - nearRows, columns }
  count()
}

/** The width of a device pixel one unit from the lens: blades are never drawn thinner than about this. */
export function setGrassPixel(fovDegrees: number, bufferHeight: number): void {
  GRASS.uPixel.value = (2 * Math.tan((fovDegrees * Math.PI) / 360)) / Math.max(1, bufferHeight)
}

/* -------------------------------------------------------------------------- */
/* The bake                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What a blade is — the ground under it, how tall it grows, its colour — does
 * not change while it is on screen, and working it out is most of the noise
 * in the blade's program: a dozen lookups, for each of seven vertices, for a
 * hundred thousand blades, every frame. So it is worked out once, into two
 * float textures with a texel for each blade, by drawing one quad the size of
 * the layout; the blades read it back with two fetches. Done when the meadow
 * is laid out, again if the screen changes shape, and again when the crater
 * is cut. A card that cannot draw into a float texture gets the old way.
 */
const BAKE_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

function bakeFragment(pass: 0 | 1): string {
  return (
    NOISE_GLSL +
    COMMON +
    /* glsl */ `
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float index = cell.y * uRows.y + cell.x;
  uint id = uint(index);
  float k;
  vec2 p = vgPlace(index, id, k);
  float y;
  vec2 grad;
  float h;
  vec3 colour;
  float seedHead;
  vgStand(p, id, k, y, grad, h, colour, seedHead);
  gl_FragColor = ${pass === 0 ? 'vec4(y, grad, h)' : 'vec4(colour, seedHead)'};
}
`
  )
}

interface Bake {
  targets: [WebGLRenderTarget, WebGLRenderTarget]
  materials: [ShaderMaterial, ShaderMaterial]
  mesh: Mesh
  camera: OrthographicCamera
}

let bake: Bake | null = null

/** Whether this card can draw into a float texture, which the bake needs. */
export function canBake(gl: WebGLRenderer): boolean {
  return gl.extensions.has('EXT_color_buffer_float')
}

function makeBake(): Bake {
  const uniforms = {
    uHeights: GRASS.uHeights,
    uGrid: GRASS.uGrid,
    uFan: GRASS.uFan,
    uRows: GRASS.uRows,
    uBlade: GRASS.uBlade,
    uClear: GRASS.uClear,
    uWaterLevel: ATMOS.uWaterLevel,
    uLake: ATMOS.uLake,
  }
  const target = () =>
    new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    })
  const material = (pass: 0 | 1) =>
    new ShaderMaterial({ uniforms, vertexShader: BAKE_VERT, fragmentShader: bakeFragment(pass), depthTest: false, depthWrite: false })
  const mesh = new Mesh(new PlaneGeometry(2, 2))
  mesh.frustumCulled = false
  return { targets: [target(), target()], materials: [material(0), material(1)], mesh, camera: new OrthographicCamera() }
}

/** Bakes the meadow as last laid out. */
export function bakeGrass(gl: WebGLRenderer): void {
  if (!laid?.draws.baked) return
  bake ??= makeBake()
  const width = laid.columns
  const height = laid.nearRows + laid.farRows
  const previous = gl.getRenderTarget()
  for (let pass = 0; pass < 2; pass++) {
    const target = bake.targets[pass]!
    if (target.width !== width || target.height !== height) target.setSize(width, height)
    bake.mesh.material = bake.materials[pass]!
    gl.setRenderTarget(target)
    gl.render(bake.mesh, bake.camera)
  }
  gl.setRenderTarget(previous)
  GRASS.uBakeA.value = bake.targets[0].texture
  GRASS.uBakeB.value = bake.targets[1].texture
}
