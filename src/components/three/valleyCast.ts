import type { CreatureDetail } from './creatures'
import type { AnyCreatureKind } from './mascots'

/**
 * What the extinction cinematic is made of, kept apart from the scene itself.
 *
 * Both the scene and the warm-up need this list, and the warm-up runs from
 * `Valley.tsx`, which has to stay free of three.js. These are type-only imports,
 * so nothing here pulls the renderer in.
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
