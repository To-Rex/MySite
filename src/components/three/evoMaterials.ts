import { Color, MeshStandardMaterial, Vector4 } from 'three'
import { EVO_NOISE, PARS_HERE, inAir, type Air } from './evoAir'
import { PLACE } from './evoLand'

/**
 * What the long walk's ground is made of.
 *
 * One material for the whole strip, coloured per pixel from where the pixel is:
 * the shade at the roots of the meadow near the camera and the meadow's own
 * colour far off, bare earth where nothing grows, banded rock where it
 * steepens, mud at the water's edge — and then, as the years go by, ploughed
 * strips round the first roofs and paving where the city stands. Those last
 * two are uniforms the script turns up: the same ground is steppe at the start
 * of the walk and a city block by the end of it.
 */

/** sRGB in, working colour out: the palette is easier to read as it is seen. */
export const LIN = /* glsl */ `
  vec3 evoLin(vec3 c) { return pow(c, vec3(2.2)); }
`

/**
 * Bump from a height, with no UVs and no tangents: the surface-gradient
 * construction (Mikkelsen), from screen derivatives of the position and the
 * height. Useful values are a few hundredths; the height changes across a few
 * pixels, so its gradient is enormous.
 */
export const BUMP = /* glsl */ `
  vec3 evoBump(vec3 viewPos, vec3 n, float h, float amount) {
    vec3 sx = dFdx(viewPos);
    vec3 sy = dFdy(viewPos);
    vec3 r1 = cross(sy, n);
    vec3 r2 = cross(n, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2) * amount;
    return normalize(abs(det) * n - grad);
  }
`

export interface LandUniforms {
  /** Ploughed strips and a track, 0 to 1. */
  uField: { value: number }
  /** Paving, 0 to 1. */
  uCity: { value: number }
  /** The meadow seen from far off: its darker and its paler patches. */
  uMeadowA: { value: Color }
  uMeadowB: { value: Color }
  uBump: { value: number }
  /** 1 where there are blades to stand on the ground, 0 where the ground has to be the meadow by itself. */
  uBlades: { value: number }
}

export function createLandUniforms(): LandUniforms {
  return {
    uField: { value: 0 },
    uCity: { value: 0 },
    uMeadowA: { value: new Color('#585527') },
    uMeadowB: { value: new Color('#8a7f45') },
    uBump: { value: 0.035 },
    uBlades: { value: 1 },
  }
}

const LAND_PARS = /* glsl */ `
  uniform float uField;
  uniform float uCity;
  uniform vec3 uMeadowA;
  uniform vec3 uMeadowB;
  uniform float uBump;
  uniform float uBlades;
  uniform vec4 uPond;
  uniform vec4 uVillage;
  uniform vec4 uStreet;
  varying vec3 vEvoNormal;
  varying float vEvoGrass;
  ${EVO_NOISE}
  ${LIN}
  ${BUMP}

  float evoLandRough;
  float evoLandHeight;

  vec3 evoLand(vec3 wp, vec3 n, float dist) {
    float steep = 1.0 - n.y;
    float n1 = evoFbm(wp.xz * 0.035);
    float n2 = evoNoise(wp.xz * 0.27);
    float n3 = evoNoise(wp.xz * 1.9);
    float n4 = evoNoise(wp.xz * 8.5);

    // Bare earth, and what the meadow is: the shade at its roots close to, its
    // own colour from far enough off that the blades have run out.
    vec3 earth = mix(evoLin(vec3(0.33, 0.26, 0.18)), evoLin(vec3(0.47, 0.39, 0.28)), n2) * (0.8 + 0.4 * n3);
    vec3 roots = evoLin(vec3(0.22, 0.2, 0.1)) * (0.75 + 0.5 * n3);
    vec3 meadow = mix(uMeadowA, uMeadowB, clamp(n1 * 1.5 - 0.3 + (n2 - 0.5) * 0.3, 0.0, 1.0));
    float grown = vEvoGrass * smoothstep(0.18, 0.5, n1 * 0.6 + n2 * 0.4 + vEvoGrass * 0.35);
    vec3 color = mix(earth, mix(roots, meadow * 0.78, max(smoothstep(30.0, 110.0, dist), 1.0 - uBlades)), grown);
    evoLandRough = 0.96;
    evoLandHeight = n2 * 0.5 + n3 * 0.3 + n4 * 0.2;

    // Rock wherever it steepens: beds of it, a little offset from one another.
    float rocky = smoothstep(0.2, 0.42, steep + (n2 - 0.5) * 0.14);
    float bed = evoNoise(vec2(wp.y * 0.85 + n1 * 3.0, (wp.x + wp.z) * 0.03));
    vec3 rock = mix(evoLin(vec3(0.33, 0.3, 0.28)), evoLin(vec3(0.56, 0.5, 0.43)), bed) * (0.72 + 0.5 * n3);
    color = mix(color, rock, rocky);
    evoLandRough = mix(evoLandRough, 0.84, rocky);
    evoLandHeight = mix(evoLandHeight, bed * 0.7 + n4 * 0.5, rocky);

    // Mud at the water's edge, dark and a little glossy.
    float shore = 1.0 - smoothstep(1.0, 1.24, length(wp.xz - uPond.xy) / uPond.z + (n2 - 0.5) * 0.08);
    color = mix(color, evoLin(vec3(0.16, 0.14, 0.11)), shore * 0.9);
    evoLandRough = mix(evoLandRough, 0.42, shore);

    // The first fields: strips of different crops with the furrows in them,
    // and a track worn between the roofs and whatever is being built east.
    if (uField > 0.001) {
      vec2 f = (wp.xz - uVillage.xy) / vec2(46.0, 26.0) - vec2(0.0, -1.35);
      float inside = (1.0 - smoothstep(0.82, 1.0, abs(f.x) + (n2 - 0.5) * 0.12)) * (1.0 - smoothstep(0.8, 1.0, abs(f.y) + (n1 - 0.5) * 0.3));
      float strip = floor(wp.x / 6.5 + n1 * 0.6);
      float kind = evoHash(vec2(strip, 3.0));
      vec3 crop = kind < 0.34 ? evoLin(vec3(0.56, 0.47, 0.2)) : kind < 0.68 ? evoLin(vec3(0.27, 0.36, 0.14)) : evoLin(vec3(0.3, 0.22, 0.15));
      float furrow = 0.82 + 0.18 * sin(wp.x * 5.2);
      float edge = smoothstep(0.0, 0.08, abs(fract(wp.x / 6.5 + n1 * 0.6) - 0.5) * 2.0 - 0.02);
      color = mix(color, crop * furrow * (0.8 + 0.4 * n3) * mix(0.7, 1.0, edge), inside * uField * (1.0 - rocky));
      float along = smoothstep(uVillage.x - 60.0, uVillage.x - 30.0, wp.x) * (1.0 - smoothstep(uStreet.x - 4.0, uStreet.x + 10.0, wp.x));
      float lane = wp.z - mix(uVillage.y + 14.0, uStreet.y, smoothstep(uVillage.x - 10.0, uStreet.x, wp.x)) + (n1 - 0.5) * 5.0;
      float track = (1.0 - smoothstep(0.9, 2.4, abs(lane))) * along;
      color = mix(color, earth * 1.15, track * uField);
    }

    // And the city's own ground: made, level and grey.
    if (uCity > 0.001) {
      float paved = uCity * smoothstep(uStreet.x - 12.0, uStreet.x + 6.0, wp.x) * (1.0 - smoothstep(96.0, 138.0, abs(wp.z - uStreet.y)));
      vec3 slab = evoLin(vec3(0.3, 0.3, 0.31)) * (0.78 + 0.3 * n3 + 0.12 * n4);
      color = mix(color, slab, paved);
      evoLandRough = mix(evoLandRough, 0.82, paved);
      evoLandHeight = mix(evoLandHeight, n4 * 0.25, paved);
    }
    return color;
  }
`

/** The ground. `grass` rides in on the mesh as a vertex attribute: where the meadow grows. */
export function makeLandMaterial(air: Air, land: LandUniforms): MeshStandardMaterial {
  const { pond, village, city } = PLACE
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 })
  return inAir(material, air, 'land', (shader) => {
    Object.assign(shader.uniforms, land, {
      uPond: { value: new Vector4(pond.x, pond.z, pond.r, pond.level) },
      uVillage: { value: new Vector4(village.x, village.z, village.r, 0) },
      uStreet: { value: new Vector4(city.from, city.street, city.half, 0) },
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float grass;\nvarying vec3 vEvoNormal;\nvarying float vEvoGrass;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvEvoNormal = normal;\nvEvoGrass = grass;')
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${LAND_PARS}`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = evoLand(vEvoWorld, normalize(vEvoNormal), length(vEvoWorld - cameraPosition));',
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = evoLandRough;')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = evoBump(-vViewPosition, normal, evoLandHeight, uBump * (1.0 - smoothstep(18.0, 70.0, length(vViewPosition))));',
      )
  })
}

// ------------------------------------------------------------------ figures

/** How a figure is finished: a colour and a surface for each of its four regions. */
export interface FigureLook {
  skin: string
  hair: string
  cloth: string
  trim: string
  /** Roughness of skin, hair, cloth and trim. */
  rough: readonly [number, number, number, number]
  /** How much each catches the light at its edges: the down on skin, the nap of fur or wool. */
  fuzz: readonly [number, number, number, number]
  /** Relief on each, as a share of the land's bump. */
  relief: readonly [number, number, number, number]
  /** How shaggy the clothing is: 0 woven, 1 a pelt. */
  pelt: number
}

export interface FigureUniforms {
  uSkin: { value: Color }
  uHair: { value: Color }
  uCloth: { value: Color }
  uTrim: { value: Color }
  uRough: { value: Vector4 }
  uFuzz: { value: Vector4 }
  uRelief: { value: Vector4 }
  uPelt: { value: number }
  /** The light now, for the rim it puts on skin and hair when it is behind them. */
  uLight: { value: Color }
  uBump: { value: number }
}

const FIGURE_PARS = /* glsl */ `
  uniform vec3 uSkin;
  uniform vec3 uHair;
  uniform vec3 uCloth;
  uniform vec3 uTrim;
  uniform vec4 uRough;
  uniform vec4 uFuzz;
  uniform vec4 uRelief;
  uniform float uPelt;
  uniform vec3 uLight;
  uniform float uBump;
  varying vec4 vEvoRegions;
  varying vec3 vEvoBind;
  varying float vEvoAo;
  ${EVO_NOISE}
  ${BUMP}

  float evoFigureHeight;
  float evoFigureRough;
  float evoFigureFuzz;

  vec3 evoFigure(vec3 bind, vec4 r) {
    // Noise in the pose the figure was sculpted in, so it stays on the body as it moves.
    vec3 q = bind * 30.0;
    float fine = evoNoise3(q * 2.2);
    float mid = evoNoise3(q);
    float broad = evoNoise3(q * 0.3);
    // Strands: noise stretched along the fall of the hair.
    float strand = evoNoise3(vec3(q.x * 3.2, q.y * 0.4, q.z * 3.2));
    float tuft = evoNoise3(vec3(q.x * 1.3, q.y * 0.45, q.z * 1.3));

    vec3 skin = uSkin * (0.9 + 0.14 * broad + 0.06 * mid);
    vec3 hair = uHair * (0.62 + 0.75 * strand * (0.6 + 0.4 * tuft));
    vec3 woven = uCloth * (0.9 + 0.16 * mid + 0.05 * fine);
    vec3 pelt = uCloth * (0.5 + 0.95 * tuft * (0.55 + 0.45 * strand));
    vec3 cloth = mix(woven, pelt, uPelt);
    vec3 trim = uTrim * (0.86 + 0.24 * mid);

    evoFigureHeight =
      r.x * uRelief.x * fine +
      r.y * uRelief.y * strand +
      r.z * uRelief.z * mix(fine, tuft * 0.7 + strand * 0.5, uPelt) +
      r.w * uRelief.w * mid;
    evoFigureRough = dot(r, uRough);
    evoFigureFuzz = dot(r, uFuzz);
    return skin * r.x + hair * r.y + cloth * r.z + trim * r.w;
  }
`

export function createFigureUniforms(look: FigureLook, bump: number): FigureUniforms {
  return {
    uSkin: { value: new Color(look.skin) },
    uHair: { value: new Color(look.hair) },
    uCloth: { value: new Color(look.cloth) },
    uTrim: { value: new Color(look.trim) },
    uRough: { value: new Vector4(...look.rough) },
    uFuzz: { value: new Vector4(...look.fuzz) },
    uRelief: { value: new Vector4(...look.relief) },
    uPelt: { value: look.pelt },
    uLight: { value: new Color('#ffffff') },
    uBump: { value: bump },
  }
}

/**
 * A figure's surface: one mesh, four materials' worth of colour blended by the
 * `regions` the mesher gave each vertex, with the sculpt's baked occlusion and
 * a rim of light where the sun is behind — the thing that makes a body in
 * front of a low sun read as flesh and hair rather than as a cut-out.
 */
export function makeFigureMaterial(air: Air, uniforms: FigureUniforms, key: string): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0 })
  return inAir(material, air, `figure:${key}`, (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 regions;\nattribute float aoValue;\nvarying vec4 vEvoRegions;\nvarying vec3 vEvoBind;\nvarying float vEvoAo;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEvoRegions = regions;\nvEvoBind = position;\nvEvoAo = aoValue;')
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${FIGURE_PARS}`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = evoFigure(vEvoBind, vEvoRegions) * mix(0.42, 1.0, vEvoAo);',
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = evoFigureRough;')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = evoBump(-vViewPosition, normal, evoFigureHeight, uBump * (1.0 - smoothstep(6.0, 26.0, length(vViewPosition))));',
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          // Light from behind, coming through and round the edge of things.
          vec3 evoView = normalize(vViewPosition);
          vec3 evoSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float edge = pow(1.0 - clamp(dot(normal, evoView), 0.0, 1.0), 2.6);
          float behind = pow(clamp(dot(-evoView, evoSun), 0.0, 1.0), 2.0);
          float lit = clamp(dot(normal, evoSun) * 0.5 + 0.5, 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * uLight * edge * evoFigureFuzz * (0.18 + 0.9 * behind) * lit * mix(0.5, 1.0, vEvoAo);
        }`,
      )
  })
}

// --------------------------------------------------------------------- rock

const ROCK_PARS = /* glsl */ `
  uniform float uBump;
  varying vec3 vEvoNormal;
  varying float vEvoAo;
  ${EVO_NOISE}
  ${LIN}
  ${BUMP}

  float evoRockHeight;

  vec3 evoRock(vec3 wp, vec3 n) {
    float n1 = evoNoise3(wp * 0.33);
    float n2 = evoNoise3(wp * 1.3);
    float n3 = evoNoise3(wp * 5.5);
    // Beds: the rock in layers, a little bent.
    float bed = evoNoise3(vec3(wp.x * 0.07, wp.y * 1.05 + n1 * 1.7, wp.z * 0.07));
    vec3 rock = mix(evoLin(vec3(0.31, 0.28, 0.25)), evoLin(vec3(0.56, 0.5, 0.42)), smoothstep(0.28, 0.72, bed));
    rock = mix(rock, evoLin(vec3(0.42, 0.34, 0.27)), n1 * 0.55);
    rock *= 0.74 + 0.52 * n2;
    // Out in the weather, what faces the sky has lichen on it and grass in its cracks.
    float open = evoOpen(wp);
    float top = smoothstep(0.5, 0.85, n.y) * smoothstep(0.6, 1.0, open);
    rock = mix(rock, evoLin(vec3(0.33, 0.35, 0.17)) * (0.7 + 0.6 * n2), top * smoothstep(0.32, 0.7, n1 + n2 * 0.3));
    // And over the hearth, years of smoke.
    vec2 fromHearth = wp.xz - vec2(${PLACE.cave.hearth.x.toFixed(2)}, ${PLACE.cave.hearth.z.toFixed(2)});
    float soot = exp(-dot(fromHearth, fromHearth) / 22.0) * smoothstep(1.2, 4.0, wp.y) * (1.0 - open);
    rock *= 1.0 - 0.62 * soot;
    evoRockHeight = bed * 0.5 + n2 * 0.4 + n3 * 0.22;
    return rock * mix(0.3, 1.0, vEvoAo);
  }
`

/** The crag: bedded rock, weathered where the sky reaches it and smoked where the fire does. */
export function makeRockMaterial(air: Air, bump: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0 })
  return inAir(material, air, 'rock', (shader) => {
    shader.uniforms.uBump = { value: bump * 1.6 }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aoValue;\nvarying vec3 vEvoNormal;\nvarying float vEvoAo;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvEvoNormal = normal;\nvEvoAo = aoValue;')
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${ROCK_PARS}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = evoRock(vEvoWorld, normalize(vEvoNormal));')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = evoBump(-vViewPosition, normal, evoRockHeight, uBump * (1.0 - smoothstep(14.0, 60.0, length(vViewPosition))));',
      )
  })
}
