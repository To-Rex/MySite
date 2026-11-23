import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type Texture,
} from 'three'
import { EVO_NOISE, PARS_HERE, inAir, ownShadow, type Air } from './evoAir'
import { ARCH_GAP, VEHICLE_KINDS, VEHICLE_SHAPES, plateAt, vehicleMesh, type VehicleKind, type VehicleShape } from './evoCarShapes'
import { hash2 } from './evoLand'
import { FRONT_FAR, FRONT_NEAR, STREET_GLSL, crossingHeld } from './evoStreet'
import { PAINT_COUNT, TRAFFIC_RING, createTraffic, type Traffic } from './evoTraffic'
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
 * drawn on that skin by where it is: headlamps and tail lamps that come round
 * the corners, a grille, the lines where the doors shut and their handles, and
 * behind the glass the seats and whoever is driving, against the light of the
 * windows on the far side.
 *
 * One instanced mesh for each of the five bodies, and one each for what all of
 * them have: wheels, plates, the dark under them, the light ahead of them.
 */

export interface CarsOptions {
  shadows: boolean
  /** How many of them. */
  cars: number
}

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)

/** How high the road's own surface is: `evoCity.ts` lays the street a little proud of the land. */
const ROAD_Y = 0.06
/** The dark under a car: how far past its outline it reaches, and how far in from the outline it is at its darkest. */
const UNDER_OUT = 0.45
const UNDER_IN = 0.35

/**
 * The colours, in the order `evoTraffic.ts` deals them: white, and then the
 * rest. The last is a bus's. (White is not paper white: in the sun it is the
 * brightest thing on the street as it is.)
 */
const PAINTS = ['#dcddd8', '#aeb3ba', '#565a61', '#0e0f12', '#1b2c4a', '#7a1d1b', '#b0a184', '#1f8f55'] as const
/** A bus's other colour: the band over its windows, and its roof. */
const SECOND = '#d8d9d3'

/**
 * Where the far side of the street is a square and not a row of fronts, along
 * the street: there a car's far flank has only the sky to show.
 */
const SQUARE = { from: 302, until: 388 } as const

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

const BODY_FRAG = /* glsl */ `
  uniform vec3 uSecond;
  // Where the doors shut, along the side: 99 where there are no more.
  uniform vec4 uDoorsAt;
  // A headlamp and a tail lamp on the +z side: how high and how far out its middle is, half its height, half its width.
  uniform vec4 uHead;
  uniform vec4 uRear;
  // Half the length; how far back from the nose a lamp may come round, and forward from the tail; the floor above the road.
  uniform vec4 uEnds;
  // The mouth between the headlamps, and the intake under the plate: how high, half as tall, half as wide.
  uniform vec3 uGrille;
  uniform vec3 uIntake;
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
  varying float vCarPart;
  varying vec2 vCarBody;
  varying vec3 vCarNormal;
  varying vec3 vCarFace;
  varying vec3 vCarAt;
  varying vec3 vCarEye;
  // How hard the brake lights are on, and how much of the lamps of the one behind falls on its back.
  varying vec2 vCarLit;
  ${EVO_NOISE}
  ${STREET_LIGHT}

  float evoCarRough;
  vec3 evoCarGlow;

  // How far outside a box with round corners a point is: negative inside it.
  float evoPill(vec2 p, vec2 size, float corner) {
    vec2 q = abs(p) - size + corner;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
  }
  // 1 inside an outline and 0 outside, with an edge one pixel soft.
  float evoIn(float d) {
    float w = fwidth(d) * 0.75 + 1e-4;
    return 1.0 - smoothstep(-w, w, d);
  }
  // 1 below a height and 0 above it, a centimetre soft: for shapes seen through glass.
  float evoBelow(float edge, float y) {
    return 1.0 - smoothstep(edge - 0.012, edge + 0.012, y);
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
    // The leave side's windows, between its posts; and the screen at either end.
    float post = mix(smoothstep(0.05, 0.07, abs(fract(leave.x / 1.48) - 0.5) * 1.48), smoothstep(0.05, 0.07, abs(leave.x - uSeats.x + 0.1)), cars);
    float window = bySide * post * smoothstep(belt + 0.02, belt + 0.05, leave.y) * evoBelow(top, leave.y) * step(uSeats.w + 0.25, leave.x) * step(leave.x, uSeats.z - 0.1);
    float screen = byEnd * smoothstep(belt + 0.03, belt + 0.07, leave.y) * evoBelow(top, leave.y);
    // An upright tail has a pane in it, and that is all of it that is glass.
    screen *= mix(1.0, step(abs(leave.z), uPane.z) * step(abs(leave.y - uPane.x), uPane.y), uPane.w * step(ray.x, 0.0));
    window = max(window, screen);

    vec3 beyond = evoStreetSeen(vEvoWorld, view, 0.0) * 0.62;
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
      // Rows of seats along the leave side, and the lights along the ceiling.
      float row = evoBelow(belt + 0.14 + 0.2 * step(0.5, fract(leave.x / 0.76)), leave.y) * bySide;
      seat = row * 0.8;
      float ceiling = (1.0 - bySide) * (1.0 - byEnd) * step(0.0, ray.y);
      seen += vec3(0.9, 0.95, 1.0) * lit * 1.3 * ceiling * (1.0 - smoothstep(0.05, 0.08, abs(abs(leave.z) - 0.52)));
    }
    return mix(seen, lining * 0.3, seat);
  }

  // What this fragment of a body is — paint, glass, black plastic, a lamp —
  // and what the street does to it.
  vec3 evoCar(vec3 paint) {
    vec3 at = vCarAt;
    vec3 n = normalize(vCarNormal);
    vec3 face = normalize(vCarFace);
    vec3 view = normalize(vEvoWorld - cameraPosition);
    // From the nose back, and from the tail forward.
    float fore = uEnds.x - at.x;
    float aft = uEnds.x + at.x;
    float skin = step(vCarPart, 0.5) + step(3.5, vCarPart);
    float doorSide = step(0.5, vCarBody.x);

    // ---- outlines, all of them, before anything is decided by one ---------
    // A lamp comes round its corner, but not up over the top of it.
    float notTop = 1.0 - smoothstep(0.62, 0.88, face.y);
    vec2 hp = vec2(abs(at.z) - uHead.y, at.y - uHead.x);
    float headD = evoPill(hp, uHead.wz, min(uHead.z, uHead.w) * 0.72);
    float headHere = step(fore, uEnds.y) * notTop * skin;
    float head = evoIn(headD) * headHere;
    vec2 tp = vec2(abs(at.z) - uRear.y, at.y - uRear.x);
    float tailD = evoPill(tp, uRear.wz, min(uRear.z, uRear.w) * 0.6);
    float tailHere = step(aft, uEnds.z) * notTop * skin;
    float tail = evoIn(tailD) * tailHere;
    // The gap round a lamp, where it meets the panel.
    float rim = max((1.0 - smoothstep(0.0, 0.009, abs(headD))) * headHere, (1.0 - smoothstep(0.0, 0.009, abs(tailD))) * tailHere);
    // The face that looks ahead, and the one that looks back.
    float ahead = smoothstep(0.5, 0.75, face.x) * skin;
    float astern = smoothstep(0.5, 0.75, -face.x) * skin;
    float grille = evoIn(evoPill(vec2(at.z, at.y - uGrille.x), uGrille.zy, uGrille.y * 0.55)) * ahead * step(1e-3, uGrille.z);
    float intake = evoIn(evoPill(vec2(at.z, at.y - uIntake.x), uIntake.zy, uIntake.y * 0.5)) * ahead;
    float valance = (1.0 - smoothstep(uEnds.w + 0.1, uEnds.w + 0.115, at.y)) * astern;
    float paneD = evoPill(vec2(at.z, at.y - uPane.x), uPane.zy, 0.06);
    float paneHere = step(0.6, -face.x) * skin * uPane.w;
    float pane = step(paneD, 0.0) * paneHere;
    float seal = (1.0 - smoothstep(0.0, 0.016, abs(paneD))) * paneHere;
    // Doors: the lines they shut on, and a handle by the edge that opens.
    vec4 gaps = abs(vec4(at.x) - uDoorsAt);
    float gap = min(min(gaps.x, gaps.y), min(gaps.z, gaps.w));
    float seam = (1.0 - smoothstep(0.003, 0.003 + fwidth(at.x) * 1.2, gap)) * doorSide;
    vec3 latch = vec3(at.x) - uDoorsAt.yzw;
    vec3 grip = step(vec3(0.06), latch) * step(latch, vec3(0.25));
    float handle = max(grip.x, max(grip.y, grip.z)) * doorSide * smoothstep(0.79, 0.805, vCarBody.y) * (1.0 - smoothstep(0.86, 0.875, vCarBody.y));
    // A bonnet and a boot: the gap down either edge of each, and across the front of the bonnet.
    float upward = smoothstep(0.45, 0.7, face.y) * skin;
    float lidEdge = 1.0 - smoothstep(0.003, 0.003 + fwidth(at.z) * 1.2, abs(abs(at.z) - uLids.z));
    float lidFront = (1.0 - smoothstep(0.003, 0.003 + fwidth(at.x) * 1.2, abs(fore - 0.17))) * step(abs(at.z), uLids.z) * step(uLids.x, at.x);
    float lid = max(lidEdge * max(step(uLids.x, at.x) * step(0.17, fore), step(at.x, uLids.y) * step(0.12, aft)), lidFront) * upward;
    // Black plastic round the arches and along the skirts, on what has it.
    float arch = min(length(vec2(at.x - uAxle.x, at.y - uAxle.z)), length(vec2(at.x - uAxle.y, at.y - uAxle.z))) - uAxle.z - ${ARCH_GAP.toFixed(3)};
    float clad = uAxle.w * skin * max((1.0 - smoothstep(0.062, 0.07, arch)) * step(0.35, abs(face.z)), 1.0 - smoothstep(uEnds.w + 0.19, uEnds.w + 0.2, at.y));
    float plastic = max(max(clad, valance), max(grille, intake));

    vec3 base = paint;
    // How rough, how much of a lacquer there is over it, and how much that throws back face on.
    float rough = 0.42;
    float coat = 1.0;
    float f0 = 0.05;
    float tight = 900.0;
    vec3 glowing = vec3(0.0);
    if (vCarPart > 3.5) base = uSecond;
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
    } else {
      seam = max(seam, lid);
      base = mix(base * (1.0 - 0.8 * seam), vec3(0.03), handle * 0.85);
      coat *= 1.0 - seam;
      // Plastic: slats across a grille, and nothing much to the rest of it.
      float slats = 0.55 + 0.45 * step(0.5, fract(at.y * 30.0));
      base = mix(base, vec3(0.022, 0.022, 0.025) * mix(1.0, slats, max(grille, intake)), plastic);
      rough = mix(rough, 0.62, plastic);
      coat = mix(coat, 0.22, plastic);
      tight = mix(tight, 90.0, plastic);
      // A headlamp: a clear lens over two reflectors, and a dark house round them.
      float unit = min(uHead.z, uHead.w);
      float core = 1.0 - smoothstep(0.0, unit * 1.05, length(vec2(abs(hp.x) - uHead.w * 0.46, hp.y)));
      vec3 lens = mix(vec3(0.03, 0.03, 0.034), vec3(0.5, 0.51, 0.53), core * core);
      base = mix(base, lens, head);
      glowing += vec3(1.0, 0.94, 0.84) * head * (uLamps * (0.8 + 8.5 * core * core) + (1.0 - uLamps) * 0.5 * core * core);
      // A tail lamp: red glass, lit a little after dark and a lot with a foot on the brake.
      float bar = 0.45 + 0.55 * (1.0 - smoothstep(0.0, 1.0, length(tp / uRear.wz)));
      base = mix(base, vec3(0.24, 0.006, 0.004), tail);
      glowing += vec3(1.0, 0.028, 0.012) * tail * (uLamps * 1.1 + vCarLit.x * 4.2) * bar;
      float lamp = max(head, tail);
      rough = mix(rough, 0.1, lamp);
      coat = mix(coat, 1.3, lamp);
      tight = mix(tight, 1500.0, lamp);
      base *= 1.0 - 0.75 * max(rim * (1.0 - lamp), seal);
    }

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

function bodyUniforms(shape: VehicleShape): Record<string, { value: unknown }> {
  const doors = [99, 99, 99, 99]
  shape.doors.slice(0, 4).forEach((x, k) => {
    doors[k] = x
  })
  const pane = shape.backPane
  const cabin = shape.cabin
  const glass = shape.glass
  // How much of it is ahead of the windscreen and behind the rear screen: a bonnet, and a boot if it is a saloon.
  const bonnet = shape.length / 2 - glass.front[0]
  const boot = glass.rear ? shape.length / 2 + glass.rear[1] : 0
  return {
    uSecond: { value: new Color(SECOND) },
    uDoorsAt: { value: new Vector4(...doors) },
    uHead: { value: new Vector4(shape.head.y, shape.head.z, shape.head.tall / 2, shape.head.wide / 2) },
    uRear: { value: new Vector4(shape.rear.y, shape.rear.z, shape.rear.tall / 2, shape.rear.wide / 2) },
    uEnds: { value: new Vector4(shape.length / 2, shape.nose + 0.14, shape.tail + 0.14, shape.clearance) },
    uGrille: { value: new Vector3(shape.grille[0], shape.grille[1] / 2, shape.grille[2] / 2) },
    uIntake: { value: new Vector3(shape.intake[0], shape.intake[1] / 2, shape.intake[2] / 2) },
    uPane: { value: pane ? new Vector4(pane.y, pane.tall / 2, pane.wide / 2, 1) : new Vector4(0, 0, 0, 0) },
    uCabin: { value: new Vector4(cabin.belt, cabin.top, cabin.half, cabin.lit ? 1 : 0) },
    uSeats: { value: new Vector4(cabin.seats?.[0] ?? 99, cabin.seats?.[1] ?? 99, cabin.front, cabin.rear) },
    uAxle: { value: new Vector4(shape.axles[0], shape.axles[1], shape.wheel.radius, shape.cladding ? 1 : 0) },
    uLids: { value: new Vector3(bonnet > 0.5 ? glass.front[0] + 0.03 : 99, boot > 0.45 && glass.rear ? glass.rear[1] - 0.03 : -99, shape.width * 0.39) },
  }
}

/**
 * The material of one of the five. They are the one program — the text is the
 * same for all of them — and five sets of numbers.
 */
function makeBodyMaterial(air: Air, shared: { uLamps: { value: number } }, shape: VehicleShape): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.42, metalness: 0 })
  const own = bodyUniforms(shape)
  return inAir(material, air, 'car', (shader) => {
    Object.assign(shader.uniforms, lightUniforms(air, shared), own)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute float aPart;
        attribute vec2 aBody;
        attribute vec2 aLit;
        varying float vCarPart;
        varying vec2 vCarBody;
        varying vec3 vCarNormal;
        varying vec3 vCarFace;
        varying vec3 vCarAt;
        varying vec3 vCarEye;
        varying vec2 vCarLit;`,
      )
      .replace(
        '#include <defaultnormal_vertex>',
        /* glsl */ `#include <defaultnormal_vertex>
        vCarPart = aPart;
        vCarBody = aBody;
        vCarLit = aLit;
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
}

function bodyGeometry(kind: VehicleKind, count: number): { geometry: BufferGeometry; lit: InstancedBufferAttribute } {
  const { draw } = vehicleMesh(kind)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(draw.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(draw.normal, 3))
  geometry.setAttribute('aPart', new BufferAttribute(draw.part, 1))
  geometry.setAttribute('aBody', new BufferAttribute(draw.body, 2))
  geometry.setIndex(new BufferAttribute(draw.index, 1))
  // Two numbers to each of them, changed as they drive: how hard the brake lights are on, and how near the lamps of the one behind are.
  const lit = new InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 2), 2)
  lit.setUsage(DynamicDrawUsage)
  geometry.setAttribute('aLit', lit)
  return { geometry, lit }
}

// ------------------------------------------------------------------ wheels

const WHEEL_FRAG = /* glsl */ `
  varying vec3 vWheelAt;
  varying vec3 vCarNormal;
  ${EVO_NOISE}
  ${STREET_LIGHT}

  float evoWheelRough;
  vec3 evoWheelGlow;

  // A wheel: a tyre round a rim of five spokes, with the dark of the brake between them.
  vec3 evoWheel() {
    float rr = length(vWheelAt.xy);
    float face = step(0.4, abs(vWheelAt.z));
    float angle = atan(vWheelAt.y, vWheelAt.x);
    float spoke = abs(fract(angle / 6.2831853 * 5.0) - 0.5) * 2.0;
    float between = smoothstep(0.42, 0.62, spoke) * smoothstep(0.2, 0.26, rr) * (1.0 - smoothstep(0.54, 0.6, rr));
    float alloy = face * (1.0 - smoothstep(0.66, 0.69, rr));
    vec3 rubber = vec3(0.016) * (0.8 + 0.4 * step(0.5, fract(vWheelAt.z * 9.0)) * (1.0 - face));
    vec3 metal = mix(vec3(0.42, 0.43, 0.45), vec3(0.03, 0.03, 0.034), between);
    // The lip of the rim catches the light.
    metal += vec3(0.16) * smoothstep(0.6, 0.66, rr) * (1.0 - between);
    vec3 base = mix(rubber, metal, alloy);
    float shiny = alloy * (1.0 - between);

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
      .replace('#include <common>', '#include <common>\nvarying vec3 vWheelAt;\nvarying vec3 vCarNormal;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>\nvWheelAt = position;\n${WORLD_NORMAL}`)
    shader.fragmentShader = shader.fragmentShader
      .replace(PARS_HERE, `${PARS_HERE}\n${WHEEL_FRAG}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = evoWheel();')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = evoWheelRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += evoWheelGlow;')
  })
}

/** A wheel a metre in radius and a metre wide, on the z axis: the instance makes it the size it is. */
function wheelGeometry(): BufferGeometry {
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
  const geometry = new LatheGeometry(profile, 22)
  // Turned about y as three makes it; a wheel turns about the axle, which is z here.
  geometry.rotateX(Math.PI / 2)
  return geometry
}

// ------------------------------------------------------------------ plates

/** How the plates are laid out on their sheet: eight of them, and under those what a bus says on its front. */
const PLATE_GRID = { cols: 2, rows: 5 } as const
const PLATE_COUNT = 8
/** Where a plate goes: on the front, on the back with a lamp over it, or lit from inside. */
const PLATE = { front: 0, back: 1, sign: 2 } as const
/** A plate is this size everywhere in the country, in metres; and a bus's sign is this size here. */
const PLATE_SIZE = { wide: 0.52, tall: 0.112 } as const
const SIGN_SIZE = { wide: 1.72, tall: 0.3 } as const

/**
 * A sheet of number plates, drawn once: white, a black edge, a strip at the
 * left with the flag's three bands and the country's letters, a region, then
 * letters and numbers. The layout is Uzbekistan's; the numbers are nobody's.
 * Under them, two signs for the front of a bus, in lamps.
 */
function drawPlates(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d')
  if (!g) return
  const w = canvas.width / PLATE_GRID.cols
  const h = canvas.height / PLATE_GRID.rows
  const face = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace'
  g.fillStyle = '#16171a'
  g.fillRect(0, 0, canvas.width, canvas.height)
  const letters = 'ABCDEFGHJKLMNOPQRSTUVXYZ'
  const regions = ['01', '01', '01', '10', '01', '30', '01', '40']
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  for (let tile = 0; tile < PLATE_COUNT; tile++) {
    const x = (tile % PLATE_GRID.cols) * w
    const y = Math.floor(tile / PLATE_GRID.cols) * h
    const letter = (salt: number) => letters[Math.floor(hash2(tile * 7 + salt, 3) * letters.length)] ?? 'A'
    const digit = (salt: number) => String(Math.floor(hash2(tile * 11 + salt, 5) * 10))
    g.fillStyle = '#0b0b0c'
    g.fillRect(x, y, w, h)
    g.fillStyle = '#f4f4f1'
    g.fillRect(x + 3, y + 3, w - 6, h - 6)
    // The strip at the left: blue, white and green with a thread of red between, and UZ under them.
    const strip = w * 0.105
    const band = h * 0.1
    const top = y + h * 0.2
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
    g.font = `700 ${Math.round(h * 0.2)}px ${face}`
    g.fillText('UZ', x + 6 + strip / 2, y + h * 0.76)
    // The region, a line, and the number.
    g.font = `700 ${Math.round(h * 0.56)}px ${face}`
    g.fillText(regions[tile] ?? '01', x + w * 0.225, y + h * 0.55)
    g.fillRect(x + w * 0.315, y + 3, 2, h - 6)
    // A private car's, mostly: a letter, three figures, two letters. The odd one is a firm's.
    const firm = tile % 4 === 3
    const number = firm ? `${digit(1)}${digit(2)}${digit(3)} ${letter(4)}${letter(5)}${letter(6)}` : `${letter(1)} ${digit(2)}${digit(3)}${digit(4)} ${letter(5)}${letter(6)}`
    g.fillText(number, x + w * 0.66, y + h * 0.55)
  }
  // What a bus says on its front, in amber lamps: a number, and two of the city's districts. The numbers are not taken from any timetable.
  const signs = ['19  CHORSU', '58  SERGELI']
  signs.forEach((text, k) => {
    const x = k * w
    const y = (PLATE_COUNT / PLATE_GRID.cols) * h
    g.fillStyle = '#050505'
    g.fillRect(x, y, w, h)
    g.fillStyle = '#ffb21e'
    g.font = `700 ${Math.round(h * 0.6)}px ${face}`
    g.fillText(text, x + w / 2, y + h * 0.54)
    // The dark between the lamps.
    g.fillStyle = '#050505'
    for (let line = 0; line < h; line += 4) g.fillRect(x, y + line, w, 1)
    for (let line = 0; line < w; line += 4) g.fillRect(x + line, y, 1, h)
  })
}

function platesTexture(): Texture {
  if (typeof document === 'undefined') return new DataTexture(new Uint8Array([240, 240, 236, 255]), 1, 1)
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 320
  drawPlates(canvas)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 4
  return texture
}

const PLATE_FRAG = /* glsl */ `
  uniform sampler2D uPlates;
  varying vec2 vPlateUv;
  varying vec2 vPlate;
  varying vec3 vCarNormal;
  ${EVO_NOISE}
  ${STREET_LIGHT}

  vec3 evoPlateGlow;

  vec3 evoPlate() {
    vec2 grid = vec2(${PLATE_GRID.cols.toFixed(1)}, ${PLATE_GRID.rows.toFixed(1)});
    vec2 tile = vec2(mod(vPlate.x, grid.x), floor(vPlate.x / grid.x));
    // Read from its own left, which is not the left of the side it is looked at from.
    vec3 base = texture2D(uPlates, vec2((tile.x + 1.0 - vPlateUv.x) / grid.x, 1.0 - (tile.y + 1.0 - vPlateUv.y) / grid.y)).rgb;
    vec3 n = normalize(vCarNormal);
    vec3 fall;
    vec3 shine;
    evoLamps(vEvoWorld, n, n, 8.0, fall, shine);
    float board = step(1.5, vPlate.y);
    // A plate at the back has a lamp of its own over it; a bus's sign is nothing but lamps.
    evoPlateGlow = base * (fall + vec3(0.9, 0.92, 1.0) * 0.5 * step(0.5, vPlate.y)) * uLamps * (1.0 - board) + base * board * (0.7 + 2.4 * uLamps);
    return base * (1.0 - board);
  }
`

function makePlateMaterial(air: Air, shared: { uLamps: { value: number } }, plates: Texture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0 })
  return inAir(material, air, 'plate', (shader) => {
    Object.assign(shader.uniforms, lightUniforms(air, shared), { uPlates: { value: plates } })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aPlate;\nvarying vec2 vPlateUv;\nvarying vec2 vPlate;\nvarying vec3 vCarNormal;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>\nvPlateUv = uv;\nvPlate = aPlate;\n${WORLD_NORMAL}`)
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

export function createCars(air: Air, options: CarsOptions): Part & { traffic: Traffic } {
  const root = new Group()
  const disposers: (() => void)[] = []
  const keep = <T extends { dispose(): void }>(thing: T): T => {
    disposers.push(() => thing.dispose())
    return thing
  }
  const shared = { uLamps: { value: 0 } }
  const traffic = createTraffic(options.cars)
  const fleet = traffic.vehicles

  const instanced = (geometry: BufferGeometry, material: Material, count: number): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, Math.max(1, count))
    mesh.count = count
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    for (let i = 0; i < Math.max(1, count); i++) mesh.setMatrixAt(i, HIDDEN)
    root.add(mesh)
    return mesh
  }

  // ---- bodies: one mesh to each of the five, an instance to each vehicle ---
  const tint = new Color()
  interface Body {
    mesh: InstancedMesh
    lit: InstancedBufferAttribute
  }
  const bodies: Body[] = []
  /** Which body each vehicle is an instance of, and which instance. */
  const bodyOf: (Body | undefined)[] = []
  const slot: number[] = []
  for (const kind of VEHICLE_KINDS) {
    const members = fleet.filter((vehicle) => vehicle.kind === kind)
    if (members.length === 0) continue
    const { geometry, lit } = bodyGeometry(kind, members.length)
    const mesh = instanced(keep(geometry), keep(makeBodyMaterial(air, shared, VEHICLE_SHAPES[kind])), members.length)
    const body: Body = { mesh, lit }
    members.forEach((vehicle, k) => {
      const i = fleet.indexOf(vehicle)
      slot[i] = k
      bodyOf[i] = body
      mesh.setColorAt(k, tint.set(PAINTS[vehicle.paint % PAINT_COUNT] ?? PAINTS[0]))
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.castShadow = options.shadows
    mesh.receiveShadow = options.shadows
    if (options.shadows) disposers.push(ownShadow(mesh))
    bodies.push(body)
  }

  // ---- what every vehicle has ------------------------------------------------
  const wheels = instanced(keep(wheelGeometry()), keep(makeWheelMaterial(air, shared)), fleet.length * 4)
  wheels.receiveShadow = options.shadows

  // Two plates each, and on the front of a bus what it says it is.
  const buses = fleet.filter((vehicle) => vehicle.kind === 'bus')
  const sheet = keep(platesTexture())
  const plateCount = fleet.length * 2 + buses.length
  const plateGeometry = keep(facingGeometry())
  const which = new Float32Array(Math.max(1, plateCount) * 2)
  fleet.forEach((_, i) => {
    const tile = Math.floor(hash2(i, 83) * PLATE_COUNT) % PLATE_COUNT
    which.set([tile, PLATE.front, tile, PLATE.back], i * 4)
  })
  buses.forEach((_, b) => which.set([PLATE_COUNT + (b % 2), PLATE.sign], (fleet.length * 2 + b) * 2))
  plateGeometry.setAttribute('aPlate', new InstancedBufferAttribute(which, 2))
  const plates = instanced(plateGeometry, keep(makePlateMaterial(air, shared, sheet)), plateCount)

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

    let sign = fleet.length * 2
    for (let i = 0; i < fleet.length; i++) {
      const vehicle = fleet[i]!
      const shape = VEHICLE_SHAPES[vehicle.kind]
      const body = bodyOf[i]
      const k = slot[i] ?? 0
      const isBus = vehicle.kind === 'bus'
      if (!vehicle.shown) {
        body?.mesh.setMatrixAt(k, HIDDEN)
        for (let w = 0; w < 4; w++) wheels.setMatrixAt(i * 4 + w, HIDDEN)
        plates.setMatrixAt(i * 2, HIDDEN)
        plates.setMatrixAt(i * 2 + 1, HIDDEN)
        halos.setMatrixAt(i * 2, HIDDEN)
        halos.setMatrixAt(i * 2 + 1, HIDDEN)
        unders.setMatrixAt(i, HIDDEN)
        beams.setMatrixAt(i, HIDDEN)
        if (isBus) plates.setMatrixAt(sign++, HIDDEN)
        continue
      }
      base.compose(at.set(finite(vehicle.x), ROAD_Y, finite(vehicle.z)), vehicle.going > 0 ? AHEAD : ASTERN, size.set(1, 1, 1))
      // The body on its springs: nose down under the brakes, back on its haunches pulling away.
      const pull = dt > 1e-4 ? Math.min(3, Math.max(-8, (finite(vehicle.v) - speed[i]!) / dt)) : 0
      speed[i] = finite(vehicle.v)
      pitch[i] = finite(pitch[i]! + (pull * (isBus ? 0.0012 : 0.0026) - pitch[i]!) * settle)
      lean.setFromEuler(euler.set(0, vehicle.going > 0 ? 0 : Math.PI, pitch[i]!, 'YZX'))
      sprung.compose(at, lean, size)
      body?.mesh.setMatrixAt(k, sprung)
      // The lamps of the one behind, if it is near enough for them to fall on this one's back.
      const follower = behind[i]!
      let lit = 0
      if (follower >= 0 && fleet[follower]!.shown) {
        const other = fleet[follower]!
        const gap = (((vehicle.s - vehicle.length / 2 - other.s - other.length / 2) % TRAFFIC_RING) + TRAFFIC_RING) % TRAFFIC_RING
        lit = Math.max(0, 1 - gap / 16)
      }
      body?.lit.setXY(k, vehicle.braking ? 1 : 0, finite(lit * lit))

      // Wheels: turned by how far it has come.
      const { radius, width } = shape.wheel
      turn.setFromEuler(euler.set(0, 0, -finite(vehicle.travelled) / radius, 'XYZ'))
      const reach = shape.width / 2 - width / 2 - 0.035
      set(wheels, i * 4, base, shape.axles[0], radius, reach, turn, radius, radius, width)
      set(wheels, i * 4 + 1, base, shape.axles[0], radius, -reach, turn, radius, radius, width)
      set(wheels, i * 4 + 2, base, shape.axles[1], radius, reach, turn, radius, radius, width)
      set(wheels, i * 4 + 3, base, shape.axles[1], radius, -reach, turn, radius, radius, width)

      // A plate at either end.
      set(plates, i * 2, sprung, plateAt(shape, 1), shape.plates.front, 0, AHEAD, 1, PLATE_SIZE.tall, PLATE_SIZE.wide)
      set(plates, i * 2 + 1, sprung, plateAt(shape, -1), shape.plates.back, 0, ASTERN, 1, PLATE_SIZE.tall, PLATE_SIZE.wide)
      if (isBus) set(plates, sign++, sprung, shape.length / 2 - 0.13, shape.height - 0.37, 0, AHEAD, 1, SIGN_SIZE.tall, SIGN_SIZE.wide)
      if (ownGlow !== false) {
        set(halos, i * 2, sprung, shape.head.x + 0.05, shape.head.y, shape.head.z, AHEAD, 1, 1, 1)
        set(halos, i * 2 + 1, sprung, shape.head.x + 0.05, shape.head.y, -shape.head.z, AHEAD, 1, 1, 1)
      }

      // The dark under it, and the light ahead of it.
      set(unders, i, base, 0, 0.004, 0, AHEAD, shape.length + UNDER_OUT * 2, 1, shape.width + UNDER_OUT * 2)
      set(beams, i, base, shape.length / 2 + 7.3, 0.008, 0, AHEAD, 15, 1, 6.6)
    }
    for (let b = 0; b < bodies.length; b++) {
      bodies[b]!.mesh.instanceMatrix.needsUpdate = true
      bodies[b]!.lit.needsUpdate = true
    }
    wheels.instanceMatrix.needsUpdate = true
    plates.instanceMatrix.needsUpdate = true
    unders.instanceMatrix.needsUpdate = true
    beams.instanceMatrix.needsUpdate = true
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
