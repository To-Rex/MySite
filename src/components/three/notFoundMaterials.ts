import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Path,
  ShaderMaterial,
  Shape,
  Vector2,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import type { Theme } from '@/theme/context'
import { DIGITS, type ColumnField, type Point2 } from './notFoundGlyphs'

/**
 * Every shader on the 404 page.
 *
 * The number is the expensive idea here and it is done almost entirely on the
 * GPU. Each column carries only its home, radius, height and four random
 * numbers; assembling out of the crater, leaning away from a shockwave, rising
 * under the cursor and being thrown off by a meteor are all closed-form in the
 * vertex shader from a handful of uniforms, so a few thousand columns moving at
 * once cost the CPU one uniform upload per frame.
 *
 * Colours written by `toneMapped: false` materials are display values on
 * purpose: the sky has to come out as exactly the page's own background, and
 * ACES would turn the light theme's paper grey.
 */

/** Shockwaves that can be travelling through the number at once. */
export const WAVE_SLOTS = 6

/** Written once per frame by the scene and read by every shader. */
export const FIELD = {
  uTime: { value: 0 },
  /** Seconds since the columns started to fly. */
  uBuild: { value: 0 },
  uBuildFrom: { value: new Vector2(0, -1.5) },
  /** Cursor in stage space, strength in z. */
  uHover: { value: new Vector3(0, 0, 0) },
  /** Origin xy, start time, strength. */
  uWaves: { value: Array.from({ length: WAVE_SLOTS }, () => new Vector4(0, 0, -100, 0)) },
  /** How much of each wave is an explosion, as opposed to a ripple. */
  uWaveCore: { value: new Array<number>(WAVE_SLOTS).fill(0) },
  /** How hot everything is running; jumps on an impact and cools back to 1. */
  uLava: { value: 1 },
  /** 1 in the dark theme. */
  uDark: { value: 1 },
  /** Device pixels per unit of point size. */
  uPointScale: { value: 1 },
}

const NOISE = /* glsl */ `
  float nfHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float nfNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(nfHash(i), nfHash(i + vec2(1.0, 0.0)), f.x),
      mix(nfHash(i + vec2(0.0, 1.0)), nfHash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float nfFbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * nfNoise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return sum;
  }
`

/** Black-body, near enough: red, orange, then white at the very top. */
const LAVA = /* glsl */ `
  vec3 nfLava(float h) {
    vec3 c = mix(vec3(0.32, 0.015, 0.0), vec3(1.0, 0.2, 0.015), smoothstep(0.0, 0.45, h));
    c = mix(c, vec3(1.0, 0.6, 0.1), smoothstep(0.42, 0.74, h));
    return mix(c, vec3(1.0, 0.94, 0.74), smoothstep(0.74, 1.0, h));
  }
`

/* -------------------------------------------------------------------------- */
/* The columns                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One hexagonal column, axis on +z from 0 to 1, with a chamfered top so the
 * flat-shaded facets have something to catch the light on.
 */
export function makeColumnGeometry(field: ColumnField): InstancedBufferGeometry {
  const ring = (radius: number, z: number): number[] => {
    const out: number[] = []
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 3
      out.push(Math.cos(a) * radius, Math.sin(a) * radius, z)
    }
    return out
  }
  const positions = [...ring(1, 0), ...ring(1, 0.92), ...ring(0.78, 1), 0, 0, 1]
  const indices: number[] = []
  for (let i = 0; i < 6; i++) {
    const n = (i + 1) % 6
    for (const lower of [0, 6]) {
      indices.push(lower + i, lower + n, lower + 6 + n, lower + i, lower + 6 + n, lower + 6 + i)
    }
    indices.push(12 + i, 12 + n, 18)
  }

  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.instanceCount = field.count
  geometry.setAttribute('aHome', new InstancedBufferAttribute(field.home, 2))
  geometry.setAttribute('aRadius', new InstancedBufferAttribute(field.radius, 1))
  geometry.setAttribute('aRest', new InstancedBufferAttribute(field.rest, 1))
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(field.seed, 4))
  return geometry
}

const COLUMN_VERTEX_HEAD = /* glsl */ `
  #define WAVE_SLOTS ${WAVE_SLOTS}
  attribute vec2 aHome;
  attribute float aRadius;
  attribute float aRest;
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uBuild;
  uniform vec2 uBuildFrom;
  uniform vec3 uHover;
  uniform vec4 uWaves[WAVE_SLOTS];
  uniform float uWaveCore[WAVE_SLOTS];
  varying float vDepth;
  varying float vCap;
  varying float vHeat;
  varying float vFlash;
  varying float vTint;
  varying vec2 vStage;
  ${NOISE}
  vec3 nfRotate(vec3 v, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }
`

const COLUMN_VERTEX_BODY = /* glsl */ `
  // ---- Out of the crater ----------------------------------------------------
  float nfDelay = length(aHome - uBuildFrom) * 0.2 + aSeed.x * 0.5;
  float nfQ = clamp((uBuild - nfDelay) / 1.1, 0.0, 1.0);
  float nfLand = 1.0 - pow(1.0 - nfQ, 3.0);
  float nfArc = sin(nfQ * 3.14159265);

  // ---- How far it stands out ------------------------------------------------
  float nfH = aRest;
  nfH += sin(aHome.x * 1.6 + uTime * 0.65 + aSeed.y * 2.0) * 0.022;
  nfH += sin(aHome.y * 2.1 - uTime * 0.48 + aSeed.z * 2.0) * 0.018;

  vec2 nfHoverRel = aHome - uHover.xy;
  float nfHover = uHover.z * exp(-dot(nfHoverRel, nfHoverRel) * 2.4);
  nfH += nfHover * 0.55;

  // ---- Whatever is travelling through --------------------------------------
  vec2 nfTilt = vec2(0.0);
  vec3 nfThrown = vec3(0.0);
  float nfTumble = 0.0;
  float nfFlashing = nfHover * 0.32;
  for (int i = 0; i < WAVE_SLOTS; i++) {
    float strength = uWaves[i].w;
    if (strength <= 0.0) continue;
    float age = uTime - uWaves[i].z;
    if (age < 0.0 || age > 3.5) continue;
    vec2 rel = aHome - uWaves[i].xy;
    float d = length(rel);
    vec2 dir = d > 0.001 ? rel / d : vec2(0.0);
    float off = (d - age * 6.2) / (0.4 + age * 0.4);
    float band = exp(-off * off) * exp(-age * 1.05) * strength;
    nfH += min(band * 0.42, 0.42);
    nfTilt += dir * band * 0.42;
    nfFlashing += band * 0.55;
    float core = uWaveCore[i];
    if (core > 0.0) {
      // Thrown clear of the crater, then settling back into place: a pulse
      // that peaks a quarter of a second in and is gone within about a second.
      float blast = exp(-d * d * 1.7) * core;
      float lift = (age / 0.24) * exp(1.0 - age / 0.24);
      nfThrown += vec3(dir * (0.5 + aSeed.y * 0.7), 1.1 + aSeed.z * 1.5) * blast * lift;
      nfTumble += blast * lift * (1.2 + aSeed.w * 2.2);
      nfFlashing += blast * exp(-age * 2.5);
    }
  }

  // ---- Coming apart ---------------------------------------------------------
  // A few columns at a time let go, drop out of the number and grow back. The
  // socket shows the core while it is empty, so a loss reads as a small bright
  // wound rather than a hole.
  float nfRegrow = 1.0;
  if (aSeed.x < 0.05) {
    float period = 8.0 + aSeed.y * 10.0;
    float phase = fract(uTime / period + aSeed.z);
    if (phase > 0.8) {
      float fall = min((phase - 0.8) * period, 1.15);
      nfThrown += vec3((aSeed.w - 0.5) * fall * 0.3, -1.7 * fall * fall, fall * 0.18);
      nfTumble += fall * (1.2 + aSeed.w * 2.0);
      nfRegrow = 1.0 - smoothstep(0.55, 1.15, fall);
      nfH *= 0.62;
    } else if (phase < 0.12) {
      nfRegrow = smoothstep(0.0, 0.12, phase);
    }
  }

  // ---- Put it together ------------------------------------------------------
  float nfScale = mix(0.3, 1.0, nfLand) * step(0.0001, nfQ) * nfRegrow;
  vec3 transformed = vec3(position.xy * aRadius * 0.92 * nfScale, position.z * nfH * nfScale);

  vDepth = (1.0 - position.z) * nfH;
  vCap = smoothstep(0.985, 1.0, position.z);
  vTint = 0.72 + aSeed.w * 0.5;
  vStage = aHome + position.xy * aRadius;
  vHeat = smoothstep(0.32, 0.82, nfNoise(aHome * 0.85 + vec2(uTime * 0.035, -uTime * 0.085)));
  vFlash = clamp(nfFlashing, 0.0, 1.6);

  // Leaning away from whatever just went past. The small-angle form is plenty.
  transformed.xy += nfTilt * transformed.z;

  float nfSpin = (1.0 - nfLand) * (5.0 + aSeed.w * 9.0) + nfTumble;
  if (nfSpin > 0.0001) transformed = nfRotate(transformed, normalize(aSeed.xyz * 2.0 - 0.999), nfSpin);

  vec3 nfStart = vec3(uBuildFrom.x + (aSeed.y - 0.5) * 2.4, uBuildFrom.y - 0.4 + aSeed.z * 0.6, 1.0 + aSeed.x * 2.0);
  vec3 nfAt = mix(nfStart, vec3(aHome, 0.0), nfLand);
  nfAt.z += nfArc * (0.7 + aSeed.w * 1.4);
  transformed += nfAt + nfThrown;
`

const COLUMN_FRAGMENT_HEAD = /* glsl */ `
  uniform float uTime;
  uniform float uLava;
  varying float vDepth;
  varying float vCap;
  varying float vHeat;
  varying float vFlash;
  varying float vTint;
  varying vec2 vStage;
  ${NOISE}
  ${LAVA}
  vec3 nfColumnGlow() {
    // Crust at the top, molten underneath: a column only shows its hot side
    // once it stands proud of its neighbours, so a wave going through peels the
    // dark away and shows what the number is made of.
    float molten = smoothstep(0.12, 0.36, vDepth) * (1.0 - vCap);
    float crack = 0.0;
    if (vCap > 0.5) {
      float vein = nfNoise(vStage * 8.5 + vec2(uTime * 0.02, 0.0));
      crack = smoothstep(0.055, 0.0, abs(vein - 0.5)) * smoothstep(0.4, 0.95, vHeat);
    }
    vec3 glow = nfLava(0.24 + vHeat * 0.46 + vFlash * 0.45) * molten * (0.3 + vHeat * 1.05);
    glow += nfLava(0.42 + vHeat * 0.38) * crack * 0.85;
    glow += nfLava(0.18) * vCap * vHeat * vHeat * vHeat * 0.08;
    glow += nfLava(0.5 + vFlash * 0.34) * vFlash * (0.3 + vCap * 0.45);
    return glow * uLava;
  }
`

function patchColumnVertex(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = COLUMN_VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', COLUMN_VERTEX_BODY)
}

/** The lit, visible columns. Flat shading gets its normals from screen-space derivatives, so whatever the vertex shader does to a column is lit correctly with no normal maths. */
export function makeColumnMaterial(theme: Theme): MeshStandardMaterial {
  const dark = theme === 'dark'
  const material = new MeshStandardMaterial({
    color: dark ? '#4a4744' : '#2a2826',
    roughness: dark ? 0.55 : 0.78,
    metalness: dark ? 0.2 : 0.05,
    flatShading: true,
    envMapIntensity: dark ? 1.5 : 0.8,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FIELD)
    patchColumnVertex(shader)
    shader.fragmentShader =
      COLUMN_FRAGMENT_HEAD +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
  diffuseColor.rgb *= vTint * (0.8 + 0.4 * nfNoise(vStage * 34.0));`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
  totalEmissiveRadiance += nfColumnGlow();`,
        )
  }
  return material
}

/** The same columns for the bloom pass: only what is hot, on black, still occluding the core. */
export function makeColumnGlowMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: '#000000', toneMapped: false })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FIELD)
    patchColumnVertex(shader)
    shader.fragmentShader =
      COLUMN_FRAGMENT_HEAD +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  diffuseColor.rgb = nfColumnGlow();`,
      )
  }
  return material
}

/* -------------------------------------------------------------------------- */
/* The molten core                                                             */
/* -------------------------------------------------------------------------- */

function toShape(outer: readonly Point2[], holes: readonly (readonly Point2[])[]): Shape {
  const shape = new Shape(outer.map(([x, y]) => new Vector2(x, y)))
  shape.holes = holes.map((hole) => new Path(hole.map(([x, y]) => new Vector2(x, y))))
  return shape
}

/** The digits' exact outlines, extruded backwards from just above the columns' feet. */
export function makeCoreGeometry(): ExtrudeGeometry {
  const geometry = new ExtrudeGeometry(
    DIGITS.map((digit) => toShape(digit.outer, digit.holes)),
    { depth: 0.62, bevelEnabled: false, curveSegments: 1 },
  )
  geometry.translate(0, 0, -0.58)
  return geometry
}

export function makeCoreMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: FIELD.uTime, uBuild: FIELD.uBuild, uBuildFrom: FIELD.uBuildFrom, uLava: FIELD.uLava },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uBuild;
      uniform vec2 uBuildFrom;
      uniform float uLava;
      varying vec3 vP;
      ${NOISE}
      ${LAVA}
      void main() {
        // Spreads out from the crater, ahead of the columns that will cover it.
        if (distance(vP.xy, uBuildFrom) > uBuild * 7.0) discard;
        float flow = nfFbm(vP.xy * 2.0 + vec2(vP.z * 3.1, -uTime * 0.22 + vP.z * 1.7));
        float vein = nfFbm(vP.xy * 5.0 + flow * 2.4 + vec2(uTime * 0.07, 0.0));
        float h = smoothstep(0.28, 0.78, vein);
        gl_FragColor = vec4(nfLava(0.1 + h * 0.62) * (0.24 + h * 0.95) * uLava, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* The sky                                                                     */
/* -------------------------------------------------------------------------- */

export const SKY = {
  /** Centre of the disc, in the sky plane's world coordinates. */
  uCentre: { value: new Vector2() },
  uRadius: { value: 3 },
  /** 0 → nothing but the page; 1 → the whole sky has come up. */
  uReveal: { value: 0 },
  uFlash: { value: 0 },
}

/**
 * An eclipse behind the zero at night, a red sun behind it by day. Either way
 * the digits are dark shapes on something bright, which is what makes them read
 * at any size.
 */
export function makeSkyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: FIELD.uTime, uDark: FIELD.uDark, ...SKY },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = (modelMatrix * vec4(position, 1.0)).xy;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDark;
      uniform vec2 uCentre;
      uniform float uRadius;
      uniform float uReveal;
      uniform float uFlash;
      varying vec2 vP;
      ${NOISE}
      void main() {
        vec2 d = vP - uCentre;
        float r = length(d);
        vec2 dir = d / max(r, 0.0001);
        float rr = r / uRadius;
        vec3 night = vec3(0.027, 0.027, 0.031);
        vec3 paper = vec3(0.969, 0.961, 0.945);
        vec3 col;
        if (uDark > 0.5) {
          // Sampled on the unit circle rather than from the angle, or the rays
          // would have a seam where atan wraps round.
          float broad = nfFbm(dir * 3.2 + vec2(uTime * 0.03, -uTime * 0.02));
          float fine = nfFbm(dir * 12.0 + vec2(-uTime * 0.05, uTime * 0.04));
          float rays = mix(broad, fine, 0.42);
          float k = max(rr - 1.0, 0.0);
          float corona = exp(-k / (0.1 + rays * 0.42));
          float rim = exp(-pow((rr - 1.0) / 0.009, 2.0));
          float wide = exp(-k * 1.25) * 0.11;
          col = night;
          col += vec3(0.95, 0.43, 0.15) * corona * 0.56;
          col += vec3(1.0, 0.82, 0.55) * pow(corona, 3.5) * 0.62;
          col += vec3(0.85, 0.36, 0.13) * wide;
          col = mix(col, vec3(0.01, 0.009, 0.012), smoothstep(1.0, 0.994, rr));
          col += vec3(1.0, 0.93, 0.78) * rim * 1.3;
          col = mix(night, col, uReveal);
          col += vec3(1.0, 0.8, 0.55) * uFlash;
        } else {
          float height = clamp(d.y / uRadius * 0.5 + 0.5, 0.0, 1.0);
          vec3 sun = mix(vec3(0.78, 0.12, 0.07), vec3(0.96, 0.36, 0.13), height);
          float disc = smoothstep(1.004, 0.996, rr);
          float haze = exp(-max(rr - 1.0, 0.0) * 2.2) * 0.3 * (1.0 - disc);
          col = mix(paper, vec3(0.98, 0.76, 0.58), haze * uReveal);
          col = mix(col, sun, disc * uReveal);
          col = mix(col, vec3(1.0, 0.97, 0.9), uFlash);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthWrite: false,
    toneMapped: false,
  })
}

/* -------------------------------------------------------------------------- */
/* The ground                                                                  */
/* -------------------------------------------------------------------------- */

export const GROUND = {
  /** Seconds since the first impact cracked it. */
  uCrack: { value: 0 },
  uCrackFrom: { value: new Vector2() },
  /** Tyrannosaur's shadow: x, z, half-width, half-depth. */
  uShade: { value: new Vector4(0, 0, 1, 1) },
  /** 1 while the bloom pass is drawing this; it wants the cracks and nothing else. */
  uGlowPass: { value: 0 },
  /** Where the words sit, in screen 0..1: centre xy, radius xy. No cracks there. */
  uQuiet: { value: new Vector4(0, 0, 0.7, 0.7) },
}

export function makeGroundMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: FIELD.uTime, uDark: FIELD.uDark, uLava: FIELD.uLava, uReveal: SKY.uReveal, ...GROUND },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec4 vClip;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vW = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        vClip = gl_Position;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDark;
      uniform float uLava;
      uniform float uCrack;
      uniform vec2 uCrackFrom;
      uniform vec4 uShade;
      uniform float uGlowPass;
      uniform vec4 uQuiet;
      uniform float uReveal;
      varying vec3 vW;
      varying vec4 vClip;
      ${NOISE}
      vec2 nfCell(vec2 i) {
        return vec2(nfHash(i), nfHash(i + vec2(7.3, 2.1)));
      }
      /** Distance to the nearest crack: the gap between the two closest cell points. */
      float nfCracks(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float first = 8.0;
        float second = 8.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = g + nfCell(i + g) - f;
            float d = dot(o, o);
            if (d < first) {
              second = first;
              first = d;
            } else if (d < second) {
              second = d;
            }
          }
        }
        return sqrt(second) - sqrt(first);
      }
      void main() {
        vec2 q = vW.xz;
        vec2 warped = q * vec2(0.34, 0.62) + vec2(nfNoise(q * 1.1), nfNoise(q * 1.1 + 9.0)) * 0.34;
        float gap = nfCracks(warped);
        // Spreads from where the meteor came down.
        float reach = uCrack * 6.5;
        float grown = smoothstep(reach, reach - 2.2, distance(q, uCrackFrom));
        vec2 screen = vClip.xy / vClip.w * 0.5 + 0.5;
        float quiet = smoothstep(0.62, 1.05, length((screen - uQuiet.xy) / uQuiet.zw));
        float near = exp(-(q.x * q.x * 0.03 + q.y * q.y * 0.07)) * quiet;
        float pulse = 0.4 + 0.6 * smoothstep(0.25, 0.75, nfNoise(q * 0.42 + vec2(0.0, -uTime * 0.14)));
        vec2 shadeAt = (q - uShade.xy) / uShade.zw;
        float shade = exp(-dot(shadeAt, shadeAt));
        float line = smoothstep(0.05, 0.0, gap) * grown * near * (1.0 - shade * 0.85);
        float hot = smoothstep(0.016, 0.0, gap) * grown * near * (1.0 - shade * 0.85);

        if (uGlowPass > 0.5) {
          vec3 glow = (vec3(1.0, 0.2, 0.02) * line * 0.5 + vec3(1.0, 0.62, 0.22) * hot) * pulse * uLava * 0.8 * uDark;
          gl_FragColor = vec4(glow, 1.0);
          return;
        }

        float depth = exp(-(q.x * q.x * 0.012 + (q.y - 1.0) * (q.y - 1.0) * 0.09));
        float grain = nfNoise(q * 26.0);
        vec3 col;
        float alpha;
        if (uDark > 0.5) {
          vec3 rock = vec3(0.075, 0.066, 0.062) + grain * 0.016;
          float warm = exp(-(q.x * q.x * 0.03 + q.y * q.y * 0.32)) * grown;
          rock += vec3(0.2, 0.055, 0.012) * warm * uLava;
          col = rock * (1.0 - shade * 0.72);
          col += (vec3(0.62, 0.13, 0.015) * line + vec3(1.0, 0.68, 0.28) * hot) * pulse * uLava;
          alpha = depth * uReveal;
        } else {
          vec3 dust = vec3(0.895, 0.875, 0.84) + grain * 0.02;
          col = dust * (1.0 - shade * 0.42);
          col = mix(col, vec3(0.86, 0.26, 0.05), line * pulse);
          col = mix(col, vec3(1.0, 0.7, 0.28), hot * pulse);
          alpha = depth * uReveal;
        }
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
}

/* -------------------------------------------------------------------------- */
/* Embers, stars and what falls past                                           */
/* -------------------------------------------------------------------------- */

/** A cloud with nothing in it but four random numbers per point; the shader places them. */
export function makeSeedCloud(count: number, seedOf: (index: number, channel: number) => number): BufferGeometry {
  const seeds = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) for (let c = 0; c < 4; c++) seeds[i * 4 + c] = seedOf(i, c)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4))
  return geometry
}

export const EMBERS = {
  uFloor: { value: -2 },
  uGust: { value: 0 },
}

export function makeEmberMaterial(theme: Theme): ShaderMaterial {
  const dark = theme === 'dark'
  return new ShaderMaterial({
    uniforms: { uTime: FIELD.uTime, uPointScale: FIELD.uPointScale, uBuild: FIELD.uBuild, ...EMBERS },
    defines: dark ? { DARK: '' } : {},
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uPointScale;
      uniform float uBuild;
      uniform float uFloor;
      uniform float uGust;
      varying float vLife;
      varying float vKind;
      void main() {
        float life = fract(uTime * mix(0.05, 0.15, aSeed.x) + aSeed.y);
        float x = (aSeed.z - 0.5) * 16.0;
        float z = (aSeed.w - 0.5) * 9.0 - 0.5;
        vec3 p = vec3(
          x + sin(uTime * 0.35 + aSeed.y * 40.0) * 0.5 + life * 1.5 + uGust * (0.4 + aSeed.x),
          uFloor + life * 7.5,
          z + cos(uTime * 0.28 + aSeed.x * 40.0) * 0.4
        );
        vLife = life;
        vKind = aSeed.x;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float born = smoothstep(0.0, 2.2, uBuild);
        gl_PointSize = mix(1.2, 3.4, aSeed.w * aSeed.w) * uPointScale * (11.5 / -mv.z) * born;
        // A size of zero still draws one pixel.
        gl_Position = born > 0.001 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      varying float vKind;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float m = smoothstep(0.5, 0.05, length(c));
        float fade = smoothstep(0.0, 0.08, vLife) * smoothstep(1.0, 0.55, vLife);
        #ifdef DARK
          vec3 hot = mix(vec3(1.0, 0.92, 0.7), vec3(1.0, 0.32, 0.05), smoothstep(0.0, 0.5, vLife));
          gl_FragColor = vec4(hot * 0.95 * m * fade, m * fade);
        #else
          // By day it is ash, with the odd spark still alive in it.
          vec3 ash = vKind > 0.8 ? vec3(0.9, 0.3, 0.06) : vec3(0.2, 0.18, 0.17);
          gl_FragColor = vec4(ash, m * fade * 0.7);
        #endif
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: dark ? AdditiveBlending : NormalBlending,
  })
}

export function makeStarMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: FIELD.uTime, uPointScale: FIELD.uPointScale, uReveal: SKY.uReveal },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uPointScale;
      varying float vTwinkle;
      void main() {
        vec3 p = vec3((aSeed.x - 0.5) * 42.0, (aSeed.y - 0.5) * 24.0, -9.0 - aSeed.z * 4.0);
        vTwinkle = 0.4 + 0.6 * sin(uTime * (0.5 + aSeed.w * 1.8) + aSeed.z * 40.0) * sin(uTime * 0.31 + aSeed.x * 30.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.9 + aSeed.w * aSeed.w * 2.2) * uPointScale;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uReveal;
      varying float vTwinkle;
      void main() {
        float m = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(0.92, 0.9, 0.86) * m * max(vTwinkle, 0.06) * uReveal, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  })
}

/** Far-off meteors: one quad each, sliding along its own line on its own timer. */
export function makeStreakGeometry(count: number, seedOf: (index: number, channel: number) => number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0]), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  const seeds = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) for (let c = 0; c < 4; c++) seeds[i * 4 + c] = seedOf(i, c)
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4))
  geometry.instanceCount = count
  return geometry
}

export function makeStreakMaterial(theme: Theme): ShaderMaterial {
  const dark = theme === 'dark'
  return new ShaderMaterial({
    uniforms: { uTime: FIELD.uTime, uReveal: SKY.uReveal },
    defines: dark ? { DARK: '' } : {},
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      varying vec2 vP;
      varying float vFade;
      void main() {
        float period = 7.0 + aSeed.x * 11.0;
        float local = mod(uTime + aSeed.y * period, period);
        float run = clamp(local / 1.1, 0.0, 1.0);
        vec2 dir = normalize(vec2(-1.0, -0.42 - aSeed.z * 0.5));
        vec2 from = vec2(4.0 + aSeed.w * 18.0, 8.0 + aSeed.z * 3.0);
        vec2 head = from + dir * run * 26.0;
        float len = 2.4 + aSeed.x * 2.6;
        vec2 side = vec2(-dir.y, dir.x);
        vec2 p = head - dir * position.x * len + side * position.y * 0.05;
        vP = position.xy;
        vFade = smoothstep(0.0, 0.12, run) * smoothstep(1.0, 0.75, run);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, -8.5, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uReveal;
      varying vec2 vP;
      varying float vFade;
      void main() {
        float along = pow(1.0 - vP.x, 2.2);
        float across = smoothstep(0.5, 0.0, abs(vP.y));
        float a = along * across * vFade * uReveal;
        #ifdef DARK
          gl_FragColor = vec4(vec3(1.0, 0.82, 0.58) * a * 1.4, a);
        #else
          gl_FragColor = vec4(vec3(0.72, 0.2, 0.05), a * 0.7);
        #endif
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: dark ? AdditiveBlending : NormalBlending,
    side: DoubleSide,
    toneMapped: false,
  })
}

/* -------------------------------------------------------------------------- */
/* Meteors, impacts and roars                                                  */
/* -------------------------------------------------------------------------- */

/** The rock itself: a lumpy ball, burning from the front. */
export function makeMeteorHeadMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: FIELD.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vP;
      ${NOISE}
      ${LAVA}
      void main() {
        float n = nfFbm(vP.xy * 6.0 + vec2(uTime * 2.5, vP.z * 5.0));
        gl_FragColor = vec4(nfLava(0.55 + n * 0.55) * 7.0, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

/** Plasma on an open cone whose point is at the rock. */
export function makeMeteorTrailMaterial(theme: Theme): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: FIELD.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vAlong;
      void main() {
        vUv = uv;
        // 1 at the point of the cone, which is at the rock; 0 at the far end.
        vAlong = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vAlong;
      ${NOISE}
      ${LAVA}
      void main() {
        float turb = nfFbm(vec2(vUv.x * 6.0 + uTime * 0.3, vAlong * 7.0 - uTime * 9.0));
        float body = pow(vAlong, 1.6);
        float rag = smoothstep(0.18, 0.62, turb + vAlong * 0.3);
        float a = body * mix(0.2, 1.0, rag);
        gl_FragColor = vec4(nfLava(0.25 + vAlong * 0.75) * a * 5.0, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: theme === 'dark' ? AdditiveBlending : NormalBlending,
    side: DoubleSide,
  })
}

/** A soft ball of light, drawn as a camera-facing quad. */
export function makeFlareMaterial(theme: Theme): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uPower: { value: 0 } },
    defines: theme === 'dark' ? { DARK: '' } : {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPower;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float soft = pow(max(1.0 - r, 0.0), 2.6);
        float core = pow(max(1.0 - r, 0.0), 8.0);
        vec3 col = vec3(1.0, 0.5, 0.16) * soft + vec3(1.0, 0.95, 0.82) * core * 3.0;
        #ifdef DARK
          gl_FragColor = vec4(col * uPower, 1.0);
        #else
          gl_FragColor = vec4(mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.95, 0.8), core), clamp((soft + core) * uPower, 0.0, 1.0));
        #endif
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: theme === 'dark' ? AdditiveBlending : NormalBlending,
    toneMapped: false,
  })
}

/** A ring on a camera-facing quad: the shockwave, and the visible part of a roar. */
export function makeRingMaterial(theme: Theme): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uAge: { value: 0 }, uPower: { value: 0 } },
    defines: theme === 'dark' ? { DARK: '' } : {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAge;
      uniform float uPower;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float at = 1.0 - pow(1.0 - clamp(uAge, 0.0, 1.0), 2.6);
        float ring = exp(-pow((r - at * 0.94) / (0.012 + at * 0.03), 2.0));
        float fade = pow(1.0 - clamp(uAge, 0.0, 1.0), 1.5);
        float a = ring * fade * uPower;
        #ifdef DARK
          gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * a * 1.5, a);
        #else
          gl_FragColor = vec4(vec3(0.82, 0.24, 0.06), clamp(a, 0.0, 1.0));
        #endif
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: theme === 'dark' ? AdditiveBlending : NormalBlending,
    toneMapped: false,
  })
}

/** A spray of points thrown from one spot and pulled back down. */
export function makeBurstMaterial(theme: Theme, dust: boolean): ShaderMaterial {
  const dark = theme === 'dark'
  const additive = dark && !dust
  return new ShaderMaterial({
    uniforms: {
      uOrigin: { value: new Vector3() },
      uAge: { value: 99 },
      uPower: { value: 1 },
      uPointScale: FIELD.uPointScale,
    },
    defines: { ...(dark ? { DARK: '' } : {}), ...(dust ? { DUST: '' } : {}) },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform vec3 uOrigin;
      uniform float uAge;
      uniform float uPower;
      uniform float uPointScale;
      varying float vLife;
      void main() {
        float life = clamp(uAge / mix(0.7, 1.5, aSeed.w), 0.0, 1.0);
        float t = uAge;
        float a = aSeed.x * 6.2832;
        float u = aSeed.y * 2.0 - 1.0;
        float s = sqrt(1.0 - u * u);
        #ifdef DUST
          vec3 dir = vec3(cos(a) * 1.1, 0.25 + aSeed.y * 0.55, sin(a) * 0.7);
          float slow = (1.0 - exp(-t * 3.4)) / 3.4;
          vec3 p = uOrigin + dir * uPower * (1.0 + aSeed.z * 2.4) * slow;
        #else
          vec3 dir = vec3(s * cos(a), abs(u) * 0.9 + 0.15, s * sin(a) * 0.8 + 0.3);
          vec3 p = uOrigin + dir * uPower * (2.2 + aSeed.z * 5.5) * t;
          p.y -= 3.6 * t * t;
        #endif
        vLife = life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        #ifdef DUST
          float size = 26.0 + aSeed.z * 34.0;
        #else
          float size = 2.5 + aSeed.z * aSeed.z * 8.0;
        #endif
        gl_PointSize = size * uPointScale * (11.5 / -mv.z) * step(life, 0.999);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        #ifdef DUST
          float m = smoothstep(0.5, 0.0, r);
          float a = m * m * (1.0 - vLife) * smoothstep(0.0, 0.06, vLife) * 0.22;
          #ifdef DARK
            gl_FragColor = vec4(vec3(0.42, 0.33, 0.27), a);
          #else
            gl_FragColor = vec4(vec3(0.58, 0.53, 0.47), a);
          #endif
        #else
          float m = smoothstep(0.5, 0.1, r);
          float fade = 1.0 - vLife;
          vec3 hot = mix(vec3(1.0, 0.9, 0.62), vec3(1.0, 0.28, 0.04), smoothstep(0.1, 0.8, vLife));
          #ifdef DARK
            gl_FragColor = vec4(hot * 2.4 * m * fade, m * fade);
          #else
            gl_FragColor = vec4(hot * 0.9, m * fade);
          #endif
        #endif
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
    toneMapped: dust ? false : !dark,
  })
}
