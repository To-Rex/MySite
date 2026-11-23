import { Color, DoubleSide, MeshStandardMaterial, Vector2, Vector3, Vector4 } from 'three'
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

/**
 * How a figure is finished. Colours for what it is made of — the eight
 * regions `evoFigures.ts` paints it with — and for what grows on it.
 */
export interface FigureLook {
  skin: string
  /** Leather; knitted cloth; woven cloth; ivory and nail; the sole of a shoe. */
  hide: string
  cloth: string
  denim: string
  horn: string
  sole: string
  /** The hair of the head, at its roots and at its ends. */
  hair: readonly [string, string]
  /** Fur — worn or its own — likewise. */
  fur: readonly [string, string]
  /** The iris. */
  eye: string
  /** How much hair and fur shine along their length: how sharp the streak is, and how bright. */
  gloss: readonly [number, number]
  /** How long the hair and the fur are, as a share of how long they were grown. */
  lengths: readonly [number, number]
}

export interface FigureUniforms {
  /** One colour for each region, in the regions' own order. */
  uTint: { value: Color[] }
  /** The light now, for the rim it puts on skin and hair when it is behind them. */
  uLight: { value: Color }
  uBump: { value: number }
  /** Metres to one unit of the mesh, which is normalised: the surface's grain is the same size on everyone. */
  uSize: { value: number }
  uCoatDark: { value: Color[] }
  uCoatPale: { value: Color[] }
  uCoatGloss: { value: Vector2 }
  uCoatLength: { value: Vector2 }
  /** How much wider than grown to draw each lock, for a coat that is being drawn thinned. */
  uCoatWidth: { value: number }
  /** Which way the coat is thrown by how its wearer is moving, in the mesh's units a unit of length. */
  uSwing: { value: Vector3 }
  /** The wind in it: along x and along z. */
  uCoatWind: { value: Vector2 }
  uIris: { value: Color }
}

const FIGURE_PARS = /* glsl */ `
  uniform vec3 uTint[8];
  uniform vec3 uLight;
  uniform float uBump;
  uniform float uSize;
  varying vec4 vEvoRegions;
  varying vec4 vEvoRegions2;
  varying vec4 vEvoPaint;
  varying vec3 vEvoBind;
  varying float vEvoAo;
  ${EVO_NOISE}
  ${BUMP}

  float evoFigureHeight;
  float evoFigureRough;
  float evoFigureFuzz;
  float evoFigureSkin;

  // a: skin, scalp, pelt, hide. b: cloth, denim, horn, sole.
  vec3 evoFigure(vec3 m, vec4 a, vec4 b, vec4 paint) {
    // Noise in metres, in the pose the figure was sculpted in, so it is the
    // same size on a person and a mammoth and stays on the body as it moves.
    float broad = evoNoise3(m * 7.0);
    float mid = evoNoise3(m * 34.0);
    float fine = evoNoise3(m * 190.0);
    // Strands and tufts: noise stretched along the fall of hair.
    float strand = evoNoise3(vec3(m.x * 210.0, m.y * 24.0, m.z * 210.0));
    float tuft = evoNoise3(vec3(m.x * 46.0, m.y * 13.0, m.z * 46.0));
    float twill = evoNoise3(vec3(m.x * 360.0, m.y * 60.0, m.z * 360.0));

    vec3 skin = uTint[0] * (0.9 + 0.12 * broad + 0.07 * mid);
    // Blood near the surface, the hair of a brow, a lip.
    skin = mix(skin, skin * vec3(1.14, 0.8, 0.74), paint.x * 0.6);
    skin = mix(skin, uTint[1] * 0.6, paint.z * (0.6 + 0.4 * strand));
    skin = mix(skin, skin * vec3(0.94, 0.62, 0.6), paint.w);
    // Under hair and under fur it is as dark as their roots.
    vec3 scalp = uTint[1] * (0.4 + 0.35 * strand);
    vec3 pelt = uTint[2] * (0.36 + 0.4 * tuft * (0.6 + 0.4 * strand));
    vec3 hide = uTint[3] * (0.72 + 0.36 * broad + 0.12 * mid) * (0.95 + 0.1 * fine);
    vec3 cloth = uTint[4] * (0.9 + 0.12 * fine + 0.06 * mid);
    vec3 denim = uTint[5] * (0.84 + 0.2 * twill + 0.06 * mid);
    vec3 horn = uTint[6] * (0.86 + 0.14 * mid + 0.05 * fine);
    vec3 sole = uTint[7] * (0.92 + 0.1 * fine);

    evoFigureHeight =
      dot(a, vec4(fine * 0.004, strand * 0.4, tuft * 0.6, broad * 0.12 + mid * 0.07 + fine * 0.04)) +
      dot(b, vec4(fine * 0.035 + broad * 0.05, twill * 0.05 + broad * 0.04, mid * 0.03, fine * 0.04));
    evoFigureRough = dot(a, vec4(0.66, 0.9, 0.95, 0.74)) + dot(b, vec4(0.93, 0.87, 0.34, 0.8));
    evoFigureFuzz = dot(a, vec4(0.2, 0.8, 0.9, 0.1)) + dot(b, vec4(0.5, 0.25, 0.06, 0.0));
    evoFigureSkin = a.x;
    vec3 color = skin * a.x + scalp * a.y + pelt * a.z + hide * a.w + cloth * b.x + denim * b.y + horn * b.z + sole * b.w;
    // Shade: the hollow of an eye, the stain at the root of a tusk.
    return mix(color, color * vec3(0.56, 0.47, 0.4), paint.y);
  }
`

/**
 * What a light does to a figure's surface, in place of three's own: the same,
 * and then, for skin, the red that comes back out of it just where the light
 * is leaving — the thing that separates flesh from painted clay.
 */
const FIGURE_LIGHT = /* glsl */ `
  void RE_Direct_EvoFigure(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
    RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    float nl = dot(geometryNormal, directLight.direction);
    float band = smoothstep(-0.3, 0.08, nl) * (1.0 - smoothstep(0.08, 0.62, nl));
    reflectedLight.directDiffuse += directLight.color * BRDF_Lambert(material.diffuseContribution) * vec3(0.9, 0.32, 0.2) * (band * evoFigureSkin * 0.24);
  }
  #undef RE_Direct
  #define RE_Direct RE_Direct_EvoFigure
`

const tints = (look: FigureLook): Color[] => [
  new Color(look.skin),
  new Color(look.hair[0]),
  new Color(look.fur[0]),
  new Color(look.hide),
  new Color(look.cloth),
  new Color(look.denim),
  new Color(look.horn),
  new Color(look.sole),
]

export function createFigureUniforms(look: FigureLook, bump: number): FigureUniforms {
  return {
    uTint: { value: tints(look) },
    uLight: { value: new Color('#ffffff') },
    uBump: { value: bump },
    uSize: { value: 1 },
    uCoatDark: { value: [new Color(look.hair[0]), new Color(look.fur[0])] },
    uCoatPale: { value: [new Color(look.hair[1]), new Color(look.fur[1])] },
    uCoatGloss: { value: new Vector2(look.gloss[0], look.gloss[1]) },
    uCoatLength: { value: new Vector2(look.lengths[0], look.lengths[1]) },
    uCoatWidth: { value: 1 },
    uSwing: { value: new Vector3() },
    uCoatWind: { value: new Vector2(0.02, 0.012) },
    uIris: { value: new Color(look.eye) },
  }
}

/**
 * A figure's surface: one mesh, eight materials' worth of colour blended by
 * the `regions` the mesher gave each vertex, with the sculpt's baked occlusion
 * and a rim of light where the sun is behind — the thing that makes a body in
 * front of a low sun read as flesh and hair rather than as a cut-out.
 */
export function makeFigureMaterial(air: Air, uniforms: FigureUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0 })
  return inAir(material, air, 'figure', (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 regions;\nattribute vec4 regions2;\nattribute vec4 paint;\nattribute float aoValue;\nvarying vec4 vEvoRegions;\nvarying vec4 vEvoRegions2;\nvarying vec4 vEvoPaint;\nvarying vec3 vEvoBind;\nvarying float vEvoAo;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvEvoRegions = regions;\nvEvoRegions2 = regions2;\nvEvoPaint = paint;\nvEvoBind = position;\nvEvoAo = aoValue;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${FIGURE_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${FIGURE_LIGHT}`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = evoFigure(vEvoBind * uSize, vEvoRegions, vEvoRegions2, vEvoPaint) * mix(0.4, 1.0, vEvoAo);',
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

// --------------------------------------------------------------------- coat

/** How many times a lock can bend along its length: the strip it is drawn as has one more row than this. */
export const COAT_SPANS = 5

const COAT_VERT_PARS = /* glsl */ `
  attribute vec3 aRoot;
  attribute vec4 aGrow;
  attribute vec4 aAcross;
  attribute vec4 aTone;
  attribute vec4 aShape;
  uniform vec2 uCoatLength;
  uniform float uCoatWidth;
  uniform vec3 uSwing;
  uniform vec2 uCoatWind;
  uniform float uTime;
  varying vec4 vEvoCard;
  varying vec3 vEvoLock;
  varying vec3 vEvoStrand;
`

/**
 * A lock, from its root: out along the way it grows, bent by its own weight
 * the further along it is, thrown by how its wearer is moving and by the wind,
 * and laid on the surface it grows from wherever that would have put it under.
 * All of it after the skin has been posed, so it is the posed animal's coat
 * that hangs — downwards, whichever way up the limb it is on has ended.
 */
const COAT_VERT = /* glsl */ `
  {
    float evoV = position.y;
    vec3 evoDir = aGrow.xyz;
    vec3 evoWide = aAcross.xyz;
    #ifdef USE_SKINNING
      evoDir = (skinMatrix * vec4(evoDir, 0.0)).xyz;
      evoWide = (skinMatrix * vec4(evoWide, 0.0)).xyz;
    #endif
    evoWide = normalize(evoWide);
    vec3 evoUp = normalize(objectNormal);
    float evoLen = aGrow.w * mix(uCoatLength.x, uCoatLength.y, aTone.z);
    evoDir = normalize(evoDir);
    // Its weight turns it downwards the further along it is, and where it is
    // is the sum of the way it has gone so far: one that starts upwards rises,
    // arcs over and falls, as a lock does.
    float evoFall = acos(clamp(-evoDir.y, -1.0, 1.0));
    float evoSin = sin(evoFall);
    vec3 evoHang = evoDir;
    vec3 evoOff = vec3(0.0);
    for (int i = 0; i < ${COAT_SPANS}; i++) {
      float s = (float(i) + 0.5) / ${COAT_SPANS}.0;
      if (s > evoV) break;
      float k = clamp(aTone.w * s * 1.5, 0.0, 0.94);
      evoHang = evoSin > 1e-3 ? (sin((1.0 - k) * evoFall) * evoDir + sin(k * evoFall) * vec3(0.0, -1.0, 0.0)) / evoSin : evoDir;
      evoOff += evoHang * (evoLen / ${COAT_SPANS}.0);
    }
    float evoGust = sin(uTime * 1.7 + aTone.x * 40.0 + aRoot.x * 9.0) * 0.6 + sin(uTime * 0.63 + aRoot.z * 7.0 + aTone.x * 9.0) * 0.4;
    evoOff += (uSwing + vec3(uCoatWind.x, 0.0, uCoatWind.y) * (0.6 + evoGust)) * (evoV * evoV * evoLen * (0.25 + 0.75 * aTone.w));
    float evoLeast = evoLen * (aShape.x * 0.5 * evoV - aShape.w * evoV * evoV);
    evoOff += evoUp * max(0.0, evoLeast - dot(evoOff, evoUp));
    transformed += evoOff + evoWide * (position.x * aAcross.w * uCoatWidth * (1.0 - 0.3 * evoV));
    vEvoCard = vec4(position.x, evoV, aTone.x, aTone.z);
    vEvoLock = vec3(aTone.y, aShape.y, aShape.z);
    vEvoStrand = normalMatrix * evoHang;
  }
`

const COAT_PARS = /* glsl */ `
  uniform vec3 uCoatDark[2];
  uniform vec3 uCoatPale[2];
  uniform vec2 uCoatGloss;
  varying vec4 vEvoCard;
  varying vec3 vEvoLock;
  varying vec3 vEvoStrand;
  ${EVO_NOISE}

  float evoCoatTip;
  float evoCoatTone;

  // A lock cut into strands: each has its own lane across the card, fills it
  // at the root and narrows to nothing somewhere short of the end, wandering
  // as it goes. Returns how much of this fragment is hair; \`tone\` is which
  // strand it is, for its colour.
  //
  // The further off the card, the fewer and wider its strands — half as many
  // each time they would have gone under a pixel and a half — until it is one
  // lock coming to a point. Blurring them out to a grey instead would hand the
  // multisampler a card that is evenly half there, which it draws as a screen
  // door. Each card changes over at its own distance, so nothing pops.
  float evoStrands(vec2 uv, float seed, float count, out float tone) {
    float perPixel = fwidth((uv.x + 0.5) * count);
    float level = floor(max(0.0, log2(max(perPixel * 1.5, 1e-4)) + evoHash(vec2(seed * 4096.0, 5.0))));
    float lanes = max(1.0, floor(count / exp2(level) + 0.5));
    float x = (uv.x + 0.5) * lanes;
    float w = perPixel * lanes / count;
    float first = floor(x);
    float lock = floor(seed * 4096.0) + level * 57.0;
    float cover = 0.0;
    tone = 0.5;
    for (int i = -1; i <= 1; i++) {
      float lane = first + float(i);
      if (lane < 0.0 || lane >= lanes) continue;
      float r1 = evoHash(vec2(lane + lock, 3.0));
      float r2 = evoHash(vec2(lane + lock, 11.0));
      // Close to, some lanes have no strand in them and no two strands are as
      // thick: a lock is not a comb.
      float there = max(step(0.2, evoHash(vec2(lane + lock, 23.0))), min(level, 1.0));
      float thick = mix(0.6 + 0.4 * evoHash(vec2(lane + lock, 29.0)), 1.0, min(level, 1.0));
      float reach = 0.55 + 0.45 * r1;
      float t = uv.y / reach;
      float centre = lane + 0.5 + (r2 - 0.5) * 0.8 * uv.y + 0.2 * sin(uv.y * (4.0 + 5.0 * r1) + r2 * 6.28) * uv.y;
      // Out of the skin as a point, soon as wide as it gets, and tapering from there to its end.
      float half_ = 0.42 * thick * pow(max(1.0 - t, 0.0), 0.75) * smoothstep(0.0, 0.09, t);
      float a = clamp((half_ - abs(x - centre)) / max(w, 1e-4) + 0.5, 0.0, 1.0) * step(t, 1.0) * there;
      if (a > cover) {
        cover = a;
        tone = r2;
      }
    }
    return cover;
  }
`

/**
 * What a light does to hair. It is not a surface: light gets round it, so it
 * is lit well past where a skin would have gone dark; it shines in a streak
 * along each strand and not in a spot (Kajiya and Kay's model, twice, for the
 * light off the outside of a hair and the light that has been through it); and
 * with the light behind, its ends glow.
 */
const COAT_LIGHT = /* glsl */ `
  void RE_Direct_EvoCoat(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
    vec3 L = directLight.direction;
    float nl = dot(geometryNormal, L);
    vec3 base = BRDF_Lambert(material.diffuseContribution);
    reflectedLight.directDiffuse += directLight.color * base * clamp((nl + 0.5) / 1.5, 0.0, 1.0);

    // Each strand lies a little differently, so each has its streak in a
    // different place: without that a card shines all over at once, as the
    // flat thing it is.
    vec3 T = normalize(vEvoStrand);
    vec3 H = normalize(L + geometryViewDir);
    float lie = (evoCoatTone - 0.5) * 0.9;
    float t1 = dot(normalize(T + geometryNormal * (0.14 + lie)), H);
    float t2 = dot(normalize(T - geometryNormal * (0.22 - lie)), H);
    float s1 = pow(sqrt(max(1.0 - t1 * t1, 0.0)), uCoatGloss.x);
    float s2 = pow(sqrt(max(1.0 - t2 * t2, 0.0)), uCoatGloss.x * 0.3);
    float facing = smoothstep(-0.25, 0.45, nl);
    reflectedLight.directSpecular += directLight.color * facing * uCoatGloss.y * (s1 * 0.022 + s2 * base * 1.3);

    float through = pow(clamp(dot(-geometryViewDir, L), 0.0, 1.0), 3.0);
    reflectedLight.directDiffuse += directLight.color * base * (through * evoCoatTip * evoCoatTip * 1.6);
  }
  #undef RE_Direct
  #define RE_Direct RE_Direct_EvoCoat
`

/**
 * Fur and hair: every lock of a figure's coat drawn as an instance of one
 * strip (`evoCoat.ts` says where they are), posed with the skin they grow on
 * and cut into strands here. Not blended but written to the depth buffer like
 * anything solid, with how much of a pixel is hair handed to the multisampler
 * as coverage — so a coat needs no sorting, and its edge is soft all the same.
 */
export function makeCoatMaterial(air: Air, uniforms: FigureUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0, side: DoubleSide, alphaToCoverage: true })
  return inAir(material, air, 'coat', (shader) => {
    Object.assign(shader.uniforms, uniforms, { uTime: air.uTime })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COAT_VERT_PARS}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = aRoot;')
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>\n${COAT_VERT}`)
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${COAT_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${COAT_LIGHT}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          float evoTone;
          float evoCover = evoStrands(vEvoCard.xy, vEvoCard.z, vEvoLock.y, evoTone);
          if (evoCover < 0.03) discard;
          vec3 evoDark = mix(uCoatDark[0], uCoatDark[1], vEvoCard.w);
          vec3 evoPale = mix(uCoatPale[0], uCoatPale[1], vEvoCard.w);
          // Dark for most of its length; what the sun has had is the ends, and
          // more of them where the coat is uppermost.
          float evoEnds = smoothstep(0.3, 1.0, vEvoCard.y);
          float evoMix = clamp(evoEnds * (0.2 + 0.8 * vEvoLock.z) + (evoTone - 0.5) * 0.3, 0.0, 1.0);
          vec3 evoColor = mix(evoDark, evoPale, evoMix);
          // Roots are in each other's shade, and in whatever the body is in there.
          evoColor *= mix(0.3, 1.0, smoothstep(0.0, 0.5, vEvoCard.y)) * mix(0.5, 1.0, vEvoLock.x) * (0.78 + 0.44 * evoTone);
          diffuseColor = vec4(evoColor, evoCover);
          evoCoatTip = vEvoCard.y;
          evoCoatTone = evoTone;
        }`,
      )
      // The normal is the skin's under the lock, whichever face of the strip is seen.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
  })
}

// --------------------------------------------------------------------- eyes

const EYE_PARS = /* glsl */ `
  uniform vec3 uIris;
  uniform float uIrisSize;
  varying vec3 vEvoEye;

  float evoEyeRough;

  // An eyeball looking along +x: a pupil, an iris with a darker rim, the
  // white, reddening towards where the lids would cover it.
  vec3 evoEye(vec3 p) {
    float a = acos(clamp(normalize(p).x, -1.0, 1.0));
    float iris = 1.0 - smoothstep(uIrisSize * 0.94, uIrisSize * 1.04, a);
    float pupil = 1.0 - smoothstep(uIrisSize * 0.34, uIrisSize * 0.42, a);
    float rim = smoothstep(uIrisSize * 0.7, uIrisSize, a);
    vec3 white = mix(vec3(0.6, 0.57, 0.52), vec3(0.5, 0.3, 0.25), smoothstep(uIrisSize * 1.2, uIrisSize * 2.6, a));
    vec3 color = mix(white, uIris * (1.0 - 0.6 * rim), iris);
    evoEyeRough = 0.16;
    return mix(color, vec3(0.008), pupil);
  }
`

/** An eyeball: wet, so it is the one thing on a figure that throws the light straight back. */
export function makeEyeMaterial(air: Air, uniforms: FigureUniforms, irisSize: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.16, metalness: 0 })
  return inAir(material, air, 'eye', (shader) => {
    Object.assign(shader.uniforms, { uIris: uniforms.uIris, uIrisSize: { value: irisSize } })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEvoEye;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEvoEye = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${EYE_PARS}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = evoEye(vEvoEye);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = evoEyeRough;')
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
