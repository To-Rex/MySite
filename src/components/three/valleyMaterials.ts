import {
  AdditiveBlending,
  Color,
  DoubleSide,
  NormalBlending,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  type CanvasTexture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { LAKE, VOLCANO, WATER_LEVEL } from './valleyLand'

/**
 * Every shader the valley uses, and the uniforms the scene drives per frame.
 *
 * The uniforms live at module level for the same reason the hero's stage does:
 * they are written sixty times a second, and a memoised object is not something
 * a render may reach in and change. The materials are stock three materials
 * with chunks injected through `onBeforeCompile`, so they keep three's lighting,
 * shadows, fog and tone mapping and only add what is theirs.
 */

/* -------------------------------------------------------------------------- */
/* Shared uniforms                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Where the sun is: low over the left of the far ridge, behind it. The sky's
 * glow, the water's glint and the light through the grass all come from here;
 * the GLSL below spells the same vector out where a uniform is not to hand.
 */
export const SUN_DIR = new Vector3(-0.55, 0.1, -1).normalize()

/** A light breeze, which is what blows until the rock arrives. */
export const WIND_BREEZE = 0.34

/** Ground mist, wind and the daylight level, blended by the scene as the acts run. */
export const ATMOS = {
  uMistColor: { value: new Color('#d6ccb8') },
  uMistAmount: { value: 0.32 },
  /** Where the bank of mist sits; it thins with height above this. */
  uMistFloor: { value: WATER_LEVEL - 1 },
  uMistFall: { value: 0.1 },
  uMistDist: { value: 0.011 },
  uTime: { value: 0 },
  /** 1 in daylight, 0 in the dark: scales what the water and foliage show of themselves. */
  uLevel: { value: 1 },
  uWaterLevel: { value: WATER_LEVEL },
  /** The lake: centre and radius, for the wet margin round it. */
  uLake: { value: new Vector3(LAKE.x, LAKE.z, LAKE.r) },
  /** The volcano: centre and radius, for its rock and its gullies. */
  uVolcano: { value: new Vector3(VOLCANO.x, VOLCANO.z, VOLCANO.r) },
  /**
   * Where the meadow's blades stand: the fan's apex and how far it reaches.
   * The ground under them is the shade at the roots of the grass, not lit
   * ground. A reach of 0 when there is no grass.
   */
  uMeadow: { value: new Vector3(0, 0, 0) },
  uBump: { value: 0.6 },
  /** Where the ground burns: x, z and radius, and how far along the burn is. */
  uScorch: { value: new Vector3(0, 0, 1) },
  uScorchAmount: { value: 0 },
  /** Sway at the crown, as a fraction of the plant's height. */
  uSway: { value: 0.028 },
  /** The breeze: how hard, 0 to 1, and which way it blows on the map. */
  uWind: { value: WIND_BREEZE },
  uWindDir: { value: new Vector2(1, 0.3).normalize() },
  /** Towards the sun the sky draws, for light that comes through leaves and blades. */
  uSunDir: { value: SUN_DIR.clone() },
  /** What comes through them: the low sun's colour and strength. Set per frame. */
  uBack: { value: new Color('#ffb877') },
}

/** The sky dome and everything that reflects it. */
export const SKY = {
  uLow: { value: new Color('#f0d3a4') },
  uHigh: { value: new Color('#4e86bf') },
  uGlow: { value: new Color('#ffd9a0') },
  uSun: { value: 1 },
  uCloud: { value: 1 },
  uTime: { value: 0 },
}

/** The rock on the way down. */
export const ROCK = {
  uHeat: { value: 0 },
  uHeatDir: { value: new Vector3(0, -1, 0) },
}

export const TRAIL = { uStrength: { value: 0 } }
export const HALO = { uStrength: { value: 0 } }
export const SMOKE = { uScale: { value: 300 } }

/* -------------------------------------------------------------------------- */
/* GLSL                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Value noise, prefixed so it never collides with a chunk of three's.
 *
 * The lattice hash is integer arithmetic, not the usual fract(sin(...)): the
 * meadow evaluates this a dozen times for each of three quarters of a million
 * vertices a frame, and with a sine in it that alone was a quarter of the
 * frame. It is also exact at any distance from the origin, where the sine
 * version loses precision and starts to repeat.
 */
export const NOISE_GLSL = /* glsl */ `
float vvHash(vec2 p) {
  uvec2 q = uvec2(ivec2(p)) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n >> 8u) * (1.0 / 16777216.0);
}
float vvNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(vvHash(i), vvHash(i + vec2(1.0, 0.0)), f.x),
    mix(vvHash(i + vec2(0.0, 1.0)), vvHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
// The same noise with its gradient: (value, d/dx, d/dy).
vec3 vvNoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = vvHash(i);
  float b = vvHash(i + vec2(1.0, 0.0));
  float c = vvHash(i + vec2(0.0, 1.0));
  float d = vvHash(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
float vvFbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vvNoise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}
float vvFbm5(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vvNoise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}
`

/**
 * The wind, for anything that moves in it. Gusts are broad soft patches of
 * stronger air that travel downwind at about five metres a second, so one is
 * seen to cross the meadow and then reach the trees — the grass, the ferns and
 * the conifers all read the same field, which is what makes it look like one
 * breeze rather than a lot of things wobbling.
 */
export const WIND_PARS = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
`
export const WIND_GLSL = /* glsl */ `
float vvGust(vec2 p) {
  vec2 q = p * 0.021 - uWindDir * uTime * 0.105;
  float g = vvNoise(q) * 0.62 + vvNoise(q * 2.7 + vec2(5.2, 1.3) - uWindDir * uTime * 0.09) * 0.38;
  return smoothstep(0.3, 0.8, g);
}
`

/** The same sky as the dome, callable for any direction — the water reflects it. */
const SKY_FUNC = /* glsl */ `
vec3 vvSky(vec3 dir) {
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uLow, uHigh, smoothstep(0.5, 0.82, h));
  vec3 sunDir = normalize(vec3(-0.55, 0.1, -1.0));
  float toSun = max(0.0, dot(dir, sunDir));
  col += uGlow * (pow(toSun, 12.0) * 0.8 + pow(toSun, 900.0) * 3.0) * uSun;
  return col;
}
`

export const ATMOS_PARS_VERT = /* glsl */ `
varying vec3 vvWorld;
varying float vvDist;
`

export const ATMOS_PARS_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMistColor;
uniform float uMistAmount;
uniform float uMistFloor;
uniform float uMistFall;
uniform float uMistDist;
varying vec3 vvWorld;
varying float vvDist;
`

/** After project_vertex: the world position, instancing included, and the depth. */
export const ATMOS_VERT_BODY = /* glsl */ `
  {
    vec4 vvW = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      vvW = instanceMatrix * vvW;
    #endif
    vvW = modelMatrix * vvW;
    vvWorld = vvW.xyz;
    vvDist = -mvPosition.z;
  }
`

/**
 * Mist that pools on the valley floor: thicker low down and further away.
 * Applied after three's own fog, which handles distance on its own.
 */
export const MIST_BODY = /* glsl */ `
  {
    #ifdef USE_FOG
    // The haze is brighter and warmer looking towards the sun and cooler away
    // from it, which is most of what tells the eye how far off a ridge is.
    float vvSunward = pow(max(dot(normalize(vvWorld - cameraPosition), uSunDir), 0.0), 4.0);
    vec3 vvHaze = fogColor * mix(vec3(0.9, 0.95, 1.05), vec3(1.12, 1.05, 0.92), vvSunward);
    gl_FragColor.rgb += (vvHaze - fogColor) * fogFactor;
    #endif
    float vvMh = exp(-max(vvWorld.y - uMistFloor, 0.0) * uMistFall);
    float vvMd = 1.0 - exp(-vvDist * uMistDist);
    float vvMist = clamp(vvMh * vvMd * uMistAmount, 0.0, 1.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, vvMist);
  }
`

/**
 * The ground, decided per pixel from where it is and which way it faces:
 * moss where it is low and damp, dry grass and earth on the open floor, rock
 * wherever it steepens or climbs, and the whole thing broken up by noise at
 * four scales so no two square metres match. Names carry a `vt` prefix and
 * are left unbraced on purpose: the bump and roughness chunks further down
 * read them.
 *
 * The rock has relief that no mesh carries: crags on the ridges, and on the
 * volcano gullies that run from the summit to the foot. It is an analytic
 * height that goes into the bump below and, unlike the bump's own grain,
 * holds at any distance — the volcano is two hundred and seventy units off
 * and its gullies are what make it a mountain rather than a heap of sand.
 */
const TERRAIN_PARS = /* glsl */ `
uniform float uWaterLevel;
uniform vec3 uLake;
uniform vec3 uVolcano;
uniform vec3 uMeadow;
uniform float uBump;
uniform vec3 uScorch;
uniform float uScorchAmount;
varying vec3 vvNormalW;

// A ridged noise and its gradient: crests, and soft hollows between them.
// The crest is rounded over a width soft — a true crease turns the light over
// inside one pixel, and with nothing to antialias it inside a triangle every
// gully on a phone was a staircase.
vec3 vtRidge(vec2 q, float soft) {
  vec3 n1 = vvNoiseD(q);
  vec3 n2 = vvNoiseD(q * 2.17 + 5.3);
  float s1 = n1.x * 2.0 - 1.0;
  float s2 = n2.x * 2.0 - 1.0;
  float r1 = sqrt(s1 * s1 + soft * soft);
  float r2 = sqrt(s2 * s2 + soft * soft);
  float a = 1.0 + soft - r1;
  float b = 1.0 + soft - r2;
  vec2 da = -2.0 * (s1 / r1) * n1.yz;
  vec2 db = -2.0 * (s2 / r2) * n2.yz * 2.17;
  return vec3(a * a * 0.68 + b * b * 0.32, 1.36 * a * da + 0.64 * b * db);
}
float vtOnVolcano(vec2 p) {
  return 1.0 - smoothstep(uVolcano.z * 0.62, uVolcano.z, distance(p, uVolcano.xy));
}
// Relief in metres, with its slope on the map: gullies down the volcano,
// broken crags everywhere else. The slope is worked out with the height
// rather than from screen derivatives, which come in two-by-two blocks and
// turned the gullies into staircases. foot is how much ground a pixel
// covers: an octave finer than a few pixels is faded out rather than left to
// alias, which on a phone it did.
vec3 vtRelief(vec2 p, float foot) {
  vec2 v = p - uVolcano.xy;
  float d = max(length(v), 0.001);
  float on = vtOnVolcano(p);
  vec3 r = vec3(0.0);
  if (on > 0.0) {
    float ang = atan(v.y, v.x);
    vec2 dAng = vec2(-v.y, v.x) / (d * d);
    vec2 dD = v / d;
    // How much of a gully a pixel spans, for each of the two.
    float wide = foot * 9.0 / (6.2832 * d);
    float narrow = foot * 31.0 / (6.2832 * d);
    float fine = 1.0 - smoothstep(0.2, 0.45, narrow);
    vec3 g1 = vtRidge(vec2(ang * 9.0, d * 0.045), 0.12 + min(wide * 3.0, 0.5));
    vec3 g2 = vtRidge(vec2(ang * 31.0, d * 0.11) + 3.0, 0.14 + min(narrow * 3.0, 0.5));
    r.x = g1.x * 2.6 + g2.x * 0.7 * fine;
    r.yz = 2.6 * (g1.y * 9.0 * dAng + g1.z * 0.045 * dD) + 0.7 * fine * (g2.y * 31.0 * dAng + g2.z * 0.11 * dD);
    r *= on;
  }
  float keep = 1.0 - on * 0.6;
  float coarse = 1.0 - smoothstep(2.6, 4.5, foot);
  float small = 1.0 - smoothstep(1.0, 1.8, foot);
  vec3 c1 = vtRidge(p * 0.075, 0.12 + min(foot * 0.25, 0.5));
  vec3 c2 = vtRidge(p * 0.19 + 9.0, 0.12 + min(foot * 0.6, 0.5));
  r.x += (c1.x * 1.6 * coarse + c2.x * 0.55 * small) * keep;
  r.yz += (c1.yz * 0.12 * coarse + c2.yz * 0.1045 * small) * keep;
  return r;
}
`

const TERRAIN_COLOR = /* glsl */ `
  vec3 vtN = normalize(vvNormalW);
  vec2 vtP = vvWorld.xz;
  float vtSlope = 1.0 - vtN.y;
  // How much ground one pixel covers, across and up. Detail finer than a few
  // pixels is faded to its average rather than left to alias: far off, the
  // grain and the strata turned into shimmer and, on a phone, staircases.
  float vtFoot = length(fwidth(vtP));
  float vtFootY = fwidth(vvWorld.y);
  // One octave, the same one the grass reads, so the blades and the ground under them agree.
  float vtMacro = vvNoise(vtP * 0.013 + 3.0) * 0.5 + 0.25;
  float vtMid = vvFbm3(vtP * 0.09);
  float vtFine = mix(vvNoise(vtP * 0.7), 0.5, smoothstep(0.35, 1.0, vtFoot));
  vec2 vtPr = vec2(vtP.x * 0.62 - vtP.y * 0.78, vtP.x * 0.78 + vtP.y * 0.62);
  float vtGrain = mix(0.5 * (vvNoise(vtP * 2.9) + vvNoise(vtPr * 3.7 + 5.0)), 0.5, smoothstep(0.08, 0.3, vtFoot));
  vec3 vtMoss = mix(vec3(0.075, 0.13, 0.045), vec3(0.15, 0.22, 0.075), vtMid);
  vec3 vtGrass = mix(vec3(0.17, 0.22, 0.08), vec3(0.32, 0.33, 0.14), vtMid);
  vec3 vtEarth = mix(vec3(0.22, 0.17, 0.11), vec3(0.36, 0.28, 0.18), vtFine);
  float vtOnV = vtOnVolcano(vtP);
  float vtRocky = smoothstep(0.24, 0.5, vtSlope + (vtFine - 0.5) * 0.16);
  vtRocky = max(vtRocky, smoothstep(24.0, 40.0, vvWorld.y) * 0.7);
  float vtRockAmt = max(vtRocky, vtOnV * smoothstep(6.0, 18.0, vvWorld.y));
  #ifdef VT_RELIEF
    vec3 vtRelief0 = vtRockAmt > 0.02 ? vtRelief(vtP, vtFoot) : vec3(0.0);
  #else
    vec3 vtRelief0 = vec3(0.0);
  #endif
  float vtH0 = vtRelief0.x;
  // Strata: bands that run with the hillside rather than with the map, lighter
  // on the crests of the relief and darker down in it.
  float vtStrata = mix(vvFbm3(vec2(vvWorld.y * 0.35, dot(vtP, vec2(0.7)) * 0.12)), 0.5, smoothstep(0.5, 1.6, vtFootY));
  vec3 vtRock = mix(vec3(0.13, 0.12, 0.105), vec3(0.29, 0.27, 0.235), vtStrata);
  vtRock *= 0.72 + 0.2 * vtH0;
  // The volcano: dark basalt in the gullies and pale ash on the ribs between
  // them, old lava flows running down from the rim in darker tongues, rust
  // where the vent has stained it, and the forest climbing its foot.
  float vtRib = clamp(vtH0 * 0.34, 0.0, 1.0);
  vec2 vtVd = vtP - uVolcano.xy;
  float vtFlow = smoothstep(0.55, 0.8, vvNoise(vec2(atan(vtVd.y, vtVd.x) * 4.0, length(vtVd) * 0.012) + 7.0));
  vec3 vtBasalt = mix(vec3(0.05, 0.047, 0.046), vec3(0.2, 0.19, 0.175), vtRib);
  vtBasalt = mix(vtBasalt, vec3(0.035, 0.032, 0.032), vtFlow * 0.75);
  vtBasalt = mix(vtBasalt, vec3(0.2, 0.1, 0.06), smoothstep(38.0, 56.0, vvWorld.y) * (0.25 + 0.45 * vvNoise(vtP * 0.06 + 2.0)));
  vtBasalt *= 0.85 + 0.3 * vvNoise(vtP * 0.21 + 4.0);
  vtRock = mix(vtRock, vtBasalt, vtOnV);
  vtRockAmt *= 1.0 - vtOnV * (1.0 - smoothstep(10.0, 26.0, vvWorld.y + (vvNoise(vtP * 0.04) - 0.5) * 14.0));
  float vtWet = smoothstep(0.35, 0.7, vtMacro) * (1.0 - smoothstep(1.0, 12.0, vvWorld.y));
  vec3 vtFlat = mix(vtGrass, vtMoss, vtWet);
  vtFlat = mix(vtFlat, vtEarth, smoothstep(0.55, 0.8, vtMid) * 0.6);
  vec3 vtCol = mix(vtFlat, vtRock, vtRockAmt);
  vtCol *= 0.88 + 0.24 * vtGrain;
  // Patches the size of a field, so the floor is not one even tone.
  vtCol *= 0.78 + 0.44 * vvFbm3(vtP * 0.028 + 11.0);
  // The margin of the lake is dark and wet. By the lake, not by height alone:
  // most of the valley floor lies below the water line and is not shore.
  float vtShore = (1.0 - smoothstep(uWaterLevel + 0.2, uWaterLevel + 2.4, vvWorld.y))
    * (1.0 - smoothstep(1.0, 1.4, distance(vtP, uLake.xy) / uLake.z));
  vtCol *= 1.0 - 0.38 * vtShore;
  // Under the blades: the shade at the roots of the grass, wherever it grows.
  float vtGrassy = (1.0 - vtRockAmt) * (1.0 - vtShore) * (1.0 - smoothstep(0.55, 0.8, vtMid) * 0.6)
    * (1.0 - smoothstep(uMeadow.z * 0.7, uMeadow.z, distance(vtP, uMeadow.xy)));
  vtCol *= 1.0 - 0.36 * vtGrassy;
  // Beyond the blades, the meadow still shows the wind: a gust lays the grass
  // over and its paler side catches the light, in patches that run downwind.
  vtCol *= 1.0 + (vvGust(vtP) - 0.4) * 0.16 * (1.0 - vtRockAmt) * (1.0 - vtShore) * uWind;
  // And after the rock, the ground around the crater is char.
  float vtScorch = (1.0 - smoothstep(uScorch.z * 0.45, uScorch.z, distance(vtP, uScorch.xy))) * uScorchAmount;
  vtCol = mix(vtCol, vec3(0.05, 0.04, 0.035), vtScorch);
  diffuseColor.rgb = vtCol;
`

/**
 * Mikkelsen surface-gradient bump, the same construction the hide uses: the
 * height gradient is reconstructed from screen derivatives, so it needs no
 * tangents and no UVs — for the fine grain of the ground, faded out with
 * distance, where derivatives of noise turn to shimmer. Then the rock's
 * relief, from the slope it came with: differenced in world space it cost
 * three evaluations a pixel, five milliseconds a frame on a retina screen,
 * and from screen derivatives it was a staircase.
 */
const TERRAIN_BUMP = /* glsl */ `
  {
    float vtB = uBump * (1.0 - smoothstep(50.0, 170.0, vvDist));
    float vtH = vtB > 0.0
      ? vtB * (vvFbm3(vtP * 0.55) * 0.9 + vtGrain * 0.5 + vtRocky * vvFbm3(vtP * 1.3 + 40.0) * 1.4)
      : 0.0;
    vec3 vtSurf = -vViewPosition;
    vec3 vtDpdx = dFdx(vtSurf);
    vec3 vtDpdy = dFdy(vtSurf);
    float vtDx = dFdx(vtH);
    float vtDy = dFdy(vtH);
    vec3 vtR1 = cross(vtDpdy, normal);
    vec3 vtR2 = cross(normal, vtDpdx);
    float vtDet = dot(vtDpdx, vtR1);
    vec3 vtGrad = sign(vtDet) * (vtDx * vtR1 + vtDy * vtR2);
    normal = normalize(abs(vtDet) * normal - vtGrad);
    // The relief, from its own slope on the map, turned into view space.
    vec3 vtRel = vec3(vtRelief0.y, 0.0, vtRelief0.z) * vtRockAmt * 0.85;
    normal = normalize(normal - (viewMatrix * vec4(vtRel, 0.0)).xyz);
  }
`

/**
 * Wind, for instanced foliage. Each plant leans with the breeze — harder when a
 * gust reaches it, so the gusts seen crossing the meadow carry on into the
 * forest — and rocks about that lean, more at the crown than at the root. The
 * direction is the wind's on the map, turned into the plant's own frame,
 * because an instance is yawed at random and a sway in its local x would send
 * every tree a different way. The leaves flutter on top of that, more the
 * further they are from the stem. `uSwayHeight` is the plant's height in its
 * own units, so the same chunk serves a conifer and a fern.
 */
const SWAY_BODY = /* glsl */ `
  #ifdef USE_INSTANCING
  {
    vec3 vvBase = instanceMatrix[3].xyz;
    mat3 vvM = mat3(instanceMatrix);
    vec3 vvW = transpose(vvM) * vec3(uWindDir.x, 0.0, uWindDir.y) / max(length(vvM[0]), 1e-4);
    float vvH = clamp(transformed.y / uSwayHeight, 0.0, 1.0);
    float vvG = vvGust(vvBase.xz);
    float vvPh = uTime * 1.25 + vvBase.x * 0.21 + vvBase.z * 0.17;
    float vvLean = min(uSway * (0.35 + 1.4 * vvG) * (1.0 + 0.4 * sin(vvPh) + 0.15 * sin(vvPh * 2.3 + 1.3)), 0.22);
    transformed += vvW * vvLean * uSwayHeight * vvH * vvH;
    float vvOut = length(transformed.xz);
    transformed.y += sin(uTime * 7.0 + dot(transformed, vec3(1.7, 2.3, 1.9)) + vvBase.x) * uFlutter * vvOut * (0.35 + vvG);
  }
  #endif
`

/**
 * What a leaf does in the fragment shader. Alpha is held up as the texture
 * goes down its mip chain — averaged texels are fainter, and alpha-tested
 * foliage would otherwise thin out to nothing with distance. Both faces take
 * the normal the geometry was given, which for a crown is the crown's own
 * outward normal, so it shades as one mass and not as a heap of cards. And
 * light comes through from the low sun behind, the way it does through real
 * leaves.
 */
const LEAF_COVERAGE = /* glsl */ `
  #ifdef USE_MAP
  {
    vec2 vvTs = vec2(textureSize(map, 0));
    vec2 vvDx = dFdx(vMapUv * vvTs);
    vec2 vvDy = dFdy(vMapUv * vvTs);
    float vvLod = max(0.0, 0.5 * log2(max(dot(vvDx, vvDx), dot(vvDy, vvDy))));
    diffuseColor.a *= 1.0 + vvLod * 0.3;
  }
  #endif
`
const LEAF_FACING = /* glsl */ `
  #ifdef DOUBLE_SIDED
  normal *= faceDirection;
  nonPerturbedNormal = normal;
  #endif
`
const LEAF_THROUGH = /* glsl */ `
  {
    vec3 vvSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    float vvThrough = pow(max(dot(normalize(vViewPosition), -vvSun), 0.0), 3.0);
    reflectedLight.directDiffuse += diffuseColor.rgb * uBack * vvThrough * 0.55;
    reflectedLight.indirectSpecular *= 0.5;
  }
`

/** Ablation: the face into the wind is white-hot, the rest of the rock dull red. */
const HEAT_BODY = /* glsl */ `
  {
    float vvF = max(dot(normalize(vvHeatN), uHeatDir), 0.0);
    vec3 vvHot = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.95, 0.75), pow(vvF, 4.0));
    totalEmissiveRadiance += vvHot * (pow(vvF, 1.6) * uHeat + uHeat * 0.12);
  }
`

export type Shader = WebGLProgramParametersWithUniforms

export const mistUniforms = () => ({
  uSunDir: ATMOS.uSunDir,
  uMistColor: ATMOS.uMistColor,
  uMistAmount: ATMOS.uMistAmount,
  uMistFloor: ATMOS.uMistFloor,
  uMistFall: ATMOS.uMistFall,
  uMistDist: ATMOS.uMistDist,
})

/* -------------------------------------------------------------------------- */
/* Programs for three's own materials                                          */
/* -------------------------------------------------------------------------- */

/**
 * The ground. `relief` turns on the rock's analytic relief, eight noise
 * lookups with their gradients on every rocky pixel: everywhere but the
 * software renderer.
 */
export function terrainProgram(relief: boolean): (shader: Shader) => void {
  return (shader) => {
    Object.assign(shader.uniforms, mistUniforms(), {
      uWaterLevel: ATMOS.uWaterLevel,
      uLake: ATMOS.uLake,
      uVolcano: ATMOS.uVolcano,
      uMeadow: ATMOS.uMeadow,
      uBump: ATMOS.uBump,
      uScorch: ATMOS.uScorch,
      uScorchAmount: ATMOS.uScorchAmount,
      uTime: ATMOS.uTime,
      uWind: ATMOS.uWind,
      uWindDir: ATMOS.uWindDir,
    })
    shader.vertexShader =
      ATMOS_PARS_VERT +
      'varying vec3 vvNormalW;\n' +
      shader.vertexShader
        .replace(
          '#include <defaultnormal_vertex>',
          '#include <defaultnormal_vertex>\n  vvNormalW = normalize(mat3(modelMatrix) * objectNormal);',
        )
        .replace('#include <project_vertex>', '#include <project_vertex>' + ATMOS_VERT_BODY)
    shader.fragmentShader =
      (relief ? '#define VT_RELIEF\n' : '') +
      ATMOS_PARS_FRAG +
      WIND_PARS +
      NOISE_GLSL +
      WIND_GLSL +
      TERRAIN_PARS +
      shader.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>' + TERRAIN_COLOR)
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(roughnessFactor, 0.5, vtShore), 1.0, max(vtScorch, vtGrassy));',
        )
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + TERRAIN_BUMP)
        // Earth and grass are not glossy, and from this low an angle every
        // slope facing away from the sun came out as a grey sheen streaked by
        // its own bump. Rock keeps a little more, the wet shore all of it.
        .replace(
          '#include <lights_fragment_end>',
          '#include <lights_fragment_end>\n  {\n    float vtSpec = mix(mix(0.25, 0.6, vtRockAmt), 1.0, vtShore);\n    reflectedLight.directSpecular *= vtSpec;\n    reflectedLight.indirectSpecular *= vtSpec;\n  }',
        )
        .replace('#include <fog_fragment>', '#include <fog_fragment>' + MIST_BODY)
  }
}

/** Anything that only needs to sit in the mist: the volcano, the rock. */
export function atmosProgram(shader: Shader): void {
  Object.assign(shader.uniforms, mistUniforms())
  shader.vertexShader =
    ATMOS_PARS_VERT + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>' + ATMOS_VERT_BODY)
  shader.fragmentShader =
    ATMOS_PARS_FRAG + shader.fragmentShader.replace('#include <fog_fragment>', '#include <fog_fragment>' + MIST_BODY)
}

/**
 * Foliage: the wind, the leaf, and the mist. `flutter` is how far a leaf moves
 * for each unit it stands out from the stem.
 */
export function foliageProgram(height: number, flutter: number): (shader: Shader) => void {
  return (shader) => {
    Object.assign(shader.uniforms, mistUniforms(), {
      uTime: ATMOS.uTime,
      uWind: ATMOS.uWind,
      uWindDir: ATMOS.uWindDir,
      uSway: ATMOS.uSway,
      uSwayHeight: { value: height },
      uFlutter: { value: flutter },
      uBack: ATMOS.uBack,
    })
    shader.vertexShader =
      ATMOS_PARS_VERT +
      WIND_PARS +
      'uniform float uSway;\nuniform float uSwayHeight;\nuniform float uFlutter;\n' +
      NOISE_GLSL +
      WIND_GLSL +
      shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>' + SWAY_BODY)
        .replace('#include <project_vertex>', '#include <project_vertex>' + ATMOS_VERT_BODY)
    shader.fragmentShader =
      ATMOS_PARS_FRAG +
      'uniform vec3 uBack;\n' +
      shader.fragmentShader
        .replace('#include <alphatest_fragment>', LEAF_COVERAGE + '#include <alphatest_fragment>')
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + LEAF_FACING)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + LEAF_THROUGH)
        .replace('#include <fog_fragment>', '#include <fog_fragment>' + MIST_BODY)
  }
}

/** The rock, heated on the face it is falling through the air with. */
export function rockProgram(shader: Shader): void {
  Object.assign(shader.uniforms, { uHeat: ROCK.uHeat, uHeatDir: ROCK.uHeatDir })
  shader.vertexShader =
    'varying vec3 vvHeatN;\n' +
    shader.vertexShader.replace(
      '#include <defaultnormal_vertex>',
      '#include <defaultnormal_vertex>\n  vvHeatN = normalize(mat3(modelMatrix) * objectNormal);',
    )
  shader.fragmentShader =
    'uniform float uHeat;\nuniform vec3 uHeatDir;\nvarying vec3 vvHeatN;\n' +
    shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + HEAT_BODY)
}

/* -------------------------------------------------------------------------- */
/* Whole materials                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The lake. It reflects the same sky the dome draws — literally the same
 * function and the same uniforms — so whatever the act does to the sky, the
 * water follows. Ripples are two scrolling noise fields differenced into a
 * normal; the shore fades out over the last tenth of the radius.
 */
export function makeWaterMaterial(ripple: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      uLow: SKY.uLow,
      uHigh: SKY.uHigh,
      uGlow: SKY.uGlow,
      uSun: SKY.uSun,
      uTime: ATMOS.uTime,
      uLevel: ATMOS.uLevel,
      uRipple: { value: ripple },
      uCentre: { value: new Vector2(LAKE.x, LAKE.z) },
      uRadius: { value: LAKE.r },
      ...mistUniforms(),
    },
    vertexShader: /* glsl */ `
      varying vec3 vvWorld;
      varying float vvDist;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vvWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        vvDist = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLow;
      uniform vec3 uHigh;
      uniform vec3 uGlow;
      uniform float uSun;
      uniform float uTime;
      uniform float uLevel;
      uniform float uRipple;
      uniform vec2 uCentre;
      uniform float uRadius;
      ${ATMOS_PARS_FRAG}
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      ${SKY_FUNC}
      void main() {
        vec2 p = vvWorld.xz;
        float e = 0.35;
        vec2 q1 = p * 0.35 + vec2(uTime * 0.05, uTime * 0.03);
        vec2 q2 = p * 0.9 - vec2(uTime * 0.07, -uTime * 0.04);
        float h = vvFbm3(q1) + 0.5 * vvFbm3(q2);
        float hx = vvFbm3(q1 + vec2(e * 0.35, 0.0)) + 0.5 * vvFbm3(q2 + vec2(e * 0.9, 0.0));
        float hz = vvFbm3(q1 + vec2(0.0, e * 0.35)) + 0.5 * vvFbm3(q2 + vec2(0.0, e * 0.9));
        float rip = uRipple * (0.15 + 0.85 * (1.0 - smoothstep(50.0, 140.0, vvDist)));
        vec3 n = normalize(vec3(-(hx - h) * rip, e, -(hz - h) * rip));
        vec3 V = normalize(cameraPosition - vvWorld);
        vec3 R = reflect(-V, n);
        R.y = abs(R.y);
        vec3 refl = vvSky(R);
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        float q = length(p - uCentre) / uRadius;
        vec3 deep = vec3(0.045, 0.10, 0.09);
        vec3 shallow = vec3(0.15, 0.23, 0.15);
        vec3 body = mix(deep, shallow, smoothstep(0.45, 1.0, q)) * uLevel;
        vec3 sunDir = normalize(vec3(-0.55, 0.1, -1.0));
        float toSun = max(dot(R, sunDir), 0.0);
        float spec = pow(toSun, 600.0) * 1.6 + pow(toSun, 40.0) * 0.18;
        vec3 col = mix(body, refl * 0.92, F) + uGlow * spec * uSun;
        float alpha = (0.86 + 0.14 * F) * (1.0 - smoothstep(0.9, 1.0, q));
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
        ${MIST_BODY}
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: true,
  })
}

/**
 * The plasma behind the rock, on an open cone whose point is at the rock:
 * white-hot there, orange and ragged further back, gone at the far end.
 */
export function makeTrailMaterial(strength: { value: number }, blur: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: ATMOS.uTime,
      uStrength: strength,
      uBlur: { value: blur },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vAlong;
      void main() {
        vUv = uv;
        vAlong = position.y + 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uStrength;
      uniform float uBlur;
      varying vec2 vUv;
      varying float vAlong;
      ${NOISE_GLSL}
      void main() {
        float along = vAlong;
        float turb = vvFbm3(vec2(vUv.x * 5.0 + uTime * 0.2, along * 7.0 - uTime * 4.0));
        float core = smoothstep(0.6, 1.0, along);
        float body = pow(along, 1.7);
        float rag = smoothstep(0.2 - uBlur * 0.2, 0.6 + uBlur * 0.3, turb + along * 0.25);
        vec3 col = mix(vec3(1.0, 0.42, 0.10), vec3(1.0, 0.97, 0.85), core);
        float a = body * mix(0.25, 1.0, rag) * uStrength;
        gl_FragColor = vec4(col * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
}

/**
 * Sprites with a size and an opacity each — three's own points material has one
 * of each for the whole cloud, which is no good for smoke that has to thin out
 * puff by puff.
 */
export function makeSmokeMaterial(
  map: CanvasTexture | null,
  colour: string,
  additive = false,
  heat = false,
): ShaderMaterial {
  return new ShaderMaterial({
    defines: heat ? { HEAT: '' } : {},
    uniforms: {
      uMap: { value: map },
      uColor: { value: new Color(colour) },
      uScale: SMOKE.uScale,
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      varying float vA;
      uniform float uScale;
      #ifdef HEAT
        attribute float aHeat;
        varying float vH;
      #endif
      void main() {
        vA = aAlpha;
        #ifdef HEAT
          vH = aHeat;
        #endif
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (uScale / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vA;
      #ifdef HEAT
        varying float vH;
      #endif
      void main() {
        float m = texture2D(uMap, gl_PointCoord).a;
        #ifdef HEAT
          // Blackbody, roughly: soot, then red, orange, and white at the core.
          vec3 hot = mix(
            mix(vec3(0.02, 0.01, 0.01), vec3(1.0, 0.22, 0.04), smoothstep(0.0, 0.45, vH)),
            vec3(1.0, 0.96, 0.82),
            smoothstep(0.45, 1.0, vH)
          );
          gl_FragColor = vec4(hot * uColor, m * vA);
        #else
          gl_FragColor = vec4(uColor, m * vA);
        #endif
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  })
}

/* -------------------------------------------------------------------------- */
/* The sky dome                                                                */
/* -------------------------------------------------------------------------- */

export const SKY_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * The dome. With `SKY_DETAIL` (the two upper levels) the cloud is a deck of
 * cumulus rather than a smudge: five octaves, the coordinates warped by a
 * coarser noise so the shapes billow instead of tiling, and lit — the
 * density is read again a step towards the sun, and where there is more
 * cloud between a point and the light it is the shaded, blue-grey underside,
 * where there is less it is the lit edge, warm, and the thin cloud round the
 * sun glows through. Every colour comes from the act's own sky uniforms, so
 * the deck goes orange with the fire and out with the light.
 */
export const SKY_FRAG = /* glsl */ `
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform vec3 uGlow;
  uniform float uSun;
  uniform float uCloud;
  uniform float uTime;
  varying vec3 vPos;
  ${NOISE_GLSL}
  ${SKY_FUNC}
  void main() {
    vec3 dir = normalize(vPos);
    vec3 col = vvSky(dir);
    // Cloud, projected onto the dome, in two layers that drift at different
    // rates. Fades out with uCloud when the light goes.
    if (uCloud > 0.01 && dir.y > 0.0) {
      vec2 uv = dir.xz / max(dir.y, 0.12) * 0.5;
      #ifdef SKY_DETAIL
        vec3 sunDir = normalize(vec3(-0.55, 0.1, -1.0));
        vec2 drift = vec2(uTime * 0.006, uTime * 0.0016);
        vec2 warp = vec2(vvFbm3(uv * 0.8 + 3.1), vvFbm3(uv * 0.8 + 7.7)) - 0.5;
        vec2 q = uv * 1.1 + warp * 0.9 + drift;
        float dens = vvFbm5(q);
        vec2 towards = normalize(sunDir.xz / max(sunDir.y, 0.05) * 0.5 - uv);
        float ahead = vvFbm5(q + towards * 0.09);
        float cover = smoothstep(0.4, 0.7, dens) * smoothstep(0.02, 0.14, dir.y);
        float shade = clamp(0.5 + (ahead - dens) * 5.0 + (dens - 0.6) * 1.2, 0.0, 1.0);
        vec3 lit = mix(uGlow * 1.05 + vec3(0.12), uLow, 0.3);
        vec3 under = mix(uHigh, uLow, 0.5) * 0.68;
        vec3 cloud = mix(lit, under, shade);
        float toSun = max(dot(dir, sunDir), 0.0);
        cloud += uGlow * pow(toSun, 8.0) * (1.0 - cover) * 1.3 * uSun;
        col = mix(col, cloud, cover * uCloud * 0.92);
        float low = vvFbm3(uv * 1.9 + vec2(uTime * 0.011, uTime * 0.003) + 40.0);
        float wisps = smoothstep(0.58, 0.86, low) * smoothstep(0.0, 0.3, dir.y) * 0.4 * (1.0 - cover);
        col = mix(col, lit * 0.95, wisps * uCloud * 0.6);
      #else
        float high = vvFbm3(uv * 0.6 + vec2(uTime * 0.004, 0.0));
        float low = vvFbm3(uv * 1.7 + vec2(uTime * 0.011, uTime * 0.003) + 40.0);
        float cover = smoothstep(0.48, 0.78, high) * smoothstep(0.0, 0.22, dir.y);
        float wisps = smoothstep(0.55, 0.85, low) * smoothstep(0.0, 0.3, dir.y) * 0.5;
        vec3 cloud = mix(uHigh, uGlow, 0.65) + vec3(0.18);
        col = mix(col, cloud, cover * uCloud * 0.8);
        col = mix(col, cloud * 0.92, wisps * uCloud * 0.6);
      #endif
    }
    gl_FragColor = vec4(col, 1.0);
  }
`
