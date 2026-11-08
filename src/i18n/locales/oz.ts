import type { Dictionary } from '../types'
import { respellDictionary } from '../newLatin'
import { uz } from './uz'

/**
 * Uzbek in the new Latin alphabet. Not a translation: `uz` respelled letter for
 * letter by `newLatin.ts`, so there is nothing to keep in sync here. A word that
 * must keep a foreign spelling goes in `LOANWORDS` there.
 */
export const oz: Dictionary = respellDictionary(uz)
