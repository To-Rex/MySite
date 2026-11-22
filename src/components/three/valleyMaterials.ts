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
  Vector4,
  type CanvasTexture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { CRATER, LAKE, VOLCANO, WATER_LEVEL } from './valleyLand'

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

/**
 * The crater and the fire, from the moment the rock lands. Everything that
 * burns reads the same clock and the same front, so the ground, the grass,
 * the trees, the flames and the smoke all agree about where the fire is.
 */
export const FIRE = {
  /** The crater: centre x, z, the radius of its rim, and how far it has opened, 0 to 1. */
  uCrater: { value: new Vector4(CRATER.x, CRATER.z, CRATER.r, 0) },
  /** Seconds since the rock landed; far in the past's opposite before it has. */
  uSince: { value: -100 },
  /** How hot the crater's floor still is: 1 as it forms, cooling after. */
  uMelt: { value: 0 },
  /** How much of the light in the valley is the fire's, 0 to 1. */
  uGlow: { value: 0 },
}

/** Back to before the rock. */
export function resetFire(): void {
  FIRE.uCrater.value.w = 0
  FIRE.uSince.value = -100
  FIRE.uMelt.value = 0
  FIRE.uGlow.value = 0
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

const glslFloat = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`)

/** What reads the crater and the fire: its uniforms. */
export const FIRE_PARS = /* glsl */ `
uniform vec4 uCrater;
uniform float uSince;
uniform float uMelt;
`

/**
 * The crater's shape, the same function as `craterProfile` in `valleyLand.ts`
 * (the herd and everything else placed on the ground read that one), with its
 * slope on the map so a displaced surface can be lit.
 */
export const CRATER_GLSL = /* glsl */ `
const float VC_DEPTH = ${glslFloat(CRATER.depth)};
const float VC_REACH = ${glslFloat(CRATER.reach)};
float vcRim(float a) {
  return ${glslFloat(CRATER.rim)} * (0.82 + 0.16 * sin(3.0 * a + 1.0) + 0.1 * sin(5.0 * a + 2.3) + 0.05 * sin(11.0 * a + 0.4));
}
// Height above the ground that was there, and its slope, grow of the way open.
vec3 vcCrater(vec2 p, float grow) {
  if (grow <= 0.0) return vec3(0.0);
  vec2 v = p - uCrater.xy;
  float d = max(length(v), 1e-3);
  float q = d / (uCrater.z * grow);
  if (q >= VC_REACH) return vec3(0.0);
  float rim = vcRim(atan(v.y, v.x));
  float h;
  float dh;
  if (q < 1.0) {
    float w = 1.0 - q * q;
    h = -VC_DEPTH + (VC_DEPTH + rim) * (1.0 - w * w);
    dh = (VC_DEPTH + rim) * 4.0 * q * w;
  } else {
    float a = 2.2 * (q - 1.0);
    float b = 1.0 + a * a;
    float t = clamp((q - VC_REACH + 0.45) / 0.45, 0.0, 1.0);
    float f = 1.0 - t * t * (3.0 - 2.0 * t);
    float base = rim * pow(b, -1.5);
    h = base * f;
    dh = rim * -6.6 * a * pow(b, -2.5) * f - base * 6.0 * t * (1.0 - t) / 0.45;
  }
  return vec3(h * grow, dh / uCrater.z * (v / d));
}
`

/**
 * The fire. It comes in just behind the blast front — `blastArrival` in
 * `valleyLand.ts` is the same function — and raggedly, a patch here catching
 * a little later than a patch there; past where the front ran out it carries
 * on by itself, slower. Everything that burns asks how long it has been
 * burning at its own spot, and goes by that.
 */
export const FIRE_GLSL = /* glsl */ `
float vfArrival(float d) {
  if (d <= 4.0) return 0.3;
  if (d <= 79.0) return 0.3 + (d - 4.0) / 50.0;
  if (d <= 129.0) return 1.8 + 2.1 * (1.0 - sqrt(max(0.0, 1.0 - (d - 79.0) / 50.0)));
  return 3.9 + (d - 129.0) / 20.0;
}
// Seconds a point has been burning; negative before the fire reaches it.
float vfAge(vec2 p) {
  return uSince - vfArrival(distance(p, uCrater.xy)) - 0.12 - vvNoise(p * 0.05 + 21.0) * 0.75;
}
// What burning ground gives off. The flames, in a narrow band as the fire
// passes and broken into patches, not a sheet; then dull red where the fuel
// lay thickest, smouldering for a few seconds; and embers, fine sparks in
// the char, the last to go. foot is how much ground a pixel covers: sparks
// finer than that are their average glow, not shimmer.
vec3 vfGroundGlow(vec2 p, float age, float fuel, float foot) {
  if (age < -0.2 || age > 12.0 || fuel <= 0.01) return vec3(0.0);
  float flick = vvNoise(p * 0.55 + vec2(uTime * 2.3, -uTime * 1.9));
  float flame = 0.0;
  if (age < 0.85) {
    float patchy = smoothstep(0.25, 0.75, vvNoise(p * 0.12 + 5.0));
    flame = smoothstep(-0.1, 0.12, age) * (1.0 - smoothstep(0.2, 0.85, age)) * (0.35 + 0.65 * flick) * (0.3 + 0.7 * patchy);
  }
  float smoulder = age > 0.3 ? smoothstep(0.62, 0.88, vvNoise(p * 0.9 + 11.0)) * smoothstep(0.3, 1.0, age) * exp(-max(age - 1.0, 0.0) * 0.6) : 0.0;
  // Sparks finer than a pixel are their average glow, and cost nothing to work out.
  float far = smoothstep(0.12, 0.5, foot);
  float speck = far < 1.0 ? mix(smoothstep(0.86, 0.97, vvNoise(p * 4.5 + 7.0)), 0.025, far) : 0.025;
  float ember = smoothstep(0.3, 1.0, age) * exp(-max(age - 1.0, 0.0) * 0.3) * speck * (0.6 + 0.4 * flick);
  return (vec3(1.0, 0.38, 0.07) * flame * 1.1 + vec3(0.8, 0.14, 0.02) * smoulder * 0.5 + vec3(1.0, 0.3, 0.05) * ember * 2.0) * fuel;
}
// The crater's floor: a pool of melt, glowing all over as it forms and then
// only along the cracks in the black crust that skins it as it cools.
vec3 vcMeltGlow(vec2 p, float q, float foot) {
  if (uMelt <= 0.0 || q > 0.8) return vec3(0.0);
  float pool = 1.0 - smoothstep(0.3, 0.8, q);
  float c1 = 1.0 - abs(vvNoise(p * 0.32) * 2.0 - 1.0);
  float c2 = 1.0 - abs(vvNoise(p * 0.95 + 5.0) * 2.0 - 1.0);
  float crack = mix(max(pow(c1, 9.0), pow(c2, 12.0) * 0.75), 0.18, smoothstep(0.4, 1.4, foot));
  float heat = uMelt * pool * (0.07 + 0.93 * crack) + uMelt * uMelt * uMelt * pool * 0.7;
  vec3 c = mix(vec3(0.5, 0.05, 0.01), vec3(1.0, 0.4, 0.07), smoothstep(0.2, 0.75, heat));
  c = mix(c, vec3(1.0, 0.86, 0.58), smoothstep(0.85, 1.3, heat));
  return c * heat * 1.8;
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
varying vec3 vvNormalW;
${FIRE_PARS}
${CRATER_GLSL}
${FIRE_GLSL}

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
  // After the rock. The fire: what can burn goes to char behind the front and
  // then to ash, grey, and palest where the grass stood thickest; rock is
  // only blackened.
  // None of it is worked out before the rock has landed, or where the fire
  // has not reached: most of the showing, most of the pixels.
  float vtAge = uSince > -50.0 ? vfAge(vtP) : -100.0;
  float vtFuel = (1.0 - vtRockAmt * 0.8) * (1.0 - vtShore * 0.7);
  float vtCharA = smoothstep(-0.25, 1.0, vtAge);
  // Where the crater is, in its radii as it opens. Inside the rim everything
  // below is the crater's own, so the burn is not worked out there at all.
  float vtQ = uCrater.w > 0.0 ? distance(vtP, uCrater.xy) / (uCrater.z * uCrater.w) : 99.0;
  if (vtCharA > 0.0 && vtQ > 0.8) {
    float vtAshA = smoothstep(1.5, 5.5, vtAge + (vtMid - 0.5) * 2.4);
    vec3 vtCharC = vec3(0.032, 0.029, 0.026) * (0.7 + 0.6 * vtGrain);
    vec3 vtAshC = mix(vec3(0.16, 0.155, 0.15), vec3(0.42, 0.41, 0.4), vtFine) * (0.65 + 0.7 * (vvNoise(vtP * 0.19 + 3.0) * 0.6 + vtMid * 0.4));
    vtCol = mix(vtCol, mix(vtCharC, vtAshC, vtAshA * (0.35 + 0.65 * vtGrassy)), vtCharA * vtFuel);
    vtCol *= 1.0 - vtCharA * (1.0 - vtFuel) * 0.45;
  }
  // The crater: fresh rock in its walls, in the beds it was cut through;
  // black glassy melt on its floor; and round it a blanket of what it threw
  // out, in rays, lying over the char.
  float vtBlanket = 0.0;
  if (vtQ < VC_REACH) {
    vec2 vtCv = vtP - uCrater.xy;
    float vtAng = atan(vtCv.y, vtCv.x);
    // Each part worked out only where it shows: the crater is a fifth of the
    // screen once the camera is over it, and every lookup here is paid there.
    float vtRay = vvNoise(vec2(vtAng * 13.0, vtQ * 0.5));
    vtBlanket = vtQ < 0.8 ? 1.0 : 1.0 - smoothstep(1.0, 1.75 + vtRay * 0.7, vtQ + (vvNoise(vtP * 0.21) - 0.5) * 0.4);
    vec3 vtCraterC = vec3(0.0);
    if (vtQ > 0.9) {
      vtCraterC = mix(vec3(0.13, 0.115, 0.1), vec3(0.37, 0.33, 0.28), smoothstep(0.3, 0.8, vtRay)) * (0.75 + 0.5 * vtFine);
    }
    if (vtQ < 1.05) {
      // The rock it was cut through, in beds, and gullies of fresh scree down
      // the wall, paler than the beds they cut.
      float vtBed = vvNoise(vec2(vvWorld.y * 0.8 + vtAng * 0.6, vtAng * 2.0));
      float vtScree = smoothstep(0.55, 0.85, vvNoise(vec2(vtAng * 26.0, vtQ * 2.5)));
      vec3 vtWallC = mix(vec3(0.12, 0.1, 0.085), vec3(0.38, 0.32, 0.26), vtBed) * (0.8 + 0.4 * vtFine);
      vtWallC = mix(vtWallC, vec3(0.42, 0.38, 0.33), vtScree * 0.45 * smoothstep(0.45, 0.8, vtQ));
      vtCraterC = mix(vtWallC, vtCraterC, smoothstep(0.92, 1.05, vtQ));
    }
    vtCraterC = mix(vtCraterC, vec3(0.03, 0.026, 0.024) * (0.8 + 0.4 * vtGrain), 1.0 - smoothstep(0.32, 0.6, vtQ));
    // The ash coming down settles on all of it.
    vtCraterC = mix(vtCraterC, vec3(0.3, 0.29, 0.28) * (0.8 + 0.4 * vtFine), smoothstep(3.0, 9.0, uSince) * 0.3 * smoothstep(0.45, 0.7, vtQ));
    vtCol = mix(vtCol, vtCraterC, vtBlanket);
  }
  diffuseColor.rgb = vtCol;
  // What glows: flames and then embers where it burns, melt in the crater,
  // and the crater's walls lit red from the melt below them.
  vec3 vtGlow = vfGroundGlow(vtP, vtAge, vtFuel * (1.0 - vtBlanket), vtFoot) + vcMeltGlow(vtP, vtQ, vtFoot);
  vtGlow += vtCol * vec3(1.0, 0.32, 0.08) * uMelt * 0.55 * (1.0 - smoothstep(0.3, 0.75, vtQ));
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

/**
 * The fire, in a plant. It climbs: the lower branches catch before the crown.
 * The leaves scorch brown in the heat ahead of it, then burn away from a
 * ragged glowing edge until nothing of them is left; the wood chars black,
 * glows in its cracks for a while, and stays — so a forest burns down to its
 * trunks and limbs, the way one does. `uLeafU` is where the leaf is on the
 * texture along u; anything outside it is bark.
 */
const BURN_VERT = /* glsl */ `
  #ifdef USE_INSTANCING
    vfA = uSince > -50.0 ? vfAge(instanceMatrix[3].xz) - clamp(position.y / uSwayHeight, 0.0, 1.0) * 0.7 : -100.0;
  #else
    vfA = -100.0;
  #endif
`
const BURN_FRAG = /* glsl */ `
  #ifdef USE_MAP
    float vfLeaf = step(uLeafU.x, vMapUv.x) * step(vMapUv.x, uLeafU.y);
  #else
    float vfLeaf = 1.0;
  #endif
  vec3 vfGlow = vec3(0.0);
  // Nothing to work out until the heat reaches the plant.
  if (vfA > -1.0) {
    float vfN = vvNoise(vvWorld.xz * 1.7 + vvWorld.y * 1.3);
    float vfCut = smoothstep(0.0, 1.8, vfA) + (vfN - 0.5) * 0.6;
    if (vfLeaf > 0.5 && vfCut > 0.55) discard;
    float vfEdge = vfLeaf * smoothstep(0.3, 0.55, vfCut) * step(-0.1, vfA);
    float vfScorch = smoothstep(-1.0, 0.1, vfA) * vfLeaf;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.1, 0.04) * (0.6 + 0.8 * vfN), vfScorch * 0.85);
    float vfChar = max(vfEdge, (1.0 - vfLeaf) * smoothstep(-0.2, 1.4, vfA));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.019, 0.017), vfChar);
    // Embers in the bark: small, here and there, gone in a few seconds.
    float vfCrack = smoothstep(0.78, 0.93, vvNoise(vec2(dot(vvWorld.xz, vec2(4.1, 3.3)), vvWorld.y * 2.2) + 17.0));
    vfGlow = vec3(1.0, 0.36, 0.06) * vfEdge * 1.6 * (0.6 + 0.4 * vvNoise(vvWorld.xz * 2.5 + vec2(uTime * 4.0, uTime * 3.1)))
      + vec3(1.0, 0.24, 0.04) * (1.0 - vfLeaf) * smoothstep(0.3, 1.0, vfA) * exp(-max(vfA - 1.0, 0.0) * 0.7) * vfCrack * 1.1;
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
 * The crater, in the ground's vertex shader. The patch (`buildCraterPatch`)
 * carries it: the bowl and the ejecta from `vcCrater`, rubble on the rim and
 * the blanket that the crater's own shape does not have, and its slope turned
 * into the normal. The ground mesh under the patch is lowered out of the way
 * once the patch is shown — vertex by vertex, so only vertices whose every
 * triangle lies under the patch go, and the ground past its edge is never
 * touched.
 */
const CRATER_NORMAL = /* glsl */ `
  #ifdef VT_PATCH
    vec3 vtCr = vcCrater(position.xz, uCrater.w);
    float vtLq = uCrater.w > 0.0 ? distance(position.xz, uCrater.xy) / (uCrater.z * uCrater.w) : 99.0;
    float vtLm = uCrater.w * smoothstep(0.55, 0.95, vtLq) * (1.0 - smoothstep(1.2, 1.75, vtLq));
    vec3 vtL1 = vvNoiseD(position.xz * 0.42 + 3.0);
    vec3 vtL2 = vvNoiseD(position.xz * 1.1 + 9.0);
    float vtLump = ((vtL1.x - 0.5) * 1.1 + (vtL2.x - 0.5) * 0.4) * vtLm;
    vec2 vtSlope = vtCr.yz + (vtL1.yz * 0.462 + vtL2.yz * 0.44) * vtLm;
    float vtNy = max(objectNormal.y, 0.2);
    objectNormal = normalize(vec3(objectNormal.x / vtNy - vtSlope.x, 1.0, objectNormal.z / vtNy - vtSlope.y));
  #endif
`
const CRATER_VERTEX = /* glsl */ `
  #ifdef VT_PATCH
    transformed.y += 0.08 + vtCr.x + vtLump;
  #else
    if (uCrater.w > 0.0) {
      float vtUnder = distance(transformed.xz, uCrater.xy) / uCrater.z;
      transformed.y -= (VC_DEPTH + 4.0) * (1.0 - smoothstep(VC_REACH - 0.32, VC_REACH - 0.2, vtUnder));
    }
  #endif
`

/**
 * The ground. `relief` turns on the rock's analytic relief, eight noise
 * lookups with their gradients on every rocky pixel: everywhere but the
 * software renderer.
 */
export function terrainProgram(relief: boolean, patch = false): (shader: Shader) => void {
  return (shader) => {
    Object.assign(shader.uniforms, mistUniforms(), {
      uWaterLevel: ATMOS.uWaterLevel,
      uLake: ATMOS.uLake,
      uVolcano: ATMOS.uVolcano,
      uMeadow: ATMOS.uMeadow,
      uBump: ATMOS.uBump,
      uTime: ATMOS.uTime,
      uWind: ATMOS.uWind,
      uWindDir: ATMOS.uWindDir,
      uCrater: FIRE.uCrater,
      uSince: FIRE.uSince,
      uMelt: FIRE.uMelt,
    })
    shader.vertexShader =
      (patch ? '#define VT_PATCH\n' : '') +
      ATMOS_PARS_VERT +
      'varying vec3 vvNormalW;\n' +
      FIRE_PARS +
      NOISE_GLSL +
      CRATER_GLSL +
      shader.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>' + CRATER_NORMAL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>' + CRATER_VERTEX)
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
          '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(mix(roughnessFactor, 0.5, vtShore), 1.0, max(vtCharA, vtGrassy)), 0.42, (1.0 - smoothstep(0.3, 0.55, vtQ)));',
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vtGlow;')
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
export function foliageProgram(height: number, flutter: number, leafU: readonly [number, number]): (shader: Shader) => void {
  return (shader) => {
    Object.assign(shader.uniforms, mistUniforms(), {
      uTime: ATMOS.uTime,
      uWind: ATMOS.uWind,
      uWindDir: ATMOS.uWindDir,
      uSway: ATMOS.uSway,
      uSwayHeight: { value: height },
      uFlutter: { value: flutter },
      uBack: ATMOS.uBack,
      uCrater: FIRE.uCrater,
      uSince: FIRE.uSince,
      uMelt: FIRE.uMelt,
      uLeafU: { value: new Vector2(leafU[0], leafU[1]) },
    })
    shader.vertexShader =
      ATMOS_PARS_VERT +
      WIND_PARS +
      FIRE_PARS +
      'uniform float uSway;\nuniform float uSwayHeight;\nuniform float uFlutter;\nvarying float vfA;\n' +
      NOISE_GLSL +
      WIND_GLSL +
      FIRE_GLSL +
      shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>' + BURN_VERT + SWAY_BODY)
        .replace('#include <project_vertex>', '#include <project_vertex>' + ATMOS_VERT_BODY)
    shader.fragmentShader =
      ATMOS_PARS_FRAG +
      'uniform vec3 uBack;\nuniform float uTime;\nuniform vec2 uLeafU;\nvarying float vfA;\n' +
      NOISE_GLSL +
      shader.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>' + BURN_FRAG)
        .replace('#include <alphatest_fragment>', LEAF_COVERAGE + '#include <alphatest_fragment>')
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + LEAF_FACING)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vfGlow;')
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
 * The ground once more, for the glow pass: black where nothing burns, so
 * what is behind a ridge or down in the crater stays hidden there too, and
 * the same flames, embers and melt the ground itself gives off where it does,
 * so they bloom. Displaced as the ground is — the crater in the patch, the
 * ground under the patch lowered — or the glow of the crater's floor would be
 * hidden behind the ground that used to be there. Dimmed with distance by
 * hand: three's fog would turn it the colour of the haze and light the whole
 * glow up.
 */
export function makeGroundGlowMaterial(patch: boolean): ShaderMaterial {
  return new ShaderMaterial({
    defines: patch ? { VT_PATCH: '' } : {},
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      uCrater: FIRE.uCrater,
      uSince: FIRE.uSince,
      uMelt: FIRE.uMelt,
      uTime: ATMOS.uTime,
      uVolcano: ATMOS.uVolcano,
    },
    vertexShader: /* glsl */ `
      ${FIRE_PARS}
      ${NOISE_GLSL}
      ${CRATER_GLSL}
      varying vec3 vWorld;
      varying float vDepth;
      varying float vSlope;
      void main() {
        vec3 transformed = position;
        #ifdef VT_PATCH
          transformed.y += 0.08 + vcCrater(position.xz, uCrater.w).x;
        #else
          if (uCrater.w > 0.0) {
            float under = distance(position.xz, uCrater.xy) / uCrater.z;
            transformed.y -= (VC_DEPTH + 4.0) * (1.0 - smoothstep(VC_REACH - 0.32, VC_REACH - 0.2, under));
          }
        #endif
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vWorld = wp.xyz;
        vSlope = 1.0 - normalize(normal).y;
        vec4 mv = viewMatrix * wp;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float fogNear;
      uniform float fogFar;
      uniform vec3 uVolcano;
      ${FIRE_PARS}
      ${NOISE_GLSL}
      ${CRATER_GLSL}
      ${FIRE_GLSL}
      varying vec3 vWorld;
      varying float vDepth;
      varying float vSlope;
      void main() {
        vec2 p = vWorld.xz;
        float foot = length(fwidth(p));
        float q = uCrater.w > 0.0 ? distance(p, uCrater.xy) / (uCrater.z * uCrater.w) : 99.0;
        float blanket = 1.0 - smoothstep(1.0, 2.1, q);
        // Rock, as the ground's own colour has it: steep, high, or the
        // volcano's bare upper slopes. Without it the fire front crossing the
        // volcano bloomed into a bright ribbon over rock that does not burn.
        float onV = 1.0 - smoothstep(uVolcano.z * 0.62, uVolcano.z, distance(p, uVolcano.xy));
        float rock = max(max(smoothstep(0.24, 0.5, vSlope), smoothstep(24.0, 40.0, vWorld.y) * 0.7), onV * smoothstep(10.0, 22.0, vWorld.y));
        float fuel = (1.0 - rock * 0.85) * (1.0 - blanket);
        vec3 glow = vfGroundGlow(p, vfAge(p), fuel, foot) + vcMeltGlow(p, q, foot);
        gl_FragColor = vec4(glow * (1.0 - smoothstep(fogNear * 0.8, fogFar * 0.6, vDepth)), 1.0);
      }
    `,
    fog: true,
  })
}

/**
 * Flames: sprites that stand on the ground, on a burning crown or a fern,
 * from the moment the fire reaches the spot they stand on until they have
 * burnt out. Everything is worked out on the card from where each one stands
 * — when it catches, how long it burns, how it flickers — so a thousand
 * flames cost nothing on the CPU. The flame itself is drawn in the sprite: a
 * column of turbulence rising through a teardrop, torn into tongues at the
 * top, white-yellow at the root and red at the tips.
 */
export function makeFlameMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uCrater: FIRE.uCrater,
      uSince: FIRE.uSince,
      uMelt: FIRE.uMelt,
      uTime: ATMOS.uTime,
      uWind: ATMOS.uWind,
      uWindDir: ATMOS.uWindDir,
      uScale: SMOKE.uScale,
    },
    vertexShader: /* glsl */ `
      ${FIRE_PARS}
      uniform float uTime;
      uniform float uWind;
      uniform vec2 uWindDir;
      uniform float uScale;
      // Height of the flame in metres, how long it burns, a seed, and how long
      // after the fire reaches the spot it catches.
      attribute vec4 aFlame;
      varying float vHeat;
      varying float vSeed;
      ${NOISE_GLSL}
      ${FIRE_GLSL}
      void main() {
        float age = vfAge(position.xz) - aFlame.w;
        float on = smoothstep(-0.05, 0.35, age) * (1.0 - smoothstep(aFlame.y * 0.45, aFlame.y, age));
        vHeat = 0.0;
        vSeed = aFlame.z;
        if (on < 0.002) {
          // Off the screen entirely, so it costs no fragments.
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 0.0;
          return;
        }
        float flick = 0.8 + 0.2 * sin(uTime * 13.0 + aFlame.z * 50.0) * sin(uTime * 7.7 + aFlame.z * 23.0);
        float size = aFlame.x * (0.5 + 0.5 * on) * flick;
        vec3 p = position;
        // The sprite is centred, and the flame stands on its root.
        p.y += size * 0.4;
        p.xz += uWindDir * size * 0.14 * (0.3 + uWind);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // uScale is half the canvas's height; at this lens a metre at a distance
        // of one is that times 2.36 pixels.
        gl_PointSize = size * uScale * 2.36 / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
        vHeat = on * flick;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vHeat;
      varying float vSeed;
      ${NOISE_GLSL}
      void main() {
        if (vHeat < 0.003) discard;
        vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
        float y = uv.y;
        // Turbulence rising through it, warped by a coarser turbulence so it
        // licks and tears rather than wobbling as one shape.
        float t = uTime * 3.1 + vSeed * 17.0;
        vec2 q = vec2(uv.x * 2.4 + vSeed * 31.0, y * 2.6 - t);
        vec2 w = vec2(vvNoise(q * 0.7 + 9.0), vvNoise(q * 0.7 - 5.0)) - 0.5;
        float n = vvNoise(q + w * 1.6) * 0.55 + vvNoise(q * 2.4 + w + 4.0) * 0.3 + vvNoise(q * 5.1 - 2.0) * 0.15;
        float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 1.1 * y + w.x * 0.5 * y + sin(uTime * 2.7 + vSeed * 9.0) * 0.12 * y;
        float width = 0.74 * pow(max(1.0 - y, 0.0), 0.6) * smoothstep(0.0, 0.14, y + 0.04);
        float body = 1.0 - smoothstep(width * 0.2, width + 0.05, abs(x));
        float tongues = smoothstep(0.26, 0.7, n * 1.25 + (1.0 - y) * 0.85 - 0.45);
        float heat = body * tongues * (1.1 - y * 0.85) * vHeat;
        if (heat < 0.01) discard;
        vec3 c = mix(vec3(0.62, 0.09, 0.012), vec3(1.0, 0.42, 0.07), smoothstep(0.08, 0.5, heat));
        c = mix(c, vec3(1.0, 0.74, 0.36), smoothstep(0.7, 1.1, heat));
        gl_FragColor = vec4(c * smoothstep(0.0, 0.35, heat) * 1.15, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/**
 * Smoke off everything that burns: puffs rising from each burning spot and
 * carried downwind, round and round for as long as it burns and smoulders,
 * lit orange from beneath while the flames are under them. Like the flames,
 * worked out on the card from where each stands.
 */
export function makeFireSmokeMaterial(map: CanvasTexture | null): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uCrater: FIRE.uCrater,
      uSince: FIRE.uSince,
      uMelt: FIRE.uMelt,
      uTime: ATMOS.uTime,
      uWind: ATMOS.uWind,
      uWindDir: ATMOS.uWindDir,
      uLevel: ATMOS.uLevel,
      uScale: SMOKE.uScale,
      uColor: { value: new Color('#3b342e') },
      uFireLit: { value: new Color('#a0522d') },
      uGlowFire: FIRE.uGlow,
    },
    vertexShader: /* glsl */ `
      ${FIRE_PARS}
      uniform float uTime;
      uniform float uWind;
      uniform vec2 uWindDir;
      uniform float uScale;
      // A seed, how long after the fire reaches the spot it starts, its size
      // in metres, and how high it rises.
      attribute vec4 aPuff;
      varying float vA;
      varying float vLit;
      ${NOISE_GLSL}
      ${FIRE_GLSL}
      void main() {
        float age = vfAge(position.xz) - aPuff.y;
        float burning = smoothstep(0.0, 0.9, age) * (1.0 - smoothstep(4.5, 9.0, age));
        vA = 0.0;
        vLit = 0.0;
        if (burning < 0.003) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 0.0;
          return;
        }
        float cycle = 3.4 + aPuff.x * 1.8;
        float k = fract(uTime / cycle + aPuff.x * 7.31);
        vec3 p = position;
        p.y += aPuff.z * 0.3 + k * aPuff.w;
        p.xz += uWindDir * k * aPuff.w * 0.6 * (0.35 + uWind) + vec2(sin(aPuff.x * 40.0), cos(aPuff.x * 33.0)) * k * 3.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aPuff.z * (0.45 + 1.3 * k) * uScale * 2.36 / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = burning * smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.45, 1.0, k)) * smoothstep(6.0, 24.0, -mv.z);
        vLit = (1.0 - smoothstep(0.0, 0.55, k)) * (1.0 - smoothstep(2.0, 5.0, age));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform vec3 uFireLit;
      uniform float uLevel;
      uniform float uGlowFire;
      varying float vA;
      varying float vLit;
      void main() {
        float m = texture2D(uMap, gl_PointCoord).a;
        // Lit from beneath by the burning valley: orange low down, where the
        // flames are, and a dull glow all through it while anything burns.
        // Unlit it was black on a black sky and nobody saw it.
        vec3 c = uColor * (0.45 + 0.55 * min(uLevel * 1.4, 1.0)) + uFireLit * (vLit * 0.9 + 0.22) * uGlowFire;
        gl_FragColor = vec4(c, m * vA * 0.55);
      }
    `,
    transparent: true,
    depthWrite: false,
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
        // A puff a few metres from the lens is a disc the size of the screen,
        // and past the largest point the card draws it is a hard-edged one: as
        // the camera climbed into the edge of the column it was a black ball.
        vA *= smoothstep(6.0, 24.0, -mv.z);
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
