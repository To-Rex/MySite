import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
} from 'three'
import { AIR_PARS, EVO_NOISE, PARS_HERE, inAir, type Air } from './evoAir'
import { PLACE, hash2 } from './evoLand'
import { BUMP, LIN } from './evoMaterials'
import type { Beat, Part } from './evoWalk'

/**
 * The city at the end of the walk.
 *
 * A street running on along the walk with buildings down both sides of it and
 * taller ones behind, put up by the script — every block rises out of the
 * ground on its own beat while the days go round — and lit by it: the lamps
 * and the windows come on one at a time as the sun goes down.
 *
 * The buildings are one instanced box and all of what makes them buildings is
 * in the fragment shader. A wall is divided into bays and floors; each window
 * is a room, and the room is *drawn* — the ray from the eye is carried on
 * through the glass to whichever of the room's five inside faces it reaches —
 * so that walking past a lit front the back walls slide behind the frames the
 * way they do. By day the glass shows the sky, and at the right moment the sun.
 */

const CITY = PLACE.city
const STREET_Z = CITY.street
/** Kerb to kerb, and the pavement beyond each. */
const ROAD = CITY.half
const PAVEMENT = 4.2
/** Where the fronts of the buildings stand, either side. */
const FRONT_FAR = STREET_Z - ROAD - PAVEMENT
const FRONT_NEAR = STREET_Z + ROAD + PAVEMENT
/** Lamps: how far apart, and how high. */
const LAMP_GAP = 26
const LAMP_HEIGHT = 7.2

export interface Tower {
  x: number
  z: number
  w: number
  d: number
  h: number
  seed: number
  /** 0 concrete, 1 brick, 2 glass. */
  style: number
  /** When in the building of the city this one starts to go up, 0 to 1. */
  delay: number
  /** Metres its base is lifted off the ground: the studio's building has no ground floor of its own. */
  base: number
}

/** Cross streets: gaps in the fronts. */
const CROSSINGS = [331, 413, 492, 571] as const
const inCrossing = (x: number) => CROSSINGS.some((c) => Math.abs(x - c) < 7)

/** The city's blocks, the same every visit. */
export function towers(): Tower[] {
  const out: Tower[] = []
  const tall = (x: number) => {
    const t = Math.min(1, Math.max(0, (x - CITY.from) / 190))
    return 11 + 58 * t * t * (3 - 2 * t)
  }
  const row = (front: number, side: 1 | -1, depthFrom: number, depthTo: number, scale: number, gapChance: number, salt: number) => {
    let x = CITY.from + 5
    let n = 0
    while (x < CITY.until - 20) {
      const seed = hash2(n * 7 + salt, salt * 13 + 1)
      let w = 13 + hash2(n, salt + 3) * 15
      const d = depthFrom + hash2(n, salt + 5) * (depthTo - depthFrom)
      // The studio's building is placed, not rolled: its window has to be where the walk ends.
      const studio = salt === 1 && x <= PLACE.studio.x - 6 && x + w >= PLACE.studio.x - 6
      if (studio) {
        w = PLACE.studio.x + 9 - x
      }
      if (inCrossing(x) || inCrossing(x + w)) {
        x += 3
        continue
      }
      if (hash2(n, salt + 9) < gapChance || studio) {
        const h = tall(x + w / 2) * scale * (0.55 + 0.95 * hash2(n, salt + 11))
        out.push({
          x: x + w / 2,
          z: front + (side * d) / 2,
          w: w - 0.6,
          d,
          h: studio ? Math.max(26, h) : h,
          seed,
          style: hash2(n, salt + 17) < 0.36 ? 2 : hash2(n, salt + 19) < 0.45 ? 1 : 0,
          delay: 0.05 + 0.6 * Math.min(1, Math.max(0, (x - CITY.from) / 330)) * (0.6 + 0.4 * hash2(n, salt + 23)) + 0.12 * hash2(n, salt + 29),
          base: studio ? STUDIO.height + 0.35 : 0,
        })
      }
      x += w + (hash2(n, salt + 31) < 0.16 ? 4 : 0)
      n++
    }
  }
  // The fronts on the street, then two ranks behind each, taller and thinner.
  row(FRONT_FAR, -1, 15, 22, 1, 1, 1)
  row(FRONT_NEAR, 1, 15, 22, 0.95, 1, 2)
  row(FRONT_FAR - 30, -1, 18, 26, 1.75, 0.72, 3)
  row(FRONT_FAR - 66, -1, 20, 30, 2.5, 0.55, 4)
  row(FRONT_NEAR + 30, 1, 18, 26, 1.6, 0.6, 5)
  return out
}

/** The room at the end of the walk: how big it is, and where its glass is. */
export const STUDIO = { width: 7.6, height: 3.5, depth: 5.2 } as const

const BUILDING_VERT_PARS = /* glsl */ `
  attribute vec3 aSize;
  attribute vec4 aLook;
  uniform float uCity;
  varying vec3 vFacade;
  varying vec3 vFaceNormal;
  varying vec4 vLook;
  varying vec3 vSize;
`

const BUILDING_FRAG_PARS = /* glsl */ `
  uniform float uLamps;
  uniform float uTime;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform float uSunUp;
  uniform float uBump;
  varying vec3 vFacade;
  varying vec3 vFaceNormal;
  varying vec4 vLook;
  varying vec3 vSize;
  ${EVO_NOISE}
  ${LIN}
  ${BUMP}

  float evoWallRough;
  float evoWallHeight;
  vec3 evoWallGlow;

  // The inside of a room, from outside it: the ray that reached the glass at
  // 'at' (0..1 across the window) is carried on to whichever inside face it
  // meets first. 'dir' is the view direction with z going into the wall.
  vec3 evoRoom(vec2 at, vec3 dir, vec3 extent, float seed, out float lamp) {
    vec3 o = vec3(at * 2.0 - 1.0, -1.0);
    vec3 d = dir / extent;
    vec3 inv = 1.0 / (d + vec3(1e-5));
    vec3 k = abs(inv) - o * inv;
    float t = min(min(k.x, k.y), k.z);
    vec3 p = o + d * t;
    float back = step(k.z, min(k.x, k.y));
    float updown = step(k.y, min(k.x, k.z)) * (1.0 - back);
    // A wall colour, a darker floor, a pale ceiling with the light on it.
    vec3 wall = mix(vec3(0.62, 0.56, 0.46), vec3(0.42, 0.5, 0.58), step(0.6, fract(seed * 7.3)));
    wall = mix(wall, vec3(0.66, 0.42, 0.34), step(0.82, fract(seed * 3.1)));
    vec3 color = wall * (0.55 + 0.25 * back);
    color = mix(color, p.y > 0.0 ? vec3(0.86, 0.84, 0.8) : vec3(0.2, 0.16, 0.13), updown);
    // Something on the back wall, and something standing in front of it.
    float thing = step(0.5, evoHash(floor(p.xy * vec2(2.0, 1.5)) + seed * 91.0)) * back * step(p.y, 0.25);
    color = mix(color, color * 0.45, thing);
    float depth = clamp((p.z + 1.0) * 0.5, 0.0, 1.0);
    lamp = (1.0 - 0.55 * depth) * (0.75 + 0.5 * smoothstep(-1.0, 1.0, p.y));
    return color;
  }

  vec3 evoWall(vec3 world, vec3 n, vec3 view) {
    float style = vLook.y;
    float seed = vLook.x;
    evoWallGlow = vec3(0.0);
    evoWallHeight = 0.0;
    vec3 concrete = mix(evoLin(vec3(0.55, 0.54, 0.52)), evoLin(vec3(0.72, 0.69, 0.63)), fract(seed * 5.7)) * (0.9 + 0.2 * evoNoise(world.xy * 0.6 + world.z * 0.6));
    if (n.y > 0.5) {
      // The roof.
      evoWallRough = 0.95;
      return evoLin(vec3(0.17, 0.17, 0.18)) * (0.8 + 0.4 * evoNoise(world.xz * 0.8));
    }
    // Along the wall and up it, in metres, and which way is into the building.
    bool alongX = abs(n.z) > 0.5;
    float u = alongX ? vFacade.x + vSize.x * 0.5 : vFacade.z + vSize.z * 0.5;
    float v = vFacade.y;
    float span = alongX ? vSize.x : vSize.z;
    vec3 dir = alongX ? vec3(view.x, view.y, -view.z * sign(n.z)) : vec3(view.z, view.y, -view.x * sign(n.x));

    bool glassy = style > 1.5;
    bool brick = style > 0.5 && !glassy;
    float bay = glassy ? 1.9 : brick ? 2.9 : 3.3;
    float storey = glassy ? 3.6 : 3.2;
    float ground = 4.6;
    // Bays are centred, so no wall ends in half a window.
    float bays = max(1.0, floor(span / bay));
    float bu = (u - (span - bays * bay) * 0.5) / bay;
    float column = floor(bu);
    bool street = v < ground;
    float fv = street ? v / ground : (v - ground) / storey;
    float floorId = street ? -1.0 : floor(fv);
    vec2 cell = vec2(fract(bu), fract(fv));
    bool onWall = bu >= 0.0 && bu < bays && v < vSize.y - 0.9;

    // The frame of the window within its bay.
    vec2 lo = glassy ? vec2(0.035, 0.05) : street ? vec2(0.07, 0.07) : brick ? vec2(0.24, 0.2) : vec2(0.15, 0.17);
    vec2 hi = glassy ? vec2(0.965, 0.93) : street ? vec2(0.93, 0.8) : brick ? vec2(0.76, 0.84) : vec2(0.85, 0.8);
    vec2 inWindow = (cell - lo) / (hi - lo);
    float window = step(0.0, inWindow.x) * step(inWindow.x, 1.0) * step(0.0, inWindow.y) * step(inWindow.y, 1.0);
    window *= onWall ? 1.0 : 0.0;

    // The wall itself.
    vec3 wall = concrete;
    evoWallRough = 0.9;
    if (brick) {
      vec2 b = vec2(u * 4.2 + floor(v * 13.0) * 0.5, v * 13.0);
      float mortar = max(step(0.93, fract(b.x)), step(0.86, fract(b.y)));
      vec3 clay = mix(evoLin(vec3(0.47, 0.22, 0.16)), evoLin(vec3(0.6, 0.33, 0.22)), evoHash(floor(b) + seed * 31.0));
      wall = mix(clay, evoLin(vec3(0.62, 0.59, 0.53)), mortar) * (0.85 + 0.3 * evoNoise(world.xy * 0.4 + world.z * 0.4));
      evoWallHeight = 1.0 - mortar;
    } else if (glassy) {
      wall = evoLin(vec3(0.1, 0.11, 0.13));
      evoWallRough = 0.5;
    } else {
      // Panels: a joint every bay and every floor.
      float joint = max(step(0.985, cell.x) + step(cell.x, 0.015), step(0.975, cell.y));
      wall *= 1.0 - 0.3 * min(joint, 1.0);
      evoWallHeight = 1.0 - min(joint, 1.0);
    }
    // Rain has run down it for years.
    wall *= 0.82 + 0.18 * evoNoise(vec2(u * 0.9 + seed * 9.0, v * 0.12));
    // After dark the street lights the bottom of every wall, and less of it higher up.
    evoWallGlow = wall * vec3(1.0, 0.74, 0.46) * uLamps * (exp(-v / 6.5) * 0.5 + 0.018);
    if (window < 0.5) return wall;

    // ---- a window ----------------------------------------------------------
    vec2 id = vec2(column, floorId) + seed * 57.0;
    float pick = evoHash(id);
    float when = evoHash(id + 13.0);
    // Shop fronts are all lit once it is dusk; upstairs, some never are.
    float on = street ? smoothstep(0.08, 0.3, uLamps) : step(when * 0.92 + 0.04, uLamps) * step(pick, glassy ? 0.5 : 0.66);
    float lamp;
    vec3 room = evoRoom(inWindow, dir, vec3(bay * 0.5, (street ? ground : storey) * 0.5, street ? 4.5 : 3.2), pick + seed, lamp);
    vec3 tint = mix(vec3(1.0, 0.72, 0.42), vec3(0.72, 0.84, 1.0), step(0.78, fract(pick * 9.1)));
    tint = mix(tint, vec3(1.0, 0.86, 0.66), step(0.55, fract(pick * 4.3)));
    if (street) tint = mix(tint, vec3(0.5 + 0.5 * fract(pick * 2.7), 0.5 + 0.5 * fract(pick * 5.9), 0.6 + 0.4 * fract(pick * 8.3)), 0.45);
    // Blinds part of the way down some of them.
    float blind = step(inWindow.y, 1.0 - fract(pick * 6.7) * 0.7 * step(0.5, fract(pick * 2.3))) ;
    float strength = (street ? 2.6 : 1.5 + 1.4 * fract(pick * 3.7)) * (0.35 + 0.65 * blind);
    // Mullions on a glass front.
    float bars = glassy ? step(0.04, fract(inWindow.x * 2.0)) * step(0.05, fract(inWindow.y * 1.0 + 0.5)) : 1.0;

    // What the glass shows of the sky, more the more it is seen edge-on.
    vec3 bounce = reflect(view, n);
    float fresnel = 0.05 + 0.95 * pow(1.0 - clamp(dot(-view, n), 0.0, 1.0), 4.0);
    vec3 sky = mix(uHorizon, uZenith, clamp(bounce.y * 1.4 + 0.15, 0.0, 1.0));
    sky += uSunColor * pow(max(dot(bounce, uSunDir), 0.0), 90.0) * 6.0 * uSunUp;
    vec3 dark = room * 0.05 * (0.4 + 0.6 * dot(uHorizon, vec3(0.33)));
    evoWallGlow = room * tint * lamp * strength * on * bars * (1.0 - fresnel * 0.5);
    evoWallRough = 0.08;
    evoWallHeight = 0.0;
    return mix(dark, sky, clamp(fresnel * 0.85 + 0.1, 0.0, 1.0)) * mix(0.12, 1.0, bars);
  }
`

const STREET_FRAG = /* glsl */ `
  uniform float uLamps;
  uniform float uCity;
  uniform vec3 uLight;
  uniform vec3 uAmbient;
  uniform float uTime;
  varying vec3 vWorld;
  ${EVO_NOISE}

  const float STREET_Z = ${STREET_Z.toFixed(2)};
  const float ROAD = ${ROAD.toFixed(2)};
  const float PAVEMENT = ${PAVEMENT.toFixed(2)};
  const float GAP = ${LAMP_GAP.toFixed(2)};
  const float HIGH = ${LAMP_HEIGHT.toFixed(2)};

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

  // One lamp's light on the ground: what falls on it, and what a wet patch throws back.
  vec3 lampOn(vec3 at, vec3 n, vec3 view, vec3 lamp, float gloss) {
    vec3 to = lamp - at;
    float d2 = dot(to, to);
    vec3 l = to * inversesqrt(d2);
    float fall = max(dot(n, l), 0.0) / d2;
    vec3 h = normalize(l - view);
    float spec = pow(max(dot(n, h), 0.0), mix(24.0, 380.0, gloss)) * mix(0.25, 9.0, gloss) / (1.0 + d2 * 0.012);
    return vec3(1.0, 0.78, 0.5) * (fall * 62.0 + spec);
  }

  void main() {
    vec3 at = vWorld;
    float across = at.z - STREET_Z;
    float n1 = evoNoise(at.xz * 0.9);
    // Laid from the near end, a ragged edge of it going on ahead.
    if (at.x > ${(CITY.from - 14).toFixed(1)} + uCity * 1.45 * ${(CITY.until - CITY.from + 30).toFixed(1)} + (n1 - 0.5) * 7.0) discard;
    float n2 = evoNoise(at.xz * 6.0);
    float n3 = evoFbm(at.xz * 0.11);
    bool road = abs(across) < ROAD;

    vec3 color;
    float gloss;
    if (road) {
      // Asphalt, worn paler where the wheels go, with its paint.
      color = lin(vec3(0.25, 0.25, 0.265)) * (0.8 + 0.3 * n2 + 0.25 * n1);
      float lane = abs(fract(across / 3.5) - 0.5) * 3.5;
      color *= 1.0 + 0.2 * smoothstep(1.3, 0.4, abs(lane - 0.85));
      float dash = step(0.55, fract(at.x / 9.0));
      float centre = 1.0 - smoothstep(0.07, 0.11, abs(abs(across) - 0.16));
      float between = (1.0 - smoothstep(0.06, 0.1, abs(abs(across) - 3.5))) * dash;
      float edge = 1.0 - smoothstep(0.07, 0.11, abs(abs(across) - (ROAD - 0.45)));
      float paint = max(max(centre, between), edge) * (0.55 + 0.45 * n2);
      color = mix(color, lin(vec3(0.74, 0.72, 0.64)), paint * 0.85);
      // Puddles in the low places.
      gloss = smoothstep(0.52, 0.72, n3 + n1 * 0.12) * 0.9 + 0.12;
    } else {
      // Paving: slabs, with a kerb where it meets the road.
      vec2 slab = at.xz / vec2(0.9, 0.6);
      float joint = max(step(0.955, fract(slab.x + floor(slab.y) * 0.5)), step(0.94, fract(slab.y)));
      color = lin(vec3(0.36, 0.35, 0.34)) * (0.82 + 0.3 * evoHash(floor(vec2(slab.x + floor(slab.y) * 0.5, slab.y)))) * (1.0 - 0.35 * joint);
      float kerb = 1.0 - smoothstep(0.0, 0.32, abs(across) - ROAD);
      color = mix(color, lin(vec3(0.5, 0.5, 0.48)), kerb);
      gloss = smoothstep(0.6, 0.8, n3) * 0.5 + 0.05;
    }

    vec3 normal = normalize(vec3((n2 - 0.5) * 0.1 * (1.0 - gloss), 1.0, (evoNoise(at.xz * 6.0 + 31.0) - 0.5) * 0.1 * (1.0 - gloss)));
    vec3 view = normalize(at - cameraPosition);

    // Daylight, such as there is.
    vec3 lit = color * (uAmbient + uLight * max(dot(normal, uSunDir), 0.0));
    vec3 hSun = normalize(uSunDir - view);
    lit += uLight * pow(max(dot(normal, hSun), 0.0), mix(30.0, 300.0, gloss)) * gloss * 0.6;

    // The lamps: the two nearest either side, on both kerbs.
    if (uLamps > 0.001) {
      vec3 glow = vec3(0.0);
      float nearest = floor(at.x / GAP + 0.5) * GAP;
      for (int i = -1; i <= 1; i++) {
        float lx = nearest + float(i) * GAP;
        glow += lampOn(at, normal, view, vec3(lx, HIGH, STREET_Z - ROAD + 0.9), gloss);
        glow += lampOn(at, normal, view, vec3(lx + GAP * 0.5, HIGH, STREET_Z + ROAD - 0.9), gloss);
      }
      // And what spills out of the shop fronts onto the pavement.
      float spill = (1.0 - smoothstep(0.0, 3.8, ROAD + PAVEMENT - abs(across))) * (0.6 + 0.4 * evoNoise(vec2(at.x * 0.16, sign(across) * 7.0)));
      glow += vec3(1.0, 0.8, 0.58) * spill * 0.5;
      lit += color * glow * uLamps * 0.42 + glow * gloss * uLamps * 0.012;
    }

    gl_FragColor = vec4(evoAir(lit), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface CityOptions {
  bump: number
  shadows: boolean
  /** How many cars, and whether rooms are drawn behind the windows. */
  cars: number
}

export function createCity(air: Air, options: CityOptions): Part {
  const root = new Group()
  const disposers: (() => void)[] = []
  const blocks = towers()
  const shared = { uCity: { value: 0 }, uLamps: { value: 0 }, uTime: { value: 0 } }

  // ---- buildings -----------------------------------------------------------
  const box = new BoxGeometry(1, 1, 1)
  box.translate(0, 0.5, 0)
  const sizes = new Float32Array(blocks.length * 3)
  const looks = new Float32Array(blocks.length * 4)
  blocks.forEach((b, i) => {
    sizes.set([b.w, b.h - b.base, b.d], i * 3)
    looks.set([b.seed, b.style, b.delay, b.base], i * 4)
  })
  box.setAttribute('aSize', new InstancedBufferAttribute(sizes, 3))
  box.setAttribute('aLook', new InstancedBufferAttribute(looks, 4))
  const wall = inAir(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 }), air, 'city', (shader) => {
    Object.assign(shader.uniforms, shared, {
      uZenith: air.uZenith,
      uHorizon: air.uHorizon,
      uSunColor: air.uSunColor,
      uSunUp: air.uSunUp,
      uBump: { value: options.bump },
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${BUILDING_VERT_PARS}`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        // Up out of the ground on its own beat: the floors stay where they
        // are and the roof goes up past them.
        float evoRise = smoothstep(aLook.z, aLook.z + 0.32, uCity * 1.32);
        evoRise = evoRise * evoRise * (3.0 - 2.0 * evoRise);
        vec3 transformed = vec3(position.x, position.y * evoRise, position.z);
        vFacade = vec3(position.x * aSize.x, aLook.w + position.y * aSize.y * evoRise, position.z * aSize.z);
        vFaceNormal = normal;
        vLook = aLook;
        vSize = vec3(aSize.x, aLook.w + aSize.y * evoRise, aSize.z);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${BUILDING_FRAG_PARS}`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = evoWall(vEvoWorld, normalize(vFaceNormal), normalize(vEvoWorld - cameraPosition));',
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = evoWallRough;')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = evoBump(-vViewPosition, normal, evoWallHeight, uBump * 0.6 * (1.0 - smoothstep(20.0, 90.0, length(vViewPosition))));',
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += evoWallGlow;')
  })
  const buildings = new InstancedMesh(box, wall, blocks.length)
  const dummy = new Object3D()
  blocks.forEach((b, i) => {
    dummy.position.set(b.x, b.base, b.z)
    dummy.scale.set(b.w, b.h - b.base, b.d)
    dummy.updateMatrix()
    buildings.setMatrixAt(i, dummy.matrix)
  })
  buildings.instanceMatrix.needsUpdate = true
  buildings.frustumCulled = false
  buildings.castShadow = options.shadows
  buildings.receiveShadow = options.shadows
  root.add(buildings)
  disposers.push(
    () => box.dispose(),
    () => wall.dispose(),
  )

  // ---- the street ----------------------------------------------------------
  const length = CITY.until - CITY.from + 30
  const streetGeometry = new PlaneGeometry(length, (ROAD + PAVEMENT) * 2, 1, 1)
  streetGeometry.rotateX(-Math.PI / 2)
  const streetMaterial = new ShaderMaterial({
    uniforms: {
      ...shared,
      uHaze: air.uHaze,
      uGlow: air.uGlow,
      uSunDir: air.uSunDir,
      uAir: air.uAir,
      uLight: { value: new Color() },
      uAmbient: { value: new Color() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vEvoWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vEvoWorld = vWorld;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: `${AIR_PARS}\n${STREET_FRAG}`,
  })
  const street = new Mesh(streetGeometry, streetMaterial)
  street.position.set(CITY.from + length / 2 - 12, 0.06, STREET_Z)
  street.frustumCulled = false
  root.add(street)
  disposers.push(
    () => streetGeometry.dispose(),
    () => streetMaterial.dispose(),
  )

  // ---- lamps ---------------------------------------------------------------
  const lampCount = Math.floor(length / LAMP_GAP) * 2
  const poleGeometry = new CylinderGeometry(0.07, 0.1, LAMP_HEIGHT, 6)
  poleGeometry.translate(0, LAMP_HEIGHT / 2, 0)
  const poleMaterial = inAir(new MeshStandardMaterial({ color: '#2a2c30', roughness: 0.6, metalness: 0.4 }), air, 'pole')
  const poles = new InstancedMesh(poleGeometry, poleMaterial, lampCount)
  const headGeometry = new SphereGeometry(0.2, 10, 8)
  const headMaterial = new MeshBasicMaterial({ color: '#ffffff' })
  const heads = new InstancedMesh(headGeometry, headMaterial, lampCount)
  let lamp = 0
  for (let x = Math.ceil(CITY.from / LAMP_GAP) * LAMP_GAP; x < CITY.until && lamp < lampCount - 1; x += LAMP_GAP) {
    for (const far of [true, false]) {
      const z = far ? STREET_Z - ROAD - 0.5 : STREET_Z + ROAD + 0.5
      const lx = far ? x : x + LAMP_GAP * 0.5
      dummy.position.set(lx, 0, z)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      poles.setMatrixAt(lamp, dummy.matrix)
      dummy.position.set(lx, LAMP_HEIGHT, far ? z + 1.4 : z - 1.4)
      dummy.scale.set(1.5, 0.6, 1.5)
      dummy.updateMatrix()
      heads.setMatrixAt(lamp, dummy.matrix)
      lamp++
    }
  }
  // The arm that holds each lamp out over the road.
  const armGeometry = new BoxGeometry(0.07, 0.07, 1.5)
  const arms = new InstancedMesh(armGeometry, poleMaterial, lampCount)
  for (let i = 0; i < lamp; i++) {
    heads.getMatrixAt(i, dummy.matrix)
    dummy.position.setFromMatrixPosition(dummy.matrix)
    const towardsRoad = dummy.position.z > STREET_Z ? 1 : -1
    dummy.position.z += towardsRoad * 0.7
    dummy.position.y += 0.06
    dummy.scale.set(1, 1, 1)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    arms.setMatrixAt(i, dummy.matrix)
  }
  arms.count = lamp
  arms.frustumCulled = false
  root.add(arms)
  disposers.push(() => armGeometry.dispose())
  poles.count = lamp
  heads.count = lamp
  poles.frustumCulled = false
  heads.frustumCulled = false
  root.add(poles, heads)
  disposers.push(
    () => poleGeometry.dispose(),
    () => poleMaterial.dispose(),
    () => headGeometry.dispose(),
    () => headMaterial.dispose(),
  )

  // ---- traffic -------------------------------------------------------------
  const CARS = options.cars
  const { body: bodyGeometry, dark: cabinGeometry } = carGeometry()
  const paint = inAir(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.25 }), air, 'car')
  const glass = inAir(new MeshStandardMaterial({ color: '#0b0d11', roughness: 0.12, metalness: 0.4 }), air, 'carglass')
  const bodies = new InstancedMesh(bodyGeometry, paint, Math.max(1, CARS))
  const cabins = new InstancedMesh(cabinGeometry, glass, Math.max(1, CARS))
  const lightGeometry = new BoxGeometry(0.08, 0.16, 0.34)
  const headlightMaterial = new MeshBasicMaterial({ color: '#fff4d6' })
  const taillightMaterial = new MeshBasicMaterial({ color: '#ff1d0a' })
  const headlights = new InstancedMesh(lightGeometry, headlightMaterial, Math.max(1, CARS * 2))
  const taillights = new InstancedMesh(lightGeometry, taillightMaterial, Math.max(1, CARS * 2))
  // What the headlights throw on the road ahead: a soft cone, added to it.
  const beamGeometry = new BufferGeometry()
  beamGeometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, -1.1, 15, 0, -3.4, 15, 0, 3.4, 0, 0, 1.1]), 3))
  beamGeometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
  beamGeometry.setIndex([0, 2, 1, 0, 3, 2])
  const beamMaterial = new ShaderMaterial({
    uniforms: { uLamps: shared.uLamps },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLamps;
      varying vec2 vUv;
      void main() {
        float along = vUv.x;
        float across = abs(vUv.y - 0.5) * 2.0;
        float beam = (1.0 - smoothstep(0.0, 1.0, along)) * (1.0 - smoothstep(0.2, 1.0, across)) * smoothstep(0.0, 0.06, along);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * beam * 0.55 * uLamps, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  })
  const beams = new InstancedMesh(beamGeometry, beamMaterial, Math.max(1, CARS))
  for (const mesh of [bodies, cabins, headlights, taillights, beams]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = CARS
    root.add(mesh)
  }
  headlights.count = CARS * 2
  taillights.count = CARS * 2
  bodies.castShadow = options.shadows
  beams.renderOrder = 4
  const PAINTS = ['#b9bcc2', '#1a1c20', '#e9e7e2', '#7a1c18', '#1f3a5c', '#4a4d52', '#c7a23a', '#2e4a3a']
  const tint = new Color()
  const fleet = Array.from({ length: CARS }, (_, i) => {
    const lane = i % 4
    // Two lanes each way; the far pair comes towards the walk, the near pair goes with it.
    const z = STREET_Z + [-5.25, -1.75, 1.75, 5.25][lane]!
    const going = lane < 2 ? -1 : 1
    bodies.setColorAt(i, tint.set(PAINTS[Math.floor(hash2(i, 61) * PAINTS.length)] ?? '#888888'))
    return { z, going, speed: 9 + hash2(i, 67) * 6, start: hash2(i, 71) * length }
  })
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true
  disposers.push(
    () => bodyGeometry.dispose(),
    () => cabinGeometry.dispose(),
    () => paint.dispose(),
    () => glass.dispose(),
    () => lightGeometry.dispose(),
    () => headlightMaterial.dispose(),
    () => taillightMaterial.dispose(),
    () => beamGeometry.dispose(),
    () => beamMaterial.dispose(),
  )

  const m = new Matrix4()

  function update(beat: Beat): void {
    const seen = beat.stage.city > 0.001
    root.visible = seen
    if (!seen) return
    shared.uCity.value = beat.stage.city
    shared.uLamps.value = beat.lamps
    shared.uTime.value = beat.t
    const uniforms = streetMaterial.uniforms as { uLight: { value: Color }; uAmbient: { value: Color } }
    uniforms.uLight.value.copy(beat.light)
    uniforms.uAmbient.value.copy(beat.ambient)
    // The street is laid as the first fronts go up, and the lamps and the
    // traffic come with it.
    const open = Math.min(1, Math.max(0, (beat.stage.city - 0.55) / 0.3))
    street.visible = beat.stage.city > 0.02
    poles.visible = open > 0
    heads.visible = open > 0
    arms.visible = open > 0
    headMaterial.color.setRGB(1, 0.82, 0.55).multiplyScalar(0.25 + 5 * beat.lamps)
    const traffic = open > 0.5
    for (const mesh of [bodies, cabins, headlights, taillights, beams]) mesh.visible = traffic
    beams.visible = traffic && beat.lamps > 0.05
    if (!traffic) return
    const from = CITY.from - 8
    fleet.forEach((car, i) => {
      const run = (((car.start + beat.t * car.speed) % length) + length) % length
      const x = car.going > 0 ? from + run : from + length - run
      dummy.position.set(x, 0.07, car.z)
      dummy.rotation.set(0, car.going > 0 ? 0 : Math.PI, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      bodies.setMatrixAt(i, dummy.matrix)
      cabins.setMatrixAt(i, dummy.matrix)
      beams.setMatrixAt(i, m.copy(dummy.matrix).multiply(BEAM_AT))
      for (const side of [0, 1]) {
        headlights.setMatrixAt(i * 2 + side, m.copy(dummy.matrix).multiply(LIGHT_AT[side]!))
        taillights.setMatrixAt(i * 2 + side, m.copy(dummy.matrix).multiply(LIGHT_AT[2 + side]!))
      }
    })
    for (const mesh of [bodies, cabins, headlights, taillights, beams]) mesh.instanceMatrix.needsUpdate = true
    headlightMaterial.color.setRGB(1, 0.95, 0.82).multiplyScalar(0.8 + 5 * beat.lamps)
    taillightMaterial.color.setRGB(1, 0.1, 0.04).multiplyScalar(0.7 + 3 * beat.lamps)
  }

  return {
    object: root,
    update,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}

/** Where a car's lights are on it: two at the front, two at the back. */
const LIGHT_AT = [
  new Matrix4().makeTranslation(2.16, 0.68, 0.62),
  new Matrix4().makeTranslation(2.16, 0.68, -0.62),
  new Matrix4().makeTranslation(-2.16, 0.74, 0.64),
  new Matrix4().makeTranslation(-2.16, 0.74, -0.64),
]
const BEAM_AT = new Matrix4().makeTranslation(2.3, 0.03, 0)

/**
 * A car: its side view pushed out sideways into a body, and the dark things on
 * it — glass, and four wheels — as a second mesh in the same place.
 */
function carGeometry(): { body: BufferGeometry; dark: BufferGeometry } {
  // Clockwise from the back bumper: boot, rear glass, roof, windscreen, bonnet, nose.
  const outline: [number, number][] = [
    [-2.15, 0.3],
    [-2.17, 0.8],
    [-1.75, 0.9],
    [-1.3, 0.95],
    [-0.72, 1.36],
    [0.38, 1.39],
    [1.08, 0.98],
    [2.0, 0.85],
    [2.17, 0.62],
    [2.15, 0.3],
  ]
  const half = 0.9
  const flat = (triangles: number[]): BufferGeometry => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(triangles), 3))
    geometry.computeVertexNormals()
    return geometry
  }
  const body: number[] = []
  const hub: [number, number] = [0, 0.75]
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    // The two sides, as a fan round the middle, and the skin between them.
    body.push(hub[0], hub[1], half, b[0], b[1], half, a[0], a[1], half)
    body.push(hub[0], hub[1], -half, a[0], a[1], -half, b[0], b[1], -half)
    body.push(a[0], a[1], half, b[0], b[1], half, b[0], b[1], -half)
    body.push(a[0], a[1], half, b[0], b[1], -half, a[0], a[1], -half)
  })
  const dark: number[] = []
  const quad = (p: [number, number, number][]) => {
    const [a, b, c, d] = p as [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
    dark.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  // Side glass, a hair outside the body, and the two screens on their slopes.
  for (const side of [1, -1]) {
    const z = side * (half + 0.012)
    const pane: [number, number, number][] = [
      [-1.18, 0.98, z],
      [0.98, 0.99, z],
      [0.36, 1.32, z],
      [-0.7, 1.3, z],
    ]
    quad(side > 0 ? pane : [...pane].reverse())
  }
  quad([
    [1.1, 1.0, 0.8],
    [1.1, 1.0, -0.8],
    [0.42, 1.38, -0.74],
    [0.42, 1.38, 0.74],
  ])
  quad([
    [-0.76, 1.35, 0.74],
    [-0.76, 1.35, -0.74],
    [-1.3, 0.98, -0.8],
    [-1.3, 0.98, 0.8],
  ])
  const glass = flat(dark)
  // Wheels: four short drums.
  const wheels: BufferGeometry[] = []
  for (const x of [-1.36, 1.38]) {
    for (const z of [-0.8, 0.8]) {
      const wheel = new CylinderGeometry(0.33, 0.33, 0.24, 12)
      wheel.rotateX(Math.PI / 2)
      wheel.translate(x, 0.33, z)
      wheels.push(wheel.toNonIndexed())
      wheel.dispose()
    }
  }
  const all: number[] = [...(glass.getAttribute('position').array as Float32Array)]
  for (const wheel of wheels) {
    all.push(...(wheel.getAttribute('position').array as Float32Array))
    wheel.dispose()
  }
  glass.dispose()
  return { body: flat(body), dark: flat(all) }
}
