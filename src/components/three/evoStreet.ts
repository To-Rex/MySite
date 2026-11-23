import { PLACE } from './evoLand'

/**
 * The street the walk ends on, as numbers.
 *
 * Several files stand things on it — the buildings, the lamps, the traffic,
 * the trees, the people on the pavement — and they have to agree about where
 * the kerb is. This is where it is written down, once. No three.js: the tests
 * read it too.
 *
 * The street runs along +x. "Far" is the side across the road from the walk
 * (towards -z), "near" the side the walk comes down.
 */

const CITY = PLACE.city

/** Where the city starts and stops, along the walk. */
export const CITY_FROM = CITY.from
export const CITY_UNTIL = CITY.until
/** The middle of the road. */
export const STREET_Z = CITY.street
/** From the middle of the road to either kerb, and the width of the pavement beyond each. */
export const ROAD = CITY.half
export const PAVEMENT = 4.2
/** Where the fronts of the buildings stand, either side. */
export const FRONT_FAR = STREET_Z - ROAD - PAVEMENT
export const FRONT_NEAR = STREET_Z + ROAD + PAVEMENT
/** The length of what is paved: a little before the first front to a little past the last. */
export const STREET_LENGTH = CITY_UNTIL - CITY_FROM + 30
export const STREET_START = CITY_FROM - 8

/** Lamps: how far apart along a kerb, and how high. The two kerbs' lamps are staggered by half a gap. */
export const LAMP_GAP = 26
export const LAMP_HEIGHT = 7.2
/** How far in over the road from its kerb a lamp's head hangs. */
export const LAMP_REACH = 0.9

/**
 * The same numbers for a shader, so that what the lamps light — the road, a
 * wall, the roof of a car going under them — is lit from where the lamps are.
 */
export const STREET_GLSL = /* glsl */ `
  const float STREET_Z = ${STREET_Z.toFixed(2)};
  const float ROAD = ${ROAD.toFixed(2)};
  const float PAVEMENT = ${PAVEMENT.toFixed(2)};
  const float LAMP_GAP = ${LAMP_GAP.toFixed(2)};
  const float LAMP_HEIGHT = ${LAMP_HEIGHT.toFixed(2)};
  const float LAMP_REACH = ${LAMP_REACH.toFixed(2)};
`

/**
 * The lanes: two each way. The far pair comes towards the walk, the near pair
 * goes with it. `z` is the middle of the lane, `going` +1 along +x.
 */
export const LANES: readonly { z: number; going: 1 | -1 }[] = [
  { z: STREET_Z - 5.25, going: -1 },
  { z: STREET_Z - 1.75, going: -1 },
  { z: STREET_Z + 1.75, going: 1 },
  { z: STREET_Z + 5.25, going: 1 },
]

/**
 * Where the walk crosses the road, to the lit window on the other side: a
 * zebra crossing, with a stop line a few metres back from it either way.
 */
export const CROSSWALK = { x: 389.5, half: 3, stop: 2.2 } as const

/**
 * How far the traffic is held at the crossing, 0 to 1, at a point of the walk:
 * the lights are with whoever is walking, so they change as the walk comes up
 * to the kerb and change back once it is across.
 */
export function crossingHeld(progress: number): number {
  const ramp = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  return ramp(0.842, 0.856, progress) * (1 - ramp(0.935, 0.95, progress))
}
