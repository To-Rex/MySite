import type { FigureLook } from './evoMaterials'

/**
 * How each of the long walk's people is finished. The meshes are two — someone
 * from the cave and someone from now — and these are what make a group of them
 * a group of different people.
 */
export const FIGURE_LOOKS = {
  /** A hide of dark fur, weathered skin. */
  early: { skin: '#a8714c', hair: '#221710', cloth: '#5e4127', trim: '#33211a', rough: [0.6, 0.5, 0.96, 0.8], fuzz: [0.3, 0.9, 1, 0.2], relief: [0.04, 0.4, 0.55, 0.2], pelt: 1 },
  /** A paler pelt and greying hair: someone older. */
  elder: { skin: '#b07d58', hair: '#6d665c', cloth: '#857258', trim: '#3a271c', rough: [0.62, 0.55, 0.96, 0.8], fuzz: [0.3, 0.9, 1, 0.2], relief: [0.06, 0.4, 0.55, 0.2], pelt: 1 },
  /** Reddish fur. */
  hunter: { skin: '#9c6a48', hair: '#2b1a10', cloth: '#73492a', trim: '#2c1c14', rough: [0.6, 0.5, 0.96, 0.8], fuzz: [0.3, 0.9, 1, 0.2], relief: [0.04, 0.4, 0.55, 0.2], pelt: 1 },
  /** Undyed wool and a leather belt: someone who farms. */
  settler: { skin: '#b17b55', hair: '#2a1d14', cloth: '#b9a988', trim: '#4a3220', rough: [0.6, 0.5, 0.93, 0.78], fuzz: [0.3, 0.9, 0.55, 0.2], relief: [0.04, 0.4, 0.22, 0.2], pelt: 0.12 },
  /** A dark hooded top, dark trousers. */
  modern: { skin: '#c18f6c', hair: '#15110e', cloth: '#2c3644', trim: '#1b2230', rough: [0.58, 0.45, 0.92, 0.86], fuzz: [0.28, 0.6, 0.5, 0.25], relief: [0.03, 0.3, 0.14, 0.12], pelt: 0 },
  /** Mustard and denim. */
  walker: { skin: '#b9825e', hair: '#2a1c12', cloth: '#b98a2e', trim: '#27364e', rough: [0.58, 0.5, 0.92, 0.84], fuzz: [0.28, 0.6, 0.5, 0.25], relief: [0.03, 0.3, 0.14, 0.12], pelt: 0 },
  /** Light grey over black. */
  passer: { skin: '#d3a480', hair: '#3a2718', cloth: '#b9bdc4', trim: '#131418', rough: [0.58, 0.5, 0.9, 0.86], fuzz: [0.28, 0.6, 0.5, 0.25], relief: [0.03, 0.3, 0.14, 0.12], pelt: 0 },
  /** The coat of a mammoth: the whole animal is the pelt. */
  mammoth: { skin: '#4a372a', hair: '#3a281b', cloth: '#5a4130', trim: '#e6dcc4', rough: [0.9, 0.95, 0.97, 0.45], fuzz: [0.4, 1, 1, 0.1], relief: [0.3, 0.6, 0.7, 0.05], pelt: 1 },
} as const satisfies Record<string, FigureLook>

export type FigureLookName = keyof typeof FIGURE_LOOKS
