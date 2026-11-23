import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  FloatType,
  Euler,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  Quaternion,
  RGBAFormat,
  NoColorSpace,
  SRGBColorSpace,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import { EVO_NOISE, PARS_HERE, inAir, ownShadow, type Air, type Arrivals } from './evoAir'
import {
  ARCH_GAP,
  DECAL_KINDS,
  MAX_DECALS,
  MAX_OUTLINE,
  VEHICLE_KINDS,
  VEHICLE_SHAPES,
  WHEEL_STYLES,
  plateAt,
  rimOf,
  vehicleMesh,
  wheelReach,
  type BodyDetail,
  type Lens,
  type Pt,
  type VehicleKind,
  type VehicleShape,
} from './evoCarShapes'
import { CAR_MODELS, roleOf, type CarModel, type ModelRole } from '@/content/carModels'
import { CARD_TEXTS, COUNTRY, PLATE_COUNT, SIGN_TEXTS, plateTexts } from './evoCarText'
import { FRONT_FAR, FRONT_NEAR, PLAZA, STREET_GLSL, crossingHeld } from './evoStreet'
import { CARD_COUNT, PAINT, PAINT_COUNT, TRAFFIC_RING, createTraffic, type Traffic, type Vehicle } from './evoTraffic'
import type { Beat, Part } from './evoWalk'

/**
 * The traffic on the street the walk ends on, as it is drawn.
 *
 * What the vehicles are is `evoCarShapes.ts` and how they are driven is
 * `evoTraffic.ts`; this is the paint. There is no picture of the street for a
 * car to reflect — nothing in the walk has one — so the bodywork works out
 * what it would be seeing: the sky's own gradient above the roofs, the road
 * below, a row of lit shop fronts along each pavement, and the street lamps,
 * from where the lamps actually are. That last is what makes a car at night:
 * each lamp crosses the bonnet, climbs the windscreen and runs back along the
 * roof as the car goes under it.
 *
 * A body is one skin, and everything on it that is smaller than a panel is
 * drawn on that skin by where it is: headlamps and tail lamps in each car's
 * own shapes, grilles, chrome bumpers on the oldest, rubbing strips, the lines
 * where the doors shut and their handles, road dust low down and sun-faded
 * paint on what has been in the sun for fifty summers; and behind the glass
 * the seats, whoever is driving, a minibus's route card, against the light of
 * the windows on the far side.
 *
 * Every body is two instanced meshes: as it is close up, and with a third of
 * the faces for anything more than a few car lengths away. Which is which is
 * worked out each frame, and each mesh is handed just the cars it draws.
 */

export interface CarsOptions {
  shadows: boolean
  /** How many of them. */
  cars: number
  /** The models other people made to draw in place of the walk's own bodies: `CAR_MODELS` unless said otherwise. */
  models?: readonly Pick<CarModel, 'kind' | 'variant' | 'file'>[]
}

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)

/** How high the road's own surface is: `evoCity.ts` lays the street a little proud of the land. */
const ROAD_Y = 0.06
/** The dark under a car: how far past its outline it reaches, and how far in from the outline it is at its darkest. */
const UNDER_OUT = 0.45
const UNDER_IN = 0.35
/** Nearer than this a car is drawn as it is close up; once drawn so, until it is this much further. */
const LOD_NEAR = 26
const LOD_HOLD = 4

/**
 * The colours, in the order `evoTraffic.ts` names them in `PAINT`. White is not
 * paper white: in the sun it is the brightest thing on the street as it is.
 * The four after the bus's green are the old sedans' colours, faded.
 */
const PAINTS: Record<keyof typeof PAINT, string> = {
  white: '#dcddd8',
  silver: '#aeb3ba',
  grey: '#5a5e65',
  black: '#0e0f12',
  blue: '#1b2c4a',
  cherry: '#6e1a1f',
  beige: '#b0a184',
  bus: '#7fbf24',
  cream: '#d6d0bd',
  sand: '#bfae8c',
  paleBlue: '#8ea4b6',
  oldCherry: '#7a3036',
  red: '#9a2320',
  sky: '#40709f',
  lime: '#7b9a3f',
}
const PAINT_COLORS: readonly Color[] = (() => {
  const list: Color[] = new Array<Color>(PAINT_COUNT)
  for (const [name, index] of Object.entries(PAINT)) list[index] = new Color(PAINTS[name as keyof typeof PAINT])
  return list
})()
/** A bus's other colour: the band over its windows, and its roof. */
const SECOND = '#d8d9d3'

/**
 * Where the far side of the street is a square and not a row of fronts, along
 * the street: there a car's far flank has only the sky to show.
 */
const SQUARE = { from: PLAZA.x0, until: PLAZA.x1 } as const

// ---------------------------------------------------------------- the light

/**
 * What a street is to something standing in it: the light of its lamps, and
 * what is to be seen along a direction from down between its buildings. Wants
 * the air's `uSunDir`, which `inAir` declares, and `evoHash`.
 */
const STREET_LIGHT = /* glsl */ `
  uniform float uLamps;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform float uSunUp;
  ${STREET_GLSL}
  const vec3 EVO_LAMP = vec3(1.0, 0.78, 0.5);

  // The six lamps nearest a place: what falls from them on a surface that
  // faces 'n' there, and how brightly they are seen along 'r' from it — a
  // small bright thing each, smaller the tighter 'tight' is.
  void evoLamps(vec3 at, vec3 n, vec3 r, float tight, out vec3 fall, out vec3 shine) {
    float lit = 0.0;
    float seen = 0.0;
    float nearest = floor(at.x / LAMP_GAP + 0.5) * LAMP_GAP;
    for (int i = -1; i <= 1; i++) {
      float lx = nearest + float(i) * LAMP_GAP;
      for (int k = 0; k < 2; k++) {
        vec3 lamp = k == 0 ? vec3(lx, LAMP_HEIGHT, STREET_Z - ROAD + LAMP_REACH) : vec3(lx + LAMP_GAP * 0.5, LAMP_HEIGHT, STREET_Z + ROAD - LAMP_REACH);
        vec3 to = lamp - at;
        float d2 = dot(to, to);
        vec3 l = to * inversesqrt(d2);
        lit += max(dot(n, l), 0.0) / d2;
        seen += pow(max(dot(r, l), 0.0), tight) / (1.0 + d2 * 0.016);
      }
    }
    // The same numbers the road is lit by, so a white car is as bright under a lamp as the paint on the road is.
    fall = EVO_LAMP * lit * 26.0;
    shine = EVO_LAMP * seen;
  }

  // What is seen along 'r' from a place in the street: sky over the roofs,
  // the fronts of the buildings either side with their windows, the road.
  // 'sharp' is 1 for a reflection, which has every window in it, and 0 for
  // what is only light beyond — the far side seen through a car is whatever
  // building is really there, which this does not know, so it is told softly.
  vec3 evoStreetSeen(vec3 at, vec3 r, float sharp) {
    vec3 sky = mix(uHorizon, uZenith, clamp(r.y * 1.4 + 0.15, 0.0, 1.0));
    sky += uSunColor * pow(max(dot(r, uSunDir), 0.0), 240.0) * 5.0 * uSunUp;
    // The road: what light there is, on something dark.
    vec3 road = (uHorizon * 0.5 + uZenith * 0.5) * 0.07 + EVO_LAMP * 0.05 * uLamps;
    vec3 seen = mix(road, sky, smoothstep(-0.1, 0.05, r.y));
    // A front: the wall of the street on whichever side this is looking.
    float front = r.z > 0.0 ? ${FRONT_NEAR.toFixed(2)} : ${FRONT_FAR.toFixed(2)};
    float t = (front - at.z) / (abs(r.z) > 1e-3 ? r.z : 1e-3);
    vec3 hit = at + r * t;
    float wall = step(0.0, t) * step(0.0, hit.y) * (1.0 - smoothstep(22.0, 40.0, hit.y)) * smoothstep(0.02, 0.2, abs(r.z));
    // Open, on the far side, for as long as the square is.
    wall *= 1.0 - step(r.z, 0.0) * smoothstep(${(SQUARE.from - 1.5).toFixed(1)}, ${(SQUARE.from + 1.5).toFixed(1)}, hit.x) * (1.0 - smoothstep(${(SQUARE.until - 1.5).toFixed(1)}, ${(SQUARE.until + 1.5).toFixed(1)}, hit.x));
    if (wall > 0.0) {
      vec3 face = (uHorizon * 0.6 + uZenith * 0.4) * 0.16;
      // Shop fronts along the pavement, lit after dusk, some brighter than others; rooms above, a few of them.
      float column = floor(hit.x / 3.3);
      float bay = hit.x / 3.3 - column;
      float bays = smoothstep(0.05, 0.17, bay) * (1.0 - smoothstep(0.83, 0.95, bay)) * (0.3 + 0.7 * evoHash(vec2(column, 3.0)));
      float shop = smoothstep(0.4, 0.9, hit.y) * (1.0 - smoothstep(3.6, 4.1, hit.y)) * mix(0.5, bays, sharp);
      vec2 cell = vec2(column, floor((hit.y - 4.6) / 3.2));
      vec2 pane = vec2(bay, fract((hit.y - 4.6) / 3.2));
      float panes = smoothstep(0.12, 0.3, pane.x) * (1.0 - smoothstep(0.7, 0.88, pane.x)) * smoothstep(0.12, 0.3, pane.y) * (1.0 - smoothstep(0.7, 0.88, pane.y));
      float room = step(4.6, hit.y) * mix(0.13, panes * step(0.62, evoHash(cell + 7.0)), sharp);
      vec3 warm = mix(vec3(1.0, 0.76, 0.48), vec3(0.8, 0.88, 1.0), step(0.8, evoHash(cell + 31.0)) * sharp);
      face += (vec3(1.0, 0.84, 0.62) * shop * 0.95 + warm * room * 0.3) * uLamps;
      seen = mix(seen, face, wall);
    }
    return seen;
  }
`

const lightUniforms = (air: Air, shared: { uLamps: { value: number } }) => ({
  uLamps: shared.uLamps,
  uZenith: air.uZenith,
  uHorizon: air.uHorizon,
  uSunColor: air.uSunColor,
  uSunUp: air.uSunUp,
})

/** The normal of a face in the world, for a mesh that is instanced: what the street's light is worked out from. */
const WORLD_NORMAL = /* glsl */ `
  mat4 evoBody = modelMatrix;
  #ifdef USE_INSTANCING
    evoBody = modelMatrix * instanceMatrix;
  #endif
  vCarNormal = normalize(mat3(evoBody) * objectNormal);
`

// ------------------------------------------------------------------ bodies

/** How many points a row of the texture the outlines are kept in holds. */
const POINT_ROW = 128

const BODY_FRAG = /* glsl */ `
  uniform vec3 uSecond;
  // Where the doors shut, along the side: 99 where there are no more.
  uniform vec4 uDoorsAt;
  // Half the length; the floor above the road.
  uniform vec4 uEnds;
  // A pane in an upright tail: how high, half as tall, half as wide, and whether there is one.
  uniform vec4 uPane;
  // Behind the glass: the sill of the windows and their head, half the width inside, whether it is lit after dark.
  uniform vec4 uCabin;
  // The backs of the front seats and of the rear one (99 for none), and how far forward and back the inside goes.
  uniform vec4 uSeats;
  // The two axles, the radius of a wheel, and whether there is black plastic round the arches.
  uniform vec4 uAxle;
  // Lids: where a bonnet starts and where a boot stops, along the body, and how far out from the middle their edges run.
  uniform vec3 uLids;
  // A strip's height up the doors (or -1), whether it is chrome, flush handles.
  uniform vec4 uDetail;
  // A sliding door: from, until, whether there is one.
  uniform vec3 uSlide;
  // A route card behind the windscreen: where its middle is, whether there is room for one; half its size; and where the cards are on the sheet.
  uniform vec4 uCard;
  uniform vec2 uCardSize;
  uniform vec4 uCards;
  uniform sampler2D uSheet;
  // The outlines everything on the ends and the windows are drawn from: their points in a texture, and
  // for each decal where its points start and how many there are, what it is and which face it is on,
  // and the box it fits in. The nose's come first, then the tail's.
  uniform sampler2D uPoints;
  uniform vec4 uDecalRange;
  uniform vec4 uDecalA[${MAX_DECALS}];
  uniform vec4 uDecalB[${MAX_DECALS}];
  // The side windows: where their outline's points start and how many, the frame's width, chrome; and the pillars across them.
  uniform vec4 uWindow;
  uniform vec4 uBars[4];
  varying float vCarPart;
  varying vec2 vCarBody;
  varying vec3 vCarNormal;
  varying vec3 vCarFace;
  varying vec3 vCarAt;
  varying vec3 vCarEye;
  // How hard the brake lights are on, and how much of the lamps of the one behind falls on its back.
  varying vec2 vCarLit;
  // Which of its faces, how dusty, how faded, which route card.
  varying vec4 vCarLook;
  ${EVO_NOISE}
  ${STREET_LIGHT}

  float evoCarRough;
  vec3 evoCarGlow;

  // 1 inside an outline and 0 outside, with an edge one pixel soft.
  float evoIn(float d) {
    float w = fwidth(d) * 0.75 + 1e-4;
    return 1.0 - smoothstep(-w, w, d);
  }
  // 1 below a height and 0 above it, a centimetre soft: for shapes seen through glass.
  float evoBelow(float edge, float y) {
    return 1.0 - smoothstep(edge - 0.012, edge + 0.012, y);
  }
  vec2 evoPoint(int i) {
    return texelFetch(uPoints, ivec2(i % ${POINT_ROW}, i / ${POINT_ROW}), 0).xy;
  }
  // How far outside an outline a point is, negative inside: the outline's points are 'count' of the pool from 'start'.
  float evoOutline(vec2 p, int start, int count) {
    vec2 vj = evoPoint(start + count - 1);
    vec2 v0 = evoPoint(start);
    float d = dot(p - v0, p - v0);
    float s = 1.0;
    for (int i = 0; i < ${MAX_OUTLINE}; i++) {
      if (i >= count) break;
      vec2 vi = evoPoint(start + i);
      vec2 e = vj - vi;
      vec2 w = p - vi;
      vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
      d = min(d, dot(b, b));
      bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
      if (all(c) || all(not(c))) s = -s;
      vj = vi;
    }
    return s * sqrt(d);
  }

  // What is seen through a pane from outside. 'at' and 'ray' are in the body's
  // own space: the far side's windows are light — whatever is beyond them —
  // and the seats, and whoever is at the wheel, are shapes against it.
  vec3 evoCabin(vec3 at, vec3 ray, vec3 view) {
    float belt = uCabin.x;
    float top = uCabin.y;
    float hw = uCabin.z;
    float lit = uCabin.w * uLamps;
    vec3 safe = vec3(ray.x >= 0.0 ? max(ray.x, 1e-4) : min(ray.x, -1e-4), ray.y >= 0.0 ? max(ray.y, 1e-4) : min(ray.y, -1e-4), ray.z >= 0.0 ? max(ray.z, 1e-4) : min(ray.z, -1e-4));
    // Where the look leaves the inside again: a side, an end, or the roof or the seats.
    float tx = ((ray.x > 0.0 ? uSeats.z : uSeats.w) - at.x) / safe.x;
    float ty = ((ray.y > 0.0 ? top + 0.08 : belt - 0.3) - at.y) / safe.y;
    float tz = ((ray.z > 0.0 ? hw : -hw) - at.z) / safe.z;
    float t = max(min(tx, min(ty, tz)), 0.0);
    vec3 leave = at + ray * t;
    float bySide = step(tz, min(tx, ty));
    float byEnd = step(tx, min(ty, tz)) * (1.0 - bySide);
    float cars = step(uSeats.x, 50.0);
    // The far side's windows, between its posts; and the screen at either end.
    float post = mix(smoothstep(0.05, 0.07, abs(fract(leave.x / 1.48) - 0.5) * 1.48), smoothstep(0.05, 0.07, abs(leave.x - uSeats.x + 0.1)), cars);
    float window = bySide * post * smoothstep(belt + 0.02, belt + 0.05, leave.y) * evoBelow(top, leave.y) * step(uSeats.w + 0.25, leave.x) * step(leave.x, uSeats.z - 0.1);
    float screen = byEnd * smoothstep(belt + 0.03, belt + 0.07, leave.y) * evoBelow(top, leave.y);
    // An upright tail has a pane in it, and that is all of it that is glass.
    screen *= mix(1.0, step(abs(leave.z), uPane.z) * step(abs(leave.y - uPane.x), uPane.y), uPane.w * step(ray.x, 0.0));
    window = max(window, screen);

    // Through two panes of tinted glass and the shade inside: the street beyond is a third of itself.
    vec3 beyond = evoStreetSeen(vEvoWorld, view, 0.0) * 0.34;
    // What it is lined with, and what light there is in there: daylight, or its own lamps.
    vec3 daylight = (uHorizon + uZenith) * 0.5;
    vec3 lining = mix(vec3(0.05, 0.05, 0.055) * daylight * 0.55, vec3(0.56, 0.6, 0.55) * (0.11 * daylight + lit * 0.4), uCabin.w);
    vec3 seen = mix(lining, beyond, window);

    float seat = 0.0;
    if (cars > 0.5) {
      float side = hw * 0.48;
      // Two seats in front and a bench behind, from ahead or astern.
      for (int k = 0; k < 2; k++) {
        float ts = ((k == 0 ? uSeats.x : uSeats.y) - at.x) / safe.x;
        if (ts > 0.0 && ts < t) {
          vec3 q = at + ray * ts;
          float off = abs(abs(q.z) - side);
          float back = (1.0 - smoothstep(hw * 0.3, hw * 0.3 + 0.02, off)) * evoBelow(belt + 0.27, q.y);
          if (k == 1) back = (1.0 - smoothstep(hw - 0.07, hw - 0.05, abs(q.z))) * evoBelow(belt + 0.2, q.y);
          float rest = (1.0 - smoothstep(0.09, 0.11, off)) * evoBelow(belt + 0.46, q.y);
          seat = max(seat, max(back, rest));
        }
      }
      // Whoever is driving: a head and shoulders, on the left.
      float td = (uSeats.x + 0.2 - at.x) / safe.x;
      if (td > 0.0 && td < t) {
        vec3 q = at + ray * td;
        vec2 head = vec2(q.z + side, q.y - belt - 0.41);
        seat = max(seat, 1.0 - smoothstep(0.095, 0.115, length(head * vec2(1.0, 0.86))));
        seat = max(seat, (1.0 - smoothstep(0.2, 0.23, abs(head.x))) * evoBelow(belt + 0.26, q.y));
      }
      // And the same from the side: a back that leans, a head rest on top of it.
      for (int k = 0; k < 2; k++) {
        float ts = ((k == 0 ? side : -side) - at.z) / safe.z;
        if (ts > 0.0 && ts < t) {
          vec3 q = at + ray * ts;
          float lean = (q.y - belt) * 0.22;
          float back = (1.0 - smoothstep(0.06, 0.08, abs(q.x - uSeats.x + lean))) * evoBelow(belt + 0.46, q.y);
          back = max(back, (1.0 - smoothstep(0.07, 0.09, abs(q.x - uSeats.y + lean))) * evoBelow(belt + 0.4, q.y));
          if (k == 1) {
            vec2 head = vec2(q.x - uSeats.x - 0.17, q.y - belt - 0.41);
            back = max(back, 1.0 - smoothstep(0.095, 0.115, length(head)));
            back = max(back, (1.0 - smoothstep(0.11, 0.13, abs(head.x + 0.05))) * evoBelow(belt + 0.27, q.y));
          }
          seat = max(seat, back);
        }
      }
    } else {
      // Rows of seats along the far side, and the lights along the ceiling.
      float row = evoBelow(belt + 0.14 + 0.2 * step(0.5, fract(leave.x / 0.76)), leave.y) * bySide;
      seat = row * 0.8;
      float ceiling = (1.0 - bySide) * (1.0 - byEnd) * step(0.0, ray.y);
      seen += vec3(0.9, 0.95, 1.0) * lit * 1.3 * ceiling * (1.0 - smoothstep(0.05, 0.08, abs(abs(leave.z) - 0.52)));
    }
    seen = mix(seen, lining * 0.3, seat);

    // A route card stood up behind the windscreen, for a minibus that has one.
    if (uCard.w > 0.5 && vCarLook.w > -0.5) {
      float tc = (uCard.x - at.x) / safe.x;
      if (tc > 0.0 && tc < t) {
        vec3 q = at + ray * tc;
        vec2 c = vec2(0.5 - (q.z - uCard.z) / (uCardSize.x * 2.0), (q.y - uCard.y) / (uCardSize.y * 2.0) + 0.5);
        if (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0) {
          vec3 card = texture2D(uSheet, vec2(uCards.x + (vCarLook.w + c.x) * uCards.z, uCards.y + c.y * uCards.w)).rgb;
          seen = card * (daylight * 0.55 + EVO_LAMP * 0.22 * uLamps);
        }
      }
    }
    return seen;
  }

  // A decal over what is there: 'q' is where on the end, 'd' how far inside its outline, 'b' its box.
  void evoDecal(float kind, vec2 q, float d, vec4 b, float cover, vec3 paint, inout vec3 base, inout float rough, inout float coat, inout float tight, inout vec3 glowing, inout float chromed) {
    vec2 size = b.zw - b.xy;
    vec2 mid = (b.xy + b.zw) * 0.5;
    // The rim of a lamp, where its lens meets the panel.
    float rim = 1.0 - smoothstep(0.002, 0.007, -d);
    vec3 look = base;
    float r = rough;
    float c = coat;
    float t = tight;
    vec3 glow = vec3(0.0);
    float chrome = 0.0;
    if (kind < 0.5) {
      // A headlamp: a clear lens over one reflector or two, in a dark house.
      // Two bowls in a lamp much wider than it is tall, the outer one the bigger; one in a squarer lamp.
      bool two = size.x > 1.5 * size.y;
      vec2 c1 = two ? vec2(mix(b.x, b.z, 0.3), mid.y - size.y * 0.04) : mid;
      vec2 c2 = two ? vec2(mix(b.x, b.z, 0.68), mid.y) : mid;
      float reach = min(size.x * (two ? 0.2 : 0.42), size.y * 0.46);
      float l1 = length(q - c1);
      float l2 = length(q - c2);
      float core = max(1.0 - smoothstep(0.0, reach, l1), 1.0 - smoothstep(0.0, reach, l2));
      // By day: a bright reflector behind clear glass, its bowls brighter still, the dark eye of a lens
      // in the middle of each with a glint in it; and the house the lamp is set in, dark, showing
      // along its foot.
      float bowl = max(1.0 - smoothstep(reach * 0.82, reach * 0.9, l1), 1.0 - smoothstep(reach * 0.82, reach * 0.9, l2));
      float bowlRim = max(1.0 - smoothstep(0.004, 0.009, abs(l1 - reach * 0.86)), 1.0 - smoothstep(0.004, 0.009, abs(l2 - reach * 0.86)));
      float eye = max(1.0 - smoothstep(reach * 0.2, reach * 0.26, l1), 1.0 - smoothstep(reach * 0.2, reach * 0.26, l2));
      float house = (1.0 - smoothstep(0.0, 0.3, (q.y - b.y) / max(size.y, 1e-3))) * (1.0 - bowl);
      look = mix(vec3(0.66, 0.67, 0.69), vec3(0.84, 0.85, 0.86), bowl);
      look = mix(look, vec3(0.94), bowlRim * 0.7);
      look = mix(look, vec3(0.16, 0.17, 0.19), eye);
      look = mix(look, vec3(0.95), step(0.95, core));
      look = mix(look, vec3(0.07, 0.07, 0.075), house * 0.75);
      look *= 1.0 - 0.6 * rim;
      r = 0.1;
      c = 1.3;
      t = 1500.0;
      // The reflector round the bowls is chrome behind the glass: it shows the sky.
      chrome = 0.3 * (1.0 - eye) * (1.0 - house) * (1.0 - rim);
      // Lit after dark; by day only the bulb behind the glass catches the light.
      glow = vec3(1.0, 0.94, 0.84) * (uLamps * (0.8 + 8.5 * core * core) + (1.0 - uLamps) * 0.06 * step(0.93, core)) * (1.0 - rim);
    } else if (kind < 1.5) {
      // A tail lamp: red glass, lit a little after dark and a lot with a foot on the brake.
      float bar = 0.5 + 0.5 * (1.0 - smoothstep(0.0, 1.0, length((q - mid) / max(size * 0.5, vec2(1e-3)))));
      look = vec3(0.24, 0.006, 0.004) * (1.0 - 0.7 * rim);
      r = 0.1;
      c = 1.3;
      t = 1500.0;
      glow = vec3(1.0, 0.028, 0.012) * (uLamps * 1.1 + vCarLit.x * 4.2) * bar * (1.0 - rim);
    } else if (kind < 2.5) {
      look = vec3(0.42, 0.17, 0.01) * (1.0 - 0.7 * rim);
      r = 0.1;
      c = 1.2;
      t = 1500.0;
    } else if (kind < 3.5) {
      look = vec3(0.4, 0.41, 0.42) * (1.0 - 0.7 * rim);
      r = 0.08;
      c = 1.3;
      t = 1500.0;
    } else if (kind < 5.5) {
      // Black plastic: slats across it, or a mesh.
      float slats = 0.5 + 0.5 * step(0.5, fract(q.y * 32.0));
      vec2 cell = fract(q * vec2(36.0, 30.0)) - 0.5;
      float mesh = 0.4 + 0.6 * step(0.16, abs(cell.x) + abs(cell.y) * 0.8);
      look = vec3(0.022, 0.022, 0.025) * (kind < 4.5 ? slats : mesh);
      r = 0.62;
      c = 0.22;
      t = 90.0;
    } else if (kind < 6.5) {
      chrome = 1.0;
    } else if (kind < 7.5) {
      look = vec3(0.012);
      r = 0.08;
      c = 1.2;
      t = 1200.0;
    } else if (kind < 8.5) {
      // A fog lamp: a small round lens with a ring round it.
      float ring = 1.0 - smoothstep(0.004, 0.009, abs(-d - 0.012));
      look = mix(vec3(0.05, 0.05, 0.055), vec3(0.5), ring);
      r = 0.08;
      c = 1.3;
      t = 1500.0;
    } else if (kind < 9.5) {
      // A running-light strip: lit, by day and by night.
      look = vec3(0.6, 0.61, 0.62);
      r = 0.1;
      c = 1.2;
      glow = vec3(1.0, 0.97, 0.92) * (1.5 * (1.0 - uLamps) + 3.2 * uLamps);
    } else if (kind < 10.5) {
      // A light bar: red, lit after dark and brighter on the brake.
      look = vec3(0.22, 0.006, 0.004);
      r = 0.1;
      c = 1.3;
      glow = vec3(1.0, 0.03, 0.012) * (uLamps * 1.3 + vCarLit.x * 3.2);
    } else if (kind < 11.5) {
      look = paint;
      r = 0.42;
      c = 1.0;
      t = 900.0;
    } else if (kind < 12.5) {
      // Where a badge would be, and is not: a plain satin blank. Not chrome —
      // a polished oval holds the sky, and a blue oval on a grille is a badge.
      look = vec3(0.3, 0.305, 0.31);
      r = 0.38;
      c = 1.0;
      t = 700.0;
    } else if (kind < 13.5) {
      look = vec3(0.025, 0.026, 0.03);
      r = 0.06;
      c = 1.4;
      t = 1500.0;
    } else if (kind < 14.5) {
      look = vec3(0.02, 0.02, 0.022);
      r = 0.65;
      c = 0.2;
      t = 90.0;
    } else if (kind < 15.5) {
      look = vec3(0.2, 0.012, 0.01);
      r = 0.2;
      c = 1.0;
      t = 400.0;
    } else {
      // A livery's white, lacquered like the paint round it.
      look = vec3(0.74, 0.75, 0.73);
      r = 0.4;
      c = 1.0;
      t = 900.0;
    }
    base = mix(base, look, cover);
    rough = mix(rough, r, cover);
    coat = mix(coat, c, cover);
    tight = mix(tight, t, cover);
    glowing = mix(glowing, glow, cover);
    chromed = mix(chromed, chrome, cover);
  }

  // What this fragment of a body is — paint, glass, black plastic, chrome, a
  // lamp — and what the street does to it.
  vec3 evoCar(vec3 paint) {
    vec3 at = vCarAt;
    vec3 n = normalize(vCarNormal);
    vec3 face = normalize(vCarFace);
    vec3 view = normalize(vEvoWorld - cameraPosition);
    // From the nose's last section back, and from the tail's forward: the domes are what is beyond them.
    float fore = uEnds.x - at.x;
    float aft = uEnds.y + at.x;
    float skin = step(vCarPart, 0.5) + step(3.5, vCarPart) * step(vCarPart, 4.5);
    float doorSide = step(0.5, vCarBody.x);

    vec3 base = paint;
    // How rough, how much of a lacquer there is over it, and how much that throws back face on.
    float rough = 0.42;
    float coat = 1.0;
    float f0 = 0.05;
    float tight = 900.0;
    vec3 glowing = vec3(0.0);
    float chromed = 0.0;
    if (vCarPart > 3.5 && vCarPart < 4.5) base = uSecond;

    // A pane in an upright tail, where it has one.
    float paneD = 1.0;
    {
      vec2 pp = abs(vec2(at.z, at.y - uPane.x)) - uPane.zy + 0.06;
      paneD = length(max(pp, 0.0)) + min(max(pp.x, pp.y), 0.0) - 0.06;
    }
    float paneHere = step(0.6, -face.x) * skin * uPane.w;
    float pane = step(paneD, 0.0) * paneHere;
    float seal = (1.0 - smoothstep(0.0, 0.016, abs(paneD))) * paneHere;

    if (vCarPart > 2.5 && vCarPart < 3.5) {
      base = vec3(0.006);
      rough = 1.0;
      coat = 0.0;
    } else if (vCarPart > 1.5 && vCarPart < 2.5) {
      base = vec3(0.022, 0.022, 0.025);
      rough = 0.62;
      coat = 0.22;
      tight = 90.0;
    } else if ((vCarPart > 0.5 && vCarPart < 1.5) || pane > 0.5) {
      // Glass: nothing of its own but what is behind it and what is in it.
      glowing = evoCabin(at, normalize(vCarAt - vCarEye), view) * (1.0 - seal);
      base = vec3(0.0);
      rough = 0.06;
      coat = 1.0 - 0.8 * seal;
      f0 = 0.07;
      tight = 1500.0;
    } else if (vCarPart > 4.5) {
      // The band the side windows are in: glass inside the daylight opening, in its frame; the pillars
      // across it black or the body's colour; outside it, the body.
      float d = evoOutline(at.xy, int(uWindow.x), int(uWindow.y));
      float rise = clamp((at.y - uCabin.x) / max(uCabin.y - uCabin.x, 0.1), 0.0, 1.0);
      float bar = 0.0;
      float black = 0.0;
      for (int k = 0; k < 4; k++) {
        vec4 bb = uBars[k];
        if (bb.z <= 0.0) continue;
        float inBar = evoIn(abs(at.x - mix(bb.x, bb.y, rise)) - bb.z);
        bar = max(bar, inBar);
        black = max(black, inBar * bb.w);
      }
      float opening = evoIn(d);
      float glassIn = evoIn(d + uWindow.z) * (1.0 - bar);
      float frame = opening * (1.0 - glassIn) * (1.0 - bar);
      if (glassIn > 0.001) glowing = evoCabin(at, normalize(vCarAt - vCarEye), view) * glassIn;
      // The pillars: black glass-like, or paint.
      base = mix(base, vec3(0.012), black * opening);
      rough = mix(rough, 0.08, black * opening);
      // The frame: black rubber, or chrome.
      base = mix(base, vec3(0.022, 0.022, 0.025), frame * (1.0 - uWindow.w));
      rough = mix(rough, 0.55, frame * (1.0 - uWindow.w));
      coat = mix(coat, 0.3, frame * (1.0 - uWindow.w));
      chromed = max(chromed, frame * uWindow.w);
      // The glass.
      base = mix(base, vec3(0.0), glassIn);
      rough = mix(rough, 0.06, glassIn);
      f0 = mix(f0, 0.07, glassIn);
      tight = mix(tight, 1500.0, glassIn);
    } else {
      // The skin: doors, their handles, the lids, a strip down the side, plastic round the arches.
      vec4 gaps = abs(vec4(at.x) - uDoorsAt);
      float gap = min(min(gaps.x, gaps.y), min(gaps.z, gaps.w));
      float seam = (1.0 - smoothstep(0.003, 0.003 + fwidth(at.x) * 1.2, gap)) * doorSide;
      vec3 latch = vec3(at.x) - uDoorsAt.yzw;
      vec3 grip = step(vec3(0.06), latch) * step(latch, vec3(0.25));
      float handle = max(grip.x, max(grip.y, grip.z)) * doorSide * smoothstep(0.79, 0.805, vCarBody.y) * (1.0 - smoothstep(0.86, 0.875, vCarBody.y));
      // A sliding door hangs from a rail along the side behind it, under the windows.
      float rail = uSlide.z * doorSide * step(0.0, at.z) * step(0.92, vCarBody.y) * step(at.x, uSlide.x) * step(-uEnds.y + 0.12, at.x);
      // A strip along the doors, between the arches: black rubber, or chrome.
      float strip = step(0.0, uDetail.x) * doorSide * (1.0 - smoothstep(0.035, 0.045, abs(vCarBody.y - uDetail.x))) * step(uAxle.y + uAxle.z + 0.12, at.x) * step(at.x, uAxle.x - uAxle.z - 0.12);
      // A bonnet and a boot: the gap down either edge of each, and across the front of the bonnet.
      float upward = smoothstep(0.45, 0.7, face.y) * skin;
      float lidEdge = 1.0 - smoothstep(0.003, 0.003 + fwidth(at.z) * 1.2, abs(abs(at.z) - uLids.z));
      float lidFront = (1.0 - smoothstep(0.003, 0.003 + fwidth(at.x) * 1.2, abs(fore - 0.17))) * step(abs(at.z), uLids.z) * step(uLids.x, at.x);
      float lid = max(lidEdge * max(step(uLids.x, at.x) * step(0.17, fore), step(at.x, uLids.y) * step(0.12, aft)), lidFront) * upward;
      // Black plastic round the arches and along the skirts, on what has it.
      float arch = min(length(vec2(at.x - uAxle.x, at.y - uAxle.z)), length(vec2(at.x - uAxle.y, at.y - uAxle.z))) - uAxle.z - ${ARCH_GAP.toFixed(3)};
      float clad = uAxle.w * skin * max((1.0 - smoothstep(0.062, 0.07, arch)) * step(0.35, abs(face.z)), 1.0 - smoothstep(uEnds.w + 0.19, uEnds.w + 0.2, at.y));

      seam = max(seam, lid);
      // A handle flush with the skin is a slot in it, not a lump on it.
      float grab = handle * mix(0.85, 0.45, uDetail.z);
      base = mix(base * (1.0 - 0.8 * seam), vec3(0.03), grab);
      coat *= 1.0 - seam;
      float plastic = max(clad, strip * (1.0 - uDetail.y));
      base = mix(base, vec3(0.022, 0.022, 0.025), plastic);
      rough = mix(rough, 0.62, plastic);
      coat = mix(coat, 0.22, plastic);
      tight = mix(tight, 90.0, plastic);
      chromed = max(chromed, strip * uDetail.y);
      base = mix(base, vec3(0.02), rail);

      // ---- what is drawn on the ends: the outlines, unwrapped round the end this is nearer.
      // A lamp comes round its corner, but not up over the top of it.
      float notTop = 1.0 - smoothstep(0.78, 0.94, face.y);
      if (skin > 0.5 && notTop > 0.01) {
        bool nose = at.x >= 0.0;
        vec2 q = vec2(abs(at.z) + max((nose ? uEnds.x : uEnds.y) - abs(at.x), 0.0), at.y);
        int first = nose ? int(uDecalRange.x) : int(uDecalRange.z);
        int count = nose ? int(uDecalRange.y) : int(uDecalRange.w);
        float face01 = step(0.5, vCarLook.x);
        for (int k = 0; k < ${MAX_DECALS}; k++) {
          if (k >= count) break;
          vec4 a = uDecalA[first + k];
          vec4 b = uDecalB[first + k];
          if (q.x < b.x - 0.01 || q.x > b.z + 0.01 || q.y < b.y - 0.01 || q.y > b.w + 0.01) continue;
          if (a.w > -0.5 && abs(a.w - face01) > 0.5) continue;
          float d = evoOutline(q, int(a.x), int(a.y));
          float cover = evoIn(d) * notTop;
          if (cover <= 0.001) continue;
          evoDecal(a.z, q, d, b, cover, paint, base, rough, coat, tight, glowing, chromed);
        }
      }
      base *= 1.0 - 0.75 * seal;
    }

    // Chrome: dark in itself, and all reflection.
    base = mix(base, vec3(0.05), chromed);
    rough = mix(rough, 0.12, chromed);
    coat = mix(coat, 1.8, chromed);
    f0 = mix(f0, 0.62, chromed);
    tight = mix(tight, 400.0, chromed);

    // Fifty summers on the paint: chalky, and nothing like a shine left on it.
    float fade = vCarLook.z * skin * (1.0 - chromed) * (1.0 - step(0.001, length(glowing)));
    base = mix(base, base * 0.8 + vec3(0.06, 0.058, 0.052), fade * 0.55);
    coat *= 1.0 - 0.72 * fade;
    rough = mix(rough, 0.7, fade);
    // And the road on it, low down, in patches.
    float low = 1.0 - smoothstep(0.14, 0.62, at.y);
    float glassy = step(0.5, vCarPart) * step(vCarPart, 1.5);
    float dust = vCarLook.y * low * (0.45 + 0.55 * evoNoise(vec2(at.x * 5.0 + at.z * 3.0, at.y * 9.0))) * (1.0 - glassy);
    base = mix(base, vec3(0.32, 0.29, 0.245), dust * 0.62);
    coat *= 1.0 - 0.85 * dust;
    rough = mix(rough, 0.85, dust);

    // A face seen from behind — the far side of a wheel arch — reflects nothing.
    float facing = step(dot(view, n), 0.0);
    vec3 r = reflect(view, n);
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(-view, n), 0.0, 1.0), 5.0);
    vec3 fall;
    vec3 shine;
    evoLamps(vEvoWorld, n, r, tight, fall, shine);
    // Lamps as light on it, then the street and its lamps as things seen in it.
    evoCarGlow = glowing + base * fall * uLamps;
    evoCarGlow += (evoStreetSeen(vEvoWorld, r, 1.0) * fresnel + shine * uLamps * (0.6 + 6.0 * fresnel)) * coat * facing;
    // And the lamps of whatever is behind it, on the back of it: low, and from astern.
    evoCarGlow += base * vec3(1.0, 0.93, 0.8) * (vCarLit.y * uLamps * max(-face.x, 0.0) * (1.0 - smoothstep(0.45, 1.5, at.y)));
    evoCarRough = rough;
    return base;
  }
`

/** The atlas the plates, the bus signs and the route cards are drawn on. */
const SHEET = { width: 1024, height: 512 } as const
/** Where a tile is on it, for a shader: its corner in texture space (which counts up from the bottom), and its size. */
const tileOn = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x / SHEET.width, 1 - (y + h) / SHEET.height, w / SHEET.width, h / SHEET.height]
const PLATE_TILE = { width: 256, height: 55 } as const
const SIGN_TILE = { x: 512, width: 512, height: 90 } as const
const CARD_TILE = { y: 240, width: 128, height: 86 } as const
const TAXI_TILE = { x: 512, y: 240, width: 128, height: 64 } as const
const RACK_TILE = { x: 656, y: 240, width: 32, height: 32 } as const
const plateTile = (tile: number) => tileOn((tile % 2) * PLATE_TILE.width, Math.floor(tile / 2) * PLATE_TILE.height, PLATE_TILE.width, PLATE_TILE.height)
const signTile = (sign: number) => tileOn(SIGN_TILE.x, sign * SIGN_TILE.height, SIGN_TILE.width, SIGN_TILE.height)

/** What a body's decals and windows are drawn from: their outlines' points, in a small texture, and the rest as uniforms. */
function outlines(shape: VehicleShape): { points: DataTexture; range: Vector4; a: Vector4[]; b: Vector4[]; window: Vector4; bars: Vector4[] } {
  const pool: number[] = []
  const put = (outline: readonly Pt[]): number => {
    const start = pool.length / 2
    for (const [u, y] of outline) pool.push(u, y)
    return start
  }
  const ordered = [...shape.decals.filter((decal) => decal.end > 0), ...shape.decals.filter((decal) => decal.end < 0)]
  const a: Vector4[] = []
  const b: Vector4[] = []
  for (const decal of ordered) {
    const start = put(decal.at)
    const us = decal.at.map((p) => p[0])
    const ys = decal.at.map((p) => p[1])
    a.push(new Vector4(start, decal.at.length, DECAL_KINDS.indexOf(decal.kind), decal.face ?? -1))
    b.push(new Vector4(Math.min(...us), Math.min(...ys), Math.max(...us), Math.max(...ys)))
  }
  while (a.length < MAX_DECALS) {
    a.push(new Vector4(0, 0, 0, -1))
    b.push(new Vector4(1e3, 1e3, -1e3, -1e3))
  }
  const noses = shape.decals.filter((decal) => decal.end > 0).length
  const range = new Vector4(0, noses, noses, shape.decals.length - noses)
  let window = new Vector4(0, 0, 0, 0)
  const bars: Vector4[] = []
  if (shape.windows) {
    const start = put(shape.windows.outline)
    window = new Vector4(start, shape.windows.outline.length, shape.windows.frame ?? 0.01, shape.windows.chrome ? 1 : 0)
    for (const [xb, xt, half, black] of shape.windows.bars) bars.push(new Vector4(xb, xt, half, black))
  }
  while (bars.length < 4) bars.push(new Vector4(0, 0, 0, 0))
  const rows = Math.max(1, Math.ceil(pool.length / 2 / POINT_ROW))
  const data = new Float32Array(POINT_ROW * rows * 4)
  for (let i = 0; i < pool.length / 2; i++) {
    data[i * 4] = pool[i * 2]!
    data[i * 4 + 1] = pool[i * 2 + 1]!
    data[i * 4 + 3] = 1
  }
  const points = new DataTexture(data, POINT_ROW, rows, RGBAFormat, FloatType)
  points.minFilter = NearestFilter
  points.magFilter = NearestFilter
  points.generateMipmaps = false
  points.needsUpdate = true
  return { points, range, a, b, window, bars }
}

function bodyUniforms(shape: VehicleShape, sheet: Texture): { uniforms: Record<string, { value: unknown }>; points: DataTexture } {
  const doors = [99, 99, 99, 99]
  shape.doors.slice(0, 4).forEach((x, k) => {
    doors[k] = x
  })
  const pane = shape.backPane
  const cabin = shape.cabin
  const glass = shape.glass
  // How much of it is ahead of the windscreen and behind the rear screen: a bonnet, and a boot if it is a sedan.
  const bonnet = shape.length / 2 - glass.front[0]
  const boot = glass.rear ? shape.length / 2 + glass.rear[1] : 0
  const card = shape.card
  const cards = tileOn(0, CARD_TILE.y, CARD_TILE.width, CARD_TILE.height)
  const drawn = outlines(shape)
  return {
    points: drawn.points,
    uniforms: {
      uSecond: { value: new Color(SECOND) },
      uDoorsAt: { value: new Vector4(...doors) },
      uEnds: { value: new Vector4(...rimOf(shape), 0, shape.clearance) },
      uPane: { value: pane ? new Vector4(pane.y, pane.tall / 2, pane.wide / 2, 1) : new Vector4(0, 0, 0, 0) },
      uCabin: { value: new Vector4(cabin.belt, cabin.top, cabin.half, cabin.lit ? 1 : 0) },
      uSeats: { value: new Vector4(cabin.seats?.[0] ?? 99, cabin.seats?.[1] ?? 99, cabin.front, cabin.rear) },
      uAxle: { value: new Vector4(shape.axles[0], shape.axles[1], shape.wheel.radius, shape.cladding ? 1 : 0) },
      uLids: { value: new Vector3(bonnet > 0.5 ? glass.front[0] + 0.03 : 99, boot > 0.45 && glass.rear ? glass.rear[1] - 0.03 : -99, shape.width * 0.39) },
      uDetail: { value: new Vector4(shape.strip ?? -1, shape.stripChrome ? 1 : 0, shape.flushHandles ? 1 : 0, 0) },
      uSlide: { value: shape.slidingDoor ? new Vector3(shape.slidingDoor[0], shape.slidingDoor[1], 1) : new Vector3(0, 0, 0) },
      uCard: { value: card ? new Vector4(card.x, card.y, card.z, 1) : new Vector4(0, 0, 0, 0) },
      uCardSize: { value: new Vector2((card?.wide ?? 0) / 2, (card?.tall ?? 0) / 2) },
      uCards: { value: new Vector4(...cards) },
      uSheet: { value: sheet },
      uPoints: { value: drawn.points },
      uDecalRange: { value: drawn.range },
      uDecalA: { value: drawn.a },
      uDecalB: { value: drawn.b },
      uWindow: { value: drawn.window },
      uBars: { value: drawn.bars },
    },
  }
}

/**
 * The material of one of the bodies. They are the one program — the text is
 * the same for all of them — and a set of numbers each.
 */
function makeBodyMaterial(air: Air, shared: { uLamps: { value: number } }, shape: VehicleShape, sheet: Texture): { material: MeshStandardMaterial; points: DataTexture } {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.42, metalness: 0 })
  const { uniforms: own, points } = bodyUniforms(shape, sheet)
  inAir(material, air, 'car', (shader) => {
    Object.assign(shader.uniforms, lightUniforms(air, shared), own)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute float aPart;
        attribute vec2 aBody;
        attribute vec2 aLit;
        attribute vec4 aLook;
        varying float vCarPart;
        varying vec2 vCarBody;
        varying vec3 vCarNormal;
        varying vec3 vCarFace;
        varying vec3 vCarAt;
        varying vec3 vCarEye;
        varying vec2 vCarLit;
        varying vec4 vCarLook;`,
      )
      .replace(
        '#include <defaultnormal_vertex>',
        /* glsl */ `#include <defaultnormal_vertex>
        vCarPart = aPart;
        vCarBody = aBody;
        vCarLit = aLit;
        vCarLook = aLook;
        vCarFace = objectNormal;
        vCarAt = position;
        ${WORLD_NORMAL}
        // Where the camera is, as the body sees it: it is only ever moved and turned, never stretched.
        vec3 evoEye = cameraPosition - evoBody[3].xyz;
        vCarEye = vec3(dot(evoEye, evoBody[0].xyz), dot(evoEye, evoBody[1].xyz), dot(evoEye, evoBody[2].xyz));`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${BODY_FRAG}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = evoCar(diffuseColor.rgb);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = evoCarRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += evoCarGlow;')
  })
  return { material, points }
}

/** What each body's instances carry besides where they are: their paint, their lights, their look. */
interface BodyBatch {
  mesh: InstancedMesh
  color: InstancedBufferAttribute
  lit: InstancedBufferAttribute
  look: InstancedBufferAttribute
  /** How many it is drawing this frame. */
  used: number
}

function bodyGeometry(kind: VehicleKind, detail: BodyDetail, capacity: number): { geometry: BufferGeometry; lit: InstancedBufferAttribute; look: InstancedBufferAttribute } {
  const { draw } = vehicleMesh(kind, detail)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(draw.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(draw.normal, 3))
  geometry.setAttribute('aPart', new BufferAttribute(draw.part, 1))
  geometry.setAttribute('aBody', new BufferAttribute(draw.body, 2))
  geometry.setIndex(new BufferAttribute(draw.index, 1))
  // Numbers to each of them, changed as they drive: how hard the brake lights are on, and how near the lamps of the one behind are;
  // and how it looks: which face, how dusty, how faded, which route card.
  const lit = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(DynamicDrawUsage)
  const look = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage)
  geometry.setAttribute('aLit', lit)
  geometry.setAttribute('aLook', look)
  return { geometry, lit, look }
}

// ------------------------------------------------------------------ wheels

const WHEEL_FRAG = /* glsl */ `
  varying vec3 vWheelAt;
  varying vec3 vCarNormal;
  varying float vWheelStyle;
  ${EVO_NOISE}
  ${STREET_LIGHT}

  float evoWheelRough;
  vec3 evoWheelGlow;

  // A wheel: a tyre round what each kind of car has on it — a plain steel
  // wheel, a plastic cover over one, alloy spokes, many thin spokes, a steel
  // wheel with a chrome cap, a bus's steel wheel with its studs.
  vec3 evoWheel() {
    float rr = length(vWheelAt.xy);
    float face = step(0.4, abs(vWheelAt.z));
    float angle = atan(vWheelAt.y, vWheelAt.x);
    float around = angle / 6.2831853;
    float disc = face * (1.0 - smoothstep(0.66, 0.69, rr));
    vec3 rubber = vec3(0.016) * (0.8 + 0.4 * step(0.5, fract(vWheelAt.z * 9.0)) * (1.0 - face));
    vec3 metal;
    float shiny;
    float style = vWheelStyle;
    if (style < 0.5) {
      // Steel, painted silver, a ring of holes and a small cap.
      float holes = (1.0 - smoothstep(0.05, 0.065, length(vec2(abs(fract(around * 6.0) - 0.5) * rr * 1.05, rr - 0.46))));
      metal = mix(vec3(0.3, 0.31, 0.32), vec3(0.02), holes);
      metal = mix(metal, vec3(0.45), 1.0 - smoothstep(0.16, 0.18, rr));
      shiny = 0.4 * (1.0 - holes);
    } else if (style < 1.5) {
      // A plastic cover: silver, slotted, a flat middle.
      float slot = step(0.62, abs(fract(around * 10.0) - 0.5) * 2.0) * smoothstep(0.3, 0.34, rr) * (1.0 - smoothstep(0.56, 0.6, rr));
      metal = mix(vec3(0.38, 0.39, 0.41), vec3(0.025), slot);
      metal *= 0.85 + 0.15 * smoothstep(0.2, 0.3, rr);
      shiny = 0.5 * (1.0 - slot);
    } else if (style < 2.5) {
      // Five spokes, the dark of the brake between them.
      float spoke = abs(fract(around * 5.0) - 0.5) * 2.0;
      float between = smoothstep(0.42, 0.62, spoke) * smoothstep(0.2, 0.26, rr) * (1.0 - smoothstep(0.54, 0.6, rr));
      metal = mix(vec3(0.42, 0.43, 0.45), vec3(0.03, 0.03, 0.034), between);
      metal += vec3(0.16) * smoothstep(0.6, 0.66, rr) * (1.0 - between);
      shiny = 1.0 - between;
    } else if (style < 3.5) {
      // Many thin spokes, two-tone.
      float spoke = abs(fract(around * 10.0) - 0.5) * 2.0;
      float between = smoothstep(0.55, 0.7, spoke) * smoothstep(0.18, 0.24, rr) * (1.0 - smoothstep(0.57, 0.62, rr));
      metal = mix(vec3(0.46, 0.47, 0.49), vec3(0.02), between);
      metal = mix(metal, vec3(0.08, 0.08, 0.09), step(0.5, fract(around * 5.0 + 0.25)) * (1.0 - between) * 0.6);
      shiny = 1.0 - between;
    } else if (style < 4.5) {
      // Black steel, slots round it, and a chrome cap over the middle.
      float slot = step(0.7, abs(fract(around * 8.0) - 0.5) * 2.0) * smoothstep(0.48, 0.5, rr) * (1.0 - smoothstep(0.58, 0.6, rr));
      metal = mix(vec3(0.04), vec3(0.005), slot);
      float cap = 1.0 - smoothstep(0.43, 0.45, rr);
      metal = mix(metal, vec3(0.6, 0.61, 0.63), cap);
      shiny = cap;
    } else {
      // A bus's: grey steel, the ring of studs, the hub.
      float studs = 1.0 - smoothstep(0.03, 0.04, length(vec2(abs(fract(around * 10.0) - 0.5) * rr * 0.63, rr - 0.3)));
      metal = mix(vec3(0.12, 0.13, 0.14), vec3(0.4), studs);
      metal = mix(metal, vec3(0.05), smoothstep(0.5, 0.52, rr) * (1.0 - smoothstep(0.6, 0.62, rr)));
      shiny = 0.2 + 0.6 * studs;
    }
    // The lip of the rim catches the light, whatever is inside it.
    metal += vec3(0.12) * smoothstep(0.62, 0.66, rr) * step(style, 3.5);
    vec3 base = mix(rubber, metal, disc);
    shiny *= disc;

    vec3 n = normalize(vCarNormal);
    vec3 view = normalize(vEvoWorld - cameraPosition);
    vec3 r = reflect(view, n);
    vec3 fall;
    vec3 shine;
    evoLamps(vEvoWorld, n, r, 60.0, fall, shine);
    evoWheelGlow = base * fall * uLamps + shine * uLamps * 0.5 * shiny + evoStreetSeen(vEvoWorld, r, 0.0) * 0.1 * shiny;
    evoWheelRough = mix(0.92, 0.38, shiny);
    return base;
  }
`

function makeWheelMaterial(air: Air, shared: { uLamps: { value: number } }): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 })
  return inAir(material, air, 'wheel', (shader) => {
    Object.assign(shader.uniforms, lightUniforms(air, shared))
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWheel;\nvarying vec3 vWheelAt;\nvarying vec3 vCarNormal;\nvarying float vWheelStyle;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>\nvWheelAt = position;\nvWheelStyle = aWheel;\n${WORLD_NORMAL}`)
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${WHEEL_FRAG}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = evoWheel();')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = evoWheelRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += evoWheelGlow;')
  })
}

/** A wheel a metre in radius and a metre wide, on the z axis: the instance makes it the size it is. Close up round, far off less so. */
function wheelGeometry(segments: number): BufferGeometry {
  // Half the section of a tyre on its rim, from the hub out and round the shoulder.
  const profile = [
    [0, 0.4],
    [0.6, 0.4],
    [0.66, 0.5],
    [0.86, 0.5],
    [0.96, 0.44],
    [1, 0.3],
    [1, -0.3],
    [0.96, -0.44],
    [0.86, -0.5],
    [0.66, -0.5],
    [0.6, -0.4],
    [0, -0.4],
  ].map(([r, z]) => new Vector2(r, z))
  const geometry = new LatheGeometry(profile, segments)
  // Turned about y as three makes it; a wheel turns about the axle, which is z here.
  geometry.rotateX(Math.PI / 2)
  return geometry
}

// ------------------------------------------------------------------ plates

/** Where a plate goes: on the front, on the back with a lamp over it, or lit from inside. */
const PLATE = { front: 0, back: 1, sign: 2 } as const
/** A plate is this size everywhere in the country, in metres; and a bus's sign is this size here. */
const PLATE_SIZE = { wide: 0.52, tall: 0.112 } as const
const SIGN_SIZE = { wide: 1.72, tall: 0.3 } as const

const FONT = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace'

/**
 * The sheet everything with writing on it is drawn from, once: the number
 * plates — white, a black edge, a strip at the left with the flag's three
 * bands and the country's letters, a region, then letters and numbers — the
 * buses' signs in amber lamps, and the minibuses' route cards. Every string
 * on it comes from `evoCarText.ts`.
 */
function drawSheet(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d')
  if (!g) return
  g.fillStyle = '#16171a'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  const w = PLATE_TILE.width
  const h = PLATE_TILE.height
  plateTexts().forEach((plate, tile) => {
    const x = (tile % 2) * w
    const y = Math.floor(tile / 2) * h
    g.fillStyle = '#0b0b0c'
    g.fillRect(x, y, w, h)
    g.fillStyle = '#f4f4f1'
    g.fillRect(x + 3, y + 3, w - 6, h - 6)
    // The strip at the left: blue, white and green with a thread of red between, and the country's letters under them.
    const strip = w * 0.1
    const band = h * 0.1
    const top = y + h * 0.18
    g.fillStyle = '#0a9bb8'
    g.fillRect(x + 8, top, strip - 4, band)
    g.fillStyle = '#c8202b'
    g.fillRect(x + 8, top + band, strip - 4, band * 0.18)
    g.fillStyle = '#ffffff'
    g.fillRect(x + 8, top + band * 1.18, strip - 4, band)
    g.fillStyle = '#c8202b'
    g.fillRect(x + 8, top + band * 2.18, strip - 4, band * 0.18)
    g.fillStyle = '#1eb04b'
    g.fillRect(x + 8, top + band * 2.36, strip - 4, band)
    g.fillStyle = '#111111'
    g.font = `700 ${Math.round(h * 0.2)}px ${FONT}`
    g.fillText(COUNTRY, x + 6 + strip / 2, y + h * 0.76)
    // The region, a line, and the number.
    g.font = `700 ${Math.round(h * 0.58)}px ${FONT}`
    g.fillText(plate.region, x + w * 0.215, y + h * 0.55)
    g.fillRect(x + w * 0.3, y + 3, 2, h - 6)
    g.fillText(plate.number, x + w * 0.655, y + h * 0.55)
  })
  // What a bus says on its front, in amber lamps.
  SIGN_TEXTS.forEach(([route, to], k) => {
    const x = SIGN_TILE.x
    const y = k * SIGN_TILE.height
    g.fillStyle = '#050505'
    g.fillRect(x, y, SIGN_TILE.width, SIGN_TILE.height)
    g.fillStyle = '#ffb21e'
    g.font = `700 ${Math.round(SIGN_TILE.height * 0.62)}px ${FONT}`
    g.fillText(`${route}  ${to}`, x + SIGN_TILE.width / 2, y + SIGN_TILE.height * 0.54)
    // The dark between the lamps.
    g.fillStyle = '#050505'
    for (let line = 0; line < SIGN_TILE.height; line += 4) g.fillRect(x, y + line, SIGN_TILE.width, 1)
    for (let line = 0; line < SIGN_TILE.width; line += 4) g.fillRect(x + line, y, 1, SIGN_TILE.height)
  })
  // A taxi's roof light: yellow, a band of black and white squares round it, no word on it.
  {
    const { x, y, width, height } = TAXI_TILE
    g.fillStyle = '#e8b51c'
    g.fillRect(x, y, width, height)
    const square = height / 4
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < width / square; col++) {
        g.fillStyle = (row + col) % 2 === 0 ? '#111111' : '#f4f2ea'
        g.fillRect(x + col * square, y + height / 4 + row * square, square, square)
      }
    }
  }
  // Dark metal, for the racks.
  g.fillStyle = '#26282b'
  g.fillRect(RACK_TILE.x, RACK_TILE.y, RACK_TILE.width, RACK_TILE.height)
  // The route cards: a white card, a red line along the top, the number big.
  for (let k = 0; k < CARD_COUNT; k++) {
    const x = k * CARD_TILE.width
    const y = CARD_TILE.y
    g.fillStyle = '#f2f1ea'
    g.fillRect(x, y, CARD_TILE.width, CARD_TILE.height)
    g.fillStyle = '#c42a24'
    g.fillRect(x, y, CARD_TILE.width, CARD_TILE.height * 0.16)
    g.fillStyle = '#101010'
    g.font = `800 ${Math.round(CARD_TILE.height * 0.62)}px ${FONT}`
    g.fillText(CARD_TEXTS[k] ?? '', x + CARD_TILE.width / 2, y + CARD_TILE.height * 0.6)
  }
}

function sheetTexture(): { texture: Texture; stop: () => void } {
  if (typeof document === 'undefined') return { texture: new DataTexture(new Uint8Array([240, 240, 236, 255]), 1, 1), stop: () => {} }
  const canvas = document.createElement('canvas')
  canvas.width = SHEET.width
  canvas.height = SHEET.height
  drawSheet(canvas)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 4
  // The site's face may not have arrived when the sheet is first drawn: draw it again once it has.
  let live = true
  document.fonts?.load(`700 20px ${FONT}`).then(
    () => {
      if (!live) return
      drawSheet(canvas)
      texture.needsUpdate = true
    },
    () => undefined,
  )
  return {
    texture,
    stop: () => {
      live = false
    },
  }
}

const PLATE_FRAG = /* glsl */ `
  uniform sampler2D uPlates;
  varying vec2 vPlateUv;
  varying vec4 vPlate;
  varying float vPlateKind;
  varying vec3 vCarNormal;
  ${EVO_NOISE}
  ${STREET_LIGHT}

  vec3 evoPlateGlow;

  vec3 evoPlate() {
    // Read from its own left, which is not the left of the side it is looked at from.
    vec3 base = texture2D(uPlates, vPlate.xy + vec2(1.0 - vPlateUv.x, vPlateUv.y) * vPlate.zw).rgb;
    vec3 n = normalize(vCarNormal);
    vec3 fall;
    vec3 shine;
    evoLamps(vEvoWorld, n, n, 8.0, fall, shine);
    float board = step(1.5, vPlateKind);
    // A plate at the back has a lamp of its own over it; a bus's sign is nothing but lamps.
    evoPlateGlow = base * (fall + vec3(0.9, 0.92, 1.0) * 0.5 * step(0.5, vPlateKind)) * uLamps * (1.0 - board) + base * board * (0.7 + 2.4 * uLamps);
    return base * (1.0 - board);
  }
`

function makePlateMaterial(air: Air, shared: { uLamps: { value: number } }, sheet: Texture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0 })
  return inAir(material, air, 'plate', (shader) => {
    Object.assign(shader.uniforms, lightUniforms(air, shared), { uPlates: { value: sheet } })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPlate;\nattribute float aPlateKind;\nvarying vec2 vPlateUv;\nvarying vec4 vPlate;\nvarying float vPlateKind;\nvarying vec3 vCarNormal;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>\nvPlateUv = uv;\nvPlate = aPlate;\nvPlateKind = aPlateKind;\n${WORLD_NORMAL}`)
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${PLATE_FRAG}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = evoPlate();')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += evoPlateGlow;')
  })
}

/** A square that faces along the car, a metre each way, for anything flat on an end of one. */
function facingGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5]), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
  geometry.setIndex([0, 2, 1, 0, 3, 2])
  return geometry
}

// ------------------------------------------------------- on top of some of them

/**
 * A roof rack: two rails on four feet and three bars across, a metre and a bit
 * long. It and the taxis' lights are drawn with the plates' program, from a
 * tile of the same sheet each: a program fewer to build is seconds where WebGL
 * is drawn by the CPU.
 */
function rackGeometry(): BufferGeometry {
  const pieces: BufferGeometry[] = []
  const bar = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const box = new BoxGeometry(sx, sy, sz)
    box.translate(x, y, z)
    pieces.push(box)
  }
  for (const z of [-0.52, 0.52]) {
    bar(1.16, 0.03, 0.03, 0, 0.09, z)
    for (const x of [-0.5, 0.5]) bar(0.04, 0.09, 0.04, x, 0.045, z)
  }
  for (const x of [-0.42, 0, 0.42]) bar(0.025, 0.02, 1.04, x, 0.1, 0)
  // One geometry of all of them.
  let count = 0
  for (const piece of pieces) count += piece.getAttribute('position').count
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const uv = new Float32Array(count * 2)
  const index: number[] = []
  let at = 0
  for (const piece of pieces) {
    position.set(piece.getAttribute('position').array as Float32Array, at * 3)
    normal.set(piece.getAttribute('normal').array as Float32Array, at * 3)
    uv.set(piece.getAttribute('uv').array as Float32Array, at * 2)
    for (const i of piece.getIndex()!.array) index.push(i + at)
    at += piece.getAttribute('position').count
    piece.dispose()
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setIndex(index)
  return geometry
}

// ------------------------------------------------- what lies on the road

/** A square on the road, a metre each way: the dark under a car, the light ahead of it. */
function groundGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
  geometry.setIndex([0, 2, 1, 0, 3, 2])
  return geometry
}

/**
 * What lies on the road, and the glow round a lamp, fade into the haze with
 * distance as everything else does: by how much air there is between.
 */
const THROUGH_AIR = /* glsl */ `
  uniform vec4 uAir;
  varying float vClear;
`

const GROUND_VERT = /* glsl */ `
  ${THROUGH_AIR}
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vClear = exp(-uAir.x * distance(world.xyz, cameraPosition));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

/**
 * The dark a car keeps under itself: what makes it stand on the road rather
 * than over it. The square is the car's own outline and a margin round it;
 * 'vInner' is how much of the square is as dark as it gets, which is less
 * than the outline — the sky gets a little way in under the edges of a car.
 */
const UNDER_VERT = /* glsl */ `
  ${THROUGH_AIR}
  varying vec2 vUv;
  varying vec2 vInner;
  void main() {
    vUv = uv;
    vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
    vInner = max(size - ${((UNDER_OUT + UNDER_IN) * 2).toFixed(2)}, vec2(0.0)) / max(size, vec2(1e-3));
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vClear = exp(-uAir.x * distance(world.xyz, cameraPosition));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
const UNDER_FRAG = /* glsl */ `
  uniform float uDark;
  varying vec2 vUv;
  varying vec2 vInner;
  varying float vClear;
  void main() {
    vec2 p = abs(vUv - 0.5) * 2.0;
    // Darkest under the middle of it, and gone by the edge of the margin.
    vec2 q = max(p - vInner, 0.0) / max(1.0 - vInner, vec2(1e-3));
    float under = clamp(1.0 - smoothstep(0.0, 1.0, length(q)), 0.0, 1.0);
    gl_FragColor = vec4(vec3(0.0), under * sqrt(under) * uDark * vClear);
  }
`

/** What headlamps throw on the road: two pools that open out and run into one. */
const BEAM_FRAG = /* glsl */ `
  uniform float uLamps;
  varying vec2 vUv;
  varying float vClear;
  void main() {
    float along = vUv.x;
    float across = (vUv.y - 0.5) * 2.0;
    float spread = mix(0.34, 1.0, along);
    // (Squared by hand, and nothing raised to a power that might be below nothing: that is not a number, and one of those in a frame is a white bar across it.)
    float off = (abs(across) - 0.2 * (1.0 - along)) / (spread * 0.52);
    float pool = exp(-off * off);
    float fade = clamp(1.0 - along, 0.0, 1.0);
    float beam = pool * smoothstep(0.0, 0.07, along) * fade * sqrt(fade);
    gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * beam * 0.34 * uLamps * vClear, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * And, where the frame is given no glow afterwards, the glow itself: a soft
 * disc that faces the camera, brightest looked at from in front.
 */
const HALO_VERT = /* glsl */ `
  ${THROUGH_AIR}
  uniform float uSize;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    mat4 body = modelMatrix * instanceMatrix;
    vec4 centre = body * vec4(0.0, 0.0, 0.0, 1.0);
    vClear = exp(-uAir.x * distance(centre.xyz, cameraPosition));
    // Nothing of it for a lamp that has no size: a vehicle that is off the street.
    float there = step(1e-4, length(body[0].xyz));
    vFacing = max(dot(normalize(body[0].xyz + vec3(1e-6, 0.0, 0.0)), normalize(cameraPosition - centre.xyz)), 0.0);
    vec4 seen = viewMatrix * centre;
    seen.xy += (uv - 0.5) * uSize * there;
    gl_Position = projectionMatrix * seen;
  }
`
const HALO_FRAG = /* glsl */ `
  uniform float uLamps;
  uniform float uOwn;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vFacing;
  varying float vClear;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float halo = exp(-r * r * 9.0) * 0.16 + exp(-r * r * 70.0) * 0.9;
    gl_FragColor = vec4(uTint * halo * vFacing * vFacing * uLamps * uOwn * vClear * (1.0 - smoothstep(0.85, 1.0, r)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// ------------------------------------------------------- models other people made

/**
 * The cars that are drawn from models other people made (`src/content/carModels.ts`),
 * as they are prepared for the walk (README → The traffic): metres, +x forward,
 * the tyres on y 0, the middle of the wheelbase at x 0; a near body and a far
 * one, each a primitive to a material; one wheel about its own axle, its face
 * out towards +z; and in the scene's extras the hubs, the plates and the rest.
 *
 * They are drawn the way the walk's own bodies are — an instanced mesh to each
 * primitive, a car to each instance, the same matrices — with materials of the
 * walk's own in place of the model's, by the role each is named for: the paint
 * takes the car's colour from its instance, and glass, chrome, black trim and
 * the lamps are lit by the street the way the walk's own bodies are. A rim and
 * the odds and ends keep their own colour and pictures.
 */

const MODEL_FRAG = /* glsl */ `
  varying vec3 vCarNormal;
  #ifdef EVO_LAMP_REAR
    varying vec2 vCarLit;
  #endif
  ${EVO_NOISE}
  ${STREET_LIGHT}

  // What the street does to it: the lamps' light on it, and the street and the lamps seen in it.
  vec3 evoModelGlow(vec3 base, float f0, float coat, float tight) {
    vec3 n = normalize(vCarNormal);
    vec3 view = normalize(vEvoWorld - cameraPosition);
    float facing = step(dot(view, n), 0.0);
    vec3 r = reflect(view, n);
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(-view, n), 0.0, 1.0), 5.0);
    vec3 fall;
    vec3 shine;
    evoLamps(vEvoWorld, n, r, tight, fall, shine);
    return base * fall * uLamps + (evoStreetSeen(vEvoWorld, r, 1.0) * fresnel + shine * uLamps * (0.6 + 6.0 * fresnel)) * coat * facing;
  }
`

/**
 * A body in its own picture: where the mask says it is paint, the picture's
 * shade times the car's colour, brought up to it by the file's gain — so the
 * dust and the rust stay where they are, and a white car is white. The gain
 * is the picture's, worked out on its stored (sRGB) values: so is the shade
 * here, and what it makes of the paint is taken back to linear light.
 */
const MODEL_SKIN = /* glsl */ `
  float evoMask = 1.0;
  #ifdef EVO_SKIN
    evoMask = texture2D(emissiveMap, vEmissiveMapUv).r;
    float evoShade = dot(pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2)), vec3(0.2126, 0.7152, 0.0722));
    float evoLight = pow(min(evoShade * uPaintGain, 1.6), 2.2);
    diffuseColor.rgb = mix(diffuseColor.rgb, evoLight * vCarPaint, evoMask);
  #endif
`

const MODEL_GLOW = /* glsl */ `
  #if defined(EVO_PAINT)
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.05, 1.0, 900.0);
  #elif defined(EVO_SKIN)
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.05, mix(0.25, 1.0, evoMask), 900.0);
  #elif defined(EVO_GLASS)
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.07, 1.0, 1500.0);
  #elif defined(EVO_CHROME)
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.62, 1.8, 400.0);
  #elif defined(EVO_TRIM) || defined(EVO_TYRE) || defined(EVO_CABIN)
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.04, 0.22, 90.0);
  #elif defined(EVO_LAMP_FRONT)
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.07, 1.3, 1500.0) + vec3(1.0, 0.94, 0.84) * uLamps * 5.0;
  #elif defined(EVO_LAMP_REAR)
    // Only what is red in the lamp is lit: a reversing lamp in the same cluster stays clear.
    float evoRed = clamp((diffuseColor.r - max(diffuseColor.g, diffuseColor.b)) * 6.0 / max(diffuseColor.r, 0.02), 0.0, 1.0);
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.07, 1.3, 1500.0) + vec3(1.0, 0.03, 0.012) * (uLamps * 1.1 + vCarLit.x * 4.2) * evoRed;
  #elif defined(EVO_LAMP_TURN)
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.07, 1.3, 1500.0);
  #elif defined(EVO_RIM) || defined(EVO_WHEEL)
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.3, 1.2, 300.0);
  #else
    totalEmissiveRadiance += evoModelGlow(diffuseColor.rgb, 0.04, 0.3, 200.0);
  #endif
`

/** The walk's own material for one of a model's, by what it is. */
function modelMaterial(air: Air, shared: { uLamps: { value: number } }, source: Material, role: ModelRole): MeshStandardMaterial {
  const from = source as Partial<MeshStandardMaterial>
  // A body in its own picture, a lamp, a wheel, an odd end: each keeps its picture. The rest is the walk's.
  const own = role === 'skin' || role === 'rim' || role === 'wheel' || role === 'detail' || role.startsWith('lamp')
  const material = new MeshStandardMaterial({
    color: own && role !== 'skin' ? (from.color ?? new Color('#ffffff')) : '#ffffff',
    map: own ? (from.map ?? null) : null,
    roughness: { skin: 0.36, paint: 0.36, glass: 0.05, chrome: 0.12, trim: 0.65, lamp_front: 0.1, lamp_rear: 0.15, lamp_turn: 0.15, tyre: 0.85, rim: 0.3, wheel: 0.45, cabin: 0.9, detail: from.roughness ?? 0.6 }[role],
    metalness: 0,
    side: from.side,
  })
  const color = { glass: [0.012, 0.014, 0.017], chrome: [0.05, 0.05, 0.055], trim: [0.022, 0.022, 0.025], tyre: [0.03, 0.03, 0.032], cabin: [0.012, 0.012, 0.014] } as Partial<Record<ModelRole, number[]>>
  const rgb = color[role]
  if (rgb) material.color.setRGB(rgb[0]!, rgb[1]!, rgb[2]!)
  // Glass the file made see-through stays so, tinted as the file has it: what is behind it — the
  // inside, or the dark box where the inside was — shows through it, the street in it over that.
  if (role === 'glass' && from.transparent) {
    material.transparent = true
    material.opacity = Math.min(0.9, Math.max(0.5, from.opacity ?? 0.72))
    material.depthWrite = false
    if (from.color) material.color.copy(from.color)
  }
  // The paint's mask rides in the emissive picture; its own light is none (the walk's is added after).
  const mask = role === 'skin' ? (from.emissiveMap ?? null) : null
  if (mask) {
    mask.colorSpace = NoColorSpace
    material.emissiveMap = mask
    material.emissive.setRGB(0, 0, 0)
  }
  const gain = Number((source.userData as { paintGain?: unknown }).paintGain)
  const skin = role === 'skin' && mask !== null
  material.defines = { [`EVO_${(role === 'skin' && !skin ? 'paint' : role).toUpperCase()}`]: '' }
  return inAir(material, air, `carModel:${role}`, (shader) => {
    Object.assign(shader.uniforms, lightUniforms(air, shared), { uPaintGain: { value: Number.isFinite(gain) && gain > 0 ? gain : 1 } })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCarNormal;\n#ifdef EVO_LAMP_REAR\n  attribute vec2 aLit;\n  varying vec2 vCarLit;\n#endif\n#ifdef EVO_SKIN\n  attribute vec3 aPaint;\n  varying vec3 vCarPaint;\n#endif')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>\n${WORLD_NORMAL}\n#ifdef EVO_LAMP_REAR\n  vCarLit = aLit;\n#endif\n#ifdef EVO_SKIN\n  vCarPaint = aPaint;\n#endif`)
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${MODEL_FRAG}\n#ifdef EVO_SKIN\n  uniform float uPaintGain;\n  varying vec3 vCarPaint;\n#endif`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${MODEL_SKIN}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${MODEL_GLOW}`)
  })
}

/** One of a model's meshes, instanced: its primitives merged for one material, in metres, and where that is from the car's frame. */
interface ModelPart {
  mesh: InstancedMesh
  offset: Matrix4
  paint: InstancedBufferAttribute | null
  lit: InstancedBufferAttribute | null
}

type Triple = readonly [number, number, number]

/** A model, ready to draw: its parts near and far, its wheels, and what is known of it — all in the car's frame, from the middle of its body. */
export interface ModelSet {
  group: Group
  body: { near: ModelPart[]; far: ModelPart[] }
  wheel: { near: ModelPart[]; far: ModelPart[] }
  used: { near: number; far: number; nearWheel: number; farWheel: number }
  /** The hubs: front left, front right, rear left, rear right. */
  hubs: readonly Triple[]
  radius: number
  plates: { front: Triple; back: Triple }
  /** The middle of the right-hand headlamp. */
  head: Triple | null
  height: number
  /** Where a route card stands behind the windscreen, for a kind that carries one: just inside the glass. */
  card: Triple | null
}

/**
 * What a prepared file says about itself, in its scene's extras: metres, +x
 * forward, +y up, the tyres on y = 0, x = 0 at the middle of the wheelbase.
 */
export interface ModelExtras {
  kind?: string
  length?: number
  width?: number
  height?: number
  wheelbase?: number
  wheelRadius?: number
  wheels?: number[][]
  plates?: { front?: number[]; rear?: number[] } | null
  credit?: { title?: string; author?: string; url?: string; license?: string }
}

const scratch = new Matrix4()
const spin = new Matrix4()
/** The wheel is made for the right-hand side, its face out towards +z: the left-hand wheels are it turned round. */
const flipLeft = new Matrix4().makeRotationY(Math.PI)
const point = new Vector3()

/**
 * How far towards an end a list of faces reaches along the line at height y, z across: the furthest
 * of them that the line passes through, as a distance towards that end ([x, y, z] × 3 a face).
 */
function reachAlong(faces: readonly number[], y: number, z: number, end: 1 | -1): number {
  let best = -Infinity
  for (let t = 0; t < faces.length; t += 9) {
    const y0 = faces[t + 1]!
    const z0 = faces[t + 2]!
    const d = (faces[t + 4]! - y0) * (faces[t + 8]! - z0) - (faces[t + 7]! - y0) * (faces[t + 5]! - z0)
    if (Math.abs(d) < 1e-12) continue
    const u = ((y - y0) * (faces[t + 8]! - z0) - (faces[t + 7]! - y0) * (z - z0)) / d
    const v = ((faces[t + 4]! - y0) * (z - z0) - (y - y0) * (faces[t + 5]! - z0)) / d
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue
    best = Math.max(best, end * (faces[t]! + u * (faces[t + 3]! - faces[t]!) + v * (faces[t + 6]! - faces[t]!)))
  }
  return best
}

/** A file's primitive for merging: its points, its node's matrix, and which of its faces to take (all, if no test). */
interface Piece {
  geometry: BufferGeometry
  matrix: Matrix4
  faces?: (position: Float32Array, a: number, b: number, c: number) => boolean
}

const normalOf = new Matrix3()
const along = new Vector3()

/**
 * Primitives as one geometry, each through its own node's matrix: in metres,
 * in the model's frame. (A file's points are quantized, and its node's matrix
 * is what turns them back into metres; merged, they are plain numbers.)
 */
function merged(list: readonly Piece[]): BufferGeometry {
  let vertices = 0
  let indices = 0
  let uvs = false
  for (const { geometry } of list) {
    const count = geometry.getAttribute('position').count
    vertices += count
    indices += geometry.getIndex()?.count ?? count
    uvs ||= geometry.getAttribute('uv') !== undefined
  }
  const position = new Float32Array(vertices * 3)
  const normal = new Float32Array(vertices * 3)
  const uv = uvs ? new Float32Array(vertices * 2) : null
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)
  let v = 0
  let k = 0
  for (const { geometry, matrix, faces } of list) {
    normalOf.getNormalMatrix(matrix)
    const p = geometry.getAttribute('position')
    const n = geometry.getAttribute('normal')
    const t = geometry.getAttribute('uv')
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i).applyMatrix4(matrix)
      position[(v + i) * 3] = point.x
      position[(v + i) * 3 + 1] = point.y
      position[(v + i) * 3 + 2] = point.z
      if (n) {
        along.fromBufferAttribute(n, i).applyMatrix3(normalOf).normalize()
        normal[(v + i) * 3] = along.x
        normal[(v + i) * 3 + 1] = along.y
        normal[(v + i) * 3 + 2] = along.z
      }
      if (uv && t) {
        uv[(v + i) * 2] = t.getX(i)
        uv[(v + i) * 2 + 1] = t.getY(i)
      }
    }
    const own = geometry.getIndex()
    const count = own?.count ?? p.count
    for (let j = 0; j < count; j += 3) {
      const a = own ? own.getX(j) : j
      const b = own ? own.getX(j + 1) : j + 1
      const c = own ? own.getX(j + 2) : j + 2
      if (faces && !faces(position, v + a, v + b, v + c)) continue
      index[k++] = v + a
      index[k++] = v + b
      index[k++] = v + c
    }
    v += p.count
  }
  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(position, 3))
  out.setAttribute('normal', new BufferAttribute(normal, 3))
  if (uv) out.setAttribute('uv', new BufferAttribute(uv, 2))
  out.setIndex(new BufferAttribute(index.subarray(0, k), 1))
  return out
}

/** What one of a file's materials is: the role in its extras, or its name's. */
const roleFor = (material: unknown): ModelRole => {
  const one = (Array.isArray(material) ? material[0] : material) as Material | undefined
  return roleOf(one?.name ?? '', (one?.userData as { role?: unknown } | undefined)?.role)
}

/** Builds a model's instanced parts from what GLTFLoader made of the file. Hidden until it is handed cars. */
function buildModel(air: Air, shared: { uLamps: { value: number } }, scene: Object3D, capacity: number, shadows: boolean, keep: <T extends { dispose(): void }>(thing: T) => T, disposers: (() => void)[], card?: Lens): ModelSet {
  scene.updateMatrixWorld(true)
  const extras = scene.userData as ModelExtras
  // Where the middle of the body is, from the middle of the wheelbase: the walk puts a car by the middle of its body.
  const bodyNode = scene.getObjectByName('body')
  let fore = -Infinity
  let aft = Infinity
  let top = 0
  const lamp = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity), any: false }
  let glassAt = -Infinity
  bodyNode?.traverse((object) => {
    const mesh = object as Partial<InstancedMesh>
    const position = mesh.geometry?.getAttribute('position')
    if (!position) return
    const role = roleFor(mesh.material)
    const front = role === 'lamp_front'
    const screen = card !== undefined && role === 'glass'
    for (let i = 0; i < position.count; i++) {
      // Each point as the file means it: its node turns the quantized numbers back into metres.
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld)
      fore = Math.max(fore, point.x)
      aft = Math.min(aft, point.x)
      top = Math.max(top, point.y)
      // The windscreen where a route card stands behind it.
      if (screen && Math.abs(point.y - card.y) < 0.15 && Math.abs(point.z - card.z) < 0.2) glassAt = Math.max(glassAt, point.x)
      // The right-hand headlamp.
      if (front && point.z > 0) {
        lamp.min.min(point)
        lamp.max.max(point)
        lamp.any = true
      }
    }
  })
  const shift = Number.isFinite(fore) && Number.isFinite(aft) ? -(fore + aft) / 2 : 0
  const toCar = new Matrix4().makeTranslation(shift, 0, 0)
  // The faces of each end where a plate may go: to find where one goes where the file says nothing of
  // it, and to keep one the file does place clear of the skin.
  const ends = { front: [] as number[], back: [] as number[] }
  {
    bodyNode?.traverse((object) => {
      const geometry = (object as Partial<InstancedMesh>).geometry
      const position = geometry?.getAttribute('position')
      if (!geometry || !position || roleFor((object as Partial<InstancedMesh>).material) === 'glass') return
      const index = geometry.getIndex()
      const count = index ? index.count : position.count
      const a = new Vector3()
      const b = new Vector3()
      const c = new Vector3()
      const at = (k: number): number => (index ? index.getX(k) : k)
      for (let t = 0; t < count; t += 3) {
        a.fromBufferAttribute(position, at(t)).applyMatrix4(object.matrixWorld)
        b.fromBufferAttribute(position, at(t + 1)).applyMatrix4(object.matrixWorld)
        c.fromBufferAttribute(position, at(t + 2)).applyMatrix4(object.matrixWorld)
        // Only faces across the middle of the end, at a plate's height: by where they reach, not where their corners are.
        if (Math.min(a.y, b.y, c.y) > 0.9 || Math.max(a.y, b.y, c.y) < 0.15 || Math.min(a.z, b.z, c.z) > 0.4 || Math.max(a.z, b.z, c.z) < -0.4) continue
        const list = Math.max(a.x, b.x, c.x) > fore - 0.7 ? ends.front : Math.min(a.x, b.x, c.x) < aft + 0.7 ? ends.back : null
        list?.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
      }
    })
  }

  const group = new Group()
  // The walk's material for each of the file's, and one of them for all those it would draw the same:
  // every role but those that keep their pictures is drawn one way, whatever it was in the file.
  const made = new Map<Material, MeshStandardMaterial>()
  const alike = new Map<string, MeshStandardMaterial>()
  const materialFor = (source: Material): MeshStandardMaterial => {
    const known = made.get(source)
    if (known) return known
    const role = roleFor(source)
    const given = source as Partial<MeshStandardMaterial>
    const own = role === 'skin' || role === 'rim' || role === 'wheel' || role === 'detail' || role.startsWith('lamp')
    const see = role === 'glass' && given.transparent ? `${given.opacity}:${given.color?.getHexString() ?? ''}` : ''
    const key = [role, own ? (given.map?.uuid ?? '') : '', own ? (given.color?.getHexString() ?? '') : '', role === 'skin' ? (given.emissiveMap?.uuid ?? '') : '', role === 'skin' ? String((source.userData as { paintGain?: unknown }).paintGain) : '', see, given.side ?? 0].join('|')
    let material = alike.get(key)
    if (!material) {
      material = keep(modelMaterial(air, shared, source, role))
      alike.set(key, material)
      if (material.map) keep(material.map)
      if (material.emissiveMap) keep(material.emissiveMap)
    }
    made.set(source, material)
    return material
  }
  // A roof in black trim — a styling pack — is drawn in the car's own paint, as on most of them.
  let paintSource: Material | null = null
  scene.traverse((object) => {
    const material = (object as Partial<InstancedMesh>).material
    if (!paintSource && material && roleFor(material) === 'paint') paintSource = (Array.isArray(material) ? material[0] : material) as Material
  })
  /** A face of the roof: all of it within a hand of the top of the car, and facing up. */
  const roofFace = (p: Float32Array, a: number, b: number, c: number): boolean => {
    const ya = p[a * 3 + 1]!
    const yb = p[b * 3 + 1]!
    const yc = p[c * 3 + 1]!
    if (Math.min(ya, yb, yc) < top - 0.12) return false
    // The face's normal, from two of its edges; up is +y.
    const ux = p[b * 3]! - p[a * 3]!
    const uy = yb - ya
    const uz = p[b * 3 + 2]! - p[a * 3 + 2]!
    const vx = p[c * 3]! - p[a * 3]!
    const vy = yc - ya
    const vz = p[c * 3 + 2]! - p[a * 3 + 2]!
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    return ny > 0.6 * Math.hypot(nx, ny, nz)
  }
  const notRoofFace = (p: Float32Array, a: number, b: number, c: number): boolean => !roofFace(p, a, b, c)
  const partsOf = (name: string, count: number): ModelPart[] => {
    const node = scene.getObjectByName(name)
    // The node's primitives, by the material the walk draws them with: one mesh, and one draw, to each.
    const by = new Map<MeshStandardMaterial, Piece[]>()
    const add = (material: MeshStandardMaterial, piece: Piece): void => {
      const list = by.get(material) ?? []
      list.push(piece)
      by.set(material, list)
    }
    node?.traverse((object) => {
      const source = object as Partial<InstancedMesh>
      if (!(object as { isMesh?: boolean }).isMesh || !source.geometry || !source.material) return
      const given = (Array.isArray(source.material) ? source.material[0] : source.material) as Material
      if (paintSource && name.startsWith('body') && roleFor(given) === 'trim') {
        // Black trim on the roof is a styling pack; the roof is drawn in the paint.
        add(materialFor(given), { geometry: source.geometry, matrix: object.matrixWorld, faces: notRoofFace })
        add(materialFor(paintSource), { geometry: source.geometry, matrix: object.matrixWorld, faces: roofFace })
        return
      }
      add(materialFor(given), { geometry: source.geometry, matrix: object.matrixWorld })
    })
    const out: ModelPart[] = []
    for (const [material, list] of by) {
      const geometry = keep(merged(list))
      if ((geometry.getIndex()?.count ?? 0) === 0) {
        geometry.dispose()
        continue
      }
      const mesh = new InstancedMesh(geometry, material, Math.max(1, count))
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.frustumCulled = false
      // One instance, of nothing: drawn by the warm-ups, so the driver has the program ready before a car is.
      mesh.count = 1
      mesh.setMatrixAt(0, HIDDEN)
      let paint: InstancedBufferAttribute | null = null
      let lit: InstancedBufferAttribute | null = null
      if (material.defines?.EVO_PAINT !== undefined) {
        paint = new InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3).fill(1), 3).setUsage(DynamicDrawUsage)
        mesh.instanceColor = paint
      } else if (material.defines?.EVO_SKIN !== undefined) {
        // Not as three's instance colour, which would be laid over the whole picture: the mask says where.
        paint = new InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3).fill(1), 3).setUsage(DynamicDrawUsage)
        geometry.setAttribute('aPaint', paint)
      }
      if (material.defines?.EVO_LAMP_REAR !== undefined) {
        lit = new InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 2), 2).setUsage(DynamicDrawUsage)
        geometry.setAttribute('aLit', lit)
      }
      mesh.castShadow = shadows && name.startsWith('body') && material.defines?.EVO_GLASS === undefined
      if (mesh.castShadow) disposers.push(ownShadow(mesh))
      group.add(mesh)
      // A wheel's parts are about its own axle already; a body's are put in the car's frame.
      out.push({ mesh, offset: name.startsWith('wheel') ? new Matrix4() : toCar.clone(), paint, lit })
    }
    return out
  }
  const triple = (at: readonly number[] | undefined, fallback: Triple): Triple =>
    at && at.length >= 3 ? [finite(at[0]! + shift), finite(at[1]!), finite(at[2]!)] : [fallback[0] + shift, fallback[1], fallback[2]]
  const radius = Math.max(0.1, finite(extras.wheelRadius ?? 0.3, 0.3))
  const half = finite(extras.wheelbase ?? 2.5, 2.5) / 2
  const reach = finite(extras.width ?? 1.7, 1.7) / 2 - 0.12
  const wheels = extras.wheels ?? []
  // A plate where the file says; or else on the middle of the end at the height it stands furthest out,
  // which is a bumper. Either way a centimetre clear of the skin everywhere the plate covers — ours is
  // bigger than some — found by casting along the car through the end's own faces.
  const plate = (at: readonly number[] | null | undefined, end: 1 | -1): Triple => {
    const faces = end > 0 ? ends.front : ends.back
    const given = at && at.length >= 3
    let y = given ? at[1]! : 0.45
    const z = given ? at[2]! : 0
    if (!given) {
      let out = -Infinity
      for (let h = 0.28; h <= 0.75; h += 0.01) {
        const x = reachAlong(faces, h, 0, end)
        if (x > out + 0.004) {
          out = x
          y = h
        }
      }
    }
    let x = given ? end * at[0]! - 0.01 : -Infinity
    for (const dy of [-PLATE_SIZE.tall / 2, 0, PLATE_SIZE.tall / 2]) for (const dz of [-PLATE_SIZE.wide / 2, 0, PLATE_SIZE.wide / 2]) x = Math.max(x, reachAlong(faces, y + dy, z + dz, end))
    const edge = Number.isFinite(x) ? x : end > 0 ? fore : -aft
    return [finite(end * (edge + 0.01) + shift), finite(y), finite(z)]
  }
  const body = { near: partsOf('body', capacity), far: partsOf('body_far', capacity) }
  const wheel = { near: partsOf('wheel', capacity * 4), far: partsOf('wheel_far', capacity * 4) }
  // The file's own geometry is merged into the walk's now; and what the walk does not use of its
  // materials, it lets go of, keeping what it does.
  scene.traverse((object) => (object as Partial<InstancedMesh>).geometry?.dispose())
  const used = new Set<Texture>()
  for (const material of alike.values()) {
    if (material.map) used.add(material.map)
    if (material.emissiveMap) used.add(material.emissiveMap)
  }
  for (const source of made.keys()) {
    const given = source as Partial<MeshStandardMaterial>
    for (const picture of [given.map, given.emissiveMap, given.normalMap, given.roughnessMap, given.metalnessMap, given.aoMap]) if (picture && !used.has(picture)) picture.dispose()
    source.dispose()
  }
  const plates = { front: plate(extras.plates?.front, 1), back: plate(extras.plates?.rear, -1) }
  // What was measured, on the group, for whoever looks at it from outside.
  group.userData = { kind: extras.kind, plates, fore: fore + shift, aft: aft + shift }
  return {
    group,
    body,
    wheel,
    used: { near: 0, far: 0, nearWheel: 0, farWheel: 0 },
    hubs: [
      triple(wheels[0], [half, radius, -reach]),
      triple(wheels[1], [half, radius, reach]),
      triple(wheels[2], [-half, radius, -reach]),
      triple(wheels[3], [-half, radius, reach]),
    ],
    radius,
    plates,
    head: lamp.any ? [finite(lamp.max.x + shift), finite((lamp.min.y + lamp.max.y) / 2), finite((lamp.min.z + lamp.max.z) / 2)] : null,
    card: card && Number.isFinite(glassAt) ? [finite(glassAt + shift - 0.035), card.y, card.z] : null,
    height: finite(extras.height ?? top, top),
  }
}

/** Waits for the page to have nothing else to do. */
const idle = (): Promise<void> =>
  new Promise((done) => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => done(), { timeout: 1200 })
    else setTimeout(done, 80)
  })

/** Waits a while. */
const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * A prepared file's bytes. They are kept gzipped, a little over half the size,
 * and opened here — unless whatever served them opened them on the way, which
 * the first two bytes say. Where there is nothing to open them with, there is
 * no model, and the walk's own car stays.
 */
async function modelBytes(file: string): Promise<ArrayBuffer | null> {
  const response = await fetch(file)
  if (!response.ok) return null
  const bytes = await response.arrayBuffer()
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength))
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes
  if (typeof DecompressionStream === 'undefined') return null
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
}

/**
 * Done the first time a model is drawn — which, while it is kept out of
 * sight, only the canvas's warm-ups do: each draws everything in one part
 * of the walk once, into a corner, hidden or not, so that the graphics card
 * has its textures, its buffers and its shadow's program before any car
 * needs them.
 */
const firstDraw = (set: ModelSet): Promise<void> =>
  new Promise((done) => {
    const mesh = set.body.near[0]?.mesh
    if (!mesh) {
      done()
      return
    }
    const was = mesh.onAfterRender
    mesh.onAfterRender = (...args) => {
      mesh.onAfterRender = was
      was.apply(mesh, args)
      done()
    }
  })

/** How far off a car may be swapped for its model in plain sight: as far as it is a few pixels. */
const SWAP_AWAY = 70

// --------------------------------------------------------------- the part

/** Reused every frame: nothing is made in `update`. */
const base = new Matrix4()
const sprung = new Matrix4()
const local = new Matrix4()
const out = new Matrix4()
const at = new Vector3()
const turn = new Quaternion()
const lean = new Quaternion()
const size = new Vector3()
const euler = new Euler()
const HIDDEN = new Matrix4().makeScale(0, 0, 0)
const AHEAD = new Quaternion()
const ASTERN = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)

export function createCars(air: Air & Arrivals, options: CarsOptions): Part & { traffic: Traffic } {
  const root = new Group()
  const disposers: (() => void)[] = []
  const keep = <T extends { dispose(): void }>(thing: T): T => {
    disposers.push(() => thing.dispose())
    return thing
  }
  const shared = { uLamps: { value: 0 } }
  const traffic = createTraffic(options.cars)
  const fleet = traffic.vehicles
  const { texture: sheet, stop: stopSheet } = sheetTexture()
  keep(sheet)
  disposers.push(stopSheet)

  const instanced = (geometry: BufferGeometry, material: Material, count: number): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, Math.max(1, count))
    mesh.count = count
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    for (let i = 0; i < Math.max(1, count); i++) mesh.setMatrixAt(i, HIDDEN)
    root.add(mesh)
    return mesh
  }

  // ---- bodies: two meshes to each kind there is, close and far, handed their cars each frame ----
  const batches = new Map<VehicleKind, { near: BodyBatch; far: BodyBatch }>()
  const allBatches: BodyBatch[] = []
  for (const kind of VEHICLE_KINDS) {
    const members = fleet.filter((vehicle) => vehicle.kind === kind).length
    if (members === 0) continue
    const made = makeBodyMaterial(air, shared, VEHICLE_SHAPES[kind], sheet)
    const material = keep(made.material)
    keep(made.points)
    const batch = (detail: BodyDetail): BodyBatch => {
      const { geometry, lit, look } = bodyGeometry(kind, detail, members)
      const mesh = instanced(keep(geometry), material, members)
      const color = new InstancedBufferAttribute(new Float32Array(members * 3), 3).setUsage(DynamicDrawUsage)
      mesh.instanceColor = color
      mesh.castShadow = options.shadows
      mesh.receiveShadow = options.shadows
      if (options.shadows) disposers.push(ownShadow(mesh))
      const made: BodyBatch = { mesh, color, lit, look, used: 0 }
      allBatches.push(made)
      return made
    }
    batches.set(kind, { near: batch('near'), far: batch('far') })
  }
  /** Each vehicle's batches, its paint, its wheels' dress, and whether it was close last frame. */
  const batchOf = fleet.map((vehicle) => batches.get(vehicle.kind)!)
  const paintOf = fleet.map((vehicle) => PAINT_COLORS[vehicle.paint % PAINT_COUNT] ?? PAINT_COLORS[0]!)
  const wheelOf = fleet.map((vehicle) => WHEEL_STYLES.indexOf(VEHICLE_SHAPES[vehicle.kind].wheel.style))
  const wasNear = new Uint8Array(fleet.length)

  // ---- wheels: close and far, the same way ------------------------------------------
  const wheelMaterial = keep(makeWheelMaterial(air, shared))
  const wheelBatch = (segments: number) => {
    const geometry = keep(wheelGeometry(segments))
    const style = new InstancedBufferAttribute(new Float32Array(Math.max(1, fleet.length * 4)), 1).setUsage(DynamicDrawUsage)
    geometry.setAttribute('aWheel', style)
    const mesh = instanced(geometry, wheelMaterial, fleet.length * 4)
    mesh.receiveShadow = options.shadows
    return { mesh, style, used: 0 }
  }
  const wheelsNear = wheelBatch(22)
  const wheelsFar = wheelBatch(10)

  // ---- plates: two each, and on the front of a bus what it says it is ----------------
  const buses = fleet.filter((vehicle) => vehicle.kind === 'bus')
  const plateCount = fleet.length * 2 + buses.length
  const plateGeometry = keep(facingGeometry())
  const rects = new Float32Array(Math.max(1, plateCount) * 4)
  const kinds = new Float32Array(Math.max(1, plateCount))
  fleet.forEach((_, i) => {
    const tile = plateTile(Math.floor((((i * 2654435761) >>> 0) / 4294967296) * PLATE_COUNT) % PLATE_COUNT)
    rects.set(tile, i * 8)
    rects.set(tile, i * 8 + 4)
    kinds[i * 2] = PLATE.front
    kinds[i * 2 + 1] = PLATE.back
  })
  buses.forEach((_, b) => {
    rects.set(signTile(b % SIGN_TEXTS.length), (fleet.length * 2 + b) * 4)
    kinds[fleet.length * 2 + b] = PLATE.sign
  })
  plateGeometry.setAttribute('aPlate', new InstancedBufferAttribute(rects, 4))
  plateGeometry.setAttribute('aPlateKind', new InstancedBufferAttribute(kinds, 1))
  const plateMaterial = keep(makePlateMaterial(air, shared, sheet))
  const plates = instanced(plateGeometry, plateMaterial, plateCount)

  // ---- on the roofs: the taxis' lights, the racks ------------------------------------
  /** A geometry for something drawn in the plates' program: every instance of it the same tile, lit or not. */
  const tiled = (geometry: BufferGeometry, tile: [number, number, number, number], kind: number, count: number): BufferGeometry => {
    const rect = new Float32Array(Math.max(1, count) * 4)
    for (let k = 0; k < Math.max(1, count); k++) rect.set(tile, k * 4)
    geometry.setAttribute('aPlate', new InstancedBufferAttribute(rect, 4))
    geometry.setAttribute('aPlateKind', new InstancedBufferAttribute(new Float32Array(Math.max(1, count)).fill(kind), 1))
    return geometry
  }
  const taxis = fleet.filter((vehicle) => vehicle.role === 'taxi')
  const taxiLights = instanced(keep(tiled(new BoxGeometry(1, 1, 1), tileOn(TAXI_TILE.x, TAXI_TILE.y, TAXI_TILE.width, TAXI_TILE.height), PLATE.sign, taxis.length)), plateMaterial, taxis.length)
  const racked = fleet.filter((vehicle) => vehicle.look.rack)
  const racks = instanced(keep(tiled(rackGeometry(), tileOn(RACK_TILE.x + 8, RACK_TILE.y + 8, 16, 16), PLATE.front, racked.length)), plateMaterial, racked.length)
  racks.castShadow = options.shadows
  if (options.shadows && racked.length > 0) disposers.push(ownShadow(racks))
  taxiLights.visible = taxis.length > 0
  // The route cards of the minibuses that are models: the walk's own bodies draw theirs behind their glass.
  const carded = fleet.filter((vehicle) => vehicle.look.card >= 0)
  const cardSlot = fleet.map((vehicle) => carded.indexOf(vehicle))
  const cardRects = new Float32Array(Math.max(1, carded.length) * 4)
  carded.forEach((vehicle, k) => cardRects.set(tileOn(vehicle.look.card * CARD_TILE.width, CARD_TILE.y, CARD_TILE.width, CARD_TILE.height), k * 4))
  const cardGeometry = keep(facingGeometry())
  cardGeometry.setAttribute('aPlate', new InstancedBufferAttribute(cardRects, 4))
  cardGeometry.setAttribute('aPlateKind', new InstancedBufferAttribute(new Float32Array(Math.max(1, carded.length)).fill(PLATE.front), 1))
  const cardBoards = instanced(cardGeometry, plateMaterial, carded.length)
  cardBoards.visible = carded.length > 0
  racks.visible = racked.length > 0
  const taxiSlot = fleet.map((vehicle) => taxis.indexOf(vehicle))
  const rackSlot = fleet.map((vehicle) => racked.indexOf(vehicle))

  // ---- what lies on the road under and ahead of each ---------------------------
  const ground = keep(groundGeometry())
  const underMaterial = keep(
    new ShaderMaterial({
      uniforms: { uDark: { value: 0.6 }, uAir: air.uAir },
      vertexShader: UNDER_VERT,
      fragmentShader: UNDER_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
    }),
  )
  const unders = instanced(ground, underMaterial, fleet.length)
  unders.renderOrder = 2
  const beamMaterial = keep(
    new ShaderMaterial({
      uniforms: { uLamps: shared.uLamps, uAir: air.uAir },
      vertexShader: GROUND_VERT,
      fragmentShader: BEAM_FRAG,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    }),
  )
  const beams = instanced(ground, beamMaterial, fleet.length)
  beams.renderOrder = 4

  // Where the frame is given no glow afterwards, a headlamp has to bring its
  // own. Nobody says which it is: a frame that is to be given one is drawn
  // into a frame of its own first, and the first time these are drawn they
  // look at what they are being drawn into. After that they are either
  // needed or gone.
  const haloMaterial = keep(
    new ShaderMaterial({
      uniforms: { uLamps: shared.uLamps, uTint: { value: new Color(1, 0.93, 0.8) }, uSize: { value: 1.2 }, uOwn: { value: 0 }, uAir: air.uAir },
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      // Turned to face the camera in the shader, whichever way round its corners come out.
      side: DoubleSide,
    }),
  )
  const halos = instanced(keep(facingGeometry()), haloMaterial, fleet.length * 2)
  halos.renderOrder = 5
  let ownGlow: boolean | null = null
  halos.onBeforeRender = (renderer) => {
    ownGlow = renderer.getRenderTarget() === null
    haloMaterial.uniforms.uOwn!.value = ownGlow ? 1 : 0
  }

  // ---- the models other people made: loaded when the page has nothing else to do, after the walk
  // is made, one at a time. Each is kept out of sight until it is built and has been drawn once by
  // the warm-ups, and then each car of its kind is swapped for it where nobody is looking. Nothing
  // is built ahead where WebGL is drawn by the CPU (the canvas leaves no `arrived` there), and so
  // nothing is loaded there either: the walk's own bodies stay.
  const ready = new Map<string, ModelSet>()
  /** What a model is filed under: its kind, and which of the kind's two faces where it is one of them. */
  const keyOf = (kind: string, variant?: number): string => (variant === undefined ? kind : `${kind}:${variant}`)
  /** The model a car is drawn as, once there is one: the one for its face, or for its kind. */
  const modelOf = (vehicle: Vehicle): ModelSet | undefined => ready.get(keyOf(vehicle.kind, vehicle.look.variant)) ?? ready.get(vehicle.kind)
  /** Which cars have been swapped for their model. */
  const swapped = new Uint8Array(fleet.length)
  let gone = false
  disposers.push(() => {
    gone = true
  })
  const drawnAs = (entry: Pick<CarModel, 'kind' | 'variant'>) => (vehicle: Vehicle) => vehicle.kind === entry.kind && (entry.variant === undefined || vehicle.look.variant === entry.variant)
  const wanted = (options.models ?? CAR_MODELS).filter((entry) => fleet.some(drawnAs(entry)))
  if (wanted.length > 0 && typeof window !== 'undefined') {
    void (async () => {
      // The canvas says how it builds what arrives once it has the walk, which is after this.
      await idle()
      if (gone || !air.arrived) return
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const loader = new GLTFLoader()
      for (const entry of wanted) {
        await idle()
        if (gone) return
        let scene: Object3D
        try {
          const bytes = await modelBytes(entry.file)
          if (!bytes || gone) continue
          scene = (await loader.parseAsync(bytes, '')).scene
        } catch {
          continue
        }
        if (gone) return
        const count = fleet.filter(drawnAs(entry)).length
        const set = buildModel(air, shared, scene, count, options.shadows, keep, disposers, VEHICLE_SHAPES[entry.kind].card)
        set.group.visible = false
        const drawn = firstDraw(set)
        root.add(set.group)
        await air.arrived?.(set.group)
        // If the warm-ups never come to it, it is swapped in all the same, a while later.
        await Promise.race([drawn, wait(20000)])
        if (gone) return
        set.group.visible = true
        ready.set(keyOf(entry.kind, entry.variant), set)
      }
    })()
  }
  /** Where the camera looks, for swapping a car for its model out of shot. */
  const view = new Frustum()
  const viewMatrix = new Matrix4()
  const bound = new Sphere()
  /** A model's body, at instance k of whichever of its two it is drawn with. */
  const modelBody = (set: ModelSet, near: boolean, matrix: Matrix4, paint: Color, braking: boolean, lit: number): void => {
    const parts = near ? set.body.near : set.body.far
    const k = near ? set.used.near++ : set.used.far++
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p]!
      part.mesh.setMatrixAt(k, scratch.multiplyMatrices(matrix, part.offset))
      part.paint?.setXYZ(k, paint.r, paint.g, paint.b)
      part.lit?.setXY(k, braking ? 1 : 0, lit)
    }
  }
  /** And its four wheels, turned by how far it has come: the left-hand two are the right-hand wheel turned round. */
  const modelWheels = (set: ModelSet, near: boolean, travelled: number): void => {
    const parts = near ? set.wheel.near : set.wheel.far
    const angle = finite(travelled) / set.radius
    for (let w = 0; w < 4; w++) {
      const k = near ? set.used.nearWheel++ : set.used.farWheel++
      const hub = set.hubs[w]!
      const left = hub[2] < 0
      local.makeTranslation(hub[0], hub[1], hub[2])
      if (left) local.multiply(flipLeft)
      // Rolling forwards turns a wheel backwards about +z; turned round, the other way about its own.
      local.multiply(spin.makeRotationZ(left ? angle : -angle))
      out.multiplyMatrices(base, local)
      for (let p = 0; p < parts.length; p++) parts[p]!.mesh.setMatrixAt(k, scratch.multiplyMatrices(out, parts[p]!.offset))
    }
  }
  const finishModels = (): void => {
    for (const set of ready.values()) {
      const lists: [ModelPart[], number][] = [
        [set.body.near, set.used.near],
        [set.body.far, set.used.far],
        [set.wheel.near, set.used.nearWheel],
        [set.wheel.far, set.used.farWheel],
      ]
      for (const [parts, used] of lists) {
        for (const part of parts) {
          part.mesh.count = used
          part.mesh.visible = used > 0
          part.mesh.instanceMatrix.needsUpdate = true
          if (part.paint) part.paint.needsUpdate = true
          if (part.lit) part.lit.needsUpdate = true
        }
      }
      set.used.near = 0
      set.used.far = 0
      set.used.nearWheel = 0
      set.used.farWheel = 0
    }
  }

  /** Puts an instance at a place on a vehicle — on its wheels, or on its body — where from its middle, which way round, how big. */
  const set = (mesh: InstancedMesh, index: number, on: Matrix4, x: number, y: number, z: number, facing: Quaternion, sx: number, sy: number, sz: number): void => {
    local.compose(at.set(x, y, z), facing, size.set(sx, sy, sz))
    mesh.setMatrixAt(index, out.multiplyMatrices(on, local))
  }

  // Nothing overtakes, so the one behind each is the same one for good: the one before it in its lane.
  const behind: number[] = fleet.map((vehicle, i) => {
    const lane = fleet.map((other, j) => (other.lane === vehicle.lane ? j : -1)).filter((j) => j >= 0)
    return lane.length > 1 ? lane[(lane.indexOf(i) - 1 + lane.length) % lane.length]! : -1
  })
  /** How fast each was going a frame ago, and how far its body has dipped or sat back: a car is on springs. */
  const speed = new Float32Array(fleet.length)
  const pitch = new Float32Array(fleet.length)

  /** Hands a vehicle's body to the batch that draws it this frame, with everything it carries. */
  const draw = (batch: BodyBatch, vehicle: Vehicle, i: number, matrix: Matrix4, lit: number): void => {
    const k = batch.used++
    batch.mesh.setMatrixAt(k, matrix)
    const paint = paintOf[i]!
    batch.color.setXYZ(k, paint.r, paint.g, paint.b)
    batch.lit.setXY(k, vehicle.braking ? 1 : 0, lit)
    batch.look.setXYZW(k, vehicle.look.variant, vehicle.look.dust, vehicle.look.fade, vehicle.look.card)
  }
  const wheel = (batch: { mesh: InstancedMesh; style: InstancedBufferAttribute; used: number }, style: number, x: number, radius: number, z: number, width: number): void => {
    const k = batch.used++
    set(batch.mesh, k, base, x, radius, z, turn, radius, radius, width)
    batch.style.setX(k, style)
  }

  function update(beat: Beat): void {
    // They come with the street, which is laid as the first fronts go up.
    const running = beat.stage.city > 0.7
    root.visible = running
    if (!running) return
    const lamps = Math.min(1, Math.max(0, finite(beat.lamps)))
    shared.uLamps.value = lamps
    beams.visible = lamps > 0.05
    halos.visible = ownGlow !== false && lamps > 0.05
    // By day the dark under a car is the sky's shadow; at night there is less sky to be shadowed.
    underMaterial.uniforms.uDark!.value = 0.9 - 0.25 * lamps

    // The city keeps its own time; where the walk is, is only what it has to keep clear of.
    const dt = Math.min(0.25, Math.max(0, finite(beat.dt)))
    traffic.step(dt, crossingHeld(finite(beat.p)), beat.camera.position)
    const settle = 1 - Math.exp(-7 * dt)
    const eye = beat.camera.position

    for (let b = 0; b < allBatches.length; b++) allBatches[b]!.used = 0
    wheelsNear.used = 0
    wheelsFar.used = 0
    if (ready.size > 0) view.setFromProjectionMatrix(viewMatrix.multiplyMatrices(beat.camera.projectionMatrix, beat.camera.matrixWorldInverse))
    let sign = fleet.length * 2
    for (let i = 0; i < fleet.length; i++) {
      const vehicle = fleet[i]!
      const shape = VEHICLE_SHAPES[vehicle.kind]
      const isBus = vehicle.kind === 'bus'
      const taxi = taxiSlot[i]!
      const rack = rackSlot[i]!
      if (!vehicle.shown) {
        plates.setMatrixAt(i * 2, HIDDEN)
        plates.setMatrixAt(i * 2 + 1, HIDDEN)
        halos.setMatrixAt(i * 2, HIDDEN)
        halos.setMatrixAt(i * 2 + 1, HIDDEN)
        unders.setMatrixAt(i, HIDDEN)
        beams.setMatrixAt(i, HIDDEN)
        if (isBus) plates.setMatrixAt(sign++, HIDDEN)
        if (taxi >= 0) taxiLights.setMatrixAt(taxi, HIDDEN)
        if (rack >= 0) racks.setMatrixAt(rack, HIDDEN)
        if (cardSlot[i]! >= 0) cardBoards.setMatrixAt(cardSlot[i]!, HIDDEN)
        wasNear[i] = 0
        if (modelOf(vehicle)) swapped[i] = 1
        continue
      }
      base.compose(at.set(finite(vehicle.x), ROAD_Y, finite(vehicle.z)), vehicle.going > 0 ? AHEAD : ASTERN, size.set(1, 1, 1))
      // The body on its springs: nose down under the brakes, back on its haunches pulling away.
      const pull = dt > 1e-4 ? Math.min(3, Math.max(-8, (finite(vehicle.v) - speed[i]!) / dt)) : 0
      speed[i] = finite(vehicle.v)
      pitch[i] = finite(pitch[i]! + (pull * (isBus ? 0.0012 : 0.0026) - pitch[i]!) * settle)
      lean.setFromEuler(euler.set(0, vehicle.going > 0 ? 0 : Math.PI, pitch[i]!, 'YZX'))
      sprung.compose(at, lean, size)
      // The lamps of the one behind, if it is near enough for them to fall on this one's back.
      const follower = behind[i]!
      let lit = 0
      if (follower >= 0 && fleet[follower]!.shown) {
        const other = fleet[follower]!
        const gap = (((vehicle.s - vehicle.length / 2 - other.s - other.length / 2) % TRAFFIC_RING) + TRAFFIC_RING) % TRAFFIC_RING
        lit = Math.max(0, 1 - gap / 16)
      }
      // Close, or far: by how far it is from the eye, with a little held back so nothing flickers between the two.
      const away = Math.hypot(vehicle.x - eye.x, vehicle.z - eye.z, 1 - eye.y) - shape.length / 2
      const near = away < LOD_NEAR || (wasNear[i] === 1 && away < LOD_NEAR + LOD_HOLD)
      wasNear[i] = near ? 1 : 0
      // Its model, once it has one and it was out of shot, or far enough off to be a few pixels.
      if (swapped[i] === 0 && ready.size > 0 && modelOf(vehicle)) {
        bound.center.set(vehicle.x, 1, vehicle.z)
        bound.radius = shape.length / 2 + 1
        if (away > SWAP_AWAY || !view.intersectsSphere(bound)) swapped[i] = 1
      }
      const model = swapped[i] === 1 ? modelOf(vehicle) : undefined
      if (model) {
        // A model other people made: its body, its own wheels.
        modelBody(model, near, sprung, paintOf[i]!, vehicle.braking, finite(lit * lit))
        modelWheels(model, near, vehicle.travelled)
      } else {
        const kind = batchOf[i]!
        draw(near ? kind.near : kind.far, vehicle, i, sprung, finite(lit * lit))

        // Wheels: turned by how far it has come.
        const { radius, width } = shape.wheel
        turn.setFromEuler(euler.set(0, 0, -finite(vehicle.travelled) / radius, 'XYZ'))
        const reach = wheelReach(shape)
        const wheels = near ? wheelsNear : wheelsFar
        const style = wheelOf[i]!
        wheel(wheels, style, shape.axles[0], radius, reach, width)
        wheel(wheels, style, shape.axles[0], radius, -reach, width)
        wheel(wheels, style, shape.axles[1], radius, reach, width)
        wheel(wheels, style, shape.axles[1], radius, -reach, width)
      }

      // A plate at either end: where the model's own were, or where the body's own numbers say.
      const front = model?.plates.front ?? null
      const back = model?.plates.back ?? null
      set(plates, i * 2, sprung, front ? front[0] : plateAt(shape, 1), front ? front[1] : shape.plates.front, front ? front[2] : 0, AHEAD, 1, PLATE_SIZE.tall, PLATE_SIZE.wide)
      set(plates, i * 2 + 1, sprung, back ? back[0] : plateAt(shape, -1), back ? back[1] : shape.plates.back, back ? back[2] : 0, ASTERN, 1, PLATE_SIZE.tall, PLATE_SIZE.wide)
      if (isBus) set(plates, sign++, sprung, shape.length / 2 - 0.13, shape.height - 0.37, 0, AHEAD, 1, SIGN_SIZE.tall, SIGN_SIZE.wide)
      if (ownGlow !== false) {
        const headX = model?.head ? model.head[0] + 0.05 : shape.length / 2 + 0.05
        const headY = model?.head ? model.head[1] : shape.head.y
        const headZ = model?.head ? model.head[2] : shape.head.z
        set(halos, i * 2, sprung, headX, headY, headZ, AHEAD, 1, 1, 1)
        set(halos, i * 2 + 1, sprung, headX, headY, -headZ, AHEAD, 1, 1, 1)
      }
      // A taxi's light on its roof, across it; a rack on the old sedans that have one.
      const roof = model ? model.height : shape.height
      if (taxi >= 0) set(taxiLights, taxi, sprung, -0.25, roof + 0.07, 0, AHEAD, 0.16, 0.13, 0.46)
      if (rack >= 0) set(racks, rack, sprung, -0.25, roof - 0.005, 0, AHEAD, 1, 1, 1)
      const cardAt = model?.card
      if (cardSlot[i]! >= 0) {
        if (cardAt && shape.card) set(cardBoards, cardSlot[i]!, sprung, cardAt[0], cardAt[1], cardAt[2], AHEAD, 1, shape.card.tall, shape.card.wide)
        else cardBoards.setMatrixAt(cardSlot[i]!, HIDDEN)
      }

      // The dark under it, and the light ahead of it.
      set(unders, i, base, 0, 0.004, 0, AHEAD, shape.length + UNDER_OUT * 2, 1, shape.width + UNDER_OUT * 2)
      set(beams, i, base, shape.length / 2 + 7.3, 0.008, 0, AHEAD, 15, 1, 6.6)
    }
    for (let b = 0; b < allBatches.length; b++) {
      const batch = allBatches[b]!
      batch.mesh.count = batch.used
      batch.mesh.visible = batch.used > 0
      batch.mesh.instanceMatrix.needsUpdate = true
      batch.color.needsUpdate = true
      batch.lit.needsUpdate = true
      batch.look.needsUpdate = true
    }
    for (const wheels of [wheelsNear, wheelsFar]) {
      wheels.mesh.count = wheels.used
      wheels.mesh.visible = wheels.used > 0
      wheels.mesh.instanceMatrix.needsUpdate = true
      wheels.style.needsUpdate = true
    }
    finishModels()
    plates.instanceMatrix.needsUpdate = true
    unders.instanceMatrix.needsUpdate = true
    beams.instanceMatrix.needsUpdate = true
    if (taxis.length > 0) taxiLights.instanceMatrix.needsUpdate = true
    if (racked.length > 0) racks.instanceMatrix.needsUpdate = true
    if (carded.length > 0) cardBoards.instanceMatrix.needsUpdate = true
    if (ownGlow !== false) halos.instanceMatrix.needsUpdate = true
  }

  return {
    object: root,
    update,
    traffic,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}
