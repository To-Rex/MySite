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
import { LAKE, WATER_LEVEL } from './valleyLand'

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
  uBump: { value: 0.6 },
  /** Where the ground burns: x, z and radius, and how far along the burn is. */
  uScorch: { value: new Vector3(0, 0, 1) },
  uScorchAmount: { value: 0 },
  /** Sway at the crown, as a fraction of the plant's height. */
  uSway: { value: 0.028 },
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

/** Value noise, prefixed so it never collides with a chunk of three's. */
export const NOISE_GLSL = /* glsl */ `
float vvHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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

const ATMOS_PARS_VERT = /* glsl */ `
varying vec3 vvWorld;
varying float vvDist;
`

const ATMOS_PARS_FRAG = /* glsl */ `
uniform vec3 uMistColor;
uniform float uMistAmount;
uniform float uMistFloor;
uniform float uMistFall;
uniform float uMistDist;
varying vec3 vvWorld;
varying float vvDist;
`

/** After project_vertex: the world position, instancing included, and the depth. */
const ATMOS_VERT_BODY = /* glsl */ `
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
const MIST_BODY = /* glsl */ `
  {
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
 */
const TERRAIN_COLOR = /* glsl */ `
  vec3 vtN = normalize(vvNormalW);
  vec2 vtP = vvWorld.xz;
  float vtSlope = 1.0 - vtN.y;
  float vtMacro = vvFbm3(vtP * 0.013 + 3.0);
  float vtMid = vvFbm3(vtP * 0.09);
  float vtFine = vvNoise(vtP * 0.7);
  vec2 vtPr = vec2(vtP.x * 0.62 - vtP.y * 0.78, vtP.x * 0.78 + vtP.y * 0.62);
  float vtGrain = 0.5 * (vvNoise(vtP * 2.9) + vvNoise(vtPr * 3.7 + 5.0));
  vec3 vtMoss = mix(vec3(0.085, 0.145, 0.05), vec3(0.17, 0.25, 0.085), vtMid);
  vec3 vtGrass = mix(vec3(0.21, 0.27, 0.10), vec3(0.38, 0.40, 0.17), vtMid);
  vec3 vtEarth = mix(vec3(0.26, 0.20, 0.125), vec3(0.42, 0.33, 0.21), vtFine);
  // Strata: bands that run with the hillside rather than with the map.
  vec3 vtRock = mix(vec3(0.21, 0.20, 0.185), vec3(0.40, 0.38, 0.34), vvFbm3(vec2(vvWorld.y * 0.35, dot(vtP, vec2(0.7)) * 0.12)));
  float vtWet = smoothstep(0.35, 0.7, vtMacro) * (1.0 - smoothstep(1.0, 12.0, vvWorld.y));
  vec3 vtFlat = mix(vtGrass, vtMoss, vtWet);
  vtFlat = mix(vtFlat, vtEarth, smoothstep(0.55, 0.8, vtMid) * 0.6);
  float vtRocky = smoothstep(0.24, 0.5, vtSlope + (vtFine - 0.5) * 0.16);
  vtRocky = max(vtRocky, smoothstep(24.0, 40.0, vvWorld.y) * 0.7);
  vec3 vtCol = mix(vtFlat, vtRock, vtRocky);
  vtCol *= 0.88 + 0.24 * vtGrain;
  // Patches the size of a field, so the floor is not one even tone.
  vtCol *= 0.78 + 0.44 * vvFbm3(vtP * 0.028 + 11.0);
  // The margin of the lake is dark and wet.
  float vtShore = 1.0 - smoothstep(uWaterLevel + 0.2, uWaterLevel + 2.4, vvWorld.y);
  vtCol *= 1.0 - 0.38 * vtShore;
  // And after the rock, the ground around the crater is char.
  float vtScorch = (1.0 - smoothstep(uScorch.z * 0.45, uScorch.z, distance(vtP, uScorch.xy))) * uScorchAmount;
  vtCol = mix(vtCol, vec3(0.05, 0.04, 0.035), vtScorch);
  diffuseColor.rgb = vtCol;
`

/**
 * Mikkelsen surface-gradient bump, the same construction the hide uses: the
 * height gradient is reconstructed from screen derivatives, so it needs no
 * tangents and no UVs. Faded out with distance, where derivatives of noise turn
 * to shimmer.
 */
const TERRAIN_BUMP = /* glsl */ `
  {
    float vtB = uBump * (1.0 - smoothstep(50.0, 170.0, vvDist));
    if (vtB > 0.0) {
      float vtH = vvFbm3(vtP * 0.55) * 0.9 + vtGrain * 0.5 + vtRocky * vvFbm3(vtP * 1.3 + 40.0) * 1.4;
      vec3 vtSurf = -vViewPosition;
      vec3 vtDpdx = dFdx(vtSurf);
      vec3 vtDpdy = dFdy(vtSurf);
      float vtDx = dFdx(vtH);
      float vtDy = dFdy(vtH);
      vec3 vtR1 = cross(vtDpdy, normal);
      vec3 vtR2 = cross(normal, vtDpdx);
      float vtDet = dot(vtDpdx, vtR1);
      vec3 vtGrad = sign(vtDet) * (vtDx * vtR1 + vtDy * vtR2);
      normal = normalize(abs(vtDet) * normal - vtB * vtGrad);
    }
  }
`

/**
 * Wind, for instanced foliage: each plant sways on its own phase, more at the
 * top than at the root. `uSwayHeight` is the plant's height in its own units,
 * so the same chunk serves a conifer and a fern.
 */
const SWAY_BODY = /* glsl */ `
  #ifdef USE_INSTANCING
  {
    vec3 vvBase = instanceMatrix[3].xyz;
    float vvH = clamp(transformed.y / uSwayHeight, 0.0, 1.0);
    float vvPh = uTime * 1.1 + vvBase.x * 0.21 + vvBase.z * 0.17;
    float vvS = (sin(vvPh) + 0.5 * sin(vvPh * 2.3 + 1.3)) * uSway * uSwayHeight * vvH * vvH;
    transformed.x += vvS;
    transformed.z += vvS * 0.4;
  }
  #endif
`

/** Ablation: the face into the wind is white-hot, the rest of the rock dull red. */
const HEAT_BODY = /* glsl */ `
  {
    float vvF = max(dot(normalize(vvHeatN), uHeatDir), 0.0);
    vec3 vvHot = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.95, 0.75), pow(vvF, 4.0));
    totalEmissiveRadiance += vvHot * (pow(vvF, 1.6) * uHeat + uHeat * 0.12);
  }
`

type Shader = WebGLProgramParametersWithUniforms

const mistUniforms = () => ({
  uMistColor: ATMOS.uMistColor,
  uMistAmount: ATMOS.uMistAmount,
  uMistFloor: ATMOS.uMistFloor,
  uMistFall: ATMOS.uMistFall,
  uMistDist: ATMOS.uMistDist,
})

/* -------------------------------------------------------------------------- */
/* Programs for three's own materials                                          */
/* -------------------------------------------------------------------------- */

/** The ground. */
export function terrainProgram(shader: Shader): void {
  Object.assign(shader.uniforms, mistUniforms(), {
    uWaterLevel: ATMOS.uWaterLevel,
    uBump: ATMOS.uBump,
    uScorch: ATMOS.uScorch,
    uScorchAmount: ATMOS.uScorchAmount,
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
    ATMOS_PARS_FRAG +
    'uniform float uWaterLevel;\nuniform float uBump;\nuniform vec3 uScorch;\nuniform float uScorchAmount;\nvarying vec3 vvNormalW;\n' +
    NOISE_GLSL +
    shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>' + TERRAIN_COLOR)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(roughnessFactor, 0.5, vtShore), 1.0, vtScorch);',
      )
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + TERRAIN_BUMP)
      .replace('#include <fog_fragment>', '#include <fog_fragment>' + MIST_BODY)
}

/** Anything that only needs to sit in the mist: the volcano, the rock. */
export function atmosProgram(shader: Shader): void {
  Object.assign(shader.uniforms, mistUniforms())
  shader.vertexShader =
    ATMOS_PARS_VERT + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>' + ATMOS_VERT_BODY)
  shader.fragmentShader =
    ATMOS_PARS_FRAG + shader.fragmentShader.replace('#include <fog_fragment>', '#include <fog_fragment>' + MIST_BODY)
}

/** Foliage: sway plus mist. */
export function foliageProgram(height: number): (shader: Shader) => void {
  return (shader) => {
    Object.assign(shader.uniforms, mistUniforms(), {
      uTime: ATMOS.uTime,
      uSway: ATMOS.uSway,
      uSwayHeight: { value: height },
    })
    shader.vertexShader =
      ATMOS_PARS_VERT +
      'uniform float uTime;\nuniform float uSway;\nuniform float uSwayHeight;\n' +
      shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>' + SWAY_BODY)
        .replace('#include <project_vertex>', '#include <project_vertex>' + ATMOS_VERT_BODY)
    shader.fragmentShader =
      ATMOS_PARS_FRAG + shader.fragmentShader.replace('#include <fog_fragment>', '#include <fog_fragment>' + MIST_BODY)
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
      float high = vvFbm3(uv * 0.6 + vec2(uTime * 0.004, 0.0));
      float low = vvFbm3(uv * 1.7 + vec2(uTime * 0.011, uTime * 0.003) + 40.0);
      float cover = smoothstep(0.48, 0.78, high) * smoothstep(0.0, 0.22, dir.y);
      float wisps = smoothstep(0.55, 0.85, low) * smoothstep(0.0, 0.3, dir.y) * 0.5;
      vec3 cloud = mix(uHigh, uGlow, 0.65) + vec3(0.18);
      col = mix(col, cloud, cover * uCloud * 0.8);
      col = mix(col, cloud * 0.92, wisps * uCloud * 0.6);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`
