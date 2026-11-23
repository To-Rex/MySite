import type { FigureLook } from './evoMaterials'

/**
 * How each of the long walk's people is finished. The meshes are two — someone
 * from the cave and someone from now — and these are what make a group of them
 * a group of different people: the colour of a skin and of the hair on it, of
 * a pelt, and how long the hair and the fur have been let to grow.
 */

/** What the people of the cave have in common: what their straps are cut from, what a shoe would be. */
const CAVE = { hide: '#5a3e29', cloth: '#6b5a44', denim: '#4a3a2a', horn: '#d9cdb0', sole: '#2a2018', gloss: [70, 0.55] } as const
/** And the people of now. */
const NOW = { hide: '#1d1d20', horn: '#d8cbb4', sole: '#d9d6cf', fur: ['#2a2a2a', '#555555'], gloss: [90, 0.8] } as const

export const FIGURE_LOOKS = {
  /** A hide of dark fur, weathered skin. */
  early: { ...CAVE, skin: '#93725d', hair: ['#18100b', '#3a281b'], fur: ['#2e1e13', '#7a5c3e'], eye: '#3a2412', lengths: [1, 1] },
  /** A paler pelt and greying hair, worn long: someone older. */
  elder: { ...CAVE, skin: '#9b7d68', hair: ['#4a4641', '#a9a297'], fur: ['#4a3d2e', '#a4947a'], eye: '#4a3a2a', lengths: [1.25, 1.15] },
  /** Reddish fur, and the hair cut shorter. */
  hunter: { ...CAVE, skin: '#8a6a56', hair: ['#1e120a', '#4a2f1b'], fur: ['#3a2214', '#8c5a32'], eye: '#2e1c0e', lengths: [0.72, 0.9] },
  /** A dark hooded top, dark trousers. */
  modern: { ...NOW, skin: '#c18f6c', hair: ['#120e0b', '#3a2c20'], cloth: '#2c3644', denim: '#1b2230', eye: '#3c2a1a', lengths: [1, 1] },
  /** Mustard and denim. */
  walker: { ...NOW, skin: '#b9825e', hair: ['#2a1c12', '#6a4a2c'], cloth: '#b98a2e', denim: '#27364e', hide: '#3a2a20', eye: '#3c2a1a', lengths: [1.3, 1] },
  /** Light grey over black. */
  passer: { ...NOW, skin: '#d3a480', hair: ['#3a2718', '#8a6a44'], cloth: '#b9bdc4', denim: '#131418', eye: '#4a5a66', lengths: [0.8, 1] },
  /** A mammoth: its coat dark at the roots and tawny where the sun has had it, bare skin the colour of an elephant's, ivory. */
  mammoth: { skin: '#5a4d44', hair: ['#241812', '#4a3423'], fur: ['#2a1b11', '#9a6a3e'], hide: '#5a4d44', cloth: '#5a4d44', denim: '#5a4d44', horn: '#e2d6bb', sole: '#2a2420', eye: '#1c120a', gloss: [34, 0.5], lengths: [1, 1] },
} as const satisfies Record<string, FigureLook>

export type FigureLookName = keyof typeof FIGURE_LOOKS
