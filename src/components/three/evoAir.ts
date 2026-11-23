import {
  BackSide,
  Color,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Material,
  type Mesh,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { PLACE } from './evoLand'

/**
 * The air of the long walk: the sky, and the haze between the camera and
 * everything it looks at.
 *
 * Unlike the valley's, this sky has a sun that moves — it rises out of the
 * mouth of the cave, goes round three times while the years go by and sets
 * behind the city — so its direction is a uniform everywhere, and so is every
 * colour: the scene blends them from `MOODS` each frame by how high the sun is.
 *
 * Nothing here is a module-level singleton. `createAir()` makes the one set of
 * uniforms a scene shares between its dome and every material standing in its
 * haze, and a second scene would get its own.
 */

export type Shader = WebGLProgramParametersWithUniforms

export interface Air {
  uSunDir: { value: Vector3 }
  uMoonDir: { value: Vector3 }
  uZenith: { value: Color }
  uHorizon: { value: Color }
  /** The sky round the sun, and the haze looking towards it. */
  uGlow: { value: Color }
  /** The disc itself. */
  uSunColor: { value: Color }
  /** How much of the sun's disc and halo there is: 0 once it is well down. */
  uSunUp: { value: number }
  uMoonUp: { value: number }
  uStars: { value: number }
  /** Seconds, for the clouds' drift; and days gone by, for the stars' turning. */
  uTime: { value: number }
  uDays: { value: number }
  /** How much cloud, 0 to 1. */
  uCloud: { value: number }
  /** The haze: its colour, and (density at the floor, falloff with height, the floor's height, how much it glows towards the sun). */
  uHaze: { value: Color }
  uAir: { value: Vector4 }
}

/**
 * What a scene's parts are handed when they are built: its air, and a way to
 * say that something has just arrived — a mesh back from the worker — so its
 * shaders can be compiled before it is first in shot rather than on the frame
 * it appears, which is a stall in the middle of somebody's scroll.
 */
export interface Arrivals {
  /** Compiles what has arrived, where that is done ahead; done when the promise is. */
  arrived?: (object: Object3D) => Promise<unknown> | void
}

export function createAir(): Air & Arrivals {
  return {
    uSunDir: { value: new Vector3(1, 0.1, 0) },
    uMoonDir: { value: new Vector3(-1, 0.4, 0) },
    uZenith: { value: new Color('#2c68c2') },
    uHorizon: { value: new Color('#bcd4ee') },
    uGlow: { value: new Color('#ffffff') },
    uSunColor: { value: new Color('#fff5e6') },
    uSunUp: { value: 1 },
    uMoonUp: { value: 0 },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uDays: { value: 0 },
    uCloud: { value: 0.5 },
    uHaze: { value: new Color('#c4d6ea') },
    uAir: { value: new Vector4(0.004, 0.03, 0, 0.7) },
  }
}

/**
 * Value noise for the shaders, prefixed so it never collides with a chunk of
 * three's. The lattice hash is the integer one `evoLand.ts` uses on the CPU.
 */
export const EVO_NOISE = /* glsl */ `
  float evoHash(vec2 p) {
    ivec2 q = ivec2(floor(p));
    uint h = uint(q.x * 668265261) ^ uint(q.y * 374761393);
    h = (h ^ (h >> 15u)) * 739982445u;
    h = (h ^ (h >> 12u)) * 695872825u;
    h = h ^ (h >> 15u);
    return float(h >> 8u) / 16777216.0;
  }
  float evoNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = evoHash(i);
    float b = evoHash(i + vec2(1.0, 0.0));
    float c = evoHash(i + vec2(0.0, 1.0));
    float d = evoHash(i + vec2(1.0, 1.0));
    return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
  }
  float evoFbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += evoNoise(p) * amp;
      p = p * 2.03 + vec2(17.3, -9.1);
      amp *= 0.5;
    }
    return sum / 0.9375;
  }
  float evoHash3(vec3 p) {
    ivec3 q = ivec3(floor(p));
    uint h = uint(q.x * 668265261) ^ uint(q.y * 374761393) ^ uint(q.z * 1274126177);
    h = (h ^ (h >> 15u)) * 739982445u;
    h = (h ^ (h >> 12u)) * 695872825u;
    h = h ^ (h >> 15u);
    return float(h >> 8u) / 16777216.0;
  }
  float evoNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a = mix(evoHash3(i), evoHash3(i + vec3(1.0, 0.0, 0.0)), u.x);
    float b = mix(evoHash3(i + vec3(0.0, 1.0, 0.0)), evoHash3(i + vec3(1.0, 1.0, 0.0)), u.x);
    float c = mix(evoHash3(i + vec3(0.0, 0.0, 1.0)), evoHash3(i + vec3(1.0, 0.0, 1.0)), u.x);
    float d = mix(evoHash3(i + vec3(0.0, 1.0, 1.0)), evoHash3(i + vec3(1.0, 1.0, 1.0)), u.x);
    return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
  }
`

/** The haze, for anything that stands in it. Needs `vEvoWorld`, the fragment's place in the world. */
export const AIR_PARS = /* glsl */ `
  uniform vec3 uHaze;
  uniform vec3 uGlow;
  uniform vec3 uSunDir;
  uniform vec4 uAir;
  varying vec3 vEvoWorld;

  // Haze that thins with height, integrated along the line of sight: thick in
  // the bottom of the valley at dawn, thin from a height, and brighter and
  // warmer looking towards the sun than away from it.
  vec3 evoAir(vec3 color) {
    vec3 ray = vEvoWorld - cameraPosition;
    float dist = length(ray);
    vec3 dir = ray / max(dist, 1e-4);
    float fall = uAir.y;
    float climb = dir.y * fall;
    float through = abs(climb) > 1e-4 ? (1.0 - exp(-climb * dist)) / climb : dist;
    float amount = uAir.x * exp(-fall * (cameraPosition.y - uAir.z)) * through;
    float fog = 1.0 - exp(-max(amount, 0.0));
    float toSun = pow(max(dot(dir, uSunDir), 0.0), 5.0);
    return mix(color, mix(uHaze, uGlow, toSun * uAir.w), clamp(fog, 0.0, 1.0));
  }

  // How much of the sky a point can see: all of it in the open, next to none
  // at the back of the cave, and more the nearer the mouth. The sky's light
  // comes from every side at once, so nothing in the scene shadows it; without
  // this the inside of the cave is lit like the hillside it is under.
  float evoOpen(vec3 at) {
    vec2 room = vec2(${PLACE.cave.chamber.x.toFixed(2)}, ${PLACE.cave.chamber.z.toFixed(2)});
    vec2 a = room + vec2(3.0, 0.0);
    vec2 b = vec2(${(PLACE.cave.mouth.x + 1.5).toFixed(2)}, ${PLACE.cave.mouth.z.toFixed(2)});
    vec2 ab = b - a;
    float along = clamp(dot(at.xz - a, ab) / dot(ab, ab), 0.0, 1.0);
    float hall = length(at.xz - a - ab * along) - ${PLACE.cave.passage.toFixed(2)};
    float within = 1.0 - smoothstep(-0.6, 2.4, min(length(at.xz - room) - ${PLACE.cave.chamber.r.toFixed(2)}, hall));
    within *= 1.0 - smoothstep(6.0, 8.5, at.y);
    float leak = exp(-max(${PLACE.cave.mouth.x.toFixed(2)} - at.x, 0.0) / 4.5);
    return mix(1.0, 0.03 + 0.55 * leak, within);
  }
`

const WORLD_VERT = /* glsl */ `
  vec4 evoPlace = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    evoPlace = batchingMatrix * evoPlace;
  #endif
  #ifdef USE_INSTANCING
    evoPlace = instanceMatrix * evoPlace;
  #endif
  vEvoWorld = (modelMatrix * evoPlace).xyz;
`

/** The air's uniforms and nothing else, for a material that takes all of them. */
export function airUniforms(air: Air): Record<string, { value: unknown }> {
  const { uSunDir, uMoonDir, uZenith, uHorizon, uGlow, uSunColor, uSunUp, uMoonUp, uStars, uTime, uDays, uCloud, uHaze, uAir } = air
  return { uSunDir, uMoonDir, uZenith, uHorizon, uGlow, uSunColor, uSunUp, uMoonUp, uStars, uTime, uDays, uCloud, uHaze, uAir }
}

/**
 * Where a material's own declarations go in the fragment shader: after the
 * air's, which they may call. (Replacing `#include <common>` a second time
 * would put them *before* it.)
 */
export const PARS_HERE = '#define EVO_PARS_HERE'

const fogUniforms = (air: Air) => ({ uHaze: air.uHaze, uGlow: air.uGlow, uSunDir: air.uSunDir, uAir: air.uAir })

/**
 * Stands one of three's own materials in the haze, and lets a caller add to
 * its program. The haze goes on in linear light, before tone mapping: after
 * it, the same haze would be a different colour over bright ground and dark.
 *
 * `key` names the program: three caches programs by the text of
 * `onBeforeCompile`, and two closures with the same text and different
 * captured values would otherwise be handed the same one.
 */
export function inAir<T extends Material>(material: T, air: Air, key: string, extend?: (shader: Shader) => void): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fogUniforms(air))
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEvoWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VERT}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${AIR_PARS}\n${PARS_HERE}`)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = evoAir(gl_FragColor.rgb);')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= evoOpen(vEvoWorld);\n#include <aomap_fragment>')
    extend?.(shader)
  }
  material.customProgramCacheKey = () => `evo:${key}`
  return material
}

/**
 * Gives a mesh that is instanced or skinned its own materials to cast a
 * shadow with, and returns what disposes of them.
 *
 * Left alone, everything in a scene casts its shadow with one material of
 * three's, which is given a new program each time the kind of thing being
 * drawn changes — and a program is filed under the number of lights lit at
 * the time, though a shadow's does not use them. So the first village roof
 * drawn after the fire in the cave has been left behind is a new program, made
 * in the middle of somebody's scroll. With a material of its own a kind of
 * thing has the one program, made the first time it is drawn, for good.
 */
export function ownShadow(mesh: Mesh): () => void {
  const depth = new MeshDepthMaterial()
  const distance = new MeshDistanceMaterial()
  mesh.customDepthMaterial = depth
  mesh.customDistanceMaterial = distance
  return () => {
    depth.dispose()
    distance.dispose()
  }
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // The dome rides with the camera and sits on the far plane.
    vec4 at = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = at.xyww;
  }
`

const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uSunColor;
  uniform vec3 uHaze;
  uniform float uSunUp;
  uniform float uMoonUp;
  uniform float uStars;
  uniform float uTime;
  uniform float uDays;
  uniform float uCloud;
  varying vec3 vDir;

  ${EVO_NOISE}

  // Cloud density over a point of the deck: billows from a warped fbm.
  float evoCloud(vec2 uv) {
    vec2 warp = vec2(evoNoise(uv * 0.7 + 3.1), evoNoise(uv * 0.7 - 8.4)) - 0.5;
    float d = evoFbm(uv + warp * 0.9);
    d += 0.35 * evoNoise(uv * 4.3 + warp);
    return d / 1.35;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = max(dir.y, 0.0);

    // Horizon to zenith: most of the change is in the first few degrees.
    vec3 sky = mix(uHorizon, uZenith, 1.0 - exp(-up * 3.4));

    // The glow round the sun, and along the horizon under it even after it has set.
    float toSun = max(dot(dir, uSunDir), 0.0);
    vec2 flat_ = normalize(dir.xz + vec2(1e-5));
    vec2 sunFlat = normalize(uSunDir.xz + vec2(1e-5));
    float bearing = max(dot(flat_, sunFlat), 0.0);
    float band = pow(bearing, 2.5) * exp(-up * 5.5);
    float halo = pow(toSun, 6.0) * 0.5 + pow(toSun, 48.0) * 0.8;
    sky += uGlow * (halo * uSunUp + band * 0.55 * smoothstep(-0.34, 0.1, uSunDir.y));

    // Stars, turning with the days. A cell of a grid on the sphere holds at
    // most one, and most hold none.
    if (uStars > 0.001) {
      float turn = uDays * 6.2831853;
      vec3 axis = normalize(vec3(0.0, 0.76, -0.65));
      vec3 sd = dir * cos(turn) + cross(axis, dir) * sin(turn) + axis * dot(axis, dir) * (1.0 - cos(turn));
      vec3 cell = sd * 150.0;
      vec3 id = floor(cell);
      vec3 f = cell - id - 0.5;
      float pick = evoHash3(id);
      vec3 off = vec3(evoHash3(id + 7.0), evoHash3(id + 13.0), evoHash3(id + 29.0)) - 0.5;
      float d = length(f - off * 0.7);
      float size = mix(0.05, 0.16, evoHash3(id + 41.0));
      float star = smoothstep(size, 0.0, d) * step(0.972, pick);
      float twinkle = 0.75 + 0.25 * sin(uTime * (2.0 + 5.0 * evoHash3(id + 3.0)) + pick * 60.0);
      vec3 tint = mix(vec3(0.75, 0.84, 1.0), vec3(1.0, 0.9, 0.78), evoHash3(id + 53.0));
      sky += tint * star * twinkle * uStars * smoothstep(0.0, 0.12, dir.y) * 1.6;
      // The band of the galaxy, faintly.
      float lane = exp(-pow(dot(sd, normalize(vec3(0.5, 0.2, 0.84))) * 3.2, 2.0));
      sky += vec3(0.05, 0.06, 0.09) * lane * evoNoise(sd.xy * 9.0 + sd.z * 5.0) * uStars * smoothstep(0.0, 0.3, dir.y);
    }

    // The moon: a disc with a little shading on it, and a soft ring of light.
    float toMoon = dot(dir, uMoonDir);
    float moon = smoothstep(0.99972, 0.99986, toMoon);
    float seas = 0.82 + 0.18 * evoNoise(dir.xy * 260.0 + dir.z * 140.0);
    sky += vec3(0.86, 0.9, 1.0) * (moon * seas * 1.5 + pow(max(toMoon, 0.0), 900.0) * 0.22 + pow(max(toMoon, 0.0), 60.0) * 0.035) * uMoonUp;

    // The sun's disc.
    sky += uSunColor * (smoothstep(0.99988, 0.99996, toSun) * 14.0 + pow(toSun, 1400.0) * 1.6) * uSunUp;

    // A deck of cloud, lit: where there is more cloud between a point and the
    // sun it is the shaded underside, where there is less, the lit edge.
    if (uCloud > 0.001 && dir.y > 0.012) {
      vec2 uv = dir.xz / (dir.y + 0.16) * 0.55 + vec2(uTime * 0.006, uTime * 0.0025);
      float cover = mix(0.66, 0.4, uCloud);
      float here = smoothstep(cover, cover + 0.3, evoCloud(uv));
      if (here > 0.001) {
        vec2 towards = normalize(uSunDir.xz / max(uSunDir.y, 0.08) * 0.55 - uv + vec2(1e-4));
        float there = smoothstep(cover, cover + 0.3, evoCloud(uv + towards * 0.09));
        float lit = clamp(0.62 + (here - there) * 1.7, 0.0, 1.0);
        vec3 shade = mix(uZenith, uHorizon, 0.45) * 0.62;
        vec3 bright = mix(uHorizon, uGlow, 0.55) * (0.8 + 0.5 * uSunUp) + uGlow * pow(toSun, 5.0) * 0.6 * uSunUp;
        vec3 cloud = mix(shade, bright, lit);
        float thin = smoothstep(0.012, 0.2, dir.y);
        sky = mix(sky, cloud, here * thin * 0.9);
      }
    }

    // Below the horizon there is only haze, so no gap ever shows under the land.
    sky = mix(sky, uHaze, smoothstep(0.0, -0.06, dir.y));

    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * The dome. It sits on the far plane and writes no depth, and it is drawn
 * after everything solid (the walk gives it the last place among them) with
 * the depth test on: so a pixel is shaded as sky only where nothing solid was
 * drawn, which is what drawing it first and covering it used to show, sample
 * for sample. Nothing in the walk is far enough off to share the far plane's
 * depth with it — the ranges end two kilometres out and the far plane is past
 * four — and everything solid in it writes depth (`walk-sky.test.ts`).
 * Anything see-through still comes after, over the sky as before.
 */
export function makeSkyMaterial(air: Air): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: airUniforms(air),
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  })
}

/**
 * The ranges, which are far enough off that what they are made of is mostly
 * the air in front of them: each fragment is the rock's own lit colour blended
 * towards the sky's at the horizon, more at the foot than at the peak.
 */
export function makeRangeMaterial(air: Air): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...airUniforms(air), uLight: { value: new Color('#fff5e6') }, uAmbient: { value: new Color('#b4c8ec') } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uGlow;
      uniform vec3 uHaze;
      uniform vec3 uLight;
      uniform vec3 uAmbient;
      uniform float uSunUp;
      varying vec3 vWorld;
      varying vec3 vNormal;
      ${EVO_NOISE}
      void main() {
        vec3 n = normalize(vNormal);
        float height = vWorld.y;
        // Forest low down, rock above it, snow where it is high and not too steep.
        float rough = evoFbm(vWorld.xz * 0.012);
        vec3 rock = mix(vec3(0.16, 0.15, 0.15), vec3(0.3, 0.27, 0.25), rough);
        vec3 wood = vec3(0.06, 0.09, 0.06);
        vec3 ground = mix(wood, rock, smoothstep(70.0, 190.0, height + rough * 80.0));
        float snow = smoothstep(250.0, 340.0, height + rough * 90.0) * smoothstep(0.42, 0.7, n.y);
        ground = mix(ground, vec3(0.86, 0.9, 0.96), snow);
        float lit = max(dot(n, uSunDir), 0.0);
        vec3 color = ground * (uLight * lit + uAmbient * (0.45 + 0.4 * n.y));
        // The air: thickest at the foot, and bright towards the sun.
        vec3 view = normalize(vWorld - cameraPosition);
        float dist = length(vWorld - cameraPosition);
        float thick = 1.0 - exp(-dist * 0.00115) * mix(0.7, 1.0, smoothstep(0.0, 380.0, height));
        float toSun = pow(max(dot(normalize(vec3(view.x, 0.05, view.z)), normalize(vec3(uSunDir.x, 0.05, uSunDir.z))), 0.0), 4.0);
        vec3 airColor = mix(mix(uHorizon, uZenith, 0.22), uGlow, toSun * 0.5 * smoothstep(-0.3, 0.15, uSunDir.y));
        color = mix(color, airColor, clamp(thick, 0.0, 0.97));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}
