import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
} from 'three'
import { AIR_PARS, EVO_NOISE, PARS_HERE, inAir, ownShadow, type Air } from './evoAir'
import { PLACE, hash2 } from './evoLand'
import {
  CITY_LIGHT_GLSL,
  CROSSINGS,
  CROSSWALK,
  FOUNTAIN,
  FRONT_FAR,
  FRONT_NEAR,
  HOTEL,
  LAMP_GAP,
  LAMP_HEIGHT,
  LANTERNS,
  LANTERN_HEIGHT,
  LAWNS,
  MOSQUE,
  PAVED_FROM,
  PAVEMENT,
  PLAZA,
  ROAD,
  STREET_GLSL,
  STREET_LENGTH,
  STREET_Z,
  TOWER_SEEN_FROM,
  TV_TOWER,
} from './evoStreet'
import { ARIQ, ariqSlabs, type AriqSlab, type FrontBlock } from './evoStreet'
import { SUN_SHADOW_GLSL, createSunShadow } from './evoSunShadow'
import { BUMP, LIN } from './evoMaterials'
import { BRICK, PANEL, RENDER, SHOP, STYLE, type Tower } from './evoFacade'
import { createRelief } from './evoRelief'
import { SIGN_GRID, makeSigns } from './evoSigns'
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

export { STYLE, type Tower } from './evoFacade'

const inCrossing = (x: number) => CROSSINGS.some((c) => Math.abs(x - c) < 7)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Whether a block would stand between the near pavement and the tower: the
 * square is there to be looked across, and what is looked at across it is the
 * tower, legs and all.
 */
export function beforeTheTower(x: number, z: number, reach: number): boolean {
  for (const from of [TOWER_SEEN_FROM.x0, (TOWER_SEEN_FROM.x0 + TOWER_SEEN_FROM.x1) / 2, TOWER_SEEN_FROM.x1]) {
    const ax = TV_TOWER.x - from
    const az = TV_TOWER.z - TOWER_SEEN_FROM.z
    const length = Math.hypot(ax, az)
    const along = ((x - from) * ax + (z - TOWER_SEEN_FROM.z) * az) / length
    if (along <= 0 || along >= length) continue
    const aside = Math.abs((x - from) * az - (z - TOWER_SEEN_FROM.z) * ax) / length
    // The tower's legs stand wide: a twentieth of the way to it either side.
    if (aside < reach + 4 + along * 0.062) return true
  }
  return false
}

/** The city's blocks, the same every visit. */
export function towers(): Tower[] {
  const out: Tower[] = []
  const delayAt = (x: number, n: number, salt: number) =>
    0.05 + 0.6 * clamp01((x - CITY.from) / 330) * (0.6 + 0.4 * hash2(n, salt + 23)) + 0.12 * hash2(n, salt + 29)

  // Tashkent is not a tall city: four to nine floors on a street, nine to
  // sixteen behind, and its towers all in one place.
  const heightOf = (style: number, pick: number, back: boolean): number => {
    if (style === STYLE.brick) return 4.6 + (back ? 5 : 4 + Math.floor(pick * 2)) * 3.5 + 1.8
    if (style === STYLE.render) return 4.4 + (back ? 12 + Math.floor(pick * 5) : 9 + Math.floor(pick * 4)) * 3.0 + 1.4
    return 4.4 + (back ? 9 + Math.floor(pick * 4) : pick < 0.55 ? 5 : 9) * 2.9 + 1.2
  }

  const row = (front: number, side: 1 | -1, depthFrom: number, depthTo: number, back: boolean, gapChance: number, salt: number, kept: readonly (readonly [number, number])[]) => {
    let x = CITY.from + 5
    let n = 0
    while (x < CITY.until - 20) {
      const seed = hash2(n * 7 + salt, salt * 13 + 1)
      let w = 14 + hash2(n, salt + 3) * 16
      let d = depthFrom + hash2(n, salt + 5) * (depthTo - depthFrom)
      // Stepped past whatever ground is kept clear: the square, the hotel.
      const clear = kept.find(([a, b]) => x < b && x + w > a)
      if (clear) {
        x = clear[1] + 1
        continue
      }
      // The studio's building is placed, not rolled: its window has to be where the walk ends.
      const studio = salt === 1 && x <= PLACE.studio.x - 6 && x + w >= PLACE.studio.x - 6
      if (studio) {
        w = PLACE.studio.x + 9 - x
        // No deeper than it has to be: its back corner is what the tower goes behind.
        d = depthFrom
      }
      if (inCrossing(x) || inCrossing(x + w)) {
        x += 3
        continue
      }
      if (hash2(n, salt + 9) < gapChance || studio) {
        const roll = hash2(n, salt + 17)
        const style = studio ? STYLE.panel : back ? (roll < 0.55 ? STYLE.panel : STYLE.render) : roll < 0.46 ? STYLE.panel : roll < 0.78 ? STYLE.brick : STYLE.render
        const z = front + (side * d) / 2
        const h = heightOf(style, hash2(n, salt + 11), back)
        if (back && side < 0 && beforeTheTower(x + w / 2, z, Math.hypot(w, d) / 2)) {
          x += w
          n++
          continue
        }
        out.push({
          x: x + w / 2,
          z,
          w: w - 0.6,
          d,
          h: studio ? Math.max(30, h) : h,
          seed,
          style,
          delay: delayAt(x, n, salt),
          base: studio ? STUDIO.height + 0.35 : 0,
          yaw: 0,
          shops: !back,
        })
      }
      x += w + (hash2(n, salt + 31) < 0.16 ? 4 : 0)
      n++
    }
  }

  const square: readonly [number, number] = [PLAZA.x0 - 1.5, PLAZA.x1 + 1.5]
  const hotel: readonly [number, number] = [HOTEL.x - HOTEL.length / 2 - 4, HOTEL.x + HOTEL.length / 2 + 4]
  // The fronts on the street, then a rank behind each, taller.
  row(FRONT_FAR, -1, 15, 22, false, 1, 1, [square, hotel])
  row(FRONT_NEAR, 1, 15, 22, false, 1, 2, [])
  row(FRONT_FAR - 34, -1, 16, 24, true, 0.7, 3, [[square[0] - 10, square[1] + 10]])
  row(FRONT_NEAR + 34, 1, 16, 24, true, 0.62, 5, [])

  // The hotel: a middle and two wings, each turned a little further in.
  for (const k of [-1, 0, 1]) {
    const third = HOTEL.length / 3
    out.push({
      x: HOTEL.x + k * third * Math.cos(HOTEL.bend * 0.5),
      z: HOTEL.z + Math.abs(k) * third * Math.sin(HOTEL.bend) * 0.5,
      w: third + (k === 0 ? 0 : 0.8),
      d: HOTEL.depth,
      h: HOTEL.height,
      seed: 0.37,
      style: STYLE.lattice,
      delay: 0.52,
      base: 0,
      yaw: -k * HOTEL.bend,
      shops: false,
      part: 'hotel',
    })
  }

  // The towers, all together at the far end of the avenue.
  const glass: readonly [number, number, number, number, number, number][] = [
    [640, -50, 30, 30, 128, STYLE.glass],
    [676, 40, 34, 28, 150, STYLE.glass],
    [800, -44, 38, 38, 215, STYLE.crown],
    [742, 46, 28, 30, 104, STYLE.glass],
    [860, 34, 30, 40, 168, STYLE.glass],
    [704, -92, 26, 26, 92, STYLE.render],
    [628, 92, 26, 26, 84, STYLE.render],
  ]
  glass.forEach(([x, z, w, d, h, style], n) => {
    out.push({ x, z, w, d, h, seed: hash2(n, 91), style, delay: 0.5 + 0.3 * hash2(n, 93), base: 0, yaw: 0, shops: false })
  })
  return out
}

/** The room at the end of the walk: how big it is, and where its glass is. */
export const STUDIO = { width: 7.6, height: 3.5, depth: 5.2 } as const

const BUILDING_VERT_PARS = /* glsl */ `
  attribute vec3 aSize;
  attribute vec4 aLook;
  attribute vec2 aMore;
  uniform float uCity;
  varying vec3 vFacade;
  varying vec3 vFaceNormal;
  varying vec4 vLook;
  varying vec3 vSize;
  varying vec2 vMore;
`

/**
 * The walls. A building is a box, and everything that makes it a building of
 * a particular kind is worked out for each pixel of it from where on the box
 * the pixel is: which bay and which floor, and what a block of that kind has
 * there. Openings are not painted on — the ray from the eye is carried on
 * through them (\`evoInto\`) to whatever it would meet inside: the back of a
 * room, the side wall of a loggia, the dark behind a cast screen.
 */
const BUILDING_FRAG_PARS = /* glsl */ `
  uniform float uLamps;
  uniform float uTime;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform float uSunUp;
  uniform float uBump;
  uniform sampler2D uSigns;
  uniform vec2 uSignGrid;
  varying vec3 vFacade;
  varying vec3 vFaceNormal;
  varying vec4 vLook;
  varying vec3 vSize;
  varying vec2 vMore;
  ${EVO_NOISE}
  ${LIN}
  ${BUMP}
  ${STREET_GLSL}

  float evoWallRough;
  float evoWallHeight;
  vec3 evoWallGlow;

  // One side of a building, where this pixel is on it, and how it is seen.
  struct EvoFace {
    // Metres along the wall and up it; how long the wall is, and how high.
    float u;
    float v;
    float span;
    float top;
    // The view, with z going into the wall; the wall's own normal; the view and the place in the world.
    vec3 dir;
    vec3 n;
    vec3 view;
    vec3 world;
    float seed;
    // Whether it faces the street, is a short end of its block, and runs right to left as it is read.
    bool street;
    bool end;
    bool flip;
    // How much of the wall a pixel covers here, for whatever is drawn finer than that.
    float aa;
  };

  vec3 evoSkyIn(vec3 dir) {
    vec3 sky = mix(uHorizon, uZenith, clamp(dir.y * 1.4 + 0.15, 0.0, 1.0));
    return sky + uSunColor * pow(max(dot(dir, uSunDir), 0.0), 90.0) * 6.0 * uSunUp;
  }

  // After dark the street lights the bottom of every wall, and less of it higher up.
  vec3 evoWash(vec3 wall, float v) {
    return wall * vec3(1.0, 0.74, 0.46) * uLamps * (exp(-v / 6.5) * 0.5 + 0.018);
  }

  // Glass: what is behind it, and over that what it shows of the sky — more
  // the more it is seen edge-on. Whatever is glowing behind it is dimmed to match.
  vec3 evoGlassOf(EvoFace f, vec3 behind, float mirror) {
    float fresnel = 0.05 + 0.95 * pow(1.0 - clamp(dot(-f.view, f.n), 0.0, 1.0), 4.0);
    float shown = clamp(fresnel * 0.85 + mirror, 0.0, 1.0);
    evoWallGlow *= 1.0 - shown * 0.5;
    evoWallRough = 0.08;
    evoWallHeight = 0.0;
    return mix(behind, evoSkyIn(reflect(f.view, f.n)), shown);
  }
  vec3 evoGlass(EvoFace f, vec3 behind) {
    return evoGlassOf(f, behind, 0.1);
  }

  // Through an opening and on into the box behind it: 'at' is where on the
  // opening (0..1), 'extent' the box's half sizes. Gives where the ray ends
  // (-1..1 each way, z from the opening to the back) and on which face.
  void evoInto(vec2 at, vec3 dir, vec3 extent, out vec3 p, out float back, out float updown) {
    vec3 o = vec3(at * 2.0 - 1.0, -1.0);
    vec3 d = dir / extent;
    vec3 inv = 1.0 / (d + vec3(1e-5));
    vec3 k = abs(inv) - o * inv;
    float t = min(min(k.x, k.y), k.z);
    p = o + d * t;
    back = step(k.z, min(k.x, k.y));
    updown = step(k.y, min(k.x, k.z)) * (1.0 - back);
  }

  // The inside of a room, from outside it: a wall colour, a darker floor, a
  // pale ceiling with the light on it, something on the back wall.
  vec3 evoRoom(vec2 at, vec3 dir, vec3 extent, float seed, out float lamp) {
    vec3 p;
    float back;
    float updown;
    evoInto(at, dir, extent, p, back, updown);
    vec3 wall = mix(vec3(0.62, 0.56, 0.46), vec3(0.42, 0.5, 0.58), step(0.6, fract(seed * 7.3)));
    wall = mix(wall, vec3(0.66, 0.42, 0.34), step(0.82, fract(seed * 3.1)));
    vec3 color = wall * (0.55 + 0.25 * back);
    color = mix(color, p.y > 0.0 ? vec3(0.86, 0.84, 0.8) : vec3(0.2, 0.16, 0.13), updown);
    float thing = step(0.5, evoHash(floor(p.xy * vec2(2.0, 1.5)) + seed * 91.0)) * back * step(p.y, 0.25);
    color = mix(color, color * 0.45, thing);
    float depth = clamp((p.z + 1.0) * 0.5, 0.0, 1.0);
    lamp = (1.0 - 0.55 * depth) * (0.75 + 0.5 * smoothstep(-1.0, 1.0, p.y));
    return color;
  }

  // Whether the lights are on in the room with this number, by now: they come
  // on one at a time as it gets dark, and some never do.
  float evoLit(vec2 id, float share) {
    return step(evoHash(id + 13.0) * 0.92 + 0.04, uLamps) * step(evoHash(id), share);
  }

  // The colour of a lamp behind a window: most of them warm.
  vec3 evoBulb(float pick) {
    vec3 tint = mix(vec3(1.0, 0.72, 0.42), vec3(0.72, 0.84, 1.0), step(0.78, fract(pick * 9.1)));
    return mix(tint, vec3(1.0, 0.86, 0.66), step(0.55, fract(pick * 4.3)));
  }

  // And in some rooms the only light is the television: blue, and never still.
  vec3 evoTelly(vec2 id, vec3 bulb) {
    float tv = step(evoHash(id + 23.0), 0.13);
    float flicker = 0.62 + 0.38 * (0.5 + 0.5 * sin(uTime * 7.3 + id.x * 13.0)) * (0.55 + 0.45 * sin(uTime * 2.1 + id.y * 7.0));
    return mix(bulb, vec3(0.42, 0.6, 1.0) * flicker * 0.75, tv);
  }

  // The colour a block's balconies are painted: every block its own, out of a
  // handful the city uses.
  vec3 evoAccent(float seed) {
    float k = fract(seed * 13.7) * 6.0;
    vec3 c = k < 1.0 ? vec3(0.13, 0.5, 0.55) : k < 2.0 ? vec3(0.3, 0.5, 0.72) : k < 3.0 ? vec3(0.78, 0.72, 0.55) : k < 4.0 ? vec3(0.42, 0.6, 0.48) : k < 5.0 ? vec3(0.68, 0.4, 0.28) : vec3(0.82, 0.82, 0.8);
    return evoLin(c);
  }

  // A screen of concrete cast in a pattern, of the kind that stands in front
  // of a stair or a balcony all over Tashkent: how much of this spot is concrete.
  float evoScreen(vec2 p, float kind, float aa) {
    vec2 q = abs(fract(p) - 0.5);
    float d = kind < 0.5
      ? min(abs(q.x + q.y - 0.5), abs(max(q.x, q.y) - 0.2)) - 0.055
      : min(abs(max(q.x, q.y) - 0.33), abs((q.x + q.y) * 0.7071 - 0.33)) - 0.05;
    return 1.0 - smoothstep(-aa, aa, d);
  }

  // How much of a thin bar is at 'x', for bars 'period' apart and 'width' thick:
  // from far off, the share of the window they cover and no sparkle.
  float evoBar(float x, float period, float width, float aa) {
    float d = abs(fract(x / period) - 0.5) * period;
    float near = 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, d);
    return mix(near, width / period, smoothstep(width * 0.5, period * 0.5, aa));
  }

  // The steel grilles over the windows of the lowest floors, all over
  // Tashkent: uprights, two rails, and a sun of bars rising from the sill.
  // 'p' is in metres from the window's bottom left, 'size' its size.
  float evoGrille(vec2 p, vec2 size, float aa) {
    float bars = evoBar(p.x, 0.13, 0.016, aa);
    bars = max(bars, evoBar(p.y - size.y * 0.33, size.y * 2.0, 0.03, aa));
    bars = max(bars, evoBar(p.y - size.y * 0.97, size.y * 2.0, 0.03, aa));
    vec2 c = p - vec2(size.x * 0.5, 0.0);
    float r = length(c);
    float arc = evoBar(r - min(size.x * 0.3, size.y * 0.3), 9.0, 0.025, aa);
    float rays = evoBar(atan(c.y, c.x) * 2.2, 0.62, 0.035, aa / max(r, 0.2)) * step(r, min(size.x * 0.3, size.y * 0.3));
    return max(bars, max(arc, rays));
  }

  // A wall of small tiles: the mosaics on the ends of the blocks. 'p' is in
  // metres from the middle of a panel 'size' across.
  vec3 evoMosaic(vec2 p, vec2 size, float seed, float aa) {
    const float TILE = 0.12;
    vec2 t = floor(p / TILE);
    float jitter = evoHash(t + seed * 17.0);
    // One colour to a tile: the pattern is asked at the tile's own middle.
    vec2 c = (t + 0.5) * TILE;
    float r = length(c * vec2(1.0, 0.86));
    float a = atan(c.y, c.x);
    vec3 turq = vec3(0.07, 0.5, 0.56);
    vec3 blue = vec3(0.07, 0.14, 0.46);
    vec3 white = vec3(0.86, 0.84, 0.76);
    vec3 ochre = vec3(0.72, 0.47, 0.12);
    vec3 clay = vec3(0.6, 0.24, 0.13);
    vec3 col;
    if (fract(seed * 3.3) < 0.5) {
      // A sun: rings, with rays between them.
      float ring = r / (min(size.x, size.y) * 0.46);
      col = ring < 0.2 ? ochre : ring < 0.3 ? white : ring < 0.62 ? (cos(a * 12.0) > 0.0 ? turq : blue) : ring < 0.72 ? white : ring < 1.0 ? (cos(a * 24.0 + 1.0) > 0.2 ? clay : ochre) : blue;
    } else {
      // Stars set in a net.
      vec2 g = abs(fract(c / 2.6) - 0.5);
      float star = min(max(g.x, g.y), (g.x + g.y) * 0.7071);
      col = star < 0.12 ? ochre : star < 0.2 ? white : star < 0.3 ? turq : (abs(g.x - g.y) < 0.05 ? white : blue);
    }
    float grout = max(step(0.9, fract(p.x / TILE)), step(0.9, fract(p.y / TILE))) * (1.0 - smoothstep(0.03, 0.1, aa));
    return evoLin(col) * (0.8 + 0.35 * jitter) * (1.0 - 0.3 * grout);
  }

  // A shop front: a board over a door and two windows, and the shop behind the glass.
  vec3 evoShop(EvoFace f, vec3 wall) {
    const float WIDE = ${SHOP.wide.toFixed(2)};
    float su = f.u / WIDE;
    float shop = floor(su);
    float sx = fract(su);
    float pick = evoHash(vec2(shop, 7.0) + f.seed * 23.0);
    evoWallGlow = evoWash(wall, f.v);
    // The pier between one shop and the next, and the step under the glass.
    if (sx < 0.035 || sx > 0.965 || f.v < 0.32) return wall * 0.85;
    // Some have their shutter down, day and night: ribbed steel, a little rust, a lock at the foot.
    if (evoHash(vec2(shop, 13.0) + f.seed * 23.0) < 0.2 && f.v < ${(SHOP.board.from - 0.1).toFixed(2)}) {
      float rib = fract(f.v / 0.075);
      float ribs = mix(0.82 + 0.3 * smoothstep(0.0, 0.5, rib) * smoothstep(1.0, 0.5, rib), 0.95, smoothstep(0.02, 0.06, f.aa));
      vec3 steel = evoLin(vec3(0.56, 0.57, 0.57)) * ribs * (0.85 + 0.25 * evoNoise(vec2(f.u * 2.3, f.v * 0.8) + pick * 40.0));
      // Rust where the rain splashes up, at the foot.
      steel = mix(steel, evoLin(vec3(0.42, 0.27, 0.17)), smoothstep(0.66, 0.84, evoNoise(vec2(f.u * 6.0, f.v * 9.0) + pick * 9.0)) * 0.4 * (1.0 - smoothstep(0.35, 1.3, f.v)));
      if (abs(sx - 0.5) < 0.02 && f.v < 0.6) steel *= 0.3;
      evoWallGlow = evoWash(steel, f.v);
      evoWallRough = 0.55;
      return steel;
    }
    if (f.v > ${(SHOP.board.from - 0.08).toFixed(2)}) {
      // The board, lit from inside once it is dusk. (\`evoRelief.ts\` stands a box of
      // light in front of it on the street; this is it from the side, and a board
      // that is not a whole shop wide.)
      vec2 suv = vec2((sx - ${SHOP.board.side.toFixed(2)}) / ${(1 - 2 * SHOP.board.side).toFixed(2)}, (f.v - ${SHOP.board.from.toFixed(2)}) / ${(SHOP.board.to - SHOP.board.from).toFixed(2)});
      if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
        if (f.flip) suv.x = 1.0 - suv.x;
        float which = floor(pick * uSignGrid.x * uSignGrid.y);
        vec2 cell = vec2(mod(which, uSignGrid.x), uSignGrid.y - 1.0 - floor(which / uSignGrid.x));
        vec3 board = texture2D(uSigns, (cell + suv) / uSignGrid).rgb;
        evoWallGlow = board * (0.1 + 2.3 * smoothstep(0.05, 0.3, uLamps));
        evoWallRough = 0.5;
        return board * 0.7;
      }
      return wall * 0.8;
    }
    // A door in the middle and a window either side, in their frames.
    bool door = sx > 0.41 && sx < 0.59;
    vec2 at = vec2(door ? (sx - 0.41) / 0.18 : sx < 0.41 ? (sx - 0.035) / 0.375 : (sx - 0.59) / 0.375, (f.v - 0.32) / 2.96);
    if (at.x < 0.04 || at.x > 0.96 || at.y > 0.97 || (door && abs(at.x - 0.5) < 0.025)) {
      evoWallGlow = vec3(0.0);
      evoWallRough = 0.4;
      return vec3(0.03);
    }
    // The shop itself: shelves of whatever it sells along the back and the
    // sides, a bright ceiling, a pale floor.
    vec3 p;
    float back;
    float updown;
    evoInto(at, f.dir, vec3(door ? 0.58 : 1.2, 1.48, 3.6), p, back, updown);
    float depth = clamp(p.z * 0.5 + 0.5, 0.0, 1.0);
    vec3 shell = mix(vec3(0.72, 0.68, 0.6), vec3(0.6, 0.66, 0.7), step(0.5, fract(pick * 5.3)));
    vec3 room = shell * (0.6 + 0.25 * back);
    if (updown > 0.5) {
      // Strip lights across the ceiling; tiles on the floor.
      room = p.y > 0.0 ? mix(vec3(0.8), vec3(2.2), step(0.8, fract(p.z * 2.0 + 0.4))) : vec3(0.45, 0.43, 0.4) * (0.85 + 0.15 * step(0.5, fract(p.x * 2.0)) * step(0.5, fract(p.z * 3.0)));
    } else {
      // Shelves: rows of things, each its own colour, with the shelf's shadow under each row.
      vec2 on = back > 0.5 ? p.xy : vec2(p.z, p.y);
      vec2 g = vec2(on.x * (back > 0.5 ? 7.0 : 16.0), on.y * 4.0 + 4.0);
      float row = fract(g.y);
      float thing = evoHash(floor(g) + pick * 91.0 + back * 7.0);
      vec3 goods = 0.35 + 0.55 * vec3(fract(thing * 3.1 + pick), fract(thing * 5.7 + pick * 2.0), fract(thing * 7.9));
      float shelved = step(-0.72, on.y) * step(on.y, 0.55) * step(0.12, row) * step(row, 0.82 - 0.3 * fract(thing * 11.0)) * step(0.1, fract(g.x)) ;
      room = mix(room, goods, shelved);
      room *= 1.0 - 0.35 * step(row, 0.12) * step(-0.72, on.y) * step(on.y, 0.55);
    }
    float lamp = (1.0 - 0.4 * depth) * (0.8 + 0.4 * smoothstep(-1.0, 1.0, p.y));
    vec3 tint = mix(vec3(1.0, 0.9, 0.76), vec3(0.86, 0.93, 1.0), step(0.6, fract(pick * 2.7)));
    evoWallGlow = room * tint * lamp * 1.55 * smoothstep(0.08, 0.3, uLamps);
    return evoGlass(f, room * 0.07 * (0.4 + 0.6 * dot(uHorizon, vec3(0.33))));
  }

  // An ordinary window, set flat in a wall: a frame, a bar down the middle, a room.
  vec3 evoWindow(EvoFace f, vec2 at, vec3 extent, vec2 id, float share, vec3 frame) {
    if (at.x < 0.05 || at.x > 0.95 || at.y < 0.04 || at.y > 0.96 || abs(at.x - 0.5) < 0.03) {
      evoWallGlow = evoWash(frame, f.v);
      evoWallRough = 0.5;
      return frame;
    }
    float pick = evoHash(id);
    float lamp;
    vec3 room = evoRoom(at, f.dir, extent, pick + f.seed, lamp);
    // Curtains part of the way across some of them.
    float drawn = 0.45 + 0.55 * step(fract(pick * 6.7) * 0.8, abs(at.x - 0.5) * 2.0 + 0.25 * step(0.5, fract(pick * 2.3)));
    evoWallGlow = room * evoTelly(id, evoBulb(pick)) * lamp * (1.3 + 1.3 * fract(pick * 3.7)) * drawn * evoLit(id, share);
    return evoGlass(f, room * 0.05 * (0.4 + 0.6 * dot(uHorizon, vec3(0.33))));
  }

  // ---- concrete panels: what most of the city was rebuilt in ----------------
  vec3 evoPanel(EvoFace f) {
    const float BAY = ${PANEL.bay.toFixed(2)};
    const float STOREY = ${PANEL.storey.toFixed(2)};
    const float GROUND = ${PANEL.ground.toFixed(2)};
    vec3 concrete = mix(evoLin(vec3(0.6, 0.58, 0.54)), evoLin(vec3(0.74, 0.7, 0.62)), fract(f.seed * 5.7));
    concrete *= (0.9 + 0.2 * evoNoise(f.world.xy * 0.6 + f.world.z * 0.6)) * (0.82 + 0.18 * evoNoise(vec2(f.u * 0.9 + f.seed * 9.0, f.v * 0.12)));
    bool shops = f.street && vMore.y > 0.5 && vLook.w < 0.5;
    if (shops && f.v < GROUND) return evoShop(f, concrete);
    // (A block lifted off the ground starts its floors above whatever it is lifted over.)
    float foot = shops ? GROUND : vLook.w + 0.7;
    float bays = max(1.0, floor(f.span / BAY));
    float bu = (f.u - (f.span - bays * BAY) * 0.5) / BAY;
    float fv = (f.v - foot) / STOREY;
    vec2 cell = vec2(fract(bu), fract(fv));
    float column = floor(bu);
    float level = floor(fv);
    bool grid = bu >= 0.0 && bu < bays && fv >= 0.0 && f.v < f.top - 1.1;
    // Panels: a joint every bay and every floor, each panel cast a shade of its own.
    float joint = min(1.0, max(step(0.985, cell.x) + step(cell.x, 0.015), step(0.975, cell.y)));
    vec3 wall = concrete * (1.0 - 0.3 * joint);
    if (grid) wall *= 0.95 + 0.1 * evoHash(vec2(column, level) + f.seed * 71.0);
    // Forty summers on it: darker at the foot, where the dust is thrown up,
    // and along the top, where the roof's water runs over.
    wall *= 1.0 - 0.18 * (1.0 - smoothstep(foot, foot + 2.2, f.v)) - 0.14 * smoothstep(f.top - 3.5, f.top, f.v) * (0.6 + 0.4 * evoNoise(vec2(f.u * 1.7, 3.0)));
    evoWallHeight = 1.0 - joint;
    evoWallGlow = evoWash(wall, f.v);
    if (!grid) return wall;
    {
      // Rain down from every sill, and from under every cooler the water it
      // drips, a dark tongue over the floor below.
      float kindHere = evoHash(vec2(column, 3.0) + f.seed * 41.0);
      float streaks = 0.5 + 0.5 * evoNoise(vec2(f.u * 9.0, f.seed * 40.0));
      if (kindHere >= 0.64) {
        float under = clamp((0.2 - cell.y) * STOREY, 0.0, 2.0);
        float sill = step(0.2, cell.x) * step(cell.x, 0.8) * step(cell.y, 0.2);
        wall *= 1.0 - 0.16 * sill * exp(-under * 1.6) * streaks;
        vec2 above = vec2(column, level + 1.0) + f.seed * 57.0;
        float drips = step(evoHash(above + 9.0), 0.32) * step(level + 1.0, floor((f.top - 1.1 - foot) / STOREY) - 0.5);
        float tongue = (1.0 - smoothstep(0.03, 0.09, abs(cell.x - 0.7 + 0.02 * sin(f.v * 3.0)))) * smoothstep(0.35, 1.0, cell.y);
        float here = step(evoHash(vec2(column, level) + f.seed * 57.0 + 9.0), 0.32) * (1.0 - smoothstep(0.03, 0.09, abs(cell.x - 0.7))) * step(cell.y, 0.05);
        wall *= 1.0 - 0.38 * max(drips * tongue, here) * (0.6 + 0.4 * streaks);
      }
      evoWallGlow = evoWash(wall, f.v);
    }

    if (f.end) {
      // The end of a block has no flats looking out of it. On some of them
      // there is a mosaic the height of the building.
      vec2 size = vec2(f.span * 0.76, (f.top - foot) * 0.8);
      vec2 p = vec2(f.u - f.span * 0.5, f.v - foot - (f.top - foot) * 0.5);
      if (fract(f.seed * 7.9) < 0.62 && abs(p.x) < size.x * 0.5 && abs(p.y) < size.y * 0.5) {
        vec3 tiles = evoMosaic(p, size, f.seed, f.aa);
        evoWallGlow = evoWash(tiles, f.v) * 1.5;
        evoWallRough = 0.45;
        evoWallHeight = 0.0;
        return tiles;
      }
      return wall;
    }

    float kind = evoHash(vec2(column, 3.0) + f.seed * 41.0);
    vec2 id = vec2(column, level) + f.seed * 57.0;
    float pick = evoHash(id);

    if (kind < 0.15) {
      // A stair, behind a screen cast in a pattern from the bottom of the
      // block to the top. What shows through it after dark is the stair's
      // own cold light: a strip of it up every block.
      vec2 q = vec2(f.u, f.v) / 0.8;
      float pattern = step(0.5, fract(f.seed * 2.9));
      float bar = evoScreen(q, pattern, f.aa / 0.8);
      float deep = evoScreen(q + f.dir.xy / max(f.dir.z, 0.2) * 0.28, pattern, f.aa / 0.8);
      float on = step(0.2, uLamps) * step(evoHash(vec2(column, 5.0) + f.seed), 0.88) * (0.75 + 0.5 * evoHash(vec2(level, column)));
      vec3 slab = evoLin(vec3(0.8, 0.78, 0.72)) * (0.92 + 0.12 * evoNoise(q * 3.0));
      vec3 behind = mix(vec3(0.02), slab * 0.42, deep);
      evoWallGlow = mix(vec3(0.85, 0.93, 1.0) * on * mix(1.0, 0.22, deep), evoWash(slab, f.v), bar);
      evoWallHeight = bar;
      evoWallRough = 0.85;
      return mix(behind, slab, bar);
    }

    if (kind < 0.64) {
      // A loggia: a balcony let into the block.
      vec2 at = (cell - vec2(0.05, 0.035)) / vec2(0.9, 0.865);
      if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) return wall;
      const float RAIL = 0.38;
      if (at.y < RAIL) {
        // Its front: a panel painted the block's own colour, and a rail along the top.
        vec3 front = mix(evoAccent(f.seed) * (0.82 + 0.22 * evoNoise(vec2(f.u * 3.0, f.v * 0.7))), concrete * 0.7, step(RAIL - 0.045, at.y));
        front *= 0.9 + 0.1 * step(0.5, fract(at.x * 5.0));
        evoWallGlow = evoWash(front, f.v);
        evoWallHeight = 0.6;
        return front;
      }
      vec2 open = vec2(at.x, (at.y - RAIL) / (1.0 - RAIL));
      vec2 opening = vec2(BAY * 0.9, STOREY * 0.865 * (1.0 - RAIL));
      if (level < 1.5 && evoHash(id + 31.0) < 0.5 && evoGrille(open * opening, opening, f.aa) > 0.5) {
        vec3 steel = evoLin(vec3(0.16, 0.17, 0.18));
        evoWallGlow = evoWash(steel, f.v);
        evoWallRough = 0.45;
        return steel;
      }
      float lit = evoLit(id, 0.62);
      vec3 bulb = evoBulb(pick);
      if (evoHash(id + 5.0) < 0.36) {
        // Closed in with glass, as every other one has been since.
        if (abs(fract(open.x * 3.0) - 0.5) > 0.455 || open.y > 0.96) {
          vec3 sash = evoLin(vec3(0.82, 0.8, 0.76)) * 0.8;
          evoWallGlow = evoWash(sash, f.v);
          return sash;
        }
        float lamp;
        vec3 room = evoRoom(open, f.dir, vec3(BAY * 0.45, STOREY * 0.27, 2.6), pick + f.seed, lamp);
        evoWallGlow = room * bulb * lamp * (1.0 + 1.2 * fract(pick * 3.7)) * lit * (0.55 + 0.45 * evoNoise(vec2(open.x * 2.0 + pick * 9.0, f.seed)));
        return evoGlass(f, room * 0.04);
      }
      // Open: the eye goes on in, to a side wall, the ceiling, or the wall at
      // the back with a window and a door in it.
      vec3 p;
      float back;
      float updown;
      evoInto(open, f.dir, vec3(BAY * 0.45, STOREY * 0.27, 0.6), p, back, updown);
      vec3 inner = concrete * (0.38 + 0.26 * (1.0 - clamp(p.z * 0.5 + 0.5, 0.0, 1.0)));
      evoWallHeight = 0.0;
      if (back > 0.5) {
        vec2 b = p.xy * 0.5 + 0.5;
        bool pane = (b.x > 0.08 && b.x < 0.6 && b.y > 0.3 && b.y < 0.93) || (b.x > 0.66 && b.x < 0.93 && b.y < 0.93);
        if (pane) {
          evoWallGlow = bulb * lit * (1.1 + 1.0 * fract(pick * 3.7)) * (0.6 + 0.4 * evoNoise(b * vec2(9.0, 1.0) + pick * 30.0));
          evoWallRough = 0.1;
          return vec3(0.015);
        }
        evoWallGlow = inner * bulb * lit * 0.35;
        return inner;
      }
      evoWallGlow = inner * bulb * lit * 0.5;
      return inner;
    }

    // A window, with a cooler on a bracket under one in three.
    if (evoHash(id + 9.0) < 0.32 && cell.x > 0.6 && cell.x < 0.8 && cell.y > 0.05 && cell.y < 0.17) {
      vec3 box = vec3(0.5) * (0.7 + 0.3 * step(0.5, fract(cell.x * 40.0)));
      evoWallGlow = evoWash(box, f.v);
      return box;
    }
    vec2 at = (cell - vec2(0.2, 0.2)) / vec2(0.6, 0.58);
    if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) return wall;
    // The two lowest floors have grilles over most of their windows.
    if (level < 1.5 && evoHash(id + 31.0) < 0.6 && evoGrille(at * vec2(BAY * 0.6, STOREY * 0.58), vec2(BAY * 0.6, STOREY * 0.58), f.aa) > 0.5) {
      vec3 steel = evoLin(vec3(0.16, 0.17, 0.18));
      evoWallGlow = evoWash(steel, f.v);
      evoWallRough = 0.45;
      return steel;
    }
    return evoWindow(f, at, vec3(BAY * 0.3, STOREY * 0.29, 3.2), id, 0.66, evoLin(vec3(0.8, 0.78, 0.74)) * 0.8);
  }

  // ---- yellow brick: four or five floors, and an arch to every top window ----
  vec3 evoBrick(EvoFace f) {
    const float BAY = ${BRICK.bay.toFixed(2)};
    const float STOREY = ${BRICK.storey.toFixed(2)};
    const float GROUND = ${BRICK.ground.toFixed(2)};
    vec2 b = vec2(f.u * 4.2 + floor(f.v * 13.0) * 0.5, f.v * 13.0);
    float mortar = max(step(0.93, fract(b.x)), step(0.86, fract(b.y))) * (1.0 - smoothstep(0.02, 0.07, f.aa));
    vec3 clay = mix(evoLin(vec3(0.7, 0.58, 0.36)), evoLin(vec3(0.8, 0.68, 0.45)), evoHash(floor(b) + f.seed * 31.0));
    vec3 wall = mix(clay, evoLin(vec3(0.74, 0.7, 0.6)), mortar) * (0.85 + 0.3 * evoNoise(f.world.xy * 0.4 + f.world.z * 0.4));
    wall *= 0.84 + 0.16 * evoNoise(vec2(f.u * 0.9 + f.seed * 9.0, f.v * 0.12));
    vec3 stone = evoLin(vec3(0.82, 0.78, 0.68)) * (0.9 + 0.15 * evoNoise(vec2(f.u, f.v) * 2.0));
    bool shops = f.street && vMore.y > 0.5;
    if (shops && f.v < GROUND) return evoShop(f, stone);
    if (f.v > f.top - 1.5) {
      // The cornice, with a row of teeth along it.
      vec3 c = stone * (0.9 - 0.25 * step(0.5, fract(f.u * 2.4)) * step(f.v, f.top - 1.0));
      evoWallGlow = evoWash(c, f.v);
      return c;
    }
    float foot = shops ? GROUND : 0.9;
    if (f.v < foot) {
      float groove = step(0.9, fract(f.v * 2.2));
      vec3 c = stone * (0.85 - 0.3 * groove);
      evoWallGlow = evoWash(c, f.v);
      evoWallHeight = 1.0 - groove;
      return c;
    }
    float bays = max(1.0, floor(f.span / BAY));
    float bu = (f.u - (f.span - bays * BAY) * 0.5) / BAY;
    float fv = (f.v - foot) / STOREY;
    float storeys = floor((f.top - 1.5 - foot) / STOREY);
    vec2 cell = vec2(fract(bu), fract(fv));
    evoWallHeight = 1.0 - mortar;
    evoWallGlow = evoWash(wall, f.v);
    if (bu < 0.0 || bu >= bays || fv >= storeys) return wall;
    // Flat pillars of stone between the bays.
    if (cell.x < 0.07 || cell.x > 0.93) {
      evoWallGlow = evoWash(stone, f.v);
      evoWallHeight = 0.0;
      return stone;
    }
    vec2 lo = vec2(0.27, 0.13);
    vec2 size = vec2(0.46, 0.71);
    vec2 at = (cell - lo) / size;
    vec2 wide = (cell - lo + 0.055) / (size + 0.11);
    bool inside = at.x > 0.0 && at.x < 1.0 && at.y > 0.0 && at.y < 1.0;
    bool surround = wide.x > 0.0 && wide.x < 1.0 && wide.y > 0.0 && wide.y < 1.0;
    if (floor(fv) > storeys - 1.5 && at.y > 0.66) {
      // The top floor's windows are arched.
      float r = length(vec2((at.x - 0.5) / 0.5, (at.y - 0.66) / 0.34));
      inside = inside && r < 1.0;
      surround = surround && r < 1.24;
    }
    if (!inside) {
      if (!surround) return wall;
      evoWallGlow = evoWash(stone, f.v);
      evoWallHeight = 0.0;
      return stone;
    }
    vec2 bid = vec2(floor(bu), floor(fv)) + f.seed * 57.0;
    if (floor(fv) < 0.5 && evoHash(bid + 31.0) < 0.6 && evoGrille(at * vec2(BAY * 0.46, STOREY * 0.71), vec2(BAY * 0.46, STOREY * 0.71), f.aa) > 0.5) {
      vec3 steel = evoLin(vec3(0.16, 0.17, 0.18));
      evoWallGlow = evoWash(steel, f.v);
      return steel;
    }
    return evoWindow(f, at, vec3(BAY * 0.23, STOREY * 0.36, 3.4), bid, 0.6, evoLin(vec3(0.85, 0.83, 0.78)) * 0.8);
  }

  // ---- painted render and glass balconies: what has gone up since -----------
  vec3 evoRender(EvoFace f) {
    const float BAY = ${RENDER.bay.toFixed(2)};
    const float STOREY = ${RENDER.storey.toFixed(2)};
    const float GROUND = ${RENDER.ground.toFixed(2)};
    vec3 paint = mix(evoLin(vec3(0.86, 0.84, 0.78)), evoLin(vec3(0.78, 0.76, 0.72)), fract(f.seed * 6.1)) * (0.92 + 0.12 * evoNoise(f.world.xy * 0.3 + f.world.z * 0.3));
    vec3 other = mix(evoAccent(f.seed), evoLin(vec3(0.2, 0.21, 0.23)), step(0.5, fract(f.seed * 4.7)));
    bool shops = f.street && vMore.y > 0.5;
    if (shops && f.v < GROUND) return evoShop(f, paint);
    float foot = shops ? GROUND : 0.6;
    float bays = max(1.0, floor(f.span / BAY));
    float bu = (f.u - (f.span - bays * BAY) * 0.5) / BAY;
    float fv = (f.v - foot) / STOREY;
    vec2 cell = vec2(fract(bu), fract(fv));
    float column = floor(bu);
    bool grid = bu >= 0.0 && bu < bays && fv >= 0.0 && f.v < f.top - 1.3;
    // A stripe of the other colour up some of the columns, and a line at each floor.
    vec3 wall = (evoHash(vec2(column, 21.0) + f.seed * 13.0) < 0.3 ? other : paint) * (1.0 - 0.18 * step(0.97, cell.y));
    evoWallGlow = evoWash(wall, f.v);
    evoWallRough = 0.85;
    if (!grid) return wall;
    vec2 id = vec2(column, floor(fv)) + f.seed * 57.0;
    float pick = evoHash(id);
    vec2 at = (cell - vec2(0.1, 0.1)) / vec2(0.8, 0.76);
    if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) return wall;
    if (!f.end && evoHash(vec2(column, 33.0) + f.seed * 3.0) < 0.45) {
      // A balcony let into the wall, with a rail of glass.
      if (at.y < 0.36) {
        evoWallGlow = vec3(0.0);
        return evoGlass(f, vec3(0.03, 0.04, 0.04)) * vec3(0.86, 1.0, 0.96);
      }
      vec3 p;
      float back;
      float updown;
      evoInto(vec2(at.x, (at.y - 0.36) / 0.64), f.dir, vec3(BAY * 0.4, STOREY * 0.24, 0.45), p, back, updown);
      float lit = evoLit(id, 0.6);
      vec3 inner = paint * (0.4 + 0.25 * (1.0 - clamp(p.z * 0.5 + 0.5, 0.0, 1.0)));
      if (back > 0.5 && abs(p.x) > 0.04 && abs(p.x) < 0.92) {
        evoWallGlow = evoBulb(pick) * lit * (1.2 + 1.0 * fract(pick * 3.7)) * (0.6 + 0.4 * evoNoise(p.xy * vec2(5.0, 0.5) + pick * 30.0));
        evoWallRough = 0.1;
        return vec3(0.015);
      }
      evoWallGlow = inner * evoBulb(pick) * lit * 0.45;
      return inner;
    }
    return evoWindow(f, at, vec3(BAY * 0.4, STOREY * 0.38, 3.6), id, 0.6, evoLin(vec3(0.16, 0.17, 0.19)));
  }

  // ---- a curtain of glass: the towers at the end of the avenue ---------------
  vec3 evoCurtain(EvoFace f, bool crowned) {
    const float BAY = 1.9;
    const float STOREY = 3.6;
    vec3 tint = mix(vec3(0.72, 0.9, 1.0), vec3(0.7, 1.0, 0.94), fract(f.seed * 3.9));
    float bays = max(1.0, floor(f.span / BAY));
    float bu = (f.u - (f.span - bays * BAY) * 0.5) / BAY;
    float fv = f.v / STOREY;
    vec2 cell = vec2(fract(bu), fract(fv));
    if (f.v > f.top - 2.4) {
      // A line of light round the top, after dark.
      evoWallGlow = vec3(0.72, 0.9, 1.0) * uLamps * (crowned ? 4.5 : 2.6);
      evoWallRough = 0.4;
      return evoLin(vec3(0.55, 0.57, 0.6));
    }
    vec2 id = vec2(floor(bu), floor(fv)) + f.seed * 57.0;
    float pick = evoHash(id);
    // Offices: whole floors are lit, or none of one is.
    float floorLit = step(evoHash(vec2(floor(fv), 2.0) + f.seed * 5.0), 0.42) * step(evoHash(vec2(floor(fv), 4.0) + f.seed) * 0.8 + 0.1, uLamps);
    float on = max(evoLit(id, 0.22), floorLit * step(evoHash(id + 3.0), 0.86));
    if (bu < 0.0 || bu >= bays || cell.x < 0.035 || cell.x > 0.965 || cell.y > 0.8) {
      // The band of panel at each floor, and the fin between one bay and the next.
      evoWallGlow = vec3(0.0);
      evoWallRough = 0.25;
      vec3 panel = evoLin(vec3(0.07, 0.085, 0.1));
      return mix(panel, evoSkyIn(reflect(f.view, f.n)) * tint, 0.22);
    }
    float lamp;
    vec3 room = evoRoom(vec2((cell.x - 0.035) / 0.93, cell.y / 0.8), f.dir, vec3(BAY * 0.5, STOREY * 0.4, 5.0), pick + f.seed, lamp);
    evoWallGlow = room * mix(vec3(0.82, 0.9, 1.0), evoBulb(pick), 0.3) * lamp * 1.25 * on;
    // Coated glass: a mirror to the sky from any angle.
    return evoGlassOf(f, room * 0.05 * (0.4 + 0.6 * dot(uHorizon, vec3(0.33))), 0.5) * tint;
  }

  // ---- the hotel: every window at the back of a deep cell of concrete --------
  vec3 evoLattice(EvoFace f) {
    const float BAY = 3.1;
    const float STOREY = 3.2;
    const float GROUND = 6.2;
    vec3 concrete = evoLin(vec3(0.8, 0.76, 0.68)) * (0.9 + 0.14 * evoNoise(f.world.xy * 0.5 + f.world.z * 0.5)) * (0.86 + 0.14 * evoNoise(vec2(f.u * 0.7, f.v * 0.1)));
    evoWallGlow = evoWash(concrete, f.v);
    if (f.end || f.v > f.top - 2.0) return concrete;
    float bu = f.u / BAY;
    if (f.v < GROUND) {
      // The lobby: piers, and glass the height of two floors between them.
      if (fract(bu) < 0.13) return concrete;
      evoWallGlow = vec3(1.0, 0.82, 0.56) * 1.8 * smoothstep(0.05, 0.25, uLamps) * (0.6 + 0.4 * evoNoise(vec2(f.u * 0.4, 3.0)));
      return evoGlass(f, vec3(0.03, 0.028, 0.024));
    }
    float fv = (f.v - GROUND) / STOREY;
    vec2 cell = vec2(fract(bu), fract(fv));
    vec2 at = (cell - 0.085) / 0.83;
    // The lattice itself: its face.
    if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) {
      evoWallHeight = 1.0;
      return concrete;
    }
    vec2 id = vec2(floor(bu), floor(fv)) + f.seed * 57.0;
    float pick = evoHash(id);
    vec3 p;
    float back;
    float updown;
    evoInto(at, f.dir, vec3(BAY * 0.415, STOREY * 0.415, 0.55), p, back, updown);
    float lit = evoLit(id, 0.62);
    vec3 bulb = evoBulb(pick);
    if (back > 0.5) {
      // A room, with its curtains.
      evoWallGlow = bulb * lit * (1.0 + 0.9 * fract(pick * 3.7)) * (0.5 + 0.5 * evoNoise(vec2(p.x * 4.0 + pick * 20.0, 1.0)));
      evoWallRough = 0.1;
      return vec3(0.02);
    }
    vec3 inner = concrete * (0.42 + 0.3 * (1.0 - clamp(p.z * 0.5 + 0.5, 0.0, 1.0)));
    evoWallGlow = inner * bulb * lit * 0.55 + evoWash(inner, f.v) * 0.5;
    return inner;
  }

  vec3 evoWall(vec3 world, vec3 n, vec3 view) {
    float style = vLook.y;
    evoWallGlow = vec3(0.0);
    evoWallHeight = 0.0;
    evoWallRough = 0.9;
    if (n.y > 0.5) {
      // The roof.
      evoWallRough = 0.95;
      return evoLin(vec3(0.17, 0.17, 0.18)) * (0.8 + 0.4 * evoNoise(world.xz * 0.8));
    }
    // A building that has been turned is looked at in its own frame.
    float turnC = cos(vMore.x);
    float turnS = sin(vMore.x);
    vec3 local = vec3(view.x * turnC - view.z * turnS, view.y, view.x * turnS + view.z * turnC);
    bool alongX = abs(n.z) > 0.5;
    EvoFace f;
    f.u = alongX ? vFacade.x + vSize.x * 0.5 : vFacade.z + vSize.z * 0.5;
    f.v = vFacade.y;
    f.span = alongX ? vSize.x : vSize.z;
    f.top = vSize.y;
    f.dir = alongX ? vec3(local.x, local.y, -local.z * sign(n.z)) : vec3(local.z, local.y, -local.x * sign(n.x));
    f.n = vec3(n.x * turnC + n.z * turnS, n.y, -n.x * turnS + n.z * turnC);
    f.view = view;
    f.world = world;
    f.seed = vLook.x;
    f.street = alongX && n.z * (STREET_Z - world.z) > 0.0;
    f.end = !alongX;
    f.flip = alongX ? n.z < 0.0 : n.x > 0.0;
    f.aa = fwidth(f.u) + fwidth(f.v);
    if (style < 0.5) return evoPanel(f);
    if (style < 1.5) return evoBrick(f);
    if (style < 2.5) return evoCurtain(f, false);
    if (style < 3.5) return evoRender(f);
    if (style < 4.5) return evoCurtain(f, true);
    return evoLattice(f);
  }
`

/**
 * Stretches of a kerb, as GLSL: an array of (from, to, side) and its length,
 * side -1 for the far kerb and 1 for the near. Never empty: GLSL has no
 * arrays of nothing, so an empty list is one stretch nowhere.
 */
function stretches(name: string, list: readonly { x0: number; x1: number; side: 'far' | 'near' }[]): string {
  const rows = list.length > 0 ? list : [{ x0: -1e4, x1: -1e4, side: 'far' as const }]
  const items = rows.map((r) => `vec3(${r.x0.toFixed(2)}, ${r.x1.toFixed(2)}, ${r.side === 'far' ? '-1.0' : '1.0'})`).join(', ')
  return `const int ${name}_COUNT = ${rows.length};\n  const vec3 ${name}[${rows.length}] = vec3[](${items});`
}

/** Where the fronts stand right on the pavement, kerb by kerb, joined where they touch. */
function frontsAlong(blocks: readonly FrontBlock[]): { x0: number; x1: number; side: 'far' | 'near' }[] {
  const out: { x0: number; x1: number; side: 'far' | 'near' }[] = []
  for (const side of ['far', 'near'] as const) {
    const runs = blocks
      .filter((b) => Math.abs(b.yaw) < 1e-6 && Math.abs(side === 'far' ? b.z + b.d / 2 - FRONT_FAR : b.z - b.d / 2 - FRONT_NEAR) < 0.6)
      .map((b) => [b.x - b.w / 2, b.x + b.w / 2] as [number, number])
      .sort((u, v) => u[0] - v[0])
    for (const [x0, x1] of runs) {
      const last = out[out.length - 1]
      // A passage between two blocks narrower than a person is no gap at the foot of the wall.
      if (last && last.side === side && x0 <= last.x1 + 0.8) last.x1 = Math.max(last.x1, x1)
      else out.push({ x0, x1, side })
    }
  }
  return out
}

/**
 * The ground of the street: the road with its paint and its crossing, and the
 * pavements either side in the small grey setts the city lays, with a band of
 * red ones along the kerb.
 *
 * And the ariq along each kerb, which is not there at all: the pavement is
 * one flat sheet, and where the channel is the ray from the eye is carried
 * on down into it, to whichever of its two concrete sides or the water it
 * meets first — the way the rooms behind the windows are drawn. The water
 * shows what is over it: the sky, the slot of sky the channel lets it see,
 * the lamps at night; and carries a leaf or two down the street.
 *
 * The sun's shadow, where there is a map of it; and the sky's light less where
 * a front stands over the pavement, so the foot of every wall is darker.
 */
function streetFragment(slabs: readonly AriqSlab[], fronts: readonly { x0: number; x1: number; side: 'far' | 'near' }[]): string {
  return /* glsl */ `
  #define EVO_FRAGMENT
  uniform float uLamps;
  uniform float uCity;
  uniform vec3 uLight;
  uniform vec3 uAmbient;
  uniform float uTime;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vWorld;
  ${EVO_NOISE}
  ${STREET_GLSL}
  ${SUN_SHADOW_GLSL}

  const float CROSS_X = ${CROSSWALK.x.toFixed(2)};
  const float CROSS_HALF = ${CROSSWALK.half.toFixed(2)};
  const float CROSS_STOP = ${CROSSWALK.stop.toFixed(2)};
  const vec2 PLAZA_X = vec2(${PLAZA.x0.toFixed(1)}, ${PLAZA.x1.toFixed(1)});
  const float ARIQ_IN = ${ARIQ.inner.toFixed(3)};
  const float ARIQ_OUT = ${ARIQ.outer.toFixed(3)};
  const float ARIQ_LIP = ${ARIQ.lip.toFixed(3)};
  const float ARIQ_WATER = ${ARIQ.water.toFixed(3)};
  const float ARIQ_SLAB = ${ARIQ.slab.toFixed(3)};
  ${stretches('SLABS', slabs)}
  ${stretches('FRONTS', fronts)}

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

  // The stretch of a kerb's list that 'x' is in, as (from, to), or none.
  vec2 evoSlabAt(float x, float side) {
    for (int i = 0; i < SLABS_COUNT; i++) {
      vec3 s = SLABS[i];
      if (s.z == side && x >= s.x && x <= s.y) return s.xy;
    }
    return vec2(1e5);
  }
  bool evoFrontAt(float x, float side) {
    for (int i = 0; i < FRONTS_COUNT; i++) {
      vec3 s = FRONTS[i];
      if (s.z == side && x >= s.x && x <= s.y) return true;
    }
    return false;
  }

  vec3 evoSkyIn(vec3 dir) {
    return mix(uHorizon, uZenith, clamp(dir.y * 1.4 + 0.15, 0.0, 1.0));
  }

  // What the eye sees down the open ariq through the point 'at' on the
  // pavement's level: a side of it, or the water. 'side' -1 for the far kerb.
  vec3 evoAriq(vec3 at, float side, vec3 view) {
    float zA = STREET_Z + side * (ROAD + ARIQ_IN);
    float zB = STREET_Z + side * (ROAD + ARIQ_OUT);
    float zLo = min(zA, zB);
    float zHi = max(zA, zB);
    float top = at.y;
    float water = top - ARIQ_WATER;
    float tW = view.y < -1e-4 ? (water - top) / view.y : 1e4;
    float tZ = abs(view.z) > 1e-5 ? ((view.z > 0.0 ? zHi : zLo) - at.z) / view.z : 1e4;
    bool wall = tZ < tW;
    vec3 hit = at + view * min(tZ, tW);
    vec3 sky = uAmbient;
    vec3 concrete = lin(vec3(0.5, 0.49, 0.45)) * (0.88 + 0.2 * evoNoise(vec2(hit.x * 2.1, hit.y * 4.0 + side * 5.0)));

    // Under a slab: the ray went in at its end. It meets the end of the slab
    // itself if it went in high enough, and otherwise what it reaches is in
    // the dark under it.
    vec2 slab = evoSlabAt(hit.x, side);
    if (slab.x < 1e4) {
      float edge = view.x > 0.0 ? slab.x : slab.y;
      float yEdge = top + (edge - at.x) / view.x * view.y;
      if (abs(view.x) > 1e-4 && yEdge > top - ARIQ_SLAB) {
        vec3 face = lin(vec3(0.46, 0.45, 0.42)) * (0.8 + 0.3 * evoNoise(vec2(at.z * 20.0, yEdge * 30.0)));
        return face * (sky * 0.5 + uLight * max(-sign(view.x) * uSunDir.x, 0.0) * 0.6);
      }
      return (wall ? concrete : lin(vec3(0.1, 0.1, 0.06))) * sky * 0.05;
    }

    if (wall) {
      // A side: darker the further down, and green and wet at the water.
      float down = top - hit.y;
      float wet = smoothstep(ARIQ_WATER - 0.09, ARIQ_WATER - 0.01, down);
      vec3 albedo = mix(concrete, lin(vec3(0.16, 0.19, 0.1)), wet * 0.85) * mix(1.0, 0.55, smoothstep(0.0, 0.05, down) * (1.0 - smoothstep(0.05, 0.1, down)) * 0.4);
      vec3 n = vec3(0.0, 0.0, -sign(view.z));
      float open = mix(0.75, 0.18, down / ARIQ_WATER);
      // The sun on it, if the other side does not stand in the way.
      float sun = max(dot(n, uSunDir), 0.0);
      if (sun > 0.0 && uSunDir.y > 0.01) {
        float up = (top - hit.y) / uSunDir.y;
        float zOut = hit.z - n.z * 1e-3 + uSunDir.z * up;
        vec3 out_ = vec3(hit.x + uSunDir.x * up, top, zOut);
        sun *= step(zLo - 1e-3, zOut) * step(zOut, zHi + 1e-3) * evoSunSeen(out_, vec3(0.0, 1.0, 0.0));
      }
      vec3 lit = albedo * (sky * open + uLight * sun);
      if (uLamps > 0.001) {
        float nearest = floor(hit.x / LAMP_GAP + 0.5) * LAMP_GAP;
        vec3 glow = lampOn(hit, n, view, vec3(nearest, LAMP_HEIGHT, STREET_Z - ROAD + LAMP_REACH), 0.0) + lampOn(hit, n, view, vec3(nearest + LAMP_GAP * 0.5, LAMP_HEIGHT, STREET_Z + ROAD - LAMP_REACH), 0.0);
        lit += albedo * glow * uLamps * 0.42 * open;
      }
      return lit;
    }

    // The water: slow, the colour of what it has come down off the hills
    // with, and wrinkled by its going.
    float flow = uTime * 0.16;
    vec2 w = vec2(hit.x - flow, hit.z);
    // Wrinkles, not waves: two scales of noise drifting with it, and the
    // slope of each worked out from the noise itself.
    vec2 g = w * vec2(2.6, 9.0) + vec2(0.0, uTime * 0.13);
    float e = 0.15;
    float c0 = evoNoise(g) + 0.5 * evoNoise(g * 2.3 + 17.0);
    float cx = evoNoise(g + vec2(e, 0.0)) + 0.5 * evoNoise((g + vec2(e, 0.0)) * 2.3 + 17.0);
    float cz = evoNoise(g + vec2(0.0, e)) + 0.5 * evoNoise((g + vec2(0.0, e)) * 2.3 + 17.0);
    vec3 n = normalize(vec3((c0 - cx) * 0.09, 1.0, (c0 - cz) * 0.05));
    vec3 bounce = reflect(view, n);
    // Murky water is a dull mirror: it gives back less of the sky than clear water does.
    float fresnel = 0.02 + 0.6 * pow(1.0 - max(dot(-view, n), 0.0), 5.0);
    // What the water shows: the sky, if the reflected ray gets out of the
    // channel; the inside of the far side of it, if not.
    float rise = (top - hit.y) / max(bounce.y, 1e-3);
    float zOut = hit.z + bounce.z * rise;
    float clear = step(zLo, zOut) * step(zOut, zHi);
    vec3 shown = mix(concrete * sky * 0.2, evoSkyIn(bounce) * 0.85, clear);
    float sunlit = 1.0;
    if (uSunDir.y > 0.01) {
      float up = (top - hit.y) / uSunDir.y;
      float zSun = hit.z + uSunDir.z * up;
      sunlit = step(zLo, zSun) * step(zSun, zHi) * evoSunSeen(vec3(hit.x + uSunDir.x * up, top, zSun), vec3(0.0, 1.0, 0.0));
    }
    vec3 murk = lin(vec3(0.17, 0.16, 0.09)) * (sky * 0.45 + uLight * max(uSunDir.y, 0.0) * sunlit * 0.35);
    vec3 lit = mix(murk, shown, fresnel);
    lit += uLight * pow(max(dot(bounce, uSunDir), 0.0), 900.0) * 3.0 * sunlit * clear;
    if (uLamps > 0.001) {
      // The lamps over it: each a small bright thing, broken by the wrinkles
      // into a smear along the water.
      vec3 glint = vec3(0.0);
      float nearest = floor(hit.x / LAMP_GAP + 0.5) * LAMP_GAP;
      for (int i = -1; i <= 1; i++) {
        float lx = nearest + float(i) * LAMP_GAP;
        vec3 ta = vec3(lx, LAMP_HEIGHT, STREET_Z - ROAD + LAMP_REACH) - hit;
        vec3 tb = vec3(lx + LAMP_GAP * 0.5, LAMP_HEIGHT, STREET_Z + ROAD - LAMP_REACH) - hit;
        glint += pow(max(dot(bounce, normalize(ta)), 0.0), 1800.0) / (1.0 + dot(ta, ta) * 0.01);
        glint += pow(max(dot(bounce, normalize(tb)), 0.0), 1800.0) / (1.0 + dot(tb, tb) * 0.01);
      }
      // And the lit shop windows, low across it.
      float shops = bounce.z * side > 0.0 ? (1.0 - smoothstep(0.02, 0.12, bounce.y)) : 0.0;
      lit += (vec3(1.0, 0.78, 0.5) * glint * 6.0 + vec3(1.0, 0.82, 0.6) * shops * 0.12) * uLamps * clear;
    }
    // Leaves going down on it, a hand apart at their closest.
    float lane = floor(w.x / 0.62);
    float h = evoHash(vec2(lane, side * 13.0 + 7.0));
    if (h < 0.24) {
      float h2 = fract(h * 91.7);
      vec2 c = vec2((lane + 0.3 + 0.4 * h2) * 0.62, mix(zLo + 0.1, zHi - 0.1, fract(h * 47.3)));
      float turn = h * 37.0;
      vec2 d = vec2(w.x, w.y) - c;
      d = vec2(cos(turn) * d.x + sin(turn) * d.y, cos(turn) * d.y - sin(turn) * d.x);
      float leaf = length(d / vec2(0.055, 0.032)) - 1.0 + 0.25 * abs(sin(atan(d.y, d.x) * 2.5));
      if (leaf < 0.0) {
        vec3 tint = mix(lin(vec3(0.5, 0.36, 0.12)), lin(vec3(0.42, 0.45, 0.16)), fract(h * 13.1));
        lit = tint * (sky * 0.5 + uLight * max(uSunDir.y, 0.0) * sunlit * 0.8);
      }
    }
    return lit;
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
    float far = length(at - cameraPosition);
    vec3 view = normalize(at - cameraPosition);
    float side = across < 0.0 ? -1.0 : 1.0;
    float past = abs(across) - ROAD;
    // The sun, where nothing stands between — asked only while it is up.
    float seen = uSunDir.y > 0.0 && dot(uLight, vec3(1.0)) > 0.02 ? evoSunSeen(at, vec3(0.0, 1.0, 0.0)) : 1.0;
    // The sky, less of it at the foot of a front.
    float open = 1.0;

    vec3 color;
    float gloss;
    if (road) {
      // Asphalt, worn paler where the wheels go, with its paint.
      color = lin(vec3(0.25, 0.25, 0.265)) * (0.8 + 0.3 * n2 + 0.25 * n1);
      float lane = abs(fract(across / 3.5) - 0.5) * 3.5;
      color *= 1.0 + 0.2 * smoothstep(1.3, 0.4, abs(lane - 0.85));
      float along = at.x - CROSS_X;
      float clear = step(CROSS_HALF + 0.5, abs(along));
      float dash = step(0.55, fract(at.x / 9.0));
      float centre = 1.0 - smoothstep(0.07, 0.11, abs(abs(across) - 0.16));
      float between = (1.0 - smoothstep(0.06, 0.1, abs(abs(across) - 3.5))) * dash;
      float edge = 1.0 - smoothstep(0.07, 0.11, abs(abs(across) - (ROAD - 0.45)));
      float paint = max(max(centre, between), edge) * clear;
      // The crossing: bars the way the road runs, kerb to kerb, and a line
      // for each direction to stop at before it.
      float zebra = step(abs(along), CROSS_HALF) * step(0.5, fract(across / 1.0 + 0.25)) * step(abs(across), ROAD - 0.35);
      float halt = (1.0 - smoothstep(0.16, 0.2, abs(along + sign(across) * (CROSS_HALF + CROSS_STOP)))) * step(abs(across), ROAD - 0.4);
      paint = max(paint, max(zebra, halt)) * (0.55 + 0.45 * n2);
      color = mix(color, lin(vec3(0.76, 0.75, 0.7)), paint * 0.88);
      // Puddles in the low places.
      gloss = smoothstep(0.52, 0.72, n3 + n1 * 0.12) * 0.9 + 0.12;
    } else {
      // The ariq: open water between its two lips, or a slab over it.
      bool ariq = past > ARIQ_IN - ARIQ_LIP && past < ARIQ_OUT + ARIQ_LIP;
      bool covered = ariq && evoSlabAt(at.x, side).x < 1e4;
      if (!covered && past > ARIQ_IN && past < ARIQ_OUT) {
        vec3 lit = evoAriq(at, side, view);
        gl_FragColor = vec4(evoAir(lit), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        return;
      }
      // Setts, laid in courses a hand long: grey, and red in a band along the kerb.
      vec2 sett = at.xz / vec2(0.2, 0.1);
      sett.x += floor(sett.y) * 0.5;
      float fade = 1.0 - smoothstep(9.0, 26.0, far);
      float joint = max(step(0.93, fract(sett.x)), step(0.88, fract(sett.y))) * fade;
      float each = evoHash(floor(sett));
      float band = step(0.5, past) * step(past, 0.95);
      vec3 grey = lin(vec3(0.42, 0.41, 0.4)) * (0.8 + 0.3 * mix(0.5, each, fade));
      vec3 red = lin(vec3(0.44, 0.27, 0.22)) * (0.8 + 0.35 * mix(0.5, each, fade));
      color = mix(grey, red, band) * (1.0 - 0.3 * joint) * (0.9 + 0.2 * n1);
      // The kerb: a line of stone, a little higher than the road.
      color = mix(color, lin(vec3(0.56, 0.55, 0.52)), 1.0 - smoothstep(0.0, 0.3, past));
      // (The square of earth round each tree is the tree's own: 'evoTrees.ts'
      // lays it, and the shade under the crown, wherever it stands one.)
      gloss = smoothstep(0.6, 0.8, n3) * 0.5 + 0.05;
      // The ariq's concrete: its two lips, or the slab laid over it, in
      // lengths with a dark joint between them and stained where feet go.
      if (ariq) {
        vec3 cast_ = lin(vec3(0.6, 0.59, 0.55)) * (0.86 + 0.22 * n2);
        if (covered) {
          float seam = 1.0 - smoothstep(0.0, 0.02, abs(fract(at.x / 1.2 + 0.5) - 0.5) * 1.2);
          cast_ *= (1.0 - 0.45 * seam * fade) * (0.9 + 0.15 * evoNoise(at.xz * 2.2));
        } else {
          // The edge over the water is worn round and dark.
          float rim = min(abs(past - ARIQ_IN), abs(past - ARIQ_OUT));
          cast_ *= 0.7 + 0.3 * smoothstep(0.0, 0.025, rim);
        }
        color = cast_;
        gloss = 0.08;
      }
      // At the foot of a front, it sees less of the sky.
      float toFront = PAVEMENT - past;
      if (toFront < 1.4 && evoFrontAt(at.x, side)) open = mix(0.5, 1.0, smoothstep(0.0, 1.4, toFront));
    }

    vec3 normal = normalize(vec3((n2 - 0.5) * 0.1 * (1.0 - gloss), 1.0, (evoNoise(at.xz * 6.0 + 31.0) - 0.5) * 0.1 * (1.0 - gloss)));

    // Daylight, such as there is.
    vec3 lit = color * (uAmbient * open + uLight * max(dot(normal, uSunDir), 0.0) * seen);
    vec3 hSun = normalize(uSunDir - view);
    lit += uLight * pow(max(dot(normal, hSun), 0.0), mix(30.0, 300.0, gloss)) * gloss * 0.6 * seen;

    // The lamps: the two nearest either side, on both kerbs.
    if (uLamps > 0.001) {
      vec3 glow = vec3(0.0);
      float nearest = floor(at.x / LAMP_GAP + 0.5) * LAMP_GAP;
      for (int i = -1; i <= 1; i++) {
        float lx = nearest + float(i) * LAMP_GAP;
        glow += lampOn(at, normal, view, vec3(lx, LAMP_HEIGHT, STREET_Z - ROAD + LAMP_REACH), gloss);
        glow += lampOn(at, normal, view, vec3(lx + LAMP_GAP * 0.5, LAMP_HEIGHT, STREET_Z + ROAD - LAMP_REACH), gloss);
      }
      // And what spills out of the shop fronts onto the pavement.
      float spill = (1.0 - smoothstep(0.0, 3.8, ROAD + PAVEMENT - abs(across))) * (0.6 + 0.4 * evoNoise(vec2(at.x * 0.16, sign(across) * 7.0)));
      spill *= across < 0.0 && at.x > PLAZA_X.x && at.x < PLAZA_X.y ? 0.0 : 1.0;
      glow += vec3(1.0, 0.8, 0.58) * spill * 0.5;
      lit += color * glow * uLamps * 0.42 + glow * gloss * uLamps * 0.012;
    }

    gl_FragColor = vec4(evoAir(lit), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
}

/**
 * The floor of the square: pale stone in big slabs, with a star of darker
 * stone let into it round the fountain, polished enough to hold the lit
 * mosque upside down in it once it is dark.
 */
const PLAZA_FRAG = /* glsl */ `
  #define EVO_FRAGMENT
  uniform float uLamps;
  uniform float uCity;
  uniform vec3 uLight;
  uniform vec3 uAmbient;
  varying vec3 vWorld;
  ${EVO_NOISE}
  ${STREET_GLSL}
  ${CITY_LIGHT_GLSL}
  ${SUN_SHADOW_GLSL}

  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

  void main() {
    vec3 at = vWorld;
    // It is laid when the square is: late, and all at once from the street back.
    if (uCity < 0.62 + 0.25 * clamp((${PLAZA.front.toFixed(1)} - at.z) / 66.0, 0.0, 1.0)) discard;
    float far = length(at - cameraPosition);
    float fade = 1.0 - smoothstep(14.0, 50.0, far);
    vec2 slab = at.xz / 1.2;
    float joint = max(step(0.975, fract(slab.x)), step(0.975, fract(slab.y))) * fade;
    float each = evoHash(floor(slab));
    vec3 pale = lin(vec3(0.66, 0.63, 0.57)) * (0.86 + 0.2 * mix(0.5, each, fade));
    vec3 dark = lin(vec3(0.34, 0.3, 0.27)) * (0.86 + 0.2 * mix(0.5, each, fade));
    vec3 blue = lin(vec3(0.12, 0.36, 0.44));
    // A star of sixteen points round the fountain, and rings round that.
    vec2 c = at.xz - vec2(${FOUNTAIN.x.toFixed(1)}, ${FOUNTAIN.z.toFixed(1)});
    float r = length(c);
    float a = atan(c.y, c.x);
    float star = r - (11.0 + 3.2 * abs(fract(a * 16.0 / 6.2831853) - 0.5) * 2.0);
    vec3 color = pale;
    color = mix(color, dark, 1.0 - smoothstep(0.0, 0.12, abs(star) - 0.28));
    color = mix(color, dark, step(r, 9.0) * step(0.5, fract(a * 16.0 / 6.2831853 + step(4.0, mod(r, 8.0)) * 0.5)) * 0.6);
    color = mix(color, blue, 1.0 - smoothstep(0.0, 0.1, abs(r - 17.5) - 0.22));
    // A border in the darker stone all round the square.
    vec2 edge = min(vec2(at.x - ${PLAZA.x0.toFixed(1)}, ${PLAZA.front.toFixed(1)} - at.z), vec2(${PLAZA.x1.toFixed(1)} - at.x, at.z - ${PLAZA.back.toFixed(1)}));
    color = mix(color, dark, step(min(edge.x, edge.y), 1.2) * 0.8);
    color *= (1.0 - 0.28 * joint) * (0.92 + 0.14 * evoNoise(at.xz * 0.5));
    float gloss = 0.55 + 0.25 * evoNoise(at.xz * 0.23);
    // The beds: a kerb, a band of flowers inside it, and grass.
    float bed = -1.0;
${LAWNS.map((l) => `    bed = max(bed, min(min(at.x - ${l.x0.toFixed(1)}, ${l.x1.toFixed(1)} - at.x), min(at.z - (${l.z0.toFixed(1)}), ${l.z1.toFixed(1)} - at.z)));`).join('\n')}
    if (bed > 0.0) {
      vec3 grass = lin(vec3(0.2, 0.37, 0.12)) * (0.82 + 0.3 * evoNoise(at.xz * 1.3) + 0.12 * step(0.5, fract(at.x / 1.6)));
      if (bed < 0.26) {
        color = lin(vec3(0.6, 0.59, 0.55));
      } else if (bed < 1.35) {
        // Planted close: every hand's width a flower, in four colours.
        vec2 cell = at.xz / 0.24;
        float each = evoHash(floor(cell));
        float head = 1.0 - smoothstep(0.26, 0.36, length(fract(cell) - 0.5));
        vec3 petal = each < 0.4 ? vec3(0.78, 0.06, 0.07) : each < 0.62 ? vec3(0.9, 0.36, 0.5) : each < 0.84 ? vec3(0.95, 0.72, 0.1) : vec3(0.92, 0.9, 0.86);
        vec3 planted = mix(lin(vec3(0.13, 0.25, 0.09)), lin(petal), head * step(0.12, each));
        // Too far to count them: the bed is the colour they come to.
        color = mix(lin(vec3(0.52, 0.2, 0.17)), planted, fade);
      } else {
        color = grass;
      }
      gloss = 0.03;
    }

    vec3 normal = vec3(0.0, 1.0, 0.0);
    vec3 view = normalize(at - cameraPosition);
    // Pale stone under an open sky: less of the light comes back off it than
    // off the setts, or at noon it is a sheet of white.
    // The sun, where the mosque and its minarets, the trees and the people do not stand in the way.
    float seen = uSunDir.y > 0.0 && dot(uLight, vec3(1.0)) > 0.02 ? evoSunSeen(at, normal) : 1.0;
    vec3 lit = color * 0.45 * (uAmbient + uLight * max(uSunDir.y, 0.0) * seen);
    vec3 hSun = normalize(uSunDir - view);
    lit += uLight * pow(max(hSun.y, 0.0), 220.0) * gloss * 0.5 * seen;
    if (uLamps > 0.001) {
      vec3 glow = evoStreetLight(at, normal, 0.0) + evoLanternLight(at, normal, 0.0);
      // The mosque is floodlit, and the stone in front of it holds some of
      // that; and the square has light of its own, thinner towards its edges.
      vec2 toDoor = at.xz - vec2(${MOSQUE.x.toFixed(1)}, ${(MOSQUE.z + MOSQUE.hall / 2).toFixed(1)});
      float wash = exp(-dot(toDoor, toDoor) / 260.0);
      glow += vec3(1.0, 0.9, 0.74) * (wash * 0.7 + 0.2 + 0.8 * exp(-dot(toDoor, toDoor) / 2400.0));
      lit += color * glow * uLamps * 0.42;
      // And shows it upside down: a column of light under each bright thing.
      vec3 mirror = reflect(view, normal);
      float under = pow(max(mirror.y, 0.0), 0.35) * smoothstep(0.0, 0.5, -view.y + 0.04);
      float column = exp(-pow((at.x - ${MOSQUE.x.toFixed(1)}) / 9.0, 2.0)) * smoothstep(${(MOSQUE.z + MOSQUE.hall / 2 + 2).toFixed(1)}, ${(MOSQUE.z + MOSQUE.hall / 2 + 34).toFixed(1)}, at.z + 34.0 * (1.0 - under));
      lit += vec3(0.8, 0.9, 1.0) * column * gloss * uLamps * 0.05 * under;
    }
    gl_FragColor = vec4(evoAir(lit), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface CityOptions {
  bump: number
  shadows: boolean
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
  const more = new Float32Array(blocks.length * 2)
  blocks.forEach((b, i) => {
    sizes.set([b.w, b.h - b.base, b.d], i * 3)
    looks.set([b.seed, b.style, b.delay, b.base], i * 4)
    more.set([b.yaw, b.shops ? 1 : 0], i * 2)
  })
  box.setAttribute('aSize', new InstancedBufferAttribute(sizes, 3))
  box.setAttribute('aLook', new InstancedBufferAttribute(looks, 4))
  box.setAttribute('aMore', new InstancedBufferAttribute(more, 2))
  const signs = makeSigns()
  disposers.push(() => signs.dispose())
  const wall = inAir(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 }), air, 'city', (shader) => {
    Object.assign(shader.uniforms, shared, {
      uZenith: air.uZenith,
      uHorizon: air.uHorizon,
      uSunColor: air.uSunColor,
      uSunUp: air.uSunUp,
      uBump: { value: options.bump },
      uSigns: { value: signs },
      uSignGrid: { value: new Vector2(SIGN_GRID.columns, SIGN_GRID.rows) },
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
        // The tallest of the towers is drawn in at its top.
        if (aLook.y > 3.5 && aLook.y < 4.5) {
          float crown = smoothstep(0.8, 1.0, position.y);
          transformed.x *= 1.0 - 0.5 * crown;
          transformed.z *= 1.0 - 0.2 * crown;
        }
        vFacade = vec3(position.x * aSize.x, aLook.w + position.y * aSize.y * evoRise, position.z * aSize.z);
        vFaceNormal = normal;
        vLook = aLook;
        vMore = aMore;
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
    dummy.rotation.set(0, b.yaw, 0)
    dummy.scale.set(b.w, b.h - b.base, b.d)
    dummy.updateMatrix()
    buildings.setMatrixAt(i, dummy.matrix)
  })
  dummy.rotation.set(0, 0, 0)
  buildings.instanceMatrix.needsUpdate = true
  buildings.frustumCulled = false
  buildings.castShadow = options.shadows
  if (options.shadows) disposers.push(ownShadow(buildings))
  buildings.receiveShadow = options.shadows
  root.add(buildings)
  disposers.push(
    () => box.dispose(),
    () => wall.dispose(),
  )
  // What stands out from the walls and off the roofs.
  const relief = createRelief(blocks, shared, air, { shadows: options.shadows, signs, signGrid: new Vector2(SIGN_GRID.columns, SIGN_GRID.rows) })
  root.add(relief.object)
  disposers.push(relief.dispose)

  // ---- the street ----------------------------------------------------------
  const length = STREET_LENGTH
  const streetGeometry = new PlaneGeometry(length, (ROAD + PAVEMENT) * 2, 1, 1)
  streetGeometry.rotateX(-Math.PI / 2)
  // The ground takes the sun's shadow, and knows where the ariq is bridged and where the fronts stand.
  const sunShadow = createSunShadow()
  const streetMaterial = new ShaderMaterial({
    uniforms: {
      ...shared,
      ...sunShadow.uniforms,
      uHaze: air.uHaze,
      uGlow: air.uGlow,
      uSunDir: air.uSunDir,
      uAir: air.uAir,
      uZenith: air.uZenith,
      uHorizon: air.uHorizon,
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
    fragmentShader: `${AIR_PARS}\n${streetFragment(ariqSlabs(blocks), frontsAlong(blocks))}`,
  })
  const street = new Mesh(streetGeometry, streetMaterial)
  street.position.set(PAVED_FROM + length / 2, 0.06, STREET_Z)
  street.frustumCulled = false
  sunShadow.bind(street)
  disposers.push(() => sunShadow.dispose())
  root.add(street)
  disposers.push(
    () => streetGeometry.dispose(),
    () => streetMaterial.dispose(),
  )

  const poleMaterial = inAir(new MeshStandardMaterial({ color: '#2a2c30', roughness: 0.6, metalness: 0.4 }), air, 'pole')

  // ---- the square ----------------------------------------------------------
  const ground = (fragment: string): ShaderMaterial =>
    new ShaderMaterial({
      uniforms: {
        ...shared,
        ...sunShadow.uniforms,
        uHaze: air.uHaze,
        uGlow: air.uGlow,
        uSunDir: air.uSunDir,
        uAir: air.uAir,
        uLight: streetMaterial.uniforms.uLight!,
        uAmbient: streetMaterial.uniforms.uAmbient!,
      },
      vertexShader: streetMaterial.vertexShader,
      fragmentShader: `${AIR_PARS}\n${fragment}`,
    })
  const plazaGeometry = new PlaneGeometry(PLAZA.x1 - PLAZA.x0, PLAZA.front - PLAZA.back, 1, 1)
  plazaGeometry.rotateX(-Math.PI / 2)
  const plazaMaterial = ground(PLAZA_FRAG)
  const plaza = new Mesh(plazaGeometry, plazaMaterial)
  plaza.position.set((PLAZA.x0 + PLAZA.x1) / 2, 0.065, (PLAZA.front + PLAZA.back) / 2)
  plaza.frustumCulled = false
  sunShadow.bind(plaza)
  root.add(plaza)
  // Its lanterns: a post, and a globe on it.
  const postGeometry = new CylinderGeometry(0.05, 0.08, LANTERN_HEIGHT, 6)
  postGeometry.translate(0, LANTERN_HEIGHT / 2, 0)
  const globeGeometry = new SphereGeometry(0.26, 12, 10)
  const globeMaterial = new MeshBasicMaterial({ color: '#ffffff' })
  const posts = new InstancedMesh(postGeometry, poleMaterial, LANTERNS.length)
  const globes = new InstancedMesh(globeGeometry, globeMaterial, LANTERNS.length)
  LANTERNS.forEach(([x, z], i) => {
    dummy.position.set(x, 0, z)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    posts.setMatrixAt(i, dummy.matrix)
    dummy.position.set(x, LANTERN_HEIGHT + 0.2, z)
    dummy.updateMatrix()
    globes.setMatrixAt(i, dummy.matrix)
  })
  posts.frustumCulled = false
  globes.frustumCulled = false
  root.add(posts, globes)
  disposers.push(
    () => plazaGeometry.dispose(),
    () => plazaMaterial.dispose(),
    () => postGeometry.dispose(),
    () => globeGeometry.dispose(),
    () => globeMaterial.dispose(),
  )

  // ---- lamps ---------------------------------------------------------------
  const lampCount = Math.floor(length / LAMP_GAP) * 2
  const poleGeometry = new CylinderGeometry(0.07, 0.1, LAMP_HEIGHT, 6)
  poleGeometry.translate(0, LAMP_HEIGHT / 2, 0)
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
    const square = beat.stage.city > 0.7
    plaza.visible = beat.stage.city > 0.6
    posts.visible = square
    globes.visible = square
    globeMaterial.color.setRGB(1, 0.88, 0.68).multiplyScalar(0.3 + 4 * beat.lamps)
  }

  return {
    object: root,
    update,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}
