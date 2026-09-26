import type { CreatureDetail } from './creatures'
import type { AnyCreatureKind } from './mascots'

/**
 * What the extinction cinematic is made of, kept apart from the scene itself.
 *
 * Both the scene and the warm-up need this, and the warm-up runs from
 * `Valley.tsx`, which has to stay free of three.js. These are type-only
 * imports, so nothing here pulls the renderer in.
 */

/**
 * `low` for all of it. The valley needs five species on screen at once and is
 * seen at fifty units and up, where the extra surface detail is invisible and
 * the meshing time is not.
 */
export const VALLEY_DETAIL: CreatureDetail = 'low'

/** Every species the valley uses, in the order they are worth having ready. */
export const VALLEY_SPECIES: readonly AnyCreatureKind[] = [
  'sauropod',
  'stegosaur',
  'pterosaur',
  'dino',
  'turtle',
]

export interface Placed {
  kind: AnyCreatureKind
  x: number
  z: number
  size: number
  yaw: number
}

/** Where the herd stands. The forest is planted around these. */
export const HERD: readonly Placed[] = [
  { kind: 'sauropod', x: -23, z: -50, size: 13, yaw: 0.7 },
  { kind: 'sauropod', x: 31, z: -78, size: 11.5, yaw: -1.9 },
  { kind: 'stegosaur', x: 17, z: -33, size: 6.6, yaw: -0.8 },
  { kind: 'stegosaur', x: -41, z: -63, size: 6, yaw: 1.4 },
  { kind: 'dino', x: 5, z: -24, size: 7.4, yaw: -0.4 },
  { kind: 'turtle', x: -11, z: -16, size: 2.8, yaw: 0.9 },
  { kind: 'turtle', x: 13, z: -14, size: 2.2, yaw: -0.5 },
]
