import type { ValleyQuality } from '@/lib/valley'
import type { CreatureDetail } from './creatures'
import type { AnyCreatureKind } from './mascots'

/**
 * What the extinction cinematic is made of, kept apart from the scene itself.
 *
 * Both the scene and the warm-up need this, and the warm-up runs from
 * `Valley.tsx`, which has to stay free of three.js. These are type-only
 * imports, so nothing here pulls the renderer in.
 */

/** Every species the valley uses, in the order they are worth having ready. */
export const VALLEY_SPECIES: readonly AnyCreatureKind[] = [
  'sauropod',
  'stegosaur',
  'pterosaur',
  'dino',
  'turtle',
]

/**
 * How finely each species is meshed. A mesh's size is its length, so an
 * animal at its real size takes the coarse mesh's facets up with it: the
 * tyrannosaur, thirty metres from the lens and a third of the frame across,
 * and the sauropods, twenty-odd metres long, were all corners at `low`. The
 * small and far ones stay coarse, and so does everything on a phone or the
 * software renderer. On `ultra` the tyrannosaur is the hero's own mesh, which
 * a desktop has already built.
 */
export function castDetail(kind: AnyCreatureKind, quality: ValleyQuality): CreatureDetail {
  if (quality === 'low' || quality === 'medium') return 'low'
  if (kind === 'dino') return quality === 'ultra' ? 'high' : 'medium'
  return kind === 'sauropod' || kind === 'stegosaur' ? 'medium' : 'low'
}

export interface Placed {
  kind: AnyCreatureKind
  x: number
  z: number
  /** Nose to tail, in metres: every mesh is one unit long. */
  size: number
  yaw: number
}

/**
 * Where the herd stands, at the size the animals were. The forest is planted
 * around these, and the crater is cut well clear of them.
 *
 * They used to be half that — a seven-metre tyrannosaur, thirteen-metre
 * sauropods — which was fine against stacked-cone trees and bare ground, and
 * read as toys once the trees were twenty-metre araucarias and the floor a
 * meadow a metre deep. Now a tyrannosaur is twelve and a half metres and
 * stands thirty from the camera, the sauropods are over twenty, and the
 * araucarias tower over them the way they did.
 */
export const HERD: readonly Placed[] = [
  { kind: 'sauropod', x: -36, z: -52, size: 24, yaw: 0.62 },
  { kind: 'sauropod', x: 50, z: -108, size: 21, yaw: -1.9 },
  { kind: 'stegosaur', x: 26, z: -27, size: 9, yaw: -0.8 },
  { kind: 'stegosaur', x: -24, z: -30, size: 8.2, yaw: 1.4 },
  // Near the middle of the frame, so a phone held upright, which sees only
  // the middle, still has its head in shot.
  { kind: 'dino', x: -1, z: -17, size: 12.5, yaw: -0.35 },
  { kind: 'turtle', x: -12, z: -10, size: 3.3, yaw: 0.9 },
  { kind: 'turtle', x: 17, z: -14, size: 2.7, yaw: -0.5 },
]
